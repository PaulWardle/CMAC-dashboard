/* ============================================================
   Talking to Claude.

   Moved out of App.jsx so the screens that need it — Capture,
   Meetings, Ask — can call it without importing App.
   ============================================================ */
import { supabase } from "./supabase";
import { QUALITY, DEFAULT_QUALITY, modelFor, recordUsage } from "./ai";

/* ---------- AI helper (via the /api/ai server proxy) ---------- */
/* Forgiving JSON extraction for model output: strips fences and prose,
   fixes trailing commas and stray control characters, and — if the reply was
   cut off mid-structure — drops the dangling element and closes the brackets
   so every complete record still comes through. */
export function parseJsonLoose(text) {
  let s = String(text || "").replace(/```json|```/g, "").trim();
  const firstObj = s.indexOf("{"), firstArr = s.indexOf("[");
  const from = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (from === -1) throw new Error("The AI reply contained no JSON.");
  s = s.slice(from);
  const lastClose = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (lastClose !== -1) s = s.slice(0, lastClose + 1);
  const deComma = (x) => x.replace(/,\s*([}\]])/g, "$1");
  const deCtrl = (x) => x.replace(/[\u0000-\u001f]+/g, " ");
  const attempts = [s, deComma(s), deComma(deCtrl(s))];
  // Truncation repair: scan outside strings, find the last completed element,
  // cut there and close whatever brackets remain open.
  const scan = (str) => {
    const stack = []; let inStr = false, esc = false, lastSafe = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") stack.push("}");
      else if (ch === "[") stack.push("]");
      else if (ch === "}" || ch === "]") { stack.pop(); lastSafe = i + 1; }
    }
    return { open: stack.length > 0, lastSafe };
  };
  const info = scan(s);
  if (info.open && info.lastSafe > 0) {
    const cut = s.slice(0, info.lastSafe).replace(/,\s*$/, "");
    const st = []; let inS = false, e = false;
    for (const ch of cut) {
      if (inS) { if (e) e = false; else if (ch === "\\") e = true; else if (ch === '"') inS = false; continue; }
      if (ch === '"') inS = true;
      else if (ch === "{") st.push("}");
      else if (ch === "[") st.push("]");
      else if (ch === "}" || ch === "]") st.pop();
    }
    const closed = cut + st.reverse().join("");
    attempts.push(closed, deComma(deCtrl(closed)));
  }
  let lastErr;
  for (const a of attempts) { try { return JSON.parse(a); } catch (err) { lastErr = err; } }
  throw new Error("The AI reply was not valid JSON (" + (lastErr?.message || "parse failed") + ") — try again, or split very large dumps.");
}

/* The production AI proxy requires a signed-in user — attach the caller's
   Supabase session token to every AI request. */
async function aiHeaders() {
  const h = { "Content-Type": "application/json" };
  try {
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) h.Authorization = "Bearer " + data.session.access_token;
    }
  } catch (e) { /* local mode / no session */ }
  return h;
}

/* Which models this workspace is set to use. The AI helpers are module-level
   while the setting lives in the document, so App keeps this in step. */
let _aiQuality = DEFAULT_QUALITY;
export function setAiQuality(q) { _aiQuality = QUALITY[q] ? q : DEFAULT_QUALITY; }

/**
 * One-shot (non-streaming) request. `job` sizes the work so the right model
 * answers it: "light" for mechanical rewriting, "standard" for questions and
 * triage, "deep" for judgement calls that reach the board.
 */
export async function askClaude(prompt, expectJson = false, maxTokens = 1000, job = "standard") {
  const model = modelFor(_aiQuality, job);
  const call = async (mt) => {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: await aiHeaders(),
      body: JSON.stringify({ model, max_tokens: mt, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error || ""; } catch (e) {}
      throw new Error(detail || ("AI service unavailable (" + res.status + ")"));
    }
    const d = await res.json();
    if (d.error) throw new Error(typeof d.error === "string" ? d.error : (d.error.message || "AI error"));
    recordUsage(d.model || model, d.usage);
    return d;
  };
  let d = await call(maxTokens);
  // If the answer hit the token ceiling mid-JSON, retry once with headroom.
  if (expectJson && d.stop_reason === "max_tokens" && maxTokens < 12000) d = await call(Math.min(maxTokens * 2, 12000));
  const text = (d.content || []).map((c) => (c.type === "text" ? c.text : "")).join("");
  if (!expectJson) return text;
  return parseJsonLoose(text);
}

/**
 * Streaming Claude call for the live assistant. Sends {system, messages,
 * tools} to /api/ai with stream:true and parses the SSE stream, invoking
 * onDelta(textSoFar) as tokens arrive. Returns the final assistant content
 * blocks (text + tool_use) and the stop reason.
 */
export async function streamClaude({ system, messages, tools, maxTokens = 1600, onDelta, job = "standard" }) {
  const model = modelFor(_aiQuality, job);
  // Mark the workspace brief as cacheable. It is the largest and most-repeated
  // part of every assistant request, so caching it turns a multi-round reply
  // from "re-bill the whole brief each round" into one write and cheap reads.
  const sys = system ? [{ type: "text", text: String(system), cache_control: { type: "ephemeral" } }] : undefined;
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: await aiHeaders(),
    body: JSON.stringify({ stream: true, model, system: sys, messages, tools, max_tokens: maxTokens }),
  });
  if (!res.ok || !res.body) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch (e) {}
    throw new Error(detail || ("AI service unavailable (" + res.status + ")"));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const content = [];
  const jsonAcc = {};
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let stop = null;
  const textSoFar = () => content.filter((c) => c && c.type === "text").map((c) => c.text).join("");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let ev;
      try { ev = JSON.parse(dataLine.slice(5).trim()); } catch (e) { continue; }
      if (ev.type === "content_block_start") {
        const b = ev.content_block || {};
        content[ev.index] = b.type === "text" ? { type: "text", text: b.text || "" } : { type: "tool_use", id: b.id, name: b.name, input: b.input || {} };
        jsonAcc[ev.index] = "";
      } else if (ev.type === "content_block_delta") {
        const c = content[ev.index];
        if (!c) continue;
        if (ev.delta?.type === "text_delta") { c.text += ev.delta.text; if (onDelta) onDelta(textSoFar()); }
        else if (ev.delta?.type === "input_json_delta") jsonAcc[ev.index] += ev.delta.partial_json || "";
      } else if (ev.type === "content_block_stop") {
        const c = content[ev.index];
        if (c && c.type === "tool_use" && jsonAcc[ev.index]) {
          try { c.input = JSON.parse(jsonAcc[ev.index]); } catch (e) { c.input = c.input || {}; }
        }
      } else if (ev.type === "message_start") {
        // Input and cache counts arrive here; output totals arrive at the end.
        const u = ev.message?.usage;
        if (u) { usage.input_tokens = u.input_tokens || 0; usage.cache_creation_input_tokens = u.cache_creation_input_tokens || 0; usage.cache_read_input_tokens = u.cache_read_input_tokens || 0; }
      } else if (ev.type === "message_delta") {
        stop = ev.delta?.stop_reason || stop;
        if (ev.usage?.output_tokens != null) usage.output_tokens = ev.usage.output_tokens;
      } else if (ev.type === "error") {
        throw new Error(ev.error?.message || "AI stream error");
      }
    }
  }
  recordUsage(model, usage);
  return { content: content.filter(Boolean), stop_reason: stop };
}
