/**
 * Cloudflare Worker entry point.
 *
 * Serves the built SPA from the static-assets binding (env.ASSETS) and hosts
 * the server-side AI proxy at POST /api/ai. The Anthropic API key lives only
 * in the Worker environment (env.ANTHROPIC_API_KEY) and never reaches the
 * browser. Model is chosen here; override with the AI_MODEL variable.
 */

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleAI(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const messages = body?.messages;
  const maxTokens = Math.min(Number(body?.max_tokens) || 1024, 4096);
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "`messages` array is required" }, 400);
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "AI is not configured on the server (missing ANTHROPIC_API_KEY)." }, 503);
  }

  const model = env.AI_MODEL || "claude-sonnet-5";

  // Forward only known-safe fields. `system` and `tools` power the in-app
  // assistant; `stream` turns on live token streaming (SSE passthrough).
  const payload = { model, max_tokens: maxTokens, messages };
  if (body.system) payload.system = String(body.system).slice(0, 60000);
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools.slice(0, 8);
  if (body.tool_choice) payload.tool_choice = body.tool_choice;
  if (body.stream) payload.stream = true;

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });
    if (payload.stream && upstream.ok && upstream.body) {
      // Stream Anthropic's SSE straight through to the browser.
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }
    // Pass Anthropic's response straight through so the client reads the
    // standard { content: [...] } shape (and surfaces upstream errors).
    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return json({ error: "Upstream AI request failed: " + String((e && e.message) || e) }, 502);
  }
}

/**
 * POST /api/admin/reset-password — admin-only password reset.
 *
 * The caller proves who they are with their own Supabase session token; the
 * Worker verifies that token, confirms the caller's profile is an APPROVED
 * ADMIN, and only then sets the target user's password via Supabase's admin
 * API using the server-side secret key (env.SUPABASE_SERVICE_ROLE_KEY —
 * never exposed to the browser).
 */
async function handleAdminResetPassword(request, env) {
  const supabaseUrl = env.SUPABASE_URL || "https://lvbqsiycvsvadkowjequ.supabase.co";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return json({ error: "Password admin is not configured on the server (missing SUPABASE_SERVICE_ROLE_KEY secret)." }, 503);
  }

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const userId = body?.user_id;
  const newPassword = String(body?.new_password || "");
  if (!userId || newPassword.length < 8) {
    return json({ error: "A user_id and a password of at least 8 characters are required." }, 400);
  }

  // 1. Identify the caller from their session token.
  const meRes = await fetch(supabaseUrl + "/auth/v1/user", {
    headers: { Authorization: "Bearer " + token, apikey: serviceKey },
  });
  if (!meRes.ok) return json({ error: "Your session has expired — sign in again." }, 401);
  const me = await meRes.json();

  // 2. Confirm the caller is an approved admin (service key bypasses RLS).
  const profRes = await fetch(
    supabaseUrl + "/rest/v1/profiles?user_id=eq." + encodeURIComponent(me.id) + "&select=role,status",
    { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } }
  );
  const profiles = profRes.ok ? await profRes.json() : [];
  const caller = profiles[0];
  if (!caller || caller.role !== "admin" || caller.status !== "approved") {
    return json({ error: "Only an administrator can reset passwords." }, 403);
  }

  // 3. Set the target user's password via the admin API.
  const upd = await fetch(supabaseUrl + "/auth/v1/admin/users/" + encodeURIComponent(userId), {
    method: "PUT",
    headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: "Bearer " + serviceKey },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!upd.ok) {
    const detail = (await upd.text()).slice(0, 200);
    return json({ error: "Could not set the password: " + detail }, 502);
  }
  return json({ ok: true });
}

/* ---------------------------------------------------------------------------
 * Daily exceptions digest.
 * A cron trigger (see wrangler.jsonc) loads the shared workspace with the
 * server-side key, computes the morning exceptions, and emails them via
 * Resend. Configure with secrets: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 * and optionally DIGEST_TO / DIGEST_FROM. Without RESEND_API_KEY it does
 * nothing. GET /api/digest/preview (admin-signed-in) renders it in-browser.
 * ------------------------------------------------------------------------- */
function buildDigest(doc) {
  const today = new Date().toISOString().slice(0, 10);
  const days = (s) => (s ? Math.round((new Date(String(s).slice(0, 10)) - new Date(today)) / 86400000) : null);
  const fmt = (s) => { const p = String(s || "").slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : "—"; };
  const OPEN = ["Inbox", "Planned", "In Progress", "Waiting", "Blocked", "Review"];
  const items = (doc.workItems || []).filter((w) => OPEN.includes(w.status));
  const sec = [];
  const add = (title, arr) => { if (arr.length) sec.push({ title, rows: arr }); };
  add("Overdue", items.filter((w) => w.due && days(w.due) < 0).map((w) => `${w.title} — due ${fmt(w.due)}${w.owner ? " · " + w.owner : ""}`));
  add("Due today", items.filter((w) => days(w.due) === 0).map((w) => w.title));
  add("Blocked", items.filter((w) => w.status === "Blocked").map((w) => `${w.title}${w.blocker ? " — " + w.blocker : ""}`));
  add("Chases due", items.filter((w) => w.status === "Waiting" && (!w.nextChase || days(w.nextChase) <= 0)).map((w) => `${w.title}${w.waitingOn ? " — waiting on " + w.waitingOn : ""}`));
  add("Decisions past required date", items.filter((w) => w.type === "Decision" && days(w.extra?.requiredBy || w.due) < 0).map((w) => w.title));
  add("Commitments due within 7 days", items.filter((w) => w.type === "Commitment" && days(w.due) !== null && days(w.due) >= 0 && days(w.due) <= 7).map((w) => `${w.title} — ${fmt(w.due)}`));
  add("Go-lives within 30 days", (doc.mobs || []).filter((m) => m.stage !== "Closed" && days(m.goLive) !== null && days(m.goLive) >= 0 && days(m.goLive) <= 30).map((m) => `${m.name} — ${fmt(m.goLive)} (${days(m.goLive)}d)`));
  if (doc.boardDraft?.deadline && days(doc.boardDraft.deadline) !== null && days(doc.boardDraft.deadline) <= 5 && days(doc.boardDraft.deadline) >= 0) {
    sec.push({ title: "Board pack", rows: ["Submission deadline " + fmt(doc.boardDraft.deadline) + " — " + days(doc.boardDraft.deadline) + " day(s) away"] });
  }
  const total = sec.reduce((n, s) => n + s.rows.length, 0);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = sec.map((s) =>
    `<h2 style="font:800 11px Montserrat,Arial,sans-serif;color:#FD0E33;text-transform:uppercase;letter-spacing:1.5px;margin:18px 0 6px;">${esc(s.title)} (${s.rows.length})</h2>` +
    `<ul style="margin:0 0 0 18px;padding:0;">` + s.rows.slice(0, 12).map((r) => `<li style="margin-bottom:5px;">${esc(r)}</li>`).join("") +
    (s.rows.length > 12 ? `<li>… and ${s.rows.length - 12} more</li>` : "") + `</ul>`).join("");
  const html = `<div style="font-family:Montserrat,'Segoe UI',Arial,sans-serif;color:#112138;font-size:14px;line-height:1.55;max-width:560px;">
<div style="border-bottom:3px solid #112138;padding-bottom:8px;margin-bottom:6px;font:900 22px Montserrat,Arial,sans-serif;">cmac<span style="color:#FD0E33">.</span></div>
<h1 style="font-size:18px;font-weight:800;margin:12px 0 2px;">Morning brief<span style="color:#FD0E33">.</span></h1>
<div style="color:#5C6675;font-size:12px;margin-bottom:8px;">${fmt(today)} · ${total ? total + " item(s) need attention" : "No exceptions — clear runway today"}</div>
${body || '<p>Nothing overdue, blocked, or waiting on a chase. Enjoy it.</p>'}
<p style="margin-top:20px;"><a href="https://cmac-dashboard.paulanthonywardle.workers.dev" style="color:#FD0E33;font-weight:800;">Open the Command Centre →</a></p>
<div style="color:#8A93A1;font-size:11px;border-top:1px solid #E1E7EC;margin-top:18px;padding-top:8px;">Automated daily digest from the CMAC Operations Command Centre.</div>
</div>`;
  return { html, total };
}

async function loadWorkspaceDoc(env) {
  const supabaseUrl = env.SUPABASE_URL || "https://lvbqsiycvsvadkowjequ.supabase.co";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  const r = await fetch(supabaseUrl + "/rest/v1/shared_workspace?id=eq.main&select=data", {
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.data || null;
}

async function sendDigest(env) {
  if (!env.RESEND_API_KEY) return; // digest not configured — quietly skip
  const doc = await loadWorkspaceDoc(env);
  if (!doc) return;
  const { html, total } = buildDigest(doc);
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.RESEND_API_KEY },
    body: JSON.stringify({
      from: env.DIGEST_FROM || "CMAC Command Centre <onboarding@resend.dev>",
      to: [env.DIGEST_TO || "paul.wardle@cmacgroup.com"],
      subject: total ? `Morning brief — ${total} item(s) need attention` : "Morning brief — all clear",
      html,
    }),
  });
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDigest(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/digest/preview") {
      // Admin-only in-browser preview of the digest email.
      const supabaseUrl = env.SUPABASE_URL || "https://lvbqsiycvsvadkowjequ.supabase.co";
      const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceKey) return json({ error: "Not configured (missing SUPABASE_SERVICE_ROLE_KEY)." }, 503);
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
      const meRes = await fetch(supabaseUrl + "/auth/v1/user", { headers: { Authorization: "Bearer " + token, apikey: serviceKey } });
      if (!meRes.ok) return json({ error: "Sign in first, then open this from the app." }, 401);
      const me = await meRes.json();
      const profRes = await fetch(supabaseUrl + "/rest/v1/profiles?user_id=eq." + encodeURIComponent(me.id) + "&select=role,status",
        { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } });
      const p = (profRes.ok ? await profRes.json() : [])[0];
      if (!p || p.role !== "admin" || p.status !== "approved") return json({ error: "Admins only." }, 403);
      const doc = await loadWorkspaceDoc(env);
      if (!doc) return json({ error: "No workspace found." }, 404);
      return new Response(buildDigest(doc).html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
    }

    if (url.pathname === "/api/ai") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
      }
      return handleAI(request, env);
    }

    if (url.pathname === "/api/admin/reset-password") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
      }
      return handleAdminResetPassword(request, env);
    }

    // Everything else is served from the built SPA (with SPA fallback to
    // index.html via the assets `not_found_handling` setting).
    return env.ASSETS.fetch(request);
  },
};
