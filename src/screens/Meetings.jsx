/* ============================================================
   Meetings and calendar.

   Recording is not available, so this is built around what IS: notes
   pasted or typed after the fact. The workflow is deliberately
   propose-then-approve:

     notes → AI structures them → you review → approved items become
     real records → only then is the meeting marked processed

   Two rules the AI is held to. It does not turn every "we should" into
   a task, and it does not assign an owner or a deadline that was not
   actually said. Anything it is unsure of comes back blank.

   The meeting stays the source record, and everything derived from it
   keeps a link back — so "why does this task exist?" always has an
   answer.
   ============================================================ */
import React, { useState, useMemo } from "react";
import { F, Empty, Badge, askConfirm, askInfo, fmtD } from "../ui";
import { askClaude } from "../lib/claude";
import {
  MEETING_TYPES, PRIORITIES, TYPES, uid, todayISO, daysUntil, ctxNames, personByName,
} from "../lib/model";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function Meetings({ data, mutate, openItem }) {
  const [view, setView] = useState("Calendar");
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [sel, setSel] = useState(null);

  const meetings = data.meetings || [];
  const unprocessed = meetings.filter((m) => !m.processed && m.notes);

  const create = (date) => {
    const id = uid();
    mutate((d) => {
      d.meetings = d.meetings || [];
      d.meetings.push({
        id, title: "", date: date || todayISO(), type: "Other", contexts: [], people: [],
        project: "", mob: "", notes: "", summary: "", processed: false, created: todayISO(),
      });
      return d;
    }, "Meeting added");
    setSel(id);
  };

  if (sel) {
    const m = meetings.find((x) => x.id === sel);
    if (!m) { setSel(null); return null; }
    return <MeetingPage data={data} meeting={m} mutate={mutate} openItem={openItem} back={() => setSel(null)} />;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 className="h1">Meetings</h2>
        <button className="btn pri sm" style={{ marginLeft: "auto" }} onClick={() => create()}>+ New meeting</button>
      </div>
      <p className="sub">Put the notes somewhere they can be found again. Paste what you have, let it be structured into decisions and actions, approve what is right — and everything it creates keeps a link back to this meeting.</p>

      {unprocessed.length > 0 && (
        <div className="warnbox">{unprocessed.length} meeting{unprocessed.length > 1 ? "s have" : " has"} notes that have not been turned into actions yet.</div>)}

      <div className="viewtabs">
        {["Calendar", "List", "To process"].map((v) => (
          <button key={v} className={"vtab" + (view === v ? " on" : "")} onClick={() => setView(v)}>
            {v}{v === "To process" && <span>{unprocessed.length}</span>}
          </button>))}
      </div>

      {view === "Calendar" && <CalendarGrid data={data} cursor={cursor} setCursor={setCursor} onOpen={setSel} onAdd={create} />}

      {view === "List" && (
        meetings.length
          ? <MeetingList data={data} rows={[...meetings].sort((a, b) => (b.date || "").localeCompare(a.date || ""))} onOpen={setSel} />
          : <Empty>No meetings recorded. Add one and paste the notes in — even rough notes are worth far more in here than in a file you will not find again.</Empty>)}

      {view === "To process" && (
        unprocessed.length
          ? <MeetingList data={data} rows={unprocessed} onOpen={setSel} />
          : <Empty>Nothing waiting. Every meeting with notes has been turned into actions.</Empty>)}
    </div>
  );
}

function MeetingList({ data, rows, onOpen }) {
  return (
    <table className="tbl">
      <thead><tr><th>Date</th><th>Meeting</th><th>Type</th><th>People</th><th>Context</th><th>State</th></tr></thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id} onClick={() => onOpen(m.id)} style={{ cursor: "pointer" }}>
            <td className="mono">{fmtD(m.date)}</td>
            <td>{m.title || <span style={{ color: "#8A93A0" }}>(untitled)</span>}</td>
            <td>{m.type}</td>
            <td>{(m.people || []).join(", ")}</td>
            <td>{ctxNames(data, m.contexts).join(", ")}</td>
            <td>{m.processed ? <span className="chip">processed</span> : m.notes ? <span className="chip wait">to process</span> : <span className="chip">no notes</span>}</td>
          </tr>))}
      </tbody>
    </table>
  );
}

function CalendarGrid({ data, cursor, setCursor, onOpen, onAdd }) {
  const { y, m } = cursor;
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(y, m + 1, 0).getDate();
  const byDate = useMemo(() => {
    const map = {};
    (data.meetings || []).forEach((x) => { (map[x.date] = map[x.date] || []).push(x); });
    return map;
  }, [data.meetings]);
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  const today = todayISO();

  const shift = (n) => setCursor(({ y: yy, m: mm }) => {
    const nm = mm + n;
    return { y: yy + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
  });

  return (
    <div>
      <div className="toolrow">
        <button className="btn sm" onClick={() => shift(-1)}>← </button>
        <b style={{ minWidth: 150, textAlign: "center" }}>{MONTH_NAMES[m]} {y}</b>
        <button className="btn sm" onClick={() => shift(1)}> →</button>
        <button className="btn sm" onClick={() => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }); }}>Today</button>
      </div>
      <div className="calgrid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="caldow">{d}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={"e" + i} className="calcell empty" />;
          const date = iso(y, m, d);
          const list = byDate[date] || [];
          return (
            <div key={date} className={"calcell" + (date === today ? " today" : "")} onDoubleClick={() => onAdd(date)}>
              <div className="caldate">{d}</div>
              {list.slice(0, 3).map((x) => (
                <div key={x.id} className={"calev" + (x.processed ? "" : x.notes ? " unproc" : "")} onClick={() => onOpen(x.id)} title={x.title}>
                  {x.title || "(untitled)"}
                </div>))}
              {list.length > 3 && <div className="calmore">+{list.length - 3} more</div>}
            </div>);
        })}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>Double-click a day to add a meeting. An amber bar means notes are waiting to be turned into actions.</p>
    </div>
  );
}

/* ============================================================
   One meeting
   ============================================================ */
function MeetingPage({ data, meeting, mutate, openItem, back }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [proposed, setProposed] = useState(null);
  const [personDraft, setPersonDraft] = useState("");

  const edit = (fn, label) => mutate((d) => { const m = d.meetings.find((x) => x.id === meeting.id); if (m) fn(m); return d; }, label);
  const set = (k, v) => edit((m) => { m[k] = v; }, "Meeting updated");
  const derived = data.workItems.filter((w) => w.source && w.source.id === meeting.id);

  const process = async () => {
    if (!meeting.notes.trim()) return;
    setBusy(true); setErr(""); setProposed(null);
    try {
      const prompt = `You are structuring notes from a meeting for an operations director's tracking system. Respond ONLY with JSON:
{"summary": string (4-8 lines: purpose, key points, and what actually changed. Plain prose, no markdown headers),
 "decisions": [{"what": string, "who": string or "", "rationale": string or ""}],
 "actions": [{"title": string (short, imperative), "description": string, "owner": string or "", "waitingOn": string or "", "due": "YYYY-MM-DD" or "", "priority": one of ${JSON.stringify(PRIORITIES)}, "mine": boolean (true if this is the director's own action, false if someone else owns it)}],
 "risks": [string],
 "questions": [string (things left genuinely unresolved in the meeting)]}

HARD RULES — these matter more than completeness:
- Do NOT turn every "we should" or "it would be good to" into an action. Only record something as an action if it was genuinely agreed or asked for.
- Do NOT assign an owner unless a person was explicitly named as responsible. Leave owner "" otherwise.
- Do NOT invent a deadline. If no date was stated, leave due "". Never guess "end of month".
- Do NOT record a decision that was only discussed. A decision is something that was settled.
- If you are unsure, leave the field blank. Blank is correct; a confident guess is not.

Today is ${fmtD(todayISO())} (${todayISO()}). Resolve stated relative dates ("Friday", "next week") against it.
Known people, for matching names only: ${JSON.stringify(data.people.map((p) => p.name))}
The director is ${data.settings.displayName || "the user"} — their own actions have mine=true.

MEETING: ${meeting.title || "(untitled)"} — ${fmtD(meeting.date)} — ${meeting.type}
NOTES:
${meeting.notes}`;
      const out = await askClaude(prompt, true, 4000, "standard");
      setProposed({
        summary: out.summary || "",
        decisions: (out.decisions || []).map((x) => ({ ...x, _id: uid(), _sel: true })),
        actions: (out.actions || []).map((x) => ({ ...x, _id: uid(), _sel: true })),
        risks: (out.risks || []).map((x) => ({ text: x, _id: uid(), _sel: true })),
        questions: out.questions || [],
      });
    } catch (e) { setErr("Could not structure those notes (" + (e.message || "AI error") + "). The notes themselves are saved."); }
    setBusy(false);
  };

  /* Approve. The meeting is marked processed only once the records have
     actually been written — a flag set before the work exists is a lie
     that surfaces three weeks later. */
  const approve = () => {
    const acts = proposed.actions.filter((a) => a._sel);
    const decs = proposed.decisions.filter((x) => x._sel);
    const risks = proposed.risks.filter((x) => x._sel);
    if (!acts.length && !decs.length && !risks.length && !proposed.summary) return askInfo("Nothing is selected.");
    const src = { type: "meeting", id: meeting.id, label: `meeting: ${meeting.title || "(untitled)"}`, date: meeting.date };
    const base = (over) => ({
      id: uid(), title: "", description: "", type: "Action", status: "Planned", mode: "Action",
      priority: "P3", owner: data.settings.displayName || "Me", waitingOn: "", project: meeting.project || "", mob: meeting.mob || "",
      contexts: meeting.contexts || [],
      due: "", nextChase: "", lastChased: "", completed: "", archivedAt: "", created: todayISO(), updatedAt: todayISO(),
      rag: "", nextAction: "", blocker: "", focus: false, estimate: "",
      subtasks: [], source: src, personId: "",
      flags: { board: false, coo: false, news: false, groupWeekly: false, ukWeekly: false },
      confidentiality: "Internal", notes: [{ ts: todayISO(), text: `From ${src.label} (AI-proposed, approved by you)` }],
      extra: {}, outcome: "", ...over,
    });
    mutate((d) => {
      acts.forEach((a) => d.workItems.push(base({
        title: a.title || "Untitled", description: a.description || "", type: "Action",
        owner: a.mine ? (d.settings.displayName || "Me") : (a.owner || ""),
        waitingOn: a.mine ? "" : (a.waitingOn || a.owner || ""),
        mode: a.mine ? "Action" : "Waiting on",
        due: a.due || "", priority: PRIORITIES.includes(a.priority) ? a.priority : "P3",
      })));
      decs.forEach((x) => d.workItems.push(base({
        title: x.what || "Decision", type: "Decision", status: "Planned",
        description: x.rationale || "", owner: x.who || (d.settings.displayName || "Me"),
        extra: { decisionStatus: "Decided", decisionMade: x.what || "", rationale: x.rationale || "", decisionOwner: x.who || "" },
      })));
      risks.forEach((x) => d.workItems.push(base({ title: x.text, type: "Risk", description: "Raised at " + src.label })));
      const m = d.meetings.find((x) => x.id === meeting.id);
      if (m) { m.summary = proposed.summary || m.summary; m.processed = true; }
      return d;
    }, `Meeting processed — ${acts.length} action(s), ${decs.length} decision(s), ${risks.length} risk(s)`);
    setProposed(null);
  };

  const Row = ({ item, onToggle, children }) => (
    <div className="card" style={{ marginBottom: 6, borderLeft: "4px solid " + (item._sel ? "#112138" : "#DCE3E8") }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" checked={item._sel} onChange={onToggle} style={{ marginTop: 3 }} />
        <div style={{ flex: 1 }}>{children}</div>
      </div>
    </div>
  );

  return (
    <div>
      <button className="btn sm" onClick={back}>← All meetings</button>
      <div className="frow" style={{ marginTop: 10 }}>
        <F label="Title" span><input className="input" autoFocus={!meeting.title} value={meeting.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Spain weekly operational review" /></F>
        <F label="Date"><input type="date" className="input" value={meeting.date} onChange={(e) => set("date", e.target.value)} /></F>
        <F label="Type"><select className="select" value={meeting.type} onChange={(e) => set("type", e.target.value)}>{MEETING_TYPES.map((t) => <option key={t}>{t}</option>)}</select></F>
        <F label="Project"><select className="select" value={meeting.project} onChange={(e) => set("project", e.target.value)}><option value="">—</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></F>
        <F label="Mobilisation"><select className="select" value={meeting.mob} onChange={(e) => set("mob", e.target.value)}><option value="">—</option>{data.mobs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></F>
      </div>

      <div className="h2">Who was there</div>
      <div className="ctxpick">
        {(meeting.people || []).map((n) => (
          <span key={n} className="chip">{n} <span className="linkish" onClick={() => set("people", meeting.people.filter((x) => x !== n))}>✕</span></span>))}
        <input className="input" style={{ width: 180 }} list="mtg-people" placeholder="Add someone… (Enter)" value={personDraft}
          onChange={(e) => setPersonDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && personDraft.trim()) { set("people", [...new Set([...(meeting.people || []), personDraft.trim()])]); setPersonDraft(""); } }} />
        <datalist id="mtg-people">{data.people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      </div>

      <div className="h2">Operational contexts</div>
      <div className="ctxpick">
        {data.contexts.filter((c) => c.active).map((c) => (
          <button key={c.id} type="button" className={"ctxtag" + ((meeting.contexts || []).includes(c.id) ? " on" : "")}
            onClick={() => set("contexts", (meeting.contexts || []).includes(c.id) ? meeting.contexts.filter((x) => x !== c.id) : [...(meeting.contexts || []), c.id])}>
            {c.name}<i>{c.type}</i></button>))}
      </div>

      <div className="h2">Notes</div>
      <textarea className="ta" rows={10} value={meeting.notes} onChange={(e) => set("notes", e.target.value)}
        placeholder="Paste or type whatever you have — rough bullets are fine. This stays as the source record." />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn pri" disabled={busy || !meeting.notes.trim()} onClick={process}>{busy ? "Reading the notes…" : "Structure these notes"}</button>
        {meeting.processed && <span className="chip">processed</span>}
        {meeting.processed && <button className="btn sm" onClick={() => set("processed", false)}>Mark unprocessed</button>}
        <span className="sub" style={{ margin: 0 }}>Nothing is saved as a record until you approve it.</span>
      </div>
      {err && <div className="warnbox" style={{ marginTop: 8 }}>{err}</div>}

      {meeting.summary && !proposed && <>
        <div className="h2">Summary</div>
        <div className="notebox" style={{ whiteSpace: "pre-wrap" }}>{meeting.summary}</div>
      </>}

      {proposed && <>
        <div className="h2">Proposed — check before saving</div>
        <div className="notebox">Owners and dates are only filled in where they were actually stated. Blanks are deliberate, not omissions.</div>

        {proposed.summary && <>
          <div className="flab" style={{ marginTop: 10 }}>Summary</div>
          <textarea className="ta" rows={6} value={proposed.summary} onChange={(e) => setProposed({ ...proposed, summary: e.target.value })} />
        </>}

        {proposed.decisions.length > 0 && <>
          <div className="flab" style={{ marginTop: 12 }}>Decisions ({proposed.decisions.length})</div>
          {proposed.decisions.map((x) => (
            <Row key={x._id} item={x} onToggle={() => setProposed({ ...proposed, decisions: proposed.decisions.map((y) => y._id === x._id ? { ...y, _sel: !y._sel } : y) })}>
              <input className="input" style={{ fontWeight: 600 }} value={x.what} onChange={(e) => setProposed({ ...proposed, decisions: proposed.decisions.map((y) => y._id === x._id ? { ...y, what: e.target.value } : y) })} />
              {x.rationale && <div className="sub" style={{ margin: "4px 0 0" }}>{x.rationale}</div>}
              {x.who && <span className="chip">{x.who}</span>}
            </Row>))}
        </>}

        {proposed.actions.length > 0 && <>
          <div className="flab" style={{ marginTop: 12 }}>Actions ({proposed.actions.length})</div>
          {proposed.actions.map((x) => {
            const upd = (k, v) => setProposed({ ...proposed, actions: proposed.actions.map((y) => y._id === x._id ? { ...y, [k]: v } : y) });
            return (
              <Row key={x._id} item={x} onToggle={() => upd("_sel", !x._sel)}>
                <input className="input" style={{ fontWeight: 600 }} value={x.title} onChange={(e) => upd("title", e.target.value)} />
                <div className="frow" style={{ marginTop: 6 }}>
                  <F label="Mine or theirs">
                    <select className="select" value={x.mine ? "mine" : "theirs"} onChange={(e) => upd("mine", e.target.value === "mine")}>
                      <option value="mine">My action</option><option value="theirs">Waiting on someone</option>
                    </select></F>
                  <F label={x.mine ? "Owner" : "Waiting on"}>
                    <input className="input" list="mtg-people" value={x.mine ? (x.owner || "") : (x.waitingOn || x.owner || "")}
                      onChange={(e) => upd(x.mine ? "owner" : "waitingOn", e.target.value)} placeholder={x.mine ? "" : "not stated"} /></F>
                  <F label="Due"><input type="date" className="input" value={x.due || ""} onChange={(e) => upd("due", e.target.value)} /></F>
                  <F label="Priority"><select className="select" value={x.priority || "P3"} onChange={(e) => upd("priority", e.target.value)}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></F>
                </div>
              </Row>);
          })}
        </>}

        {proposed.risks.length > 0 && <>
          <div className="flab" style={{ marginTop: 12 }}>Risks raised ({proposed.risks.length})</div>
          {proposed.risks.map((x) => (
            <Row key={x._id} item={x} onToggle={() => setProposed({ ...proposed, risks: proposed.risks.map((y) => y._id === x._id ? { ...y, _sel: !y._sel } : y) })}>
              <input className="input" value={x.text} onChange={(e) => setProposed({ ...proposed, risks: proposed.risks.map((y) => y._id === x._id ? { ...y, text: e.target.value } : y) })} />
            </Row>))}
        </>}

        {proposed.questions.length > 0 && <>
          <div className="flab" style={{ marginTop: 12 }}>Left unresolved</div>
          <div className="notebox">{proposed.questions.map((q, i) => <div key={i}>• {q}</div>)}</div>
        </>}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn pri" onClick={approve}>Save approved records</button>
          <button className="btn" onClick={async () => { if (await askConfirm("Discard this analysis? The notes stay.")) setProposed(null); }}>Discard</button>
        </div>
      </>}

      {derived.length > 0 && <>
        <div className="h2">Came from this meeting ({derived.length})</div>
        {derived.map((w) => (
          <div key={w.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => openItem(w)}>
            <Badge p={w.priority} />
            <span className="chip">{w.type}</span>
            <span style={{ flex: 1 }}>{w.title}</span>
            <span className="chip">{w.status}</span>
          </div>))}
      </>}

      <div style={{ marginTop: 20 }}>
        <button className="btn danger sm" onClick={async () => {
          if (await askConfirm("Delete this meeting? Items already created from it are kept, but they will lose the link back to their source.")) {
            mutate((d) => { d.meetings = d.meetings.filter((x) => x.id !== meeting.id); return d; }, "Meeting deleted");
            back();
          }
        }}>Delete meeting</button>
      </div>
    </div>
  );
}
