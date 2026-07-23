import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Local-dev AI proxy.
 * In production the /api/ai endpoint is served by the Cloudflare Worker
 * (see worker.js). During `vite dev` there is no Worker runtime, so this
 * middleware provides the same endpoint using the ANTHROPIC_API_KEY from your
 * local environment. The key never reaches the browser.
 */
function devAiProxy(env) {
  return {
    name: "cmac-dev-ai-proxy",
    configureServer(server) {
      server.middlewares.use("/api/ai", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("Method Not Allowed");
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          const send = (status, obj) => {
            res.statusCode = status;
            res.setHeader("Content-Type", "application/json");
            res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
          };
          try {
            const parsed = JSON.parse(body || "{}");
            const messages = parsed.messages;
            const maxTokens = Math.min(parsed.max_tokens || 1024, 4096);
            const apiKey = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY;
            if (!apiKey) return send(503, { error: "ANTHROPIC_API_KEY is not set in your local environment (.env)." });
            if (!Array.isArray(messages) || !messages.length) return send(400, { error: "messages are required" });
            const model = process.env.AI_MODEL || env.AI_MODEL || "claude-sonnet-5";
            const payload = { model, max_tokens: maxTokens, messages };
            if (parsed.system) payload.system = String(parsed.system).slice(0, 60000);
            if (Array.isArray(parsed.tools) && parsed.tools.length) payload.tools = parsed.tools.slice(0, 8);
            if (parsed.tool_choice) payload.tool_choice = parsed.tool_choice;
            if (parsed.stream) payload.stream = true;
            const r = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
              body: JSON.stringify(payload),
            });
            if (payload.stream && r.ok && r.body) {
              res.statusCode = r.status;
              res.setHeader("Content-Type", "text/event-stream");
              res.setHeader("Cache-Control", "no-cache");
              const reader = r.body.getReader();
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
              }
              return res.end();
            }
            send(r.status, await r.text());
          } catch (e) {
            send(500, { error: String((e && e.message) || e) });
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      devAiProxy(env),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.png", "icons/apple-touch-icon.png"],
        manifest: {
          name: "CMAC Operations Command Centre",
          short_name: "CMAC OCC",
          description: "Actions, projects, mobilisations and executive reporting in one place.",
          theme_color: "#112138",
          background_color: "#112138",
          display: "standalone",
          orientation: "any",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//],
          // Never let the service worker cache/serve the AI or Supabase endpoints.
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
              handler: "NetworkOnly",
            },
          ],
        },
      }),
    ],
    server: { port: 5173 },
    build: { outDir: "dist", sourcemap: false },
  };
});
