-- ===========================================================================
-- 0003 — Self-serve accounts with admin approval + per-user roles
-- ===========================================================================
--  * Anyone @cmacgroup.com may register (create a password). A trigger makes
--    a profile row: paul.wardle@cmacgroup.com is auto-approved as admin
--    (bootstrap); everyone else starts as 'pending'.
--  * Only approved profiles can read the shared workspace; only approved
--    admins/editors can write it.
--  * Admins manage profiles (approve / reject / suspend / change role).
-- ===========================================================================

create table if not exists public.profiles (
  user_id      uuid        primary key references auth.users (id) on delete cascade,
  email        text        not null unique,
  status       text        not null default 'pending'
               check (status in ('pending','approved','rejected','suspended')),
  role         text        not null default 'viewer'
               check (role in ('viewer','editor','admin')),
  permissions  jsonb       not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  approved_at  timestamptz,
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'App access profiles: approval status + role per account. Rows are created by trigger on sign-up.';

alter table public.profiles enable row level security;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Helper: is the caller an approved admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin' and status = 'approved'
  );
$$;

-- Read own profile; admins read all.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (user_id = auth.uid() or public.is_admin());

-- Only admins change profiles (approve, reject, role changes).
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- No client inserts/deletes; rows are created by the sign-up trigger below.

-- Create a profile automatically on sign-up. Bootstrap: the named
-- administrator account is approved as admin immediately.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, status, role, approved_at)
  values (
    new.id,
    lower(new.email),
    case when lower(new.email) = 'paul.wardle@cmacgroup.com' then 'approved' else 'pending' end,
    case when lower(new.email) = 'paul.wardle@cmacgroup.com' then 'admin'    else 'viewer'  end,
    case when lower(new.email) = 'paul.wardle@cmacgroup.com' then now()      else null      end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Re-base the shared workspace policies on profiles instead of raw emails.
-- ---------------------------------------------------------------------------
drop policy if exists "shared_read_cmac" on public.shared_workspace;
create policy "shared_read_cmac" on public.shared_workspace
  for select using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.status = 'approved')
  );

drop policy if exists "shared_write_admin_ins" on public.shared_workspace;
create policy "shared_write_admin_ins" on public.shared_workspace
  for insert with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.status = 'approved'
              and p.role in ('admin','editor'))
  );

drop policy if exists "shared_write_admin_upd" on public.shared_workspace;
create policy "shared_write_admin_upd" on public.shared_workspace
  for update using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.status = 'approved'
              and p.role in ('admin','editor'))
  ) with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.status = 'approved'
              and p.role in ('admin','editor'))
  );
