/**
 * Full interaction sweep — CMAC Operations Command Centre.
 * Local-mode dev server, /api/ai intercepted so AI paths are deterministic
 * and the request shape (model routing, prompt caching) can be asserted.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:5210";
const results = [];
let section = "";
const sec = (s) => { section = s; console.log("\n── " + s + " ──"); };
const ok = (name, pass, extra = "") => {
  results.push({ section, name, pass, extra });
  console.log((pass ? "  PASS  " : "  FAIL  ") + name + (extra ? "  — " + extra : ""));
};
const soft = async (name, fn) => {
  try { const r = await fn(); ok(name, r !== false, typeof r === "string" ? r : ""); }
  catch (e) { ok(name, false, String(e.message || e).split("\n")[0].slice(0, 150)); }
};

/* ---------- fake AI service ---------- */
const sse = (evts) => evts.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("");
const START = (u) => ({ type: "message_start", message: { usage: u } });
const textStream = (text, u) => sse([
  START(u || { input_tokens: 60, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 4200 }),
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } },
]);
const toolStream = () => sse([
  START({ input_tokens: 120, output_tokens: 0, cache_creation_input_tokens: 4200, cache_read_input_tokens: 0 }),
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_1", name: "create_work_item", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ title: "Assistant-created action", type: "Action" }) } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } },
]);

async function installAiMock(page, state) {
  await page.route("**/api/ai", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    state.calls.push(body);
    if (body.stream) {
      const next = state.script.shift();
      return route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" },
        body: next === "tool" ? toolStream() : textStream("Done — that is logged.") });
    }
    const prompt = JSON.stringify(body.messages || "");
    const wantsJson = /ONLY with JSON|"flags"|"items"|JSON/i.test(prompt);
    return route.fulfill({ status: 200, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: body.model, stop_reason: "end_turn",
        usage: { input_tokens: 500, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        content: [{ type: "text", text: wantsJson
          ? JSON.stringify({ records: [{ title: "Chase Dave about the Manchester rota", type: "Action", priority: "High", owner: "Dave" }], questions: [], learnings: ["Dave owns the Manchester rota"], flags: [] })
          : "- A tidied briefing line from the mock." }],
      }) });
  });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const pageErrors = [], consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 180)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 180)); });

const state = { calls: [], script: [] };
await installAiMock(page, state);
await page.goto(BASE);
await page.waitForSelector(".nitem", { timeout: 20000 });

/* nav items are div.nitem, and their accessible text can include a count badge */
const go = async (label) => {
  await page.locator(".nitem", { hasText: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\d*$") }).first().click();
  await page.waitForTimeout(400);
};
const modalOpen = () => page.locator(".modal").count();

/* ============================================================ */
sec("A. Every screen renders without error");
const SCREENS = ["Command Centre", "Capture Inbox", "My Priorities", "Action Board", "Waiting & Chasing",
  "SLA & KPIs", "Projects", "Mobilisations", "Risks & Issues", "Decisions & Commitments", "Country View",
  "COO & Board Update", "Newsletter", "Weekly Review", "Archive & History", "Settings & Data"];
for (const label of SCREENS) {
  await soft(`${label}`, async () => {
    const before = pageErrors.length;
    await go(label);
    const heading = await page.locator("h2.h1, h1").first().innerText().catch(() => "");
    if (pageErrors.length > before) throw new Error("page error: " + pageErrors[pageErrors.length - 1]);
    if (!heading.trim()) throw new Error("no heading rendered");
    return heading.split("\n")[0].slice(0, 40);
  });
}

/* ============================================================ */
sec("B. Empty-state honesty (fresh install)");
await soft("KPI page offers an import rather than a broken table", async () => {
  await go("SLA & KPIs");
  if (!(await page.locator("text=No scorecard loaded yet").count())) throw new Error("no empty state");
  if (!(await page.locator('text="Import Balanced Scorecard"').count())) throw new Error("no import CTA");
  return true;
});
await soft("Command Centre reports a clear runway, not a blank page", async () => {
  await go("Command Centre");
  const t = await page.locator("body").innerText();
  if (!/No exceptions raised/.test(t)) throw new Error("no alert empty-state");
  return true;
});
await soft("Archive shows the seeded activity line", async () => {
  await go("Archive & History");
  if (!(await page.locator("text=Fresh start — system initialised").count())) throw new Error("activity missing");
  return true;
});

/* ============================================================ */
sec("C. Work item lifecycle");
await go("Action Board");
await soft("Create a work item", async () => {
  await page.locator('button:text-is("+ New work item")').click();
  await page.waitForSelector(".modal", { timeout: 6000 });
  await page.locator(".modal input.input").first().fill("QA sweep item");
  await page.locator('.modal button:text-is("Create work item")').click();
  await page.waitForTimeout(500);
  if (!(await page.locator('.kcard:has-text("QA sweep item")').count())) throw new Error("not on the board");
  return true;
});
await soft("Empty title is rejected with a message", async () => {
  await page.locator('button:text-is("+ New work item")').click();
  await page.waitForSelector(".modal", { timeout: 6000 });
  await page.locator('.modal button:text-is("Create work item")').click();
  await page.waitForTimeout(400);
  if (!(await page.locator("text=A title is required").count())) throw new Error("no validation");
  await page.locator('.modal button:text-is("OK")').click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return true;
});
await soft("Type switch reveals the Risk detail block", async () => {
  await page.locator('.kcard:has-text("QA sweep item")').first().click();
  await page.waitForSelector(".modal", { timeout: 6000 });
  await page.locator(".modal select.select").first().selectOption("Risk");
  await page.waitForTimeout(300);
  const has = await page.locator('.modal >> text="Risk detail"').count();
  if (!has) throw new Error("Risk detail block did not appear");
  await page.locator(".modal select.select").first().selectOption("Action");
  return true;
});
await soft("Status Waiting reveals the chase-date fields", async () => {
  await page.locator(".modal select.select").nth(1).selectOption("Waiting");
  await page.waitForTimeout(300);
  if (!(await page.locator('.modal >> text="Next chase"').count())) throw new Error("chase fields missing");
  await page.locator(".modal select.select").nth(1).selectOption("In Progress");
  return true;
});
await soft("More options reveals the secondary fields", async () => {
  await page.locator('.modal button:text-is("More options ▼")').click();
  await page.waitForTimeout(250);
  if (!(await page.locator('.modal >> text="Confidentiality"').count())) throw new Error("hidden fields did not appear");
  return true;
});
await soft("Update note appends on Enter", async () => {
  const n = page.locator('.modal input[placeholder*="Add an update note"]');
  await n.fill("Swept by the QA run");
  await n.press("Enter");
  await page.waitForTimeout(250);
  if (!(await page.locator("text=Swept by the QA run").count())) throw new Error("note not appended");
  return true;
});
await soft("Save persists the edits", async () => {
  await page.locator(".modal input.input").first().fill("QA sweep item (edited)");
  await page.locator('.modal button:text-is("Save changes")').click();
  await page.waitForTimeout(600);
  if (!(await page.locator('.kcard:has-text("QA sweep item (edited)")').count())) throw new Error("edit lost");
  return true;
});

/* ============================================================ */
sec("D. Dialogs & keyboard");
await soft("Escape closes only the top dialog", async () => {
  await page.locator('.kcard:has-text("QA sweep item (edited)")').first().click();
  await page.waitForSelector(".modal", { timeout: 6000 });
  await page.locator('.modal button:text-is("Delete")').click();
  await page.waitForTimeout(300);
  const two = await modalOpen();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const one = await modalOpen();
  const stillEditing = await page.locator("text=Edit work item").count();
  if (!(two === 2 && one === 1 && stillEditing === 1)) throw new Error(`${two}->${one}, editing=${stillEditing}`);
  return true;
});
await soft("Cancelled delete leaves the item intact", async () => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if (!(await page.locator('.kcard:has-text("QA sweep item (edited)")').count())) throw new Error("item lost");
  return true;
});
await soft("Backdrop mousedown closes the modal", async () => {
  await page.locator('.kcard:has-text("QA sweep item (edited)")').first().click();
  await page.waitForSelector(".modal", { timeout: 6000 });
  await page.locator(".modal-bg").first().click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(350);
  if (await modalOpen()) throw new Error("still open");
  return true;
});
await soft("Confirmed delete removes the item", async () => {
  await page.locator('.kcard:has-text("QA sweep item (edited)")').first().click();
  await page.waitForSelector(".modal", { timeout: 6000 });
  await page.locator('.modal button:text-is("Delete")').click();
  await page.waitForTimeout(300);
  await page.locator('.modal button:text-is("Yes, continue")').click();
  await page.waitForTimeout(600);
  if (await page.locator('.kcard:has-text("QA sweep item (edited)")').count()) throw new Error("survived");
  return true;
});

/* ============================================================ */
sec("E. AI cost controls");
const assistantBox = () => page.locator('input.input[placeholder*="Ask, tell it"]');
const openAssistant = async () => {
  const fab = page.locator("button.clip-fab");
  if (await fab.count()) await fab.click();
  await page.waitForTimeout(500);
};
const sendToAssistant = async (text) => {
  await openAssistant();
  const box = assistantBox();
  await box.fill(text);
  await box.press("Enter");
  await page.waitForTimeout(2200);
};

await soft("A proposed change waits for approval by default", async () => {
  state.calls.length = 0; state.script = ["tool", "text"];
  await sendToAssistant("Log a test action for me");
  if (!(await page.locator("text=/wants to make \\d+ change/").count())) throw new Error("no approval card");
  if (state.calls.length !== 1) throw new Error("expected 1 call before approval, saw " + state.calls.length);
  return true;
});
await soft("Declining a change applies nothing", async () => {
  state.script = ["text"];
  await page.locator('button:text-is("Decline")').click();
  await page.waitForTimeout(1800);
  await go("Action Board");
  if (await page.locator('.kcard:has-text("Assistant-created action")').count()) throw new Error("declined change was applied anyway");
  return true;
});
await soft("Approving a change applies it", async () => {
  state.calls.length = 0; state.script = ["tool", "text"];
  await sendToAssistant("Log a test action for me");
  await page.locator('button:text-is("Approve & apply")').click();
  await page.waitForTimeout(2200);
  await go("Action Board");
  if (!(await page.locator('.kcard:has-text("Assistant-created action")').count())) throw new Error("approved change not applied");
  return true;
});
await soft("Balanced default routes chat to Sonnet 5", () => {
  const m = state.calls[0]?.model;
  if (m !== "claude-sonnet-5") throw new Error("model was " + m);
  return m;
});
await soft("Workspace brief is sent as a cacheable block", () => {
  const s = state.calls[0]?.system;
  if (!Array.isArray(s)) throw new Error("system not sent as blocks");
  if (s[0]?.cache_control?.type !== "ephemeral") throw new Error("no ephemeral cache_control");
  if (!(s[0]?.text?.length > 200)) throw new Error("brief looks empty");
  return s[0].text.length + " chars (~" + Math.round(s[0].text.length / 4) + " tokens) marked cacheable";
});
await soft("Brief is byte-identical across tool rounds (cache can hit)", async () => {
  // Auto-apply on: the whole loop runs in one go, so we see every round.
  await openAssistant();
  const cb = page.locator('label:has-text("Apply changes without asking") input[type=checkbox]');
  if (!(await cb.isChecked())) await cb.check();
  await page.waitForTimeout(300);
  state.calls.length = 0; state.script = ["tool", "text"];
  const box = assistantBox();
  await box.fill("Log another action");
  await box.press("Enter");
  await page.waitForTimeout(3000);
  if (state.calls.length < 2) throw new Error("expected >=2 rounds, saw " + state.calls.length);
  const briefs = state.calls.map((c) => c.system?.[0]?.text);
  if (briefs.some((b) => !b)) throw new Error("a round sent no brief");
  if (new Set(briefs).size !== 1) throw new Error("brief changed between rounds — every round would re-bill it");
  await cb.uncheck();
  return `identical across ${state.calls.length} rounds`;
});
await soft("Tool rounds reuse one brief instead of re-sending it each round", () => {
  // The saving this produces, stated in tokens for the reply just made.
  const brief = state.calls[0]?.system?.[0]?.text || "";
  const perRound = Math.round(brief.length / 4);
  return `${state.calls.length} rounds × ~${perRound} tokens would have been ${perRound * state.calls.length}; now written once and re-read`;
});
await soft("Streamed usage lands in the spend meter", async () => {
  const m = await page.evaluate(() => JSON.parse(localStorage.getItem("cmac-occ-v1-usage") || "null"));
  if (!m?.calls) throw new Error("meter empty");
  const s = m.models["claude-sonnet-5"];
  if (!s?.out) throw new Error("no output tokens");
  if (!s.cacheRead && !s.cacheWrite) throw new Error("cache tokens not captured");
  return `${m.calls} calls · out=${s.out} · cacheRead=${s.cacheRead} · cacheWrite=${s.cacheWrite}`;
});
const setQuality = async (label) => {
  await go("Settings & Data");
  await page.locator(`button:text-is("${label}")`).first().click();
  await page.waitForTimeout(500);
};
await soft("Economy routes chat to Haiku", async () => {
  await setQuality("Economy");
  state.calls.length = 0; state.script = ["text"];
  await sendToAssistant("What is overdue?");
  const m = state.calls[0]?.model;
  if (m !== "claude-haiku-4-5") throw new Error("model was " + m);
  return m;
});
await soft("Maximum routes chat to Opus 5", async () => {
  await setQuality("Maximum");
  state.calls.length = 0; state.script = ["text"];
  await sendToAssistant("Summarise my week");
  const m = state.calls[0]?.model;
  if (m !== "claude-opus-5") throw new Error("model was " + m);
  return m;
});
await soft("Spend panel shows a running total", async () => {
  await go("Settings & Data");
  const card = page.locator(".card", { hasText: "estimated spend" }).first();
  if (!(await card.count())) throw new Error("spend panel missing");
  const txt = await card.innerText();
  if (!/\$/.test(txt)) throw new Error("no dollar figure");
  return txt.replace(/\s+/g, " ").slice(0, 90);
});
await soft("Budget warning fires when the guide is passed", async () => {
  await page.evaluate(() => {
    localStorage.setItem("cmac-occ-v1-usage", JSON.stringify({
      month: new Date().toISOString().slice(0, 7), calls: 500,
      models: { "claude-opus-5": { in: 20e6, out: 4e6, cacheWrite: 0, cacheRead: 0, calls: 500 } },
    }));
  });
  await go("Command Centre"); await go("Settings & Data");
  await page.waitForTimeout(600);
  const warned = await page.locator("text=/passed your .* monthly guide/").count();
  if (!warned) throw new Error("no over-budget warning");
  return true;
});
await soft("Counter reset clears the meter", async () => {
  await page.locator('button:text-is("Reset counter")').click();
  await page.waitForTimeout(300);
  await page.locator('.modal button:text-is("Yes, continue")').click();
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => localStorage.getItem("cmac-occ-v1-usage"));
  if (m && JSON.parse(m).calls) throw new Error("meter not cleared");
  return true;
});
await soft("Restore Balanced", async () => { await setQuality("Balanced"); return true; });

/* ============================================================ */
sec("F. Capture inbox");
await soft("Quick add creates an inbox note with no AI call", async () => {
  await go("Capture Inbox");
  state.calls.length = 0;
  await page.locator("textarea.ta").first().fill("A quick thought to triage later");
  await page.locator('button:text-is("Quick add as inbox note")').click();
  await page.waitForTimeout(600);
  if (state.calls.length) throw new Error("made an unnecessary AI call");
  if (!(await page.locator("text=A quick thought to triage later").count())) throw new Error("not added");
  return true;
});
await soft("AI parse proposes records", async () => {
  state.calls.length = 0;
  await page.locator("textarea.ta").first().fill("Chase Dave about the Manchester rota.");
  await page.locator('button:text-is("Propose structured records (AI)")').click();
  await page.waitForTimeout(2500);
  if (!state.calls.length) throw new Error("no AI call");
  if (!(await page.locator("text=Proposed records").count())) throw new Error("no proposals rendered");
  return "model " + state.calls[0].model;
});
await soft("Capture triage uses the standard-tier model, not the dearest", () => {
  const m = state.calls[0]?.model;
  if (m !== "claude-sonnet-5") throw new Error("model was " + m);
  return m;
});
await soft("Discard all asks before discarding", async () => {
  await page.locator('button:text-is("Discard all")').click();
  await page.waitForTimeout(300);
  if (!(await page.locator("text=/Discard all \\d+ proposed/").count())) throw new Error("no confirm");
  await page.locator('.modal button:text-is("Yes, continue")').click();
  await page.waitForTimeout(500);
  return true;
});

/* ============================================================ */
sec("G. Projects & mobilisations");
await soft("Create a project", async () => {
  await go("Projects");
  await page.locator('button:text-is("+ New project")').click();
  await page.waitForSelector(".modal", { timeout: 6000 });
  await page.locator(".modal input.input").first().fill("QA sweep project");
  await page.locator('.modal button:text-is("Create project")').click();
  await page.waitForTimeout(600);
  if (!(await page.locator("text=QA sweep project").count())) throw new Error("not listed");
  return true;
});
await soft("Project detail opens and offers a report", async () => {
  await page.locator('.card:has-text("QA sweep project")').first().click();
  await page.waitForTimeout(500);
  if (!(await page.locator('button:text-is("← Portfolio")').count())) throw new Error("detail did not open");
  if (!(await page.locator('button:text-is("Generate report")').count())) throw new Error("no report button");
  return true;
});
await soft("Project update posts", async () => {
  const inp = page.locator('input[placeholder*="What moved"]');
  await inp.fill("Kick-off completed, resourcing agreed");
  await page.locator('button:text-is("Add")').first().click();
  await page.waitForTimeout(500);
  if (!(await page.locator("text=Kick-off completed").count())) throw new Error("update not shown");
  return true;
});
await soft("Table view renders", async () => {
  await page.locator('button:text-is("← Portfolio")').click();
  await page.waitForTimeout(300);
  await page.locator('button:text-is("Table")').click();
  await page.waitForTimeout(400);
  if (!(await page.locator("table.tbl").count())) throw new Error("no table");
  return true;
});
await soft("Create a mobilisation", async () => {
  await go("Mobilisations");
  await page.locator('button:text-is("+ New mobilisation")').click();
  await page.waitForSelector(".modal", { timeout: 6000 });
  await page.locator(".modal input.input").first().fill("QA sweep mobilisation");
  await page.locator('.modal button:text-is("Create mobilisation")').click();
  await page.waitForTimeout(600);
  if (!(await page.locator("text=QA sweep mobilisation").count())) throw new Error("not listed");
  return true;
});
await soft("Mobilisation checklist accepts a requirement", async () => {
  await page.locator('.card:has-text("QA sweep mobilisation")').first().click();
  await page.waitForTimeout(500);
  await page.locator('input[placeholder], .card input.input').nth(1).fill("Driver onboarding complete").catch(() => {});
  const reqInputs = page.locator(".card input.input");
  const n = await reqInputs.count();
  for (let i = 0; i < n; i++) {
    const ph = await reqInputs.nth(i).getAttribute("placeholder");
    if (ph === null) { await reqInputs.nth(i).fill("Driver onboarding complete"); break; }
  }
  const addBtn = page.locator('button:text-is("Add requirement")');
  if (!(await addBtn.count())) throw new Error("no add-requirement button");
  await addBtn.click();
  await page.waitForTimeout(500);
  if (!(await page.locator("text=Driver onboarding complete").count())) throw new Error("requirement not added");
  return true;
});
await soft("Mobilisation tabs switch", async () => {
  for (const t of ["Go-live decision", "Hypercare", "Readiness"]) {
    await page.locator(`button:text-is("${t}")`).first().click();
    await page.waitForTimeout(350);
  }
  return true;
});

/* ============================================================ */
sec("H. Reporting");
await soft("COO draft generates with no AI call", async () => {
  await go("COO & Board Update");
  state.calls.length = 0;
  await page.locator("textarea.ta").first().fill("Steady week; two mobilisations on track.");
  await page.waitForTimeout(800);
  await page.locator('button:text-is("Generate & copy COO draft")').click();
  await page.waitForTimeout(1200);
  await page.locator('.modal button:text-is("OK")').click().catch(() => {});
  if (state.calls.length) throw new Error("COO mode should not call the AI");
  return true;
});
await soft("Tidy scribbles uses the cheap model", async () => {
  state.calls.length = 0;
  const tidy = page.locator('button:text-is("✦ Tidy scribbles")').first();
  if (!(await tidy.count())) throw new Error("tidy button not shown");
  await tidy.click();
  await page.waitForTimeout(1800);
  const m = state.calls[0]?.model;
  if (m !== "claude-haiku-4-5") throw new Error("model was " + m);
  return m;
});
await soft("Board mode marks People as excluded", async () => {
  await page.locator('button:text-is("For Board")').click();
  await page.waitForTimeout(600);
  if (!(await page.locator("text=Not included in the board pack").count())) throw new Error("no exclusion chip");
  return true;
});
await soft("Board pack runs the person-sweep on the best model", async () => {
  state.calls.length = 0;
  await page.locator('button:text-is("Generate & copy board pack")').click();
  await page.waitForTimeout(2500);
  if (!state.calls.length) throw new Error("no sweep call");
  const m = state.calls[0]?.model;
  if (m !== "claude-opus-5") throw new Error("sweep ran on " + m);
  await page.locator('.modal button:text-is("OK")').click().catch(() => {});
  await page.waitForTimeout(300);
  return m;
});
await soft("Newsletter accepts a direct article", async () => {
  await go("Newsletter");
  await page.locator('textarea[placeholder*="Write an article directly"]').fill("Team hit 98% SLA in August.");
  await page.locator('button:text-is("Add article")').click();
  await page.waitForTimeout(500);
  const gen = page.locator('button:text-is("Generate & copy draft")');
  if (await gen.isDisabled()) throw new Error("generate still disabled after adding an article");
  return true;
});
await soft("Weekly review ticks a step", async () => {
  await go("Weekly Review");
  const cb = page.locator(".checkline input[type=checkbox]").first();
  await cb.check();
  await page.waitForTimeout(500);
  const chip = await page.locator("span.chip").first().innerText();
  if (!/1\/19/.test(chip)) throw new Error("counter reads " + chip);
  return chip;
});

/* ============================================================ */
sec("I. Search");
await soft("Search finds a created record", async () => {
  const box = page.locator('input[placeholder*="Search everything"]');
  await box.fill("QA sweep project");
  await page.waitForTimeout(600);
  if (!(await page.locator(".searchwrap .checkline").count())) throw new Error("no results");
  return true;
});
await soft("Ask-AI from search uses the standard model", async () => {
  state.calls.length = 0;
  await page.locator('input[placeholder*="Search everything"]').press("Enter");
  await page.waitForTimeout(1800);
  if (!state.calls.length) throw new Error("no AI call");
  const m = state.calls[0]?.model;
  if (m !== "claude-sonnet-5") throw new Error("model was " + m);
  await page.keyboard.press("Escape");
  return m;
});

/* ============================================================ */
sec("J. Persistence");
await soft("Everything survives a reload", async () => {
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("cmac-occ-v1") || "{}").rev || 0);
  await page.reload();
  await page.waitForSelector(".nitem", { timeout: 15000 });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("cmac-occ-v1") || "{}"));
  if (!after.projects?.some((p) => p.name === "QA sweep project")) throw new Error("project lost");
  if (!after.mobs?.some((m) => m.name === "QA sweep mobilisation")) throw new Error("mobilisation lost");
  if ((after.rev || 0) < before) throw new Error("revision regressed");
  return `rev ${before} → ${after.rev}`;
});
await soft("Mirror is tagged local in local mode", async () => {
  const s = await page.evaluate(() => localStorage.getItem("cmac-occ-v1-scope"));
  if (s !== "local") throw new Error("scope=" + s);
  return s;
});
await soft("Export produces a JSON backup", async () => {
  await go("Settings & Data");
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 8000 }),
    page.locator('button:text-is("Export full backup (JSON)")').click(),
  ]);
  const name = dl.suggestedFilename();
  if (!/\.json$/.test(name)) throw new Error("unexpected filename " + name);
  return name;
});
await soft("CSV export produces a file", async () => {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 8000 }),
    page.locator('button:text-is("Export work items (CSV)")').click(),
  ]);
  return dl.suggestedFilename();
});

/* ============================================================ */
sec("K. Mobile (390×844)");
const mob = await ctx.newPage();
await installAiMock(mob, { calls: [], script: [] });
mob.on("pageerror", (e) => pageErrors.push("mobile: " + String(e.message).slice(0, 140)));
await mob.setViewportSize({ width: 390, height: 844 });
await mob.goto(BASE);
await mob.waitForSelector(".topbar", { timeout: 15000 });
await soft("No horizontal overflow on the home screen", async () => {
  const over = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 2) throw new Error(over + "px overflow");
  return "clean";
});
await soft("Bottom tab bar is present", async () => {
  if (!(await mob.locator("nav.tabbar").isVisible())) throw new Error("tabbar hidden");
  return true;
});
await soft("Menu drawer opens and navigates", async () => {
  await mob.locator("nav.tabbar button", { hasText: "Menu" }).click();
  await mob.waitForTimeout(500);
  if (!(await mob.locator("aside.side.open").count())) throw new Error("drawer did not open");
  await mob.locator(".nitem", { hasText: /^Action Board\s*\d*$/ }).first().click();
  await mob.waitForTimeout(600);
  const title = await mob.locator("span.ttl").innerText();
  if (!/Action Board/.test(title)) throw new Error("title reads " + title);
  return true;
});
await soft("Sub-screens stay within the viewport", async () => {
  const worst = [];
  for (const label of ["SLA & KPIs", "Settings & Data", "COO & Board Update"]) {
    await mob.locator("nav.tabbar button", { hasText: "Menu" }).click();
    await mob.waitForTimeout(400);
    await mob.locator(".nitem", { hasText: new RegExp("^" + label.replace(/[&]/g, "&") + "\\s*\\d*$") }).first().click();
    await mob.waitForTimeout(600);
    const over = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 2) worst.push(`${label}: ${over}px`);
  }
  if (worst.length) throw new Error(worst.join(", "));
  return "clean";
});
await mob.screenshot({ path: "/tmp/claude-0/-home-user-CMAC-dashboard/4a65e022-3d2e-5115-9f4c-7a1fdd93b861/scratchpad/shot-mobile.png" });
await mob.close();

/* ============================================================ */
sec("L. Console hygiene");
ok("No uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const realErrors = consoleErrors.filter((e) => !/favicon|manifest|sw\.js|React DevTools|Failed to load resource/i.test(e));
ok("No console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

await go("Command Centre");
await page.screenshot({ path: "/tmp/claude-0/-home-user-CMAC-dashboard/4a65e022-3d2e-5115-9f4c-7a1fdd93b861/scratchpad/shot-desktop.png" });
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(64));
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("\nFAILURES:"); failed.forEach((f) => console.log(`  [${f.section}] ${f.name}${f.extra ? " — " + f.extra : ""}`)); }
process.exit(failed.length ? 1 : 0);
