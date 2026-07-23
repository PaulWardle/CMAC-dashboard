# CMAC Operations Command Centre

One source of truth for an operations director's actions, projects, mobilisations,
risks, decisions and executive reporting — a fast, installable web app that works on
desktop and phone.

Originally built as a single-file Claude Artifact, it is now a full standalone app:

- **Frontend** — React + [Vite](https://vitejs.dev), an installable **PWA** (works offline, add-to-home-screen on phones).
- **Persistence** — [Supabase](https://supabase.com) (Postgres + Auth). Your whole workspace is one Row-Level-Security-isolated JSONB document per user, so it follows you across devices. Falls back to browser `localStorage` when unconfigured.
- **AI** — the Capture inbox parser and "Ask AI" search call Anthropic's Claude through a **server-side proxy** (`/api/ai`) so the API key never touches the browser.
- **Hosting** — a [Cloudflare Worker](https://developers.cloudflare.com/workers/static-assets/) serving the built SPA as static assets, with `/api/ai` handled by the Worker itself (`worker.js`).

---

## Architecture at a glance

```
Browser (React PWA)
  │  loads/saves one JSONB doc  ┌──────────────► Supabase  (Postgres + Auth, RLS)
  │  (src/lib/store.js) ────────┘
  │
  └─ POST /api/ai ──► Cloudflare Worker ──► api.anthropic.com
                      (worker.js — holds ANTHROPIC_API_KEY)
```

The storage layer is a single small adapter (`src/lib/store.js`) — the one seam
between the app and where its data lives.

---

## 1. Local development

```bash
npm install
cp .env.example .env      # then fill in values (all optional for a first run)
npm run dev               # http://localhost:5173
```

With an **empty `.env`** the app runs in **local mode**: no login, data stored in
`localStorage`, AI features return a friendly "not configured" message. Good for a
quick look.

To exercise the real features locally, set the values in `.env`:

| Variable | Purpose | Exposed to browser? |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL | Yes (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key | Yes (public, RLS-gated) |
| `ANTHROPIC_API_KEY` | Claude API key for `/api/ai` | **No — server only** |
| `AI_MODEL` *(optional)* | Model id (default `claude-sonnet-5`) | No |

> `npm run dev` includes a small middleware that serves `/api/ai` locally using
> `ANTHROPIC_API_KEY`, so AI works in dev too. In production that endpoint is the
> Cloudflare Pages Function instead.

Icons are generated (no design tool needed): `npm run gen:icons`. Replace the files
in `public/icons` with real artwork anytime, keeping the same names/sizes.

---

## 2. Supabase setup

1. Create (or choose) a project at [supabase.com](https://supabase.com). A **dedicated project** is recommended so this app has its own database and auth boundary.
2. **Apply the schema.** Open the project's **SQL Editor** and run the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). It creates
   the `workspaces` table, enables RLS, and adds per-user policies. *(Or, with the Supabase CLI: `supabase db push`.)*
3. **Enable email auth.** Auth → Providers → Email. This app uses passwordless
   **magic links** (no passwords stored).
4. **Set the redirect URLs.** Auth → URL Configuration → add your site URL and, under
   Redirect URLs, both `http://localhost:5173` and your production origin
   (e.g. `https://cmac-occ.pages.dev`). Magic links return the user here.
5. **Copy the keys.** Project Settings → API → `Project URL` and the `anon`/publishable
   key → into `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

> The built-in Supabase email sender is rate-limited and can land in spam. For heavy
> use, configure your own SMTP under Auth → Emails.
>
> Free-tier projects pause after ~1 week of inactivity — just restore from the
> dashboard. Because your data is one self-contained schema, migrating to another
> project later is a simple dump/restore + env-var swap.

---

## 3. Deploy to Cloudflare (Workers + static assets)

This deploys as a **Cloudflare Worker** that serves the built SPA and hosts
`/api/ai`. Config is in `wrangler.jsonc`; the build runs `npm run build` then
`npx wrangler deploy`.

1. Push this repo to GitHub (already wired to `PaulWardle/CMAC-dashboard`).
2. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** →
   pick this repo. Set the **build command** to `npm run build` (deploy command
   stays `npx wrangler deploy`).
3. **Match the name.** Ensure the `name` in `wrangler.jsonc` equals your Worker's
   name in Cloudflare — otherwise the deploy targets a different Worker that has no
   env vars. Edit that one line if needed.
4. **Environment variables — mind the split** (this is the #1 gotcha):
   - **Build variables** (available to `npm run build`): `VITE_SUPABASE_URL`,
     `VITE_SUPABASE_ANON_KEY`. These get baked into the client bundle, so they
     *must* be present at build time.
   - **Runtime variables / secrets** (available to the Worker at request time):
     `ANTHROPIC_API_KEY` (as a **Secret**) and optional `AI_MODEL`.
5. Deploy. Copy the `*.workers.dev` URL and add it to Supabase's redirect URLs
   (step 2.4 above).

Local Worker testing: `npm run cf:dev` (builds, then runs `wrangler dev`; put
`ANTHROPIC_API_KEY` in `.dev.vars` — see `.dev.vars.example`).

---

## 4. Install on your phone

Open the deployed site in the phone browser and choose **Add to Home Screen**
(iOS Safari: Share → Add to Home Screen; Android Chrome: ⋮ → Install app). It launches
full-screen like a native app, works offline for the shell, and signs you into the same
cloud data.

---

## Data, backups & security

- **Backups.** Settings → *Export full backup (JSON)* downloads everything; *Import*
  restores it. Take one before big changes and after each board pack.
- **Isolation.** Every row in `workspaces` is gated by RLS to `auth.uid() = user_id`;
  a signed-in user can only ever read/write their own document.
- **Secrets.** The Anthropic key lives only in the Cloudflare Worker's runtime
  environment and is never sent to the browser. Never prefix it with `VITE_`. Never
  commit a real `.env`.
- **Indexing.** `public/robots.txt` discourages search-engine indexing of this internal tool.
- **Hardening.** `public/_headers` sets sensible security headers; a Content-Security-Policy
  is stubbed there (commented) to enable once verified in the browser.

## Project layout

```
worker.js                  Cloudflare Worker — serves the SPA + /api/ai Claude proxy
wrangler.jsonc             Cloudflare Worker config (assets + entry point)
public/                    static assets, icons, manifest, _headers, _redirects
scripts/gen-icons.mjs      dependency-free PWA icon generator
src/
  App.jsx                  the whole application UI
  main.jsx                 entry point
  auth/AuthGate.jsx        magic-link login / local-mode gate
  lib/supabase.js          Supabase client (null when unconfigured)
  lib/auth.js              session helpers
  lib/store.js             persistence adapter (Supabase ⇄ localStorage)
supabase/migrations/       database schema
vite.config.js             Vite + PWA + dev AI proxy
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Local dev server (with local `/api/ai`) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the built site |
| `npm run cf:dev` | Build, then run the Worker locally via `wrangler dev` |
| `npm run gen:icons` | Regenerate PWA icons |
