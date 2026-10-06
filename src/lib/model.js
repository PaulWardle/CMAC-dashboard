/* ============================================================
   The domain model: every list the app offers, every rule for
   moving old records onto a new list, and the derived values
   (attention, health, readiness) that are computed rather than
   typed in.

   This file is deliberately free of React. Everything here is a
   pure function or a constant, so it can be unit-tested without a
   browser — see tests/model.mjs.
   ============================================================ */

/* ---------- work item status ----------
   "Waiting" has been removed as a status. Whether somebody else is
   holding a piece of work is a different question from where that work
   has got to, and conflating them meant a blocked item could not also
   be recorded as waiting on a named person. Status says where it is;
   MODE (below) says who is holding it. */
export const STATUSES = ["Inbox", "Planned", "In Progress", "Blocked", "Done", "Cancelled"];
export const OPEN_STATUSES = ["Inbox", "Planned", "In Progress", "Blocked"];
export const LEGACY_STATUS = { "Review": "In Progress", "Parked": "Planned", "Waiting": "In Progress" };

/* ---------- mode ----------
   The second axis. An Action is mine to do. A Waiting On is someone
   else's, and my job is to monitor and chase it. */
export const MODES = ["Action", "Waiting on"];

/* ---------- priority ----------
   P1-P5, matching how these have been recorded for months elsewhere.
   The number carries the meaning; the word is shown beside it so the
   scale never has to be remembered. */
export const PRIORITIES = ["P1", "P2", "P3", "P4", "P5"];
export const PRIO_LABEL = {
  P1: "Critical", P2: "High", P3: "Normal", P4: "Low", P5: "Backlog",
};
export const PRIO_HINT = {
  P1: "Immediate operational, customer, safety, financial or reputational risk",
  P2: "Important commitment needing action this week",
  P3: "Real planned work",
  P4: "Useful but can wait",
  P5: "Someday / not yet committed",
};
export const LEGACY_PRIORITY = { Critical: "P1", High: "P2", Medium: "P3", Low: "P4", Parked: "P5" };

export const RAGS = ["Red", "Amber", "Green"];

/* ---------- operational contexts ----------
   The lens through which work is viewed: a geography, a function, a
   client, a supplier. An item may sit in several at once, which is the
   whole point — "Spain Ryanair supply review" is Spain AND Ryanair AND
   Supply without being filed three times. */
export const CONTEXT_TYPES = ["Geography", "Function", "Client", "Supplier", "Other"];
export const SEED_CONTEXTS = [
  { name: "UK Operations", type: "Geography" },
  { name: "Spain", type: "Geography" },
  { name: "Portugal", type: "Geography" },
  { name: "Greece & Cyprus", type: "Geography" },
  { name: "Europe Operations", type: "Geography" },
  { name: "Group Operations", type: "Function" },
  { name: "Supply", type: "Function" },
  { name: "Service Delivery", type: "Function" },
];
/* The single-value country field becomes a context tag. "Group" meant
   "all of it", which is the absence of a geography rather than one more. */
export const COUNTRY_TO_CONTEXT = {
  UK: "UK Operations", Spain: "Spain", Portugal: "Portugal",
  Greece: "Greece & Cyprus", Group: "",
};
export const COUNTRIES = ["UK", "Spain", "Portugal", "Greece", "Group"];

export const TYPES = ["Action", "Task", "Milestone", "Risk", "Issue", "Dependency", "Decision", "Commitment", "Chaser", "Follow-up", "Idea", "Improvement", "Information request", "Meeting action", "Mobilisation action", "Board action", "Audit action"];
export const CORE_TYPES = ["Action", "Risk", "Issue", "Dependency", "Decision", "Commitment", "Idea"];

export const WORKSTREAMS = ["Group Operations", "Operations", "Training & Quality", "Business Change", "Mobilisations", "Commercial", "People", "Supply", "Technology", "Reporting"];
export const LEGACY_WORKSTREAMS = {
  "KPI, board & COO reporting": "Reporting", "Country operating reviews": "Reporting",
  "Minicabit performance": "Operations", "Service performance": "Operations",
  "AI supplier call handling": "Technology", "Ops Portal & digitalisation": "Technology",
  "Automation & AI": "Technology", "Technology": "Technology",
  "Supplier transitions": "Supply", "Hotel commission recovery": "Commercial",
  "Australia mobilisation": "Mobilisations", "Client mobilisations": "Mobilisations",
  "European T&Q standardisation": "Training & Quality",
  "Planning team resilience": "People", "Resource planning & org design": "People",
  "People & capability": "People", "Client delivery": "Operations",
  "Operational controls": "Group Operations", "Business Change": "Business Change",
  "Aviation": "Operations", "Rail": "Operations", "Supply": "Supply",
};

export const PROJECT_STAGES = ["Idea", "Scoping", "Planning", "Delivery", "Closed", "On Hold", "Cancelled"];
export const LEGACY_STAGES = {
  "Discovery": "Scoping", "Definition": "Scoping", "Implementation": "Delivery",
  "Hypercare": "Delivery", "BAU Handover": "Delivery",
};
export const MOB_STAGES = ["Scoping", "Preparing & Planning", "Ready", "Go-live", "Hypercare", "Closed"];
export const LEGACY_MOB_STAGES = {
  "Discovery": "Scoping", "Handover from Commercial": "Scoping",
  "Design": "Preparing & Planning", "Build": "Preparing & Planning",
  "Readiness": "Ready", "Go-live Approval": "Ready",
  "BAU Handover": "Hypercare", "On Hold": "Preparing & Planning",
};
export const MOB_WORKSTREAMS = ["Scope & governance", "Operational design", "Systems & access", "Data & reporting", "Supply & hotels", "Transport", "Resourcing & training", "Finance & billing", "Communications", "Testing & cutover"];

export const CONFIDENTIALITY = ["Private", "Execs", "Internal", "Open"];
export const SHAREABLE = ["Internal", "Open"];
export const LEGACY_CONF = {
  "General internal": "Internal", "Restricted": "Execs", "Senior leadership": "Execs",
  "Board confidential": "Execs", "Client confidential": "Execs", "People confidential": "Private",
};

export const DECISION_STATUSES = ["Required", "Awaiting information", "Decided", "Deferred", "Withdrawn"];
export const LEGACY_DECISION = { "Draft": "Required", "Submitted": "Awaiting information", "Awaiting Information": "Awaiting information" };
export const HORIZONS = ["Now", "Next", "Later", "Parked"];

/* ---------- people ----------
   Recurring working relationships, not a CRM. Performance and
   development material is held here under explicit sign-off; the
   CONFIDENTIAL_PERSON_FIELDS list is what every outward-facing
   output (board pack, newsletter, export, AI brief) must strip. */
export const RELATIONSHIPS = ["Direct report", "Stakeholder", "Colleague", "Client", "Supplier", "Other"];
export const CONFIDENTIAL_PERSON_FIELDS = ["strengths", "development", "pdr", "privateNotes"];

/* ---------- meetings ---------- */
export const MEETING_TYPES = ["1:1", "Operational review", "Project", "Mobilisation", "Leadership", "Client / supplier", "Other"];

/* ---------- goals and OKRs ---------- */
export const OKR_HEALTH = ["Not started", "On track", "At risk", "Off track", "Completed", "Cancelled"];
export const OKR_UNITS = ["%", "number", "£", "days", "score"];

/* ============================================================
   Small shared utilities
   ============================================================ */
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const daysUntil = (s) => { if (!s) return null; return Math.round((new Date(String(s).slice(0, 10)) - new Date(todayISO())) / 86400000); };
export const daysSince = (s) => { if (!s) return null; return Math.round((new Date(todayISO()) - new Date(String(s).slice(0, 10))) / 86400000); };
export const uid = () => Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8);

/* ============================================================
   Derived state — computed, never typed
   ============================================================ */
export const prioRank = (p) => ({ P1: 0, P2: 1, P3: 2, P4: 3, P5: 4 }[p] ?? 5);
export const prioText = (p) => (p ? `${p} ${PRIO_LABEL[p] || ""}`.trim() : "—");

export const isWaiting = (w) => w.mode === "Waiting on";
export const isAction = (w) => !isWaiting(w);
export const isOpen = (w) => OPEN_STATUSES.includes(w.status);
export const isOverdue = (w) => isOpen(w) && w.due && daysUntil(w.due) < 0;
export const isArchived = (w) => !!w.archivedAt;

/* Subtask progress, shown as a small "3/5" on the card. */
export function subtaskProgress(w) {
  const t = (w.subtasks || []).length;
  if (!t) return null;
  return { done: w.subtasks.filter((s) => s.done).length, total: t };
}

/* The due-date badge from the Notion board: a short countdown that
   turns red once it has gone. Returns null when there is no date, so
   nothing is drawn rather than an empty chip. */
export function dueBadge(w) {
  if (!w.due) return null;
  const n = daysUntil(w.due);
  if (n === null) return null;
  if (n < -1) return { text: `${Math.abs(n)}d over`, tone: "bad" };
  if (n === -1) return { text: "1d over", tone: "bad" };
  if (n === 0) return { text: "Today", tone: "bad" };
  if (n === 1) return { text: "Tomorrow", tone: "warn" };
  if (n <= 7) return { text: `Due ${n}d`, tone: "warn" };
  return { text: `Due ${n}d`, tone: "ok" };
}

/* ---------- attention ----------
   Replaces a RAG someone has to remember to update. Every input is a
   fact the system already holds, so the number cannot go stale. A
   manual override is honoured when set, because judgement beats
   arithmetic — but it has to be set deliberately. */
export function itemAttention(w, settings = {}) {
  if (!isOpen(w)) return { score: 0, reasons: [] };
  const reasons = [];
  let score = 0;
  const pr = prioRank(w.priority);
  score += Math.max(0, 4 - pr) * 6;              // P1 = 24, P5 = 0
  const over = w.due ? -daysUntil(w.due) : null;
  if (over !== null && over > 0) { score += Math.min(40, 8 + over * 2); reasons.push(over === 1 ? "1 day overdue" : `${over} days overdue`); }
  else if (over !== null && over >= -2) { score += 10; reasons.push("due now"); }
  if (w.status === "Blocked") { score += 22; reasons.push(w.blocker ? `blocked: ${w.blocker}` : "blocked"); }
  if (isWaiting(w)) {
    const chase = w.nextChase ? daysUntil(w.nextChase) : null;
    if (chase !== null && chase <= 0) { score += 16; reasons.push(`chase due with ${w.waitingOn || "someone"}`); }
    else if (!w.nextChase) { score += 6; reasons.push("waiting with no chase date"); }
  }
  const stale = daysSince(w.updatedAt || w.created);
  const limit = settings.staleItem || 14;
  if (stale !== null && stale > limit) { score += Math.min(18, stale - limit); reasons.push(`untouched ${stale} days`); }
  if (w.focus) score += 12;
  return { score: Math.round(score), reasons };
}

/* A project or mobilisation's health, from its own facts plus the work
   filed under it. Returns a RAG so the portfolio can be scanned at a
   glance, and the reasons so it can be challenged. */
export function portfolioAttention(d, entity, kind, settings = {}) {
  const items = d.workItems.filter((w) => (kind === "project" ? w.project : w.mob) === entity.id && isOpen(w));
  const overdue = items.filter(isOverdue);
  const blockedItems = items.filter((w) => w.status === "Blocked");
  const reasons = [];
  let score = 0;

  if (entity.blocked) { score += 30; reasons.push(entity.blocker ? `blocked — ${entity.blocker}` : (entity.blockedBy ? `blocked by ${entity.blockedBy}` : "blocked")); }
  if (overdue.length) { score += Math.min(30, overdue.length * 8); reasons.push(`${overdue.length} overdue action${overdue.length > 1 ? "s" : ""}`); }
  if (blockedItems.length) { score += blockedItems.length * 5; reasons.push(`${blockedItems.length} blocked action${blockedItems.length > 1 ? "s" : ""}`); }

  const lastTouch = [entity.updatedAt, ...items.map((w) => w.updatedAt)].filter(Boolean).sort().pop();
  const stale = daysSince(lastTouch);
  const limit = kind === "mob" ? (settings.staleMob || 7) : (settings.staleProject || 21);
  if (stale !== null && stale > limit) { score += Math.min(26, (stale - limit) * 2); reasons.push(`no activity for ${stale} days`); }

  const target = kind === "mob" ? entity.goLive : entity.target;
  const left = target ? daysUntil(target) : null;
  if (left !== null && left < 0 && !["Closed", "Cancelled"].includes(entity.stage)) { score += 26; reasons.push(`${Math.abs(left)} days past target`); }
  else if (left !== null && left <= 14 && kind === "mob") { score += 14; reasons.push(`go-live in ${left} days`); }
  else if (left !== null && left <= 7) { score += 10; reasons.push(`target in ${left} days`); }

  if (!items.length && !["Closed", "Cancelled", "Idea"].includes(entity.stage)) { score += 8; reasons.push("no open actions"); }

  const rag = entity.ragOverride || (score >= 45 ? "Red" : score >= 20 ? "Amber" : "Green");
  return { score: Math.round(score), rag, reasons, overdue: overdue.length, blocked: blockedItems.length, open: items.length, stale };
}

/* An OKR is not healthy because it is 80% done. It is healthy when
   progress is ahead of the clock. */
export function okrProgress(o) {
  const base = Number(o.baseline), cur = Number(o.current), tgt = Number(o.target);
  if (![base, cur, tgt].every(Number.isFinite) || tgt === base) return null;
  return Math.max(0, Math.min(1, (cur - base) / (tgt - base)));
}
export function okrHealth(o) {
  if (o.health && ["Completed", "Cancelled", "Not started"].includes(o.health)) return o.health;
  const p = okrProgress(o);
  if (p === null) return o.health || "Not started";
  if (p >= 1) return "Completed";
  if (!o.start || !o.deadline) return p > 0 ? "On track" : "Not started";
  const total = (new Date(o.deadline) - new Date(o.start)) / 86400000;
  const gone = (new Date(todayISO()) - new Date(o.start)) / 86400000;
  if (total <= 0) return p >= 1 ? "Completed" : "Off track";
  const expected = Math.max(0, Math.min(1, gone / total));
  if (p >= expected - 0.05) return "On track";
  if (p >= expected - 0.2) return "At risk";
  return "Off track";
}

/* ============================================================
   Migration — move stored records onto the current lists.

   Every mapping is one-way and conservative: nothing live becomes
   closed, nothing restricted becomes shareable, and no value is
   dropped without somewhere to land. tests/lists.mjs proves it.
   ============================================================ */
export function migrate(d) {
  let changed = false;
  const remap = (obj, key, map) => {
    if (obj && map[obj[key]] !== undefined && map[obj[key]] !== obj[key]) { obj[key] = map[obj[key]]; return true; }
    return false;
  };

  /* --- new collections --- */
  if (!Array.isArray(d.contexts)) {
    d.contexts = SEED_CONTEXTS.map((c) => ({ id: uid(), ...c, active: true }));
    changed = true;
  }
  if (!Array.isArray(d.people)) { d.people = []; changed = true; }
  if (!Array.isArray(d.okrs)) { d.okrs = []; changed = true; }
  if (!Array.isArray(d.meetings)) { d.meetings = []; changed = true; }
  if (!Array.isArray(d.sources)) { d.sources = []; changed = true; }

  /* Health stops being something typed in. A colour that was set by hand
     before this change is kept as the initial override — so nothing looks
     different on the first load — and clearing it hands the project back
     to the calculation. */
  [...d.projects, ...d.mobs].forEach((e) => {
    if (e.ragOverride === undefined) { e.ragOverride = ""; changed = true; }
  });

  const ctxByName = {};
  d.contexts.forEach((c) => { ctxByName[c.name] = c.id; });

  /* --- work items --- */
  d.workItems.forEach((w) => {
    if (remap(w, "status", LEGACY_STATUS)) changed = true;
    if (remap(w, "workstream", LEGACY_WORKSTREAMS)) changed = true;
    if (remap(w, "confidentiality", LEGACY_CONF)) changed = true;
    if (remap(w, "priority", LEGACY_PRIORITY)) changed = true;
    if (!PRIORITIES.includes(w.priority)) { w.priority = "P3"; changed = true; }

    /* Mode. An item that was recorded as waiting, or that names someone
       it is waiting on, is a Waiting On; everything else is an Action.
       Both halves of the old "Waiting" status survive the split. */
    if (!w.mode) {
      w.mode = w.waitingOn ? "Waiting on" : "Action";
      changed = true;
    }
    if (!Array.isArray(w.contexts)) {
      const name = COUNTRY_TO_CONTEXT[w.country];
      w.contexts = name && ctxByName[name] ? [ctxByName[name]] : [];
      changed = true;
    }
    if (!Array.isArray(w.subtasks)) { w.subtasks = []; changed = true; }
    if (w.focus === undefined) { w.focus = false; changed = true; }
    if (w.source === undefined) { w.source = null; changed = true; }
    if (w.personId === undefined) { w.personId = ""; changed = true; }
    /* Completed work leaves the board. It is not deleted — the Archive
       holds it — but a Done column that only ever grows is a list of
       things that no longer need looking at. */
    if (w.status === "Done" && !w.archivedAt) { w.archivedAt = w.completed || w.updatedAt || todayISO(); changed = true; }
    if (w.status !== "Done" && w.archivedAt) { w.archivedAt = ""; changed = true; }

    if (!w.flags || typeof w.flags !== "object") { w.flags = { board: false, coo: false, news: false, groupWeekly: false, ukWeekly: false }; changed = true; }
    if (w.notes != null && !Array.isArray(w.notes)) { w.notes = []; changed = true; }
    if (w.extra != null && typeof w.extra !== "object") { w.extra = {}; changed = true; }
    if (w.extra && remap(w.extra, "decisionStatus", LEGACY_DECISION)) changed = true;
  });

  /* --- projects and mobilisations --- */
  const tagContext = (e) => {
    if (!Array.isArray(e.contexts)) {
      const name = COUNTRY_TO_CONTEXT[e.country];
      e.contexts = name && ctxByName[name] ? [ctxByName[name]] : [];
      return true;
    }
    return false;
  };
  d.projects.forEach((p) => {
    if (remap(p, "stage", LEGACY_STAGES)) changed = true;
    if (remap(p, "workstream", LEGACY_WORKSTREAMS)) changed = true;
    if (tagContext(p)) changed = true;
  });
  d.mobs.forEach((m) => {
    if (remap(m, "stage", LEGACY_MOB_STAGES)) changed = true;
    if (tagContext(m)) changed = true;
  });
  (d.updates || []).forEach((u) => {
    if (remap(u, "confidentiality", LEGACY_CONF)) changed = true;
    if (!u.flags || typeof u.flags !== "object") { u.flags = { board: false, coo: false, news: false }; changed = true; }
  });

  /* --- people: owners and waiting-ons become real records ---
     The signed-in user is excluded up front rather than created and then
     deleted. Doing it the other way round left the migration reporting a
     change on every single load, and writing the document each time. */
  const me = (d.settings && d.settings.displayName) || "";
  const known = new Set(d.people.map((p) => p.name.toLowerCase()));
  const seen = new Map();
  d.workItems.forEach((w) => {
    [w.owner, w.waitingOn].forEach((n) => {
      const name = String(n || "").trim();
      if (!name || name === "Me" || known.has(name.toLowerCase())) return;
      if (me && name.toLowerCase() === me.toLowerCase()) return;
      seen.set(name.toLowerCase(), name);
    });
  });
  if (seen.size) {
    seen.forEach((name) => {
      d.people.push({
        id: uid(), name, role: "", func: "", location: "", relationship: "Colleague",
        managerId: "", contexts: [], oneToOne: "", nextOneToOne: "",
        strengths: "", development: "", privateNotes: "", pdr: [], notes: [],
        active: true, created: todayISO(),
      });
    });
    changed = true;
  }
  d.people.forEach((p) => {
    if (!Array.isArray(p.pdr)) { p.pdr = []; changed = true; }
    if (!Array.isArray(p.notes)) { p.notes = []; changed = true; }
    if (!Array.isArray(p.contexts)) { p.contexts = []; changed = true; }
  });

  /* Clean up a self-record created before the display name was known. This
     should now be a no-op on every run after the first. */
  if (me) {
    const dup = d.people.findIndex((p) => p.name.toLowerCase() === me.toLowerCase());
    if (dup >= 0) { d.people.splice(dup, 1); changed = true; }
  }

  /* Benefits was never built out past its data shape. Carrying an empty
     feature forward costs a nav entry and a screen nobody opens. */
  if (d.benefits && d.benefits.length === 0) { delete d.benefits; changed = true; }

  if (d.v !== 2) { d.v = 2; changed = true; }
  return { data: d, changed };
}

/* ============================================================
   Context helpers
   ============================================================ */
export const ctxName = (d, id) => (d.contexts.find((c) => c.id === id) || {}).name || "";
export const ctxNames = (d, ids) => (ids || []).map((id) => ctxName(d, id)).filter(Boolean);
export const ctxByName = (d, name) => d.contexts.find((c) => c.name.toLowerCase() === String(name || "").toLowerCase());
export const personName = (d, id) => (d.people.find((p) => p.id === id) || {}).name || "";
export const personByName = (d, name) => d.people.find((p) => p.name.toLowerCase() === String(name || "").trim().toLowerCase());

/* Everything filed under one context, across every collection. This is
   what makes "give me the current picture in Spain" a query rather than
   a folder someone has to maintain. */
export function inContext(d, ctxId) {
  const has = (x) => (x.contexts || []).includes(ctxId);
  return {
    items: d.workItems.filter((w) => has(w) && isOpen(w)),
    projects: d.projects.filter(has),
    mobs: d.mobs.filter(has),
    meetings: (d.meetings || []).filter(has),
    okrs: (d.okrs || []).filter(has),
    people: d.people.filter(has),
  };
}

/* What a named person is holding, and what I owe them. The reason the
   mode/status split was worth 17 edits: both halves work regardless of
   where the work has got to. */
export function personLoad(d, person) {
  const nameMatch = (v) => String(v || "").trim().toLowerCase() === person.name.toLowerCase();
  const open = d.workItems.filter(isOpen);
  const waitingOnThem = open.filter((w) => isWaiting(w) && (w.personId === person.id || nameMatch(w.waitingOn)));
  const theyOwn = open.filter((w) => !isWaiting(w) && nameMatch(w.owner));
  const iOweThem = open.filter((w) => !isWaiting(w) && w.extra && nameMatch(w.extra.madeTo));
  return {
    waitingOnThem,
    theyOwn,
    iOweThem,
    overdue: waitingOnThem.filter(isOverdue),
    chaseDue: waitingOnThem.filter((w) => w.nextChase && daysUntil(w.nextChase) <= 0),
    stale: waitingOnThem.filter((w) => daysSince(w.updatedAt || w.created) > 7),
  };
}
