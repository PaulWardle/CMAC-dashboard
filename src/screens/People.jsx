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
import { F, Empty, Badge, Rag, askConfirm, askInfo, copyText, fmtD, AutoTa, ContextPicker } from "../ui";
import {
  RELATIONSHIPS, personLoad, ctxNames, uid, todayISO, daysSince, daysUntil,
  isOverdue, prioRank, portfolioAttention, lastReport, childProjects,
} from "../lib/model";

export default function People({ data, mutate, openItem, openProject, go }) {
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const rows = useMemo(() => {
    const list = data.people.filter((p) => !q || (p.name + " " + p.role + " " + p.func).toLowerCase().includes(q.toLowerCase()));
    return list.map((p) => ({ p, load: personLoad(data, p) }))
      .sort((a, b) => (b.load.overdue.length + b.load.chaseDue.length) - (a.load.overdue.length + a.load.chaseDue.length)
        || b.load.waitingOnThem.length - a.load.waitingOnThem.length
        || a.p.name.localeCompare(b.p.name));
  }, [data, q]);

  const person = sel ? data.people.find((p) => p.id === sel) : null;
  if (person) return <PersonPage data={data} person={person} mutate={mutate} openItem={openItem} openProject={openProject} back={() => setSel(null)} />;

  const addPerson = (name) => {
    const n = String(name || "").trim();
    if (!n) return;
    if (data.people.some((p) => p.name.toLowerCase() === n.toLowerCase())) return askInfo(`${n} is already on the list.`);
    mutate((d) => {
      d.people.push({
        ...blankPerson(n),
      });
      return d;
    }, "Added " + n);
    setAdding(false);
  };

  /* Adding a directory one modal at a time is the sort of job that never
     gets done. Paste the table you already keep and it reads the columns. */
  const addMany = (rows) => {
    mutate((d) => {
      rows.forEach((r) => d.people.push({ ...blankPerson(r.name), role: r.role || "", func: r.func || "", location: r.location || "", level: r.level || "", relationship: r.relationship || "Colleague" }));
      return d;
    }, `Added ${rows.length} ${rows.length === 1 ? "person" : "people"}`);
    setImporting(false);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 className="h1">People</h2>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="btn sm" onClick={() => { setImporting((v) => !v); setAdding(false); }}>Paste a list</button>
          <button className="btn pri sm" onClick={() => { setAdding(true); setImporting(false); }}>+ Add person</button>
        </span>
      </div>
      <p className="sub">Who is holding what, and what is overdue. Open anyone to prepare for a one-to-one in a few seconds.</p>

      {adding && <AddPerson onAdd={addPerson} onCancel={() => setAdding(false)} />}
      {importing && <ImportPeople existing={data.people} onAdd={addMany} onCancel={() => setImporting(false)} />}

      <div className="toolrow">
        <input className="input" placeholder="Find a person…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!rows.length && <Empty>No people yet. Anyone named as an owner or as someone you are waiting on is picked up automatically — or add them above.</Empty>}

      <div className="peoplegrid">
        {rows.map(({ p, load }) => {
          const hot = load.overdue.length + load.chaseDue.length;
          return (
            <div key={p.id} className={"personcard" + (hot ? " hot" : "")} onClick={() => setSel(p.id)}>
              <div className="pname">{p.name}{p.level && <span className="plevel">{p.level}</span>}</div>
              <div className="prole">{[p.role, p.func, p.location].filter(Boolean).join(" · ") || p.relationship}</div>
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

/* One shape for a new person, so the three places that mint one cannot
   drift apart. */
const blankPerson = (name) => ({
  id: uid(), name: String(name).trim(), role: "", func: "", location: "", level: "",
  relationship: "Colleague", managerId: "", contexts: [], oneToOne: "", nextOneToOne: "",
  strengths: "", development: "", privateNotes: "", pdr: [], notes: [],
  active: true, created: todayISO(),
});

/* Reads a markdown table, a CSV or a tab-separated paste. The header row
   decides which column is which, so column order does not matter and
   columns it does not recognise are ignored rather than guessed at. */
const COLS = {
  name: ["name", "person", "who", "full name"],
  role: ["job title", "title", "role", "position"],
  func: ["function", "department", "dept", "function / department", "team", "area"],
  location: ["location", "site", "based", "office"],
  level: ["level", "grade", "band", "seniority"],
  relationship: ["relationship", "type"],
};
export function parsePeople(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cells = (l) => (l.includes("|") ? l.replace(/^\||\|$/g, "").split("|") : l.includes("\t") ? l.split("\t") : l.split(","))
    .map((c) => c.trim().replace(/^\*+|\*+$/g, "").trim());
  /* A markdown separator row. Narrow columns print as a single dash, so
     one is as much a rule as twenty. */
  const isRule = (cs) => cs.every((c) => /^:?-+:?$/.test(c) || /^=+$/.test(c) || !c);
  const rows = lines.map(cells).filter((cs) => !isRule(cs));
  if (!rows.length) return [];

  let map = null, start = 0;
  const head = rows[0].map((c) => c.toLowerCase());
  if (head.some((h) => COLS.name.includes(h))) {
    map = {};
    head.forEach((h, i) => { for (const k of Object.keys(COLS)) if (COLS[k].includes(h)) map[k] = i; });
    start = 1;
  }
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const cs = rows[i];
    const pick = (k, fallback) => { const idx = map && map[k] !== undefined ? map[k] : fallback; return idx === undefined ? "" : (cs[idx] || "").trim(); };
    const name = pick("name", 0);
    if (!name || /^name$/i.test(name)) continue;
    out.push({ name, role: pick("role", 1), func: pick("func", 2), location: pick("location", 3), level: pick("level", 4) });
  }
  return out;
}

function ImportPeople({ existing, onAdd, onCancel }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parsePeople(text), [text]);
  const have = new Set(existing.map((p) => p.name.toLowerCase()));
  const fresh = parsed.filter((r) => !have.has(r.name.toLowerCase()));
  const dupes = parsed.length - fresh.length;
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="flab">Paste a table, a CSV or a tab-separated list</div>
      <AutoTa minRows={2} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Name, job title, function, location, level — with a header row. Columns it does not recognise are ignored." />
      {parsed.length > 0 && <>
        <div className="h2" style={{ marginTop: 12 }}>Read {parsed.length} row{parsed.length === 1 ? "" : "s"}{dupes ? ` · ${dupes} already on the list` : ""}</div>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Job title</th><th>Function</th><th>Location</th><th>Level</th></tr></thead>
          <tbody>{parsed.map((r, i) => (
            <tr key={i} style={have.has(r.name.toLowerCase()) ? { opacity: .45 } : null}>
              <td>{r.name}</td><td>{r.role || "—"}</td><td>{r.func || "—"}</td><td>{r.location || "—"}</td><td>{r.level || "—"}</td>
            </tr>))}</tbody>
        </table>
      </>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn pri sm" disabled={!fresh.length} onClick={() => onAdd(fresh)}>
          {fresh.length ? `Add ${fresh.length} ${fresh.length === 1 ? "person" : "people"}` : "Nothing new to add"}
        </button>
        <button className="btn sm" onClick={onCancel}>Cancel</button>
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
function PersonPage({ data, person, mutate, openItem, openProject, back }) {
  const [tab, setTab] = useState("Work");
  const load = personLoad(data, person);
  /* The work this person OWNS, as opposed to the items I have asked them
     for. This is the half that was missing: without it a 1:1 covers the
     chases and misses the thing they are actually accountable for. */
  const owns = data.projects.filter((p) => String(p.owner || "").trim().toLowerCase() === person.name.toLowerCase());
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
        {owns.length > 0 && <>
          <div className="h2">Projects they own ({owns.length})</div>
          <p className="sub">Theirs to deliver, yours to supervise. Progress is whatever was last reported, not a figure you maintain.</p>
          {owns.map((p) => {
            const h = portfolioAttention(data, p, "project", data.settings);
            const r = lastReport(data, p);
            const kids = childProjects(data, p.id);
            return (
              <div key={p.id} className={"pfrow " + h.rag.toLowerCase()} onClick={() => openProject && openProject(p.id)}>
                <div className="pfmain">
                  <div className="pftop">
                    <Rag v={h.rag} />
                    <span className="pfname">{p.name}</span>
                    <span className="chip">{p.stage}</span>
                    {kids.length > 0 && <span className="chip sub">{kids.length} workstream{kids.length > 1 ? "s" : ""}</span>}
                  </div>
                  <div className="pfwhy">{h.reasons.length ? h.reasons.join(" · ") : (p.position || "Nothing outstanding")}</div>
                </div>
                <div className="pfnums">
                  <div className={r && r.days > 21 ? "bad" : ""}><b>{r ? r.days + "d" : "—"}</b><i>since update</i></div>
                  <div><b>{p.progress}%</b><i>{p.measureLabel ? `${p.measureCurrent}/${p.measureTarget}` : "progress"}</i></div>
                </div>
              </div>);
          })}
        </>}
        <Section title="I am waiting on them for" items={load.waitingOnThem} empty="Nothing outstanding with this person." />
        <Section title="What I owe them" items={load.iOweThem} empty="No commitments recorded to this person. Record one by creating a Commitment and setting 'Made to'." />
        <Section title="Their own open work" items={load.theyOwn} empty="Nothing is currently owned by this person." />
      </>}

      {tab === "Details" && (
        <div className="frow" style={{ marginTop: 10 }}>
          <F label="Role"><input className="input" value={person.role} onChange={(e) => set("role", e.target.value)} /></F>
          <F label="Function"><input className="input" value={person.func} onChange={(e) => set("func", e.target.value)} /></F>
          <F label="Level"><input className="input" value={person.level || ""} onChange={(e) => set("level", e.target.value)} placeholder="e.g. head of function, manager" /></F>
          <F label="Location"><input className="input" value={person.location} onChange={(e) => set("location", e.target.value)} /></F>
          <F label="Relationship"><select className="select" value={person.relationship} onChange={(e) => set("relationship", e.target.value)}>{RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}</select></F>
          <F label="1:1 cadence"><input className="input" value={person.oneToOne} onChange={(e) => set("oneToOne", e.target.value)} placeholder="e.g. fortnightly, Tuesdays" /></F>
          <F label="Next 1:1"><input type="date" className="input" value={person.nextOneToOne} onChange={(e) => set("nextOneToOne", e.target.value)} /></F>
          <F label="Operational contexts" span>
            <ContextPicker contexts={data.contexts.filter((c) => c.active)} selected={person.contexts}
              onToggle={(id) => edit((p) => { p.contexts = (p.contexts || []).includes(id) ? p.contexts.filter((x) => x !== id) : [...(p.contexts || []), id]; }, "Contexts updated")} />
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
      <AutoTa minRows={2} value={person.strengths} onChange={(e) => set("strengths", e.target.value)}
        placeholder="What they are genuinely good at — the things you would put them on." />

      <div className="h2">Development</div>
      <AutoTa minRows={2} value={person.development} onChange={(e) => set("development", e.target.value)}
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
          <F label="Objectives" span><AutoTa value={pdr.objectives} onChange={(e) => setPdr({ ...pdr, objectives: e.target.value })} /></F>
          <F label="Notes" span><AutoTa value={pdr.notes} onChange={(e) => setPdr({ ...pdr, notes: e.target.value })} /></F>
        </div>
        <button className="btn pri sm" style={{ marginTop: 8 }} disabled={!pdr.period.trim()} onClick={addPdr}>Add PDR record</button>
      </div>
    </div>
  );
}
