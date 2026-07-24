/**
 * Balanced Scorecard display & calculation helpers (no xlsx dependency —
 * the workbook parser lives in bscParse.js and is loaded on demand).
 */
/* ---- shared display / calculation helpers ---- */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ytd(metric) {
  const vals = (metric.cur || []).filter((v) => v !== null);
  if (!vals.length) return null;
  const s = vals.reduce((a, b) => a + b, 0);
  return metric.agg === "avg" ? s / vals.length : s;
}

export function lastIdx(metric) {
  let idx = -1;
  (metric.cur || []).forEach((v, i) => { if (v !== null) idx = i; });
  return idx;
}

/* RAG vs target: green = meets, amber = within 7.5%, red = worse. */
export function ragFor(metric, value) {
  if (metric.target === null || metric.target === undefined || value === null || value === undefined) return "";
  const t = metric.target;
  const good = metric.dir === "low" ? value <= t : value >= t;
  if (good) return "G";
  const rel = t === 0 ? 1 : Math.abs(value - t) / Math.abs(t);
  return rel <= 0.075 ? "A" : "R";
}

export function fmtVal(metric, v, compact) {
  if (v === null || v === undefined) return "—";
  if (metric.unit === "pct") return (v * 100).toFixed(v * 100 >= 100 ? 0 : 2).replace(/\.00$/, "") + "%";
  if (metric.unit === "gbp") return "£" + (compact && Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.round(v).toLocaleString("en-GB"));
  if (metric.unit === "gbp2") return "£" + v.toFixed(2);
  if (metric.unit === "sec") return String(Math.round(v));
  return Math.round(v).toLocaleString("en-GB");
}
