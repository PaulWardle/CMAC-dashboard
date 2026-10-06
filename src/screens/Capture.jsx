/* ============================================================
   Capture.

   The old version could only ever produce work items, so a meeting
   pack came back as fifteen identical cards with ten dropdowns each
   and the pack itself was lost. This one reads a dump the way a person
   would: it says what it has read, then separates my actions from
   other people's, pulls out decisions, risks, dates, the people
   involved and which part of the operation it touches — and keeps the
   dump itself as a source record so everything links back.

   Three rules hold throughout:
     - nothing is written without approval;
     - a field that was not stated comes back blank, never guessed;
     - every created record carries its provenance.
   ============================================================ */
import React, { useState, useRef } from "react";
import { F, Empty, Badge, askConfirm, askInfo, fmtD } from "../ui";
import { askClaude } from "../lib/claude";
import { fileToCapture, ACCEPT, MAX_FILES } from "../lib/ingest";
import {
  PRIORITIES, PRIO_LABEL, TYPES, CORE_TYPES, uid, todayISO, daysSince,
  ctxNames, personByName, isOpen,
} from "../lib/model";

/* The brief. Written as instructions to a reader rather than a schema
   dump, because that is what produces a useful read of a messy inbox. */
function capturePrompt(text, d) {
  const lim = (s, n) => String(s || "").trim().slice(0, n);
  const ctx = d.context || {};
  const openTitles = d.workItems.filter(isOpen).slice(0, 150).map((w) => w.title);
  const brief = [
    lim(ctx.org, 2500) && "ABOUT THIS OPERATION:\n" + lim(ctx.org, 2500),
    lim(ctx.people, 2000) && "PEOPLE & ROLES:\n" + lim(ctx.people, 2000),
    lim(ctx.clients, 1500) && "CLIENTS & TERMINOLOGY:\n" + lim(ctx.clients, 1500),
    lim(ctx.rules, 2000) && "STANDING TRIAGE RULES:\n" + lim(ctx.rules, 2000),
    lim(ctx.learned, 2000) && "PREVIOUSLY LEARNED:\n" + lim(ctx.learned, 2000),
  ].filter(Boolean).join("\n\n");

  return `Read the material below the way a chief of staff would read an operations director's inbox, and tell them what is in it.

Respond ONLY with JSON (no markdown, no preamble):
{
 "read": string — 2-4 sentences: what this material actually is, and the single most important thing in it. Plain prose.
 "actions":    [ {"title","description","due","priority","project","mobilisation","contexts":[],"confidence":"high"|"low"} ]   — things the DIRECTOR must do
 "waiting":    [ {"title","description","person","due","priority","contexts":[],"confidence"} ]                                             — things SOMEONE ELSE owes, that the director must monitor
 "decisions":  [ {"title","what","who","rationale","status":"Decided"|"Required"} ]
 "risks":      [ {"title","description","priority","mitigation"} ]
 "dates":      [ {"what","date","who"} ]   — deadlines, go-lives, meetings mentioned but not already an action
 "people":     [ {"name","role","why"} ]   — people named in the material
 "facts":      [ string ]                  — up to 4 lasting facts worth remembering permanently (a person's role, an abbreviation, a client fact). Never repeat anything already in the brief.
 "questions":  [ string ]                  — up to 3, only where something genuinely important is missing or ambiguous
 "duplicates": [ {"title","existing"} ]    — a proposed title that looks like it already exists, with the exact existing title
}

RULES — these matter more than completeness:
- Separate MY actions from things I am waiting on. If somebody else owes it, it is "waiting", with their name in "person".
- Never invent an owner, a date or a priority that was not stated or clearly implied. Blank is correct.
- Do not turn every "we should" into an action. Only what was actually asked for or agreed.
- Set confidence "low" on anything you are inferring rather than reading. The user sorts those first.
- Priority: ${PRIORITIES.map((p) => `${p}=${PRIO_LABEL[p]}`).join(", ")}. Default P3 unless urgency is clear.
- "contexts" is how work is classified — geography, function, client, supplier. Tag as many as genuinely apply. Exact names from this list only: ${JSON.stringify(d.contexts.filter((c) => c.active).map((c) => `${c.name} (${c.type})`))}
- "project" / "mobilisation" must be an exact existing name or "".
- Empty arrays are fine. An honest short answer beats a padded one.

Today is ${fmtD(todayISO())} (${todayISO()}). Resolve stated relative dates against it.
Projects: ${JSON.stringify(d.projects.map((p) => p.name))}
Mobilisations: ${JSON.stringify(d.mobs.map((m) => m.name))}
Known people: ${JSON.stringify(d.people.map((p) => p.name))}
The director is ${d.settings.displayName || "the user"}.

${brief ? brief + "\n\n" : ""}EXISTING OPEN ITEMS (for the duplicates check):
${JSON.stringify(openTitles)}

MATERIAL:
${text}`;
}

export default function Capture({ data, mutate, openItem }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  const [answer, setAnswer] = useState("");
  const lastInput = useRef("");
  const fileRef = useRef(null);
  const inbox = data.workItems.filter((w) => w.status === "Inbox");

  const addFiles = async (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setErr(""); setIngesting(true);
    let held = files.length;
    const problems = [];
    for (const f of incoming) {
      if (held >= MAX_FILES) { problems.push(`Only ${MAX_FILES} attachments at a time — ${f.name} was not added.`); continue; }
      try {
        const processed = await fileToCapture(f);
        held += 1;
        setFiles((fs) => (fs.length >= MAX_FILES ? fs : [...fs, { ...processed, _id: uid() }]));
      } catch (e) { problems.push(String(e.message || e)); }
    }
    if (problems.length) setErr(problems.join("  •  "));
    setIngesting(false);
  };
  const onPaste = (e) => {
    const imgs = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean);
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  };

  const mark = (o, extra) => ({ ...o, _id: uid(), _sel: true, ...extra });
  const shape = (out) => ({
    read: out.read || "",
    actions: (out.actions || []).map((x) => mark(x)),
    waiting: (out.waiting || []).map((x) => mark(x)),
    decisions: (out.decisions || []).map((x) => mark(x)),
    risks: (out.risks || []).map((x) => mark(x)),
    dates: (out.dates || []).map((x) => mark(x, { _sel: false })),
    people: (out.people || []).filter((p) => p.name && !personByName(data, p.name)).map((x) => mark(x)),
    facts: (out.facts || []).slice(0, 4).map((x) => mark({ text: x })),
    questions: (out.questions || []).slice(0, 3),
    duplicates: out.duplicates || [],
  });

  const run = async () => {
    if (!text.trim() && !files.length) return;
    setBusy(true); setErr(""); setRes(null);
    try {
      const attachTexts = files.filter((f) => f.kind === "text").map((f) => `--- Attached file: ${f.name} ---\n${f.text}`).join("\n\n");
      const combined = [text.trim(), attachTexts].filter(Boolean).join("\n\n") || "(see the attached documents)";
      const blocks = [];
      files.forEach((f) => {
        if (f.kind === "image") blocks.push({ type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } });
        else if (f.kind === "pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
      });
      blocks.push({ type: "text", text: capturePrompt(combined, data) });
      lastInput.current = combined;
      const out = await askClaude(blocks.length === 1 ? blocks[0].text : blocks, true, 8000, "standard");
      const s = shape(out);
      const total = s.actions.length + s.waiting.length + s.decisions.length + s.risks.length;
      if (!total && !s.read) setErr("Nothing extractable was found in that material.");
      setRes(s);
      setAnswer("");
    } catch (e) { setErr("Could not read that just now (" + (e.message || "AI error") + "). Your text is still here — you can retry, or add it as a plain note below."); }
    setBusy(false);
  };

  const refine = async () => {
    if (!answer.trim() || !res) return;
    setBusy(true); setErr("");
    try {
      const strip = (arr) => arr.map(({ _sel, _id, ...r }) => r);
      const prompt = capturePrompt(lastInput.current || "(material previously provided)", data) +
        `\n\nYOU PREVIOUSLY PROPOSED:\n${JSON.stringify({ actions: strip(res.actions), waiting: strip(res.waiting), decisions: strip(res.decisions), risks: strip(res.risks) })}` +
        `\n\nYOU ASKED:\n${JSON.stringify(res.questions)}\n\nTHE USER ANSWERS:\n${answer.trim()}\n\nReturn the SAME JSON shape, updated with these answers. Keep "questions" empty unless something important is still genuinely unresolved.`;
      const out = await askClaude(prompt, true, 8000, "standard");
      setRes(shape(out));
      setAnswer("");
    } catch (e) { setErr("Could not apply that (" + (e.message || "AI error") + ")."); }
    setBusy(false);
  };

  const quickAdd = () => {
    if (!text.trim()) return;
    mutate((d) => {
      d.workItems.push(blankItem(d, { title: text.trim().slice(0, 140), description: text.trim(), status: "Inbox", priority: "P3" }));
      return d;
    }, "Quick-captured to inbox");
    setText("");
  };

  /* Save. The dump is written as a source record first, so every item
     created from it can point back at what it was actually read from. */
  const approve = () => {
    const picked = {
      actions: res.actions.filter((x) => x._sel),
      waiting: res.waiting.filter((x) => x._sel),
      decisions: res.decisions.filter((x) => x._sel),
      risks: res.risks.filter((x) => x._sel),
      dates: res.dates.filter((x) => x._sel),
      people: res.people.filter((x) => x._sel),
      facts: res.facts.filter((x) => x._sel),
    };
    const n = Object.values(picked).reduce((a, b) => a + b.length, 0);
    if (!n) return askInfo("Nothing is ticked.");

    const srcId = uid();
    const label = `capture ${fmtD(todayISO())}${files.length ? ` (${files.map((f) => f.name).join(", ").slice(0, 60)})` : ""}`;
    const src = { type: "capture", id: srcId, label, date: todayISO() };
    const ctxIds = (names) => (names || []).map((nm) => (data.contexts.find((c) => c.name.toLowerCase() === String(nm).toLowerCase()) || {}).id).filter(Boolean);

    mutate((d) => {
      d.sources = d.sources || [];
      d.sources.push({ id: srcId, kind: "capture", date: todayISO(), label, text: lastInput.current.slice(0, 20000), read: res.read || "" });

      const idOf = (list, nm) => (list.find((x) => x.name === nm) || {}).id || "";
      picked.actions.forEach((a) => d.workItems.push(blankItem(d, {
        title: a.title || "Untitled", description: a.description || "", type: "Action", mode: "Action",
        due: a.due || "", priority: PRIORITIES.includes(a.priority) ? a.priority : "P3",
        project: idOf(d.projects, a.project), mob: idOf(d.mobs, a.mobilisation),
        contexts: ctxIds(a.contexts), source: src,
        notes: [{ ts: todayISO(), text: `From ${label} (AI-proposed, approved by you)` }],
      })));
      picked.waiting.forEach((a) => d.workItems.push(blankItem(d, {
        title: a.title || "Untitled", description: a.description || "", type: "Action", mode: "Waiting on",
        waitingOn: a.person || "", due: a.due || "", priority: PRIORITIES.includes(a.priority) ? a.priority : "P3",
        contexts: ctxIds(a.contexts), source: src,
        notes: [{ ts: todayISO(), text: `From ${label} — waiting on ${a.person || "someone"}` }],
      })));
      picked.decisions.forEach((x) => d.workItems.push(blankItem(d, {
        title: x.title || x.what || "Decision", type: "Decision", description: x.rationale || "", source: src,
        extra: { decisionStatus: x.status === "Decided" ? "Decided" : "Required", decisionMade: x.what || "", rationale: x.rationale || "", decisionOwner: x.who || "" },
      })));
      picked.risks.forEach((x) => d.workItems.push(blankItem(d, {
        title: x.title || "Risk", type: "Risk", description: x.description || "", source: src,
        priority: PRIORITIES.includes(x.priority) ? x.priority : "P3",
        extra: { mitigation: x.mitigation || "" },
      })));
      picked.dates.forEach((x) => d.workItems.push(blankItem(d, {
        title: x.what || "Key date", type: "Milestone", due: x.date || "", owner: x.who || (d.settings.displayName || "Me"), source: src,
      })));
      picked.people.forEach((p) => {
        if (d.people.some((q) => q.name.toLowerCase() === p.name.toLowerCase())) return;
        d.people.push({
          id: uid(), name: p.name, role: p.role || "", func: "", location: "", relationship: "Colleague",
          managerId: "", contexts: [], oneToOne: "", nextOneToOne: "",
          strengths: "", development: "", privateNotes: "", pdr: [],
          notes: p.why ? [{ id: uid(), ts: todayISO(), text: p.why }] : [],
          active: true, created: todayISO(),
        });
      });
      if (picked.facts.length) {
        const existing = (d.context || {}).learned || "";
        const add = picked.facts.map((f) => f.text).filter((t) => !existing.toLowerCase().includes(String(t).toLowerCase().slice(0, 60)))
          .map((t) => `• ${t}  (${fmtD(todayISO())})`);
        if (add.length) d.context = { ...(d.context || {}), learned: [existing.trim(), ...add].filter(Boolean).join("\n").slice(0, 12000) };
      }
      return d;
    }, `Captured ${n} record(s) from a dump`);

    setRes(null); setText(""); setFiles([]); setAnswer("");
  };

  const totals = res ? {
    actions: res.actions.filter((x) => x._sel).length,
    waiting: res.waiting.filter((x) => x._sel).length,
    other: res.decisions.filter((x) => x._sel).length + res.risks.filter((x) => x._sel).length + res.dates.filter((x) => x._sel).length,
    people: res.people.filter((x) => x._sel).length,
  } : null;
  const picked = totals ? totals.actions + totals.waiting + totals.other + totals.people : 0;

  return (
    <div>
      <h2 className="h1">Capture</h2>
      <p className="sub">Dump anything — a forwarded email, a meeting pack, a screenshot, a half-formed thought. It gets read properly: your actions separated from what you are waiting on, plus decisions, risks, dates and who was involved. Nothing is saved until you say so.</p>

      <div className="card" style={dragOver ? { outline: "2px dashed #FD0E33", outlineOffset: -6 } : null}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}>
        <textarea className="ta" rows={6} value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste}
          placeholder="Paste or type anything here, or drop files on this box — Outlook emails (.msg/.eml), Word, Excel, PDFs, screenshots." />
        {files.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {files.map((f) => (
              <span key={f._id} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px" }}>
                {f.kind === "image" ? "🖼" : f.kind === "pdf" ? "📄" : "📎"} {f.name.length > 34 ? f.name.slice(0, 32) + "…" : f.name}
                <span className="linkish" style={{ color: "#FD0E33" }} onClick={() => setFiles((fs) => fs.filter((x) => x._id !== f._id))}>✕</span>
              </span>))}
          </div>)}
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn pri" disabled={busy || ingesting || (!text.trim() && !files.length)} onClick={run}>{busy ? "Reading…" : "Read this"}</button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={ingesting}>{ingesting ? "Reading files…" : "📎 Attach"}</button>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} style={{ display: "none" }}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button className="btn" disabled={!text.trim()} onClick={quickAdd}>Just park it in the inbox</button>
        </div>
        {err && <div className="warnbox" style={{ marginTop: 8 }}>{err}</div>}
      </div>

      {res && <>
        {res.read && <div className="readcard"><div className="flab">What this is</div><div>{res.read}</div></div>}

        {res.questions.length > 0 && (
          <div className="card" style={{ marginTop: 8, borderLeft: "4px solid #1D5FBF" }}>
            <div className="flab">Before this is final</div>
            {res.questions.map((q, i) => <div key={i} style={{ fontSize: 12.5, padding: "2px 0" }}>• {q}</div>)}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input className="input" placeholder="Answer in one line…" value={answer} onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && refine()} />
              <button className="btn pri sm" disabled={busy || !answer.trim()} onClick={refine}>{busy ? "Updating…" : "Answer"}</button>
            </div>
            <div className="sub" style={{ margin: "6px 0 0" }}>Or ignore these and approve what is right below.</div>
          </div>)}

        {res.duplicates.length > 0 && (
          <div className="warnbox" style={{ marginTop: 8 }}>
            Possible duplicates: {res.duplicates.map((x) => `"${x.title}" looks like the existing "${x.existing}"`).join("; ")}.
          </div>)}

        <Group title="My actions" items={res.actions} set={(v) => setRes({ ...res, actions: v })} data={data}
          render={(x, upd) => (<>
            <input className="input" style={{ fontWeight: 600 }} value={x.title || ""} onChange={(e) => upd("title", e.target.value)} />
            <div className="minirow">
              <select className="select sm" value={x.priority || "P3"} onChange={(e) => upd("priority", e.target.value)}>{PRIORITIES.map((p) => <option key={p} value={p}>{p} {PRIO_LABEL[p]}</option>)}</select>
              <input type="date" className="input sm" value={x.due || ""} onChange={(e) => upd("due", e.target.value)} />
              {x.project && <span className="chip">{x.project}</span>}
              {(x.contexts || []).map((c) => <span key={c} className="chip ctx">{c}</span>)}
              {x.confidence === "low" && <span className="chip wait">inferred — check</span>}
            </div>
          </>)} />

        <Group title="Waiting on others" items={res.waiting} set={(v) => setRes({ ...res, waiting: v })} data={data}
          render={(x, upd) => (<>
            <input className="input" style={{ fontWeight: 600 }} value={x.title || ""} onChange={(e) => upd("title", e.target.value)} />
            <div className="minirow">
              <input className="input sm" list="cap-people" placeholder="who?" value={x.person || ""} onChange={(e) => upd("person", e.target.value)} />
              <select className="select sm" value={x.priority || "P3"} onChange={(e) => upd("priority", e.target.value)}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
              <input type="date" className="input sm" value={x.due || ""} onChange={(e) => upd("due", e.target.value)} />
              {x.confidence === "low" && <span className="chip wait">inferred — check</span>}
            </div>
          </>)} />

        <Group title="Decisions" items={res.decisions} set={(v) => setRes({ ...res, decisions: v })} data={data}
          render={(x, upd) => (<>
            <input className="input" style={{ fontWeight: 600 }} value={x.title || x.what || ""} onChange={(e) => upd("title", e.target.value)} />
            <div className="minirow">
              <span className="chip">{x.status || "Required"}</span>
              {x.who && <span className="chip">{x.who}</span>}
              {x.rationale && <span className="sub" style={{ margin: 0 }}>{x.rationale}</span>}
            </div>
          </>)} />

        <Group title="Risks and issues" items={res.risks} set={(v) => setRes({ ...res, risks: v })} data={data}
          render={(x, upd) => (<>
            <input className="input" style={{ fontWeight: 600 }} value={x.title || ""} onChange={(e) => upd("title", e.target.value)} />
            <div className="minirow">
              <select className="select sm" value={x.priority || "P3"} onChange={(e) => upd("priority", e.target.value)}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
              {x.mitigation && <span className="sub" style={{ margin: 0 }}>Mitigation: {x.mitigation}</span>}
            </div>
          </>)} />

        <Group title="Dates spotted" items={res.dates} set={(v) => setRes({ ...res, dates: v })} data={data}
          hint="Not ticked by default — tick anything worth tracking as a milestone."
          render={(x, upd) => (<>
            <input className="input" style={{ fontWeight: 600 }} value={x.what || ""} onChange={(e) => upd("what", e.target.value)} />
            <div className="minirow">
              <input type="date" className="input sm" value={x.date || ""} onChange={(e) => upd("date", e.target.value)} />
              {x.who && <span className="chip">{x.who}</span>}
            </div>
          </>)} />

        <Group title="People mentioned" items={res.people} set={(v) => setRes({ ...res, people: v })} data={data}
          hint="New names only — anyone already on your People list is left alone."
          render={(x, upd) => (<>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" style={{ fontWeight: 600 }} value={x.name || ""} onChange={(e) => upd("name", e.target.value)} />
              <input className="input" placeholder="role" value={x.role || ""} onChange={(e) => upd("role", e.target.value)} />
            </div>
            {x.why && <div className="sub" style={{ margin: "4px 0 0" }}>{x.why}</div>}
          </>)} />

        <Group title="Worth remembering" items={res.facts} set={(v) => setRes({ ...res, facts: v })} data={data}
          hint="Saved to your standing brief, so future captures already know it."
          render={(x, upd) => <input className="input" value={x.text || ""} onChange={(e) => upd("text", e.target.value)} />} />

        <datalist id="cap-people">{data.people.map((p) => <option key={p.id} value={p.name} />)}</datalist>

        <div className="savebar">
          <button className="btn pri" disabled={!picked} onClick={approve}>
            Save {picked} record{picked === 1 ? "" : "s"}
            {totals && (totals.actions || totals.waiting) ? ` — ${totals.actions} mine, ${totals.waiting} waiting` : ""}
          </button>
          <button className="btn" onClick={async () => { if (await askConfirm("Discard this read? The text stays in the box.")) setRes(null); }}>Discard</button>
        </div>
      </>}

      <div className="h2">Unprocessed inbox ({inbox.length})</div>
      {inbox.some((w) => daysSince(w.created) > 7) && <div className="warnbox">Some inbox items have sat for more than 7 days.</div>}
      {!inbox.length && <Empty>Inbox clear.</Empty>}
      {inbox.map((w) => (
        <div key={w.id} className="checkline" style={{ cursor: "pointer" }} onClick={() => openItem(w)}>
          <Badge p={w.priority} /><span style={{ flex: 1 }}>{w.title}</span>
          <span className="chip">{daysSince(w.created)}d old</span>
        </div>))}
    </div>
  );
}

/* A group of proposals: collapsible, tick-all, and compact rows. The old
   screen showed ten dropdowns per record; almost all of them were blank
   and none of them were the thing being decided. */
function Group({ title, items, set, render, hint }) {
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  const sel = items.filter((x) => x._sel).length;
  const upd = (id) => (k, v) => set(items.map((x) => (x._id === id ? { ...x, [k]: v } : x)));
  return (
    <div className="pgroup">
      <div className="pghead" onClick={() => setOpen((v) => !v)}>
        <span className="pgtitle">{title}</span>
        <span className="chip">{sel} of {items.length}</span>
        <button className="btn sm" onClick={(e) => { e.stopPropagation(); set(items.map((x) => ({ ...x, _sel: sel !== items.length }))); }}>
          {sel === items.length ? "Untick all" : "Tick all"}
        </button>
        <span className="pgchev">{open ? "▲" : "▼"}</span>
      </div>
      {hint && open && <div className="sub" style={{ margin: "0 0 6px" }}>{hint}</div>}
      {open && items.map((x) => (
        <div key={x._id} className={"prow" + (x._sel ? " on" : "")}>
          <input type="checkbox" checked={x._sel} onChange={() => upd(x._id)("_sel", !x._sel)} />
          <div style={{ flex: 1, minWidth: 0 }}>{render(x, upd(x._id))}</div>
          <span className="linkish" onClick={() => set(items.filter((y) => y._id !== x._id))}>drop</span>
        </div>))}
    </div>
  );
}

/* One place that knows the shape of a work item, so a field added to the
   model does not have to be remembered in six call sites. */
export function blankItem(d, over) {
  return {
    id: uid(), title: "", description: "", type: "Action", status: "Planned", mode: "Action",
    priority: "P3", owner: d.settings.displayName || "Me", waitingOn: "", project: "", mob: "",
    contexts: [...(d.settings.defaultContexts || [])],
    due: "", nextChase: "", lastChased: "", completed: "", archivedAt: "", created: todayISO(), updatedAt: todayISO(),
    rag: "", nextAction: "", blocker: "", focus: false, estimate: "",
    subtasks: [], source: null, personId: "",
    flags: { board: false, coo: false, news: false, groupWeekly: false, ukWeekly: false },
    confidentiality: "Internal", notes: [], extra: {}, outcome: "", ...over,
  };
}
