/* ============================================================
   Operational contexts.

   The lens, not the folder. A context page answers "what is the
   current picture in Spain?" by querying every collection for that
   tag — so one project tagged Spain, Ryanair and Supply appears under
   all three without existing three times.

   This replaces the single-value country field, which forced a choice
   between Spain and Portugal on work that spanned both.
   ============================================================ */
import React, { useState } from "react";
import { F, Stat, Empty, Badge, askConfirm, fmtD } from "../ui";
import { CONTEXT_TYPES, inContext, uid, isOverdue, prioRank, daysUntil, portfolioAttention } from "../lib/model";

export default function Contexts({ data, mutate, openItem, openProject, openMob }) {
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState({ name: "", type: "Geography" });

  const add = () => {
    if (!draft.name.trim()) return;
    mutate((d) => { d.contexts.push({ id: uid(), name: draft.name.trim(), type: draft.type, active: true }); return d; }, "Context added: " + draft.name.trim());
    setDraft({ name: "", type: draft.type });
  };
  const counts = (c) => {
    const r = inContext(data, c.id);
    return r.items.length + r.projects.length + r.mobs.length + r.meetings.length + r.okrs.length;
  };

  if (sel) {
    const c = data.contexts.find((x) => x.id === sel);
    if (!c) { setSel(null); return null; }
    return <ContextPage data={data} ctx={c} back={() => setSel(null)} openItem={openItem} openProject={openProject} openMob={openMob} />;
  }

  return (
    <div>
      <h2 className="h1">Operational contexts</h2>
      <p className="sub">A geography, a function, a client, a supplier. Tag work with as many as apply — a Spain / Ryanair / Supply review is one record seen from three angles, not three copies.</p>

      {CONTEXT_TYPES.map((t) => {
        const list = data.contexts.filter((c) => c.type === t);
        if (!list.length) return null;
        return (
          <div key={t}>
            <div className="h2">{t}</div>
            <div className="ctxgrid">
              {list.map((c) => (
                <div key={c.id} className={"ctxcard" + (c.active ? "" : " off")} onClick={() => setSel(c.id)}>
                  <div className="cname">{c.name}</div>
                  <div className="ccount">{counts(c)} records</div>
                </div>))}
            </div>
          </div>);
      })}

      <div className="h2">Add a context</div>
      <div className="card" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
        <F label="Name"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="e.g. Ryanair, Italy, Rail" /></F>
        <F label="Type"><select className="select" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>{CONTEXT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></F>
        <button className="btn pri sm" onClick={add} disabled={!draft.name.trim()}>Add</button>
      </div>

      <div className="h2">Retire a context</div>
      <p className="sub">Retiring hides a context from the pickers. Nothing tagged with it is lost, and it still appears on records that already carry it.</p>
      <div className="ctxpick">
        {data.contexts.map((c) => (
          <button key={c.id} className={"ctxtag" + (c.active ? " on" : "")} onClick={async () => {
            if (c.active && !(await askConfirm(`Retire "${c.name}"? It stays on the ${counts(c)} record(s) that use it.`))) return;
            mutate((d) => { const x = d.contexts.find((y) => y.id === c.id); if (x) x.active = !x.active; return d; }, (c.active ? "Retired " : "Restored ") + c.name);
          }}>{c.name}<i>{c.active ? "active" : "retired"}</i></button>))}
      </div>
    </div>
  );
}

/* ============================================================
   One context — the current picture
   ============================================================ */
function ContextPage({ data, ctx, back, openItem, openProject, openMob }) {
  const r = inContext(data, ctx.id);
  const overdue = r.items.filter(isOverdue);
  const blocked = r.items.filter((w) => w.status === "Blocked");
  const waiting = r.items.filter((w) => w.mode === "Waiting on");
  const risks = r.items.filter((w) => w.type === "Risk");
  const decisions = r.items.filter((w) => w.type === "Decision");

  const List = ({ title, rows, empty, onOpen }) => (
    <>
      <div className="h2">{title} ({rows.length})</div>
      {!rows.length && <div className="sub">{empty}</div>}
      {rows.slice(0, 12).map((x) => (
        <div key={x.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => onOpen(x)}>
          {x.priority && <Badge p={x.priority} />}
          <span style={{ flex: 1 }}>{x.title || x.name}</span>
          {x.stage && <span className="chip">{x.stage}</span>}
          {x.due && <span className={"chip" + (isOverdue(x) ? " overdue" : "")}>{fmtD(x.due)}</span>}
          {x.waitingOn && <span className="chip wait">on {x.waitingOn}</span>}
        </div>))}
    </>
  );

  return (
    <div>
      <button className="btn sm" onClick={back}>← All contexts</button>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
        <h2 className="h1" style={{ margin: 0 }}>{ctx.name}</h2>
        <span className="chip">{ctx.type}</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", margin: "12px 0" }}>
        <Stat n={r.projects.length} l="Projects" />
        <Stat n={r.mobs.length} l="Mobilisations" />
        <Stat n={r.items.length} l="Open items" />
        <Stat n={overdue.length} l="Overdue" tone={overdue.length ? "bad" : null} />
        <Stat n={blocked.length} l="Blocked" tone={blocked.length ? "bad" : null} />
        <Stat n={r.people.length} l="People" />
      </div>

      <List title="Projects" rows={r.projects} empty="No projects tagged with this context." onOpen={(p) => openProject(p.id)} />
      <List title="Mobilisations" rows={r.mobs} empty="No mobilisations tagged with this context." onOpen={(m) => openMob(m.id)} />
      <List title="Overdue and blocked" rows={[...overdue, ...blocked]} empty="Nothing overdue or blocked here." onOpen={openItem} />
      <List title="Waiting on others" rows={waiting} empty="Nothing outstanding with anyone else." onOpen={openItem} />
      <List title="Risks" rows={risks} empty="No risks recorded in this context." onOpen={openItem} />
      <List title="Decisions" rows={decisions} empty="No decisions recorded in this context." onOpen={openItem} />

      <div className="h2">People ({r.people.length})</div>
      {!r.people.length && <div className="sub">Nobody is tagged with this context yet.</div>}
      <div className="ctxpick">{r.people.map((p) => <span key={p.id} className="chip">{p.name}{p.role ? ` · ${p.role}` : ""}</span>)}</div>

      {r.meetings.length > 0 && <>
        <div className="h2">Recent meetings</div>
        {r.meetings.slice(-6).reverse().map((m) => (
          <div key={m.id} className="checkline"><span className="mono">{fmtD(m.date)}</span><span style={{ flex: 1 }}>{m.title}</span><span className="chip">{m.type}</span></div>))}
      </>}
    </div>
  );
}
