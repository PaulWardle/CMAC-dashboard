/* Proves the v1 → v2 migration on a document shaped like the real stored
   one. This is the riskiest code in the change: it runs once, in place,
   against data that cannot be recovered if it gets it wrong. */
import { migrate, isWaiting, isOpen, personLoad, okrHealth, itemAttention, portfolioAttention, dueBadge, subtaskProgress, todayISO,
  childProjects, parentProject, isTopLevel, canParent, projectTree, descendantIds,
  inboxItems, waitingItems,
  PROJECT_STAGES, LEGACY_STAGES } from "../src/lib/model.js";

let fails = 0;
const P = (n, ok, x = "") => { console.log((ok ? "PASS  " : "FAIL  ") + n + (x ? "  — " + x : "")); if (!ok) fails++; };
const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

/* A v1 document: old statuses, old priorities, single country, no contexts,
   no people, owners and waiting-ons as free text. */
const v1 = () => ({
  v: 1,
  settings: { displayName: "Paul Wardle", defaultCountry: "UK", staleItem: 14, staleProject: 21, staleMob: 7 },
  workItems: [
    { id: "a", title: "Spain rota review", status: "Waiting", priority: "High", owner: "Paul Wardle", waitingOn: "Carlos", country: "Spain", due: d(-3), updatedAt: d(-20), created: d(-30), workstream: "Service performance", confidentiality: "General internal", flags: {}, notes: [], extra: {} },
    { id: "b", title: "Board paper", status: "Review", priority: "Critical", owner: "Paul Wardle", waitingOn: "", country: "Group", due: d(2), updatedAt: d(-1), created: d(-5), flags: {}, notes: [], extra: { decisionStatus: "Draft" } },
    { id: "c", title: "Old parked idea", status: "Parked", priority: "Parked", owner: "Me", waitingOn: "", country: "Portugal", updatedAt: d(-60), created: d(-90), flags: {}, notes: [], extra: {} },
    { id: "e", title: "Shipped thing", status: "Done", priority: "Medium", owner: "Paul Wardle", completed: d(-40), updatedAt: d(-40), created: d(-70), country: "Greece", flags: {}, notes: [], extra: {} },
    { id: "f", title: "Hotel contract", status: "Blocked", priority: "High", owner: "Paul Wardle", waitingOn: "Judith", country: "UK", blocker: "legal review", updatedAt: d(-2), created: d(-10), flags: {}, notes: [], extra: {} },
  ],
  projects: [{ id: "p1", name: "Italy entry", stage: "Discovery", workstream: "Client delivery", rag: "Amber", country: "Group", owner: "Paul Wardle", target: d(30), updatedAt: d(-40) }],
  mobs: [{ id: "m1", name: "GWR", stage: "BAU Handover", rag: "Green", country: "UK", goLive: d(12), updatedAt: d(-3), checklist: [] }],
  updates: [{ id: "u1", confidentiality: "Board confidential", flags: {} }],
  benefits: [], lessons: [], meetings: [],
  context: { org: "", people: "", clients: "", rules: "", learned: "" },
});

const { data: m, changed } = migrate(v1());
P("The migration reports that it changed something", changed);
P("Document version advances to 3", m.v === 3);

/* ---------- status and mode ---------- */
const byId = (id) => m.workItems.find((w) => w.id === id);
P("A waiting item keeps its work open", isOpen(byId("a")), "status " + byId("a").status);
P("…and the person holding it moves to the mode", isWaiting(byId("a")));
P("A blocked item ALSO records who it is waiting on", byId("f").status === "Blocked" && isWaiting(byId("f")),
  `${byId("f").status} / ${byId("f").mode}`);
P("An item with nobody named is an Action", byId("b").mode === "Action");
P("Legacy 'Review' becomes In Progress", byId("b").status === "In Progress");
P("Legacy 'Parked' becomes Planned", byId("c").status === "Planned");

/* ---------- priority ---------- */
P("Critical → P1", byId("b").priority === "P1");
P("High → P2", byId("a").priority === "P2");
P("Medium → P3", byId("e").priority === "P3");
P("Parked priority → P5", byId("c").priority === "P5");

/* ---------- contexts ---------- */
P("Contexts are seeded", m.contexts.length >= 8);
const ctxId = (n) => (m.contexts.find((c) => c.name === n) || {}).id;
P("Spain becomes an Operational Context tag", byId("a").contexts.includes(ctxId("Spain")));
P("Greece maps to Greece & Cyprus", byId("e").contexts.includes(ctxId("Greece & Cyprus")));
P("'Group' means no geography, not a ninth one", byId("b").contexts.length === 0);
P("A project carries its context across too", m.projects[0].contexts.map((i) => m.contexts.find((c) => c.id === i).name).join(",") === "Operations", "Group → no geography, workstream → Operations");

/* ---------- people harvested ---------- */
const names = m.people.map((p) => p.name).sort();
P("People are harvested from owners and waiting-ons", names.includes("Carlos") && names.includes("Judith"), names.join(", "));
P("The signed-in user is NOT created as a colleague", !names.includes("Paul Wardle"));
P("The placeholder owner 'Me' is not created as a person", !names.includes("Me"));
P("Every person has the confidential fields initialised", m.people.every((p) => Array.isArray(p.pdr) && "strengths" in p));

/* A department is not a colleague. An owner or waiting-on may name a
   function — that is deliberate — and it must not turn into a person with
   a 1:1, a development note and a PDR. */
const deptDoc = () => ({
  v: 3,
  settings: { displayName: "Paul Wardle", staleItem: 14, staleProject: 21, staleMob: 7 },
  contexts: [
    { id: "cx1", name: "Business Change", type: "Function", active: true },
    { id: "cx2", name: "Supply", type: "Function", active: true },
  ],
  people: [
    /* already filed by the old harvest, untouched since */
    { id: "ph1", name: "Business Change", role: "", func: "", location: "", relationship: "Colleague", managerId: "", contexts: [], oneToOne: "", nextOneToOne: "", strengths: "", development: "", privateNotes: "", pdr: [], notes: [], active: true },
    /* same name, but somebody has actually filled it in — not ours to delete */
    { id: "ph2", name: "Supply", role: "Head of Supply", func: "", location: "", relationship: "Colleague", managerId: "", contexts: [], oneToOne: "", nextOneToOne: "", strengths: "", development: "", privateNotes: "", pdr: [], notes: [], active: true },
  ],
  workItems: [
    { id: "w1", title: "Convene the working group", status: "Blocked", mode: "Waiting on", priority: "P2", owner: "Business Change", waitingOn: "Business Change/Dev", contexts: [], flags: {}, notes: [], extra: {}, updatedAt: d(-2), created: d(-9) },
    { id: "w2", title: "Chase the rota", status: "In Progress", mode: "Waiting on", priority: "P3", owner: "Me", waitingOn: "Louise", contexts: [], flags: {}, notes: [], extra: {}, updatedAt: d(-1), created: d(-4) },
  ],
  projects: [], mobs: [], updates: [], lessons: [], meetings: [], okrs: [], sources: [],
  context: { org: "", people: "", clients: "", rules: "", learned: "" },
});
const dm = migrate(deptDoc()).data;
const dnames = dm.people.map((x) => x.name).sort();
P("A function named as an owner is not created as a person", !dnames.includes("Business Change"), dnames.join(", "));
P("Two parties in one field are not created as a person", !dnames.some((n) => n.includes("/")), dnames.join(", "));
P("A real person named alongside them still is", dnames.includes("Louise"));
P("A department already filed as a colleague is cleared out", !dm.people.some((x) => x.id === "ph1"));
P("A record somebody has actually filled in is left alone", dm.people.some((x) => x.id === "ph2"), "Supply has a job title on it");
P("Re-running the migration changes nothing further", !migrate(JSON.parse(JSON.stringify(dm))).changed);

/* ---------- archive on done ---------- */
P("Completed work is archived off the board", !!byId("e").archivedAt);
P("Open work is not archived", !byId("a").archivedAt && !byId("b").archivedAt);

/* ---------- lists ---------- */
P("Project stage Discovery → Scoping", m.projects[0].stage === "Scoping");
P("Mobilisation BAU Handover → Hypercare, not Closed", m.mobs[0].stage === "Hypercare");
/* ---------- the three retired classification fields ---------- */
const nameOf = (id) => (m.contexts.find((c) => c.id === id) || {}).name;
P("Workstream becomes a Function context", m.contexts.some((c) => c.name === "Operations" && c.type === "Function"));
P("…and the field is gone", m.workItems.every((w) => w.workstream === undefined));
P("Country is gone as a field", m.workItems.every((w) => w.country === undefined));
P("The default country becomes default context tags",
  (m.settings.defaultContexts || []).map(nameOf).join(",") === "UK Operations" && m.settings.defaultCountry === undefined);
P("Horizon is gone", m.workItems.every((w) => w.horizon === undefined));
P("Rank is gone", m.workItems.every((w) => w.rank === undefined));
P("The only thing horizon knew that priority did not — Parked — survives as P5",
  byId("c").priority === "P5");
P("No value appears in two different classification lists",
  (() => { const fns = m.contexts.filter((c) => c.type === "Function").map((c) => c.name);
           return new Set(fns).size === fns.length; })());
P("Board confidential → Execs", m.updates[0].confidentiality === "Execs");
P("Legacy decision status Draft → Required", byId("b").extra.decisionStatus === "Required");

/* ---------- idempotence: running it twice must not drift ---------- */
const first = migrate(v1()).data;
const before = JSON.stringify(first);
const second = migrate(JSON.parse(before));
P("Running the migration again changes no data", JSON.stringify(second.data) === before);
P("…and reports no change, so a load does not pointlessly re-save", second.changed === false);

/* ---------- delegation ---------- */
const carlos = m.people.find((p) => p.name === "Carlos");
const load = personLoad(m, carlos);
P("Waiting-on work is grouped against the right person", load.waitingOnThem.length === 1);
P("An overdue ask is counted as overdue", load.overdue.length === 1);
const judith = m.people.find((p) => p.name === "Judith");
P("A BLOCKED item still counts as waiting on its person", personLoad(m, judith).waitingOnThem.length === 1,
  "this is what the mode/status split buys");

/* ---------- derived values ---------- */
P("An overdue P2 scores higher than a fresh P3",
  itemAttention(byId("a"), m.settings).score > itemAttention(byId("c"), m.settings).score);
P("A closed item scores zero", itemAttention(byId("e"), m.settings).score === 0);
P("Attention explains itself", itemAttention(byId("a"), m.settings).reasons.length > 0,
  itemAttention(byId("a"), m.settings).reasons.join("; "));

const ph = portfolioAttention(m, m.projects[0], "project", m.settings);
P("A stale project is not reported Green", ph.rag !== "Green", `${ph.rag}: ${ph.reasons.join("; ")}`);
P("Portfolio health gives its reasons", ph.reasons.some((r) => /no activity/.test(r)));
P("An explicit override beats the calculation",
  portfolioAttention(m, { ...m.projects[0], ragOverride: "Green" }, "project", m.settings).rag === "Green");

/* ---------- due badge ---------- */
P("An overdue date reads as overdue", dueBadge({ due: d(-3) }).tone === "bad");
P("Today reads as today", dueBadge({ due: d(0) }).text === "Today");
P("No date draws no badge", dueBadge({ due: "" }) === null);

/* ---------- subtasks ---------- */
P("Subtask progress counts correctly",
  subtaskProgress({ subtasks: [{ done: true }, { done: false }, { done: true }] }).done === 2);
P("No subtasks draws nothing", subtaskProgress({ subtasks: [] }) === null);

/* ---------- OKR health: the clock beats the percentage ---------- */
P("80% done the day before the deadline is NOT on track",
  okrHealth({ baseline: 0, current: 80, target: 100, start: d(-100), deadline: d(1) }) !== "On track");
P("Ahead of the clock is on track",
  okrHealth({ baseline: 0, current: 60, target: 100, start: d(-50), deadline: d(50) }) === "On track");
P("Reaching the target completes it",
  okrHealth({ baseline: 0, current: 100, target: 100, start: d(-50), deadline: d(50) }) === "Completed");
P("No numbers means no invented health",
  okrHealth({ baseline: "", current: "", target: "" }) === "Not started");

/* ============================================================
   Project hierarchy — an umbrella over its strands
   ============================================================ */
const H = () => {
  const mk = (id, name, parentId, over = {}) => ({
    id, name, parentId, stage: "Delivery", rag: "", ragOverride: "", progress: 0, owner: "",
    target: "", updatedAt: todayISO(), contexts: [], checklist: [], ...over });
  return migrate({
    v: 3, settings: { displayName: "Paul Wardle", staleProject: 21, staleMob: 7, defaultContexts: [] },
    contexts: [], people: [], okrs: [], meetings: [], sources: [],
    projects: [
      mk("umb", "WhatsApp Integration", ""),
      mk("s1", "Automate driver details", "umb"),
      mk("s2", "Large vehicle recruiting", "umb", { target: d(-10) }),
      mk("s3", "Passenger contact", "umb"),
      mk("solo", "Italy market entry", ""),
    ],
    mobs: [], updates: [], lessons: [], workItems: [
      { id: "w1", title: "Scope the flow", status: "Planned", mode: "Action", priority: "P2", project: "s1",
        owner: "Paul Wardle", waitingOn: "", due: d(-4), created: d(-20), updatedAt: d(-2), contexts: [], flags: {}, notes: [], extra: {} },
      { id: "w2", title: "Umbrella governance", status: "Planned", mode: "Action", priority: "P3", project: "umb",
        owner: "Paul Wardle", waitingOn: "", due: "", created: d(-5), updatedAt: d(-1), contexts: [], flags: {}, notes: [], extra: {} },
    ],
    context: {},
  }).data;
};
const hd = H();
const proj = (id) => hd.projects.find((p) => p.id === id);

P("A project can belong to another one", proj("s1").parentId === "umb");
P("Children are found from the parent", childProjects(hd, "umb").length === 3);
P("The parent is found from the child", parentProject(hd, proj("s1")).name === "WhatsApp Integration");
P("Only the umbrella is top level", isTopLevel(hd, proj("umb")) && !isTopLevel(hd, proj("s1")));
P("The tree reads in order with a depth per level",
  projectTree(hd).map((x) => x.depth).join("") === "01110", projectTree(hd).map((x) => x.project.name + "@" + x.depth).join(" | "));
P("Every strand is a descendant", descendantIds(hd, "umb").size === 3);

/* Cycles: the picker must refuse them, and a stored one must not hang. */
P("A project cannot be its own parent", canParent(hd, "umb", "umb") === false);
/* Two levels, deliberately: a workstream cannot have workstreams. */
P("A workstream cannot be given workstreams of its own", canParent(hd, "solo", "s1") === false);
P("A project that already has workstreams cannot be nested", canParent(hd, "umb", "solo") === false);
P("Depth beyond two is flattened to the top-level ancestor, not dropped", (() => {
  const deep = JSON.parse(JSON.stringify(hd));
  deep.projects.push({ id: "gc", name: "Driver app changes", parentId: "s1", stage: "Delivery", rag: "",
    ragOverride: "", progress: 0, owner: "", target: "", updatedAt: todayISO(), contexts: [], checklist: [] });
  const out = migrate(deep).data;
  return out.projects.find((x) => x.id === "gc").parentId === "umb";
})());
P("A parent cannot be moved under its own child", canParent(hd, "umb", "s1") === false);
P("An unrelated project is a valid parent", canParent(hd, "solo", "umb") === true);
P("A stored cycle is cut rather than left to hang", (() => {
  const bad = JSON.parse(JSON.stringify(hd));
  bad.projects.find((p) => p.id === "umb").parentId = "s1";   // umb -> s1 -> umb
  const fixed = migrate(bad).data;
  return fixed.projects.find((p) => p.id === "umb").parentId === "";
})());
P("A parent that no longer exists is cleared", (() => {
  const bad = JSON.parse(JSON.stringify(hd));
  bad.projects.find((p) => p.id === "solo").parentId = "ghost";
  return migrate(bad).data.projects.find((p) => p.id === "solo").parentId === "";
})());

/* Roll-up: the umbrella answers for its strands. */
const uh = portfolioAttention(hd, proj("umb"), "project", hd.settings);
P("A strand's open work counts as the umbrella's", uh.open === 2, uh.open + " items across the tree");
P("A strand's overdue work reaches the umbrella", uh.overdue === 1);
P("The umbrella reports how many workstreams need attention",
  uh.reasons.some((r) => /workstream/.test(r)), uh.reasons.join("; "));
P("An umbrella is never greener than its worst strand",
  uh.score >= portfolioAttention(hd, proj("s2"), "project", hd.settings).score);
P("A strand answers only for itself",
  portfolioAttention(hd, proj("s3"), "project", hd.settings).open === 0);
P("A project with strands is not flagged as having no open actions",
  !portfolioAttention(hd, proj("umb"), "project", hd.settings).reasons.some((r) => /no open actions/.test(r)));

/* Hypercare is a project stage again. */
P("Hypercare is available as a project stage", PROJECT_STAGES.includes("Hypercare"));
P("Rollout is available as a project stage", PROJECT_STAGES.includes("Rollout"));
P("Hypercare is no longer force-mapped to Delivery", LEGACY_STAGES["Hypercare"] === undefined);

/* ============================================================
   Badge counts. The sidebar said "1" over an empty Waiting screen
   because the badge counted every item whose MODE was waiting, while
   the screen counted only the open ones. Two definitions of one thing.
   These prove the predicates now exclude what the screens exclude.
   ============================================================ */
const B = migrate({
  v: 3, settings: { displayName: "Paul Wardle" },
  contexts: [], people: [], okrs: [], sources: [], projects: [], mobs: [], updates: [], lessons: [],
  meetings: [
    { id: "m1", title: "Old one", date: d(-2), type: "1:1", contexts: [], people: [], notes: "notes", summary: "", processed: true },
    { id: "m2", title: "Recent", date: d(-1), type: "1:1", contexts: [], people: [], notes: "notes", summary: "" },
  ],
  workItems: [
    { id: "w1", title: "Delivered ask", status: "Done", mode: "Waiting on", waitingOn: "Carlos", priority: "P2",
      owner: "Paul Wardle", completed: d(-3), created: d(-20), updatedAt: d(-3), contexts: [], flags: {}, notes: [], extra: {} },
    { id: "w2", title: "Live ask", status: "Planned", mode: "Waiting on", waitingOn: "Judith", priority: "P2",
      owner: "Paul Wardle", created: d(-10), updatedAt: d(-1), contexts: [], flags: {}, notes: [], extra: {} },
    { id: "w3", title: "Cancelled ask", status: "Cancelled", mode: "Waiting on", waitingOn: "Kat", priority: "P3",
      owner: "Paul Wardle", created: d(-30), updatedAt: d(-9), contexts: [], flags: {}, notes: [], extra: {} },
    { id: "w4", title: "In the inbox", status: "Inbox", mode: "Action", waitingOn: "", priority: "P3",
      owner: "Paul Wardle", created: d(-2), updatedAt: d(-2), contexts: [], flags: {}, notes: [], extra: {} },
  ],
  context: {},
}).data;

P("A delivered ask does not keep counting as waiting", waitingItems(B).length === 1,
  waitingItems(B).map((w) => w.title).join(", ") || "none");
P("A cancelled ask does not count either", !waitingItems(B).some((w) => w.id === "w3"));
P("The live one does", waitingItems(B).some((w) => w.id === "w2"));
P("Inbox counts only what is genuinely unprocessed", inboxItems(B).length === 1);
P("The retired meeting 'processed' flag is cleared, and the notes survive",
  B.meetings.every((m) => m.processed === undefined) && B.meetings.find((x) => x.id === "m1").notes === "notes");

console.log("\n" + "=".repeat(54) + "\n" + (fails ? fails + " FAILED" : "all passed"));
process.exit(fails ? 1 : 0);
