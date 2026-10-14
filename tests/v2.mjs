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
    ok(n, false, String(e.message || e).replace(/\u001b\[\d+m/g, "").split("\n").filter((l) => l.trim()).slice(0, 8).join(" ⏎ ").slice(0, 600));
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
page.on("console", (m) => { if (m.type() === "error" && !/favicon|manifest|sw\.js|ERR_CERT_AUTHORITY_INVALID|fonts\.googleapis|status of 529/i.test(m.text())) errors.push("console: " + m.text().slice(0, 200)); });

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
const go = async (label) => { await page.locator(".nitem .lbl", { hasText: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }).first().click(); await page.waitForTimeout(400); };

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
  await page.locator("body").click({ position: { x: 700, y: 600 } });
  await page.waitForTimeout(250);
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

await soft("A completed ask leaves Waiting & Chasing", async () => {
  await go("Waiting & Chasing");
  const before = await page.locator(".tbl tbody tr").count();
  if (!before) throw new Error("nothing is waiting, so this proves nothing");
  // Complete the first waiting item from its row.
  await page.locator(".tbl tbody tr td.click").first().click();
  await page.waitForTimeout(600);
  await page.locator('.modal select').nth(1).selectOption("Done");
  await page.locator('button:text-is("Save changes")').click();
  await page.waitForTimeout(800);
  await go("Waiting & Chasing");
  const after = await page.locator(".tbl tbody tr").count();
  if (after >= before) throw new Error(`still ${after} rows (was ${before}) — a delivered ask stays on the chase list forever`);
  return before + " → " + after;
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

/* ---------- ticking things off ---------- */
await soft("A task can be added from the board without a modal", async () => {
  await go("Action Board");
  const col = page.locator('.kcol:has(h4:text-matches("^Not started"))').first();
  const before = await col.locator(".kcard").count();
  await col.locator('.quickadd input').fill("Typed straight onto the board");
  await col.locator('.quickadd input').press("Enter");
  await page.waitForTimeout(900);
  if (await page.locator(".modal").count()) throw new Error("a modal opened");
  if (await col.locator(".kcard").count() !== before + 1) throw new Error("not added");
  return true;
});

await soft("One tick completes it, with no modal", async () => {
  const card = page.locator('.kcard:has-text("Typed straight onto the board")').first();
  const before = await page.locator(".kcol:not(.done) .kcard").count();
  // The board sits in nested scroll containers (page y, lane x), which
  // Playwright's own scroll-into-view will not settle on. Put it in view
  // first, then click it like a person would.
  await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  await card.locator(".tick").click();
  await page.waitForTimeout(900);
  if (await page.locator(".modal").count()) throw new Error("a modal opened — the tick should be the whole interaction");
  const after = await page.locator(".kcol:not(.done) .kcard").count();
  if (after !== before - 1) throw new Error(`board went ${before} -> ${after}`);
  return before + " → " + after;
});

await soft("Un-ticking puts it back", async () => {
  const done = page.locator('.kcol.done .kcard:has-text("Typed straight onto the board") .tick').first();
  if (!(await done.count())) throw new Error("not in Done");
  await done.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  await done.click();
  await page.waitForTimeout(900);
  if (!(await page.locator('.kcol:not(.done) .kcard:has-text("Typed straight onto the board")').count())) throw new Error("it did not come back");
  return true;
});

/* ---------- project hierarchy ---------- */
await soft("A project can be given workstreams, each a project in its own right", async () => {
  await go("Portfolio");
  await page.locator('button:text-is("+ New project")').click();
  await page.waitForSelector(".modal", { timeout: 8000 });
  await page.locator(".modal input.input").first().fill("WhatsApp Integration");
  await page.locator('.modal button:text-is("Create project")').click();
  await page.waitForTimeout(800);
  if (!(await page.locator('button:text-is("+ Workstream")').count())) throw new Error("no + Workstream button on the detail page");
  for (const name of ["Automate driver details", "Large vehicle recruiting"]) {
    await page.locator('button:text-is("+ Workstream")').click();
    await page.waitForSelector(".modal", { timeout: 8000 });
    await page.locator(".modal input.input").first().fill(name);
    await page.locator('.modal button:text-is("Create workstream")').click();
    await page.waitForTimeout(800);
    // Creating a sub-project lands on IT, so go back up via the breadcrumb.
    await page.locator(".crumb").first().click();
    await page.waitForTimeout(600);
  }
  const txt = await page.locator(".h2", { hasText: /^Workstreams/ }).innerText();
  if (!/\(2\)/.test(txt)) throw new Error("expected 2 workstreams, got: " + txt);
  return txt;
});

await soft("A task can be added straight onto a project", async () => {
  await page.locator('.pfrow:has-text("Automate driver details")').first().click();
  await page.waitForTimeout(700);
  await page.locator('.quickadd input').first().fill("Agree the field list with Devs");
  await page.locator('.quickadd input').first().press("Enter");
  await page.waitForTimeout(800);
  if (await page.locator(".modal").count()) throw new Error("a modal opened");
  if (!(await page.locator('text=Agree the field list with Devs').count())) throw new Error("not added to the project");
  // And it ticks off from the table.
  await page.locator('.tbl .tick').first().click();
  await page.waitForTimeout(700);
  if (!(await page.locator(".donerow").count())) throw new Error("ticking in the table did not complete it");
  await page.locator('.tbl .tick').first().click();
  await page.waitForTimeout(500);
  await page.locator(".crumb").first().click();
  await page.waitForTimeout(600);
  return true;
});

await soft("A sub-project opens with its own updates and work items", async () => {
  await page.locator('.pfrow:has-text("Automate driver details")').first().click();
  await page.waitForTimeout(700);
  const h = await page.locator(".h1").first().innerText();
  if (!/Automate driver details/.test(h)) throw new Error("landed on " + h);
  for (const section of ["Add update", "Work items"]) {
    if (!(await page.locator(".h2", { hasText: new RegExp("^" + section) }).count())) throw new Error("no " + section + " section");
  }
  await page.locator('textarea[placeholder*="What moved, where it stands"]').fill("Scoped the flow with Devs");
  await page.locator('button:text-is("Add update")').first().click();
  await page.waitForTimeout(700);
  if (!(await page.locator("text=Scoped the flow with Devs").count())) throw new Error("the strand kept no update of its own");
  return true;
});

await soft("The breadcrumb goes back up to the umbrella", async () => {
  await page.locator(".crumb").first().click();
  await page.waitForTimeout(600);
  const h = await page.locator(".h1").first().innerText();
  if (!/WhatsApp Integration/.test(h)) throw new Error("landed on " + h);
  return true;
});

await soft("Portfolio shows the umbrella, not each strand", async () => {
  await go("Portfolio");
  await page.waitForTimeout(400);
  const umbrella = page.locator('.pfrow:has-text("WhatsApp Integration")');
  if (await umbrella.count() !== 1) throw new Error("expected the umbrella once, got " + (await umbrella.count()));
  if (await page.locator('.pfrow:has-text("Automate driver details")').count()) throw new Error("a strand is listed separately at the top level");
  const chip = await umbrella.locator(".chip.sub").innerText().catch(() => "");
  if (!/2 workstream/.test(chip)) throw new Error("workstream chip reads: " + JSON.stringify(chip));
  return chip;
});

await soft("…and can be expanded to list them", async () => {
  await page.locator('label:has-text("List workstreams separately") input').check();
  await page.waitForTimeout(500);
  const rows = await page.locator(".pfrow").allInnerTexts();
  if (!rows.some((r) => /Automate driver details/.test(r))) throw new Error("strands still hidden");
  if (!rows.some((r) => /under WhatsApp Integration/.test(r))) throw new Error("a strand does not say what it is under");
  await page.locator('label:has-text("List workstreams separately") input').uncheck();
  await page.waitForTimeout(400);
  return true;
});

await soft("A work item can be filed against a strand, and rolls up to the umbrella", async () => {
  await page.locator('.pfrow:has-text("WhatsApp Integration")').first().click();
  await page.waitForTimeout(700);
  await page.locator('button:text-is("+ Work item")').click();
  await page.waitForSelector(".modal", { timeout: 8000 });
  await page.locator('.modal input.input').first().fill("Build the driver details form");
  // Re-point it from the umbrella to the strand. Select by its label, not by
  // index: the field order in this modal has already changed twice. The
  // option text carries tree indentation, so match on value, not label.
  const sel = page.locator('.modal div:has(> label.flab:text-is("Project")) select').first();
  const value = await sel.evaluate((el) => {
    const o = [...el.options].find((x) => x.textContent.includes("Automate driver details"));
    return o ? o.value : "";
  });
  if (!value) throw new Error("the strand is not offered in the project picker");
  await sel.selectOption(value);
  await page.locator('.modal button:text-is("Create work item")').click();
  await page.waitForTimeout(900);
  const hdr = await page.locator(".h2", { hasText: /^Work items/ }).innerText();
  if (!/in workstreams/i.test(hdr)) throw new Error("the umbrella does not account for strand work: " + hdr);
  if (!(await page.locator("text=Build the driver details form").count())) throw new Error("item not shown on the umbrella");
  return hdr;
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

await soft("A meeting keeps its notes, with no processed state to chase", async () => {
  if (await page.locator('.chip', { hasText: /^processed$/ }).count()) throw new Error("a processed chip is still being shown");
  if (await page.locator('button:text-is("Mark unprocessed")').count()) throw new Error("the processed toggle is still there");
  // The notes are still the record.
  const notes = await page.locator("textarea").last().inputValue();
  if (!/Porto/.test(notes)) throw new Error("the notes did not survive: " + notes.slice(0, 60));
  return true;
});

await soft("Nothing nags about meetings anywhere", async () => {
  await go("Meetings");
  const tabs = await page.locator(".vtab").allInnerTexts();
  if (tabs.some((t) => /process/i.test(t))) throw new Error("a To-process tab survives: " + tabs.join("|"));
  if (await page.locator(".warnbox", { hasText: /turned into actions/ }).count()) throw new Error("the unprocessed warning survives");
  await go("Command Centre");
  if (await page.locator(".stat", { hasText: /Meetings to process/ }).count()) throw new Error("the Command Centre tile survives");
  const alerts = await page.locator(".alert-row").allInnerTexts();
  if (alerts.some((t) => /not yet turned into actions/.test(t))) throw new Error("the alert survives");
  return tabs.join(" · ");
});

/* ---------- the wand ---------- */
await soft("The wand turns a mind-dump into an update without saving it first", async () => {
  await go("Portfolio");
  await page.locator('.pfrow:has-text("WhatsApp Integration")').first().click();
  await page.waitForTimeout(700);
  // No capture box on a project page any more — that lives in Capture and Clippy.
  if (await page.locator('.h2', { hasText: /Capture into this/ }).count()) throw new Error("the capture panel is still on the project page");

  const tidy = "WhatsApp integration is done. Rollout to passengers caused a big jump in chats including ones we cannot help with, and the team are unhappy. Need a working group with Business Change and the developers.";
  const wandRoute = async (route) => route.fulfill({ status: 200, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usage: { input_tokens: 800, output_tokens: 90 }, content: [{ type: "text", text: tidy }] }) });
  await page.route("**/api/ai", wandRoute);

  const box = page.locator('.card textarea').first();
  await box.fill("whatsapp done, rollout to pax, loads more chats, some we cant help, team fed up, want working group w BC and devs");
  await page.locator('.wand').last().click();
  await page.waitForTimeout(1500);
  if (!(await page.locator(".wandout").count())) throw new Error("no suggestion returned");
  // The typed words are still the user's until they choose.
  const stillMine = await box.inputValue();
  if (!/cant help/.test(stillMine)) throw new Error("it overwrote what was typed before being asked");
  await page.locator('.wandout button:text-is("Use this")').click();
  await page.waitForTimeout(500);
  if (!/working group with Business Change/.test(await box.inputValue())) throw new Error("Use this did not apply the rewrite");
  await page.unroute("**/api/ai", wandRoute);
  return "tidied on request, not before";
});

await soft("A programme reports its workstreams rather than a made-up percentage", async () => {
  const txt = await page.locator(".card").first().innerText();
  if (/\d+%/.test(txt)) throw new Error("a percentage is being claimed for a programme: " + txt.slice(0, 160));
  if (!/workstream/i.test(txt)) throw new Error("no workstream spread shown: " + txt.slice(0, 160));
  return txt.split("\n").find((l) => /workstream/i.test(l)) || "";
});

await soft("Adding a workstream says 'workstream', not 'project'", async () => {
  await page.locator('button:text-is("+ Workstream")').click();
  await page.waitForTimeout(600);
  const h = await page.locator(".modal .h1").first().innerText();
  if (!/workstream/i.test(h)) throw new Error("the modal is headed: " + h);
  if (!(await page.locator('.modal button:text-is("Create workstream")').count())) throw new Error("the save button still says project");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  return h;
});

/* ---------- the assistant can restructure work ---------- */
const sseOf = (evts) => evts.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("");
const toolCall = (name, input, say) => sseOf([
  { type: "message_start", message: { usage: { input_tokens: 900, output_tokens: 0, cache_creation_input_tokens: 900, cache_read_input_tokens: 0 } } },
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_" + name, name, input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } },
]);
const sayOnly = (text) => sseOf([
  { type: "message_start", message: { usage: { input_tokens: 900, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } },
]);

await soft("The assistant turns a work item into a workstream and removes the item", async () => {
  // A task that is really a strand of a bigger programme.
  await go("Action Board");
  const col = page.locator('.kcol:has(h4:text-matches("^Not started"))').first();
  await col.locator('.quickadd input').fill("Automation driver details");
  await col.locator('.quickadd input').press("Enter");
  await page.waitForTimeout(900);

  const script = [
    toolCall("convert_item_to_project", { title: "Automation driver details", parent: "WhatsApp Integration" }, ""),
    sayOnly("Done — it is now a workstream inside WhatsApp Integration, and the task has gone."),
  ];
  let i = 0;
  const assistantRoute = async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    if (!body.stream) return route.fulfill({ status: 200, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usage: {}, content: [{ type: "text", text: "{}" }] }) });
    return route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: script[Math.min(i++, script.length - 1)] });
  };
  await page.route("**/api/ai", assistantRoute);

  await page.locator(".clip-fab").click();
  await page.waitForTimeout(600);
  await page.locator('label:has-text("Apply changes without asking") input').check();
  await page.locator('textarea, input[placeholder*="Ask, tell it"]').last().fill("the work item for automation driver details is actually a workstream within whatsapp project");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  await page.unroute("**/api/ai", assistantRoute);

  const state = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("cmac-occ-v1"));
    const umb = d.projects.find((x) => x.name === "WhatsApp Integration");
    const made = d.projects.find((x) => x.name === "Automation driver details");
    return {
      item: d.workItems.filter((w) => w.title === "Automation driver details").length,
      project: !!made,
      underUmbrella: !!(made && umb && made.parentId === umb.id),
    };
  });
  if (!state.project) throw new Error("no project was created");
  if (!state.underUmbrella) throw new Error("created, but not as a workstream of WhatsApp Integration");
  if (state.item !== 0) throw new Error("the original work item is still there — a duplicate, which is the bug");
  return "converted, item removed";
});

await soft("An API error shows its reason, not [object Object]", async () => {
  const failRoute = async (route) => route.fulfill({ status: 529, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: { type: "overloaded_error", message: "Overloaded" } }) });
  await page.route("**/api/ai", failRoute);
  await page.locator('textarea, input[placeholder*="Ask, tell it"]').last().fill("anything");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);
  await page.unroute("**/api/ai", failRoute);
  const txt = await page.locator(".aview, .amsg, body").last().innerText();
  if (/\[object Object\]/.test(txt)) throw new Error("still rendering [object Object]");
  if (!/Overloaded/i.test(txt)) throw new Error("the reason is not shown: " + txt.slice(-200));
  return "shows 'Overloaded'";
});

/* ---------- sidebar badges tell the truth ---------- */
await soft("A completed ask stops counting in the Waiting badge", async () => {
  // Create one, then complete it, then check the badge against the screen.
  await go("Action Board");
  const col = page.locator('.kcol:has(h4:text-matches("^Not started"))').first();
  await col.locator('.quickadd input').fill("Badge check item");
  await col.locator('.quickadd input').press("Enter");
  await page.waitForTimeout(800);
  const card = page.locator('.kcard:has-text("Badge check item")').first();
  await card.click();
  await page.waitForTimeout(600);
  await page.locator('.modal div:has(> label.flab:text-is("Waiting on")) input').first().fill("Someone Else");
  await page.locator('button:text-is("Save changes")').click();
  await page.waitForTimeout(900);

  const badgeOf = async (label) => {
    const row = page.locator(".nitem", { has: page.locator(".lbl", { hasText: new RegExp("^" + label + "$") }) }).first();
    const c = row.locator(".cnt");
    return (await c.count()) ? parseInt((await c.innerText()).trim(), 10) || 0 : 0;
  };
  const rowsOn = async () => {
    await go("Waiting & Chasing");
    return page.locator(".tbl tbody tr").count();
  };
  if (await badgeOf("Waiting & Chasing") !== await rowsOn()) throw new Error("badge and screen already disagree while open");

  // Complete it — the badge must drop with the row.
  await go("Waiting & Chasing");
  await page.locator('.tbl tbody tr:has-text("Badge check item") td.click').first().click();
  await page.waitForTimeout(600);
  await page.locator('.modal div:has(> label.flab:text-is("Status")) select').first().selectOption("Done");
  await page.locator('button:text-is("Save changes")').click();
  await page.waitForTimeout(1000);
  const badge = await badgeOf("Waiting & Chasing");
  const rows = await rowsOn();
  if (badge !== rows) throw new Error(`badge says ${badge}, screen shows ${rows} — this is the "1 over an empty page" bug`);
  return `badge ${badge} = ${rows} rows`;
});

await soft("Every sidebar badge matches the screen it points at", async () => {
  const check = async (label, countRows) => {
    const row = page.locator(".nitem", { has: page.locator(".lbl", { hasText: new RegExp("^" + label + "$") }) }).first();
    const c = row.locator(".cnt");
    const badge = (await c.count()) ? parseInt((await c.innerText()).trim(), 10) || 0 : 0;
    await go(label);
    const n = await countRows();
    if (badge !== n) throw new Error(`${label}: badge ${badge} vs ${n} on screen`);
    return `${label} ${badge}`;
  };
  const out = [];
  out.push(await check("Capture", async () => page.locator(".checkline").count()));
  out.push(await check("Waiting & Chasing", async () => page.locator(".tbl tbody tr").count()));
  return out.join(" · ");
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
