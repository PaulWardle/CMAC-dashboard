/* ============================================================
   Group Operations goals and OKRs.

   One rule drives the whole screen: progress is not health. A goal can
   be 80% delivered and Off Track because the deadline is Friday. The
   health is therefore computed from progress against the CLOCK, not
   from the number alone — see okrHealth in src/lib/model.js.

   Every measurement is kept, so the trend is visible rather than just
   the latest figure. Nothing here is AI-generated: a target someone
   has not set stays blank rather than being guessed.
   ============================================================ */
import React, { useState } from "react";
import { F, Stat, Empty, Rag, askConfirm, fmtD } from "../ui";
import { OKR_HEALTH, OKR_UNITS, okrHealth, okrProgress, uid, todayISO, daysUntil, ctxNames, isOpen } from "../lib/model";

const HEALTH_RAG = { "On track": "Green", "At risk": "Amber", "Off track": "Red", "Completed": "Green", "Not started": "", "Cancelled": "" };

const emptyOkr = () => ({
  id: uid(), objective: "", measure: "", unit: "%", baseline: "", current: "", target: "",
  owner: "", start: todayISO(), deadline: "", health: "", commentary: "",
  contexts: [], linked: [], updates: [], archived: false,
});

export default function Okrs({ data, mutate, openProject }) {
  const [editing, setEditing] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const list = (data.okrs || []).filter((o) => showDone || !["Completed", "Cancelled"].includes(okrHealth(o)));
  const byHealth = (h) => (data.okrs || []).filter((o) => okrHealth(o) === h).length;

  const save = (o) => {
    mutate((d) => {
      const i = (d.okrs || []).findIndex((x) => x.id === o.id);
      if (i >= 0) d.okrs[i] = o; else d.okrs.push(o);
      return d;
    }, "Goal saved: " + (o.objective || "untitled"));
    setEditing(null);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 className="h1">Group Ops goals &amp; OKRs</h2>
        <button className="btn pri sm" style={{ marginLeft: "auto" }} onClick={() => setEditing(emptyOkr())}>+ New goal</button>
      </div>
      <p className="sub">Outcome, measure, baseline, target, where it actually is. Health comes from progress against the clock — 80% delivered the day before the deadline is still off track.</p>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", marginBottom: 12 }}>
        <Stat n={list.length} l="Live goals" />
        <Stat n={byHealth("On track")} l="On track" />
        <Stat n={byHealth("At risk")} l="At risk" tone={byHealth("At risk") ? "warn" : null} />
        <Stat n={byHealth("Off track")} l="Off track" tone={byHealth("Off track") ? "bad" : null} />
      </div>

      <div className="toolrow">
        <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Include completed and cancelled
        </label>
      </div>

      {!list.length && <Empty>No goals recorded yet. Add the handful that actually define the year — the measure matters more than the wording.</Empty>}

      {list.map((o) => {
        const h = okrHealth(o);
        const p = okrProgress(o);
        const left = o.deadline ? daysUntil(o.deadline) : null;
        return (
          <div key={o.id} className="okrcard" onClick={() => setEditing(JSON.parse(JSON.stringify(o)))}>
            <div className="okrtop">
              <Rag v={HEALTH_RAG[h]} />
              <span className="okrobj">{o.objective || "(no objective set)"}</span>
              <span className={"chip h-" + h.toLowerCase().replace(/\s/g, "")}>{h}</span>
              {ctxNames(data, o.contexts).map((c) => <span key={c} className="chip ctx">{c}</span>)}
            </div>
            <div className="okrmeasure">{o.measure || "No measure set"}</div>
            {p !== null && (
              <div className="okrbar" title={`${Math.round(p * 100)}% of the way from ${o.baseline} to ${o.target}`}>
                <span style={{ width: `${Math.round(p * 100)}%` }} className={h === "Off track" ? "r" : h === "At risk" ? "a" : "g"} />
              </div>)}
            <div className="okrnums">
              <div><b>{o.baseline || "—"}</b><i>baseline</i></div>
              <div><b>{o.current || "—"}</b><i>now</i></div>
              <div><b>{o.target || "—"}</b><i>target</i></div>
              <div><b>{o.owner || "—"}</b><i>owner</i></div>
              <div><b>{left === null ? "—" : left < 0 ? `${Math.abs(left)}d late` : `${left}d`}</b><i>to deadline</i></div>
            </div>
            {o.commentary && <div className="okrnote">{o.commentary}</div>}
          </div>);
      })}

      {editing && <OkrModal data={data} okr={editing} onSave={save} onClose={() => setEditing(null)}
        onDelete={async (id) => {
          if (!(await askConfirm("Delete this goal permanently? Its measurement history goes with it."))) return;
          mutate((d) => { d.okrs = (d.okrs || []).filter((x) => x.id !== id); return d; }, "Goal deleted");
          setEditing(null);
        }} />}
    </div>
  );
}

function OkrModal({ data, okr, onSave, onClose, onDelete }) {
  const [o, setO] = useState(okr);
  const [reading, setReading] = useState("");
  const set = (k, v) => setO((x) => ({ ...x, [k]: v }));
  const isNew = !(data.okrs || []).some((x) => x.id === o.id);

  /* Recording a reading keeps the history. A single "current" figure
     that gets overwritten tells you where you are but never whether
     you are moving. */
  const record = () => {
    if (reading === "") return;
    setO((x) => ({ ...x, current: reading, updates: [...(x.updates || []), { ts: todayISO(), value: reading }] }));
    setReading("");
  };

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 className="h1">{isNew ? "New goal" : "Edit goal"}</h3>
          <button className="btn sm" onClick={onClose}>Close ✕</button>
        </div>
        <div className="frow" style={{ marginTop: 10 }}>
          <F label="Objective — the outcome, not the activity" span>
            <input className="input" autoFocus value={o.objective} onChange={(e) => set("objective", e.target.value)} placeholder="Improve operational consistency across Group Operations" /></F>
          <F label="Measure" span><input className="input" value={o.measure} onChange={(e) => set("measure", e.target.value)} placeholder="% of key SOPs standardised" /></F>
          <F label="Unit"><select className="select" value={o.unit} onChange={(e) => set("unit", e.target.value)}>{OKR_UNITS.map((u) => <option key={u}>{u}</option>)}</select></F>
          <F label="Baseline"><input className="input" value={o.baseline} onChange={(e) => set("baseline", e.target.value)} /></F>
          <F label="Current"><input className="input" value={o.current} onChange={(e) => set("current", e.target.value)} /></F>
          <F label="Target"><input className="input" value={o.target} onChange={(e) => set("target", e.target.value)} /></F>
          <F label="Owner"><input className="input" list="okr-people" value={o.owner} onChange={(e) => set("owner", e.target.value)} /></F>
          <datalist id="okr-people">{data.people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
          <F label="Start"><input type="date" className="input" value={o.start} onChange={(e) => set("start", e.target.value)} /></F>
          <F label="Deadline"><input type="date" className="input" value={o.deadline} onChange={(e) => set("deadline", e.target.value)} /></F>
          <F label="Health override">
            <select className="select" value={o.health} onChange={(e) => set("health", e.target.value)}>
              <option value="">Calculated — {okrHealth({ ...o, health: "" })}</option>
              {OKR_HEALTH.map((h) => <option key={h}>{h}</option>)}
            </select></F>
          <F label="Commentary" span><textarea className="ta" rows={3} value={o.commentary} onChange={(e) => set("commentary", e.target.value)} placeholder="Why it sits where it does, and what happens next." /></F>
        </div>

        <div className="h2">Operational contexts</div>
        <div className="ctxpick">
          {data.contexts.filter((c) => c.active).map((c) => (
            <button key={c.id} type="button" className={"ctxtag" + ((o.contexts || []).includes(c.id) ? " on" : "")}
              onClick={() => set("contexts", (o.contexts || []).includes(c.id) ? o.contexts.filter((x) => x !== c.id) : [...(o.contexts || []), c.id])}>
              {c.name}<i>{c.type}</i></button>))}
        </div>

        <div className="h2">Linked projects</div>
        <div className="ctxpick">
          {data.projects.filter((p) => !["Closed", "Cancelled"].includes(p.stage)).map((p) => (
            <button key={p.id} type="button" className={"ctxtag" + ((o.linked || []).includes(p.id) ? " on" : "")}
              onClick={() => set("linked", (o.linked || []).includes(p.id) ? o.linked.filter((x) => x !== p.id) : [...(o.linked || []), p.id])}>
              {p.name}</button>))}
          {!data.projects.length && <span className="sub" style={{ margin: 0 }}>No projects to link yet.</span>}
        </div>

        <div className="h2">Measurement history</div>
        {!(o.updates || []).length && <div className="sub">No readings recorded yet.</div>}
        {(o.updates || []).slice().reverse().map((u, i) => (
          <div key={i} className="checkline"><span className="mono">{fmtD(u.ts)}</span><span style={{ flex: 1 }}>{u.value}{o.unit === "%" ? "%" : ""}</span></div>))}
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input className="input" placeholder="Record today's reading…" value={reading} onChange={(e) => setReading(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); record(); } }} />
          <button className="btn sm" onClick={record}>Record</button>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          {!isNew && <button className="btn danger" onClick={() => onDelete(o.id)}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" onClick={() => onSave(o)}>{isNew ? "Create goal" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}
