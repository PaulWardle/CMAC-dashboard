-- ===========================================================================
-- Hardening pass: assume the attacker is a capable CMAC insider.
-- ===========================================================================
-- Threat model. Someone technical, inside the company, who has:
--   * a valid @cmacgroup.com address, so any domain check waves them through
--   * the ability to read the JavaScript bundle and lift the browser key
--     (that key is public by design — Row Level Security is the real control)
--   * the URL
-- and who does NOT have: this Supabase account, the Cloudflare account, the
-- GitHub repository, or the Anthropic key.
--
-- Two gaps against that attacker:
--   1. Reading the workspace needed only a company email address. The
--      "awaiting approval" screen is the interface alone, so a colleague who
--      registered could call the REST API directly and read everything —
--      People and HR material included.
--   2. Anyone at CMAC could create an account at all. Since the attacker is
--      an insider, restricting sign-up by email domain protects nothing.
--
-- This migration closes both, and adds defence in depth underneath.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Who may create an account at all.
--    An allowlist, not a domain. The table carries NO policies, so no client
--    role can read or change it under any circumstances — only the service
--    role (the dashboard and SQL editor) can, and those need this Supabase
--    login. To let somebody in later, add a row here; nothing else changes.
-- --------------------------------------------------------------------------
create table if not exists public.allowed_signups (
  email    text primary key,
  note     text,
  added_at timestamptz not null default now()
);
alter table public.allowed_signups enable row level security;
revoke all on public.allowed_signups from anon, authenticated;

insert into public.allowed_signups (email, note)
values ('paul.wardle@cmacgroup.com', 'Owner')
on conflict (email) do nothing;

comment on table public.allowed_signups is
  'Sign-up allowlist. No RLS policies exist, so client roles cannot see or change it. Add a row to admit an account; nothing else grants access.';

-- Replaces the domain check. The function is SECURITY DEFINER so it can read
-- the allowlist despite that table being closed to everyone else.
create or replace function public.enforce_cmac_domain()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.allowed_signups
    where email = lower(new.email)
  ) then
    raise exception 'This application is private. Accounts are created by the administrator.';
  end if;
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- 2. Approval has to hold in the database, not only on screen.
-- --------------------------------------------------------------------------
drop policy if exists "shared_read_cmac" on public.shared_workspace;
drop policy if exists "shared_read_approved" on public.shared_workspace;

create policy "shared_read_approved" on public.shared_workspace
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.status = 'approved'
    )
  );

comment on policy "shared_read_approved" on public.shared_workspace is
  'Reading requires an APPROVED profile, not merely a company email address.';

-- --------------------------------------------------------------------------
-- 3. Defence in depth.
--    RLS decides which rows; grants decide whether the role may ask at all.
--    Revoking the signed-out role means an anonymous request is refused
--    before any policy is consulted.
-- --------------------------------------------------------------------------
revoke all on public.shared_workspace from anon;
revoke all on public.profiles          from anon;

-- Profile rows are created by the sign-up trigger and changed by an admin.
-- No client should ever insert or delete one: that is the self-approval path.
revoke insert, delete on public.profiles from authenticated;

-- FORCE applies the policies to the table owner as well, so a mistake that
-- runs as owner cannot quietly read past them. Roles holding BYPASSRLS (the
-- service role, used by the digest) are unaffected.
alter table public.shared_workspace force row level security;

comment on function public.enforce_cmac_domain() is
  'Despite the historical name, this no longer checks an email domain — the threat model is a company insider, so a domain proves nothing. It admits only addresses listed in public.allowed_signups.';

-- ===========================================================================
-- Verification. Run this afterwards; every line should read OK.
-- ===========================================================================
-- select
--   (select count(*) from pg_policies
--      where tablename = 'shared_workspace' and policyname = 'shared_read_cmac') = 0
--     as "OK: the email-domain read policy is gone",
--   (select count(*) from pg_policies
--      where tablename = 'shared_workspace' and policyname = 'shared_read_approved') = 1
--     as "OK: reads now require an approved profile",
--   (select relforcerowsecurity from pg_class where relname = 'shared_workspace')
--     as "OK: policies apply to the owner too",
--   (select has_table_privilege('anon', 'public.shared_workspace', 'SELECT')) = false
--     as "OK: signed-out callers cannot even ask",
--   (select has_table_privilege('authenticated', 'public.profiles', 'INSERT')) = false
--     as "OK: nobody can insert their own approved profile",
--   (select count(*) from public.allowed_signups) = 1
--     as "OK: exactly one address may create an account";
