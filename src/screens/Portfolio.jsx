/* ============================================================
   Portfolio.

   Projects and mobilisations are different things and stay different
   records. They are not, however, different questions: "what is in
   flight, and what needs me?" spans both. This screen is the join,
   done in the view rather than by merging two schemas.

   Health is computed from facts the system already holds — overdue
   actions, blockers, days since anything moved, days to target — so it
   cannot go stale the way a RAG someone has to remember to update does.
   A manual override is honoured where judgement beats arithmetic.
   ============================================================ */
import React, { useState, useMemo } from "react";
import { Rag, Stat, Empty, fmtD } from "../ui";
import { portfolioAttention, ctxNames, daysUntil, isOpen, isOverdue, prioRank } from "../lib/model";

const SORTS = {
  "Needs me": (a, b) => b.h.score - a.h.score,
  "Target date": (a, b) => (a.target || "9999").localeCompare(b.target || "9999"),
  "Name": (a, b) => a.e.name.localeCompare(b.e.name),
  "Recently moved": (a, b) => (b.e.updatedAt || "").localeCompare(a.e.updatedAt || ""),
};

export default function Portfolio({ data, openProject, openMob, openItem }) {
  const [sort, setSort] = useState("Needs me");
  const [ctx, setCtx] = useState("");
  const [kind, setKind] = useState("All");
  const [showClosed, setShowClosed] = useState(false);

  const rows = useMemo(() => {
    const build = (e, k) => ({
      e, kind: k,
      h: portfolioAttention(data, e, k, data.settings),
      target: k === "mob" ? e.goLive : e.target,
    });
    let all = [
      ...data.projects.map((p) => build(p, "project")),
      ...data.mobs.map((m) => build(m, "mob")),
    ];
    if (!showClosed) all = all.filter((r) => !["Closed", "Cancelled"].includes(r.e.stage));
    if (kind !== "All") all = all.filter((r) => r.kind === (kind === "Projects" ? "project" : "mob"));
    if (ctx) all = all.filter((r) => (r.e.contexts || []).includes(ctx));
    return all.sort(SORTS[sort] || SORTS["Needs me"]);
  }, [data, sort, ctx, kind, showClosed]);

  const red = rows.filter((r) => r.h.rag === "Red").length;
  const amber = rows.filter((r) => r.h.rag === "Amber").length;
  const stalled = rows.filter((r) => r.h.stale !== null && r.h.stale > (data.settings.staleProject || 21)).length;
  const blocked = rows.filter((r) => r.e.blocked).length;

  return (
    <div>
      <h2 className="h1">Portfolio</h2>
      <p className="sub">Everything in flight, projects and mobilisations together, ordered by what most needs you. Health is calculated from overdue work, blockers, how long since anything moved and how close the target is — not from a colour anybody has to remember to set.</p>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", marginBottom: 12 }}>
        <Stat n={rows.length} l="In flight" />
        <Stat n={red} l="Needs intervention" tone={red ? "bad" : null} />
        <Stat n={amber} l="Watch" tone={amber ? "warn" : null} />
        <Stat n={blocked} l="Blocked" tone={blocked ? "bad" : null} />
        <Stat n={stalled} l="Stalled" tone={stalled ? "warn" : null} />
      </div>

      <div className="toolrow">
        {["All", "Projects", "Mobilisations"].map((k) => <button key={k} className={"btn sm" + (kind === k ? " pri" : "")} onClick={() => setKind(k)}>{k}</button>)}
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>{Object.keys(SORTS).map((s) => <option key={s}>Sort: {s}</option>)}</select>
        <select className="select" value={ctx} onChange={(e) => setCtx(e.target.value)}>
          <option value="">Context: all</option>
          {data.contexts.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Include closed
        </label>
      </div>

      {!rows.length && <Empty>Nothing in flight{ctx ? " in that context" : ""}. Add a project or a mobilisation and it will appear here.</Empty>}

      {rows.map(({ e, kind: k, h, target }) => {
        const left = target ? daysUntil(target) : null;
        return (
          <div key={k + e.id} className={"pfrow " + h.rag.toLowerCase()} onClick={() => (k === "project" ? openProject(e.id) : openMob(e.id))}>
            <div className="pfmain">
              <div className="pftop">
                <Rag v={h.rag} />
                <span className="pfname">{e.name}</span>
                <span className="chip">{k === "mob" ? "Mobilisation" : "Project"}</span>
                <span className="chip">{e.stage}</span>
                {e.blocked && <span className="chip blocked">blocked</span>}
                {ctxNames(data, e.contexts).map((c) => <span key={c} className="chip ctx">{c}</span>)}
              </div>
              {/* The reasons, in plain words. A health score you cannot
                  challenge is a health score you will not trust. */}
              <div className="pfwhy">
                {h.reasons.length ? h.reasons.join(" · ") : "Nothing outstanding"}
              </div>
            </div>
            <div className="pfnums">
              <div><b>{h.open}</b><i>open</i></div>
              <div className={h.overdue ? "bad" : ""}><b>{h.overdue}</b><i>overdue</i></div>
              <div>
                <b>{left === null ? "—" : left < 0 ? `${Math.abs(left)}d late` : `${left}d`}</b>
                <i>{k === "mob" ? "to go-live" : "to target"}</i>
              </div>
              <div><b>{e.owner || "—"}</b><i>owner</i></div>
            </div>
          </div>);
      })}

      <div className="h2">Cross-portfolio actions needing attention</div>
      <PortfolioActions data={data} openItem={openItem} ctx={ctx} />
    </div>
  );
}

/* The work underneath, not the containers — the items across every
   project and mobilisation that are overdue or blocked right now. */
function PortfolioActions({ data, openItem, ctx }) {
  const rows = data.workItems
    .filter((w) => isOpen(w) && (w.project || w.mob))
    .filter((w) => !ctx || (w.contexts || []).includes(ctx))
    .filter((w) => isOverdue(w) || w.status === "Blocked")
    .sort((a, b) => prioRank(a.priority) - prioRank(b.priority) || (a.due || "9999").localeCompare(b.due || "9999"))
    .slice(0, 30);
  if (!rows.length) return <Empty>No overdue or blocked work across the portfolio.</Empty>;
  const parent = (w) => (data.projects.find((p) => p.id === w.project) || data.mobs.find((m) => m.id === w.mob) || {}).name || "";
  return (
    <table className="tbl">
      <thead><tr><th>Item</th><th>Under</th><th>Owner</th><th>Due</th><th>Why</th></tr></thead>
      <tbody>
        {rows.map((w) => (
          <tr key={w.id} onClick={() => openItem(w)} style={{ cursor: "pointer" }}>
            <td>{w.title}</td>
            <td>{parent(w)}</td>
            <td>{w.mode === "Waiting on" ? `waiting on ${w.waitingOn || "?"}` : w.owner}</td>
            <td>{fmtD(w.due)}</td>
            <td>{w.status === "Blocked" ? (w.blocker || "blocked") : `${Math.abs(daysUntil(w.due))}d overdue`}</td>
          </tr>))}
      </tbody>
    </table>
  );
}
