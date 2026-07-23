-- ===========================================================================
-- 0002 — Shared workspace + role-based access
-- ===========================================================================
-- Model change: the whole team shares ONE workspace document (row id 'main').
--   * Any signed-in @cmacgroup.com account may READ it.
--   * Only the administrator (paul.wardle@cmacgroup.com) may WRITE it.
--   * Sign-ups from outside the company domain are rejected outright.
-- The per-user `workspaces` table from 0001 is retained (unused) for safety.
-- ===========================================================================

create table if not exists public.shared_workspace (
  id         text        primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.shared_workspace is
  'Single shared workspace document for the CMAC Operations Command Centre. Read: any cmacgroup.com account. Write: admins only.';

alter table public.shared_workspace enable row level security;

-- Read: any signed-in company account.
drop policy if exists "shared_read_cmac" on public.shared_workspace;
create policy "shared_read_cmac" on public.shared_workspace
  for select using ((auth.jwt() ->> 'email') ilike '%@cmacgroup.com');

-- Write: administrator only.
drop policy if exists "shared_write_admin_ins" on public.shared_workspace;
create policy "shared_write_admin_ins" on public.shared_workspace
  for insert with check (lower(auth.jwt() ->> 'email') = 'paul.wardle@cmacgroup.com');

drop policy if exists "shared_write_admin_upd" on public.shared_workspace;
create policy "shared_write_admin_upd" on public.shared_workspace
  for update using (lower(auth.jwt() ->> 'email') = 'paul.wardle@cmacgroup.com')
  with check (lower(auth.jwt() ->> 'email') = 'paul.wardle@cmacgroup.com');

drop trigger if exists shared_workspace_touch on public.shared_workspace;
create trigger shared_workspace_touch
  before update on public.shared_workspace
  for each row execute function public.touch_updated_at();

-- Reject sign-ups from outside the company domain (defence in depth; the
-- client also refuses to send links to other domains, and RLS gives outside
-- accounts no data access even if one were created).
create or replace function public.enforce_cmac_domain()
returns trigger language plpgsql security definer as $$
begin
  if lower(new.email) not like '%@cmacgroup.com' then
    raise exception 'Sign-in is limited to cmacgroup.com accounts';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_cmac_domain_trg on auth.users;
create trigger enforce_cmac_domain_trg
  before insert on auth.users
  for each row execute function public.enforce_cmac_domain();
