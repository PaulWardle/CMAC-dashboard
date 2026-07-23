/**
 * Cloudflare Pages Function — POST /api/ai
 *
 * Server-side proxy to the Anthropic Messages API. The API key lives only in
 * the Cloudflare environment (env.ANTHROPIC_API_KEY) and is never exposed to
 * the browser. The client sends { messages, max_tokens }; the model is chosen
 * here (override with the AI_MODEL environment variable).
 */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function onRequestPost({ request, env }) {
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
    // Pass the Anthropic response through unchanged so the client can read
    // the standard { content: [...] } shape (and surface upstream errors).
    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return json({ error: "Upstream AI request failed: " + String((e && e.message) || e) }, 502);
  }
}

// Only POST is handled above; Cloudflare Pages returns 405 for other methods.
