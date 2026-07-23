import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client.
 *
 * Reads the PUBLIC url + anon key from build-time env vars. These are safe to
 * ship to the browser: all access is gated by Row Level Security in the
 * database (see supabase/migrations/0001_init.sql).
 *
 * If either value is missing, `supabase` is null and the whole app runs in
 * "local mode" — persistence falls back to the browser's localStorage and no
 * sign-in is required. This keeps local development and the offline fallback
 * working with zero configuration.
 */
// These are the PUBLIC Supabase values (the anon/publishable key is designed to
// be exposed in the browser and is gated by row-level security). They are baked
// in as defaults so the app connects with no build-time configuration; set the
// VITE_SUPABASE_* env vars to override (e.g. for a different environment).
const url = import.meta.env.VITE_SUPABASE_URL || "https://lvbqsiycvsvadkowjequ.supabase.co";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_-UZzABw_r3oyN8DGTOqiaw_FQU-SYNW";

export const isConfigured = Boolean(url && anonKey);

export const supabase = isConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
