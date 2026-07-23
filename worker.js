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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ai") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
      }
      return handleAI(request, env);
    }

    // Everything else is served from the built SPA (with SPA fallback to
    // index.html via the assets `not_found_handling` setting).
    return env.ASSETS.fetch(request);
  },
};
