/**
 * Balanced Scorecard workbook parser.
 *
 * Understands the CMAC scorecard layout: one sheet per entity (Group
 * Operations, UK Ops, countries…), category header rows, then per measure a
 * "current year" row (name | — | target | Jan..Dec) followed by an unnamed
 * prior-year comparison row. Deterministic — no AI involved — so imported
 * numbers are exactly the workbook's numbers.
 */
import * as XLSX from "xlsx";

const uid = () => Math.random().toString(36).slice(2, 10);

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && isFinite(v)) return v;
  let s = String(v).trim();
  const negParen = /^\(.*\)$/.test(s); // accounting-style negative: (1,234)
  s = s.replace(/[£$,%\s]/g, "").replace(/[()—–]/g, "");
  if (s === "" || s === "-" || /^n\/?a$/i.test(s)) return null;
  let n = Number(s);
  if (!isFinite(n)) return null;
  if (negParen && n > 0) n = -n;
  return n;
};

/* Infer how a metric behaves from its name, target and values. */
function inferMeta(name, target, values) {
  const n = name.toLowerCase();
  const nums = values.filter((v) => v !== null);
  const fractional = nums.length > 0 && nums.every((v) => v >= 0 && v <= 1.5) && (target === null || target <= 1.5);
  const unit = /per booking/.test(n) ? "gbp2"
    : (/%|rate|answered|response \(|automated|assigned|no touch|tracking|creation/.test(n) && fractional) ? "pct"
    : /\(£\)|£|spend|opex|revenue|cost of sale|profit \(£|margin \(£/.test(n) && !/%/.test(n) ? "gbp"
    : /\(sec|\(min|time/.test(n) ? "sec"
    : "num";
  const agg = unit === "pct" || unit === "sec" || unit === "gbp2" || /^avg|average/.test(n) ? "avg" : "sum";
  const lowerBetter = /cost|wait|handling|>\s*180|over ?time|turnover|spend|leaver|transfer|opex|touch point|manual tracking|queue|abandon|complaint|breach|error rate/.test(n);
  return { unit, agg, dir: lowerBetter ? "low" : "high" };
}

/* The workbook's Guidance Page: Area | Metric | Definition rows become the
   in-app methodology reference. */
function parseGuidance(rows) {
  let hi = -1, aCol = -1, mCol = -1, dCol = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const ai = r.findIndex((c) => String(c || "").trim().toLowerCase() === "area");
    const mi = r.findIndex((c) => String(c || "").trim().toLowerCase() === "metric");
    if (ai !== -1 && mi !== -1) {
      hi = i; aCol = ai; mCol = mi;
      const di = r.findIndex((c) => /definition|guidance/i.test(String(c || "")));
      dCol = di !== -1 ? di : Math.max(ai, mi) + 1;
      break;
    }
  }
  if (hi === -1) return null;
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const area = String(r[aCol] || "").trim(), metric = String(r[mCol] || "").trim(), text = String(r[dCol] || "").trim();
    if (metric && text) out.push({ area, metric, text });
  }
  return out.length ? out : null;
}

export function parseScorecardWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const entities = [];
  const warnings = [];
  let guidance = [];
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
    const cellStr = (r, i) => (r && r[i] !== null && r[i] !== undefined ? String(r[i]).trim() : "");
    // Self-locate the layout from the first "Month … Target … Jan" header row —
    // sheets can start at any column, so never assume fixed positions.
    let nameCol = -1, targetCol = -1, monthCol = -1;
    for (const r of rows) {
      if (!r) continue;
      const mi = r.findIndex((c) => String(c || "").trim().toLowerCase() === "month");
      const ti = r.findIndex((c) => String(c || "").trim().toLowerCase() === "target");
      if (mi !== -1 && ti !== -1 && ti > mi) {
        const ji = r.findIndex((c) => String(c || "").trim().toLowerCase() === "jan");
        nameCol = mi; targetCol = ti; monthCol = ji !== -1 ? ji : ti + 1;
        break;
      }
    }
    const categories = [];
    if (nameCol !== -1) {
      let current = null;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || [];
        const a = cellStr(r, nameCol);
        if (!a || a.toLowerCase() === "month") continue;
        const next = rows[i + 1] || [];
        if (cellStr(next, nameCol).toLowerCase() === "month") {
          // category header (the sheet title is not followed by a Month row)
          current = { name: a, metrics: [] };
          categories.push(current);
          continue;
        }
        if (!current) continue;
        const target = num(r[targetCol]);
        const cur = []; for (let m = 0; m < 12; m++) cur.push(num(r[monthCol + m]));
        const below = rows[i + 1] || [];
        let prev = null;
        if (!cellStr(below, nameCol)) {
          const p = []; let any = false;
          for (let m = 0; m < 12; m++) { const v = num(below[monthCol + m]); p.push(v); if (v !== null) any = true; }
          if (any) { prev = p; i++; }
        }
        if (cur.every((v) => v === null) && !prev) continue;
        const meta = inferMeta(a, target, cur);
        current.metrics.push({ id: uid(), name: a, target, cur, prev, ...meta });
      }
    }
    const total = categories.reduce((s, c) => s + c.metrics.length, 0);
    if (total > 0) entities.push({ id: uid(), name: sheetName, categories });
    else {
      const g = parseGuidance(rows);
      if (g) guidance = guidance.concat(g);
      else if (!/guidance/i.test(sheetName)) warnings.push(`Sheet "${sheetName}" had no recognisable scorecard rows — skipped.`);
    }
  }
  if (!entities.length) throw new Error("No scorecard structure recognised in this workbook. Expected category headers with Month/Target rows like the Balanced Scorecard template.");
  return { entities, guidance, warnings };
}

