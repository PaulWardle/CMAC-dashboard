import { supabase } from "./supabase";

/**
 * Persistence adapter — the single seam between the app and where its data
 * lives. The app only ever calls `store.load()` and `store.save(data)`.
 *
 * Cloud mode (Supabase configured + signed in):
 *   the entire workspace document is stored as one JSONB row per user in
 *   public.workspaces, isolated by Row Level Security. A copy is also mirrored
 *   to localStorage so the app still opens instantly / offline.
 *
 * Local mode (no Supabase, or not signed in):
 *   data lives in localStorage only.
 *
 * The single-document model deliberately mirrors the app's "one source of
 * truth" design, so moving from the Claude artifact runtime to Supabase was a
 * contained change confined to this file.
 */
const APP_KEY = "cmac-occ-v1";
const TABLE = "workspaces";

async function currentUserId() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
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
  // There is always at least localStorage available in a browser.
  available: true,
  mode: supabase ? "cloud" : "local",

  async load() {
    if (supabase) {
      const uid = await currentUserId();
      if (uid) {
        const { data, error } = await supabase
          .from(TABLE)
          .select("data")
          .eq("user_id", uid)
          .maybeSingle();
        if (!error) {
          // A row exists → return its document. No row yet → null (app seeds).
          return data ? data.data : null;
        }
        // On a transient error, fall back to the local mirror rather than lose work.
      }
    }
    return readLocal();
  },

  async save(data) {
    let cloudOk = false;
    if (supabase) {
      const uid = await currentUserId();
      if (uid) {
        const { error } = await supabase
          .from(TABLE)
          .upsert(
            { user_id: uid, data, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
        cloudOk = !error;
      }
    }
    // Always keep a local mirror as an offline cache + safety net.
    const localOk = writeLocal(data);
    // Report success if the data landed anywhere durable.
    return supabase ? cloudOk || localOk : localOk;
  },
};
