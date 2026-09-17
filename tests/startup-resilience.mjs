/**
 * Resilience checks for the start-up path — the failure Paul hit when the
 * Supabase project auto-paused: the app sat on the splash forever.
 * Runs against a CLOUD-mode dev server with Supabase deliberately stalled.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:5212";
const results = [];
const ok = (n, p, x = "") => { results.push({ n, p, x }); console.log((p ? "PASS  " : "FAIL  ") + n + (x ? "  — " + x : "")); };
const soft = async (n, fn) => { try { const r = await fn(); ok(n, r !== false, typeof r === "string" ? r : ""); } catch (e) { ok(n, false, String(e.message || e).split("\n")[0].slice(0, 140)); } };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/* A signed-in user is the case that hangs: a fresh visitor gets no session
   back without a network call, so they reach the login screen fine. Someone
   already signed in has a stored token that needs refreshing, and THAT call
   is what stalls when the project is asleep. Seed an expired session so the
   tests reproduce the real failure rather than the easy path. */
const SB_REF = "lvbqsiycvsvadkowjequ";
const expiredSession = {
  access_token: "expired.test.token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) - 3600, // an hour stale
  refresh_token: "test-refresh-token",
  user: { id: "00000000-0000-0000-0000-000000000000", email: "paul.wardle@cmacgroup.com", aud: "authenticated", role: "authenticated" },
};
const seedSession = async (page) => {
  await page.addInitScript(([ref, sess]) => {
    try { localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess)); } catch { /* ignore */ }
  }, [SB_REF, expiredSession]);
};

/* ---------- 1. Splash is genuinely centred ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await seedSession(page);
  // Stall Supabase so the splash stays on screen long enough to measure.
  await page.route("**://*.supabase.co/**", () => { /* never fulfilled */ });
  await page.goto(BASE);
  await page.waitForSelector("text=Starting your command centre", { timeout: 15000 });
  await soft("Splash logo is horizontally centred", async () => {
    const box = await page.locator('img[alt="cmac."]').boundingBox();
    const vw = await page.evaluate(() => window.innerWidth);
    const logoCentre = box.x + box.width / 2;
    const off = Math.abs(logoCentre - vw / 2);
    if (off > 4) throw new Error(`logo centre ${Math.round(logoCentre)}px vs page centre ${vw / 2}px — ${Math.round(off)}px off`);
    return `within ${off.toFixed(1)}px of centre`;
  });
  await soft("Splash caption is centred under the logo", async () => {
    const t = page.locator("text=Starting your command centre");
    const box = await t.boundingBox();
    const vw = await page.evaluate(() => window.innerWidth);
    const off = Math.abs(box.x + box.width / 2 - vw / 2);
    if (off > 4) throw new Error(`${Math.round(off)}px off centre`);
    return `within ${off.toFixed(1)}px`;
  });
  await page.screenshot({ path: "/tmp/claude-0/-home-user-CMAC-dashboard/4a65e022-3d2e-5115-9f4c-7a1fdd93b861/scratchpad/shot-splash.png" });
  await page.close();
}

/* ---------- 2. A stalled Supabase surfaces an error, not an eternal splash ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 140)));
  await seedSession(page);
  await page.route("**://*.supabase.co/**", () => { /* hang every request */ });
  await page.goto(BASE);
  await soft("Splash appears first", async () => {
    await page.waitForSelector("text=Starting your command centre", { timeout: 10000 });
    return true;
  });
  await soft("Gives up within ~15s and explains itself", async () => {
    const t0 = Date.now();
    await page.waitForSelector("text=Can't reach the server", { timeout: 25000 });
    return `recovered after ${((Date.now() - t0) / 1000).toFixed(1)}s`;
  });
  await soft("Offers a retry rather than a dead end", async () => {
    if (!(await page.locator('button:text-is("Try again")').count())) throw new Error("no retry button");
    return true;
  });
  await soft("Explains the likely cause in plain words", async () => {
    const body = await page.locator("body").innerText();
    if (!/gone to sleep|connection drop/i.test(body)) throw new Error("no plain-English cause");
    return true;
  });
  await soft("Retry re-attempts instead of doing nothing", async () => {
    await page.locator('button:text-is("Try again")').click();
    await page.waitForSelector("text=Starting your command centre", { timeout: 5000 });
    return "returns to the splash and tries again";
  });
  await soft("No uncaught errors while failing", () => {
    if (errors.length) throw new Error(errors.slice(0, 2).join(" | "));
    return true;
  });
  await page.screenshot({ path: "/tmp/claude-0/-home-user-CMAC-dashboard/4a65e022-3d2e-5115-9f4c-7a1fdd93b861/scratchpad/shot-offline.png" });
  await page.close();
}

/* ---------- 3. Reachable-but-erroring Supabase still reaches the login ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route("**://*.supabase.co/**", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }));
  await page.goto(BASE);
  await soft("A failing (not hanging) backend still shows the sign-in screen", async () => {
    await page.waitForSelector("text=Operations", { timeout: 20000 });
    const hasForm = await page.locator('input[type="email"]').count();
    if (!hasForm) throw new Error("no sign-in form");
    return true;
  });
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.p);
console.log("\n" + "=".repeat(56));
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("\nFAILURES:"); failed.forEach((f) => console.log("  " + f.n + (f.x ? " — " + f.x : ""))); }
process.exit(failed.length ? 1 : 0);
