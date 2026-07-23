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

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
    });
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
