import { supabase } from "./supabase";

/**
 * Persistence adapter — the single seam between the app and where its data
 * lives. The app only ever calls `store.load()` and `store.save(data, rev)`.
 *
 * Cloud mode (Supabase configured + signed in):
 *   the whole team shares ONE workspace document (public.shared_workspace,
 *   row id 'main'). Row Level Security lets approved accounts read it and
 *   editors/admins write it. A copy is mirrored to localStorage so the app
 *   opens instantly and survives a tab closing mid-save.
 *
 * Local mode (no Supabase configured):
 *   data lives in this browser's localStorage only.
 */
const APP_KEY = "cmac-occ-v1";
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

function writeLocal(data) {
  try {
    localStorage.setItem(APP_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/* Create the row if missing, or upgrade a legacy rev-less document; an
   existing revisioned document is NEVER blind-overwritten — the caller gets
   it back as a conflict instead. */
async function saveUnguarded(payload) {
  const { data: cur } = await supabase.from(TABLE).select("data").eq("id", ROW_ID).maybeSingle();
  if (!cur) {
    const { error } = await supabase.from(TABLE).insert({ id: ROW_ID, ...payload });
    return { cloudOk: !error, remote: null };
  }
  if (cur.data && cur.data.rev == null) {
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
   *  - ok=false: the cloud read FAILED (doc is the local mirror, maybe null).
   *    Callers must never seed-and-save over the cloud in that state.
   *  - cloudRev: the rev actually stored in the cloud (null if unknown/no row),
   *    so saves stay guarded even when the local mirror is ahead of the cloud
   *    (e.g. a tab closed before its debounced save reached Supabase).
   */
  async load() {
    if (supabase && (await hasSession())) {
      const { data, error } = await supabase.from(TABLE).select("data").eq("id", ROW_ID).maybeSingle();
      if (error) return { ok: false, doc: readLocal(), cloudRev: null };
      const cloud = data ? data.data : null;
      const mirror = readLocal();
      const doc = mirror && (mirror.rev || 0) > ((cloud && cloud.rev) || 0) ? mirror : cloud;
      return { ok: true, doc, cloudRev: cloud ? cloud.rev || 0 : null };
    }
    return { ok: true, doc: readLocal(), cloudRev: null };
  },

  /**
   * Save-as-you-go with optimistic concurrency. The update only applies if
   * the stored rev still matches `expectedRev`; on a mismatch nothing is
   * overwritten and { conflict, remote } is returned. `cloudOk` reports the
   * CLOUD write truthfully — a local-mirror-only save is not "saved".
   */
  async save(data, expectedRev) {
    let cloudOk = false;
    let remote = null;
    if (supabase && (await hasSession())) {
      const payload = { data, updated_at: new Date().toISOString() };
      if (expectedRev != null) {
        const { data: rows, error } = await supabase.from(TABLE).update(payload)
          .eq("id", ROW_ID).eq("data->>rev", String(expectedRev)).select("id");
        if (!error && rows && rows.length) cloudOk = true;
        else if (!error) ({ cloudOk, remote } = await saveUnguarded(payload));
      } else {
        ({ cloudOk, remote } = await saveUnguarded(payload));
      }
    }
    if (remote) {
      return { ok: false, cloudOk: false, conflict: true, remote };
    }
    const localOk = writeLocal(data);
    return { ok: supabase ? cloudOk || localOk : localOk, cloudOk: supabase ? cloudOk : localOk, conflict: false };
  },

  /* Synchronous local mirror — for pagehide flushes. */
  mirror(data) {
    return writeLocal(data);
  },

  /* Remove this device's copy (called on sign-out — shared machines). */
  clearLocal() {
    try { localStorage.removeItem(APP_KEY); } catch { /* ignore */ }
  },
};
