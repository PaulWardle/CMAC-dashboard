/* ============================================================
   People.

   Recurring working relationships, not a CRM. Two jobs:

   1. Delegation. What is this person holding, what is overdue, what
      has had no update — the thing a one-to-one actually needs.
   2. Leadership. Strengths, development, PDR notes.

   On (2): this material is held here under explicit sign-off. It is
   still personal data about named colleagues, so it is fenced off —
   CONFIDENTIAL_PERSON_FIELDS never reaches the board pack, the
   newsletter, an export or an AI brief. The fence is enforced in the
   code that builds those outputs, not by remembering.
   ============================================================ */
import React, { useState, useMemo } from "react";
import { F, Empty, Badge, askConfirm, askInfo, copyText, fmtD } from "../ui";
import {
  RELATIONSHIPS, personLoad, ctxNames, uid, todayISO, daysSince, daysUntil,
  isOverdue, prioRank,
} from "../lib/model";

export default function People({ data, mutate, openItem, go }) {
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const list = data.people.filter((p) => !q || (p.name + " " + p.role + " " + p.func).toLowerCase().includes(q.toLowerCase()));
    return list.map((p) => ({ p, load: personLoad(data, p) }))
      .sort((a, b) => (b.load.overdue.length + b.load.chaseDue.length) - (a.load.overdue.length + a.load.chaseDue.length)
        || b.load.waitingOnThem.length - a.load.waitingOnThem.length
        || a.p.name.localeCompare(b.p.name));
  }, [data, q]);

  const person = sel ? data.people.find((p) => p.id === sel) : null;
  if (person) return <PersonPage data={data} person={person} mutate={mutate} openItem={openItem} back={() => setSel(null)} />;

  const addPerson = (name) => {
    const n = String(name || "").trim();
    if (!n) return;
    if (data.people.some((p) => p.name.toLowerCase() === n.toLowerCase())) return askInfo(`${n} is already on the list.`);
    mutate((d) => {
      d.people.push({
        id: uid(), name: n, role: "", func: "", location: "", relationship: "Colleague",
        managerId: "", contexts: [], oneToOne: "", nextOneToOne: "",
        strengths: "", development: "", privateNotes: "", pdr: [], notes: [],
        active: true, created: todayISO(),
      });
      return d;
    }, "Added " + n);
    setAdding(false);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 className="h1">People</h2>
        <button className="btn pri sm" style={{ marginLeft: "auto" }} onClick={() => setAdding(true)}>+ Add person</button>
      </div>
      <p className="sub">Who is holding what, and what is overdue. Open anyone to prepare for a one-to-one in a few seconds.</p>

      {adding && <AddPerson onAdd={addPerson} onCancel={() => setAdding(false)} />}

      <div className="toolrow">
        <input className="input" placeholder="Find a person…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!rows.length && <Empty>No people yet. Anyone named as an owner or as someone you are waiting on is picked up automatically — or add them above.</Empty>}

      <div className="peoplegrid">
        {rows.map(({ p, load }) => {
          const hot = load.overdue.length + load.chaseDue.length;
          return (
            <div key={p.id} className={"personcard" + (hot ? " hot" : "")} onClick={() => setSel(p.id)}>
              <div className="pname">{p.name}</div>
              <div className="prole">{[p.role, p.func].filter(Boolean).join(" · ") || p.relationship}</div>
              <div className="pstats">
                <span><b>{load.waitingOnThem.length}</b> waiting on them</span>
                {load.overdue.length > 0 && <span className="bad"><b>{load.overdue.length}</b> overdue</span>}
                {load.chaseDue.length > 0 && <span className="warn"><b>{load.chaseDue.length}</b> to chase</span>}
                {load.iOweThem.length > 0 && <span><b>{load.iOweThem.length}</b> I owe them</span>}
              </div>
              {p.nextOneToOne && <div className="p1to1">Next 1:1 {fmtD(p.nextOneToOne)}{daysUntil(p.nextOneToOne) >= 0 ? ` · in ${daysUntil(p.nextOneToOne)}d` : " · overdue"}</div>}
            </div>);
        })}
      </div>
    </div>
  );
}

function AddPerson({ onAdd, onCancel }) {
  const [n, setN] = useState("");
  return (
    <div className="card" style={{ marginBottom: 10, display: "flex", gap: 6 }}>
      <input className="input" autoFocus placeholder="Name" value={n} onChange={(e) => setN(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onAdd(n); if (e.key === "Escape") onCancel(); }} />
      <button className="btn pri sm" onClick={() => onAdd(n)}>Add</button>
      <button className="btn sm" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/* ============================================================
   One person
   ============================================================ */
function PersonPage({ data, person, mutate, openItem, back }) {
  const [tab, setTab] = useState("Work");
  const load = personLoad(data, person);
  const edit = (fn, label) => mutate((d) => { const p = d.people.find((x) => x.id === person.id); if (p) fn(p); return d; }, label);
  const set = (k, v) => edit((p) => { p[k] = v; }, "Updated " + person.name);

  /* The one-to-one brief. Every line is a record that already exists —
     nothing here is generated, so nothing here can be wrong. */
  const brief = () => {
    const line = (w) => `  - ${w.title}${w.due ? ` (due ${fmtD(w.due)}${isOverdue(w) ? ", OVERDUE" : ""})` : ""}`;
    const t = [
      `1:1 — ${person.name}`,
      person.role ? person.role : "",
      ``,
      `WAITING ON THEM (${load.waitingOnThem.length})`,
      ...(load.waitingOnThem.length ? load.waitingOnThem.map(line) : ["  - nothing outstanding"]),
      ``,
      `OVERDUE (${load.overdue.length})`,
      ...(load.overdue.length ? load.overdue.map(line) : ["  - none"]),
      ``,
      `NO UPDATE IN OVER A WEEK (${load.stale.length})`,
      ...(load.stale.length ? load.stale.map(line) : ["  - none"]),
      ``,
      `WHAT I OWE THEM (${load.iOweThem.length})`,
      ...(load.iOweThem.length ? load.iOweThem.map(line) : ["  - nothing recorded"]),
      ``,
      `THEIR OWN OPEN WORK (${load.theyOwn.length})`,
      ...(load.theyOwn.slice(0, 12).map(line)),
    ].filter((x) => x !== undefined).join("\n");
    copyText(t);
    askInfo("The 1:1 brief has been copied to your clipboard.\n\nEvery line is an existing record — nothing in it was generated.");
  };

  const Section = ({ title, items, empty }) => (
    <>
      <div className="h2">{title} ({items.length})</div>
      {!items.length && <div className="sub">{empty}</div>}
      {items.map((w) => (
        <div key={w.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => openItem(w)}>
          <Badge p={w.priority} />
          <span style={{ flex: 1 }}>{w.title}</span>
          {w.due && <span className={"chip" + (isOverdue(w) ? " overdue" : "")}>{fmtD(w.due)}</span>}
          {w.nextChase && daysUntil(w.nextChase) <= 0 && <span className="chip wait">chase due</span>}
          <span className="chip">{daysSince(w.updatedAt || w.created)}d since update</span>
        </div>))}
    </>
  );

  return (
    <div>
      <button className="btn sm" onClick={back}>← All people</button>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        <h2 className="h1" style={{ margin: 0 }}>{person.name}</h2>
        <span className="chip">{person.relationship}</span>
        {ctxNames(data, person.contexts).map((c) => <span key={c} className="chip ctx">{c}</span>)}
        <button className="btn pri sm" style={{ marginLeft: "auto" }} onClick={brief}>Copy 1:1 brief</button>
      </div>

      <div className="viewtabs">
        {["Work", "Details", "Development"].map((t) => (
          <button key={t} className={"vtab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{t}</button>))}
      </div>

      {tab === "Work" && <>
        <Section title="I am waiting on them for" items={load.waitingOnThem} empty="Nothing outstanding with this person." />
        <Section title="What I owe them" items={load.iOweThem} empty="No commitments recorded to this person. Record one by creating a Commitment and setting 'Made to'." />
        <Section title="Their own open work" items={load.theyOwn} empty="Nothing is currently owned by this person." />
      </>}

      {tab === "Details" && (
        <div className="frow" style={{ marginTop: 10 }}>
          <F label="Role"><input className="input" value={person.role} onChange={(e) => set("role", e.target.value)} /></F>
          <F label="Function"><input className="input" value={person.func} onChange={(e) => set("func", e.target.value)} /></F>
          <F label="Location"><input className="input" value={person.location} onChange={(e) => set("location", e.target.value)} /></F>
          <F label="Relationship"><select className="select" value={person.relationship} onChange={(e) => set("relationship", e.target.value)}>{RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}</select></F>
          <F label="1:1 cadence"><input className="input" value={person.oneToOne} onChange={(e) => set("oneToOne", e.target.value)} placeholder="e.g. fortnightly, Tuesdays" /></F>
          <F label="Next 1:1"><input type="date" className="input" value={person.nextOneToOne} onChange={(e) => set("nextOneToOne", e.target.value)} /></F>
          <F label="Operational contexts" span>
            <div className="ctxpick">
              {data.contexts.filter((c) => c.active).map((c) => (
                <button key={c.id} type="button" className={"ctxtag" + ((person.contexts || []).includes(c.id) ? " on" : "")}
                  onClick={() => edit((p) => { p.contexts = (p.contexts || []).includes(c.id) ? p.contexts.filter((x) => x !== c.id) : [...(p.contexts || []), c.id]; }, "Contexts updated")}>
                  {c.name}<i>{c.type}</i>
                </button>))}
            </div>
          </F>
          <div style={{ gridColumn: "1 / -1" }}>
            <button className="btn danger sm" onClick={async () => {
              if (await askConfirm(`Remove ${person.name} from People? Their name stays on any work items — only this record goes.`)) {
                mutate((d) => { d.people = d.people.filter((p) => p.id !== person.id); return d; }, "Removed " + person.name);
                back();
              }
            }}>Remove person</button>
          </div>
        </div>)}

      {tab === "Development" && <Development data={data} person={person} edit={edit} set={set} />}
    </div>
  );
}

/* ============================================================
   Performance and development.

   Held under explicit sign-off. Everything on this tab is fenced out
   of every outward-facing output — see CONFIDENTIAL_PERSON_FIELDS in
   src/lib/model.js and the strip in serialiseForAI.
   ============================================================ */
function Development({ data, person, edit, set }) {
  const [note, setNote] = useState("");
  const [pdr, setPdr] = useState({ period: "", objectives: "", rating: "", notes: "" });

  const addNote = () => {
    if (!note.trim()) return;
    edit((p) => { p.notes = [...(p.notes || []), { id: uid(), ts: todayISO(), text: note.trim() }]; }, "Leadership note added");
    setNote("");
  };
  const addPdr = () => {
    if (!pdr.period.trim()) return;
    edit((p) => { p.pdr = [...(p.pdr || []), { id: uid(), date: todayISO(), ...pdr }]; }, "PDR record added");
    setPdr({ period: "", objectives: "", rating: "", notes: "" });
  };

  return (
    <div>
      <div className="notebox" style={{ borderLeft: "4px solid #B45309", marginTop: 10 }}>
        <b>Confidential.</b> This tab holds personal data about a named colleague. It is excluded from the board pack, the
        newsletter, every export and anything sent to the AI. Keep it factual and keep it to what you would be content to
        show the person it is about.
      </div>

      <div className="h2">Strengths</div>
      <textarea className="ta" rows={3} value={person.strengths} onChange={(e) => set("strengths", e.target.value)}
        placeholder="What they are genuinely good at — the things you would put them on." />

      <div className="h2">Development</div>
      <textarea className="ta" rows={3} value={person.development} onChange={(e) => set("development", e.target.value)}
        placeholder="Where they need to grow, and what would help." />

      <div className="h2">Leadership notes</div>
      {!(person.notes || []).length && <div className="sub">No notes yet. Add observations as they happen — they are much harder to reconstruct at PDR time.</div>}
      {(person.notes || []).slice().reverse().map((n) => (
        <div key={n.id || n.ts} className="checkline">
          <span className="mono">{fmtD(n.ts)}</span>
          <span style={{ flex: 1 }}>{n.text}</span>
          <span className="linkish" onClick={() => edit((p) => { p.notes = p.notes.filter((x) => (x.id || x.ts) !== (n.id || n.ts)); }, "Note removed")}>remove</span>
        </div>))}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <input className="input" placeholder="Add a dated observation… (Enter)" value={note} onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNote(); } }} />
        <button className="btn sm" onClick={addNote}>Add</button>
      </div>

      <div className="h2">PDR history</div>
      {!(person.pdr || []).length && <div className="sub">No PDR records yet.</div>}
      {(person.pdr || []).slice().reverse().map((r) => (
        <div key={r.id} className="card" style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <b>{r.period}</b>
            {r.rating && <span className="chip">{r.rating}</span>}
            <span className="sub" style={{ margin: 0, marginLeft: "auto" }}>{fmtD(r.date)}</span>
            <span className="linkish" onClick={() => edit((p) => { p.pdr = p.pdr.filter((x) => x.id !== r.id); }, "PDR record removed")}>remove</span>
          </div>
          {r.objectives && <div style={{ fontSize: 12.5, marginTop: 6 }}><b>Objectives:</b> {r.objectives}</div>}
          {r.notes && <div style={{ fontSize: 12.5, marginTop: 4, whiteSpace: "pre-wrap" }}>{r.notes}</div>}
        </div>))}
      <div className="card">
        <div className="frow">
          <F label="Period"><input className="input" value={pdr.period} onChange={(e) => setPdr({ ...pdr, period: e.target.value })} placeholder="e.g. 2026 mid-year" /></F>
          <F label="Rating / outcome"><input className="input" value={pdr.rating} onChange={(e) => setPdr({ ...pdr, rating: e.target.value })} /></F>
          <F label="Objectives" span><textarea className="ta" rows={2} value={pdr.objectives} onChange={(e) => setPdr({ ...pdr, objectives: e.target.value })} /></F>
          <F label="Notes" span><textarea className="ta" rows={3} value={pdr.notes} onChange={(e) => setPdr({ ...pdr, notes: e.target.value })} /></F>
        </div>
        <button className="btn pri sm" style={{ marginTop: 8 }} disabled={!pdr.period.trim()} onClick={addPdr}>Add PDR record</button>
      </div>
    </div>
  );
}
