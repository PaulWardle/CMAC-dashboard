/* ============================================================
   Working on one project or workstream.

   Two jobs, both on demand and both propose-then-approve:

   1. Capture INTO this project. The main Capture screen reads a dump
      cold; here it already knows which piece of work you are standing
      in, so everything it proposes is filed against it and nothing has
      to be re-pointed afterwards.

   2. Draft the current position. The position field is the one thing a
      board pack actually quotes, and it is the first thing to go stale
      because it has to be written by hand. This reads what the project
      already holds — its updates, its open and overdue work, its
      workstreams — and offers a draft.

   Neither runs on its own. An AI call on every page load would cost
   money for nothing, and a position that rewrites itself quietly is a
   position you cannot trust in front of the COO.
   ============================================================ */
import React, { useState } from "react";
import { F, Badge, askConfirm, askInfo, fmtD } from "../ui";
import { askClaude } from "../lib/claude";
import { Group, blankItem } from "./Capture";
import {
  PRIORITIES, PRIO_LABEL, childProjects, portfolioAttention, isOpen, isOverdue,
  uid, todayISO, daysUntil, daysSince,
} from "../lib/model";

/* What this project actually holds, in the fewest tokens that still let a
   reader say something true about it. */
function projectBrief(data, p) {
  const kids = childProjects(data, p.id);
  const ids = new Set([p.id, ...kids.map((k) => k.id)]);
  const items = data.workItems.filter((w) => ids.has(w.project) && isOpen(w));
  const updates = data.updates.filter((u) => ids.has(u.project)).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);
  const line = (w) => `- ${w.title} [${w.status}${w.mode === "Waiting on" ? ", waiting on " + (w.waitingOn || "?") : ""}${w.due ? ", due " + fmtD(w.due) : ""}${isOverdue(w) ? ", OVERDUE" : ""}${w.project !== p.id ? ", in " + (kids.find((k) => k.id === w.project) || {}).name : ""}]`;
  return [
    `PROJECT: ${p.name}`,
    p.objective && `OBJECTIVE: ${p.objective}`,
    `STAGE: ${p.stage} · OWNER: ${p.owner || "none recorded"} · PROGRESS: ${p.progress}%${p.target ? ` · TARGET: ${fmtD(p.target)}` : ""}`,
    p.blocked && `BLOCKED: ${p.blocker || p.blockedBy || "yes"}`,
    p.position && `POSITION RECORDED PREVIOUSLY: ${p.position}`,
    kids.length && `WORKSTREAMS:\n` + kids.map((k) => {
      const h = portfolioAttention(data, k, "project", data.settings);
      return `- ${k.name}: ${k.stage}, ${h.rag}, ${k.progress}%${k.owner ? ", " + k.owner : ""}${h.reasons.length ? " — " + h.reasons.join("; ") : ""}`;
    }).join("\n"),
    items.length ? `OPEN WORK (${items.length}):\n` + items.slice(0, 40).map(line).join("\n") : "OPEN WORK: none",
    updates.length ? `RECENT UPDATES:\n` + updates.map((u) => `- ${fmtD(u.date)}: ${u.summary}`).join("\n") : "RECENT UPDATES: none",
  ].filter(Boolean).join("\n");
}

export default function ProjectPanel({ data, project: p, mutate, setDetail }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  const kids = childProjects(data, p.id);

  const mark = (o, extra) => ({ ...o, _id: uid(), _sel: true, ...extra });
  const shape = (out) => ({
    read: out.read || "",
    position: out.position || "",
    actions: (out.actions || []).map((x) => mark(x)),
    waiting: (out.waiting || []).map((x) => mark(x)),
    risks: (out.risks || []).map((x) => mark(x)),
    decisions: (out.decisions || []).map((x) => mark(x)),
    workstreams: (out.workstreams || []).map((x) => mark(x, { _sel: false })),
    update: out.update || "",
    questions: (out.questions || []).slice(0, 3),
  });

  /* ---------- capture into this project ---------- */
  const read = async () => {
    if (!text.trim()) return;
    setBusy("read"); setErr(""); setRes(null);
    try {
      const out = await askClaude(`You are reading material that belongs to one specific piece of work for an operations director. Everything you propose will be filed against it, so do not ask which project it is.

Respond ONLY with JSON:
{
 "read": string — one or two sentences on what this material is.
 "actions":   [ {"title","description","due","priority","workstream"} ]  — things the DIRECTOR must do
 "waiting":   [ {"title","description","person","due","priority","workstream"} ] — things SOMEONE ELSE owes
 "risks":     [ {"title","description","priority","mitigation"} ]
 "decisions": [ {"title","what","who","rationale","status":"Decided"|"Required"} ]
 "update":    string — one short paragraph suitable as a dated update on this project, or "" if the material says nothing about progress.
 "position":  string — a revised CURRENT POSITION for this project if the material changes it, or "" to leave it alone.
 "questions": [ string ] — up to 3, only where something important is genuinely ambiguous.
}

RULES:
- Never invent an owner, a date or a priority that was not stated. Blank is correct.
- Do not turn every "we should" into an action. Only what was asked for or agreed.
- "workstream" must be an exact name from this list, or "" to file it at project level: ${JSON.stringify(kids.map((k) => k.name))}
- Priority: ${PRIORITIES.map((x) => `${x}=${PRIO_LABEL[x]}`).join(", ")}. Default P3.
- Today is ${fmtD(todayISO())} (${todayISO()}).

${projectBrief(data, p)}

MATERIAL:
${text}`, true, 6000, "standard");
      setRes(shape(out));
    } catch (e) { setErr("Could not read that (" + (e.message || "AI error") + "). Your text is still here."); }
    setBusy("");
  };

  /* ---------- draft the position from what is already here ---------- */
  const draft = async () => {
    setBusy("draft"); setErr(""); setRes(null);
    try {
      const out = await askClaude(`Write the CURRENT POSITION for the project below: where it actually stands today, in 2-4 sentences of plain prose an operations director could paste into a board pack.

Respond ONLY with JSON: {"position": string, "update": string — one line suitable as a dated update, or "", "workstreams": [ {"name": exact existing workstream name, "position": string — one line on where that strand is} ]}

RULES — this is the part people will quote, so it has to be true:
- Use ONLY what is below. Do not infer progress that is not evidenced.
- Lead with what has actually moved, then what is holding it up, then what happens next.
- Name the thing in the way: a blocker, an overdue item, a workstream that has not moved.
- If there is genuinely nothing to report, say so plainly rather than padding.
- No markdown, no headings, no bullet points.

Today is ${fmtD(todayISO())} (${todayISO()}).

${projectBrief(data, p)}`, true, 2000, "standard");
      setRes(shape(out));
    } catch (e) { setErr("Could not draft a position (" + (e.message || "AI error") + ")."); }
    setBusy("");
  };

  /* ---------- save ---------- */
  const approve = () => {
    const picked = {
      actions: res.actions.filter((x) => x._sel),
      waiting: res.waiting.filter((x) => x._sel),
      risks: res.risks.filter((x) => x._sel),
      decisions: res.decisions.filter((x) => x._sel),
      workstreams: res.workstreams.filter((x) => x._sel),
    };
    const n = Object.values(picked).reduce((a, b) => a + b.length, 0) + (res.position ? 1 : 0) + (res.update ? 1 : 0);
    if (!n) return askInfo("Nothing is ticked.");

    const srcId = uid();
    const label = `${text.trim() ? "capture into" : "position drafted for"} ${p.name} (${fmtD(todayISO())})`;
    const src = { type: "project-capture", id: srcId, label, date: todayISO() };
    const target = (name) => (kids.find((k) => k.name === name) || {}).id || p.id;

    mutate((d) => {
      if (text.trim()) {
        d.sources = d.sources || [];
        d.sources.push({ id: srcId, kind: "project-capture", date: todayISO(), label, text: text.trim().slice(0, 20000), read: res.read || "" });
      }
      picked.actions.forEach((a) => d.workItems.push(blankItem(d, {
        title: a.title || "Untitled", description: a.description || "", project: target(a.workstream),
        due: a.due || "", priority: PRIORITIES.includes(a.priority) ? a.priority : "P3",
        contexts: [...(p.contexts || [])], source: src,
        notes: [{ ts: todayISO(), text: `From ${label} (AI-proposed, approved by you)` }],
      })));
      picked.waiting.forEach((a) => d.workItems.push(blankItem(d, {
        title: a.title || "Untitled", description: a.description || "", project: target(a.workstream),
        mode: "Waiting on", waitingOn: a.person || "", due: a.due || "",
        priority: PRIORITIES.includes(a.priority) ? a.priority : "P3",
        contexts: [...(p.contexts || [])], source: src,
        notes: [{ ts: todayISO(), text: `From ${label} — waiting on ${a.person || "someone"}` }],
      })));
      picked.risks.forEach((x) => d.workItems.push(blankItem(d, {
        title: x.title || "Risk", type: "Risk", description: x.description || "", project: p.id,
        priority: PRIORITIES.includes(x.priority) ? x.priority : "P3",
        contexts: [...(p.contexts || [])], source: src, extra: { mitigation: x.mitigation || "" },
      })));
      picked.decisions.forEach((x) => d.workItems.push(blankItem(d, {
        title: x.title || x.what || "Decision", type: "Decision", description: x.rationale || "", project: p.id,
        contexts: [...(p.contexts || [])], source: src,
        extra: { decisionStatus: x.status === "Decided" ? "Decided" : "Required", decisionMade: x.what || "", rationale: x.rationale || "", decisionOwner: x.who || "" },
      })));
      picked.workstreams.forEach((x) => {
        const k = d.projects.find((y) => y.name === x.name && y.parentId === p.id);
        if (k && x.position) { k.position = x.position; k.updatedAt = todayISO(); }
      });
      const me = d.projects.find((x) => x.id === p.id);
      if (me && res.position) { me.position = res.position; me.updatedAt = todayISO(); }
      if (res.update) {
        d.updates.push({
          id: uid(), title: res.update.slice(0, 80), date: todayISO(), period: "", summary: res.update,
          detail: "", rag: (me || p).rag, project: p.id, mob: "", contexts: p.contexts || [],
          owner: d.settings.displayName || "Me", confidentiality: "Internal", flags: { board: false, coo: false, news: false },
        });
      }
      return d;
    }, `${p.name}: ${n} record(s) from a ${text.trim() ? "capture" : "position draft"}`);
    setRes(null); setText("");
  };

  const count = res ? [res.actions, res.waiting, res.risks, res.decisions, res.workstreams]
    .reduce((a, g) => a + g.filter((x) => x._sel).length, 0) + (res.position ? 1 : 0) + (res.update ? 1 : 0) : 0;

  return (
    <>
      <div className="h2">Capture into this {kids.length ? "project" : "work"}</div>
      <div className="card">
        <textarea className="ta" rows={4} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={`Paste anything that belongs to ${p.name} — meeting notes, an email chain, a status from someone. Everything it finds is filed here${kids.length ? ", against the right workstream where it can tell" : ""}.`} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn pri" disabled={!!busy || !text.trim()} onClick={read}>{busy === "read" ? "Reading…" : "Read this"}</button>
          <button className="btn" disabled={!!busy} onClick={draft}>{busy === "draft" ? "Drafting…" : "Draft position from what's here"}</button>
          <span className="sub" style={{ margin: 0 }}>Nothing is saved until you approve it.</span>
        </div>
        {err && <div className="warnbox" style={{ marginTop: 8 }}>{err}</div>}
      </div>

      {res && <>
        {res.read && <div className="readcard"><div className="flab">What this is</div><div>{res.read}</div></div>}

        {res.questions.length > 0 && (
          <div className="notebox" style={{ marginTop: 8, borderLeft: "4px solid #1D5FBF" }}>
            <b>Unclear from the material:</b>
            {res.questions.map((q, i) => <div key={i}>• {q}</div>)}
          </div>)}

        {res.position && <>
          <div className="h2">Proposed current position</div>
          <textarea className="ta" rows={4} value={res.position} onChange={(e) => setRes({ ...res, position: e.target.value })} />
          <div className="sub" style={{ margin: "4px 0 0" }}>Replaces what is on the project now. Clear the box to leave it as it is.</div>
        </>}

        {res.update && <>
          <div className="h2">Proposed update</div>
          <textarea className="ta" rows={3} value={res.update} onChange={(e) => setRes({ ...res, update: e.target.value })} />
          <div className="sub" style={{ margin: "4px 0 0" }}>Added to the update history, dated today. Clear the box to skip it.</div>
        </>}

        <Group title="Actions for me" items={res.actions} set={(v) => setRes({ ...res, actions: v })}
          render={(x, upd) => (<>
            <input className="input" style={{ fontWeight: 600 }} value={x.title || ""} onChange={(e) => upd("title", e.target.value)} />
            <div className="minirow">
              <select className="select sm" value={x.priority || "P3"} onChange={(e) => upd("priority", e.target.value)}>{PRIORITIES.map((v) => <option key={v}>{v}</option>)}</select>
              <input type="date" className="input sm" value={x.due || ""} onChange={(e) => upd("due", e.target.value)} />
              {kids.length > 0 && (
                <select className="select sm" value={x.workstream || ""} onChange={(e) => upd("workstream", e.target.value)}>
                  <option value="">{p.name} (top level)</option>
                  {kids.map((k) => <option key={k.id} value={k.name}>{k.name}</option>)}
                </select>)}
            </div>
          </>)} />

        <Group title="Waiting on others" items={res.waiting} set={(v) => setRes({ ...res, waiting: v })}
          render={(x, upd) => (<>
            <input className="input" style={{ fontWeight: 600 }} value={x.title || ""} onChange={(e) => upd("title", e.target.value)} />
            <div className="minirow">
              <input className="input sm" list="pp-people" placeholder="who?" value={x.person || ""} onChange={(e) => upd("person", e.target.value)} />
              <select className="select sm" value={x.priority || "P3"} onChange={(e) => upd("priority", e.target.value)}>{PRIORITIES.map((v) => <option key={v}>{v}</option>)}</select>
              <input type="date" className="input sm" value={x.due || ""} onChange={(e) => upd("due", e.target.value)} />
              {kids.length > 0 && (
                <select className="select sm" value={x.workstream || ""} onChange={(e) => upd("workstream", e.target.value)}>
                  <option value="">{p.name} (top level)</option>
                  {kids.map((k) => <option key={k.id} value={k.name}>{k.name}</option>)}
                </select>)}
            </div>
          </>)} />

        <Group title="Risks" items={res.risks} set={(v) => setRes({ ...res, risks: v })}
          render={(x, upd) => (<>
            <input className="input" style={{ fontWeight: 600 }} value={x.title || ""} onChange={(e) => upd("title", e.target.value)} />
            {x.mitigation && <div className="sub" style={{ margin: "4px 0 0" }}>Mitigation: {x.mitigation}</div>}
          </>)} />

        <Group title="Decisions" items={res.decisions} set={(v) => setRes({ ...res, decisions: v })}
          render={(x, upd) => (<>
            <input className="input" style={{ fontWeight: 600 }} value={x.title || x.what || ""} onChange={(e) => upd("title", e.target.value)} />
            <div className="minirow"><span className="chip">{x.status || "Required"}</span>{x.who && <span className="chip">{x.who}</span>}</div>
          </>)} />

        <Group title="Workstream positions" items={res.workstreams} set={(v) => setRes({ ...res, workstreams: v })}
          hint="Not ticked by default — tick any you want written onto that workstream."
          render={(x, upd) => (<>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{x.name}</div>
            <textarea className="ta" rows={2} value={x.position || ""} onChange={(e) => upd("position", e.target.value)} />
          </>)} />

        <datalist id="pp-people">{data.people.map((x) => <option key={x.id} value={x.name} />)}</datalist>

        <div className="savebar">
          <button className="btn pri" disabled={!count} onClick={approve}>Save {count} change{count === 1 ? "" : "s"}</button>
          <button className="btn" onClick={async () => { if (await askConfirm("Discard this? Anything you typed stays in the box.")) setRes(null); }}>Discard</button>
        </div>
      </>}
    </>
  );
}
