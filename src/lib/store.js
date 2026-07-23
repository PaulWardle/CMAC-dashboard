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

  async save(data) {
    let cloudOk = false;
    if (supabase && (await hasSession())) {
      const { error } = await supabase
        .from(TABLE)
        .upsert(
          { id: ROW_ID, data, updated_at: new Date().toISOString() },
          { onConflict: "id" }
        );
      cloudOk = !error;
    }
    const localOk = writeLocal(data);
    return supabase ? cloudOk || localOk : localOk;
  },
};
