import { supabase } from "./supabase";

/**
 * Persistence adapter — the single seam between the app and where its data
 * lives. The app only ever calls `store.load()` and `store.save(data)`.
 *
 * Cloud mode (Supabase configured + signed in):
 *   the whole team shares ONE workspace document (public.shared_workspace,
 *   row id 'main'). Row Level Security lets any @cmacgroup.com account read
 *   it, but only the administrator account(s) write to it. A copy is also
 *   mirrored to localStorage so the app opens instantly / offline.
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

export const store = {
  available: true,
  mode: supabase ? "cloud" : "local",

  async load() {
    if (supabase && (await hasSession())) {
      const { data, error } = await supabase
        .from(TABLE)
        .select("data")
        .eq("id", ROW_ID)
        .maybeSingle();
      if (!error) return data ? data.data : null;
      // On a transient error fall back to the local mirror rather than lose work.
    }
    return readLocal();
  },

  /**
   * Save-as-you-go with optimistic concurrency. Every document carries a
   * `rev` counter; the update only applies if the stored rev still matches
   * `expectedRev`. If another device saved first, nothing is overwritten —
   * we return { conflict: true, remote } and the app adopts the newer copy.
   */
  async save(data, expectedRev) {
    let cloudOk = false;
    let remote = null;
    if (supabase && (await hasSession())) {
      const payload = { data, updated_at: new Date().toISOString() };
      let q = supabase.from(TABLE).update(payload).eq("id", ROW_ID);
      if (expectedRev != null) q = q.eq("data->>rev", String(expectedRev));
      const { data: rows, error } = await q.select("id");
      if (!error && rows && rows.length) {
        cloudOk = true;
      } else if (!error) {
        // Nothing matched: first-ever save, a legacy doc without a rev, or a
        // genuine conflict. Look at what's actually stored to decide.
        const { data: cur } = await supabase.from(TABLE).select("data").eq("id", ROW_ID).maybeSingle();
        if (!cur) {
          const { error: insErr } = await supabase.from(TABLE).insert({ id: ROW_ID, ...payload });
          cloudOk = !insErr;
        } else if (cur.data && cur.data.rev == null) {
          const { error: updErr } = await supabase.from(TABLE).update(payload).eq("id", ROW_ID);
          cloudOk = !updErr;
        } else {
          remote = cur.data; // conflict — someone else saved a newer rev
        }
      }
    }
    if (remote) {
      writeLocal(remote); // keep the offline mirror on the winning version
      return { ok: false, conflict: true, remote };
    }
    const localOk = writeLocal(data);
    return { ok: supabase ? cloudOk || localOk : localOk, conflict: false };
  },
};
