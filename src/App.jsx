import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { store } from "./lib/store";
import { supabase } from "./lib/supabase";
import { fileToCapture, ACCEPT, MAX_FILES } from "./lib/ingest";

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
/* The editor offers only the types that actually behave differently; legacy
   values on existing items remain valid and selectable on those items. */
const CORE_TYPES = ["Action","Risk","Issue","Dependency","Decision","Commitment","Idea"];
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
/* "paul.wardle@cmacgroup.com" → "Paul Wardle" */
const emailToName = (em) => (String(em || "").split("@")[0].split(/[._-]+/).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join(" ")) || "Me";
/* current user's display name, with legacy-"Me" tolerance in filters */
const meName = (d) => d.settings.displayName || "Me";
const isMine = (d, w) => w.owner === meName(d) || w.owner === "Me";

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

/**
 * Streaming Claude call for the live assistant. Sends {system, messages,
 * tools} to /api/ai with stream:true and parses the SSE stream, invoking
 * onDelta(textSoFar) as tokens arrive. Returns the final assistant content
 * blocks (text + tool_use) and the stop reason.
 */
async function streamClaude({ system, messages, tools, maxTokens = 1600, onDelta }) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stream: true, system, messages, tools, max_tokens: maxTokens }),
  });
  if (!res.ok || !res.body) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch (e) {}
    throw new Error(detail || ("AI service unavailable (" + res.status + ")"));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const content = [];
  const jsonAcc = {};
  let stop = null;
  const textSoFar = () => content.filter((c) => c && c.type === "text").map((c) => c.text).join("");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let ev;
      try { ev = JSON.parse(dataLine.slice(5).trim()); } catch (e) { continue; }
      if (ev.type === "content_block_start") {
        const b = ev.content_block || {};
        content[ev.index] = b.type === "text" ? { type: "text", text: b.text || "" } : { type: "tool_use", id: b.id, name: b.name, input: b.input || {} };
        jsonAcc[ev.index] = "";
      } else if (ev.type === "content_block_delta") {
        const c = content[ev.index];
        if (!c) continue;
        if (ev.delta?.type === "text_delta") { c.text += ev.delta.text; if (onDelta) onDelta(textSoFar()); }
        else if (ev.delta?.type === "input_json_delta") jsonAcc[ev.index] += ev.delta.partial_json || "";
      } else if (ev.type === "content_block_stop") {
        const c = content[ev.index];
        if (c && c.type === "tool_use" && jsonAcc[ev.index]) {
          try { c.input = JSON.parse(jsonAcc[ev.index]); } catch (e) { c.input = c.input || {}; }
        }
      } else if (ev.type === "message_delta") {
        stop = ev.delta?.stop_reason || stop;
      } else if (ev.type === "error") {
        throw new Error(ev.error?.message || "AI stream error");
      }
    }
  }
  return { content: content.filter(Boolean), stop_reason: stop };
}

/* Append AI-learned notes to the standing context, skipping near-duplicates. */
function appendLearned(d, notes) {
  const existing = ((d.context || {}).learned || "");
  const add = (Array.isArray(notes) ? notes : [notes]).map((s) => String(s || "").trim()).filter(Boolean)
    .filter((s) => !existing.toLowerCase().includes(s.toLowerCase().slice(0, 60)));
  if (!add.length) return d;
  const stamped = add.map((s) => "• " + s + "  (" + fmtD(todayISO()) + ")");
  d.context = { ...(d.context || {}), learned: [existing.trim(), ...stamped].filter(Boolean).join("\n").slice(0, 12000) };
  return d;
}

function captureParsePrompt(text, d) {
  const lim = (s, n) => String(s || "").trim().slice(0, n);
  const ctx = d.context || {};
  const openTitles = d.workItems.filter((w) => OPEN_STATUSES.includes(w.status)).slice(0, 150).map((w) => w.title);
  const ctxBlock = [
    lim(ctx.org, 2500) && "ABOUT THIS OPERATION:\n" + lim(ctx.org, 2500),
    lim(ctx.people, 2500) && "PEOPLE & ROLES (use for owners/waiting-on):\n" + lim(ctx.people, 2500),
    lim(ctx.clients, 2000) && "CLIENTS & TERMINOLOGY:\n" + lim(ctx.clients, 2000),
    lim(ctx.rules, 2500) && "STANDING TRIAGE RULES (apply these when setting priority, flags, workstream and routing):\n" + lim(ctx.rules, 2500),
    lim(ctx.learned, 2500) && "NOTES PREVIOUSLY LEARNED (from earlier captures and conversations — treat as part of the brief):\n" + lim(ctx.learned, 2500),
  ].filter(Boolean).join("\n\n");
  return `You extract and TRIAGE structured work records for an operations director's tracking system. From the input below, identify every distinct action, task, risk, issue, decision, commitment, chaser or follow-up. Respond ONLY with a JSON object (no markdown, no preamble): {"records": [array of records as specified below], "questions": [0-3 short clarifying questions, ONLY where something genuinely important is missing or ambiguous — an unknown person behind initials, an urgent item with no date, unclear which project. Empty array if none.], "learnings": [0-4 short notes worth remembering permanently — ONLY genuinely new lasting facts this input reveals: a person and their role, a client fact, an abbreviation, a standing preference. Never repeat anything already in the context brief. Empty array if nothing new.]}
Each record:
{"title": string (short, imperative), "description": string, "type": one of ${JSON.stringify(TYPES)}, "owner": string or "", "waitingOn": string or "", "due": "YYYY-MM-DD" or "", "priority": one of ["Critical","High","Medium","Low"], "horizon": one of ["Now","Next","Later"], "country": one of ${JSON.stringify(COUNTRIES)} or "", "workstream": exact name from ${JSON.stringify(WORKSTREAMS)} or "", "project": exact name from ${JSON.stringify(d.projects.map((p) => p.name))} or "", "mobilisation": exact name from ${JSON.stringify(d.mobs.map((m) => m.name))} or "", "nextAction": string or "", "flags": {"board": bool, "coo": bool, "news": bool}, "duplicateOf": exact title from the existing-items list below or "", "reasoning": string (one short sentence explaining the triage — priority, routing, flags)}

${ctxBlock ? ctxBlock + "\n\n" : ""}EXISTING OPEN ITEMS (check new records against these; if one clearly covers the same work, set duplicateOf to its exact title):
${JSON.stringify(openTitles)}

Rules: today is ${fmtD(todayISO())} (${todayISO()}). Resolve relative dates like "Friday" or "end of month" to real dates. Do not invent owners, dates or facts not present in the input — but DO use the context above to resolve names to the right people and to apply the standing triage rules. Leave fields empty rather than guessing. Only set flags if the input or the standing rules clearly imply board/COO/newsletter relevance. The input may include typed notes plus attached emails, documents, spreadsheets and screenshots — read them all; note the source file in the description where useful.
INPUT:
${text}`;
}

/* ---------- demonstration data ---------- */
function seedData() {
  return {
    v: 1, workItems: [], projects: [], mobs: [], updates: [], benefits: [], lessons: [], meetings: [],
    stakeholderNotes: {}, dismissedAlerts: [],
    context: { org: "", people: "", clients: "", rules: "", learned: "" },
    boardDraft: { period: monthName(), deadline: "", meetingDate: "", commentary: {}, excluded: [], overrides: {}, complete: [] },
    cooDraft: { period: "Week of " + fmtD(todayISO()), deadline: "", commentary: {}, excluded: [], overrides: {} },
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

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800;900&display=swap');
:root { color-scheme: light; }
* { box-sizing: border-box; }
.occ { display:flex; height:100vh; height:100dvh; width:100%; background:#EDF1F2; color:#112138; font-family:'Montserrat','Segoe UI',system-ui,-apple-system,Arial,sans-serif; font-size:12.5px; font-weight:500; overflow:hidden; }
.occ ::selection { background:#112138; color:#fff; }
.side { width:226px; min-width:226px; background:#112138; color:#C9D1DD; display:flex; flex-direction:column; }
.side-brand { padding:18px 18px 12px; }
.side-brand .blogo { width:120px; height:auto; display:block; }
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
.chat { display:flex; flex-direction:column; gap:8px; }
.aview { display:flex; flex-direction:column; height:calc(100dvh - 122px); min-height:380px; }
.acol { flex:1; display:flex; flex-direction:column; min-height:0; max-width:820px; margin:0 auto; width:100%; }
.bub { max-width:82%; padding:9px 13px; border-radius:14px; font-size:13px; line-height:1.55; white-space:pre-wrap; overflow-wrap:break-word; }
.bub.user { align-self:flex-end; background:#112138; color:#fff; border-bottom-right-radius:4px; }
.bub.ai { align-self:flex-start; background:#fff; border:1px solid #E1E7EC; border-bottom-left-radius:4px; }
.burger { display:none; }
.tabbar { display:none; }
.clip-fab { position:fixed; right:20px; bottom:18px; z-index:45; background:none; border:none; padding:0; cursor:pointer; display:flex; align-items:center; justify-content:center; filter:drop-shadow(0 7px 12px rgba(17,33,56,.35)); transition:transform .15s ease; }
.clip-fab svg { height:68px; width:auto; display:block; }
.clip-fab:hover { transform:scale(1.08) rotate(-8deg); }
.clip-fab:active { transform:scale(.95); }
.aclose { width:40px; height:40px; flex:none; border-radius:50%; background:#112138; color:#fff; border:none; cursor:pointer; font-size:15px; font-weight:700; line-height:1; box-shadow:0 4px 12px rgba(17,33,56,.25); }
.aclose:hover { background:#1c3252; }
@media (max-width: 900px) {
  .tabbar { display:flex; position:fixed; left:0; right:0; bottom:0; z-index:55; background:#112138; justify-content:space-around; padding:6px 4px calc(6px + env(safe-area-inset-bottom)); box-shadow:0 -6px 20px rgba(17,33,56,.25); }
  .tabbar button { background:none; border:none; color:#9FB0C8; font-family:inherit; font-size:9.5px; font-weight:800; letter-spacing:.4px; display:flex; flex-direction:column; align-items:center; gap:2px; padding:4px 10px; cursor:pointer; }
  .tabbar button.on { color:#fff; }
  .tabbar .ticon { font-size:17px; line-height:1; }
  .tabbar .tdot { position:absolute; margin-left:26px; margin-top:-2px; width:8px; height:8px; border-radius:50%; background:#FD0E33; }
  .burger { display:inline-flex; align-items:center; justify-content:center; background:#112138; color:#fff; border:none; border-radius:9px; width:40px; height:36px; font-size:18px; cursor:pointer; flex:none; }
  .side { position:fixed; top:0; left:-300px; bottom:0; width:280px; min-width:280px; z-index:70; transition:left .22s ease; box-shadow:8px 0 30px rgba(17,33,56,.35); }
  .side.open { left:0; }
  .scrim { position:fixed; inset:0; background:rgba(17,33,56,.55); z-index:60; }
  .side-brand .blogo { width:110px; }
  .nitem { padding:11px 18px; font-size:14px; }
  .topbar { flex-wrap:wrap; gap:8px; padding:8px 12px; }
  .topbar .ttl { font-size:14px; }
  .searchwrap { flex:1 1 100%; order:5; width:100% !important; }
  .content { padding:12px 12px 96px; }
  .input, .select, .ta { font-size:16px; }
  .tbl { display:block; overflow-x:auto; -webkit-overflow-scrolling:touch; }
  .grid { grid-template-columns: 1fr !important; }
  .grid:has(.stat) { grid-template-columns: repeat(2, 1fr) !important; }
  .kcol { min-width:250px; width:250px; }
  .kbody { max-height:none; }
  .modal-bg { padding:12px 8px; }
  .modal { padding:14px 14px 18px; }
  .h1 { font-size:16px; }
  .clip-fab { right:14px; bottom:calc(70px + env(safe-area-inset-bottom)); }
  .clip-fab svg { height:62px; }
  .aview { height:calc(100dvh - 205px); }
}
@media (max-width: 480px) { .frow { grid-template-columns:1fr; } .grid:has(.stat) { grid-template-columns:repeat(2,1fr) !important; } }
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
    owner: meName(data), waitingOn: "", project: "", mob: "", workstream: "", country: data.settings.defaultCountry || "UK",
    client: "", due: "", nextChase: "", lastChased: "", completed: "", created: todayISO(), updatedAt: todayISO(),
    rag: "", nextAction: "", blocker: "", horizon: "Next", rank: 50,
    flags: { board: false, coo: false, news: false, groupWeekly: false, ukWeekly: false },
    confidentiality: "General internal", notes: [], extra: {}, outcome: "", ...JSON.parse(JSON.stringify(item)),
  }));
  const [note, setNote] = useState("");
  const [more, setMore] = useState(false);
  const set = (k, v) => setW((x) => ({ ...x, [k]: v }));
  const setX = (k, v) => setW((x) => ({ ...x, extra: { ...x.extra, [k]: v } }));
  const typeOpts = CORE_TYPES.includes(w.type) ? CORE_TYPES : [w.type, ...CORE_TYPES];
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
          <F label="Type"><select className="select" value={w.type} onChange={(e) => set("type", e.target.value)}>{typeOpts.map((t) => <option key={t}>{t}</option>)}</select></F>
          <F label="Status"><select className="select" value={w.status} onChange={(e) => set("status", e.target.value)}>{STATUSES.map((t) => <option key={t}>{t}</option>)}</select></F>
          <F label="Manual priority"><select className="select" value={w.priority} onChange={(e) => set("priority", e.target.value)}>{PRIORITIES.map((t) => <option key={t}>{t}</option>)}</select></F>
          <F label="Owner"><input className="input" value={w.owner} onChange={(e) => set("owner", e.target.value)} /></F>
          <F label="Waiting on"><input className="input" value={w.waitingOn} onChange={(e) => set("waitingOn", e.target.value)} placeholder="Person / team" /></F>
          <F label="Due date"><input type="date" className="input" value={w.due} onChange={(e) => set("due", e.target.value)} /></F>
          <F label="Project"><select className="select" value={w.project} onChange={(e) => set("project", e.target.value)}><option value="">—</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></F>
          <F label="Mobilisation"><select className="select" value={w.mob} onChange={(e) => set("mob", e.target.value)}><option value="">—</option>{data.mobs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></F>
          <F label="Horizon (priorities board)"><select className="select" value={w.horizon} onChange={(e) => set("horizon", e.target.value)}>{HORIZONS.map((t) => <option key={t}>{t}</option>)}</select></F>
          <F label="Description" span><textarea className="ta" value={w.description} onChange={(e) => set("description", e.target.value)} /></F>
          <F label="Next action" span><input className="input" value={w.nextAction} onChange={(e) => set("nextAction", e.target.value)} placeholder="The very next physical step" /></F>
          {more && <>
            <F label="Workstream"><select className="select" value={w.workstream} onChange={(e) => set("workstream", e.target.value)}><option value="">—</option>{WORKSTREAMS.map((t) => <option key={t}>{t}</option>)}</select></F>
            <F label="Country"><select className="select" value={w.country} onChange={(e) => set("country", e.target.value)}><option value="">—</option>{COUNTRIES.map((t) => <option key={t}>{t}</option>)}</select></F>
            <F label="RAG"><select className="select" value={w.rag} onChange={(e) => set("rag", e.target.value)}><option value="">—</option>{RAGS.map((t) => <option key={t}>{t}</option>)}</select></F>
            <F label="Confidentiality"><select className="select" value={w.confidentiality} onChange={(e) => set("confidentiality", e.target.value)}>{CONFIDENTIALITY.map((t) => <option key={t}>{t}</option>)}</select></F>
            <F label="Client"><input className="input" value={w.client} onChange={(e) => set("client", e.target.value)} /></F>
          </>}
          {(w.status === "Blocked" || w.blocker) && <F label="Blocker / reason" span><input className="input" value={w.blocker} onChange={(e) => set("blocker", e.target.value)} /></F>}
          {(w.status === "Waiting") && <>
            <F label="Last chased"><input type="date" className="input" value={w.lastChased} onChange={(e) => set("lastChased", e.target.value)} /></F>
            <F label="Next chase"><input type="date" className="input" value={w.nextChase} onChange={(e) => set("nextChase", e.target.value)} /></F>
          </>}
          {w.status === "Done" && <F label="Outcome delivered" span><textarea className="ta" value={w.outcome} onChange={(e) => set("outcome", e.target.value)} placeholder="What was actually delivered / the benefit" /></F>}
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn sm" onClick={() => setMore((v) => !v)}>{more ? "Fewer options ▲" : "More options ▼"}</button>
          <label style={{ fontSize: 12.5, display: "flex", gap: 5, alignItems: "center" }}>
            <input type="checkbox" checked={!!w.private} onChange={(e) => set("private", e.target.checked)} />
            Private — hidden from view-only users
          </label>
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
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 className="h1">Command Centre</h2>
        <span className="sub" style={{ margin: 0 }}>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
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
        <Stat n={stale.length} l={"Stale >" + data.settings.staleItem + "d"} tone={stale.length ? "warn" : ""} onClick={() => go("actions")} />
      </div>

      {(() => {
        const ev = [];
        open.forEach((w) => { const du = daysUntil(w.due); if (du !== null && du >= 0 && du <= 30) ev.push({ d: w.due, kind: "Due", tone: "#FD0E33", label: w.title, go: () => openItem(w) }); });
        waiting.forEach((w) => { const nc = daysUntil(w.nextChase); if (w.nextChase && nc >= 0 && nc <= 30) ev.push({ d: w.nextChase, kind: "Chase", tone: "#B45309", label: (w.waitingOn ? w.waitingOn + " — " : "") + w.title, go: () => openItem(w) }); });
        activeProjects.forEach((p) => { const dm = daysUntil(p.nextMilestoneDate); if (p.nextMilestone && dm !== null && dm >= 0 && dm <= 30) ev.push({ d: p.nextMilestoneDate, kind: "Milestone", tone: "#112138", label: p.nextMilestone + " — " + p.name, go: () => openProject(p.id) }); });
        activeMobs.forEach((m) => { const dg = daysUntil(m.goLive); if (dg !== null && dg >= 0 && dg <= 30) ev.push({ d: m.goLive, kind: "Go-live", tone: "#FD0E33", label: m.name, go: () => openMob(m.id) }); });
        { const bd = daysUntil(data.cooDraft?.deadline); if (data.cooDraft?.deadline && bd >= 0 && bd <= 30) ev.push({ d: data.cooDraft.deadline, kind: "Board pack", tone: "#1D5FBF", label: "Board pack submission deadline", go: () => go("coo") }); }
        ev.sort((a, b) => a.d.localeCompare(b.d));
        if (!ev.length) return null;
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="h2" style={{ marginTop: 0 }}>Next 30 days</div>
            {ev.slice(0, 14).map((e, i) => (
              <div key={i} className="checkline" style={{ cursor: "pointer", alignItems: "center" }} onClick={e.go}>
                <span className="mono" style={{ width: 52 }}>{fmtD(e.d).slice(0, 5)}</span>
                <span className="chip" style={{ color: e.tone, borderColor: e.tone + "44", flex: "none" }}>{e.kind}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</span>
                <span className="mono" style={{ flex: "none" }}>{daysUntil(e.d)}d</span>
              </div>))}
            {ev.length > 14 && <div className="sub" style={{ margin: "6px 0 0" }}>{ev.length - 14} more within 30 days.</div>}
          </div>
        );
      })()}

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
  const [files, setFiles] = useState([]);
  const [ingesting, setIngesting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [answer, setAnswer] = useState("");
  const [learnings, setLearnings] = useState([]);
  const lastInput = useRef("");
  const fileRef = useRef(null);
  const inbox = data.workItems.filter((w) => w.status === "Inbox");

  const addFiles = async (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setErr(""); setIngesting(true);
    for (const f of incoming) {
      if (files.length + 1 > MAX_FILES) { setErr("Maximum " + MAX_FILES + " attachments per capture."); break; }
      try {
        const processed = await fileToCapture(f);
        setFiles((fs) => fs.length >= MAX_FILES ? fs : [...fs, { ...processed, _id: uid() }]);
      } catch (e) { setErr(String(e.message || e)); }
    }
    setIngesting(false);
  };
  const onPaste = (e) => {
    const imgs = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean);
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  };

  const parse = async () => {
    if (!text.trim() && !files.length) return;
    setBusy(true); setErr("");
    try {
      const attachTexts = files.filter((f) => f.kind === "text").map((f) => `--- Attached file: ${f.name} ---\n${f.text}`).join("\n\n");
      const combined = [text.trim(), attachTexts].filter(Boolean).join("\n\n") || "(see the attached images/documents)";
      const blocks = [];
      files.forEach((f) => {
        if (f.kind === "image") blocks.push({ type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } });
        else if (f.kind === "pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
      });
      blocks.push({ type: "text", text: captureParsePrompt(combined, data) });
      lastInput.current = combined;
      const out = await askClaude(blocks.length === 1 ? blocks[0].text : blocks, true, 3000);
      const recs = Array.isArray(out) ? out : (out.records || []);
      const list = recs.map((p) => ({ ...p, _sel: true, _id: uid() }));
      if (!list.length) setErr("Nothing extractable was found in that input.");
      setProposals(list);
      setQuestions(Array.isArray(out) ? [] : (out.questions || []).slice(0, 3));
      setLearnings(Array.isArray(out) ? [] : (out.learnings || []).slice(0, 4));
      setAnswer("");
    } catch (e) { setErr("Could not parse that just now (" + (e.message || "AI error") + "). You can still add it as a quick note below."); }
    setBusy(false);
  };

  const refine = async () => {
    if (!answer.trim()) return;
    setBusy(true); setErr("");
    try {
      const current = proposals.map(({ _sel, _id, ...rest }) => rest);
      const prompt = captureParsePrompt(lastInput.current || "(input previously provided)", data) +
        `\n\nYOU PREVIOUSLY PROPOSED THESE RECORDS:\n${JSON.stringify(current)}\n\nYOU ASKED THE USER:\n${JSON.stringify(questions)}\n\nTHE USER ANSWERS:\n${answer.trim()}\n\nUpdate the records using these answers (adjust owners, dates, priorities, projects; add or remove records only if the answers imply it). Respond ONLY with the same JSON object shape — keep "questions" empty unless something important is still genuinely unresolved.`;
      const out = await askClaude(prompt, true, 3000);
      const recs = Array.isArray(out) ? out : (out.records || []);
      if (recs.length) setProposals(recs.map((p) => ({ ...p, _sel: true, _id: uid() })));
      setQuestions(Array.isArray(out) ? [] : (out.questions || []).slice(0, 3));
      const learned = Array.isArray(out) ? [] : (out.learnings || []).slice(0, 4);
      if (learned.length) setLearnings((ls) => [...new Set([...ls, ...learned])].slice(0, 6));
      setAnswer("");
    } catch (e) { setErr("Could not apply those answers (" + (e.message || "AI error") + ")."); }
    setBusy(false);
  };
  const quickAdd = () => {
    if (!text.trim()) return;
    mutate((d) => {
      d.workItems.push({ id: uid(), title: text.trim().slice(0, 140), description: text.trim(), type: "Action", status: "Inbox", priority: "Medium", owner: meName(d), waitingOn: "", project: "", mob: "", workstream: "", country: d.settings.defaultCountry,
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
          status: p.waitingOn ? "Waiting" : "Planned", priority: PRIORITIES.includes(p.priority) ? p.priority : "Medium", owner: p.owner || meName(d), waitingOn: p.waitingOn || "",
          project: proj ? proj.id : "", mob: mob ? mob.id : "", workstream: p.workstream || "", country: COUNTRIES.includes(p.country) ? p.country : d.settings.defaultCountry,
          client: "", due: p.due || "", nextChase: "", lastChased: "", completed: "", created: todayISO(), updatedAt: todayISO(), rag: "", nextAction: p.nextAction || "",
          blocker: "", horizon: HORIZONS.includes(p.horizon) ? p.horizon : "Next", rank: 50, flags: { board: !!p.flags?.board, coo: !!p.flags?.coo, news: !!p.flags?.news, groupWeekly: false, ukWeekly: false },
          confidentiality: "General internal",
          notes: [{ ts: todayISO(), text: "Created from capture (AI-proposed, user-approved)" + (p.reasoning ? " — " + p.reasoning : "") + (p.duplicateOf ? " · Possible duplicate of: " + p.duplicateOf : "") }],
          extra: {}, outcome: "" });
      });
      if (!only && learnings.length) appendLearned(d, learnings);
      return d;
    }, `Approved ${chosen.length} captured item(s)` + (!only && learnings.length ? ` · learned ${learnings.length} context note(s)` : ""));
    setProposals((ps) => ps.filter((p) => (only ? p._id !== only : !p._sel)));
    if (!only) { setText(""); setFiles([]); setQuestions([]); setAnswer(""); setLearnings([]); }
  };
  return (
    <div>
      <h2 className="h1">Capture Inbox</h2>
      <p className="sub">Dump anything here — typed notes, Outlook emails (.msg/.eml), Word, Excel, PDFs, screenshots. Drag files in, paste a screenshot, or attach. Claude reads the lot, triages it against your standing brief (Settings → AI context & triage rules) and checks for duplicates; nothing is saved without your approval.</p>
      <div className="card" style={dragOver ? { outline: "2px dashed #FD0E33", outlineOffset: -6 } : null}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}>
        <textarea className="ta" rows={5} value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste}
          placeholder={"Type or paste anything here — notes, an email, meeting minutes, a list of actions… or drop files onto this box (emails, Word, Excel, PDFs, screenshots)."} />
        {files.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {files.map((f) => (
              <span key={f._id} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px" }}>
                {f.kind === "image" ? "🖼" : f.kind === "pdf" ? "📄" : "📎"} {f.name.length > 34 ? f.name.slice(0, 32) + "…" : f.name}
                <span className="linkish" style={{ color: "#FD0E33" }} onClick={() => setFiles((fs) => fs.filter((x) => x._id !== f._id))}>✕</span>
              </span>))}
          </div>)}
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn pri" disabled={busy || ingesting || (!text.trim() && !files.length)} onClick={parse}>{busy ? "Analysing…" : "Propose structured records (AI)"}</button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={ingesting}>{ingesting ? "Reading files…" : "📎 Attach files"}</button>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} style={{ display: "none" }}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button className="btn" disabled={!text.trim()} onClick={quickAdd}>Quick add as inbox note</button>
          <span className="sub" style={{ margin: 0 }}>AI proposals are never auto-saved.</span>
        </div>
        {err && <div className="warnbox" style={{ marginTop: 8 }}>{err}</div>}
      </div>

      {proposals.length > 0 && <>
        <div className="h2">Proposed records — review before saving</div>
        {questions.length > 0 && (
          <div className="card" style={{ marginBottom: 8, borderLeft: "4px solid #1D5FBF" }}>
            <div className="flab">The AI has questions before these are final</div>
            {questions.map((q, i) => <div key={i} style={{ fontSize: 12.5, padding: "2px 0" }}>• {q}</div>)}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input className="input" placeholder="Answer here (one line covers all questions)…" value={answer}
                onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === "Enter" && refine()} />
              <button className="btn pri sm" disabled={busy || !answer.trim()} onClick={refine}>{busy ? "Updating…" : "Answer & update"}</button>
            </div>
            <div className="sub" style={{ margin: "6px 0 0" }}>Or ignore the questions and approve below as-is.</div>
          </div>)}
        {learnings.length > 0 && (
          <div className="card" style={{ marginBottom: 8, borderLeft: "4px solid #2E7D32" }}>
            <div className="flab">New context it will remember when you approve (saved to Settings → AI context)</div>
            {learnings.map((l, i) => (
              <div key={i} style={{ fontSize: 12.5, padding: "2px 0", display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ flex: 1 }}>• {l}</span>
                <span className="linkish" onClick={() => setLearnings((ls) => ls.filter((_, j) => j !== i))}>don't keep</span>
              </div>))}
          </div>)}
        <div className="notebox">These are AI proposals triaged against your context brief. Check owners and dates: anything not stated has been left blank rather than guessed.</div>
        {proposals.map((p) => (
          <div key={p._id} className="card" style={{ marginBottom: 8, borderLeft: "4px solid #112138" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <input type="checkbox" checked={p._sel} onChange={(e) => updateProp(p._id, "_sel", e.target.checked)} />
              <input className="input" style={{ fontWeight: 600 }} value={p.title || ""} onChange={(e) => updateProp(p._id, "title", e.target.value)} />
            </div>
            {p.duplicateOf && <div className="warnbox" style={{ marginBottom: 6 }}>Possible duplicate of existing item: <b>{p.duplicateOf}</b> — approve only if this is genuinely new.</div>}
            {p.reasoning && <div className="sub" style={{ margin: "0 0 6px" }}>Triage: {p.reasoning}</div>}
            <div className="frow">
              <F label="Type"><select className="select" value={p.type || "Action"} onChange={(e) => updateProp(p._id, "type", e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></F>
              <F label="Owner"><input className="input" value={p.owner || ""} onChange={(e) => updateProp(p._id, "owner", e.target.value)} /></F>
              <F label="Waiting on"><input className="input" value={p.waitingOn || ""} onChange={(e) => updateProp(p._id, "waitingOn", e.target.value)} /></F>
              <F label="Due"><input type="date" className="input" value={p.due || ""} onChange={(e) => updateProp(p._id, "due", e.target.value)} /></F>
              <F label="Priority"><select className="select" value={p.priority || "Medium"} onChange={(e) => updateProp(p._id, "priority", e.target.value)}>{PRIORITIES.map((t) => <option key={t}>{t}</option>)}</select></F>
              <F label="Horizon"><select className="select" value={p.horizon || "Next"} onChange={(e) => updateProp(p._id, "horizon", e.target.value)}>{HORIZONS.map((t) => <option key={t}>{t}</option>)}</select></F>
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
          <button className="btn" onClick={() => { setProposals([]); setQuestions([]); setAnswer(""); }}>Discard all</button>
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
          {open.filter((w) => isMine(data, w) && ["Planned", "Inbox"].includes(w.status) && w.priority !== "Critical").slice(0, 5).map((w) => <div key={w.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => openItem(w)}>{w.title}</div>)}
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
  if (f.view === "My actions") rows = rows.filter((w) => isMine(data, w));
  if (f.view === "Delegated") rows = rows.filter((w) => w.owner && !isMine(data, w));
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
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
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
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
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
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
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
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
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
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
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
/* COO 1:1 agenda — mirrors the user's prep structure. Each section carries
   memory-jogger prompts shown as chips; suggested content is routed to the
   right section from tracked work. */
const COO_SECTIONS = [
  ["exec", "Summary", ["The week in three lines", "Anything they must hear from you first"]],
  ["people", "People", ["Staff updates", "High-risk updates", "New role / position requests", "Training & development", "People exception reporting", "Succession planning", "Group POA", "T&Q updates"]],
  ["resourcing", "Resourcing", ["Staffing levels", "Overtime costs", "Recruitment planning", "Turnover"]],
  ["profit", "Profit", ["Operational performance — KPIs / OKRs / service levels", "Targets vs actuals", "Variance & impact", "Goals, targets, actions", "Departmental budget"]],
  ["opsportal", "Ops Portal usage", ["Successes", "Challenges", "Offline working", "Blockers", "Dependencies"]],
  ["priorities", "Priorities", ["Current focuses — what has your attention right now"]],
  ["wins", "Wins", ["Achievements worth his airtime", "Progress he should hear about"]],
  ["challenges", "Challenges & blockers", ["What's stuck, why, and what it needs", "Dependencies on others"]],
  ["projects", "Projects", ["Position, RAG and next milestone per active project"]],
  ["mobs", "Mobilisations", ["Readiness & go-lives", "Slippage or client risk"]],
  ["decisions", "Decisions needed", ["What you need from him, by when"]],
  ["aob", "AOB", ["Risks", "Escalations", "Support needed", "Budget", "Misc"]],
];
const COO_KEYWORDS = {
  people: ["people", "training", "succession", "staff", "t&q", "poa", "capability", "exception report"],
  resourcing: ["resourc", "staffing", "overtime", "recruit", "turnover", "rota", "org design"],
  profit: ["kpi", "okr", "service level", "budget", "target", "variance", "performance", "commission", "cost"],
  opsportal: ["ops portal", "portal", "offline", "digitalisation"],
};

/* One prep workspace, two outputs: the COO update and the board pack share
   every section except People, which never reaches the board output. */
const BOARD_LABELS = { exec: "Executive summary", decisions: "Decisions required from the board", aob: "Risks & AOB", priorities: "Priorities for next period", challenges: "Challenges & service concerns", projects: "Major projects", wins: "Key wins and successes" };

function ReportWorkspace({ data, mutate }) {
  const draft = data.cooDraft;
  const sections = COO_SECTIONS;
  const [tidying, setTidying] = useState("");
  const [sweeping, setSweeping] = useState(false);
  const [aud, setAud] = useState("coo");
  const forBoard = aud === "board";
  const outSections = () => sections.filter(([k]) => !(forBoard && k === "people"));
  const labelFor = (k, label) => (forBoard && BOARD_LABELS[k]) || label;
  const outTitle = forBoard ? "Board operations update" : "COO update";
  const upd = (fn) => mutate((d) => { fn(d.cooDraft); return d; }, null);
  const srcFor = (k) => {
    const open = data.workItems.filter((w) => OPEN_STATUSES.includes(w.status));
    if (k === "priorities") return open.filter((w) => w.horizon === "Now" && w.status !== "Blocked")
      .sort((a, b) => (a.rank || 99) - (b.rank || 99)).slice(0, 8)
      .map((w) => ({ id: "w" + w.id, text: `${w.title}${w.due ? " — due " + fmtD(w.due) : ""}` }));
    if (k === "wins") return [
      ...data.updates.filter((u) => u.flags.coo && (!u.rag || u.rag === "Green")).map((u) => ({ id: "u" + u.id, text: `${u.title}: ${u.summary}` })),
      ...data.workItems.filter((w) => w.status === "Done" && w.flags.coo && daysSince(w.completed) <= 14).map((w) => ({ id: "wd" + w.id, text: `${w.title}${w.outcome ? " — " + w.outcome : ""}` })),
    ];
    if (k === "challenges") return [
      ...open.filter((w) => w.status === "Blocked").slice(0, 8).map((w) => ({ id: "wb" + w.id, text: `Blocked: ${w.title}${w.blocker ? " — " + w.blocker : ""}` })),
      ...open.filter((w) => w.type === "Issue" && ["Critical", "High"].includes(w.priority)).slice(0, 6).map((w) => ({ id: "wi" + w.id, text: `Issue: ${w.title}` })),
      ...data.updates.filter((u) => u.flags.coo && u.rag && u.rag !== "Green").map((u) => ({ id: "u" + u.id, text: `${u.title}: ${u.summary}` })),
    ];
    if (k === "projects") return boardSources(data, "projects");
    if (k === "mobs") return boardSources(data, "mobs");
    if (k === "decisions") return open.filter((w) => w.type === "Decision")
      .sort((a, b) => (b.flags?.coo ? 1 : 0) - (a.flags?.coo ? 1 : 0))
      .map((w) => ({ id: "w" + w.id, text: `${w.title} — required by ${fmtD(w.extra?.requiredBy || w.due)}${w.extra?.recommended ? ". Recommended: " + w.extra.recommended : ""}` }));
    if (k === "aob") return [
      ...open.filter((w) => w.type === "Risk" && (w.flags.coo || ["Critical", "High"].includes(w.priority))).map((w) => ({ id: "w" + w.id, text: `Risk: ${w.title}${w.extra?.mitigation ? " — mitigation: " + w.extra.mitigation : ""}` })),
      ...open.filter((w) => w.status === "Waiting" && ["Critical", "High"].includes(w.priority)).slice(0, 5).map((w) => ({ id: "we" + w.id, text: `Possible escalation: ${w.title} — waiting on ${w.waitingOn || "?"}` })),
    ];
    const kws = COO_KEYWORDS[k] || [];
    return open.filter((w) => {
      const blob = (w.title + " " + (w.description || "") + " " + (w.workstream || "")).toLowerCase();
      return kws.some((t) => blob.includes(t));
    }).slice(0, 10).map((w) => ({ id: "w" + w.id, text: `${w.title}${w.owner ? " (" + w.owner + ")" : ""}${w.due ? " — due " + fmtD(w.due) : ""}` }));
  };
  const tidy = async (k, label) => {
    const notes = (draft.commentary[k] || "").trim();
    if (!notes) return;
    setTidying(k);
    try {
      const out = await askClaude(
        `Rewrite these rough prep scribbles as crisp briefing lines for an executive update. Keep every fact, name and number; do not invent or embellish anything; UK spelling; concise and direct. Return ONLY the briefing lines, one per line starting with "- ".\n\nSECTION: ${label}\nSCRIBBLES:\n${notes}`,
        false, 900);
      if (out && typeof out === "string") upd((x) => { x.commentary[k] = out.trim(); });
    } catch (e) { alert("Could not tidy just now (" + (e.message || "AI error") + ")."); }
    setTidying("");
  };
  const gaps = [];
  data.projects.filter((p) => !["Closed", "Cancelled", "Idea"].includes(p.stage) && !p.position).forEach((p) => gaps.push(`No current position recorded for ${p.name}`));
  data.projects.filter((p) => daysSince(p.updatedAt) > data.settings.staleProject).forEach((p) => gaps.push(`${p.name} not updated for ${daysSince(p.updatedAt)} days`));
  const buildMd = () => {
    const lines = [`# ${outTitle} — ${draft.period}`, ""];
    outSections().forEach(([k, label]) => {
      lines.push(`## ${labelFor(k, label)}`);
      if (draft.commentary[k]) lines.push(draft.commentary[k], "");
      srcFor(k).filter((s) => !draft.excluded.includes(k + ":" + s.id)).forEach((s) => lines.push(`- ${draft.overrides[k + ":" + s.id] || s.text}`));
      lines.push("");
    });
    lines.push(`_Prepared ${fmtD(todayISO())}. Generated from CMAC Operations Command Centre._`);
    return lines.join("\n");
  };
  /* Belt-and-braces for the board output: even though People is excluded
     wholesale, sweep the remaining content for anything person-specific that
     strayed into another section, and show it before it goes anywhere. */
  const boardSweep = async (md) => {
    setSweeping(true);
    try {
      const out = await askClaude(
        `You are checking a BOARD pack draft for content that should not reach a company board because it concerns specific, identifiable individuals: staff performance or conduct concerns, disciplinary matters, PIPs, health, salary, personal circumstances, or anything a named employee would not expect a board to read about them. A name appearing merely as the owner of an action or project is acceptable. Respond ONLY with JSON: {"flags": [{"quote": "the exact offending line or phrase", "reason": "short reason"}]} — an empty array if nothing is concerning.\n\nBOARD PACK DRAFT:\n${md.slice(0, 24000)}`,
        true, 1200);
      const flags = (out && out.flags) || [];
      if (!flags.length) return true;
      const list = flags.slice(0, 6).map((f) => `• "${String(f.quote || "").slice(0, 140)}" — ${f.reason || ""}`).join("\n");
      return await askConfirm(`The AI sweep found ${flags.length} line(s) that look person-specific:\n\n${list}\n\nInclude them in the board pack anyway? (Cancel to go back and edit — person-specific detail belongs in the People section, which never reaches the board.)`);
    } catch (e) {
      return await askConfirm("The AI person-check could not run (" + (e.message || "AI error") + "). Continue without it?");
    } finally { setSweeping(false); }
  };
  const generate = async () => {
    const md = buildMd();
    if (forBoard && !(await boardSweep(md))) return;
    copyText(md); alert(`${outTitle} copied to clipboard as Markdown — paste into Word / email.` + (forBoard ? " People was excluded automatically and the rest passed the person-check. Once the pack is out, take a JSON backup from Settings." : ""));
  };
  const printDraft = async () => {
    if (forBoard && !(await boardSweep(buildMd()))) return;
    const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let body = "";
    outSections().forEach(([k, label]) => {
      const items = srcFor(k).filter((s) => !draft.excluded.includes(k + ":" + s.id));
      if (!draft.commentary[k] && !items.length) return;
      body += `<h2>${esc(labelFor(k, label))}<span class="dot">.</span></h2>`;
      if (draft.commentary[k]) body += `<p class="comm">${esc(draft.commentary[k])}</p>`;
      if (items.length) body += "<ul>" + items.map((s) => `<li>${esc(draft.overrides[k + ":" + s.id] || s.text)}</li>`).join("") + "</ul>";
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(outTitle)} — ${esc(draft.period)}</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font-family: 'Montserrat','Segoe UI',system-ui,sans-serif; color:#112138; font-size:11.5pt; line-height:1.55; margin:0; }
  .head { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #112138; padding-bottom:10px; margin-bottom:6px; }
  .head img { height:34px; }
  h1 { font-size:19pt; font-weight:800; letter-spacing:-.3px; margin:14px 0 2px; }
  .meta { color:#5C6675; font-size:9.5pt; margin-bottom:14px; }
  h2 { font-size:10pt; font-weight:900; color:#FD0E33; text-transform:uppercase; letter-spacing:1.6px; margin:20px 0 6px; page-break-after:avoid; }
  h2 .dot { color:#112138; }
  p.comm { margin:0 0 6px; font-weight:600; }
  ul { margin:4px 0 0 18px; padding:0; } li { margin-bottom:5px; }
  .foot { margin-top:26px; color:#8A93A1; font-size:8.5pt; border-top:1px solid #E1E7EC; padding-top:8px; }
</style></head><body>
<div class="head"><img src="${window.location.origin}/cmac-logo.png" alt="cmac." /><span style="font-size:8.5pt;letter-spacing:2px;color:#5C6675;font-weight:800;">OPERATIONS COMMAND CENTRE</span></div>
<h1>${esc(outTitle)}<span style="color:#FD0E33">.</span></h1>
<div class="meta">${esc(draft.period)} · Prepared ${fmtD(todayISO())} · Paul Wardle</div>
${body}
<div class="foot">Generated from the CMAC Operations Command Centre.</div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},350);});</` + `script></body></html>`;
    const win = window.open("", "_blank");
    if (!win) return alert("Your browser blocked the print window — allow pop-ups for this site.");
    win.document.write(html); win.document.close();
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 className="h1">COO & Board Update</h2>
        <input className="input" style={{ width: 170 }} value={draft.period} onChange={(e) => upd((x) => { x.period = e.target.value; })} />
        <label className="flab" style={{ margin: 0 }}>Board deadline</label>
        <input type="date" className="input" style={{ width: 140 }} value={draft.deadline || ""} onChange={(e) => upd((x) => { x.deadline = e.target.value; })} />
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <button className={"btn sm" + (aud === "coo" ? " pri" : "")} onClick={() => setAud("coo")}>For COO</button>
          <button className={"btn sm" + (forBoard ? " pri" : "")} onClick={() => setAud("board")}>For Board</button>
          <button className="btn sm" disabled={sweeping} onClick={printDraft}>Print / PDF</button>
          <button className="btn pri sm" disabled={sweeping} onClick={generate}>{sweeping ? "Checking for names…" : `Generate & copy ${forBoard ? "board pack" : "COO draft"}`}</button>
        </span>
      </div>
      <p className="sub">One set of prep, two outputs. Scribble under each heading (the grey chips are your memory-joggers, notes save as you go), hit ✦ Tidy to sharpen them, untick or reword the auto-suggested lines — then generate the COO update or the board pack from the same content. <b>People never goes into the board output</b>; everything else, including Resourcing, is shared.</p>
      {draft.deadline && daysUntil(draft.deadline) >= 0 && daysUntil(draft.deadline) <= 5 && <div className={daysUntil(draft.deadline) <= 2 ? "warnbox" : "notebox"}>Board pack deadline {fmtD(draft.deadline)} — {daysUntil(draft.deadline)} day(s) away.</div>}
      {gaps.length > 0 && <div className="warnbox"><b>Gaps to close before drafting:</b><br />{gaps.slice(0, 5).map((g, i) => <span key={i}>• {g}<br /></span>)}</div>}
      {sections.map(([k, label, prompts]) => {
        const srcs = srcFor(k);
        const heldBack = forBoard && k === "people";
        return (
          <div key={k} className="card" style={{ marginBottom: 10, opacity: heldBack ? 0.55 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div className="h2" style={{ marginTop: 0, flex: 1 }}>{label}</div>
              {heldBack && <span className="chip" style={{ background: "#FD0E33", color: "#fff" }}>Not included in the board pack</span>}
              {(draft.commentary[k] || "").trim() && (
                <button className="btn sm" disabled={tidying === k} onClick={() => tidy(k, label)}>{tidying === k ? "Tidying…" : "✦ Tidy scribbles"}</button>)}
            </div>
            {prompts && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "2px 0 8px" }}>
                {prompts.map((p) => <span key={p} className="chip" style={{ fontSize: 10.5 }}>{p}</span>)}
              </div>)}
            <textarea className="ta" rows={3} placeholder="Scribbles — rough bullets are fine; ✦ Tidy sharpens them into briefing lines…" value={draft.commentary[k] || ""} onChange={(e) => upd((x) => { x.commentary[k] = e.target.value; })} />
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
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
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
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
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

/* Team & Access — admin-only management of accounts, approvals and roles.
   Talks to the `profiles` table directly; RLS restricts it to admins. */
function TeamPanel({ onTeamChange }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const resetPw = async (p) => {
    const pw = await askPrompt("New temporary password for " + p.email + " (at least 8 characters). Tell them what it is — they can change it themselves in Settings.");
    if (!pw) return;
    if (pw.length < 8) { setErr("Passwords need at least 8 characters."); return; }
    setErr(""); setMsg("");
    try {
      const { data: s } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (s?.session?.access_token || "") },
        body: JSON.stringify({ user_id: p.user_id, new_password: pw }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setErr(d.error || "Could not set the password.");
      else setMsg("Password updated for " + p.email + " — let them know the new one.");
    } catch (e) { setErr("Could not reach the server: " + (e.message || e)); }
  };
  const load = useCallback(async () => {
    const { data: d, error } = await supabase.from("profiles").select("*");
    if (error) { setErr(error.message); return; }
    const rank = { pending: 0, approved: 1, suspended: 2, rejected: 3 };
    setRows((d || []).sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.email.localeCompare(b.email)));
  }, []);
  useEffect(() => { load(); }, [load]);
  const patch = async (user_id, fields) => {
    const { error } = await supabase.from("profiles").update(fields).eq("user_id", user_id);
    if (error) { setErr(error.message); return; }
    await load();
    if (onTeamChange) onTeamChange();
  };
  const statusChip = (s) => (
    <span className="chip" style={s === "pending" ? { color: "#B45309", borderColor: "#EBCA9B" } : s === "approved" ? { color: "#1A7F44", borderColor: "#BFE0C8" } : { color: "#FD0E33", borderColor: "#F3C2CB" }}>{s}</span>
  );
  return (
    <>
      <div className="h2">Team & access</div>
      <div className="card">
        {err && <div className="warnbox">{err}</div>}
        {msg && <div className="okbox">{msg}</div>}
        {rows === null && <div className="sub">Loading team…</div>}
        {rows && !rows.length && <div className="sub">No accounts yet. Colleagues can request access from the sign-in screen.</div>}
        {rows && rows.map((p) => (
          <div key={p.user_id} className="checkline" style={{ alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{p.email}</span>
            {statusChip(p.status)}
            {p.status === "pending" && <>
              <button className="btn sm pri" onClick={() => patch(p.user_id, { status: "approved", approved_at: new Date().toISOString() })}>Approve (view only)</button>
              <button className="btn sm danger" onClick={() => patch(p.user_id, { status: "rejected" })}>Reject</button>
            </>}
            {p.status === "approved" && <>
              <select className="select" style={{ width: 130 }} value={p.role}
                onChange={(e) => patch(p.user_id, { role: e.target.value })}>
                <option value="viewer">View only</option>
                <option value="editor">Can edit</option>
                <option value="admin">Admin</option>
              </select>
              <button className="btn sm" onClick={() => resetPw(p)}>Set password</button>
              {p.role !== "admin" && <button className="btn sm" onClick={() => patch(p.user_id, { status: "suspended" })}>Suspend</button>}
            </>}
            {(p.status === "rejected" || p.status === "suspended") &&
              <button className="btn sm" onClick={() => patch(p.user_id, { status: "approved", approved_at: new Date().toISOString() })}>Re-approve</button>}
          </div>))}
        <div className="sub" style={{ margin: "10px 0 0" }}>
          New sign-ups appear here as <b>pending</b>. Approve to grant view-only access; use the role dropdown to allow editing. All of this is enforced by the database, not just the interface.
        </div>
      </div>
    </>
  );
}

/* AI context & triage rules — the standing brief injected into every capture
   parse and Ask-AI question, so proposals arrive pre-triaged. */
function ContextPanel({ data, mutate }) {
  const c = data.context || {};
  const set = (k, v) => mutate((d) => { d.context = { ...(d.context || {}), [k]: v }; return d; }, null);
  const fields = [
    ["org", "About you & the operation", "Who you are, your role, what the operation covers, current top priorities…"],
    ["people", "People & roles", "Names, roles and areas — so the AI assigns the right owners and knows who 'waiting on' means…"],
    ["clients", "Clients & terminology", "Key clients, systems and abbreviations (e.g. Minicabit, Ops Portal, T&Q)…"],
    ["rules", "Standing triage rules", "e.g. \"Anything safety-related → Critical + board flag\" · \"Minicabit items → High, Minicabit performance workstream\" · \"Recruitment items belong to HR, never me\"…"],
    ["learned", "Learned by the AI & anything else (AOB)", "The assistant and capture add notes here automatically as they learn — new people, clients, terms, rules. Edit or delete anything; whatever you type here is briefed to the AI too…"],
  ];
  return (
    <>
      <div className="h2">AI context & triage rules</div>
      <div className="card">
        <div className="sub" style={{ marginTop: 0 }}>
          This brief is handed to the AI every time it reads a capture or answers a question — write it like you'd brief a new chief of staff. The better this is, the better everything you dump gets triaged: owners resolved, priorities set, items routed to the right project and flagged for the right report.
        </div>
        {fields.map(([k, l, ph]) => (
          <div key={k} style={{ marginBottom: 8 }}>
            <label className="flab">{l}</label>
            <textarea className="ta" rows={k === "learned" ? 5 : 3} placeholder={ph} value={c[k] || ""} onChange={(e) => set(k, e.target.value)} />
          </div>))}
      </div>
    </>
  );
}

/* Self-service password change for any signed-in account. */
function ChangePassword() {
  const [pw, setPw] = useState("");
  const [m, setM] = useState(null);
  const save = async () => {
    if (pw.length < 8) return setM({ ok: false, text: "Passwords need at least 8 characters." });
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setM({ ok: false, text: error.message });
    else { setM({ ok: true, text: "Password changed. Use it next time you sign in." }); setPw(""); }
  };
  return (
    <>
      <div className="h2">Your account</div>
      <div className="card">
        <div className="flab">Change my password</div>
        <div style={{ display: "flex", gap: 8, maxWidth: 420 }}>
          <input className="input" type="password" placeholder="New password (min 8 characters)" value={pw}
            onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
          <button className="btn pri" disabled={pw.length < 8} onClick={save}>Change</button>
        </div>
        {m && <div className={m.ok ? "okbox" : "warnbox"} style={{ marginTop: 8, marginBottom: 0 }}>{m.text}</div>}
      </div>
    </>
  );
}

function Settings({ data, mutate, resetAll, auth, onTeamChange }) {
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
      {auth?.isAdmin && auth?.mode === "cloud" && supabase && <TeamPanel onTeamChange={onTeamChange} />}
      {(!auth || auth.canEdit) && <ContextPanel data={data} mutate={mutate} />}
      {auth?.mode === "cloud" && supabase && <ChangePassword />}
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
  const ctx = data.context || {};
  const context = lim([ctx.org, ctx.people, ctx.clients, ctx.rules, ctx.learned].filter(Boolean).join("\n"), 4000) || undefined;
  return JSON.stringify({ today: todayISO(), context, items, projects, mobs }).slice(0, 16000);
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
    <div className="searchwrap" style={{ position: "relative", width: "min(360px, 100%)" }}>
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
   Assistant — live conversational Claude over the workspace,
   with tools to create/update work items (approval-gated or auto).
   ============================================================ */
function Assistant({ data, mutate, auth, onClose }) {
  const canEdit = !auth || auth.canEdit;
  const [msgs, setMsgs] = useState([]);
  const [live, setLive] = useState("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [autoApply, setAutoApply] = useState(true);
  const [pending, setPending] = useState(null); // { history, tools:[tool_use…] }
  const [files, setFiles] = useState([]);
  const [ingesting, setIngesting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, live, pending]);

  const addFiles = async (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setIngesting(true);
    for (const f of incoming) {
      if (files.length + 1 > MAX_FILES) break;
      try {
        const processed = await fileToCapture(f);
        setFiles((fs) => fs.length >= MAX_FILES ? fs : [...fs, { ...processed, _id: uid() }]);
      } catch (e) {
        setMsgs((m) => [...m, { role: "assistant", content: [{ type: "text", text: "⚠ " + String(e.message || e) }] }]);
      }
    }
    setIngesting(false);
  };
  const onPaste = (e) => {
    const imgs = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean);
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  };

  /* API view of the conversation: strip UI-only keys, and collapse binary
     attachments from all but the newest attachment-bearing message into short
     placeholders — Claude has already read them, so re-sending the bytes with
     every following turn would only burn credits. */
  const toApiHistory = (history) => {
    let lastAtt = -1;
    history.forEach((m, idx) => {
      if (m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "image" || b.type === "document")) lastAtt = idx;
    });
    return history.map((m, idx) => {
      if (!Array.isArray(m.content)) return { role: m.role, content: m.content };
      return { role: m.role, content: m.content.map((b) => {
        if ((b.type === "image" || b.type === "document") && idx !== lastAtt)
          return { type: "text", text: `[Attachment "${b._name || "file"}" was provided earlier in this conversation and has already been read]` };
        const { _name, ...rest } = b;
        return rest;
      }) };
    });
  };

  const TOOLS = [
    {
      name: "create_work_item",
      description: "Create a new work item (action, risk, issue, dependency, decision, commitment or idea) in the tracker.",
      input_schema: { type: "object", properties: {
        title: { type: "string" }, description: { type: "string" },
        type: { type: "string", enum: CORE_TYPES }, owner: { type: "string" }, waitingOn: { type: "string" },
        due: { type: "string", description: "YYYY-MM-DD" }, priority: { type: "string", enum: ["Critical", "High", "Medium", "Low"] },
        horizon: { type: "string", enum: ["Now", "Next", "Later"] }, project: { type: "string", description: "exact project name" },
        mobilisation: { type: "string", description: "exact mobilisation name" }, workstream: { type: "string" },
        country: { type: "string", enum: COUNTRIES }, nextAction: { type: "string" },
      }, required: ["title"] },
    },
    {
      name: "update_work_item",
      description: "Update an existing work item, found by its exact title. Only include the fields to change. Use note to append an update to its history.",
      input_schema: { type: "object", properties: {
        title: { type: "string", description: "exact existing title" },
        status: { type: "string", enum: STATUSES }, priority: { type: "string", enum: PRIORITIES },
        due: { type: "string" }, owner: { type: "string" }, waitingOn: { type: "string" },
        nextAction: { type: "string" }, nextChase: { type: "string" }, lastChased: { type: "string" },
        horizon: { type: "string", enum: HORIZONS }, blocker: { type: "string" }, outcome: { type: "string" },
        note: { type: "string" },
      }, required: ["title"] },
    },
    {
      name: "remember_context",
      description: "Save a short lasting note to the standing AI context brief (a person and their role, a client fact, an abbreviation, a preference or standing rule). Use when you learn something durable that future captures and conversations should know — especially when the user corrects you or says 'remember this'. Not for one-off tasks: those are work items.",
      input_schema: { type: "object", properties: {
        note: { type: "string", description: "one concise sentence" },
      }, required: ["note"] },
    },
  ];

  const execTool = (tu) => {
    const a = tu.input || {};
    if (tu.name === "create_work_item") {
      if (!a.title) return "Error: a title is required.";
      let created = "";
      mutate((d) => {
        const proj = d.projects.find((x) => x.name === a.project);
        const mob = d.mobs.find((x) => x.name === a.mobilisation);
        d.workItems.push({
          id: uid(), title: a.title, description: a.description || "", type: CORE_TYPES.includes(a.type) ? a.type : "Action",
          status: a.waitingOn ? "Waiting" : "Planned", priority: PRIORITIES.includes(a.priority) ? a.priority : "Medium",
          owner: a.owner || meName(d), waitingOn: a.waitingOn || "", project: proj ? proj.id : "", mob: mob ? mob.id : "",
          workstream: a.workstream || "", country: COUNTRIES.includes(a.country) ? a.country : d.settings.defaultCountry,
          client: "", due: a.due || "", nextChase: "", lastChased: "", completed: "", created: todayISO(), updatedAt: todayISO(),
          rag: "", nextAction: a.nextAction || "", blocker: "", horizon: HORIZONS.includes(a.horizon) ? a.horizon : "Next", rank: 50,
          flags: { board: false, coo: false, news: false, groupWeekly: false, ukWeekly: false }, confidentiality: "General internal",
          notes: [{ ts: todayISO(), text: "Created by the assistant on the user's instruction" }], extra: {}, outcome: "",
        });
        created = a.title;
        return d;
      }, "Assistant created: " + a.title);
      return created ? "Created work item: " + created : "Error: could not create the item.";
    }
    if (tu.name === "update_work_item") {
      let result = "Error: no item titled \"" + (a.title || "") + "\" found.";
      mutate((d) => {
        const w = d.workItems.find((x) => x.title === a.title) ||
                  d.workItems.find((x) => x.title.toLowerCase() === String(a.title || "").toLowerCase());
        if (!w) return d;
        const changed = [];
        [["status", STATUSES], ["priority", PRIORITIES], ["horizon", HORIZONS]].forEach(([k, allowed]) => {
          if (a[k] && allowed.includes(a[k]) && w[k] !== a[k]) { w[k] = a[k]; changed.push(k + " → " + a[k]); }
        });
        ["due", "owner", "waitingOn", "nextAction", "nextChase", "lastChased", "blocker", "outcome"].forEach((k) => {
          if (a[k] !== undefined && a[k] !== "" && w[k] !== a[k]) { w[k] = a[k]; changed.push(k + " → " + a[k]); }
        });
        if (a.note) { w.notes = [...(w.notes || []), { ts: todayISO(), text: a.note }]; changed.push("note added"); }
        if (w.status === "Done" && !w.completed) w.completed = todayISO();
        w.updatedAt = todayISO();
        result = changed.length ? "Updated \"" + w.title + "\": " + changed.join(", ") : "No changes applied to \"" + w.title + "\".";
        return d;
      }, "Assistant updated: " + a.title);
      return result;
    }
    if (tu.name === "remember_context") {
      const note = String(a.note || "").trim();
      if (!note) return "Error: a note is required.";
      mutate((d) => appendLearned(d, note), "Assistant learned: " + note.slice(0, 80));
      return "Saved to the standing context brief: " + note;
    }
    return "Error: unknown tool.";
  };

  const systemPrompt = () =>
    `You are the embedded assistant inside the CMAC Operations Command Centre, working for ${meName(data)} (${auth?.isAdmin ? "administrator" : canEdit ? "editor" : "view-only user"}). Today is ${fmtD(todayISO())} (${todayISO()}). Be concise, practical and direct; UK date format; plain prose (no markdown headers).
${canEdit ? "When the user asks you to log, create, chase, close or change something, use the tools — then confirm briefly what you did. When you learn a durable fact — a person's role, a client, an abbreviation, a standing preference, or the user corrects you on something lasting — save one concise note with remember_context so future captures and conversations know it. Don't save one-off task details that way." : "The user has view-only access — never attempt changes; explain that edits need the administrator."}
Messages may include attached files — emails, documents, spreadsheets (as CSV text), PDFs, screenshots. Read them fully and pull out what matters${canEdit ? "; when asked to log from them, create the items with the tools" : ""}.
Ground every answer ONLY in the workspace data below, the conversation and any attached files. If something isn't tracked, say so plainly. Label inferences as observations.
WORKSPACE:
${serialiseForAI(data)}`;

  const runRounds = async (history) => {
    let rounds = 0;
    while (rounds++ < 6) {
      const r = await streamClaude({ system: systemPrompt(), messages: toApiHistory(history), tools: canEdit ? TOOLS : undefined, onDelta: setLive });
      const asst = { role: "assistant", content: r.content };
      history = [...history, asst];
      setMsgs(history); setLive("");
      const tus = r.content.filter((c) => c.type === "tool_use");
      if (r.stop_reason !== "tool_use" || !tus.length) break;
      if (!autoApply) { setPending({ history, tools: tus }); return; }
      const results = tus.map((tu) => ({ type: "tool_result", tool_use_id: tu.id, content: execTool(tu) }));
      history = [...history, { role: "user", content: results }];
      setMsgs(history);
    }
  };

  const send = async (textIn) => {
    const typed = (textIn ?? input).trim();
    if ((!typed && !files.length) || busy || pending || ingesting) return;
    const attachTexts = files.filter((f) => f.kind === "text").map((f) => `--- Attached file: ${f.name} ---\n${f.text}`).join("\n\n");
    const fullText = [typed || "Read the attached file(s): summarise what matters and suggest what I should log or do.", attachTexts].filter(Boolean).join("\n\n");
    let userMsg;
    if (files.length) {
      const blocks = [];
      files.forEach((f) => {
        if (f.kind === "image") blocks.push({ type: "image", source: { type: "base64", media_type: f.media_type, data: f.data }, _name: f.name });
        else if (f.kind === "pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, _name: f.name });
      });
      blocks.push({ type: "text", text: fullText });
      userMsg = { role: "user", content: blocks, _display: typed, _atts: files.map((f) => f.name) };
    } else {
      userMsg = { role: "user", content: fullText, _display: typed };
    }
    const history = [...msgs, userMsg];
    setMsgs(history); setInput(""); setFiles([]); setBusy(true); setLive("");
    try { await runRounds(history); }
    catch (e) { setMsgs((m) => [...m, { role: "assistant", content: [{ type: "text", text: "⚠ " + (e.message || "The AI service could not be reached.") }] }]); setLive(""); }
    setBusy(false);
  };

  const resolvePending = async (approve) => {
    if (!pending) return;
    const { history, tools } = pending;
    setPending(null); setBusy(true);
    try {
      const results = tools.map((tu) => ({ type: "tool_result", tool_use_id: tu.id, content: approve ? execTool(tu) : "User declined this action." }));
      await runRounds([...history, { role: "user", content: results }]);
    } catch (e) { setMsgs((m) => [...m, { role: "assistant", content: [{ type: "text", text: "⚠ " + (e.message || "AI error") }] }]); }
    setBusy(false);
  };

  const describeTool = (tu) => tu.name === "create_work_item"
    ? "Create item: " + (tu.input?.title || "…") + (tu.input?.due ? " (due " + fmtD(tu.input.due) + ")" : "")
    : tu.name === "remember_context"
    ? "Remember: " + (tu.input?.note || "…")
    : "Update \"" + (tu.input?.title || "…") + "\" — " + Object.keys(tu.input || {}).filter((k) => k !== "title").join(", ");

  const renderMsg = (m, i) => {
    if (m.role === "user") {
      if (Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"))
        return <div key={i} className="sub" style={{ textAlign: "right", margin: "0 0 2px" }}>✓ actioned</div>;
      const shown = m._display !== undefined ? m._display : (typeof m.content === "string" ? m.content : "");
      return (
        <div key={i} className="bub user">
          {(m._atts || []).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: shown ? 6 : 0 }}>
              {m._atts.map((n, j) => <span key={j} style={{ fontSize: 10.5, background: "rgba(255,255,255,.18)", borderRadius: 6, padding: "2px 7px" }}>📎 {n}</span>)}
            </div>)}
          {shown}
        </div>
      );
    }
    const text = (m.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const tools = (m.content || []).filter((c) => c.type === "tool_use");
    return (
      <React.Fragment key={i}>
        {text && <div className="bub ai">{text}</div>}
        {tools.map((tu, j) => <div key={j} className="bub ai" style={{ fontSize: 11.5, color: "#5C6675" }}>⚙ {describeTool(tu)}</div>)}
      </React.Fragment>
    );
  };

  const starters = canEdit
    ? ["What needs my attention today?", "What am I waiting on from others?", "Summarise every RED project and mobilisation", "Log a chase to follow up tomorrow"]
    : ["What needs attention today?", "Summarise the project portfolio", "What go-lives are coming up?"];

  const name = meName(data);
  const who = name && name !== "Me" ? ", " + name.split(" ")[0] : "";
  const hr = new Date().getHours();
  const greet = hr < 5 ? "Late one" : hr < 12 ? "Morning" : hr < 17 ? "Afternoon" : hr < 21 ? "Evening" : "Late one";

  return (
    <div className="aview"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 className="h1">Assistant</h2>
        {canEdit && <label style={{ fontSize: 11.5, display: "flex", gap: 5, alignItems: "center", marginLeft: "auto", color: "#5C6675", fontWeight: 700 }}>
          <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
          Apply changes without asking
        </label>}
      </div>
      <div className="acol">
      <div className="chat" style={{ flex: 1, overflowY: "auto", paddingBottom: 8, ...(dragOver ? { outline: "2px dashed #FD0E33", outlineOffset: -4, borderRadius: 12 } : {}) }}>
        {!msgs.length && !live && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16, padding: "16px 10px" }}>
            <ClipMark size={100} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, color: "#112138" }}>{greet}{who}. What can I sort for you?</div>
              <div className="sub" style={{ marginTop: 6, maxWidth: 470, marginLeft: "auto", marginRight: "auto" }}>
                {canEdit
                  ? "Ask about anything in the workspace, or tell me what to log, chase, update or close. Drop an email, spreadsheet, PDF or screenshot straight into the chat and I'll read it. Conversations reset when you leave this screen."
                  : "Ask about anything in the workspace, or drop a file in for me to read — view-only accounts can ask questions but not make changes."}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 580 }}>
              {starters.map((s) => <button key={s} className="btn sm" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>)}
        {msgs.map(renderMsg)}
        {live && <div className="bub ai">{live}<span style={{ opacity: .5 }}>▍</span></div>}
        {busy && !live && <div className="bub ai" style={{ color: "#8A93A1" }}>Thinking…</div>}
        {pending && (
          <div className="card" style={{ borderLeft: "4px solid #FD0E33" }}>
            <div className="flab">The assistant wants to make {pending.tools.length} change{pending.tools.length > 1 ? "s" : ""}:</div>
            {pending.tools.map((tu, j) => <div key={j} style={{ fontSize: 12.5, padding: "3px 0" }}>⚙ {describeTool(tu)}</div>)}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button className="btn sm pri" onClick={() => resolvePending(true)}>Approve & apply</button>
              <button className="btn sm" onClick={() => resolvePending(false)}>Decline</button>
            </div>
          </div>)}
        <div ref={endRef} />
      </div>
      {(files.length > 0 || ingesting) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {files.map((f) => (
            <span key={f._id} className="chip">
              {f.kind === "image" ? "🖼" : "📎"} {f.name}
              <span className="linkish" style={{ marginLeft: 6 }} onClick={() => setFiles((fs) => fs.filter((x) => x._id !== f._id))}>✕</span>
            </span>))}
          {ingesting && <span className="chip">Reading file…</span>}
        </div>)}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <div style={{ flex: 1, display: "flex", gap: 6, alignItems: "center", padding: "6px 6px 6px 8px", background: "#fff", border: "1px solid #E1E7EC", borderRadius: 999, boxShadow: "0 4px 18px rgba(17,33,56,.07)" }}>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} style={{ display: "none" }}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button style={{ border: "none", background: "none", fontSize: 17, cursor: "pointer", padding: "4px 6px", flex: "none" }}
            title="Attach files (emails, Word, Excel, PDFs, screenshots)" aria-label="Attach files" onClick={() => fileRef.current?.click()}>📎</button>
          <input className="input" style={{ flex: 1, border: "none", background: "transparent", outline: "none", boxShadow: "none" }} placeholder="Ask, tell it what to do, or drop a file…" value={input}
            onChange={(e) => setInput(e.target.value)} onPaste={onPaste}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn pri" style={{ borderRadius: 999 }} disabled={busy || !!pending || ingesting || (!input.trim() && !files.length)} onClick={() => send()}>Send</button>
        </div>
        {onClose && <button className="aclose" onClick={onClose} aria-label="Close assistant" title="Close assistant">✕</button>}
      </div>
      </div>
    </div>
  );
}

/* ============================================================
   App shell
   ============================================================ */

/* The paperclip mascot — a vector recreation of the 90s office legend, so he
   stays pin-sharp at any size. Shared by the floating button and the
   Assistant screen. `size` is the rendered height in px. */
function ClipMark({ size = 68 }) {
  const wire = "M30 58 V138 a22 22 0 0 0 44 0 V44 a15 15 0 0 0 -30 0 V126 a7 7 0 0 0 14 0 V58";
  return (
    <svg width={size / 2} height={size} viewBox="0 0 100 200" aria-hidden="true">
      <defs>
        <linearGradient id="cm-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d6dbee" />
          <stop offset="0.45" stopColor="#a6adcc" />
          <stop offset="0.75" stopColor="#8890b4" />
          <stop offset="1" stopColor="#b3bad8" />
        </linearGradient>
        <radialGradient id="cm-eye" cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#f2f4fa" />
          <stop offset="1" stopColor="#c9cfe2" />
        </radialGradient>
      </defs>
      <path d={wire} fill="none" stroke="#303a58" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d={wire} fill="none" stroke="url(#cm-metal)" strokeWidth="6.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={wire} fill="none" stroke="rgba(255,255,255,.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" transform="translate(-1.1,-1.2)" />
      <ellipse cx="56" cy="62" rx="13" ry="13.6" fill="url(#cm-eye)" stroke="#2f3550" strokeWidth="1.7" />
      <ellipse cx="52.5" cy="65" rx="6.4" ry="6.9" fill="#101423" />
      <circle cx="50.2" cy="62.2" r="1.7" fill="#fff" opacity=".9" />
      <ellipse cx="33" cy="50" rx="13" ry="13.6" fill="url(#cm-eye)" stroke="#2f3550" strokeWidth="1.7" />
      <ellipse cx="29.5" cy="53" rx="6.4" ry="6.9" fill="#101423" />
      <circle cx="27.2" cy="50.2" r="1.7" fill="#fff" opacity=".9" />
      <path d="M20 33 q7 -6 17 -3" fill="none" stroke="#12141c" strokeWidth="4" strokeLinecap="round" />
      <path d="M48 45 q9 -6 17 0" fill="none" stroke="#12141c" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/* Floating assistant button — Clippy standing in the corner of every screen.
   Hidden while the Assistant is open; its composer row carries the close button. */
function ClipFab({ open, onClick }) {
  if (open) return null;
  return (
    <button className="clip-fab" onClick={onClick} aria-label="Open assistant" title="Assistant">
      <ClipMark size={68} />
    </button>
  );
}

const NAV = [
  ["Daily working", [["command", "Command Centre"], ["capture", "Capture Inbox"], ["priorities", "My Priorities"], ["actions", "Action Board"], ["waiting", "Waiting & Chasing"]]],
  ["Delivery", [["projects", "Projects"], ["mobs", "Mobilisations"], ["risks", "Risks & Issues"], ["decisions", "Decisions & Commitments"], ["country", "Country View"]]],
  ["Reporting", [["coo", "COO & Board Update"], ["newsletter", "Newsletter"], ["weekly", "Weekly Review"]]],
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
  const [roNotice, setRoNotice] = useState(false);
  const [pendingReqs, setPendingReqs] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const lastSynced = useRef(0);
  const prevNav = useRef("command");
  const canEdit = !auth || auth.canEdit;

  // Admin: watch for access requests awaiting approval.
  const refreshPending = useCallback(async () => {
    if (!supabase || !auth?.isAdmin || auth.mode !== "cloud") return;
    const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true }).eq("status", "pending");
    setPendingReqs(count || 0);
  }, [auth?.isAdmin, auth?.mode]);
  useEffect(() => { refreshPending(); }, [refreshPending]);
  const saveTimer = useRef(null);
  const dataRef = useRef(null);
  dataRef.current = data;

  useEffect(() => {
    (async () => {
      let d = null;
      try { d = await store.load(); } catch (e) { }
      let dirty = false;
      if (!d) { d = seedData(); dirty = true; }
      else { const s = stripDemo(d); if (s.changed) { d = s.data; dirty = true; } }
      // Identity: owners are real names in a shared workspace. Resolve the
      // signed-in user's display name and migrate any legacy "Me" owners.
      const displayName = auth && auth.mode === "cloud" ? emailToName(auth.email) : "Me";
      if (d.settings.displayName !== displayName) { d.settings.displayName = displayName; dirty = true; }
      if (!d.context) { d.context = { org: "", people: "", clients: "", rules: "", learned: "" }; dirty = true; }
      if (canEdit && displayName !== "Me") {
        d.workItems.forEach((w) => { if (w.owner === "Me") { w.owner = displayName; dirty = true; } });
      }
      // View-only accounts never see private items (also excluded from search/AI
      // because they simply aren't in the loaded document).
      if (auth && auth.mode === "cloud" && !auth.canEdit) {
        d = { ...d, workItems: d.workItems.filter((w) => !w.private) };
      }
      lastSynced.current = d.rev || 0;
      setData(d);
      if (dirty && canEdit) {
        const res = await store.save(d, null);
        if (!res.ok && !res.conflict) setStorageWarn(true);
        else lastSynced.current = d.rev || 0;
      }
    })();
  }, []);

  // Save-as-you-go companion: when the app regains focus (phone unlock, tab
  // switch), pull the latest copy if another device has saved a newer one.
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      try {
        const remote = await store.load();
        if (remote && (remote.rev || 0) > ((dataRef.current && dataRef.current.rev) || 0)) {
          lastSynced.current = remote.rev || 0;
          setData(auth && auth.mode === "cloud" && !auth.canEdit
            ? { ...remote, workItems: remote.workItems.filter((w) => !w.private) }
            : remote);
        }
      } catch (e) { }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); };
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
      const res = await store.save(dataRef.current, lastSynced.current);
      if (res.conflict && res.remote) {
        // Another device saved first. Never overwrite — adopt the newer copy.
        lastSynced.current = res.remote.rev || 0;
        setData(res.remote);
        setSyncNote("This workspace was updated on another device — now showing the latest version. Re-apply your last change if it's missing.");
        setStorageWarn(false);
      } else if (res.ok) {
        lastSynced.current = (dataRef.current && dataRef.current.rev) || 0;
        setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
        setStorageWarn(false);
      } else {
        setStorageWarn(true);
      }
    }, 700);
  }, []);

  const mutate = useCallback((fn, activityText) => {
    // View-only accounts: the database rejects their writes anyway (RLS);
    // block here too so the UI doesn't drift from the stored truth.
    if (!canEdit) { setRoNotice(true); return; }
    setData((d) => {
      const nd = fn(JSON.parse(JSON.stringify(d)));
      nd.rev = (nd.rev || 0) + 1;
      if (activityText) nd.activity = [...(nd.activity || []).slice(-199), { ts: Date.now(), text: activityText }];
      return nd;
    });
    persist();
  }, [persist, canEdit]);

  if (!data) return (
    <div className="occ" style={{ alignItems: "center", justifyContent: "center" }}>
      <style>{STYLES}</style>
      <div style={{ textAlign: "center", color: "#5C6675" }}>Loading your command centre…</div>
    </div>);

  const openItem = (w) => setEditItem(w);
  const newItem = (preset) => setEditItem({ ...(typeof preset === "object" && preset ? preset : {}) });
  const go = (k) => { setNav(k); setNavOpen(false); if (k !== "projects") setProjDetail(null); if (k !== "mobs") setMobDetail(null); };
  const toggleAssistant = () => {
    if (nav === "assistant") go(prevNav.current || "command");
    else { prevNav.current = nav; go("assistant"); }
  };
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
      case "assistant": return <Assistant data={data} mutate={mutate} auth={auth} onClose={toggleAssistant} />;
      case "capture": return <Capture data={data} mutate={mutate} openItem={openItem} />;
      case "priorities": return <Priorities data={data} mutate={mutate} openItem={openItem} />;
      case "actions": return <ActionBoard data={data} mutate={mutate} openItem={openItem} newItem={newItem} />;
      case "waiting": return <Waiting data={data} mutate={mutate} openItem={openItem} />;
      case "projects": return <Projects data={data} mutate={mutate} openItem={openItem} newItem={newItem} detail={projDetail} setDetail={setProjDetail} />;
      case "mobs": return <Mobilisations data={data} mutate={mutate} openItem={openItem} newItem={newItem} detail={mobDetail} setDetail={setMobDetail} />;
      case "risks": return <RisksView data={data} openItem={openItem} newItem={newItem} />;
      case "decisions": return <Decisions data={data} openItem={openItem} newItem={newItem} />;
      case "country": return <CountryView data={data} openItem={openItem} setNav={setNav} setProjDetail={setProjDetail} />;
      case "board": case "coo": return <ReportWorkspace data={data} mutate={mutate} />;
      case "newsletter": return <Newsletter data={data} mutate={mutate} />;
      case "weekly": return <WeeklyReview data={data} mutate={mutate} go={go} />;
      case "archive": return <Archive data={data} openItem={openItem} />;
      case "settings": return <Settings data={data} mutate={mutate} resetAll={resetAll} auth={auth} onTeamChange={refreshPending} />;
      default: return null;
    }
  })();

  return (
    <div className="occ">
      <style>{STYLES}</style>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <aside className={"side" + (navOpen ? " open" : "")}>
        <div className="side-brand">
          <img src="/cmac-logo-white.png" alt="cmac." className="blogo" />
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
                  {k === "settings" && pendingReqs > 0 && <span className="cnt hot">{pendingReqs}</span>}
                </div>))}
            </div>))}
        </nav>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="burger" onClick={() => setNavOpen(true)} aria-label="Open menu">☰</button>
          <span className="ttl">{nav === "assistant" ? "Assistant" : (NAV.flatMap(([, i]) => i).find(([k]) => k === nav) || [])[1] || ""}</span>
          <SearchBox data={data} openItem={openItem} go={go} setProjDetail={setProjDetail} setMobDetail={setMobDetail} />
          {canEdit && <button className="btn sm pri" onClick={() => newItem()}>+ New</button>}
          {!canEdit && <span className="chip" title="Only the administrator can make changes">View only</span>}
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
          {roNotice && <div className="notebox">You have view-only access — changes aren't saved. Ask Paul Wardle if you need editing rights. <span className="linkish" onClick={() => setRoNotice(false)}>Dismiss</span></div>}
          {syncNote && <div className="notebox">{syncNote} <span className="linkish" onClick={() => setSyncNote("")}>Dismiss</span></div>}
          {pendingReqs > 0 && <div className="warnbox">{pendingReqs} access request{pendingReqs > 1 ? "s" : ""} awaiting your approval. <span className="linkish" onClick={() => go("settings")}>Review in Settings → Team & access</span></div>}
          {view}
        </div>
      </div>
      <nav className="tabbar">
        {[["command", "⌂", "Home"], ["capture", "＋", "Capture"], ["waiting", "⏳", "Waiting"]].map(([k, icon, label]) => (
          <button key={k} className={nav === k ? "on" : ""} onClick={() => go(k)}>
            {k === "command" && alertCount > 0 && <span className="tdot" />}
            <span className="ticon">{icon}</span>{label}
          </button>))}
        <button onClick={() => setNavOpen(true)}>
          {pendingReqs > 0 && <span className="tdot" />}
          <span className="ticon">☰</span>Menu
        </button>
      </nav>
      <ClipFab open={nav === "assistant"} onClick={toggleAssistant} />
      {editItem !== null && <WorkItemModal data={data} item={editItem} onSave={saveItem} onDelete={deleteItem} onClose={() => setEditItem(null)} />}
      <AskDialog req={ask} onResolve={resolveAsk} />
    </div>
  );
}
