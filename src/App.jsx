import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { store } from "./lib/store";

/* ============================================================
   CMAC Operations Command Centre — v1
   One source of truth, multiple views and reporting outputs.
   Data layer is isolated in `store` (see src/lib/store.js) so it
   can be backed by Supabase, localStorage, or another API.
   ============================================================ */

/* ---------- constants ---------- */
const APP_KEY = "cmac-occ-v1";
const C = {
  navy: "#112138", red: "#FD0E33", bg: "#EDF1F2", line: "#E1E7EC",
  ink: "#16233A", mut: "#5C6675", amber: "#B45309", green: "#1A7F44",
  redS: "#FD0E33", blue: "#1D5FBF", navySoft: "#1B3050",
};
const STATUSES = ["Inbox","Planned","In Progress","Waiting","Blocked","Review","Done","Parked","Cancelled"];
const OPEN_STATUSES = ["Inbox","Planned","In Progress","Waiting","Blocked","Review"];
const TYPES = ["Action","Task","Milestone","Risk","Issue","Dependency","Decision","Commitment","Chaser","Follow-up","Idea","Improvement","Information request","Meeting action","Mobilisation action","Board action","Audit action"];
const PRIORITIES = ["Critical","High","Medium","Low","Parked"];
const RAGS = ["Red","Amber","Green"];
const COUNTRIES = ["UK","Spain","Portugal","Greece","Group"];
const WORKSTREAMS = ["KPI, board & COO reporting","Minicabit performance","AI supplier call handling","Supplier transitions","Australia mobilisation","Hotel commission recovery","European T&Q standardisation","Planning team resilience","Ops Portal & digitalisation","Client mobilisations","Country operating reviews","Resource planning & org design","Service performance","Automation & AI","Operational controls","People & capability","Client delivery","Aviation","Rail","Supply","Technology","Business Change"];
const PROJECT_STAGES = ["Idea","Discovery","Definition","Planning","Delivery","Implementation","Hypercare","BAU Handover","Closed","On Hold","Cancelled"];
const MOB_STAGES = ["Discovery","Handover from Commercial","Design","Build","Readiness","Go-live Approval","Go-live","Hypercare","BAU Handover","Closed","On Hold"];
const MOB_WORKSTREAMS = ["Scope & assumptions","Governance","Operational design","Booking flows","Customer contact channels","Systems & access","Data & reporting","Supply readiness","Hotel readiness","Transport readiness","Resource planning","Recruitment","Training","Quality assurance","Finance & billing","Communications","Escalation model","Business continuity","Testing","Cutover","Hypercare","BAU handover"];
const CONFIDENTIALITY = ["General internal","Restricted","Senior leadership","Board confidential","Client confidential","People confidential"];
const BENEFIT_TYPES = ["Revenue","Cost saving","Cost avoidance","Time saving","Productivity","Service improvement","Client satisfaction","Risk reduction","Control improvement","Capability improvement","Compliance improvement"];
const BENEFIT_CONF = ["Confirmed","High confidence","Medium confidence","Indicative","Unverified"];
const DECISION_STATUSES = ["Draft","Required","Awaiting Information","Submitted","Decided","Deferred","Withdrawn"];
const HORIZONS = ["Now","Next","Later","Parked"];
const DEFAULT_SETTINGS = {
  userName: "Group Operations Director",
  defaultCountry: "Group",
  staleItem: 14, staleProject: 21, staleMob: 7,
  density: "compact",
};

/* ---------- date & misc utilities (UK formats) ---------- */
const uid = () => Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8);
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const dOff = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const fmtD = (s) => { if (!s) return "—"; const p = String(s).slice(0,10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };
const daysUntil = (s) => { if (!s) return null; return Math.round((new Date(String(s).slice(0,10)) - new Date(todayISO())) / 86400000); };
const daysSince = (s) => { if (!s) return null; return Math.round((new Date(todayISO()) - new Date(String(s).slice(0,10))) / 86400000); };
const monthName = () => new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/* ---------- priority ---------- */
const prioRank = (p) => ({ Critical: 0, High: 1, Medium: 2, Low: 3, Parked: 4 }[p] ?? 5);

/* ---------- storage adapter ----------
   The `store` object is imported from src/lib/store.js. It persists to
   Supabase (per-user JSONB, RLS-isolated) when configured and signed in,
   and falls back to localStorage otherwise. Same async interface:
   store.available, store.load(), store.save(data). */

/* ---------- AI helper (via the /api/ai server proxy) ---------- */
async function askClaude(prompt, expectJson = false, maxTokens = 1000) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch (e) {}
    throw new Error(detail || ("AI service unavailable (" + res.status + ")"));
  }
  const d = await res.json();
  if (d.error) throw new Error(typeof d.error === "string" ? d.error : (d.error.message || "AI error"));
  const text = (d.content || []).map((c) => (c.type === "text" ? c.text : "")).join("");
  if (!expectJson) return text;
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("["); const startO = clean.indexOf("{");
  const from = (start === -1) ? startO : (startO === -1 ? start : Math.min(start, startO));
  return JSON.parse(clean.slice(from));
}

function captureParsePrompt(text, projects, mobs) {
  return `You extract structured work records for an operations director's tracking system. From the input below, identify every distinct action, task, risk, issue, decision, commitment, chaser or follow-up. Respond ONLY with a JSON array (no markdown, no preamble). Each element:
{"title": string (short, imperative), "description": string, "type": one of ${JSON.stringify(TYPES)}, "owner": string or "", "waitingOn": string or "", "due": "YYYY-MM-DD" or "", "priority": one of ["Critical","High","Medium","Low"], "country": one of ${JSON.stringify(COUNTRIES)} or "", "workstream": string or "", "project": exact name from ${JSON.stringify(projects.map(p=>p.name))} or "", "mobilisation": exact name from ${JSON.stringify(mobs.map(m=>m.name))} or "", "nextAction": string or "", "flags": {"board": bool, "coo": bool, "news": bool}}
Rules: today is ${fmtD(todayISO())} (${todayISO()}). Resolve relative dates like "Friday" or "end of month" to real dates. Do not invent owners, dates or facts not present in the text. Leave fields empty rather than guessing. Only set flags if the text clearly implies board/COO/newsletter relevance.
INPUT:
${text}`;
}

/* ---------- demonstration data ---------- */
function seedData() {
  return {
    v: 1, workItems: [], projects: [], mobs: [], updates: [], benefits: [], lessons: [], meetings: [],
    stakeholderNotes: {}, dismissedAlerts: [],
    boardDraft: { period: monthName(), deadline: "", meetingDate: "", commentary: {}, excluded: [], overrides: {}, complete: [] },
    cooDraft: { period: "Week of " + fmtD(todayISO()), commentary: {}, excluded: [], overrides: {} },
    newsDraft: { edition: monthName(), approved: [], rejected: [], headlines: {}, articles: [] },
    weekly: { weekOf: todayISO(), steps: {}, topFive: ["", "", "", "", ""], support: "" },
    activity: [{ ts: Date.now(), text: "Fresh start — system initialised" }],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/* one-time cleanup: remove any demonstration records left in stored data */
function stripDemo(d) {
  const keys = ["workItems", "projects", "mobs", "updates", "benefits", "lessons", "meetings"];
  const had = keys.some((k) => (d[k] || []).some((x) => x && x.demo));
  if (!had) return { data: d, changed: false };
  keys.forEach((k) => { d[k] = (d[k] || []).filter((x) => !(x && x.demo)); });
  d.workItems.push({
    id: uid(), title: "Snag list — app improvement ideas",
    description: "Every time this app jars, is missing something, or does too much — add a note to this item. Bring the whole list to Claude in one batch session; far cheaper than one tweak at a time.",
    type: "Idea", status: "Inbox", priority: "Low", owner: "Me", waitingOn: "",
    project: "", mob: "", workstream: "", country: (d.settings && d.settings.defaultCountry) || "UK", client: "",
    due: "", nextChase: "", lastChased: "", completed: "", created: todayISO(), updatedAt: todayISO(),
    rag: "", nextAction: "Add snags as you find them", blocker: "", horizon: "Later", rank: 90,
    flags: { board: false, coo: false, news: false, groupWeekly: false, ukWeekly: false }, confidentiality: "General internal",
    notes: [], extra: {}, outcome: "",
  });
  d.activity = [...(d.activity || []).slice(-199), { ts: Date.now(), text: "Demonstration data removed — running on real data only" }];
  return { data: d, changed: true };
}

/* ============================================================
   Shared UI atoms
   ============================================================ */
const CMAC_LOGO = "data:image/png;base64,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";

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800;900&display=swap');
:root { color-scheme: light; }
* { box-sizing: border-box; }
.occ { display:flex; height:100vh; height:100dvh; width:100%; background:#EDF1F2; color:#112138; font-family:'Montserrat','Segoe UI',system-ui,-apple-system,Arial,sans-serif; font-size:12.5px; font-weight:500; overflow:hidden; }
.occ ::selection { background:#112138; color:#fff; }
.side { width:226px; min-width:226px; background:#112138; color:#C9D1DD; display:flex; flex-direction:column; }
.side-brand { padding:18px 18px 12px; }
.side-brand .blogo { width:118px; height:auto; display:block; }
.side-brand .b2 { font-size:8.5px; text-transform:uppercase; letter-spacing:2.2px; color:#7E8BA1; margin-top:7px; font-weight:700; }
.side-nav { flex:1; overflow-y:auto; padding:2px 0 16px; }
.ngroup { font-size:9px; text-transform:uppercase; letter-spacing:1.9px; color:#5F6E86; padding:16px 18px 5px; font-weight:800; }
.nitem { display:flex; align-items:center; justify-content:space-between; padding:6px 18px; cursor:pointer; color:#C9D1DD; border-left:3px solid transparent; font-weight:600; font-size:12px; }
.nitem:hover { background:#1B3050; color:#fff; }
.nitem.on { background:#1B3050; color:#fff; border-left-color:#FD0E33; }
.nitem .cnt { font-size:10px; background:#0C1930; border-radius:999px; padding:1px 8px; color:#9FB0C8; font-weight:700; }
.nitem .cnt.hot { background:#FD0E33; color:#fff; }
.main { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.topbar { display:flex; align-items:center; gap:10px; background:#fff; border-bottom:1px solid #E1E7EC; padding:9px 20px; }
.topbar .ttl { font-size:15px; font-weight:800; color:#112138; margin-right:auto; }
.saved { font-size:11px; color:#5C6675; }
.content { flex:1; overflow-y:auto; padding:18px 20px 44px; }
.h1 { font-size:18px; font-weight:800; color:#112138; margin:0 0 2px; letter-spacing:-.2px; }
.h1::after { content:"."; color:#FD0E33; }
.h2 { font-size:10.5px; font-weight:900; color:#FD0E33; margin:20px 0 8px; text-transform:uppercase; letter-spacing:1.8px; }
.h2:first-child { margin-top:0; }
.sub { font-size:12px; color:#5C6675; margin:0 0 12px; }
.card { background:#fff; border:1px solid #E1E7EC; border-radius:12px; padding:13px 15px; }
.grid { display:grid; gap:10px; }
.stat { background:#fff; border:1px solid #E1E7EC; border-radius:12px; padding:9px 13px; cursor:pointer; }
.stat:hover { border-color:#112138; }
.stat .n { font-size:21px; font-weight:800; color:#112138; line-height:1.1; }
.stat .n.bad { color:#FD0E33; } .stat .n.warn { color:#B45309; }
.stat .l { font-size:9.5px; text-transform:uppercase; letter-spacing:1px; color:#5C6675; font-weight:700; margin-top:2px; }
.btn { display:inline-flex; align-items:center; gap:5px; background:#fff; border:1.5px solid #C7CFD8; border-radius:999px; padding:4px 13px; font-size:12px; font-weight:700; color:#112138; cursor:pointer; font-family:inherit; }
.btn:hover { border-color:#112138; }
.btn.pri { background:#FD0E33; border-color:#FD0E33; color:#fff; }
.btn.pri:hover { background:#D90C2B; border-color:#D90C2B; }
.btn.danger { background:#fff; border-color:#FD0E33; color:#FD0E33; }
.btn.danger:hover { background:#FD0E33; color:#fff; }
.btn.sm { padding:2px 10px; font-size:11px; }
.btn:disabled { opacity:.45; cursor:default; }
.input, .select, .ta { font-family:inherit; font-size:12.5px; font-weight:500; color:#112138; background:#fff; border:1.5px solid #C7CFD8; border-radius:9px; padding:5px 10px; width:100%; }
.input:focus, .select:focus, .ta:focus, .btn:focus-visible { outline:2px solid #112138; outline-offset:1px; }
.ta { resize:vertical; min-height:60px; }
.frow { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:8px 12px; }
.flab { font-size:9.5px; text-transform:uppercase; letter-spacing:1.1px; color:#5C6675; display:block; margin:0 0 3px; font-weight:800; }
.badge { display:inline-block; font-size:10px; font-weight:800; padding:1px 9px; border-radius:999px; border:1px solid transparent; white-space:nowrap; letter-spacing:.2px; }
.bg-crit { background:#FD0E33; color:#fff; }
.bg-high { background:#FDEBD3; color:#8A4B04; border-color:#EBCA9B; }
.bg-med { background:#E4EBF7; color:#1D4C9C; border-color:#C9D7EF; }
.bg-low { background:#EDF1F2; color:#5C6675; border-color:#DCE3E8; }
.bg-park { background:#F4F6F7; color:#8A93A1; border-color:#E1E7EC; }
.rag { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:5px; vertical-align:baseline; }
.rag.R { background:#FD0E33; } .rag.A { background:#D97706; } .rag.G { background:#1A7F44; } .rag.N { background:#C7CFD8; }
.tbl { width:100%; border-collapse:separate; border-spacing:0; background:#fff; border:1px solid #E1E7EC; border-radius:12px; overflow:hidden; }
.tbl th { text-align:left; font-size:9.5px; text-transform:uppercase; letter-spacing:1.1px; color:#5C6675; font-weight:800; padding:8px 10px; border-bottom:2px solid #112138; background:#fff; cursor:pointer; user-select:none; white-space:nowrap; position:sticky; top:0; }
.tbl td { padding:6px 10px; border-bottom:1px solid #EEF1F4; font-size:12px; vertical-align:top; }
.tbl tr:last-child td { border-bottom:none; }
.tbl tr:hover td { background:#F7F9FA; }
.tbl tr.click { cursor:pointer; }
.tag { display:inline-block; font-size:10.5px; background:#EDF1F2; border:1px solid #DCE3E8; border-radius:999px; padding:0 8px; color:#414B5A; margin:0 3px 3px 0; }
.alert-row { display:flex; align-items:center; gap:10px; padding:8px 12px; background:#fff; border:1px solid #E1E7EC; border-left-width:4px; border-radius:10px; margin-bottom:6px; cursor:pointer; }
.alert-row:hover { border-color:#112138; border-left-color:inherit; }
.sev3 { border-left-color:#FD0E33; } .sev2 { border-left-color:#D97706; } .sev1 { border-left-color:#9AA5B1; }
.modal-bg { position:fixed; inset:0; background:rgba(17,33,56,.6); display:flex; align-items:flex-start; justify-content:center; z-index:50; padding:30px 16px; overflow-y:auto; }
.modal { background:#fff; border-radius:16px; width:min(880px,100%); border-top:4px solid #FD0E33; padding:18px 22px 22px; margin-bottom:40px; }
.modal.narrow { width:min(560px,100%); }
.kwrap { display:flex; gap:10px; overflow-x:auto; align-items:flex-start; padding-bottom:10px; }
.kcol { background:#E4E9ED; border:1px solid #DCE3E8; border-radius:12px; min-width:230px; width:230px; flex:none; }
.kcol h4 { margin:0; padding:8px 12px; font-size:9.5px; text-transform:uppercase; letter-spacing:1.4px; color:#414B5A; font-weight:900; border-bottom:1px solid #D5DCE2; display:flex; justify-content:space-between; }
.kbody { padding:7px; min-height:80px; max-height:calc(100vh - 300px); overflow-y:auto; }
.kcard { background:#fff; border:1px solid #DCE3E8; border-radius:10px; padding:8px 10px; margin-bottom:6px; cursor:grab; font-size:12px; }
.kcard:hover { border-color:#112138; }
.kcard .kt { font-weight:700; color:#112138; margin-bottom:3px; }
.kmeta { display:flex; flex-wrap:wrap; gap:4px; align-items:center; font-size:10.5px; color:#5C6675; }
.chip { font-size:10px; border:1px solid #DCE3E8; border-radius:999px; padding:0 7px; background:#F5F7F8; font-weight:600; }
.warnbox { background:#FFF3F5; border:1px solid #F8C0CB; border-left:4px solid #FD0E33; border-radius:10px; padding:9px 13px; font-size:12px; color:#87102A; margin-bottom:10px; }
.notebox { background:#F2F6FD; border:1px solid #C9D7EF; border-left:4px solid #1D5FBF; border-radius:10px; padding:9px 13px; font-size:12px; color:#173E7E; margin-bottom:10px; }
.okbox { background:#F0F8F2; border:1px solid #BFE0C8; border-left:4px solid #1A7F44; border-radius:10px; padding:9px 13px; font-size:12px; color:#0F5C2E; margin-bottom:10px; }
.empty { padding:24px; text-align:center; color:#5C6675; background:#fff; border:1.5px dashed #C7CFD8; border-radius:12px; font-size:12.5px; }
.toolrow { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:10px; }
.toolrow .select, .toolrow .input { width:auto; min-width:120px; }
.mono { font-family:Consolas,'SF Mono',monospace; font-size:11px; color:#5C6675; }
.linkish { color:#1D5FBF; cursor:pointer; text-decoration:none; font-weight:600; }
.linkish:hover { text-decoration:underline; }
.prog { height:7px; background:#E4E9ED; border-radius:999px; overflow:hidden; }
.prog > div { height:100%; background:#112138; border-radius:999px; }
.checkline { display:flex; gap:8px; align-items:flex-start; padding:6px 8px; border-bottom:1px solid #EEF1F4; }
pre.report { white-space:pre-wrap; font-family:inherit; font-size:12.5px; background:#fff; border:1px solid #E1E7EC; border-radius:12px; padding:14px 16px; line-height:1.55; }
@media (max-width: 900px) { .side { width:64px; min-width:64px; } .side .b2,.ngroup,.nitem span.lbl { display:none; } .side-brand .blogo { width:44px; } .nitem { justify-content:center; } }
`;

const Badge = ({ p }) => {
  const cls = p === "Critical" ? "bg-crit" : p === "High" ? "bg-high" : p === "Medium" ? "bg-med" : p === "Low" ? "bg-low" : "bg-park";
  return <span className={"badge " + cls}>{p}</span>;
};
const Rag = ({ v }) => <span className={"rag " + (v === "Red" ? "R" : v === "Amber" ? "A" : v === "Green" ? "G" : "N")} title={v || "No RAG"} />;
const Stat = ({ n, l, tone, onClick }) => (
  <div className="stat" onClick={onClick} role="button" tabIndex={0}>
    <div className={"n" + (tone ? " " + tone : "")}>{n}</div>
    <div className="l">{l}</div>
  </div>
);
const F = ({ label, children, span }) => (
  <div style={span ? { gridColumn: "1 / -1" } : null}>
    <label className="flab">{label}</label>
    {children}
  </div>
);

function useSortable(rows, initKey) {
  const [sort, setSort] = useState({ key: initKey, dir: 1 });
  const sorted = useMemo(() => {
    const r = [...rows];
    r.sort((a, b) => {
      const va = a[sort.key] ?? "", vb = b[sort.key] ?? "";
      if (va === vb) return 0;
      if (va === "" || va === null) return 1;
      if (vb === "" || vb === null) return -1;
      return (va > vb ? 1 : -1) * sort.dir;
    });
    return r;
  }, [rows, sort]);
  const th = (key, label) => (
    <th onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
  return [sorted, th];
}

function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
  const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
  return Promise.resolve();
}
function downloadFile(name, text, type) {
  const blob = new Blob([text], { type: type || "text/plain" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
function toCSV(rows, cols) {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.map((c) => esc(c[0])).join(",")].concat(rows.map((r) => cols.map((c) => esc(typeof c[1] === "function" ? c[1](r) : r[c[1]])).join(","))).join("\n");
}

/* helpers over data */
const projName = (d, id) => (d.projects.find((p) => p.id === id) || {}).name || "";
const mobName = (d, id) => (d.mobs.find((m) => m.id === id) || {}).name || "";
const parentLabel = (d, w) => w.project ? projName(d, w.project) : w.mob ? mobName(d, w.mob) : "";
const openItems = (d) => d.workItems.filter((w) => OPEN_STATUSES.includes(w.status));
const isOverdue = (w) => OPEN_STATUSES.includes(w.status) && w.due && daysUntil(w.due) < 0;

function projectHealth(d, p) {
  const items = d.workItems.filter((w) => w.project === p.id);
  const overdue = items.filter(isOverdue).length;
  const critRisks = items.filter((w) => w.type === "Risk" && OPEN_STATUSES.includes(w.status) && (w.extra?.rating === "Critical" || w.priority === "Critical")).length;
  const decis = items.filter((w) => w.type === "Decision" && OPEN_STATUSES.includes(w.status)).length;
  const stale = daysSince(p.updatedAt) > (d.settings.staleProject || 21);
  let score = 0;
  if (p.rag === "Red") score += 3; else if (p.rag === "Amber") score += 1;
  score += Math.min(overdue, 3) + critRisks * 2 + Math.min(decis, 2) + (stale ? 2 : 0);
  if (p.confidence === "Low") score += 2;
  const label = score >= 6 ? "Intervention needed" : score >= 3 ? "Watch" : "Healthy";
  return { score, label, overdue, critRisks, decis, stale };
}
function mobReadiness(m) {
  const cl = m.checklist || [];
  if (!cl.length) return { pct: 0, byWs: {} };
  const done = cl.filter((c) => c.status === "Done").length;
  const byWs = {};
  cl.forEach((c) => { byWs[c.workstream] = byWs[c.workstream] || { t: 0, d: 0 }; byWs[c.workstream].t++; if (c.status === "Done") byWs[c.workstream].d++; });
  return { pct: Math.round((done / cl.length) * 100), byWs };
}

/* alert engine */
function computeAlerts(d) {
  const A = []; const s = d.settings;
  const push = (sev, text, nav, id) => A.push({ key: text, sev, text, nav, id });
  d.workItems.filter((w) => OPEN_STATUSES.includes(w.status)).forEach((w) => {
    const du = daysUntil(w.due);
    if (du !== null && du < 0) push(w.priority === "Critical" ? 3 : 2, `Overdue ${Math.abs(du)}d — ${w.title}`, "item", w.id);
    else if (du !== null && du <= 3 && ["Critical", "High"].includes(w.priority)) push(2, `${w.priority} due in ${du}d — ${w.title}`, "item", w.id);
    if (w.status === "Blocked") push(w.priority === "Critical" ? 3 : 2, `Blocked — ${w.title}${w.blocker ? " (" + w.blocker + ")" : ""}`, "item", w.id);
    if (w.status === "Waiting") { const nc = daysUntil(w.nextChase); if (w.nextChase && nc <= 0) push(2, `Chase due — ${w.title} (waiting on ${w.waitingOn || "unassigned"})`, "item", w.id); if (!w.nextChase) push(1, `Waiting with no chase date — ${w.title}`, "item", w.id); }
    if (daysSince(w.updatedAt) > s.staleItem) push(1, `Not updated for ${daysSince(w.updatedAt)}d — ${w.title}`, "item", w.id);
    if (["Critical", "High"].includes(w.priority) && !w.nextAction) push(1, `No next action — ${w.title}`, "item", w.id);
    if (w.type === "Decision") { const rb = daysUntil(w.extra?.requiredBy || w.due); if (rb !== null && rb < 0 && w.extra?.decisionStatus !== "Decided") push(3, `Decision beyond required date — ${w.title}`, "item", w.id); }
    if (w.type === "Risk" && !w.extra?.mitigation) push(2, `Risk without mitigation — ${w.title}`, "item", w.id);
    if (w.type === "Issue" && !w.extra?.corrective) push(1, `Issue without corrective action — ${w.title}`, "item", w.id);
    if (w.type === "Commitment" && du !== null && du <= 7) push(2, `Commitment due ${du < 0 ? Math.abs(du) + "d ago" : "in " + du + "d"} — ${w.title}`, "item", w.id);
  });
  d.workItems.filter((w) => w.status === "Done" && !w.outcome && daysSince(w.completed) <= 30).forEach((w) => push(1, `Completed without recorded outcome — ${w.title}`, "item", w.id));
  d.projects.filter((p) => !["Closed", "Cancelled"].includes(p.stage)).forEach((p) => {
    if (p.rag === "Red") push(3, `Project RED — ${p.name}`, "project", p.id);
    if (daysSince(p.updatedAt) > s.staleProject) push(2, `Project not updated for ${daysSince(p.updatedAt)}d — ${p.name}`, "project", p.id);
    if (!p.nextMilestone && p.stage !== "On Hold") push(1, `No next milestone — ${p.name}`, "project", p.id);
  });
  d.mobs.filter((m) => !["Closed"].includes(m.stage)).forEach((m) => {
    const g = daysUntil(m.goLive);
    if (m.rag === "Red") push(3, `Mobilisation RED — ${m.name}`, "mob", m.id);
    if (g !== null && g >= 0 && g <= 30) push(g <= 7 ? 3 : 2, `Go-live in ${g}d — ${m.name}`, "mob", m.id);
    if (daysSince(m.updatedAt) > s.staleMob) push(2, `Mobilisation not updated for ${daysSince(m.updatedAt)}d — ${m.name}`, "mob", m.id);
    (m.checklist || []).filter((c) => c.signOff && !c.signedOff && daysUntil(c.due) !== null && daysUntil(c.due) <= 7).forEach((c) => push(2, `Sign-off outstanding — ${c.requirement} (${m.name})`, "mob", m.id));
  });
  const inboxOld = d.workItems.filter((w) => w.status === "Inbox" && daysSince(w.created) > 7).length;
  if (inboxOld) push(1, `${inboxOld} inbox item${inboxOld > 1 ? "s" : ""} unprocessed for over 7 days`, "capture");
  const dismissed = new Set((d.dismissedAlerts || []).filter((x) => x.date === todayISO()).map((x) => x.key));
  return A.filter((a) => !dismissed.has(a.key)).sort((a, b) => b.sev - a.sev);
}

/* ---------- in-app confirm / prompt (native dialogs are blocked in sandboxed frames) ---------- */
let _askFn = null;
function registerAsk(fn) { _askFn = fn; }
function askConfirm(message) {
  if (_askFn) return _askFn({ kind: "confirm", message });
  return Promise.resolve(window.confirm(message));
}
function askPrompt(message) {
  if (_askFn) return _askFn({ kind: "prompt", message });
  return Promise.resolve(window.prompt(message));
}
function AskDialog({ req, onResolve }) {
  const [val, setVal] = useState("");
  useEffect(() => { setVal(""); }, [req]);
  if (!req) return null;
  const isPrompt = req.kind === "prompt";
  return (
    <div className="modal-bg" style={{ zIndex: 90, alignItems: "center" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onResolve(isPrompt ? null : false); }}>
      <div className="modal narrow" style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 12, lineHeight: 1.5 }}>{req.message}</div>
        {isPrompt && <input className="input" autoFocus value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onResolve(val); if (e.key === "Escape") onResolve(null); }} />}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn" onClick={() => onResolve(isPrompt ? null : false)}>Cancel</button>
          <button className="btn pri" autoFocus={!isPrompt} onClick={() => onResolve(isPrompt ? val : true)}>{isPrompt ? "Save" : "Yes, continue"}</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Work item modal (create / edit)
   ============================================================ */
function WorkItemModal({ data, item, onSave, onDelete, onClose }) {
  const isNew = !item.id;
  const [w, setW] = useState(() => ({
    id: item.id || uid(), title: "", description: "", type: "Action", status: "Inbox", priority: "Medium",
    owner: "Me", waitingOn: "", project: "", mob: "", workstream: "", country: data.settings.defaultCountry || "UK",
    client: "", due: "", nextChase: "", lastChased: "", completed: "", created: todayISO(), updatedAt: todayISO(),
    rag: "", nextAction: "", blocker: "", horizon: "Next", rank: 50,
    flags: { board: false, coo: false, news: false, groupWeekly: false, ukWeekly: false },
    confidentiality: "General internal", notes: [], extra: {}, outcome: "", ...JSON.parse(JSON.stringify(item)),
  }));
  const [note, setNote] = useState("");
  const set = (k, v) => setW((x) => ({ ...x, [k]: v }));
  const setX = (k, v) => setW((x) => ({ ...x, extra: { ...x.extra, [k]: v } }));
  const save = () => {
    if (!w.title.trim()) return alert("A title is required.");
    const out = { ...w, updatedAt: todayISO() };
    if (note.trim()) out.notes = [...(out.notes || []), { ts: todayISO(), text: note.trim() }];
    if (out.status === "Done" && !out.completed) out.completed = todayISO();
    onSave(out, isNew);
  };
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 className="h1">{isNew ? "New work item" : "Edit work item"} <span className="mono">{isNew ? "" : "#" + w.id}</span></h3>
          <button className="btn sm" onClick={onClose}>Close ✕</button>
        </div>
        <div className="frow" style={{ marginTop: 10 }}>
          <F label="Title" span><input className="input" value={w.title} autoFocus onChange={(e) => set("title", e.target.value)} placeholder="Short, action-led title" /></F>
          <F label="Type"><select className="select" value={w.type} onChange={(e) => set("type", e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></F>
          <F label="Status"><select className="select" value={w.status} onChange={(e) => set("status", e.target.value)}>{STATUSES.map((t) => <option key={t}>{t}</option>)}</select></F>
          <F label="Manual priority"><select className="select" value={w.priority} onChange={(e) => set("priority", e.target.value)}>{PRIORITIES.map((t) => <option key={t}>{t}</option>)}</select></F>
          <F label="Owner"><input className="input" value={w.owner} onChange={(e) => set("owner", e.target.value)} /></F>
          <F label="Waiting on"><input className="input" value={w.waitingOn} onChange={(e) => set("waitingOn", e.target.value)} placeholder="Person / team" /></F>
          <F label="Due date"><input type="date" className="input" value={w.due} onChange={(e) => set("due", e.target.value)} /></F>
          <F label="Project"><select className="select" value={w.project} onChange={(e) => set("project", e.target.value)}><option value="">—</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></F>
          <F label="Mobilisation"><select className="select" value={w.mob} onChange={(e) => set("mob", e.target.value)}><option value="">—</option>{data.mobs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></F>
          <F label="Workstream"><select className="select" value={w.workstream} onChange={(e) => set("workstream", e.target.value)}><option value="">—</option>{WORKSTREAMS.map((t) => <option key={t}>{t}</option>)}</select></F>
          <F label="Country"><select className="select" value={w.country} onChange={(e) => set("country", e.target.value)}><option value="">—</option>{COUNTRIES.map((t) => <option key={t}>{t}</option>)}</select></F>
          <F label="Description" span><textarea className="ta" value={w.description} onChange={(e) => set("description", e.target.value)} /></F>
          <F label="Next action" span><input className="input" value={w.nextAction} onChange={(e) => set("nextAction", e.target.value)} placeholder="The very next physical step" /></F>
          {(w.status === "Blocked" || w.blocker) && <F label="Blocker / reason" span><input className="input" value={w.blocker} onChange={(e) => set("blocker", e.target.value)} /></F>}
          {(w.status === "Waiting") && <>
            <F label="Last chased"><input type="date" className="input" value={w.lastChased} onChange={(e) => set("lastChased", e.target.value)} /></F>
            <F label="Next chase"><input type="date" className="input" value={w.nextChase} onChange={(e) => set("nextChase", e.target.value)} /></F>
          </>}
          {w.status === "Done" && <F label="Outcome delivered" span><textarea className="ta" value={w.outcome} onChange={(e) => set("outcome", e.target.value)} placeholder="What was actually delivered / the benefit" /></F>}
        </div>

        {w.type === "Risk" && <>
          <div className="h2">Risk detail</div>
          <div className="frow">
            <F label="Likelihood"><select className="select" value={w.extra.likelihood || ""} onChange={(e) => setX("likelihood", e.target.value)}><option value="">—</option>{["Low","Medium","High"].map((t) => <option key={t}>{t}</option>)}</select></F>
            <F label="Impact"><select className="select" value={w.extra.impactRating || ""} onChange={(e) => setX("impactRating", e.target.value)}><option value="">—</option>{["Low","Medium","High"].map((t) => <option key={t}>{t}</option>)}</select></F>
            <F label="Overall rating"><select className="select" value={w.extra.rating || ""} onChange={(e) => setX("rating", e.target.value)}><option value="">—</option>{["Low","Moderate","High","Critical"].map((t) => <option key={t}>{t}</option>)}</select></F>
            <F label="Mitigation" span><input className="input" value={w.extra.mitigation || ""} onChange={(e) => setX("mitigation", e.target.value)} /></F>
            <F label="Contingency" span><input className="input" value={w.extra.contingency || ""} onChange={(e) => setX("contingency", e.target.value)} /></F>
          </div></>}
        {w.type === "Issue" && <>
          <div className="h2">Issue detail</div>
          <div className="frow">
            <F label="Root cause" span><input className="input" value={w.extra.rootCause || ""} onChange={(e) => setX("rootCause", e.target.value)} /></F>
            <F label="Corrective action" span><input className="input" value={w.extra.corrective || ""} onChange={(e) => setX("corrective", e.target.value)} /></F>
          </div></>}
        {w.type === "Dependency" && <>
          <div className="h2">Dependency detail</div>
          <div className="frow">
            <F label="External owner"><input className="input" value={w.extra.externalOwner || ""} onChange={(e) => setX("externalOwner", e.target.value)} /></F>
            <F label="Required date"><input type="date" className="input" value={w.extra.requiredDate || ""} onChange={(e) => setX("requiredDate", e.target.value)} /></F>
            <F label="Confidence"><select className="select" value={w.extra.confidence || ""} onChange={(e) => setX("confidence", e.target.value)}><option value="">—</option>{["High","Medium","Low"].map((t) => <option key={t}>{t}</option>)}</select></F>
            <F label="Impact if missed" span><input className="input" value={w.extra.impactIfMissed || ""} onChange={(e) => setX("impactIfMissed", e.target.value)} /></F>
          </div></>}
        {w.type === "Decision" && <>
          <div className="h2">Decision detail</div>
          <div className="frow">
            <F label="Decision status"><select className="select" value={w.extra.decisionStatus || "Required"} onChange={(e) => setX("decisionStatus", e.target.value)}>{DECISION_STATUSES.map((t) => <option key={t}>{t}</option>)}</select></F>
            <F label="Required by"><input type="date" className="input" value={w.extra.requiredBy || ""} onChange={(e) => setX("requiredBy", e.target.value)} /></F>
            <F label="Decision owner"><input className="input" value={w.extra.decisionOwner || ""} onChange={(e) => setX("decisionOwner", e.target.value)} /></F>
            <F label="Recommended option" span><input className="input" value={w.extra.recommended || ""} onChange={(e) => setX("recommended", e.target.value)} /></F>
            <F label="Decision made" span><input className="input" value={w.extra.decisionMade || ""} onChange={(e) => setX("decisionMade", e.target.value)} /></F>
            <F label="Rationale" span><input className="input" value={w.extra.rationale || ""} onChange={(e) => setX("rationale", e.target.value)} /></F>
          </div></>}
        {w.type === "Commitment" && <>
          <div className="h2">Commitment detail</div>
          <div className="frow">
            <F label="Made to"><input className="input" value={w.extra.madeTo || ""} onChange={(e) => setX("madeTo", e.target.value)} /></F>
            <F label="Made by"><input className="input" value={w.extra.madeBy || "Me"} onChange={(e) => setX("madeBy", e.target.value)} /></F>
            <F label="Confidence"><select className="select" value={w.extra.confidence || ""} onChange={(e) => setX("confidence", e.target.value)}><option value="">—</option>{["High","Medium","Low"].map((t) => <option key={t}>{t}</option>)}</select></F>
          </div></>}

        <div className="h2">Reporting flags</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[["board", "Board Pack"], ["coo", "COO Update"], ["news", "Newsletter"], ["groupWeekly", "Group Ops Weekly Review"], ["ukWeekly", "UK Ops & Aviation Weekly Review"]].map(([k, l]) => (
            <label key={k} style={{ fontSize: 12.5, display: "flex", gap: 5, alignItems: "center" }}>
              <input type="checkbox" checked={!!w.flags[k]} onChange={(e) => setW((x) => ({ ...x, flags: { ...x.flags, [k]: e.target.checked } }))} />{l}
            </label>))}
        </div>

        <div className="h2">Update history</div>
        {(w.notes || []).length === 0 && <div className="sub">No updates recorded yet.</div>}
        {(w.notes || []).slice().reverse().map((n, i) => <div key={i} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #EDEFF2" }}><span className="mono">{fmtD(n.ts)}</span> — {n.text}</div>)}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input className="input" placeholder="Add an update note…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          {!isNew && <button className="btn danger" onClick={async () => { if (await askConfirm("Delete this work item permanently? (Completed items can be archived instead by marking Done.)")) onDelete(w.id); }}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" onClick={save}>{isNew ? "Create work item" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

/* generic work-item table */
function ItemsTable({ data, rows, onOpen, cols }) {
  const enriched = useMemo(() => rows.map((w) => ({ ...w, _parent: parentLabel(data, w), _prio: prioRank(w.priority) })), [rows, data]);
  const [sorted, th] = useSortable(enriched, "_prio");
  const all = cols || ["title", "type", "status", "priority", "owner", "parent", "due", "updated"];
  if (!rows.length) return <div className="empty">Nothing here. That is either very good news or a filter worth checking.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="tbl"><thead><tr>
        {all.includes("title") && th("title", "Title")}
        {all.includes("type") && th("type", "Type")}
        {all.includes("status") && th("status", "Status")}
        {all.includes("priority") && th("_prio", "Priority")}
        {all.includes("owner") && th("owner", "Owner")}
        {all.includes("waitingOn") && th("waitingOn", "Waiting on")}
        {all.includes("parent") && th("_parent", "Project / Mob")}
        {all.includes("country") && th("country", "Country")}
        {all.includes("due") && th("due", "Due")}
        {all.includes("nextChase") && th("nextChase", "Next chase")}
        {all.includes("updated") && th("updatedAt", "Updated")}
      </tr></thead>
      <tbody>{sorted.map((w) => (
        <tr key={w.id} className="click" onClick={() => onOpen(w)}>
          {all.includes("title") && <td><Rag v={w.rag} />{w.title}{w.demo ? <span className="chip" style={{ marginLeft: 5 }}>demo</span> : null}</td>}
          {all.includes("type") && <td>{w.type}</td>}
          {all.includes("status") && <td>{w.status}</td>}
          {all.includes("priority") && <td><Badge p={w.priority} /></td>}
          {all.includes("owner") && <td>{w.owner}</td>}
          {all.includes("waitingOn") && <td>{w.waitingOn || "—"}</td>}
          {all.includes("parent") && <td>{w._parent || "—"}</td>}
          {all.includes("country") && <td>{w.country || "—"}</td>}
          {all.includes("due") && <td style={isOverdue(w) ? { color: "#FD0E33", fontWeight: 600 } : null}>{fmtD(w.due)}</td>}
          {all.includes("nextChase") && <td>{fmtD(w.nextChase)}</td>}
          {all.includes("updated") && <td className="mono">{fmtD(w.updatedAt)}</td>}
        </tr>))}
      </tbody></table>
    </div>
  );
}

/* ============================================================
   Command Centre
   ============================================================ */
function CommandCentre({ data, mutate, openItem, go, openProject, openMob }) {
  const [focus, setFocus] = useState("All");
  const alerts = useMemo(() => computeAlerts(data), [data]);
  const open = openItems(data);
  const overdue = open.filter(isOverdue);
  const due7 = open.filter((w) => { const d = daysUntil(w.due); return d !== null && d >= 0 && d <= 7; });
  const dueToday = open.filter((w) => daysUntil(w.due) === 0);
  const blocked = open.filter((w) => w.status === "Blocked");
  const waiting = open.filter((w) => w.status === "Waiting");
  const chaseDue = waiting.filter((w) => !w.nextChase || daysUntil(w.nextChase) <= 0);
  const decisions = open.filter((w) => w.type === "Decision");
  const commitments = open.filter((w) => w.type === "Commitment");
  const stale = open.filter((w) => daysSince(w.updatedAt) > data.settings.staleItem);
  const top5 = open.filter((w) => w.horizon === "Now").sort((a, b) => (a.rank || 99) - (b.rank || 99)).slice(0, 5);
  const doneRecent = data.workItems.filter((w) => w.status === "Done" && daysSince(w.completed) <= 7);
  const activeProjects = data.projects.filter((p) => !["Closed", "Cancelled"].includes(p.stage));
  const ragCount = (r) => activeProjects.filter((p) => p.rag === r).length;
  const activeMobs = data.mobs.filter((m) => m.stage !== "Closed");
  const milestones = [...activeProjects.filter((p) => p.nextMilestone && p.nextMilestoneDate).map((p) => ({ d: p.nextMilestoneDate, t: p.nextMilestone + " — " + p.name, go: () => openProject(p.id) })),
    ...activeMobs.map((m) => ({ d: m.goLive, t: "Go-live — " + m.name, go: () => openMob(m.id) }))].filter((x) => x.d && daysUntil(x.d) >= -1).sort((a, b) => a.d.localeCompare(b.d)).slice(0, 6);
  const dismiss = (key) => mutate((d) => { d.dismissedAlerts = [...(d.dismissedAlerts || []), { key, date: todayISO() }]; return d; }, null);
  const navAlert = (a) => {
    if (a.nav === "item") { const w = data.workItems.find((x) => x.id === a.id); if (w) openItem(w); }
    else if (a.nav === "project") openProject(a.id);
    else if (a.nav === "mob") openMob(a.id);
    else if (a.nav === "capture") go("capture");
  };
  const show = (k) => focus === "All" || focus === k;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 className="h1">Command Centre</h2>
        <span className="sub" style={{ margin: 0 }}>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {["All", "Today", "This week", "Executive", "Mobilisations", "Projects"].map((f) => (
            <button key={f} className={"btn sm" + (focus === f ? " pri" : "")} onClick={() => setFocus(f)}>{f}</button>))}
        </div>
      </div>

      {show("Today") || show("Executive") ? <>
        <div className="h2">What needs my attention</div>
        {alerts.length === 0 && <div className="okbox">No exceptions raised. Everything with a date, owner and next action is under control.</div>}
        <div>{alerts.slice(0, focus === "All" ? 12 : 25).map((a) => (
          <div key={a.key} className={"alert-row sev" + a.sev} onClick={() => navAlert(a)}>
            <span style={{ flex: 1 }}>{a.text}</span>
            <button className="btn sm" onClick={(e) => { e.stopPropagation(); dismiss(a.key); }} title="Dismiss for today">Snooze</button>
          </div>))}
          {alerts.length > 12 && focus === "All" && <div className="sub">{alerts.length - 12} further alerts — use a focus filter above to see all.</div>}
        </div></> : null}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", marginTop: 14 }}>
        <Stat n={overdue.length} l="Overdue" tone={overdue.length ? "bad" : ""} onClick={() => go("actions")} />
        <Stat n={dueToday.length} l="Due today" onClick={() => go("actions")} />
        <Stat n={due7.length} l="Due in 7 days" onClick={() => go("actions")} />
        <Stat n={blocked.length} l="Blocked" tone={blocked.length ? "bad" : ""} onClick={() => go("actions")} />
        <Stat n={waiting.length} l="Waiting on others" onClick={() => go("waiting")} />
        <Stat n={chaseDue.length} l="Due for chase" tone={chaseDue.length ? "warn" : ""} onClick={() => go("waiting")} />
        <Stat n={decisions.length} l="Decisions open" onClick={() => go("decisions")} />
        <Stat n={commitments.length} l="Commitments open" onClick={() => go("decisions")} />
        <Stat n={stale.length} l={"Stale >" + data.settings.staleItem + "d"} tone={stale.length ? "warn" : ""} onClick={() => go("actions")} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14, alignItems: "start" }}>
        {(show("Today") || show("This week") || show("Executive")) && <div className="card">
          <div className="h2" style={{ marginTop: 0 }}>My top five priorities</div>
          {top5.length === 0 && <div className="sub">Nothing marked "Now" yet — set horizons in My Priorities.</div>}
          {top5.map((w, i) => (
            <div key={w.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => openItem(w)}>
              <span className="mono" style={{ width: 16 }}>{i + 1}</span>
              <span style={{ flex: 1 }}><Rag v={w.rag} />{w.title}</span>
              <Badge p={w.priority} />
              <span className="mono">{fmtD(w.due)}</span>
            </div>))}
        </div>}
        {(show("Projects") || show("Executive")) && <div className="card">
          <div className="h2" style={{ marginTop: 0 }}>Project portfolio</div>
          <div style={{ display: "flex", gap: 14, marginBottom: 8, fontSize: 12.5 }}>
            <span><Rag v="Red" />{ragCount("Red")} Red</span><span><Rag v="Amber" />{ragCount("Amber")} Amber</span><span><Rag v="Green" />{ragCount("Green")} Green</span>
            <span className="linkish" style={{ marginLeft: "auto" }} onClick={() => go("projects")}>Open portfolio →</span>
          </div>
          {activeProjects.slice(0, 6).map((p) => { const h = projectHealth(data, p); return (
            <div key={p.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => openProject(p.id)}>
              <span style={{ flex: 1 }}><Rag v={p.rag} />{p.name}</span>
              <span className="chip">{p.stage}</span>
              <span className="chip" style={h.label !== "Healthy" ? { color: "#FD0E33", borderColor: "#F3C2CB" } : null}>{h.label}</span>
            </div>); })}
        </div>}
        {(show("Mobilisations") || show("Executive")) && <div className="card">
          <div className="h2" style={{ marginTop: 0 }}>Mobilisation readiness</div>
          {activeMobs.length === 0 && <div className="sub">No active mobilisations.</div>}
          {activeMobs.map((m) => { const r = mobReadiness(m); const g = daysUntil(m.goLive); return (
            <div key={m.id} style={{ padding: "6px 0", borderBottom: "1px solid #EDEFF2", cursor: "pointer" }} onClick={() => openMob(m.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span><Rag v={m.rag} /><b>{m.name}</b></span>
                <span className="mono">{g !== null ? (g >= 0 ? g + "d to go-live" : "live " + Math.abs(g) + "d") : ""}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
                <div className="prog" style={{ flex: 1 }}><div style={{ width: r.pct + "%" }} /></div>
                <span className="mono">{r.pct}% ready</span>
              </div>
            </div>); })}
        </div>}
        {(show("Today") || show("This week")) && <div className="card">
          <div className="h2" style={{ marginTop: 0 }}>Upcoming milestones & go-lives</div>
          {milestones.length === 0 && <div className="sub">No dated milestones on record.</div>}
          {milestones.map((m, i) => (
            <div key={i} className="checkline" style={{ cursor: "pointer" }} onClick={m.go}>
              <span className="mono" style={{ width: 74 }}>{fmtD(m.d)}</span><span style={{ flex: 1 }}>{m.t}</span>
              <span className="mono">{daysUntil(m.d)}d</span>
            </div>))}
        </div>}
        {(show("Executive") || show("This week")) && <div className="card">
          <div className="h2" style={{ marginTop: 0 }}>Completed this week</div>
          {doneRecent.length === 0 && <div className="sub">Nothing closed in the last 7 days.</div>}
          {doneRecent.map((w) => (
            <div key={w.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => openItem(w)}>
              <span style={{ flex: 1 }}>{w.title}</span>
              {w.outcome ? <span className="chip" title={w.outcome}>outcome recorded</span> : <span className="chip" style={{ color: "#B45309" }}>no outcome</span>}
            </div>))}
        </div>}
      </div>
    </div>
  );
}

/* ============================================================
   Capture inbox (natural-language + AI parsing + review queue)
   ============================================================ */
function Capture({ data, mutate, openItem }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [proposals, setProposals] = useState([]);
  const inbox = data.workItems.filter((w) => w.status === "Inbox");
  const parse = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr("");
    try {
      const arr = await askClaude(captureParsePrompt(text, data.projects, data.mobs), true, 2000);
      const list = (Array.isArray(arr) ? arr : [arr]).map((p) => ({ ...p, _sel: true, _id: uid() }));
      if (!list.length) setErr("Nothing extractable was found in that text.");
      setProposals(list);
    } catch (e) { setErr("Could not parse that just now (" + (e.message || "AI error") + "). You can still add it as a quick note below."); }
    setBusy(false);
  };
  const quickAdd = () => {
    if (!text.trim()) return;
    mutate((d) => {
      d.workItems.push({ id: uid(), title: text.trim().slice(0, 140), description: text.trim(), type: "Action", status: "Inbox", priority: "Medium", owner: "Me", waitingOn: "", project: "", mob: "", workstream: "", country: d.settings.defaultCountry,
        client: "", due: "", nextChase: "", lastChased: "", completed: "", created: todayISO(), updatedAt: todayISO(), rag: "", nextAction: "", blocker: "",
        horizon: "Next", rank: 50, flags: { board: false, coo: false, news: false, groupWeekly: false, ukWeekly: false }, confidentiality: "General internal", notes: [], extra: {}, outcome: "" });
      return d;
    }, "Quick-captured to inbox");
    setText("");
  };
  const updateProp = (id, k, v) => setProposals((ps) => ps.map((p) => p._id === id ? { ...p, [k]: v } : p));
  const approve = (only) => {
    const chosen = proposals.filter((p) => (only ? p._id === only : p._sel));
    if (!chosen.length) return;
    mutate((d) => {
      chosen.forEach((p) => {
        const proj = d.projects.find((x) => x.name === p.project);
        const mob = d.mobs.find((x) => x.name === p.mobilisation);
        d.workItems.push({ id: uid(), title: p.title || "Untitled", description: p.description || "", type: TYPES.includes(p.type) ? p.type : "Action",
          status: p.waitingOn ? "Waiting" : "Planned", priority: PRIORITIES.includes(p.priority) ? p.priority : "Medium", owner: p.owner || "Me", waitingOn: p.waitingOn || "",
          project: proj ? proj.id : "", mob: mob ? mob.id : "", workstream: p.workstream || "", country: COUNTRIES.includes(p.country) ? p.country : d.settings.defaultCountry,
          client: "", due: p.due || "", nextChase: "", lastChased: "", completed: "", created: todayISO(), updatedAt: todayISO(), rag: "", nextAction: p.nextAction || "",
          blocker: "", horizon: "Next", rank: 50, flags: { board: !!p.flags?.board, coo: !!p.flags?.coo, news: !!p.flags?.news, groupWeekly: false, ukWeekly: false },
          confidentiality: "General internal", notes: [{ ts: todayISO(), text: "Created from capture (AI-proposed, user-approved)" }], extra: {}, outcome: "" });
      });
      return d;
    }, `Approved ${chosen.length} captured item(s)`);
    setProposals((ps) => ps.filter((p) => (only ? p._id !== only : !p._sel)));
    if (!only) setText("");
  };
  return (
    <div>
      <h2 className="h1">Capture Inbox</h2>
      <p className="sub">Type or paste anything — a single action, an email, Teams messages, meeting minutes. Claude proposes structured records; nothing is saved without your approval.</p>
      <div className="card">
        <textarea className="ta" rows={5} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"Type or paste anything here — a note to self, an email, meeting minutes, a list of actions. It will be turned into structured records for you to review."} />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn pri" disabled={busy || !text.trim()} onClick={parse}>{busy ? "Analysing…" : "Propose structured records (AI)"}</button>
          <button className="btn" disabled={!text.trim()} onClick={quickAdd}>Quick add as inbox note</button>
          <span className="sub" style={{ margin: "4px 0 0 auto" }}>AI proposals are marked and never auto-saved.</span>
        </div>
        {err && <div className="warnbox" style={{ marginTop: 8 }}>{err}</div>}
      </div>

      {proposals.length > 0 && <>
        <div className="h2">Proposed records — review before saving</div>
        <div className="notebox">These are AI proposals based only on your text. Check owners and dates: anything not stated has been left blank rather than guessed.</div>
        {proposals.map((p) => (
          <div key={p._id} className="card" style={{ marginBottom: 8, borderLeft: "4px solid #112138" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <input type="checkbox" checked={p._sel} onChange={(e) => updateProp(p._id, "_sel", e.target.checked)} />
              <input className="input" style={{ fontWeight: 600 }} value={p.title || ""} onChange={(e) => updateProp(p._id, "title", e.target.value)} />
            </div>
            <div className="frow">
              <F label="Type"><select className="select" value={p.type || "Action"} onChange={(e) => updateProp(p._id, "type", e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></F>
              <F label="Owner"><input className="input" value={p.owner || ""} onChange={(e) => updateProp(p._id, "owner", e.target.value)} /></F>
              <F label="Waiting on"><input className="input" value={p.waitingOn || ""} onChange={(e) => updateProp(p._id, "waitingOn", e.target.value)} /></F>
              <F label="Due"><input type="date" className="input" value={p.due || ""} onChange={(e) => updateProp(p._id, "due", e.target.value)} /></F>
              <F label="Priority"><select className="select" value={p.priority || "Medium"} onChange={(e) => updateProp(p._id, "priority", e.target.value)}>{PRIORITIES.map((t) => <option key={t}>{t}</option>)}</select></F>
              <F label="Project"><select className="select" value={p.project || ""} onChange={(e) => updateProp(p._id, "project", e.target.value)}><option value="">—</option>{data.projects.map((x) => <option key={x.id}>{x.name}</option>)}</select></F>
              <F label="Mobilisation"><select className="select" value={p.mobilisation || ""} onChange={(e) => updateProp(p._id, "mobilisation", e.target.value)}><option value="">—</option>{data.mobs.map((x) => <option key={x.id}>{x.name}</option>)}</select></F>
              <F label="Country"><select className="select" value={p.country || ""} onChange={(e) => updateProp(p._id, "country", e.target.value)}><option value="">—</option>{COUNTRIES.map((t) => <option key={t}>{t}</option>)}</select></F>
              <F label="Next action" span><input className="input" value={p.nextAction || ""} onChange={(e) => updateProp(p._id, "nextAction", e.target.value)} /></F>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button className="btn sm pri" onClick={() => approve(p._id)}>Approve this</button>
              <button className="btn sm" onClick={() => setProposals((ps) => ps.filter((x) => x._id !== p._id))}>Discard</button>
            </div>
          </div>))}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn pri" onClick={() => approve()}>Approve selected ({proposals.filter((p) => p._sel).length})</button>
          <button className="btn" onClick={() => setProposals([])}>Discard all</button>
        </div>
      </>}

      <div className="h2">Unprocessed inbox ({inbox.length})</div>
      {inbox.some((w) => daysSince(w.created) > 7) && <div className="warnbox">Some inbox items have sat unprocessed for more than 7 days.</div>}
      <ItemsTable data={data} rows={inbox} onOpen={openItem} cols={["title", "type", "priority", "due", "updated"]} />
    </div>
  );
}

/* ============================================================
   My Priorities (Now / Next / Later / Parked with drag & drop)
   ============================================================ */
function Priorities({ data, mutate, openItem }) {
  const open = openItems(data);
  const nowCount = open.filter((w) => w.horizon === "Now").length;
  const drop = (h) => (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("id"); if (!id) return;
    mutate((d) => { const w = d.workItems.find((x) => x.id === id); if (w) { w.horizon = h; w.updatedAt = todayISO(); } return d; }, "Moved to " + h);
  };
  const bump = (id, dir) => mutate((d) => {
    const w = d.workItems.find((x) => x.id === id); if (w) w.rank = clamp((w.rank || 50) + dir, 1, 99); return d;
  }, null);
  const warnings = [];
  if (nowCount > 5) warnings.push(`${nowCount} items are marked "Now" — more than five dilutes focus.`);
  open.filter((w) => ["Critical", "High"].includes(w.priority) && !w.nextAction).slice(0, 3).forEach((w) => warnings.push(`High-priority item without a next action: ${w.title}`));
  open.filter((w) => w.status === "Blocked" && ["Critical", "High"].includes(w.priority)).slice(0, 3).forEach((w) => warnings.push(`High-priority item blocked: ${w.title}`));
  return (
    <div>
      <h2 className="h1">My Priorities</h2>
      <p className="sub">Drag cards between horizons. Order within a column uses the ▲▼ rank controls. The top five "Now" items feed the Command Centre.</p>
      {warnings.map((w, i) => <div key={i} className="warnbox">{w}</div>)}
      <div className="kwrap">
        {HORIZONS.map((h) => {
          const items = open.filter((w) => w.horizon === h).sort((a, b) => (a.rank || 99) - (b.rank || 99) || prioRank(a.priority) - prioRank(b.priority));
          return (
            <div key={h} className="kcol" style={{ minWidth: 265, width: 265 }} onDragOver={(e) => e.preventDefault()} onDrop={drop(h)}>
              <h4>{h}<span>{items.length}</span></h4>
              <div className="kbody">
                {items.map((w) => (
                  <div key={w.id} className="kcard" draggable onDragStart={(e) => e.dataTransfer.setData("id", w.id)}>
                    <div className="kt" onClick={() => openItem(w)} style={{ cursor: "pointer" }}><Rag v={w.rag} />{w.title}</div>
                    <div className="kmeta">
                      <Badge p={w.priority} />
                      {w.due && <span className="chip" style={isOverdue(w) ? { color: "#FD0E33" } : null}>{fmtD(w.due)}</span>}
                      {parentLabel(data, w) && <span className="chip">{parentLabel(data, w)}</span>}
                      {w.status === "Blocked" && <span className="chip" style={{ color: "#FD0E33" }}>Blocked</span>}
                      {w.status === "Waiting" && <span className="chip">Waiting: {w.waitingOn || "?"}</span>}
                      <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                        <button className="btn sm" onClick={() => bump(w.id, -5)} title="Raise">▲</button>
                        <button className="btn sm" onClick={() => bump(w.id, 5)} title="Lower">▼</button>
                      </span>
                    </div>
                  </div>))}
                {!items.length && <div className="sub" style={{ padding: 6 }}>Drop items here.</div>}
              </div>
            </div>);
        })}
      </div>
      <div className="h2">Daily planning</div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <div className="card"><div className="flab">Quick wins (low effort, ready to go)</div>
          {open.filter((w) => w.priority === "Low" && w.status !== "Waiting" && w.nextAction).slice(0, 5).map((w) => <div key={w.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => openItem(w)}>{w.title}</div>)}
        </div>
        <div className="card"><div className="flab">To chase today</div>
          {open.filter((w) => w.status === "Waiting" && (!w.nextChase || daysUntil(w.nextChase) <= 0)).slice(0, 5).map((w) => <div key={w.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => openItem(w)}>{w.title} <span className="chip">{w.waitingOn}</span></div>)}
        </div>
        <div className="card"><div className="flab">Delegation candidates (owned by me, not started)</div>
          {open.filter((w) => w.owner === "Me" && ["Planned", "Inbox"].includes(w.status) && w.priority !== "Critical").slice(0, 5).map((w) => <div key={w.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => openItem(w)}>{w.title}</div>)}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Action board (Kanban by status)
   ============================================================ */
function ActionBoard({ data, mutate, openItem, newItem }) {
  const [f, setF] = useState({ q: "", owner: "", project: "", country: "", type: "", view: "All" });
  const cols = ["Inbox", "Planned", "In Progress", "Waiting", "Blocked", "Review", "Done"];
  let rows = data.workItems.filter((w) => w.status !== "Cancelled" && w.status !== "Parked");
  if (f.view === "My actions") rows = rows.filter((w) => w.owner === "Me");
  if (f.view === "Delegated") rows = rows.filter((w) => w.owner !== "Me");
  if (f.view === "Critical") rows = rows.filter((w) => w.priority === "Critical");
  if (f.view === "Overdue") rows = rows.filter(isOverdue);
  if (f.q) rows = rows.filter((w) => (w.title + " " + w.description).toLowerCase().includes(f.q.toLowerCase()));
  if (f.owner) rows = rows.filter((w) => w.owner === f.owner);
  if (f.project) rows = rows.filter((w) => w.project === f.project || w.mob === f.project);
  if (f.country) rows = rows.filter((w) => w.country === f.country);
  if (f.type) rows = rows.filter((w) => w.type === f.type);
  rows = rows.filter((w) => w.status !== "Done" || daysSince(w.completed) <= 14);
  const owners = [...new Set(data.workItems.map((w) => w.owner).filter(Boolean))].sort();
  const drop = (st) => (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("id"); if (!id) return;
    mutate((d) => { const w = d.workItems.find((x) => x.id === id); if (w) { w.status = st; w.updatedAt = todayISO(); if (st === "Done" && !w.completed) w.completed = todayISO(); } return d; }, "Status → " + st);
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <h2 className="h1">Action Board</h2>
        <button className="btn pri sm" style={{ marginLeft: "auto" }} onClick={newItem}>+ New work item</button>
      </div>
      <div className="toolrow" style={{ marginTop: 8 }}>
        {["All", "My actions", "Delegated", "Critical", "Overdue"].map((v) => <button key={v} className={"btn sm" + (f.view === v ? " pri" : "")} onClick={() => setF({ ...f, view: v })}>{v}</button>)}
        <input className="input" placeholder="Search…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className="select" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}><option value="">Owner: all</option>{owners.map((o) => <option key={o}>{o}</option>)}</select>
        <select className="select" value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}><option value="">Project/Mob: all</option>
          {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {data.mobs.map((m) => <option key={m.id} value={m.id}>[Mob] {m.name}</option>)}</select>
        <select className="select" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option value="">Country: all</option>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Type: all</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
      </div>
      <div className="kwrap">
        {cols.map((st) => {
          const items = rows.filter((w) => w.status === st).sort((a, b) => prioRank(a.priority) - prioRank(b.priority) || (a.due || "9999").localeCompare(b.due || "9999"));
          return (
            <div key={st} className="kcol" onDragOver={(e) => e.preventDefault()} onDrop={drop(st)}>
              <h4>{st}<span>{items.length}</span></h4>
              <div className="kbody">
                {items.map((w) => (
                  <div key={w.id} className="kcard" draggable onDragStart={(e) => e.dataTransfer.setData("id", w.id)} onClick={() => openItem(w)}>
                    <div className="kt">{w.title}</div>
                    <div className="kmeta">
                      <Badge p={w.priority} /><span className="chip">{w.type}</span>
                      {w.due && <span className="chip" style={isOverdue(w) ? { color: "#FD0E33", fontWeight: 600 } : null}>{fmtD(w.due)}</span>}
                      {parentLabel(data, w) && <span className="chip">{parentLabel(data, w).slice(0, 22)}</span>}
                      {w.owner && w.owner !== "Me" && <span className="chip">@{w.owner}</span>}
                      {st === "Waiting" && w.waitingOn && <span className="chip">on {w.waitingOn}</span>}
                    </div>
                  </div>))}
              </div>
            </div>);
        })}
      </div>
    </div>
  );
}

/* ============================================================
   Waiting and chasing
   ============================================================ */
function Waiting({ data, mutate, openItem }) {
  const [chasePick, setChasePick] = useState(null);
  const rows = data.workItems.filter((w) => w.status === "Waiting");
  const bucket = (w) => {
    const nc = w.nextChase ? daysUntil(w.nextChase) : null;
    if (nc !== null && nc < 0) return "Overdue for chase";
    if (nc === 0 || nc === null) return "Due to chase today";
    const ds = daysSince(w.lastChased || w.created) ?? 0;
    if (ds < 7) return "Waiting under 7 days";
    if (ds <= 14) return "Waiting 7–14 days";
    return "Waiting over 14 days";
  };
  const buckets = ["Overdue for chase", "Due to chase today", "Waiting under 7 days", "Waiting 7–14 days", "Waiting over 14 days"];
  const act = (id, fn, label) => mutate((d) => { const w = d.workItems.find((x) => x.id === id); if (w) { fn(w); w.updatedAt = todayISO(); } return d; }, label);
  const markChased = (id) => { act(id, (w) => { w.lastChased = todayISO(); w.nextChase = ""; }, "Marked chased"); setChasePick(id); };
  const setNext = (id, days, dateVal) => { act(id, (w) => { w.nextChase = dateVal || dOff(days); }, "Next chase set"); setChasePick(null); };
  const byPerson = {};
  rows.forEach((w) => { const p = w.waitingOn || "Unassigned"; byPerson[p] = byPerson[p] || []; byPerson[p].push(w); });
  return (
    <div>
      <h2 className="h1">Waiting and Chasing</h2>
      <p className="sub">Everything parked on someone else. Chase timing is entirely manual — mark it chased, then pick when to chase next.</p>
      {buckets.map((b) => {
        const items = rows.filter((w) => bucket(w) === b);
        if (!items.length) return null;
        return (<div key={b}>
          <div className="h2" style={b.includes("Overdue") ? { color: "#FD0E33" } : null}>{b} ({items.length})</div>
          <table className="tbl"><thead><tr><th>What is needed</th><th>Waiting on</th><th>Since</th><th>Last chased</th><th>Next chase</th><th>Impact of delay</th><th style={{ width: 320 }}>Actions</th></tr></thead><tbody>
            {items.map((w) => (
              <tr key={w.id}>
                <td className="click" onClick={() => openItem(w)}><Badge p={w.priority} /> {w.title}</td>
                <td>{w.waitingOn || "—"}</td>
                <td>{daysSince(w.lastChased || w.created) ?? "—"}d</td>
                <td>{fmtD(w.lastChased)}</td>
                <td>{fmtD(w.nextChase)}</td>
                <td>{w.extra?.impactIfMissed || w.blocker || "—"}</td>
                <td>
                  {chasePick === w.id ? (
                    <span style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="flab" style={{ margin: 0 }}>Next chase:</span>
                      <button className="btn sm" onClick={() => setNext(w.id, 3)}>+3d</button>
                      <button className="btn sm" onClick={() => setNext(w.id, 7)}>+1w</button>
                      <button className="btn sm" onClick={() => setNext(w.id, 14)}>+2w</button>
                      <button className="btn sm" onClick={() => setNext(w.id, 30)}>+1m</button>
                      <input type="date" className="input" style={{ width: 130 }} onChange={(e) => e.target.value && setNext(w.id, 0, e.target.value)} />
                    </span>
                  ) : (
                    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button className="btn sm pri" onClick={() => markChased(w.id)}>Chased today</button>
                      <button className="btn sm" onClick={async () => { const r = await askPrompt("Record the response received:"); if (r) act(w.id, (x) => { x.notes.push({ ts: todayISO(), text: "Response: " + r }); x.status = "In Progress"; }, "Response recorded — back in progress"); }}>Record response</button>
                      <button className="btn sm" onClick={() => act(w.id, (x) => { x.priority = "Critical"; x.notes.push({ ts: todayISO(), text: "Escalated" }); }, "Escalated")}>Escalate</button>
                      <button className="btn sm" onClick={() => act(w.id, (x) => { x.status = "Cancelled"; x.notes.push({ ts: todayISO(), text: "No longer required" }); }, "Marked not required")}>Not required</button>
                    </span>)}
                </td>
              </tr>))}
          </tbody></table>
        </div>);
      })}
      {!rows.length && <div className="empty">Nothing is waiting on anyone. Enjoy it while it lasts.</div>}
      <div className="h2">By person</div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))" }}>
        {Object.entries(byPerson).map(([p, items]) => (
          <div key={p} className="card">
            <b>{p}</b> <span className="chip">{items.length} item{items.length > 1 ? "s" : ""}</span>
            <div className="sub" style={{ margin: "4px 0 0" }}>Oldest: {Math.max(...items.map((w) => daysSince(w.lastChased || w.created) || 0))}d · Most critical: {items.sort((a, b) => prioRank(a.priority) - prioRank(b.priority))[0].priority}</div>
          </div>))}
      </div>
    </div>
  );
}

/* ============================================================
   Risks, Issues & Dependencies
   ============================================================ */
function RisksView({ data, openItem, newItem }) {
  const [tab, setTab] = useState("Risk");
  const rows = data.workItems.filter((w) => w.type === tab && w.status !== "Cancelled");
  const open = rows.filter((w) => OPEN_STATUSES.includes(w.status));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <h2 className="h1">Risks, Issues and Dependencies</h2>
        <button className="btn pri sm" style={{ marginLeft: "auto" }} onClick={() => newItem({ type: tab })}>+ New {tab.toLowerCase()}</button>
      </div>
      <div className="toolrow" style={{ marginTop: 8 }}>
        {["Risk", "Issue", "Dependency"].map((t) => <button key={t} className={"btn sm" + (tab === t ? " pri" : "")} onClick={() => setTab(t)}>{t}s ({data.workItems.filter((w) => w.type === t && OPEN_STATUSES.includes(w.status)).length})</button>)}
      </div>
      {tab === "Risk" && <>
        {open.filter((w) => !w.extra?.mitigation).length > 0 && <div className="warnbox">{open.filter((w) => !w.extra?.mitigation).length} open risk(s) have no mitigation recorded.</div>}
        <table className="tbl"><thead><tr><th>Risk</th><th>Rating</th><th>Likelihood</th><th>Impact</th><th>Mitigation</th><th>Owner</th><th>Project / Mob</th><th>Status</th></tr></thead><tbody>
          {rows.map((w) => (<tr key={w.id} className="click" onClick={() => openItem(w)}>
            <td>{w.title}</td>
            <td>{w.extra?.rating === "Critical" ? <span className="badge bg-crit">Critical</span> : w.extra?.rating === "High" ? <span className="badge bg-high">High</span> : w.extra?.rating || "—"}</td>
            <td>{w.extra?.likelihood || "—"}</td><td>{w.extra?.impactRating || "—"}</td>
            <td>{w.extra?.mitigation || <span style={{ color: "#FD0E33" }}>None recorded</span>}</td>
            <td>{w.owner}</td><td>{parentLabel(data, w) || "—"}</td><td>{w.status}</td>
          </tr>))}
        </tbody></table></>}
      {tab === "Issue" && <table className="tbl"><thead><tr><th>Issue</th><th>Priority</th><th>Root cause</th><th>Corrective action</th><th>Target date</th><th>Owner</th><th>Status</th></tr></thead><tbody>
        {rows.map((w) => (<tr key={w.id} className="click" onClick={() => openItem(w)}>
          <td>{w.title}</td><td><Badge p={w.priority} /></td>
          <td>{w.extra?.rootCause || "—"}</td>
          <td>{w.extra?.corrective || <span style={{ color: "#FD0E33" }}>None recorded</span>}</td>
          <td>{fmtD(w.due)}</td><td>{w.owner}</td><td>{w.status}</td>
        </tr>))}</tbody></table>}
      {tab === "Dependency" && <table className="tbl"><thead><tr><th>Dependency</th><th>External owner</th><th>Required date</th><th>Confidence</th><th>Impact if missed</th><th>Status</th></tr></thead><tbody>
        {rows.map((w) => (<tr key={w.id} className="click" onClick={() => openItem(w)}>
          <td>{w.title}</td><td>{w.extra?.externalOwner || w.waitingOn || "—"}</td>
          <td>{fmtD(w.extra?.requiredDate || w.due)}</td><td>{w.extra?.confidence || "—"}</td>
          <td>{w.extra?.impactIfMissed || "—"}</td><td>{w.status}</td>
        </tr>))}</tbody></table>}
      {!rows.length && <div className="empty">No {tab.toLowerCase()}s recorded. Add one with the button above.</div>}
    </div>
  );
}

/* ============================================================
   Decisions & Commitments
   ============================================================ */
function Decisions({ data, openItem, newItem }) {
  const [tab, setTab] = useState("Decision");
  const [who, setWho] = useState("");
  const rows = data.workItems.filter((w) => w.type === tab && w.status !== "Cancelled");
  const commTargets = [...new Set(data.workItems.filter((w) => w.type === "Commitment").map((w) => w.extra?.madeTo).filter(Boolean))];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <h2 className="h1">Decisions and Commitments</h2>
        <button className="btn pri sm" style={{ marginLeft: "auto" }} onClick={() => newItem({ type: tab })}>+ New {tab.toLowerCase()}</button>
      </div>
      <div className="toolrow" style={{ marginTop: 8 }}>
        {["Decision", "Commitment"].map((t) => <button key={t} className={"btn sm" + (tab === t ? " pri" : "")} onClick={() => setTab(t)}>{t}s</button>)}
        {tab === "Commitment" && <select className="select" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Made to: anyone</option>{commTargets.map((t) => <option key={t}>{t}</option>)}</select>}
      </div>
      {tab === "Decision" && <>
        {rows.filter((w) => OPEN_STATUSES.includes(w.status) && daysUntil(w.extra?.requiredBy || w.due) < 0).length > 0 &&
          <div className="warnbox">Decisions are outstanding beyond their required-by date.</div>}
        <table className="tbl"><thead><tr><th>Decision required</th><th>Status</th><th>Required by</th><th>Decision owner</th><th>Recommended option</th><th>Decision made</th></tr></thead><tbody>
          {rows.map((w) => { const late = OPEN_STATUSES.includes(w.status) && daysUntil(w.extra?.requiredBy || w.due) < 0; return (
            <tr key={w.id} className="click" onClick={() => openItem(w)}>
              <td>{late && <span className="badge bg-crit" style={{ marginRight: 5 }}>Late</span>}{w.title}</td>
              <td>{w.extra?.decisionStatus || w.status}</td>
              <td style={late ? { color: "#FD0E33", fontWeight: 600 } : null}>{fmtD(w.extra?.requiredBy || w.due)}</td>
              <td>{w.extra?.decisionOwner || w.owner}</td>
              <td>{w.extra?.recommended || "—"}</td>
              <td>{w.extra?.decisionMade || "—"}</td>
            </tr>); })}
        </tbody></table></>}
      {tab === "Commitment" && <table className="tbl"><thead><tr><th>Commitment</th><th>Made to</th><th>Made by</th><th>Due</th><th>Confidence</th><th>Status</th><th>Latest update</th></tr></thead><tbody>
        {rows.filter((w) => !who || w.extra?.madeTo === who).map((w) => (
          <tr key={w.id} className="click" onClick={() => openItem(w)}>
            <td>{w.title}</td><td>{w.extra?.madeTo || "—"}</td><td>{w.extra?.madeBy || "Me"}</td>
            <td style={isOverdue(w) ? { color: "#FD0E33", fontWeight: 600 } : null}>{fmtD(w.due)}</td>
            <td>{w.extra?.confidence === "Low" ? <span className="badge bg-high">Low</span> : w.extra?.confidence || "—"}</td>
            <td>{w.status}</td>
            <td>{(w.notes || []).length ? w.notes[w.notes.length - 1].text.slice(0, 60) : "—"}</td>
          </tr>))}</tbody></table>}
      {!rows.length && <div className="empty">No {tab.toLowerCase()}s recorded yet.</div>}
    </div>
  );
}

/* ============================================================
   Projects — portfolio + detail
   ============================================================ */
function emptyProject(settings) {
  return { id: uid(), name: "", code: "", objective: "", owner: "", sponsor: "", stage: "Idea", rag: "Green",
    start: todayISO(), target: "", forecast: "", progress: 0, confidence: "Medium", position: "",
    nextMilestone: "", nextMilestoneDate: "", country: settings.defaultCountry || "UK", workstream: "", client: "", updatedAt: todayISO() };
}
function ProjectModal({ data, proj, onSave, onClose, onDelete }) {
  const [p, setP] = useState({ ...emptyProject(data.settings), ...JSON.parse(JSON.stringify(proj || {})) });
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const isNew = !proj?.name;
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3 className="h1">{isNew ? "New project" : "Edit project"}</h3>
        <div className="frow" style={{ marginTop: 10 }}>
          <F label="Project name" span><input className="input" autoFocus value={p.name} onChange={(e) => set("name", e.target.value)} /></F>
          <F label="Code"><input className="input" value={p.code} onChange={(e) => set("code", e.target.value)} /></F>
          <F label="Owner"><input className="input" value={p.owner} onChange={(e) => set("owner", e.target.value)} /></F>
          <F label="Sponsor"><input className="input" value={p.sponsor} onChange={(e) => set("sponsor", e.target.value)} /></F>
          <F label="Stage"><select className="select" value={p.stage} onChange={(e) => set("stage", e.target.value)}>{PROJECT_STAGES.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="RAG"><select className="select" value={p.rag} onChange={(e) => set("rag", e.target.value)}>{RAGS.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Confidence"><select className="select" value={p.confidence} onChange={(e) => set("confidence", e.target.value)}>{["High", "Medium", "Low"].map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Country"><select className="select" value={p.country} onChange={(e) => set("country", e.target.value)}>{COUNTRIES.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Workstream"><select className="select" value={p.workstream} onChange={(e) => set("workstream", e.target.value)}><option value="">—</option>{WORKSTREAMS.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Start"><input type="date" className="input" value={p.start} onChange={(e) => set("start", e.target.value)} /></F>
          <F label="Target date"><input type="date" className="input" value={p.target} onChange={(e) => set("target", e.target.value)} /></F>
          <F label="Forecast completion"><input type="date" className="input" value={p.forecast} onChange={(e) => set("forecast", e.target.value)} /></F>
          <F label={"Progress (" + p.progress + "%)"}><input type="range" min="0" max="100" step="5" value={p.progress} onChange={(e) => set("progress", +e.target.value)} style={{ width: "100%" }} /></F>
          <F label="Objective" span><textarea className="ta" value={p.objective} onChange={(e) => set("objective", e.target.value)} /></F>
          <F label="Current position" span><textarea className="ta" value={p.position} onChange={(e) => set("position", e.target.value)} /></F>
          <F label="Next milestone"><input className="input" value={p.nextMilestone} onChange={(e) => set("nextMilestone", e.target.value)} /></F>
          <F label="Milestone date"><input type="date" className="input" value={p.nextMilestoneDate} onChange={(e) => set("nextMilestoneDate", e.target.value)} /></F>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          {!isNew && <button className="btn danger" onClick={async () => { if (await askConfirm("Delete this project? Linked work items are kept but unlinked.")) onDelete(p.id); }}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" onClick={() => { if (!p.name.trim()) return alert("Project name is required."); onSave({ ...p, updatedAt: todayISO() }, isNew); }}>{isNew ? "Create project" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
function Projects({ data, mutate, openItem, newItem, detail, setDetail }) {
  const [view, setView] = useState("cards");
  const [editing, setEditing] = useState(null);
  const [updText, setUpdText] = useState("");
  const active = data.projects;
  const saveProj = (p, isNew) => {
    mutate((d) => { if (isNew) d.projects.push(p); else d.projects = d.projects.map((x) => x.id === p.id ? p : x); return d; }, (isNew ? "Project created: " : "Project updated: ") + p.name);
    setEditing(null);
  };
  const delProj = (id) => {
    mutate((d) => { d.projects = d.projects.filter((x) => x.id !== id); d.workItems.forEach((w) => { if (w.project === id) w.project = ""; }); return d; }, "Project deleted");
    setEditing(null); setDetail(null);
  };
  if (detail) {
    const p = data.projects.find((x) => x.id === detail);
    if (!p) { setDetail(null); return null; }
    const items = data.workItems.filter((w) => w.project === p.id);
    const h = projectHealth(data, p);
    const updates = data.updates.filter((u) => u.project === p.id).sort((a, b) => b.date.localeCompare(a.date));
    const bens = data.benefits.filter((b) => b.project === p.id);
    const lessons = data.lessons.filter((l) => l.project === p.id);
    const addUpdate = () => {
      if (!updText.trim()) return;
      mutate((d) => {
        d.updates.push({ id: uid(), title: updText.slice(0, 80), date: todayISO(), period: monthName(), summary: updText, detail: "", rag: p.rag, project: p.id, mob: "", country: p.country, workstream: p.workstream, owner: "Me", confidentiality: "General internal", flags: { board: false, coo: false, news: false } });
        const pr = d.projects.find((x) => x.id === p.id); if (pr) pr.updatedAt = todayISO();
        return d;
      }, "Update added to " + p.name);
      setUpdText("");
    };
    const report = () => {
      const t = [`# Project report — ${p.name}`, ``, `Stage: ${p.stage} · RAG: ${p.rag} · Progress: ${p.progress}% · Confidence: ${p.confidence}`,
        `Owner: ${p.owner || "(missing)"} · Target: ${fmtD(p.target)} · Forecast: ${fmtD(p.forecast) || "(missing)"}`, ``,
        `## Objective`, p.objective || "(missing)", ``, `## Current position`, p.position || "(missing — flag: no current position recorded)", ``,
        `## Next milestone`, p.nextMilestone ? `${p.nextMilestone} — ${fmtD(p.nextMilestoneDate)}` : "(missing — flag: no next milestone)", ``,
        `## Open actions (${items.filter((w) => OPEN_STATUSES.includes(w.status) && !["Risk", "Decision"].includes(w.type)).length})`,
        ...items.filter((w) => OPEN_STATUSES.includes(w.status) && !["Risk", "Decision"].includes(w.type)).map((w) => `- ${w.title} — ${w.status}${w.due ? ", due " + fmtD(w.due) : ""}${isOverdue(w) ? " (OVERDUE)" : ""}`),
        ``, `## Open risks`, ...(items.filter((w) => w.type === "Risk" && OPEN_STATUSES.includes(w.status)).map((w) => `- ${w.title} (${w.extra?.rating || "unrated"})${w.extra?.mitigation ? " — mitigation: " + w.extra.mitigation : " — NO MITIGATION"}`)),
        ``, `## Decisions outstanding`, ...(items.filter((w) => w.type === "Decision" && OPEN_STATUSES.includes(w.status)).map((w) => `- ${w.title} — required by ${fmtD(w.extra?.requiredBy || w.due)}`)),
        ``, `## Latest updates`, ...updates.slice(0, 3).map((u) => `- ${fmtD(u.date)}: ${u.summary}`),
        ``, `_Generated ${fmtD(todayISO())} from CMAC Operations Command Centre._`].join("\n");
      copyText(t); alert("Project report copied to clipboard as Markdown.");
    };
    return (
      <div>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <button className="btn sm" onClick={() => setDetail(null)}>← Portfolio</button>
          <h2 className="h1" style={{ margin: 0 }}><Rag v={p.rag} />{p.name} <span className="mono">{p.code}</span></h2>
          <span className="chip">{p.stage}</span>
          <span className="chip" style={h.label !== "Healthy" ? { color: "#FD0E33", borderColor: "#F3C2CB" } : null}>Health: {h.label}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button className="btn sm" onClick={() => setEditing(p)}>Edit project</button>
            <button className="btn sm" onClick={() => newItem({ project: p.id })}>+ Work item</button>
            <button className="btn sm pri" onClick={report}>Generate report</button>
          </span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", marginTop: 12, alignItems: "start" }}>
          <div className="card">
            <div className="flab">Objective</div><div style={{ marginBottom: 8 }}>{p.objective || "—"}</div>
            <div className="flab">Current position</div><div style={{ marginBottom: 8 }}>{p.position || <span style={{ color: "#B45309" }}>No current position recorded.</span>}</div>
            <div style={{ display: "flex", gap: 16, fontSize: 12.5, flexWrap: "wrap" }}>
              <span><span className="flab">Owner</span>{p.owner || "—"}</span>
              <span><span className="flab">Sponsor</span>{p.sponsor || "—"}</span>
              <span><span className="flab">Target</span>{fmtD(p.target)}</span>
              <span><span className="flab">Forecast</span>{fmtD(p.forecast)}</span>
              <span><span className="flab">Confidence</span>{p.confidence}</span>
              <span><span className="flab">Next milestone</span>{p.nextMilestone ? p.nextMilestone + " (" + fmtD(p.nextMilestoneDate) + ")" : "—"}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              <div className="prog" style={{ flex: 1 }}><div style={{ width: p.progress + "%" }} /></div><span className="mono">{p.progress}%</span>
            </div>
          </div>
          <div className="card">
            <div className="flab">Health signals (not progress % alone)</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
              RAG: <Rag v={p.rag} />{p.rag}<br />
              Overdue actions: <b style={h.overdue ? { color: "#FD0E33" } : null}>{h.overdue}</b><br />
              Open critical risks: <b style={h.critRisks ? { color: "#FD0E33" } : null}>{h.critRisks}</b><br />
              Decisions outstanding: <b>{h.decis}</b><br />
              Update recency: {h.stale ? <b style={{ color: "#FD0E33" }}>stale ({daysSince(p.updatedAt)}d)</b> : daysSince(p.updatedAt) + "d ago"}<br />
              Delivery confidence: {p.confidence}
            </div>
          </div>
        </div>
        <div className="h2">Add update</div>
        <div className="card"><div style={{ display: "flex", gap: 8 }}>
          <input className="input" value={updText} onChange={(e) => setUpdText(e.target.value)} placeholder="What moved, what's the position now, what's next…" onKeyDown={(e) => e.key === "Enter" && addUpdate()} />
          <button className="btn pri" onClick={addUpdate}>Add</button>
        </div></div>
        <div className="h2">Updates ({updates.length})</div>
        {updates.map((u) => <div key={u.id} className="checkline"><span className="mono" style={{ width: 74 }}>{fmtD(u.date)}</span><Rag v={u.rag} /><span style={{ flex: 1 }}>{u.summary}</span>{u.flags.board && <span className="chip">board</span>}{u.flags.coo && <span className="chip">coo</span>}{u.flags.news && <span className="chip">news</span>}</div>)}
        {!updates.length && <div className="sub">No updates yet.</div>}
        <div className="h2">Linked work items ({items.length})</div>
        <ItemsTable data={data} rows={items} onOpen={openItem} cols={["title", "type", "status", "priority", "owner", "due", "updated"]} />
        {bens.length > 0 && <><div className="h2">Benefits</div>{bens.map((b) => <div key={b.id} className="checkline"><span style={{ flex: 1 }}>{b.title}</span><span className="chip">{b.type}</span><span className="chip">Expected {b.expected}</span><span className="chip">Actual {b.actual || "—"}</span><span className="chip">{b.confidence}</span></div>)}</>}
        {lessons.length > 0 && <><div className="h2">Lessons learned</div>{lessons.map((l) => <div key={l.id} className="checkline"><span style={{ flex: 1 }}>{l.title}</span><span className="chip">{l.status}</span></div>)}</>}
        {editing && <ProjectModal data={data} proj={editing} onSave={saveProj} onClose={() => setEditing(null)} onDelete={delProj} />}
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <h2 className="h1">Projects</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {["cards", "table"].map((v) => <button key={v} className={"btn sm" + (view === v ? " pri" : "")} onClick={() => setView(v)}>{v === "cards" ? "Cards" : "Table"}</button>)}
          <button className="btn pri sm" onClick={() => setEditing({})}>+ New project</button>
        </div>
      </div>
      {view === "cards" && <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", marginTop: 10 }}>
        {active.map((p) => { const h = projectHealth(data, p); const items = data.workItems.filter((w) => w.project === p.id); return (
          <div key={p.id} className="card" style={{ cursor: "pointer", borderTop: "3px solid " + (p.rag === "Red" ? "#FD0E33" : p.rag === "Amber" ? "#D97706" : "#1A7F44") }} onClick={() => setDetail(p.id)}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b>{p.name}</b><span className="chip">{p.stage}</span>
            </div>
            <div className="sub" style={{ margin: "3px 0 6px" }}>{p.objective?.slice(0, 90)}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <div className="prog" style={{ flex: 1 }}><div style={{ width: p.progress + "%" }} /></div><span className="mono">{p.progress}%</span>
            </div>
            <div className="kmeta">
              <span className="chip">{p.owner || "no owner"}</span>
              <span className="chip">Target {fmtD(p.target)}</span>
              {h.overdue > 0 && <span className="chip" style={{ color: "#FD0E33" }}>{h.overdue} overdue</span>}
              {h.decis > 0 && <span className="chip">{h.decis} decision{h.decis > 1 ? "s" : ""}</span>}
              {h.stale && <span className="chip" style={{ color: "#B45309" }}>stale</span>}
              <span className="chip">{items.length} items</span>
              {p.demo && <span className="chip">demo</span>}
            </div>
          </div>); })}
      </div>}
      {view === "table" && <table className="tbl" style={{ marginTop: 10 }}><thead><tr><th>Project</th><th>Stage</th><th>RAG</th><th>Owner</th><th>Progress</th><th>Target</th><th>Forecast</th><th>Health</th><th>Updated</th></tr></thead><tbody>
        {active.map((p) => { const h = projectHealth(data, p); return (
          <tr key={p.id} className="click" onClick={() => setDetail(p.id)}>
            <td><b>{p.name}</b></td><td>{p.stage}</td><td><Rag v={p.rag} />{p.rag}</td><td>{p.owner}</td>
            <td>{p.progress}%</td><td>{fmtD(p.target)}</td><td>{fmtD(p.forecast)}</td>
            <td>{h.label}</td><td className="mono">{fmtD(p.updatedAt)}</td>
          </tr>); })}
      </tbody></table>}
      {editing && <ProjectModal data={data} proj={editing} onSave={saveProj} onClose={() => setEditing(null)} onDelete={delProj} />}
    </div>
  );
}

/* ============================================================
   Mobilisations — list + detail with readiness, go-live, hypercare
   ============================================================ */
function MobModal({ data, mob, onSave, onClose, onDelete }) {
  const [m, setM] = useState(() => ({ id: uid(), name: "", client: "", kind: "New client", country: data.settings.defaultCountry, owner: "", sponsor: "", stage: "Discovery", rag: "Green", goLive: "", hypercareEnd: "", confidence: "Medium", position: "", checklist: [], golive: { recommendation: "", decision: "", decisionOwner: "", decisionDate: "", conditions: "", contingency: "" }, hypercare: [], updatedAt: todayISO(), ...JSON.parse(JSON.stringify(mob || {})) }));
  const set = (k, v) => setM((x) => ({ ...x, [k]: v }));
  const isNew = !mob?.name;
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow">
        <h3 className="h1">{isNew ? "New mobilisation" : "Edit mobilisation"}</h3>
        <div className="frow" style={{ marginTop: 10 }}>
          <F label="Name" span><input className="input" autoFocus value={m.name} onChange={(e) => set("name", e.target.value)} /></F>
          <F label="Client"><input className="input" value={m.client} onChange={(e) => set("client", e.target.value)} /></F>
          <F label="Type"><select className="select" value={m.kind} onChange={(e) => set("kind", e.target.value)}>{["New client", "New service", "Expansion", "Internal change"].map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Owner"><input className="input" value={m.owner} onChange={(e) => set("owner", e.target.value)} /></F>
          <F label="Sponsor"><input className="input" value={m.sponsor} onChange={(e) => set("sponsor", e.target.value)} /></F>
          <F label="Stage"><select className="select" value={m.stage} onChange={(e) => set("stage", e.target.value)}>{MOB_STAGES.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="RAG"><select className="select" value={m.rag} onChange={(e) => set("rag", e.target.value)}>{RAGS.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Country"><select className="select" value={m.country} onChange={(e) => set("country", e.target.value)}>{COUNTRIES.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Confidence"><select className="select" value={m.confidence} onChange={(e) => set("confidence", e.target.value)}>{["High", "Medium", "Low"].map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Go-live date"><input type="date" className="input" value={m.goLive} onChange={(e) => set("goLive", e.target.value)} /></F>
          <F label="Hypercare ends"><input type="date" className="input" value={m.hypercareEnd} onChange={(e) => set("hypercareEnd", e.target.value)} /></F>
          <F label="Current position" span><textarea className="ta" value={m.position || ""} onChange={(e) => set("position", e.target.value)} /></F>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          {!isNew && <button className="btn danger" onClick={async () => { if (await askConfirm("Delete this mobilisation and its checklist? Linked work items are kept but unlinked.")) onDelete(m.id); }}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" onClick={() => { if (!m.name.trim()) return alert("A name is required."); onSave({ ...m, updatedAt: todayISO() }, isNew); }}>{isNew ? "Create mobilisation" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
function Mobilisations({ data, mutate, openItem, newItem, detail, setDetail }) {
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState("readiness");
  const [hc, setHc] = useState({ text: "", cat: "Incident" });
  const [nc, setNc] = useState({ workstream: MOB_WORKSTREAMS[0], requirement: "", owner: "", due: "", signOff: false, signOffOwner: "" });
  const saveMob = (m, isNew) => { mutate((d) => { if (isNew) d.mobs.push(m); else d.mobs = d.mobs.map((x) => x.id === m.id ? m : x); return d; }, (isNew ? "Mobilisation created: " : "Mobilisation updated: ") + m.name); setEditing(null); };
  const delMob = (id) => { mutate((d) => { d.mobs = d.mobs.filter((x) => x.id !== id); d.workItems.forEach((w) => { if (w.mob === id) w.mob = ""; }); return d; }, "Mobilisation deleted"); setEditing(null); setDetail(null); };
  const touchMob = (id, fn, label) => mutate((d) => { const m = d.mobs.find((x) => x.id === id); if (m) { fn(m); m.updatedAt = todayISO(); } return d; }, label);
  if (detail) {
    const m = data.mobs.find((x) => x.id === detail);
    if (!m) { setDetail(null); return null; }
    const r = mobReadiness(m);
    const g = daysUntil(m.goLive);
    const items = data.workItems.filter((w) => w.mob === m.id);
    const openRisks = items.filter((w) => w.type === "Risk" && OPEN_STATUSES.includes(w.status));
    const signOffs = (m.checklist || []).filter((c) => c.signOff);
    const readyToDecide = r.pct === 100 && signOffs.every((c) => c.signedOff);
    const cStat = (c, st) => touchMob(m.id, (x) => { const cc = x.checklist.find((y) => y.id === c.id); if (cc) cc.status = st; }, "Checklist: " + st);
    return (
      <div>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <button className="btn sm" onClick={() => setDetail(null)}>← Mobilisations</button>
          <h2 className="h1" style={{ margin: 0 }}><Rag v={m.rag} />{m.name}</h2>
          <span className="chip">{m.stage}</span>
          <span className="chip">{m.client}</span>
          {g !== null && <span className={"badge " + (g <= 7 ? "bg-crit" : g <= 30 ? "bg-high" : "bg-med")}>{g >= 0 ? `Go-live in ${g}d (${fmtD(m.goLive)})` : `Live ${Math.abs(g)}d`}</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button className="btn sm" onClick={() => setEditing(m)}>Edit</button>
            <button className="btn sm" onClick={() => newItem({ mob: m.id, type: "Mobilisation action" })}>+ Work item</button>
          </span>
        </div>
        <div className="toolrow" style={{ marginTop: 10 }}>
          {[["readiness", "Readiness"], ["golive", "Go-live decision"], ["hypercare", "Hypercare"], ["items", "Work items (" + items.length + ")"]].map(([k, l]) =>
            <button key={k} className={"btn sm" + (tab === k ? " pri" : "")} onClick={() => setTab(k)}>{l}</button>)}
        </div>

        {tab === "readiness" && <>
          <div className="grid" style={{ gridTemplateColumns: "1fr 2fr", alignItems: "start" }}>
            <div className="card">
              <div className="flab">Overall readiness</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: "#112138" }}>{r.pct}%</div>
              <div className="prog" style={{ margin: "6px 0" }}><div style={{ width: r.pct + "%" }} /></div>
              <div className="sub" style={{ margin: 0 }}>{(m.checklist || []).filter((c) => c.status === "Done").length} of {(m.checklist || []).length} requirements complete · {signOffs.filter((c) => c.signedOff).length}/{signOffs.length} sign-offs obtained</div>
              {openRisks.length > 0 && <div className="warnbox" style={{ marginTop: 8 }}>{openRisks.length} open risk(s) on this mobilisation.</div>}
            </div>
            <div className="card">
              <div className="flab">Readiness by workstream</div>
              {Object.entries(r.byWs).map(([ws, v]) => (
                <div key={ws} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0" }}>
                  <span style={{ width: 190, fontSize: 12 }}>{ws}</span>
                  <div className="prog" style={{ flex: 1 }}><div style={{ width: Math.round((v.d / v.t) * 100) + "%" }} /></div>
                  <span className="mono">{v.d}/{v.t}</span>
                </div>))}
              {!Object.keys(r.byWs).length && <div className="sub">No checklist items yet.</div>}
            </div>
          </div>
          <div className="h2">Readiness checklist</div>
          <table className="tbl"><thead><tr><th>Workstream</th><th>Requirement</th><th>Owner</th><th>Due</th><th>Status</th><th>Sign-off</th><th></th></tr></thead><tbody>
            {(m.checklist || []).map((c) => (
              <tr key={c.id}>
                <td>{c.workstream}</td><td>{c.requirement}</td><td>{c.owner}</td>
                <td style={c.status !== "Done" && daysUntil(c.due) < 0 ? { color: "#FD0E33", fontWeight: 600 } : null}>{fmtD(c.due)}</td>
                <td><select className="select" style={{ width: 120 }} value={c.status} onChange={(e) => cStat(c, e.target.value)}>{["Planned", "In Progress", "Blocked", "Done", "Not required"].map((s) => <option key={s}>{s}</option>)}</select></td>
                <td>{c.signOff ? (
                  <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12 }}>
                    <input type="checkbox" checked={!!c.signedOff} onChange={(e) => touchMob(m.id, (x) => { const cc = x.checklist.find((y) => y.id === c.id); if (cc) cc.signedOff = e.target.checked; }, "Sign-off updated")} />
                    {c.signOffOwner || "sign-off"}
                  </label>) : "—"}</td>
                <td><button className="btn sm" onClick={async () => { if (await askConfirm("Remove this checklist row?")) touchMob(m.id, (x) => { x.checklist = x.checklist.filter((y) => y.id !== c.id); }, "Checklist row removed"); }}>✕</button></td>
              </tr>))}
          </tbody></table>
          <div className="card" style={{ marginTop: 8 }}>
            <div className="flab">Add checklist requirement</div>
            <div className="frow">
              <F label="Workstream"><select className="select" value={nc.workstream} onChange={(e) => setNc({ ...nc, workstream: e.target.value })}>{MOB_WORKSTREAMS.map((s) => <option key={s}>{s}</option>)}</select></F>
              <F label="Requirement"><input className="input" value={nc.requirement} onChange={(e) => setNc({ ...nc, requirement: e.target.value })} /></F>
              <F label="Owner"><input className="input" value={nc.owner} onChange={(e) => setNc({ ...nc, owner: e.target.value })} /></F>
              <F label="Due"><input type="date" className="input" value={nc.due} onChange={(e) => setNc({ ...nc, due: e.target.value })} /></F>
              <F label="Needs sign-off?"><div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={nc.signOff} onChange={(e) => setNc({ ...nc, signOff: e.target.checked })} />
                {nc.signOff && <input className="input" placeholder="By whom" value={nc.signOffOwner} onChange={(e) => setNc({ ...nc, signOffOwner: e.target.value })} />}
              </div></F>
            </div>
            <button className="btn pri sm" style={{ marginTop: 8 }} disabled={!nc.requirement.trim()} onClick={() => { touchMob(m.id, (x) => { x.checklist.push({ id: uid(), ...nc, status: "Planned", signedOff: false, notes: "" }); }, "Checklist requirement added"); setNc({ ...nc, requirement: "", owner: "", due: "" }); }}>Add requirement</button>
          </div>
        </>}

        {tab === "golive" && <>
          {readyToDecide ? <div className="okbox">All checklist requirements complete and all sign-offs obtained. Ready for a go-live decision.</div>
            : <div className="warnbox">Readiness {r.pct}% — {signOffs.filter((c) => !c.signedOff).length} sign-off(s) outstanding. A go/no-go can still be recorded, with conditions.</div>}
          <div className="card">
            <div className="frow">
              <F label="Recommendation" span><textarea className="ta" value={m.golive?.recommendation || ""} onChange={(e) => touchMob(m.id, (x) => { x.golive.recommendation = e.target.value; }, null)} placeholder="Your recommendation to the decision owner, with rationale" /></F>
              <F label="Decision"><select className="select" value={m.golive?.decision || ""} onChange={(e) => touchMob(m.id, (x) => { x.golive.decision = e.target.value; }, "Go-live decision recorded")}><option value="">— not yet decided —</option>{["Go", "No-go", "Conditional go", "Deferred"].map((s) => <option key={s}>{s}</option>)}</select></F>
              <F label="Decision owner"><input className="input" value={m.golive?.decisionOwner || ""} onChange={(e) => touchMob(m.id, (x) => { x.golive.decisionOwner = e.target.value; }, null)} /></F>
              <F label="Decision date"><input type="date" className="input" value={m.golive?.decisionDate || ""} onChange={(e) => touchMob(m.id, (x) => { x.golive.decisionDate = e.target.value; }, null)} /></F>
              <F label="Conditions" span><input className="input" value={m.golive?.conditions || ""} onChange={(e) => touchMob(m.id, (x) => { x.golive.conditions = e.target.value; }, null)} placeholder="Conditions attached to a conditional go" /></F>
              <F label="Contingency / rollback" span><input className="input" value={m.golive?.contingency || ""} onChange={(e) => touchMob(m.id, (x) => { x.golive.contingency = e.target.value; }, null)} /></F>
            </div>
            {m.golive?.decision && <div className="notebox" style={{ marginTop: 8 }}>Recorded: <b>{m.golive.decision}</b>{m.golive.decisionOwner ? " by " + m.golive.decisionOwner : ""}{m.golive.decisionDate ? " on " + fmtD(m.golive.decisionDate) : ""}.</div>}
          </div>
        </>}

        {tab === "hypercare" && <>
          <div className="card">
            <div className="flab">Log a hypercare entry</div>
            <div style={{ display: "flex", gap: 6 }}>
              <select className="select" style={{ width: 150 }} value={hc.cat} onChange={(e) => setHc({ ...hc, cat: e.target.value })}>{["Incident", "Issue", "Client feedback", "Fix applied", "Observation"].map((s) => <option key={s}>{s}</option>)}</select>
              <input className="input" value={hc.text} onChange={(e) => setHc({ ...hc, text: e.target.value })} placeholder="What happened / what was done" onKeyDown={(e) => { if (e.key === "Enter" && hc.text.trim()) { touchMob(m.id, (x) => { x.hypercare.unshift({ ts: todayISO(), cat: hc.cat, text: hc.text.trim() }); }, "Hypercare entry"); setHc({ ...hc, text: "" }); } }} />
              <button className="btn pri" disabled={!hc.text.trim()} onClick={() => { touchMob(m.id, (x) => { x.hypercare.unshift({ ts: todayISO(), cat: hc.cat, text: hc.text.trim() }); }, "Hypercare entry"); setHc({ ...hc, text: "" }); }}>Log</button>
            </div>
          </div>
          <div className="h2">Hypercare log {m.hypercareEnd ? `(ends ${fmtD(m.hypercareEnd)})` : ""}</div>
          {(m.hypercare || []).map((h, i) => <div key={i} className="checkline"><span className="mono" style={{ width: 74 }}>{fmtD(h.ts)}</span><span className="chip">{h.cat}</span><span style={{ flex: 1 }}>{h.text}</span></div>)}
          {!(m.hypercare || []).length && <div className="empty">No hypercare entries. Log incidents, fixes and client feedback here during the stabilisation period.</div>}
        </>}

        {tab === "items" && <ItemsTable data={data} rows={items} onOpen={openItem} />}
        {editing && <MobModal data={data} mob={editing} onSave={saveMob} onClose={() => setEditing(null)} onDelete={delMob} />}
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <h2 className="h1">Mobilisations</h2>
        <button className="btn pri sm" style={{ marginLeft: "auto" }} onClick={() => setEditing({})}>+ New mobilisation</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", marginTop: 10 }}>
        {data.mobs.map((m) => { const r = mobReadiness(m); const g = daysUntil(m.goLive); return (
          <div key={m.id} className="card" style={{ cursor: "pointer", borderTop: "3px solid " + (m.rag === "Red" ? "#FD0E33" : m.rag === "Amber" ? "#D97706" : "#1A7F44") }} onClick={() => setDetail(m.id)}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><b>{m.name}</b><span className="chip">{m.stage}</span></div>
            <div className="sub" style={{ margin: "2px 0 6px" }}>{m.client} · {m.country}{m.demo ? " · demo" : ""}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <div className="prog" style={{ flex: 1 }}><div style={{ width: r.pct + "%" }} /></div><span className="mono">{r.pct}% ready</span>
            </div>
            <div className="kmeta">
              {g !== null && <span className={"chip"} style={g <= 7 && g >= 0 ? { color: "#FD0E33", fontWeight: 600 } : null}>{g >= 0 ? `go-live in ${g}d` : `live ${Math.abs(g)}d`}</span>}
              <span className="chip">{m.owner}</span>
              {m.golive?.decision && <span className="chip">{m.golive.decision}</span>}
            </div>
          </div>); })}
        {!data.mobs.length && <div className="empty">No mobilisations yet.</div>}
      </div>
      {editing && <MobModal data={data} mob={editing} onSave={saveMob} onClose={() => setEditing(null)} onDelete={delMob} />}
    </div>
  );
}

/* ============================================================
   Reporting engines: Board Pack, COO Update, Newsletter
   ============================================================ */
const BP_SECTIONS = [["exec", "Executive summary"], ["wins", "Key wins and successes"], ["projects", "Major projects"], ["mobs", "Mobilisations"], ["concerns", "Client and service concerns"], ["risks", "Risks"], ["decisions", "Decisions required from the board"], ["next", "Priorities for next period"]];

function boardSources(data, section) {
  const done30 = data.workItems.filter((w) => w.status === "Done" && daysSince(w.completed) <= 31);
  switch (section) {
    case "wins": return [
      ...data.updates.filter((u) => u.flags.board && u.rag === "Green").map((u) => ({ id: "u" + u.id, text: `${u.title}: ${u.summary}` })),
      ...done30.filter((w) => w.flags.board).map((w) => ({ id: "w" + w.id, text: `${w.title}${w.outcome ? " — " + w.outcome : ""}` }))];
    case "projects": return data.projects.filter((p) => !["Closed", "Cancelled", "Idea"].includes(p.stage)).map((p) => ({ id: "p" + p.id, text: `${p.name} (${p.rag}, ${p.progress}%): ${p.position || "no position recorded"}${p.nextMilestone ? " Next: " + p.nextMilestone + " (" + fmtD(p.nextMilestoneDate) + ")." : ""}` }));
    case "mobs": return data.mobs.filter((m) => m.stage !== "Closed").map((m) => { const r = mobReadiness(m); return { id: "m" + m.id, text: `${m.name} (${m.rag}): ${r.pct}% ready, go-live ${fmtD(m.goLive)}. ${m.position || ""}` }; });
    case "concerns": return [
      ...data.updates.filter((u) => u.flags.board && u.rag !== "Green").map((u) => ({ id: "u" + u.id, text: `${u.title}: ${u.summary}` })),
      ...data.workItems.filter((w) => w.type === "Issue" && OPEN_STATUSES.includes(w.status) && ["Critical", "High"].includes(w.priority)).map((w) => ({ id: "w" + w.id, text: `${w.title}${w.extra?.corrective ? " — corrective: " + w.extra.corrective : ""}` }))];
    case "risks": return data.workItems.filter((w) => w.type === "Risk" && OPEN_STATUSES.includes(w.status) && (w.flags.board || ["Critical", "High"].includes(w.priority))).map((w) => ({ id: "w" + w.id, text: `${w.title} (${w.extra?.rating || w.priority}). Mitigation: ${w.extra?.mitigation || "NONE RECORDED"}` }));
    case "decisions": return data.workItems.filter((w) => w.type === "Decision" && OPEN_STATUSES.includes(w.status) && w.flags.board).map((w) => ({ id: "w" + w.id, text: `${w.title} — required by ${fmtD(w.extra?.requiredBy || w.due)}${w.extra?.recommended ? ". Recommended: " + w.extra.recommended : ""}` }));
    case "next": return data.workItems.filter((w) => OPEN_STATUSES.includes(w.status) && w.horizon === "Now").sort((a, b) => (a.rank || 99) - (b.rank || 99)).slice(0, 6).map((w) => ({ id: "w" + w.id, text: w.title }));
    default: return [];
  }
}
function ReportWorkspace({ data, mutate, kind }) {
  const isBoard = kind === "board";
  const draftKey = isBoard ? "boardDraft" : "cooDraft";
  const draft = data[draftKey];
  const sections = isBoard ? BP_SECTIONS : [["exec", "Summary for COO"], ["wins", "Wins"], ["projects", "Projects"], ["mobs", "Mobilisations"], ["concerns", "Concerns and asks"], ["decisions", "Decisions needed"]];
  const upd = (fn) => mutate((d) => { fn(d[draftKey]); return d; }, null);
  const srcFor = (k) => {
    let s = boardSources(data, k);
    if (!isBoard && k === "wins") s = [...data.updates.filter((u) => u.flags.coo).map((u) => ({ id: "u" + u.id, text: `${u.title}: ${u.summary}` })), ...data.workItems.filter((w) => w.status === "Done" && w.flags.coo && daysSince(w.completed) <= 14).map((w) => ({ id: "w" + w.id, text: `${w.title}${w.outcome ? " — " + w.outcome : ""}` }))];
    if (!isBoard && k === "decisions") s = data.workItems.filter((w) => w.type === "Decision" && OPEN_STATUSES.includes(w.status) && w.flags.coo).map((w) => ({ id: "w" + w.id, text: `${w.title} — required by ${fmtD(w.extra?.requiredBy || w.due)}` }));
    return s;
  };
  const gaps = [];
  data.projects.filter((p) => !["Closed", "Cancelled", "Idea"].includes(p.stage) && !p.position).forEach((p) => gaps.push(`No current position recorded for ${p.name}`));
  data.projects.filter((p) => daysSince(p.updatedAt) > data.settings.staleProject).forEach((p) => gaps.push(`${p.name} not updated for ${daysSince(p.updatedAt)} days`));
  const generate = () => {
    const lines = [`# ${isBoard ? "Board operations update" : "COO update"} — ${draft.period}`, ""];
    sections.forEach(([k, label]) => {
      lines.push(`## ${label}`);
      if (draft.commentary[k]) lines.push(draft.commentary[k], "");
      srcFor(k).filter((s) => !draft.excluded.includes(k + ":" + s.id)).forEach((s) => lines.push(`- ${draft.overrides[k + ":" + s.id] || s.text}`));
      lines.push("");
    });
    lines.push(`_Prepared ${fmtD(todayISO())}. Generated from CMAC Operations Command Centre._`);
    const md = lines.join("\n");
    copyText(md); alert("Draft copied to clipboard as Markdown — paste into Word / email." + (isBoard ? " Once the pack is out, take a JSON backup from Settings." : ""));
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 className="h1">{isBoard ? "Board Pack workspace" : "COO Update"}</h2>
        <input className="input" style={{ width: 180 }} value={draft.period} onChange={(e) => upd((x) => { x.period = e.target.value; })} />
        {isBoard && <><label className="flab" style={{ margin: 0 }}>Submission deadline</label><input type="date" className="input" style={{ width: 140 }} value={draft.deadline || ""} onChange={(e) => upd((x) => { x.deadline = e.target.value; })} /></>}
        <button className="btn pri sm" style={{ marginLeft: "auto" }} onClick={generate}>Generate & copy draft</button>
      </div>
      <p className="sub">{isBoard ? "Monthly cycle — first week of each month. " : ""}Suggested content comes from flagged updates, completed work, projects, mobilisations, risks and decisions. Untick anything to exclude it; edit wording where needed; add your own commentary per section.</p>
      {isBoard && draft.deadline && daysUntil(draft.deadline) <= 5 && <div className={daysUntil(draft.deadline) <= 2 ? "warnbox" : "notebox"}>Board pack deadline {fmtD(draft.deadline)} — {daysUntil(draft.deadline)} day(s) away.</div>}
      {gaps.length > 0 && <div className="warnbox"><b>Gaps to close before drafting:</b><br />{gaps.slice(0, 5).map((g, i) => <span key={i}>• {g}<br /></span>)}</div>}
      {sections.map(([k, label]) => {
        const srcs = srcFor(k);
        return (
          <div key={k} className="card" style={{ marginBottom: 10 }}>
            <div className="h2" style={{ marginTop: 0 }}>{label}</div>
            <textarea className="ta" rows={2} placeholder="Your commentary for this section (appears first)…" value={draft.commentary[k] || ""} onChange={(e) => upd((x) => { x.commentary[k] = e.target.value; })} />
            {srcs.length === 0 && <div className="sub" style={{ marginTop: 6 }}>No suggested content — nothing flagged for this section yet.</div>}
            {srcs.map((s) => {
              const key = k + ":" + s.id;
              const excluded = draft.excluded.includes(key);
              return (
                <div key={key} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", borderTop: "1px solid #EDEFF2", opacity: excluded ? 0.45 : 1 }}>
                  <input type="checkbox" checked={!excluded} onChange={(e) => upd((x) => { x.excluded = e.target.checked ? x.excluded.filter((y) => y !== key) : [...x.excluded, key]; })} />
                  <textarea className="ta" rows={1} style={{ minHeight: 30 }} value={draft.overrides[key] ?? s.text} onChange={(e) => upd((x) => { x.overrides[key] = e.target.value; })} />
                  {draft.overrides[key] !== undefined && draft.overrides[key] !== s.text && <button className="btn sm" title="Revert to source wording" onClick={() => upd((x) => { delete x.overrides[key]; })}>↺</button>}
                </div>);
            })}
          </div>);
      })}
    </div>
  );
}

/* Newsletter with confidentiality controls */
function Newsletter({ data, mutate }) {
  const draft = data.newsDraft;
  const upd = (fn) => mutate((d) => { fn(d.newsDraft); return d; }, null);
  const candidates = [
    ...data.updates.filter((u) => u.flags.news).map((u) => ({ id: "u" + u.id, conf: u.confidentiality, text: u.summary, title: u.title })),
    ...data.workItems.filter((w) => w.flags.news && w.status === "Done" && daysSince(w.completed) <= 40).map((w) => ({ id: "w" + w.id, conf: w.confidentiality, text: w.outcome || w.description || w.title, title: w.title })),
  ];
  const safe = candidates.filter((c) => c.conf === "General internal");
  const heldBack = candidates.filter((c) => c.conf !== "General internal");
  const [art, setArt] = useState("");
  const generate = () => {
    const appr = safe.filter((c) => draft.approved.includes(c.id));
    const lines = [`# Operations newsletter — ${draft.edition}`, ""];
    appr.forEach((c) => { lines.push(`## ${draft.headlines[c.id] || c.title}`, c.text, ""); });
    draft.articles.forEach((a) => { lines.push(`## ${a.title}`, a.body, ""); });
    lines.push(`_Compiled ${fmtD(todayISO())}._`);
    copyText(lines.join("\n")); alert("Newsletter draft copied to clipboard as Markdown.");
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2 className="h1">Newsletter</h2>
        <input className="input" style={{ width: 180 }} value={draft.edition} onChange={(e) => upd((x) => { x.edition = e.target.value; })} />
        <button className="btn pri sm" style={{ marginLeft: "auto" }} onClick={generate} disabled={!draft.approved.length && !draft.articles.length}>Generate & copy draft</button>
      </div>
      <p className="sub">Monthly, first week. Only items marked "General internal" are ever suggested. Everything requires your explicit approval before it appears in a draft.</p>
      {heldBack.length > 0 && <div className="notebox">{heldBack.length} flagged item(s) withheld due to confidentiality markings ({[...new Set(heldBack.map((c) => c.conf))].join(", ")}). They will not be suggested.</div>}
      <div className="h2">Suggested items ({safe.length})</div>
      {safe.length === 0 && <div className="empty">Nothing flagged for the newsletter yet. Tick the "Newsletter" flag on wins and updates as you record them.</div>}
      {safe.map((c) => {
        const approved = draft.approved.includes(c.id);
        const rejected = draft.rejected.includes(c.id);
        return (
          <div key={c.id} className="card" style={{ marginBottom: 8, opacity: rejected ? 0.5 : 1 }}>
            <input className="input" style={{ fontWeight: 600, marginBottom: 4 }} value={draft.headlines[c.id] ?? c.title} onChange={(e) => upd((x) => { x.headlines[c.id] = e.target.value; })} placeholder="Headline" />
            <div style={{ fontSize: 12.5, marginBottom: 6 }}>{c.text}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className={"btn sm" + (approved ? " pri" : "")} onClick={() => upd((x) => { x.approved = approved ? x.approved.filter((y) => y !== c.id) : [...x.approved, c.id]; x.rejected = x.rejected.filter((y) => y !== c.id); })}>{approved ? "Approved ✓" : "Approve"}</button>
              <button className="btn sm" onClick={() => upd((x) => { x.rejected = rejected ? x.rejected.filter((y) => y !== c.id) : [...x.rejected, c.id]; x.approved = x.approved.filter((y) => y !== c.id); })}>{rejected ? "Rejected" : "Reject"}</button>
            </div>
          </div>);
      })}
      <div className="h2">Direct articles</div>
      {draft.articles.map((a, i) => (
        <div key={i} className="card" style={{ marginBottom: 8 }}>
          <input className="input" style={{ fontWeight: 600, marginBottom: 4 }} value={a.title} onChange={(e) => upd((x) => { x.articles[i].title = e.target.value; })} />
          <textarea className="ta" value={a.body} onChange={(e) => upd((x) => { x.articles[i].body = e.target.value; })} />
          <button className="btn sm danger" style={{ marginTop: 6 }} onClick={() => upd((x) => { x.articles.splice(i, 1); })}>Remove</button>
        </div>))}
      <div className="card">
        <textarea className="ta" placeholder="Write an article directly…" value={art} onChange={(e) => setArt(e.target.value)} />
        <button className="btn pri sm" style={{ marginTop: 6 }} disabled={!art.trim()} onClick={() => { upd((x) => { x.articles.push({ title: art.split("\n")[0].slice(0, 70), body: art }); }); setArt(""); }}>Add article</button>
      </div>
    </div>
  );
}

/* ============================================================
   Weekly review, Reports, simpler registers
   ============================================================ */
function WeeklyReview({ data, mutate, go }) {
  const wr = data.weekly;
  const upd = (fn) => mutate((d) => { fn(d.weekly); return d; }, null);
  const open = openItems(data);
  const steps = [
    ["Process everything in the capture inbox", data.workItems.filter((w) => w.status === "Inbox").length + " in inbox", "capture"],
    ["Review overdue items — reschedule, delegate or drop", open.filter(isOverdue).length + " overdue", "actions"],
    ["Review everything due next week", open.filter((w) => { const d = daysUntil(w.due); return d >= 0 && d <= 7; }).length + " due", "actions"],
    ["Chase or re-date all waiting items", data.workItems.filter((w) => w.status === "Waiting").length + " waiting", "waiting"],
    ["Attack blockers — what would unblock each one?", open.filter((w) => w.status === "Blocked").length + " blocked", "actions"],
    ["Update every active project position", data.projects.filter((p) => daysSince(p.updatedAt) > 7 && !["Closed", "Cancelled"].includes(p.stage)).length + " not updated this week", "projects"],
    ["Update every mobilisation and its checklist", data.mobs.filter((m) => daysSince(m.updatedAt) > 7 && m.stage !== "Closed").length + " not updated this week", "mobs"],
    ["Review open risks — mitigations still right?", open.filter((w) => w.type === "Risk").length + " open risks", "risks"],
    ["Review open issues and corrective actions", open.filter((w) => w.type === "Issue").length + " open issues", "risks"],
    ["Chase outstanding decisions", open.filter((w) => w.type === "Decision").length + " open decisions", "decisions"],
    ["Check commitments — still on track? Renegotiate early", open.filter((w) => w.type === "Commitment").length + " open", "decisions"],
    ["Record outcomes on anything completed without one", data.workItems.filter((w) => w.status === "Done" && !w.outcome && daysSince(w.completed) <= 30).length + " missing outcomes", "archive"],
    ["Flag wins for board pack / COO / newsletter", "", "actions"],
    ["Capture lessons from the week (note them in the relevant project)", "", null],
    ["Review stale items", open.filter((w) => daysSince(w.updatedAt) > data.settings.staleItem).length + " stale", "actions"],
    ["Empty your head — capture anything not yet in the system", "", "capture"],
    ["Reset horizons — is 'Now' still right?", open.filter((w) => w.horizon === "Now").length + " in Now", "priorities"],
    ["Set top five priorities for next week", "", null],
    ["Note where you need support or escalation", "", null],
    ["Generate the weekly summary", "", null],
  ];
  const doneCount = steps.filter((_, i) => wr.steps[i]).length;
  const generate = () => {
    const done7 = data.workItems.filter((w) => w.status === "Done" && daysSince(w.completed) <= 7);
    const moved = open.filter((w) => daysSince(w.updatedAt) <= 7);
    const atRisk = open.filter((w) => isOverdue(w) || w.status === "Blocked" || w.rag === "Red");
    const lines = [`# Weekly review — week of ${fmtD(wr.weekOf)}`, "",
      `## Achieved this week`, ...(done7.length ? done7.map((w) => `- ${w.title}${w.outcome ? " — " + w.outcome : ""}`) : ["- (nothing recorded as Done in the last 7 days)"]), "",
      `## Moved forward`, ...moved.filter((w) => !done7.includes(w)).slice(0, 12).map((w) => `- ${w.title} (${w.status})`), "",
      `## Not moving / at risk`, ...atRisk.map((w) => `- ${w.title} — ${isOverdue(w) ? "overdue" : w.status === "Blocked" ? "blocked: " + (w.blocker || "?") : "RED"}`), "",
      `## Top five for next week`, ...wr.topFive.filter(Boolean).map((t, i) => `${i + 1}. ${t}`), "",
      `## Support / escalation needed`, wr.support || "(none noted)", "",
      `_Generated ${fmtD(todayISO())}._`];
    copyText(lines.join("\n")); alert("Weekly summary copied to clipboard.");
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2 className="h1">Weekly Review</h2>
        <span className="chip">{doneCount}/{steps.length} steps</span>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={async () => { if (await askConfirm("Start a fresh weekly review? Step ticks are cleared.")) upd((x) => { x.steps = {}; x.weekOf = todayISO(); x.topFive = ["", "", "", "", ""]; x.support = ""; }); }}>Start new review</button>
        <button className="btn pri sm" onClick={generate}>Generate summary</button>
      </div>
      <p className="sub">A guided walk through the whole system so nothing rots. Work down the list — each step shows the live count and jumps to the right view.</p>
      <div className="card">
        {steps.map(([label, count, nav], i) => (
          <div key={i} className="checkline">
            <input type="checkbox" checked={!!wr.steps[i]} onChange={(e) => upd((x) => { x.steps[i] = e.target.checked; })} />
            <span style={{ flex: 1, textDecoration: wr.steps[i] ? "line-through" : "none", color: wr.steps[i] ? "#8A93A1" : undefined }}>{i + 1}. {label}</span>
            {count && <span className="chip">{count}</span>}
            {nav && <span className="linkish" onClick={() => go(nav)}>open →</span>}
          </div>))}
      </div>
      <div className="h2">Top five for next week</div>
      <div className="card">
        {wr.topFive.map((t, i) => <input key={i} className="input" style={{ marginBottom: 6 }} placeholder={"Priority " + (i + 1)} value={t} onChange={(e) => upd((x) => { x.topFive[i] = e.target.value; })} />)}
        <label className="flab">Support or escalation needed</label>
        <textarea className="ta" value={wr.support} onChange={(e) => upd((x) => { x.support = e.target.value; })} />
      </div>
    </div>
  );
}

/* ============================================================
   Country views, Archive, Settings
   ============================================================ */
function CountryView({ data, openItem, setNav, setProjDetail }) {
  const [c, setC] = useState("UK");
  const items = openItems(data).filter((w) => w.country === c);
  const projs = data.projects.filter((p) => p.country === c && !["Closed", "Cancelled"].includes(p.stage));
  const mobs = data.mobs.filter((m) => m.country === c && m.stage !== "Closed");
  return (
    <div>
      <h2 className="h1">Country View</h2>
      <div className="toolrow" style={{ marginTop: 8 }}>
        {COUNTRIES.map((x) => <button key={x} className={"btn sm" + (c === x ? " pri" : "")} onClick={() => setC(x)}>{x}</button>)}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))" }}>
        <Stat n={items.length} l="Open items" />
        <Stat n={items.filter(isOverdue).length} l="Overdue" tone={items.filter(isOverdue).length ? "bad" : ""} />
        <Stat n={items.filter((w) => w.type === "Risk").length} l="Open risks" />
        <Stat n={projs.length} l="Projects" />
        <Stat n={mobs.length} l="Mobilisations" />
      </div>
      {projs.length > 0 && <><div className="h2">Projects — {c}</div>
        {projs.map((p) => <div key={p.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => { setProjDetail(p.id); setNav("projects"); }}><Rag v={p.rag} /><span style={{ flex: 1 }}>{p.name}</span><span className="chip">{p.stage}</span><span className="mono">{p.progress}%</span></div>)}</>}
      <div className="h2">Open items — {c}</div>
      <ItemsTable data={data} rows={items} onOpen={openItem} cols={["title", "type", "status", "priority", "owner", "due", "updated"]} />
    </div>
  );
}

function Archive({ data, openItem }) {
  const [q, setQ] = useState("");
  let rows = data.workItems.filter((w) => ["Done", "Cancelled"].includes(w.status));
  if (q) rows = rows.filter((w) => (w.title + " " + w.description + " " + (w.outcome || "")).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <h2 className="h1">Archive & History</h2>
      <div className="toolrow" style={{ marginTop: 8 }}>
        <input className="input" style={{ width: 280 }} placeholder="Search completed and cancelled items…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="sub" style={{ margin: 0 }}>{rows.length} archived items</span>
      </div>
      <ItemsTable data={data} rows={rows} onOpen={openItem} cols={["title", "type", "status", "priority", "owner", "parent", "updated"]} />
      <div className="h2">Recent activity</div>
      <div className="card">
        {(data.activity || []).slice(-25).reverse().map((a, i) => (
          <div key={i} className="checkline"><span className="mono" style={{ width: 130 }}>{new Date(a.ts).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><span>{a.text}</span></div>))}
      </div>
    </div>
  );
}

function Settings({ data, mutate, resetAll }) {
  const s = data.settings;
  const set = (k, v) => mutate((d) => { d.settings[k] = v; return d; }, null);
  const fileRef = useRef(null);
  const exportJson = () => downloadFile("cmac-occ-backup-" + todayISO() + ".json", JSON.stringify(data, null, 2), "application/json");
  const importJson = (file) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = JSON.parse(r.result);
        if (!obj.workItems || !obj.projects) throw new Error("Not a recognisable backup file");
        askConfirm("Replace ALL current data with this backup? This cannot be undone.").then((ok) => { if (ok) mutate(() => obj, "Data restored from backup"); });
      } catch (e) { alert("Import failed: " + e.message); }
    };
    r.readAsText(file);
  };
  const exportCsv = () => {
    const csv = toCSV(data.workItems, [["ID", "id"], ["Title", "title"], ["Type", "type"], ["Status", "status"], ["Priority", "priority"], ["Owner", "owner"], ["Waiting on", "waitingOn"], ["Project", (w) => projName(data, w.project)], ["Mobilisation", (w) => mobName(data, w.mob)], ["Country", "country"], ["Due", "due"], ["Completed", "completed"], ["Outcome", "outcome"], ["Confidentiality", "confidentiality"], ["Updated", "updatedAt"]]);
    downloadFile("cmac-occ-workitems-" + todayISO() + ".csv", csv, "text/csv");
  };
  return (
    <div>
      <h2 className="h1">Settings & Data</h2>
      <div className="h2">Profile</div>
      <div className="card"><div className="frow">
        <F label="Your name / role"><input className="input" value={s.userName} onChange={(e) => set("userName", e.target.value)} /></F>
        <F label="Default country"><select className="select" value={s.defaultCountry} onChange={(e) => set("defaultCountry", e.target.value)}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</select></F>
      </div></div>
      <div className="h2">Stale thresholds (days without an update before flagging)</div>
      <div className="card"><div className="frow">
        <F label="Work items"><input type="number" className="input" value={s.staleItem} onChange={(e) => set("staleItem", clamp(+e.target.value || 1, 1, 90))} /></F>
        <F label="Projects"><input type="number" className="input" value={s.staleProject} onChange={(e) => set("staleProject", clamp(+e.target.value || 1, 1, 90))} /></F>
        <F label="Mobilisations"><input type="number" className="input" value={s.staleMob} onChange={(e) => set("staleMob", clamp(+e.target.value || 1, 1, 90))} /></F>
      </div></div>
      <div className="h2">Data</div>
      <div className="card">
        <div className="toolrow" style={{ marginBottom: 0 }}>
          <button className="btn pri" onClick={exportJson}>Export full backup (JSON)</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Import backup (JSON)</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) importJson(e.target.files[0]); e.target.value = ""; }} />
          <button className="btn" onClick={exportCsv}>Export work items (CSV)</button>
          <button className="btn danger" onClick={resetAll}>Clear everything and start fresh</button>
        </div>
        <div className="sub" style={{ margin: "8px 0 0" }}>When signed in, your data is stored securely in the cloud (Supabase, row-level-security isolated) and follows you across devices; a copy is also kept on this device as an offline cache. Export a JSON backup periodically as a safety net. The storage layer is a single small adapter, so changing backend is a contained change.</div>
      </div>
    </div>
  );
}

/* ============================================================
   Global search + Ask anything (AI over your own data)
   ============================================================ */
function serialiseForAI(data) {
  const lim = (s, n) => (s || "").slice(0, n);
  const items = openItems(data).map((w) => ({ title: w.title, type: w.type, status: w.status, priority: w.priority, owner: w.owner, waitingOn: w.waitingOn || undefined, due: w.due || undefined, project: projName(data, w.project) || undefined, mob: mobName(data, w.mob) || undefined, nextAction: lim(w.nextAction, 80) || undefined, blocker: lim(w.blocker, 80) || undefined, madeTo: w.extra?.madeTo }));
  const projects = data.projects.map((p) => ({ name: p.name, stage: p.stage, rag: p.rag, progress: p.progress, owner: p.owner, target: p.target, position: lim(p.position, 140) }));
  const mobs = data.mobs.map((m) => ({ name: m.name, stage: m.stage, rag: m.rag, goLive: m.goLive, readiness: mobReadiness(m).pct + "%" }));
  return JSON.stringify({ today: todayISO(), items, projects, mobs }).slice(0, 14000);
}
function SearchBox({ data, openItem, go, setProjDetail, setMobDetail }) {
  const [q, setQ] = useState("");
  const [openPanel, setOpenPanel] = useState(false);
  const [ai, setAi] = useState({ busy: false, answer: "" });
  const results = useMemo(() => {
    if (!q || q.length < 2) return { items: [], projects: [], mobs: [] };
    const t = q.toLowerCase();
    return {
      items: data.workItems.filter((w) => (w.title + " " + w.description + " " + w.owner + " " + w.waitingOn).toLowerCase().includes(t)).slice(0, 6),
      projects: data.projects.filter((p) => (p.name + " " + p.objective).toLowerCase().includes(t)).slice(0, 3),
      mobs: data.mobs.filter((m) => (m.name + " " + m.client).toLowerCase().includes(t)).slice(0, 3),
    };
  }, [q, data]);
  const ask = async () => {
    setAi({ busy: true, answer: "" });
    try {
      const ans = await askClaude(
        `You answer questions for an operations director about their own tracked work. Use ONLY the JSON data provided — never invent records, owners or dates. If the data doesn't contain the answer, say so plainly. If you infer something (e.g. "these three items relate to the same theme"), label it as an observation rather than recorded fact. Be concise; UK date format.\n\nDATA:\n${serialiseForAI(data)}\n\nQUESTION: ${q}`,
        false, 800);
      setAi({ busy: false, answer: ans });
    } catch (e) { setAi({ busy: false, answer: "The AI service could not be reached just now — search results above still work." }); }
  };
  const any = results.items.length + results.projects.length + results.mobs.length > 0;
  return (
    <div style={{ position: "relative", width: 360 }}>
      <input className="input" placeholder="Search everything, or ask a question…" value={q}
        onChange={(e) => { setQ(e.target.value); setOpenPanel(true); setAi({ busy: false, answer: "" }); }}
        onFocus={() => setOpenPanel(true)}
        onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) ask(); if (e.key === "Escape") setOpenPanel(false); }} />
      {openPanel && q.length >= 2 && (
        <div style={{ position: "absolute", top: "110%", left: 0, right: 0, background: "#fff", border: "1px solid #C7CDD6", borderRadius: 3, boxShadow: "0 8px 24px rgba(17,33,56,.18)", zIndex: 40, maxHeight: 420, overflowY: "auto", padding: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <button className="btn sm pri" onClick={ask} disabled={ai.busy}>{ai.busy ? "Thinking…" : "Ask AI: \"" + q.slice(0, 30) + (q.length > 30 ? "…" : "") + "\""}</button>
            <button className="btn sm" onClick={() => setOpenPanel(false)}>✕</button>
          </div>
          {ai.answer && <div className="notebox" style={{ whiteSpace: "pre-wrap" }}>{ai.answer}</div>}
          {results.projects.map((p) => <div key={p.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => { setProjDetail(p.id); go("projects"); setOpenPanel(false); }}><span className="chip">Project</span><span style={{ flex: 1 }}>{p.name}</span></div>)}
          {results.mobs.map((m) => <div key={m.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => { setMobDetail(m.id); go("mobs"); setOpenPanel(false); }}><span className="chip">Mob</span><span style={{ flex: 1 }}>{m.name}</span></div>)}
          {results.items.map((w) => <div key={w.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => { openItem(w); setOpenPanel(false); }}><span className="chip">{w.type}</span><span style={{ flex: 1 }}>{w.title}</span><span className="chip">{w.status}</span></div>)}
          {!any && !ai.answer && !ai.busy && <div className="sub" style={{ padding: 6 }}>No matches — press Enter to ask the AI instead.</div>}
        </div>)}
    </div>
  );
}

/* ============================================================
   App shell
   ============================================================ */
const NAV = [
  ["Daily working", [["command", "Command Centre"], ["capture", "Capture Inbox"], ["priorities", "My Priorities"], ["actions", "Action Board"], ["waiting", "Waiting & Chasing"]]],
  ["Delivery", [["projects", "Projects"], ["mobs", "Mobilisations"], ["risks", "Risks & Issues"], ["decisions", "Decisions & Commitments"], ["country", "Country View"]]],
  ["Reporting", [["board", "Board Pack"], ["coo", "COO Update"], ["newsletter", "Newsletter"], ["weekly", "Weekly Review"]]],
  ["System", [["archive", "Archive & History"], ["settings", "Settings & Data"]]],
];

export default function App({ auth }) {
  const [data, setData] = useState(null);
  const [nav, setNav] = useState("command");
  const [editItem, setEditItem] = useState(null);
  const [projDetail, setProjDetail] = useState(null);
  const [mobDetail, setMobDetail] = useState(null);
  const [savedAt, setSavedAt] = useState("");
  const [ask, setAsk] = useState(null);
  const askResolver = useRef(null);
  const [storageWarn, setStorageWarn] = useState(false);
  const saveTimer = useRef(null);
  const dataRef = useRef(null);
  dataRef.current = data;

  useEffect(() => {
    (async () => {
      let d = null;
      try { d = await store.load(); } catch (e) { }
      if (!d) { d = seedData(); if (store.available) { const ok = await store.save(d); if (!ok) setStorageWarn(true); } else setStorageWarn(true); }
      else { const s = stripDemo(d); if (s.changed) { d = s.data; if (store.available) await store.save(d); } }
      setData(d);
    })();
  }, []);

  useEffect(() => {
    registerAsk((req) => new Promise((resolve) => { askResolver.current = resolve; setAsk(req); }));
    return () => registerAsk(null);
  }, []);
  const resolveAsk = (v) => { setAsk(null); if (askResolver.current) { askResolver.current(v); askResolver.current = null; } };

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!dataRef.current) return;
      const ok = store.available ? await store.save(dataRef.current) : false;
      if (ok) { setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })); setStorageWarn(false); }
      else setStorageWarn(true);
    }, 700);
  }, []);

  const mutate = useCallback((fn, activityText) => {
    setData((d) => {
      const nd = fn(JSON.parse(JSON.stringify(d)));
      if (activityText) nd.activity = [...(nd.activity || []).slice(-199), { ts: Date.now(), text: activityText }];
      return nd;
    });
    persist();
  }, [persist]);

  if (!data) return (
    <div className="occ" style={{ alignItems: "center", justifyContent: "center" }}>
      <style>{STYLES}</style>
      <div style={{ textAlign: "center", color: "#5C6675" }}>Loading your command centre…</div>
    </div>);

  const openItem = (w) => setEditItem(w);
  const newItem = (preset) => setEditItem({ ...(typeof preset === "object" && preset ? preset : {}) });
  const go = (k) => { setNav(k); if (k !== "projects") setProjDetail(null); if (k !== "mobs") setMobDetail(null); };
  const openProject = (id) => { setProjDetail(id); setNav("projects"); };
  const openMob = (id) => { setMobDetail(id); setNav("mobs"); };
  const saveItem = (w, isNew) => {
    mutate((d) => { if (isNew) d.workItems.push(w); else d.workItems = d.workItems.map((x) => x.id === w.id ? w : x); return d; }, (isNew ? "Created: " : "Updated: ") + w.title);
    setEditItem(null);
  };
  const deleteItem = (id) => { mutate((d) => { d.workItems = d.workItems.filter((x) => x.id !== id); return d; }, "Work item deleted"); setEditItem(null); };
  const resetAll = async () => {
    if (!(await askConfirm("Clear ALL data — every work item, project, mobilisation and report draft? Consider exporting a JSON backup first."))) return;
    if (!(await askConfirm("Absolutely sure? This cannot be undone."))) return;
    const fresh = seedData();
    fresh.workItems = []; fresh.projects = []; fresh.mobs = []; fresh.updates = []; fresh.benefits = []; fresh.lessons = []; fresh.meetings = [];
    fresh.activity = [{ ts: Date.now(), text: "System reset — starting fresh" }];
    mutate(() => fresh, null);
  };
  const alertCount = computeAlerts(data).filter((a) => a.sev >= 2).length;
  const counts = { capture: data.workItems.filter((w) => w.status === "Inbox").length, waiting: data.workItems.filter((w) => w.status === "Waiting").length };

  const view = (() => {
    switch (nav) {
      case "command": return <CommandCentre data={data} mutate={mutate} openItem={openItem} go={go} openProject={openProject} openMob={openMob} />;
      case "capture": return <Capture data={data} mutate={mutate} openItem={openItem} />;
      case "priorities": return <Priorities data={data} mutate={mutate} openItem={openItem} />;
      case "actions": return <ActionBoard data={data} mutate={mutate} openItem={openItem} newItem={newItem} />;
      case "waiting": return <Waiting data={data} mutate={mutate} openItem={openItem} />;
      case "projects": return <Projects data={data} mutate={mutate} openItem={openItem} newItem={newItem} detail={projDetail} setDetail={setProjDetail} />;
      case "mobs": return <Mobilisations data={data} mutate={mutate} openItem={openItem} newItem={newItem} detail={mobDetail} setDetail={setMobDetail} />;
      case "risks": return <RisksView data={data} openItem={openItem} newItem={newItem} />;
      case "decisions": return <Decisions data={data} openItem={openItem} newItem={newItem} />;
      case "country": return <CountryView data={data} openItem={openItem} setNav={setNav} setProjDetail={setProjDetail} />;
      case "board": return <ReportWorkspace data={data} mutate={mutate} kind="board" />;
      case "coo": return <ReportWorkspace data={data} mutate={mutate} kind="coo" />;
      case "newsletter": return <Newsletter data={data} mutate={mutate} />;
      case "weekly": return <WeeklyReview data={data} mutate={mutate} go={go} />;
      case "archive": return <Archive data={data} openItem={openItem} />;
      case "settings": return <Settings data={data} mutate={mutate} resetAll={resetAll} />;
      default: return null;
    }
  })();

  return (
    <div className="occ">
      <style>{STYLES}</style>
      <aside className="side">
        <div className="side-brand">
          <img src={CMAC_LOGO} alt="cmac." className="blogo" />
          <div className="b2">Operations Command Centre</div>
        </div>
        <nav className="side-nav">
          {NAV.map(([group, items]) => (
            <div key={group}>
              <div className="ngroup">{group}</div>
              {items.map(([k, label]) => (
                <div key={k} className={"nitem" + (nav === k ? " on" : "")} onClick={() => go(k)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && go(k)}>
                  <span className="lbl">{label}</span>
                  {k === "command" && alertCount > 0 && <span className="cnt hot">{alertCount}</span>}
                  {k === "capture" && counts.capture > 0 && <span className="cnt">{counts.capture}</span>}
                  {k === "waiting" && counts.waiting > 0 && <span className="cnt">{counts.waiting}</span>}
                </div>))}
            </div>))}
        </nav>
      </aside>
      <div className="main">
        <div className="topbar">
          <span className="ttl">{(NAV.flatMap(([, i]) => i).find(([k]) => k === nav) || [])[1] || ""}</span>
          <SearchBox data={data} openItem={openItem} go={go} setProjDetail={setProjDetail} setMobDetail={setMobDetail} />
          <button className="btn sm pri" onClick={() => newItem()}>+ New</button>
          {auth && (auth.mode === "local"
            ? <span className="saved" title="No cloud configured — data is stored on this device only">Local mode</span>
            : <span className="saved" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span title={auth.email} style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{auth.email}</span>
                <button className="btn sm" onClick={auth.signOut}>Sign out</button>
              </span>)}
          <span className="saved">{storageWarn ? "⚠ not saving — export a backup" : savedAt ? "Saved " + savedAt : "Saved"}</span>
        </div>
        <div className="content">
          {storageWarn && <div className="warnbox">Persistent storage isn't available right now. Your changes may be lost when you leave — use Settings → Export to take a JSON backup.</div>}
          {view}
        </div>
      </div>
      {editItem !== null && <WorkItemModal data={data} item={editItem} onSave={saveItem} onDelete={deleteItem} onClose={() => setEditItem(null)} />}
      <AskDialog req={ask} onResolve={resolveAsk} />
    </div>
  );
}
