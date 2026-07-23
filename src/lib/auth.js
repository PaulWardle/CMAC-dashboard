import { supabase, isConfigured } from "./supabase";

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

/** Email + password sign-in. Accounts are created by the administrator in the
 *  Supabase dashboard (Authentication → Users → Add user), so no verification
 *  emails are ever involved. */
export async function signInWithPassword(email, password) {
  if (!supabase) throw new Error("Cloud storage is not configured.");
  return supabase.auth.signInWithPassword({ email: email.trim(), password });
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}
