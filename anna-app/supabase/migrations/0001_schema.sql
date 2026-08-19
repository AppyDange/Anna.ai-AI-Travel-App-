-- Anna.ai — core schema
--
-- Money is stored as bigint minor units (cents). Never floats: a trip budget
-- that fails to reconcile by a cent is a bug users notice and don't forgive.
--
-- The three columns that carry the product thesis are on itinerary_items:
--   source, source_ref, verified_at
-- An item with verified_at IS NULL renders as a *suggestion*, never as a fact.
-- That is the grounding policy expressed as schema rather than as good
-- intentions, which is the only way it survives a deadline.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────── users ──
-- Mirrors auth.users. Supabase owns identity; this holds trip-relevant profile.

create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  name          text,
  home_airport  text,                        -- IATA, learned from use
  home_currency text not null default 'USD',
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────── trips ──

create type trip_status as enum ('draft', 'planned', 'booked', 'past');

create table public.trips (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.users(id) on delete cascade,
  title           text,
  origin          text,                      -- IATA once resolved
  destination     text,
  start_date      date,
  end_date        date,
  party_size      int check (party_size is null or party_size between 1 and 12),
  budget_cents    bigint check (budget_cents is null or budget_cents >= 0),
  budget_currency text not null default 'USD',
  status          trip_status not null default 'draft',

  -- Null until first shared. The public /t/:token route resolves this
  -- server-side with the service role; it is deliberately NOT an RLS path.
  share_token     text unique,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trip_dates_ordered check (
    start_date is null or end_date is null or end_date >= start_date
  )
);

create index trips_owner_idx on public.trips (owner_id, created_at desc);
create index trips_share_token_idx on public.trips (share_token) where share_token is not null;

-- ───────────────────────────────────────────────────────── membership ──

create type member_role as enum ('owner', 'editor', 'viewer');

create table public.trip_members (
  trip_id      uuid not null references public.trips(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  role         member_role not null default 'editor',
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz,
  primary key (trip_id, user_id)
);

create index trip_members_user_idx on public.trip_members (user_id);

-- ──────────────────────────────────────────────────────────── messages ──
-- The planning conversation. Persisted before streaming begins, so a dropped
-- connection never loses the user's message.

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null default '',
  tool_calls jsonb,
  author_id  uuid references public.users(id) on delete set null,  -- null = Anna
  created_at timestamptz not null default now()
);

create index messages_trip_idx on public.messages (trip_id, created_at);

-- ────────────────────────────────────────────────────── itinerary items ──

create type item_type as enum ('flight', 'hotel', 'activity', 'meal', 'transit');
create type item_source as enum ('amadeus', 'places', 'weather', 'generated');

create table public.itinerary_items (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips(id) on delete cascade,
  day_index     int not null check (day_index >= 0),
  position      int not null default 0,

  start_time    time,
  end_time      time,

  type          item_type not null,
  title         text not null,
  notes         text,

  location_name text,
  lat           double precision check (lat is null or lat between -90 and 90),
  lng           double precision check (lng is null or lng between -180 and 180),

  cost_cents    bigint check (cost_cents is null or cost_cents >= 0),
  currency      text not null default 'USD',

  -- Grounding. `generated` means the model invented it: allowed for structure
  -- and ideas, never for a price or a specific time.
  source        item_source not null default 'generated',
  source_ref    text,                        -- the provider's own id
  verified_at   timestamptz,                 -- null ⇒ suggestion, not fact

  pinned        bool not null default false, -- survives regeneration
  created_by    uuid references public.users(id) on delete set null, -- null = Anna
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The grounding rule, enforced by the database rather than by the prompt:
  -- anything carrying a price must name a real source and a verification time.
  constraint priced_items_must_be_verified check (
    cost_cents is null
    or (source <> 'generated' and source_ref is not null and verified_at is not null)
  )
);

create index itinerary_items_trip_idx
  on public.itinerary_items (trip_id, day_index, position);

-- ─────────────────────────────────────────── reactions and comments ──
-- Collaborator actions. These are the third clause of the North Star:
-- a trip is "synced" only once a non-creator has acted on it.

create table public.item_reactions (
  item_id    uuid not null references public.itinerary_items(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       text not null check (kind in ('up', 'down')),
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create table public.item_comments (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.itinerary_items(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index item_comments_item_idx on public.item_comments (item_id, created_at);

-- ────────────────────────────────────────────────────────────── offers ──
-- Cached provider search results, ~15 minute TTL. Cuts Amadeus calls sharply
-- and lets the UI show data age honestly.

create table public.offers (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid references public.trips(id) on delete cascade,
  type        text not null check (type in ('flight', 'hotel')),
  cache_key   text not null,
  payload     jsonb not null,
  price_cents bigint,
  currency    text not null default 'USD',
  source      text not null,
  fetched_at  timestamptz not null default now()
);

create index offers_cache_idx on public.offers (cache_key, fetched_at desc);

-- ──────────────────────────────────────────────────────────── handoffs ──
-- The revenue event. Written before the redirect, so a click is recorded even
-- if the partner site never loads.

create table public.handoffs (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  item_id      uuid references public.itinerary_items(id) on delete set null,
  user_id      uuid references public.users(id) on delete set null,
  partner      text not null,
  target_url   text not null,
  price_cents  bigint,
  currency     text not null default 'USD',
  clicked_at   timestamptz not null default now(),
  confirmed_at timestamptz                   -- set by the partner webhook
);

create index handoffs_trip_idx on public.handoffs (trip_id, clicked_at desc);

-- ────────────────────────────────────────────────── updated_at trigger ──

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trips_touch
  before update on public.trips
  for each row execute function public.touch_updated_at();

create trigger itinerary_items_touch
  before update on public.itinerary_items
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────── new auth user → public.users ──

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
