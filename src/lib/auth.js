import { supabase, isConfigured } from "./supabase";
import { store } from "./store";

export { isConfigured };

/**
 * Returns the current session, normalised to a small shape the UI uses:
 *   { mode: "cloud" | "local", user: {...}, session? }
 * In local mode (no Supabase configured) a synthetic session is returned so
 * the app opens straight away with no login step.
 */
export async function getSession() {
  if (!supabase) return { mode: "local", user: { email: "Local device" } };
  const { data } = await supabase.auth.getSession();
  if (!data?.session) return null;
  return { mode: "cloud", user: data.session.user, session: data.session };
}

/** Subscribe to auth changes. Returns an unsubscribe function. */
export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session ? { mode: "cloud", user: session.user, session } : null);
  });
  return () => data.subscription.unsubscribe();
}

/** Email + password sign-in. */
export async function signInWithPassword(email, password) {
  if (!supabase) throw new Error("Cloud storage is not configured.");
  return supabase.auth.signInWithPassword({ email: email.trim(), password });
}

/** Self-serve registration (company domain only — also enforced by a DB
 *  trigger). New accounts start as 'pending' until the admin approves them;
 *  the named admin account is auto-approved (bootstrap). */
export async function signUpWithPassword(email, password) {
  if (!supabase) throw new Error("Cloud storage is not configured.");
  return supabase.auth.signUp({ email: email.trim(), password });
}

/** Fetch the CALLER'S access profile (status + role). Null means "no profile
 *  row yet"; a fetch FAILURE throws instead, so the gate can offer a retry
 *  rather than telling an approved user they're awaiting approval.
 *  Must filter to the caller's own row: admins can read every profile, and an
 *  unfiltered single-row fetch starts failing the moment a second account
 *  registers — which would lock the admin out. */
export async function fetchProfile() {
  if (!supabase) return null;
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase.from("profiles")
    .select("status, role, email")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw new Error(error.message || "Could not check your access.");
  return data || null;
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
  // Shared machines: don't leave the previous user's workspace mirror behind.
  store.clearLocal();
}
