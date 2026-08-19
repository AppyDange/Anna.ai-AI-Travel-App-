-- Anna.ai — row-level security
--
-- Every table is deny-by-default. Access to anything trip-shaped is decided by
-- one question: are you a member of that trip?
--
-- Two things worth understanding before editing this file:
--
-- 1. The membership checks are SECURITY DEFINER functions, not inline
--    subqueries. A policy on trip_members that itself selects from
--    trip_members recurses infinitely and Postgres will tell you so at
--    query time, not at migration time. The functions run with the
--    definer's rights and so bypass RLS, which breaks the cycle.
--
-- 2. Public share links are deliberately NOT an RLS path. The /t/:token
--    route runs server-side with the service role, resolves the token, and
--    returns a sanitised payload with member emails stripped. Encoding an
--    unauthenticated token check into RLS would mean every anon request
--    carries the ability to probe for valid tokens.

-- ───────────────────────────────────────────────── membership helpers ──

create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_trip(p_trip_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id
      and user_id = auth.uid()
      and role in ('owner', 'editor')
  );
$$;

-- Resolve the trip a comment/reaction hangs off, without tripping RLS.
create or replace function public.trip_id_for_item(p_item_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select trip_id from public.itinerary_items where id = p_item_id;
$$;

-- ─────────────────────────────────────────────────────────────── users ──

alter table public.users enable row level security;

create policy users_select_self on public.users
  for select using (id = auth.uid());

create policy users_update_self on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ─────────────────────────────────────────────────────────────── trips ──

alter table public.trips enable row level security;

create policy trips_select_member on public.trips
  for select using (public.is_trip_member(id));

create policy trips_insert_own on public.trips
  for insert with check (owner_id = auth.uid());

create policy trips_update_editor on public.trips
  for update using (public.can_edit_trip(id))
  with check (public.can_edit_trip(id));

create policy trips_delete_owner on public.trips
  for delete using (owner_id = auth.uid());

-- ───────────────────────────────────────────────────────── membership ──

alter table public.trip_members enable row level security;

create policy trip_members_select on public.trip_members
  for select using (public.is_trip_member(trip_id));

-- You may add yourself (the join flow); the owner may add anyone.
create policy trip_members_insert on public.trip_members
  for insert with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.trips t
      where t.id = trip_id and t.owner_id = auth.uid()
    )
  );

-- You may leave; the owner may remove anyone.
create policy trip_members_delete on public.trip_members
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.trips t
      where t.id = trip_id and t.owner_id = auth.uid()
    )
  );

create policy trip_members_update_self on public.trip_members
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────── messages ──

alter table public.messages enable row level security;

create policy messages_select_member on public.messages
  for select using (public.is_trip_member(trip_id));

create policy messages_insert_member on public.messages
  for insert with check (public.is_trip_member(trip_id));

-- ────────────────────────────────────────────────────── itinerary items ──

alter table public.itinerary_items enable row level security;

create policy items_select_member on public.itinerary_items
  for select using (public.is_trip_member(trip_id));

create policy items_insert_editor on public.itinerary_items
  for insert with check (public.can_edit_trip(trip_id));

create policy items_update_editor on public.itinerary_items
  for update using (public.can_edit_trip(trip_id))
  with check (public.can_edit_trip(trip_id));

create policy items_delete_editor on public.itinerary_items
  for delete using (public.can_edit_trip(trip_id));

-- ────────────────────────────────────────────── reactions and comments ──
-- Any member may react or comment, including viewers: registering an opinion
-- is the collaborator action the product is trying to produce, so the bar for
-- it is deliberately low.

alter table public.item_reactions enable row level security;

create policy reactions_select on public.item_reactions
  for select using (public.is_trip_member(public.trip_id_for_item(item_id)));

create policy reactions_write_own on public.item_reactions
  for insert with check (
    user_id = auth.uid()
    and public.is_trip_member(public.trip_id_for_item(item_id))
  );

create policy reactions_update_own on public.item_reactions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy reactions_delete_own on public.item_reactions
  for delete using (user_id = auth.uid());

alter table public.item_comments enable row level security;

create policy comments_select on public.item_comments
  for select using (public.is_trip_member(public.trip_id_for_item(item_id)));

create policy comments_insert_own on public.item_comments
  for insert with check (
    user_id = auth.uid()
    and public.is_trip_member(public.trip_id_for_item(item_id))
  );

create policy comments_delete_own on public.item_comments
  for delete using (user_id = auth.uid());

-- ──────────────────────────────────────────────────── offers, handoffs ──
-- Written server-side with the service role. Members get read access so the
-- UI can show a cached price and its age without a round trip.

alter table public.offers enable row level security;

create policy offers_select_member on public.offers
  for select using (trip_id is not null and public.is_trip_member(trip_id));

alter table public.handoffs enable row level security;

create policy handoffs_select_member on public.handoffs
  for select using (public.is_trip_member(trip_id));

create policy handoffs_insert_member on public.handoffs
  for insert with check (public.is_trip_member(trip_id));

-- ───────────────────────────────────────── owner is always a member ──
-- Creating a trip enrols the creator, so trips_select_member matches from the
-- first row. Without this a user cannot read the trip they just created.

create or replace function public.enrol_trip_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trip_members (trip_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger trips_enrol_owner
  after insert on public.trips
  for each row execute function public.enrol_trip_owner();
