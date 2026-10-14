/* ============================================================
   The wand.

   You think in dumps. "whatsapp integration complete, use case rollout
   for passengers, big jump in chats, loads we can't help with, team
   unhappy, need a working group with BC and devs." That is a perfectly
   good account of where something is — it is just not something you
   would paste into a board pack.

   So the wand takes what you typed, reads the project it belongs to,
   and hands back the same substance in prose you could send. It never
   saves: it shows you the rewrite beside your own words and you choose.
   And it never adds facts — if a date, an owner or a number is not in
   your text or in the project, it does not appear in the output.

   One button, three jobs: tidy an objective, write a position, turn a
   mind-dump into an update.
   ============================================================ */
import React, { useState } from "react";
import { askClaude } from "../lib/claude";
import { fmtD, AutoTa } from "../ui";
import { childProjects, portfolioAttention, isOpen, isOverdue, todayISO } from "../lib/model";

/* What the project actually holds, in the fewest words that still let a
   reader say something true about it. */
export function projectBrief(data, p) {
  const kids = childProjects(data, p.id);
  const ids = new Set([p.id, ...kids.map((k) => k.id)]);
  const items = data.workItems.filter((w) => ids.has(w.project) && isOpen(w));
  const updates = (data.updates || []).filter((u) => ids.has(u.project))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);
  const line = (w) => `- ${w.title} [${w.status}${w.mode === "Waiting on" ? ", waiting on " + (w.waitingOn || "?") : ""}${w.due ? ", due " + fmtD(w.due) : ""}${isOverdue(w) ? ", OVERDUE" : ""}${w.project !== p.id ? ", in " + (kids.find((k) => k.id === w.project) || {}).name : ""}]`;
  return [
    `PROJECT: ${p.name}`,
    p.objective && `OBJECTIVE: ${p.objective}`,
    `STAGE: ${p.stage}${p.owner ? ` · OWNER: ${p.owner}` : ""}${p.target ? ` · TARGET: ${fmtD(p.target)}` : ""}`,
    p.blocked && `BLOCKED: ${p.blocker || p.blockedBy || "yes"}`,
    p.position && `POSITION RECORDED PREVIOUSLY: ${p.position}`,
    kids.length && "WORKSTREAMS:\n" + kids.map((k) => {
      const h = portfolioAttention(data, k, "project", data.settings);
      return `- ${k.name}: ${k.stage}, ${h.rag}${k.owner ? ", " + k.owner : ""}${h.reasons.length ? " — " + h.reasons.join("; ") : ""}`;
    }).join("\n"),
    items.length ? `OPEN WORK (${items.length}):\n` + items.slice(0, 30).map(line).join("\n") : "OPEN WORK: none recorded",
    updates.length ? "RECENT UPDATES:\n" + updates.map((u) => `- ${fmtD(u.date)}: ${u.summary}`).join("\n") : "RECENT UPDATES: none",
  ].filter(Boolean).join("\n");
}

const JOBS = {
  objective: {
    label: "Tidy", empty: "Write an objective for this from what the project holds.",
    ask: (txt) => `Rewrite the following as a project OBJECTIVE: what this work is for and what it will have changed when it is done. 2-3 sentences, plain prose, no bullets, no headings. Keep every fact and every piece of scope the author included. Do not add aims they did not state.\n\nTHEIR WORDS:\n${txt}`,
    blank: () => `Write a project OBJECTIVE — what this work is for and what will have changed when it is done — using only what the project below already contains. 2-3 sentences, plain prose. If there is genuinely not enough to go on, say so in one sentence instead of inventing a purpose.`,
  },
  position: {
    label: "Draft", empty: "Draft the position from updates, work and workstreams.",
    ask: (txt) => `Rewrite the following as a CURRENT POSITION: where this work actually stands today. 2-4 sentences of plain prose an operations director could paste into a board pack. Lead with what has moved, then what is holding it up, then what happens next. Keep every fact the author gave. Do not add progress they did not claim.\n\nTHEIR WORDS:\n${txt}`,
    blank: () => `Write the CURRENT POSITION for the project below: where it actually stands today, in 2-4 sentences of plain prose an operations director could paste into a board pack.\n\nLead with what has moved, then what is holding it up, then what happens next. Name the thing in the way — a blocker, an overdue item, a workstream that has not moved. Use ONLY what is below; do not infer progress that is not evidenced. If there is genuinely nothing to report, say that plainly rather than padding.`,
  },
  update: {
    label: "Tidy", empty: "Say what moved first, then let the wand tidy it.",
    ask: (txt) => `Rewrite the following as a dated project UPDATE: what moved, where it stands now, what happens next. One short paragraph, plain prose, no bullets. Keep every fact, name, number and concern the author raised — including the awkward ones. Do not soften a problem and do not add anything they did not say.\n\nTHEIR WORDS:\n${txt}`,
    blank: null,
  },
};

export default function Wand({ data, project, kind, text, onUse, label, children }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState("");
  const [err, setErr] = useState("");
  const job = JOBS[kind];
  const typed = String(text || "").trim();
  const canBlank = !!job.blank;

  const run = async () => {
    setBusy(true); setErr(""); setOut("");
    try {
      const body = typed ? job.ask(typed) : job.blank();
      const res = await askClaude(
        `${body}\n\nRules that override everything above: never invent a date, an owner, a number or a commitment. Write British English. No markdown, no headings, no bullet points.\n\nFor context, this is the work it belongs to:\n${projectBrief(data, project)}`,
        false, 900, "light");
      setOut(String(res || "").trim());
    } catch (e) { setErr(e.message || "Could not reach the AI service."); }
    setBusy(false);
  };

  const button = (
    <button type="button" className={"wand" + (busy ? " busy" : "")} disabled={busy || (!typed && !canBlank)}
      aria-label={typed ? "Tidy what you have written" : job.empty}
      title={typed ? "Tidy what you have written" : job.empty} onClick={run}>
      <svg viewBox="0 0 18 18" width="12" height="12" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 15.5 L10.5 7.5" />
        <path d="M12.4 2.2 l0.8 2.0 2.0 0.8 -2.0 0.8 -0.8 2.0 -0.8 -2.0 -2.0 -0.8 2.0 -0.8 Z" fill="currentColor" stroke="none" />
        <path d="M5.4 3.0 l0.45 1.15 1.15 0.45 -1.15 0.45 -0.45 1.15 -0.45 -1.15 -1.15 -0.45 1.15 -0.45 Z" fill="currentColor" stroke="none" />
        <path d="M14.6 11.0 l0.4 1.0 1.0 0.4 -1.0 0.4 -0.4 1.0 -0.4 -1.0 -1.0 -0.4 1.0 -0.4 Z" fill="currentColor" stroke="none" />
      </svg>
    </button>);

  /* The suggestion lands under the field, never over it — your own
     words stay where you left them until you choose. */
  const panel = (
    <>
      {err && <div className="warnbox" style={{ marginTop: 6 }}>{err}</div>}
      {out && (
        <div className="wandout">
          <div className="flab">Suggested — your own words are untouched until you choose</div>
          <AutoTa minRows={2} value={out} onChange={(e) => setOut(e.target.value)} />
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button type="button" className="btn pri sm" onClick={() => { onUse(out); setOut(""); }}>Use this</button>
            <button type="button" className="btn sm" onClick={() => setOut("")}>Keep mine</button>
          </div>
        </div>)}
    </>);

  if (!children) return <>{button}{panel}</>;
  return (
    <>
      <div className="flabrow"><label className="flab">{label}</label>{button}</div>
      {children}
      {panel}
    </>
  );
}
