/**
 * Measures the assistant's per-request brief on a REALISTIC workspace, so the
 * caching saving can be quoted as a real number rather than a hope.
 */
import { chromium } from "playwright";
const BASE = "http://localhost:5210";

const pick = (a, i) => a[i % a.length];
const owners = ["Paul Wardle", "Dave Mullen", "Sofia Marques", "Nikos Papadakis", "Elena Ruiz"];
const types = ["Action", "Risk", "Issue", "Decision", "Commitment", "Dependency"];
const statuses = ["Inbox", "Planned", "In Progress", "Waiting", "Blocked", "Review"];

const workItems = Array.from({ length: 60 }, (_, i) => ({
  id: "w" + i, title: `Operational action ${i + 1} — resolve the outstanding ${pick(["rota", "invoice query", "SLA breach", "driver shortfall", "client escalation"], i)}`,
  description: "Longer description of the work required, the background and the constraints.",
  type: pick(types, i), status: pick(statuses, i), priority: pick(["Critical", "High", "Medium", "Low"], i),
  owner: pick(owners, i), waitingOn: i % 4 === 3 ? pick(owners, i + 1) : "", project: "", mob: "",
  country: pick(["UK", "Spain", "Portugal", "Greece"], i), due: "2026-10-0" + ((i % 9) + 1),
  nextAction: "The very next physical step for item " + (i + 1), blocker: i % 7 === 0 ? "Awaiting client sign-off" : "",
  created: "2026-09-01", updatedAt: "2026-09-10", horizon: "Next", rank: 50, notes: [], extra: {},
  flags: { board: i % 5 === 0, coo: i % 3 === 0, news: false, groupWeekly: false, ukWeekly: false },
  confidentiality: "General internal",
}));
const projects = Array.from({ length: 8 }, (_, i) => ({
  id: "p" + i, name: `Project ${["Atlas", "Beacon", "Corvus", "Delta", "Ember", "Forge", "Gallium", "Harbour"][i]}`,
  stage: "In Flight", rag: pick(["Green", "Amber", "Red"], i), progress: 40 + i * 5, owner: pick(owners, i),
  target: "2026-12-01", objective: "Deliver the agreed scope to the client on time and in budget.",
  position: "Currently on track with two open dependencies and a resourcing risk under review.",
  updatedAt: "2026-09-12", country: "UK", workstream: "Operations",
}));
const mobs = Array.from({ length: 4 }, (_, i) => ({
  id: "m" + i, name: `Mobilisation ${i + 1}`, stage: "Build", rag: "Green", goLive: "2026-11-1" + i,
  client: "Client " + (i + 1), updatedAt: "2026-09-11", checklist: [],
}));
const context = {
  org: "CMAC Group provides managed transport solutions across rail, aviation and corporate travel. ".repeat(12),
  people: owners.map((o) => `${o} — senior manager responsible for a country or function.`).join("\n").repeat(3),
  clients: "Key clients and terminology: Minicabit, Ops Portal, T&Q, hotel desk, rail replacement. ".repeat(8),
  rules: "Anything safety-related is Critical and board-flagged. Recruitment belongs to HR. ".repeat(8),
  learned: "• Learned notes accumulated by the assistant over time. ".repeat(20),
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
let brief = null;
await page.route("**/api/ai", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  if (body.stream && body.system) brief = body.system[0].text;
  await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" },
    body: 'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n' +
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n' +
          'data: {"type":"content_block_stop","index":0}\n\n' +
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n' });
});
await page.goto(BASE);
await page.waitForSelector(".nitem", { timeout: 20000 });
await page.evaluate((seed) => {
  const cur = JSON.parse(localStorage.getItem("cmac-occ-v1") || "{}");
  localStorage.setItem("cmac-occ-v1", JSON.stringify({ ...cur, ...seed, rev: (cur.rev || 0) + 1 }));
}, { workItems, projects, mobs, context });
await page.reload();
await page.waitForSelector(".nitem", { timeout: 20000 });
await page.locator("button.clip-fab").click();
await page.waitForTimeout(500);
const box = page.locator('input.input[placeholder*="Ask, tell it"]');
await box.fill("What needs my attention?");
await box.press("Enter");
await page.waitForTimeout(2500);
await browser.close();

if (!brief) { console.log("FAILED to capture a brief"); process.exit(1); }
const chars = brief.length;
const tokens = Math.round(chars / 3.8); // conservative English-prose estimate
console.log(`Realistic workspace: 60 items, 8 projects, 4 mobilisations, full context brief`);
console.log(`Per-request brief: ${chars} chars ≈ ${tokens} tokens`);
console.log(`Above the 1024-token minimum cacheable prefix: ${tokens > 1024 ? "YES — caching applies" : "NO — too small to cache"}`);
const sonnetIn = 2 / 1e6;
const round = tokens * sonnetIn;
console.log(`\nOne 4-round assistant reply on Sonnet 5:`);
console.log(`  before (brief re-sent each round): 4 × ${tokens} = ${4 * tokens} tokens = $${(4 * round).toFixed(4)}`);
const cached = tokens * 1.25 * sonnetIn + 3 * tokens * 0.1 * sonnetIn;
console.log(`  after  (written once, re-read):    $${cached.toFixed(4)}`);
console.log(`  reduction on the brief: ${Math.round((1 - cached / (4 * round)) * 100)}%`);
console.log(`\nSame reply on the previous setup (Opus at $5/M input, no caching): $${(4 * tokens * 5 / 1e6).toFixed(4)}`);
console.log(`Combined reduction vs before: ${Math.round((1 - cached / (4 * tokens * 5 / 1e6)) * 100)}%`);
