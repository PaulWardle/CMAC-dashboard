/* Reproduces the three reported failures against the real Capture screen:
   multiple files at once, PDF upload, and .msg email. */
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:5214";
const DIR = "/tmp/claude-0/-home-user-CMAC-dashboard/4a65e022-3d2e-5115-9f4c-7a1fdd93b861/scratchpad/ingest/";
const R = [];
const ok = (n, p, x = "") => { R.push({ n, p, x }); console.log((p ? "PASS  " : "FAIL  ") + n + (x ? "  — " + x : "")); };
const soft = async (n, fn) => { try { const r = await fn(); ok(n, r !== false, typeof r === "string" ? r : ""); } catch (e) { ok(n, false, String(e.message || e).split("\n")[0].slice(0, 150)); } };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });

await page.goto(BASE);
await page.waitForSelector(".nitem", { timeout: 20000 });
await page.locator(".nitem", { hasText: /^Capture Inbox/ }).first().click();
await page.waitForTimeout(500);

const input = page.locator('input[type="file"][multiple]').first();
const chips = () => page.locator("span.chip").filter({ hasText: /\.(txt|csv|pdf|msg|docx|xlsx)/i });
const warn = async () => (await page.locator(".warnbox").count()) ? (await page.locator(".warnbox").first().innerText()) : "";

await soft("Three text files selected together all attach", async () => {
  await input.setInputFiles([DIR + "notes-a.txt", DIR + "notes-b.txt", DIR + "reading.csv"]);
  await page.waitForTimeout(2500);
  const n = await chips().count();
  const w = await warn();
  if (n !== 3) throw new Error("attached " + n + " of 3" + (w ? " · warning: " + w : ""));
  return "3 of 3";
});

await soft("A small PDF attaches", async () => {
  await input.setInputFiles([DIR + "small.pdf"]);
  await page.waitForTimeout(2500);
  const w = await warn();
  const n = await page.locator("span.chip").filter({ hasText: /small\.pdf/ }).count();
  if (!n) throw new Error("PDF chip missing" + (w ? " · warning: " + w : ""));
  return "attached";
});

await soft("A 6MB PDF now attaches", async () => {
  await input.setInputFiles([DIR + "big.pdf"]);
  await page.waitForTimeout(4000);
  const attached = await page.locator("span.chip").filter({ hasText: /big\.pdf/ }).count();
  if (!attached) throw new Error("still rejected: " + (await warn()));
  return "6.1MB accepted";
});

await soft("The picker offers media types, not just extensions", async () => {
  const accept = await input.getAttribute("accept");
  if (!/application\/pdf/.test(accept)) throw new Error("no MIME types — iOS will restrict the picker");
  if (!/image\//.test(accept)) throw new Error("images not offered by type");
  return accept.split(",").filter((a) => a.includes("/")).length + " media types offered";
});

await soft("Going over the attachment limit says which files were skipped", async () => {
  await page.reload();
  await page.waitForSelector(".nitem", { timeout: 15000 });
  await page.locator(".nitem", { hasText: /^Capture Inbox/ }).first().click();
  await page.waitForTimeout(400);
  const inp = page.locator('input[type="file"][multiple]').first();
  const many = Array.from({ length: 5 }, () => DIR + "notes-a.txt");
  await inp.setInputFiles([DIR + "notes-a.txt", DIR + "notes-b.txt", DIR + "reading.csv", DIR + "small.pdf"]);
  await page.waitForTimeout(2500);
  await inp.setInputFiles([DIR + "notes-a.txt", DIR + "notes-b.txt", DIR + "reading.csv", DIR + "small.pdf", DIR + "notes-a.txt"]);
  await page.waitForTimeout(3000);
  const w = await warn();
  if (!w) throw new Error("silently dropped the extra file with no message");
  if (!/not added|at a time/i.test(w)) throw new Error("unclear message: " + w);
  return w.slice(0, 80);
});

await soft("A failed file does not block the ones after it", async () => {
  await page.reload();
  await page.waitForSelector(".nitem", { timeout: 15000 });
  await page.locator(".nitem", { hasText: /^Capture Inbox/ }).first().click();
  await page.waitForTimeout(400);
  const inp = page.locator('input[type="file"][multiple]').first();
  // big.pdf first, then two good files
  await inp.setInputFiles([DIR + "big.pdf", DIR + "notes-a.txt", DIR + "reading.csv"]);
  await page.waitForTimeout(3500);
  const good = await chips().filter({ hasText: /notes-a|reading/ }).count();
  if (good !== 2) throw new Error("only " + good + " of the 2 good files attached after a failure");
  return "2 good files survived a bad one";
});

await soft("No uncaught errors during ingestion", () => {
  const real = errs.filter((e) => !/favicon|manifest|sw\.js|DevTools/i.test(e));
  if (real.length) throw new Error(real.slice(0, 2).join(" | "));
  return true;
});

await page.screenshot({ path: DIR + "shot.png" });
await browser.close();
const bad = R.filter((r) => !r.p);
console.log("\n" + "=".repeat(52) + `\n${R.length - bad.length}/${R.length} passed`);
process.exit(bad.length ? 1 : 0);
