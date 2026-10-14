/**
 * Access control configuration.
 *
 * ALLOWED_EMAIL_DOMAIN — only this domain may sign in (also enforced by a
 * database trigger and by RLS policies in supabase/migrations/0002).
 * ADMIN_EMAILS — accounts allowed to make changes; everyone else is view-only
 * (also enforced by RLS: the database rejects writes from non-admins).
 */
export const ALLOWED_EMAIL_DOMAIN = "cmacgroup.com";
export const ADMIN_EMAILS = ["paul.wardle@cmacgroup.com"];

/* Who the screens tell people to ask. Derived from the first admin email
   so there is no second place to keep in step — "a.person@example.com"
   reads as "A Person". */
export const ADMIN_NAME = (ADMIN_EMAILS[0] || "").split("@")[0]
  .split(/[._-]+/).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1)).join(" ") || "an administrator";

export const isAllowedEmail = (email) =>
  new RegExp("@" + ALLOWED_EMAIL_DOMAIN.replace(".", "\\.") + "$", "i").test((email || "").trim());

export const isAdminEmail = (email) =>
  ADMIN_EMAILS.includes((email || "").trim().toLowerCase());
