/* ============================================================
   Shared interface atoms.

   These were inside App.jsx. They moved out so the screens added in
   v2 — Portfolio, People, Contexts, OKRs, Meetings — can use them
   without importing App and creating a cycle. Nothing here knows
   anything about the data model beyond the priority labels.
   ============================================================ */
import React, { useState, useEffect, useRef, useMemo } from "react";
import { PRIO_LABEL, PRIO_HINT } from "./lib/model";

export const fmtD = (s) => { if (!s) return "—"; const p = String(s).slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };

/* P1-P5. The number is what gets scanned; the word behind it is the
   tooltip, so the scale never has to be held in memory. */
export const Badge = ({ p }) => {
  const cls = { P1: "bg-crit", P2: "bg-high", P3: "bg-med", P4: "bg-low", P5: "bg-park" }[p] || "bg-park";
  return <span className={"badge " + cls} title={PRIO_LABEL[p] ? `${PRIO_LABEL[p]} — ${PRIO_HINT[p]}` : ""}>{p || "—"}</span>;
};
export const Rag = ({ v }) => <span className={"rag " + (v === "Red" ? "R" : v === "Amber" ? "A" : v === "Green" ? "G" : "N")} title={v || "No RAG"} />;
export const Stat = ({ n, l, tone, onClick }) => (
  <div className="stat" onClick={onClick} role="button" tabIndex={0}
    onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && onClick) { e.preventDefault(); onClick(); } }}>
    <div className={"n" + (tone ? " " + tone : "")}>{n}</div>
    <div className="l">{l}</div>
  </div>
);
export const F = ({ label, children, span }) => (
  <div style={span ? { gridColumn: "1 / -1" } : null}>
    <label className="flab">{label}</label>
    {children}
  </div>
);

export function useSortable(rows, initKey) {
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

export function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
  const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
  return Promise.resolve();
}
export function downloadFile(name, text, type) {
  const blob = new Blob([text], { type: type || "text/plain" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
export function toCSV(rows, cols) {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.map((c) => esc(c[0])).join(",")].concat(rows.map((r) => cols.map((c) => esc(typeof c[1] === "function" ? c[1](r) : r[c[1]])).join(","))).join("\n");
}

/* ---------- in-app confirm / prompt ----------
   Native dialogs are dropped in sandboxed frames, so the app supplies
   its own and App registers the renderer at mount. */
let _askFn = null;
export function registerAsk(fn) { _askFn = fn; }
export function askConfirm(message) {
  if (_askFn) return _askFn({ kind: "confirm", message });
  return Promise.resolve(window.confirm(message));
}
export function askPrompt(message) {
  if (_askFn) return _askFn({ kind: "prompt", message });
  return Promise.resolve(window.prompt(message));
}
export function askInfo(message) {
  if (_askFn) return _askFn({ kind: "info", message });
  try { window.alert(message); } catch (e) { /* ignore */ }
  return Promise.resolve(true);
}

/* Escape-to-close for any modal. Open dialogs register on a stack; Escape
   only ever closes the TOP one, so cancelling a confirm that sits over an
   edit modal never also discards the modal (and the unsaved work) beneath it. */
const _escStack = [];
export function useEscape(onClose, active = true) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!active) return;
    const entry = {};
    _escStack.push(entry);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (_escStack[_escStack.length - 1] !== entry) return; // a dialog above us owns Escape
      ref.current && ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      const i = _escStack.indexOf(entry);
      if (i !== -1) _escStack.splice(i, 1);
      window.removeEventListener("keydown", onKey);
    };
  }, [active]);
}

export function AskDialog({ req, onResolve }) {
  const [val, setVal] = useState("");
  useEffect(() => { setVal(""); }, [req]);
  useEscape(() => onResolve(req.kind === "prompt" ? null : req.kind === "info" ? true : false), !!req);
  if (!req) return null;
  const isPrompt = req.kind === "prompt";
  const isInfo = req.kind === "info";
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" style={{ zIndex: 90, alignItems: "center" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onResolve(isPrompt ? null : isInfo ? true : false); }}>
      <div className="modal narrow" style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 12, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{req.message}</div>
        {isPrompt && <input className="input" autoFocus value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onResolve(val); }} />}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          {!isInfo && <button className="btn" onClick={() => onResolve(isPrompt ? null : false)}>Cancel</button>}
          <button className="btn pri" autoFocus={!isPrompt} onClick={() => onResolve(isPrompt ? val : true)}>{isPrompt ? "Save" : isInfo ? "OK" : "Yes, continue"}</button>
        </div>
      </div>
    </div>
  );
}

/* A small empty state that says what to do next rather than just
   reporting that there is nothing — the screen is never a dead end. */
export const Empty = ({ children }) => <div className="emptyst">{children}</div>;
