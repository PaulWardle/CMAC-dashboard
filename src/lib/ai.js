/**
 * AI model selection, pricing and the spend meter.
 *
 * One place decides which model answers which kind of request, what it costs,
 * and how much has been spent — so the running total in Settings is computed
 * from the same numbers the requests are actually billed at.
 *
 * Prices are US dollars per million tokens, as published by Anthropic.
 * Cached input is billed at 1.25x the input rate when it is WRITTEN to the
 * cache and 0.1x when it is READ back, which is where most of the saving on
 * the assistant comes from.
 */
export const MODELS = {
  "claude-opus-5": { label: "Opus 5 — deepest reasoning", in: 5, out: 25 },
  "claude-sonnet-5": { label: "Sonnet 5 — fast and capable", in: 2, out: 10 },
  "claude-haiku-4-5": { label: "Haiku 4.5 — cheapest", in: 1, out: 5 },
};
export const DEFAULT_MODEL = "claude-sonnet-5";

/* Three quality settings. Each maps the three job sizes the app asks for —
   `light` (tidy a few lines), `standard` (chat, questions, triage) and
   `deep` (high-stakes judgement) — onto a model. */
export const QUALITY = {
  economy: { label: "Economy", blurb: "Cheapest. Good for everyday logging and questions.", light: "claude-haiku-4-5", standard: "claude-haiku-4-5", deep: "claude-sonnet-5" },
  balanced: { label: "Balanced", blurb: "Recommended. Fast models for chat, the best model for board-sensitive checks.", light: "claude-haiku-4-5", standard: "claude-sonnet-5", deep: "claude-opus-5" },
  maximum: { label: "Maximum", blurb: "Best model almost everywhere. Noticeably more expensive.", light: "claude-sonnet-5", standard: "claude-opus-5", deep: "claude-opus-5" },
};
export const DEFAULT_QUALITY = "balanced";

export function modelFor(quality, job) {
  const q = QUALITY[quality] || QUALITY[DEFAULT_QUALITY];
  return q[job] || q.standard || DEFAULT_MODEL;
}

/* ---------- spend meter ----------
   Usage is recorded per device in localStorage rather than in the shared
   workspace: every AI call would otherwise bump the document revision and
   trigger a cloud write, which costs more than it measures. */
const METER_KEY = "cmac-occ-v1-usage";

export function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function readMeter() {
  try {
    const raw = localStorage.getItem(METER_KEY);
    const m = raw ? JSON.parse(raw) : null;
    if (!m || m.month !== thisMonth()) return { month: thisMonth(), calls: 0, models: {} };
    return m;
  } catch {
    return { month: thisMonth(), calls: 0, models: {} };
  }
}

/** Add one call's usage to this month's tally. `usage` is the Anthropic
 *  usage object: input_tokens, output_tokens, cache_creation_input_tokens,
 *  cache_read_input_tokens. Unknown models are still counted (at zero cost)
 *  so the call count never silently under-reports. */
export function recordUsage(model, usage) {
  if (!usage) return;
  try {
    const m = readMeter();
    const e = m.models[model] || { in: 0, out: 0, cacheWrite: 0, cacheRead: 0, calls: 0 };
    e.in += usage.input_tokens || 0;
    e.out += usage.output_tokens || 0;
    e.cacheWrite += usage.cache_creation_input_tokens || 0;
    e.cacheRead += usage.cache_read_input_tokens || 0;
    e.calls += 1;
    m.models[model] = e;
    m.calls = (m.calls || 0) + 1;
    localStorage.setItem(METER_KEY, JSON.stringify(m));
  } catch { /* storage full or blocked — the meter is not worth failing a call over */ }
}

export function resetMeter() {
  try { localStorage.removeItem(METER_KEY); } catch { /* ignore */ }
}

/** Dollar cost of one model's tallied usage. */
export function costOf(model, e) {
  const p = MODELS[model];
  if (!p || !e) return 0;
  return ((e.in || 0) * p.in
    + (e.cacheWrite || 0) * p.in * 1.25
    + (e.cacheRead || 0) * p.in * 0.1
    + (e.out || 0) * p.out) / 1e6;
}

/** Total spend this month, plus the cache saving it avoided. */
export function meterTotals(m) {
  const meter = m || readMeter();
  let cost = 0, saved = 0, tokens = 0;
  Object.entries(meter.models || {}).forEach(([model, e]) => {
    cost += costOf(model, e);
    const p = MODELS[model];
    // What the cache-read tokens WOULD have cost at the full input rate.
    if (p) saved += ((e.cacheRead || 0) * p.in * 0.9) / 1e6;
    tokens += (e.in || 0) + (e.cacheWrite || 0) + (e.cacheRead || 0) + (e.out || 0);
  });
  return { cost, saved, tokens, calls: meter.calls || 0, month: meter.month };
}

export const fmtUsd = (n) => (n < 0.01 && n > 0 ? "<$0.01" : "$" + n.toFixed(2));
