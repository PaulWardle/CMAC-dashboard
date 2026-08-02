import { supabase } from "./supabase";

/**
 * Persistence adapter — the single seam between the app and where its data
 * lives. The app only ever calls `store.load()` and `store.save(data, rev)`.
 *
 * Cloud mode (Supabase configured + signed in):
 *   the whole team shares ONE workspace document (public.shared_workspace,
 *   row id 'main'). RLS lets approved accounts read it and editors/admins
 *   write it. A copy is mirrored to localStorage — written BEFORE the network
 *   call so a tab closing mid-save loses nothing — and tagged with a scope so
 *   a mirror from local mode can never masquerade as the cloud document.
 *
 * Local mode (no Supabase configured):
 *   data lives in this browser's localStorage only.
 */
const APP_KEY = "cmac-occ-v1";
const SCOPE_KEY = "cmac-occ-v1-scope";   // "cloud" | "local" — the mirror's lineage
const DIRTY_KEY = "cmac-occ-v1-dirty";   // "1" when the mirror holds edits the cloud hasn't
const TABLE = "shared_workspace";
const ROW_ID = "main";

async function hasSession() {
  if (!supabase) return false;
  const { data } = await supabase.auth.getUser();
  return !!data?.user;
}

function readLocal() {
  try {
    const raw = localStorage.getItem(APP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readScope() {
  try { return localStorage.getItem(SCOPE_KEY) || ""; } catch { return ""; }
}

function writeLocal(data, scope) {
  try {
    localStorage.setItem(APP_KEY, JSON.stringify(data));
    if (scope) localStorage.setItem(SCOPE_KEY, scope);
    return true;
  } catch {
    return false;
  }
}

function setDirty(on) {
  try { on ? localStorage.setItem(DIRTY_KEY, "1") : localStorage.removeItem(DIRTY_KEY); } catch { /* ignore */ }
}

function isDirty() {
  try { return localStorage.getItem(DIRTY_KEY) === "1"; } catch { return false; }
}

/* Create the row if missing, or upgrade a legacy/empty document; an existing
   revisioned document is NEVER blind-overwritten — the caller gets it back as
   a conflict instead. Handles two devices racing the first insert: the loser
   re-reads and adopts the winner's document. */
async function saveUnguarded(payload) {
  const { data: cur } = await supabase.from(TABLE).select("data").eq("id", ROW_ID).maybeSingle();
  if (!cur) {
    const { error } = await supabase.from(TABLE).insert({ id: ROW_ID, ...payload });
    if (!error) return { cloudOk: true, remote: null };
    // Insert race: someone else created the row first — adopt theirs.
    const { data: cur2 } = await supabase.from(TABLE).select("data").eq("id", ROW_ID).maybeSingle();
    return cur2 && cur2.data ? { cloudOk: false, remote: cur2.data } : { cloudOk: false, remote: null };
  }
  if (!cur.data || cur.data.rev == null) {
    const { error } = await supabase.from(TABLE).update(payload).eq("id", ROW_ID);
    return { cloudOk: !error, remote: null };
  }
  return { cloudOk: false, remote: cur.data };
}

export const store = {
  available: true,
  mode: supabase ? "cloud" : "local",

  /**
   * Load the newest known copy. Returns { ok, doc, cloudRev }.
   *  - ok=false: the cloud read FAILED (doc is this device's cloud-scoped
   *    mirror, maybe null). Callers must never seed-and-save in that state.
   *  - cloudRev: the rev actually stored in the cloud (null if unknown), so
   *    saves stay guarded even when the mirror is ahead of the cloud.
   *  A mirror only ever beats the cloud when it shares the cloud lineage AND
   *  is flagged dirty (a save that never made it out) — a local-mode document
   *  or a stale copy can never hijack the shared workspace.
   */
  async load() {
    if (supabase && (await hasSession())) {
      const cloudMirror = readScope() === "cloud" ? readLocal() : null;
      const { data, error } = await supabase.from(TABLE).select("data").eq("id", ROW_ID).maybeSingle();
      if (error) return { ok: false, doc: cloudMirror, cloudRev: null };
      const cloud = data ? data.data : null;
      const doc = cloudMirror && isDirty() && (cloudMirror.rev || 0) > ((cloud && cloud.rev) || 0) ? cloudMirror : cloud;
      return { ok: true, doc, cloudRev: cloud ? cloud.rev || 0 : null };
    }
    return { ok: true, doc: readScope() === "cloud" ? null : readLocal(), cloudRev: null };
  },

  /**
   * Save-as-you-go with optimistic concurrency. The update only applies if
   * the stored rev still matches `expectedRev`; on a mismatch nothing is
   * overwritten and { conflict, remote } is returned. `cloudOk` reports the
   * CLOUD write truthfully; `signedOut` means nothing was written anywhere
   * (a cloud-mode save after the session ended must not touch the mirror).
   */
  async save(data, expectedRev) {
    if (supabase) {
      if (!(await hasSession())) return { ok: false, cloudOk: false, conflict: false, signedOut: true };
      // Mirror first — a tab closing during the network call loses nothing.
      const localOk = writeLocal(data, "cloud");
      setDirty(true);
      const payload = { data, updated_at: new Date().toISOString() };
      let cloudOk = false;
      let remote = null;
      if (expectedRev != null) {
        const { data: rows, error } = await supabase.from(TABLE).update(payload)
          .eq("id", ROW_ID).eq("data->>rev", String(expectedRev)).select("id");
        if (!error && rows && rows.length) cloudOk = true;
        else if (!error) ({ cloudOk, remote } = await saveUnguarded(payload));
      } else {
        ({ cloudOk, remote } = await saveUnguarded(payload));
      }
      if (remote) {
        writeLocal(remote, "cloud"); // the winning version is now this device's baseline
        setDirty(false);
        return { ok: false, cloudOk: false, conflict: true, remote };
      }
      if (cloudOk) setDirty(false);
      return { ok: cloudOk || localOk, cloudOk, conflict: false };
    }
    const localOk = writeLocal(data, "local");
    return { ok: localOk, cloudOk: localOk, conflict: false };
  },

  /* Synchronous local mirror — for pagehide flushes while signed in. */
  mirror(data) {
    const ok = writeLocal(data, this.mode === "cloud" ? "cloud" : "local");
    if (ok && this.mode === "cloud") setDirty(true);
    return ok;
  },

  /* Sign-out hygiene: clear this device's copy — unless it still holds edits
     the cloud never received, in which case keep it so the next sign-in can
     reconcile them upward instead of losing them. */
  clearLocal() {
    try {
      if (isDirty()) return; // unsynced work stays for the next session to push
      localStorage.removeItem(APP_KEY);
      localStorage.removeItem(SCOPE_KEY);
      localStorage.removeItem(DIRTY_KEY);
    } catch { /* ignore */ }
  },
};
