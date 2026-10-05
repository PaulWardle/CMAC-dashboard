-- Make the approval gate real at the database level.
--
-- Until now, reading the shared workspace required only a signed-in
-- @cmacgroup.com account. The app shows unapproved accounts an "awaiting
-- approval" screen, but that is the interface only: the browser key is public
-- by design, so a colleague who registered and sat at "pending" could still
-- query the REST API directly and read the whole workspace — including People
-- and HR material. Approval now has to hold in the database too.
--
-- Writes are unchanged: still the named administrator alone.

drop policy if exists "shared_read_cmac" on public.shared_workspace;

create policy "shared_read_approved" on public.shared_workspace
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.status = 'approved'
    )
  );

comment on policy "shared_read_approved" on public.shared_workspace is
  'Read requires an APPROVED profile, not merely a company email address. The pending/rejected state is enforced here, not only in the interface.';
