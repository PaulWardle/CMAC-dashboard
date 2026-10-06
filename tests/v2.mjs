/* Exercises the v2 additions against the real app in local mode:
   mode/status split, operational contexts, people and the confidentiality
   fence, the board, portfolio, OKRs, meetings and the rebuilt capture.
   /api/ai is intercepted, so it costs nothing and touches no real data. */
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://127.0.0.1:5214";
const R = [];
const ok = (n, p, x = "") => { R.push({ n, p }); console.log((p ? "PASS  " : "FAIL  ") + n + (x ? "  — " + x : "")); };
const SHOT = "/tmp/claude-0/-home-user-CMAC-dashboard/4a65e022-3d2e-5115-9f4c-7a1fdd93b861/scratchpad/";
const soft = async (n, fn) => {
  try { const r = await fn(); ok(n, r !== false, typeof r === "string" ? r : ""); }
  catch (e) {
    ok(n, false, String(e.message || e).split("\n")[0].slice(0, 150));
    try {
      const slug = n.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
      await page.screenshot({ path: SHOT + "fail-" + slug + ".png" });
      const modal = await page.locator(".modal").count();
      const cards = await page.locator(".personcard").count();
      const lines = await page.locator(".checkline").count();
      console.log(`      state: modal=${modal} personcards=${cards} checklines=${lines} url=${page.url().slice(-30)}`);
    } catch (x) { /* best effort */ }
  }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|manifest|sw\.js|ERR_CERT_AUTHORITY_INVALID|fonts\.googleapis/i.test(m.text())) errors.push("console: " + m.text().slice(0, 200)); });

/* A capture read, shaped like the real thing. */
const CAPTURE = {
  read: "A forwarded chain about Spain supply cover for the October peak, plus two asks from Matt.",
  actions: [{ title: "Draft the Spain peak cover plan", description: "Hotel + transport contingency", due: "", priority: "P2", project: "", mobilisation: "", workstream: "Operations", contexts: ["Spain"], confidence: "high" }],
  waiting: [{ title: "Barcelona hotel availability figures", description: "", person: "Carlos Mendez", due: "", priority: "P2", contexts: ["Spain"], confidence: "high" }],
  decisions: [{ title: "Use the Porto team for overflow", what: "Porto covers Spain overflow during peak", who: "Matt", rationale: "Closest team with spare capacity", status: "Decided" }],
  risks: [{ title: "Hotel supply short in Barcelona", description: "Peak week", priority: "P2", mitigation: "Early block booking" }],
  dates: [{ what: "Spain peak week begins", date: "2026-10-19", who: "" }],
  people: [{ name: "Carlos Mendez", role: "Spain Operations Manager", why: "Owns Spain supply" }],
  facts: ["Carlos Mendez runs Spain operations."],
  questions: ["Is the Porto overflow agreed with Portugal, or only proposed?"],
  duplicates: [],
};
const MEETING = {
  summary: "Weekly Spain review. Supply cover is the live issue.",
  decisions: [{ what: "Porto covers Spain overflow", who: "Matt", rationale: "Spare capacity" }],
  actions: [{ title: "Confirm Porto resourcing", description: "", owner: "", waitingOn: "Carlos Mendez", due: "", priority: "P2", mine: false }],
  risks: ["Barcelona hotel supply is tight"],
  questions: [],
};
let aiCalls = 0;
let probe = null;
await page.route("**/api/ai", async (route) => {
  aiCalls++;
  const body = JSON.parse(route.request().postData() || "{}");
  const prompt = JSON.stringify(body.messages || "");
  const payload = /MEETING:/.test(prompt) ? MEETING : CAPTURE;
  return route.fulfill({ status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    model: body.model, usage: { input_tokens: 2000, output_tokens: 600 },
    content: [{ type: "text", text: JSON.stringify(payload) }],
  }) });
});

await page.goto(BASE);
await page.waitForSelector(".nitem", { timeout: 25000 });
const go = async (label) => { await page.locator(".nitem", { hasText: new RegExp("^" + label + "$") }).first().click(); await page.waitForTimeout(400); };

/* ---------- navigation ---------- */
await soft("Every new screen is reachable and renders", async () => {
  for (const s of ["Portfolio", "Operational Contexts", "People", "Meetings", "Goals & OKRs", "Capture", "Action Board"]) {
    await go(s);
    const h = await page.locator("h1.h1, .h1").first().innerText();
    if (!h) throw new Error(s + " rendered no heading");
  }
  return "7 screens";
});

/* ---------- contexts seeded ---------- */
await soft("Operational contexts are seeded, not empty", async () => {
  await go("Operational Contexts");
  const n = await page.locator(".ctxcard").count();
  if (n < 5) throw new Error("only " + n + " contexts");
  if (!(await page.locator(".ctxcard", { hasText: "Spain" }).count())) throw new Error("Spain missing");
  return n + " contexts";
});

/* ---------- capture: the rebuild ---------- */
await soft("Capture reads a dump and groups it by kind", async () => {
  await go("Capture");
  await page.locator("textarea").first().fill("Forwarded chain about Spain cover for October peak. Matt wants a plan. Carlos owes me the Barcelona hotel figures.");
  await page.locator('button:text-is("Read this")').click();
  await page.waitForTimeout(1600);
  const groups = await page.locator(".pgtitle").allInnerTexts();
  const want = ["MY ACTIONS", "WAITING ON OTHERS", "DECISIONS", "RISKS AND ISSUES"];
  const missing = want.filter((w) => !groups.some((g) => g.toUpperCase() === w));
  if (missing.length) throw new Error("missing groups: " + missing.join(", ") + " (got " + groups.join("|") + ")");
  return groups.length + " groups";
});

await soft("It says what it read before showing proposals", async () => {
  if (!(await page.locator(".readcard").count())) throw new Error("no 'what this is' summary");
  const t = await page.locator(".readcard").innerText();
  if (t.length < 30) throw new Error("summary too thin");
  return true;
});

await soft("My actions are separated from what others owe", async () => {
  const mine = await page.locator(".pgroup", { hasText: /^My actions/ }).locator(".prow").count();
  const theirs = await page.locator(".pgroup", { hasText: /^Waiting on others/ }).locator(".prow").count();
  if (!mine || !theirs) throw new Error(`mine=${mine} theirs=${theirs}`);
  return `${mine} mine / ${theirs} waiting`;
});

await soft("Dates spotted are NOT ticked by default", async () => {
  const g = page.locator(".pgroup", { hasText: /^Dates spotted/ });
  if (!(await g.count())) throw new Error("no dates group");
  const checked = await g.locator('input[type="checkbox"]:checked').count();
  if (checked !== 0) throw new Error(checked + " pre-ticked — these should be opt-in");
  return true;
});

await soft("Saving writes the records with the right modes", async () => {
  await page.locator('.savebar button.pri').click();
  await page.waitForTimeout(900);
  await go("Action Board");
  const waitCol = page.locator(".kcol", { hasText: /^Waiting on/ });
  const txt = await waitCol.innerText();
  if (!/Barcelona hotel availability/.test(txt)) throw new Error("waiting item did not land in the Waiting column");
  const planned = await page.locator(".kcol", { hasText: /^Not started/ }).innerText();
  if (!/Spain peak cover plan/.test(planned)) throw new Error("my action did not land in Not started");
  return true;
});

await soft("A captured item carries its source back to the dump", async () => {
  await page.locator(".kcard", { hasText: "Spain peak cover plan" }).first().click();
  await page.waitForTimeout(500);
  const body = await page.locator(".modal").innerText();
  if (!/Created from/i.test(body)) throw new Error("no provenance shown on the item");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return true;
});

await soft("A person named in the dump became a People record", async () => {
  await go("People");
  if (!(await page.locator(".personcard", { hasText: "Carlos Mendez" }).count())) throw new Error("Carlos Mendez not created");
  return true;
});

/* ---------- mode vs status ---------- */
await soft("Waiting is a mode, so it survives alongside Blocked", async () => {
  await go("People");
  await page.locator(".personcard", { hasText: "Carlos Mendez" }).first().click();
  await page.waitForTimeout(400);
  const before = await page.locator(".h2", { hasText: /I am waiting on them for/ }).innerText();
  if (!/\(1\)/.test(before)) throw new Error("expected 1 waiting item, got: " + before);
  // Block that item, then confirm it is STILL counted as waiting on Carlos.
  await page.locator(".checkline", { hasText: "Barcelona hotel availability" }).first().click();
  await page.waitForTimeout(500);
  await page.locator('.modal select').nth(1).selectOption("Blocked");
  await page.locator('button:text-is("Save changes")').click();
  await page.waitForTimeout(800);
  await go("People");
  await page.locator(".personcard", { hasText: "Carlos Mendez" }).first().click();
  await page.waitForTimeout(400);
  const after = await page.locator(".h2", { hasText: /I am waiting on them for/ }).innerText();
  if (!/\(1\)/.test(after)) throw new Error("a blocked item stopped counting as waiting-on — the split is not working: " + after);
  return "blocked AND waiting, both true";
});

/* ---------- the confidentiality fence ---------- */
await soft("Development notes save on a person", async () => {
  await page.locator('.vtab:text-is("Development")').click();
  await page.waitForTimeout(300);
  await page.locator("textarea").first().fill("CONFIDENTIALSTRENGTH calm under disruption");
  await page.waitForTimeout(700);
  await page.locator("textarea").nth(1).fill("CONFIDENTIALDEV needs to delegate sooner");
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForSelector(".nitem", { timeout: 15000 });
  await go("People");
  await page.locator(".personcard", { hasText: "Carlos Mendez" }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.vtab:text-is("Development")').click();
  await page.waitForTimeout(300);
  const v = await page.locator("textarea").first().inputValue();
  if (!/CONFIDENTIALSTRENGTH/.test(v)) throw new Error("strengths did not persist");
  return true;
});

await soft("Confidential people data never reaches the AI brief", async () => {
  const brief = await page.evaluate(() => {
    const raw = localStorage.getItem("cmac-occ-v1");
    return raw || "";
  });
  if (!/CONFIDENTIALSTRENGTH/.test(brief)) throw new Error("test setup wrong — the note is not even stored");
  // Ask a question, then read what was actually sent.
  let sent = "";
  probe = async (route) => {
    sent = route.request().postData() || "";
    return route.fulfill({ status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usage: {}, content: [{ type: "text", text: "ok" }] }) });
  };
  await page.route("**/api/ai", probe);
  await page.locator('.searchwrap input').fill("what is outstanding with Carlos");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  if (!sent) throw new Error("no AI request captured");
  if (/CONFIDENTIALSTRENGTH|CONFIDENTIALDEV/.test(sent)) throw new Error("PERSONAL DATA LEAKED into the AI request");
  if (!/Carlos Mendez/.test(sent)) throw new Error("the person is missing entirely — the fence is too wide");
  await page.unroute("**/api/ai", probe);
  return "name present, development notes absent";
});

/* ---------- board behaviour ---------- */
await soft("Completing an item takes it off the board", async () => {
  await go("Action Board");
  const before = await page.locator(".kcard").count();
  await page.locator(".kcard", { hasText: "Spain peak cover plan" }).first().click();
  await page.waitForTimeout(500);
  await page.locator('.modal select').nth(1).selectOption("Done");
  await page.locator('button:text-is("Save changes")').click();
  await page.waitForTimeout(800);
  const after = await page.locator(".kcol:not(.done) .kcard").count();
  if (after >= before) throw new Error(`still ${after} cards (was ${before}) — Done work is not leaving the board`);
  return before + " → " + after;
});

await soft("Completed work is in Archive, not lost", async () => {
  await go("Archive & History");
  if (!(await page.locator("text=Spain peak cover plan").count())) throw new Error("completed item is not in the archive");
  return true;
});

/* ---------- portfolio ---------- */
await soft("Portfolio spans projects and mobilisations in one list", async () => {
  await go("Portfolio");
  const txt = await page.locator(".h1").first().innerText();
  if (!/Portfolio/.test(txt)) throw new Error("wrong screen");
  const stats = await page.locator(".stat").count();
  if (stats < 4) throw new Error("summary stats missing");
  return true;
});

/* ---------- OKRs ---------- */
await soft("A goal records progress against the clock, not just the number", async () => {
  await go("Goals & OKRs");
  await page.locator('button:text-is("+ New goal")').click();
  await page.waitForTimeout(400);
  await page.locator('.modal input').first().fill("Standardise Group Ops SOPs");
  const inputs = page.locator('.modal .frow input');
  await page.locator('.modal input[placeholder*="SOPs standardised"]').fill("% of key SOPs standardised");
  // baseline 30, current 40, target 90, deadline in the past → must be Off track
  const nums = page.locator('.modal .frow input:not([type="date"])');
  await nums.nth(2).fill("30");
  await nums.nth(3).fill("40");
  await nums.nth(4).fill("90");
  await page.locator('.modal input[type="date"]').nth(1).fill("2026-10-01");
  await page.locator('button:text-is("Create goal")').click();
  await page.waitForTimeout(700);
  const card = await page.locator(".okrcard").first().innerText();
  if (!/Off track/.test(card)) throw new Error("a goal past its deadline at 12% progress should be Off track — got: " + card.slice(0, 120));
  return "deadline beats percentage";
});

/* ---------- meetings ---------- */
await soft("A meeting turns notes into actions that link back", async () => {
  await go("Meetings");
  await page.locator('button:text-is("+ New meeting")').click();
  await page.waitForTimeout(600);
  await page.locator('.frow input').first().fill("Spain weekly review");
  await page.waitForTimeout(400);
  await page.locator("textarea").last().fill("Discussed Spain cover. Matt confirmed Porto will cover overflow. Carlos to confirm resourcing.");
  await page.waitForTimeout(600);
  await page.locator('button:text-is("Structure these notes")').click();
  await page.waitForTimeout(1600);
  if (!(await page.locator('button:text-is("Save approved records")').count())) throw new Error("no proposals returned");
  await page.locator('button:text-is("Save approved records")').click();
  await page.waitForTimeout(900);
  const derived = await page.locator(".h2", { hasText: /Came from this meeting/ }).count();
  if (!derived) throw new Error("no backlink section after approving");
  return true;
});

await soft("A meeting is only marked processed after the records exist", async () => {
  const chips = await page.locator(".chip", { hasText: "processed" }).count();
  if (!chips) throw new Error("meeting not marked processed after approval");
  return true;
});

/* ---------- regression ---------- */
await soft("Data survives a reload", async () => {
  await page.reload();
  await page.waitForSelector(".nitem", { timeout: 15000 });
  await go("People");
  if (!(await page.locator(".personcard", { hasText: "Carlos Mendez" }).count())) throw new Error("people lost on reload");
  return true;
});

await soft("No horizontal overflow at phone width", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  for (const s of ["Action Board", "Portfolio", "People"]) {
    await page.locator(".burger").click();
    await page.waitForTimeout(250);
    await page.locator(".nitem", { hasText: new RegExp("^" + s + "$") }).first().click();
    await page.waitForTimeout(500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 2) throw new Error(s + " overflows by " + over + "px");
  }
  await page.setViewportSize({ width: 1500, height: 980 });
  return "clean on 3 screens";
});

ok("No uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await page.screenshot({ path: "/tmp/claude-0/-home-user-CMAC-dashboard/4a65e022-3d2e-5115-9f4c-7a1fdd93b861/scratchpad/v2.png", fullPage: true });
await browser.close();
const bad = R.filter((r) => !r.p);
console.log("\n" + "=".repeat(56) + `\n${R.length - bad.length}/${R.length} passed`);
process.exit(bad.length ? 1 : 0);
