-- ===========================================================================
-- CMAC Operations Command Centre — initial schema
-- ===========================================================================
-- The app stores its entire workspace as a single JSONB document per user,
-- isolated by Row Level Security. This mirrors the app's "one source of truth"
-- design and keeps the storage layer a thin, swappable seam.
--
-- Apply this in a dedicated project either via the Supabase SQL editor, the
-- Supabase CLI (`supabase db push`), or the MCP apply_migration tool.
-- ===========================================================================

create table if not exists public.workspaces (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.workspaces is
  'One workspace document per user for the CMAC Operations Command Centre. RLS-isolated.';

alter table public.workspaces enable row level security;

-- Each user may only ever see and change their own row.
drop policy if exists "workspaces_select_own" on public.workspaces;
create policy "workspaces_select_own" on public.workspaces
  for select using (auth.uid() = user_id);

drop policy if exists "workspaces_insert_own" on public.workspaces;
create policy "workspaces_insert_own" on public.workspaces
  for insert with check (auth.uid() = user_id);

drop policy if exists "workspaces_update_own" on public.workspaces;
create policy "workspaces_update_own" on public.workspaces
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "workspaces_delete_own" on public.workspaces;
create policy "workspaces_delete_own" on public.workspaces
  for delete using (auth.uid() = user_id);

-- Keep updated_at fresh on every write.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workspaces_touch_updated_at on public.workspaces;
create trigger workspaces_touch_updated_at
  before update on public.workspaces
  for each row execute function public.touch_updated_at();
