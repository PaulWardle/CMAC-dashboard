/* Proves every list change is lossless: no recorded value is orphaned, and no
   migration moves work in an unsafe direction. */
import { readFileSync } from "fs";

const src = readFileSync("/home/user/CMAC-dashboard/src/App.jsx", "utf8");
function grab(name) {
  const i = src.indexOf("const " + name + " = ");
  if (i === -1) return null;
  const start = src.indexOf("=", i) + 1;
  // Read to the matching close of the first [ or { after the =
  const open = src.slice(start).search(/[[{]/) + start;
  const openCh = src[open], closeCh = openCh === "[" ? "]" : "}";
  let depth = 0, end = open;
  for (let j = open; j < src.length; j++) {
    if (src[j] === openCh) depth++;
    else if (src[j] === closeCh) { depth--; if (!depth) { end = j; break; } }
  }
  return eval("(" + src.slice(open, end + 1) + ")");
}

const P = (n, ok, x = "") => { console.log((ok ? "PASS  " : "FAIL  ") + n + (x ? "  — " + x : "")); if (!ok) process.exitCode = 1; };

const WS = grab("WORKSTREAMS"), LWS = grab("LEGACY_WORKSTREAMS");
const MS = grab("MOB_STAGES"), LMS = grab("LEGACY_MOB_STAGES");
const CF = grab("CONFIDENTIALITY"), LCF = grab("LEGACY_CONF"), SH = grab("SHAREABLE");
const ST = grab("STATUSES"), LST = grab("LEGACY_STATUS");
const DS = grab("DECISION_STATUSES"), LDS = grab("LEGACY_DECISION");
const PS = grab("PROJECT_STAGES"), LPS = grab("LEGACY_STAGES");
const MW = grab("MOB_WORKSTREAMS");

const OLD = {
  WS: ["KPI, board & COO reporting","Minicabit performance","AI supplier call handling","Supplier transitions","Australia mobilisation","Hotel commission recovery","European T&Q standardisation","Planning team resilience","Ops Portal & digitalisation","Client mobilisations","Country operating reviews","Resource planning & org design","Service performance","Automation & AI","Operational controls","People & capability","Client delivery","Aviation","Rail","Supply","Technology","Business Change"],
  MS: ["Discovery","Handover from Commercial","Design","Build","Readiness","Go-live Approval","Go-live","Hypercare","BAU Handover","Closed","On Hold"],
  CF: ["General internal","Restricted","Senior leadership","Board confidential","Client confidential","People confidential"],
  ST: ["Inbox","Planned","In Progress","Waiting","Blocked","Review","Done","Parked","Cancelled"],
  DS: ["Draft","Required","Awaiting Information","Submitted","Decided","Deferred","Withdrawn"],
  PS: ["Idea","Discovery","Definition","Planning","Delivery","Implementation","Hypercare","BAU Handover","Closed","On Hold","Cancelled"],
};

function complete(label, old, now, map) {
  const orphans = old.filter((v) => {
    const to = now.includes(v) ? v : map[v];
    return !to || !now.includes(to);
  });
  P(label + " — every recorded value still has a home", orphans.length === 0, orphans.join(", "));
}
complete("Workstreams", OLD.WS, WS, LWS);
complete("Mobilisation stages", OLD.MS, MS, LMS);
complete("Confidentiality", OLD.CF, CF, LCF);
complete("Work item status", OLD.ST, ST, LST);
complete("Decision status", OLD.DS, DS, LDS);
complete("Project stages", OLD.PS, PS, LPS);

/* Safety direction: a migration must never widen who can see something, and
   must never mark live work as finished. */
const leaks = OLD.CF.filter((v) => v !== "General internal" && SH.includes(LCF[v] || v));
P("Nothing restricted becomes shareable", leaks.length === 0, leaks.join(", "));
P("The old default stays newsletter-eligible", SH.includes(LCF["General internal"]));

const finished = ["Closed", "Cancelled", "Done"];
const mobClosed = OLD.MS.filter((v) => !finished.includes(v) && finished.includes(LMS[v] || v));
P("No live mobilisation becomes closed", mobClosed.length === 0, mobClosed.join(", "));
const projClosed = OLD.PS.filter((v) => !finished.includes(v) && finished.includes(LPS[v] || v));
P("No live project becomes closed", projClosed.length === 0, projClosed.join(", "));
const stDone = OLD.ST.filter((v) => !finished.includes(v) && finished.includes(LST[v] || v));
P("No open item becomes done", stDone.length === 0, stDone.join(", "));

P("Blocked is a flag, not a stage", !PS.includes("Blocked") && !MS.includes("Blocked"));
P("Mobilisation 'On Hold' keeps the stage it reached", LMS["On Hold"] === "Preparing & Planning");

console.log("\n" + [
  "workstreams      " + OLD.WS.length + " -> " + WS.length,
  "mob stages       " + OLD.MS.length + " -> " + MS.length,
  "mob workstreams  22 -> " + MW.length,
  "confidentiality  " + OLD.CF.length + " -> " + CF.length,
  "statuses         " + OLD.ST.length + " -> " + ST.length,
  "decisions        " + OLD.DS.length + " -> " + DS.length,
  "project stages   " + OLD.PS.length + " -> " + PS.length,
].join("\n"));
