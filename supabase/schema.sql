-- Run this in Supabase SQL Editor after enabling the vector extension:
-- CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  username      text,
  avatar_url    text,
  role          text not null default 'user',
  age           int,
  locality      text,
  nationality   text,
  languages     text[] not null default '{}',
  preferred_language text,
  last_logged_in_at  timestamptz,
  blocked_users text[] not null default '{}',
  hidden_users  text[] not null default '{}',
  silenced_users text[] not null default '{}',
  created_at    timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users: select own" on public.users for select using (auth.uid() = id);
create policy "users: insert own" on public.users for insert with check (auth.uid() = id);
create policy "users: update own" on public.users for update using (auth.uid() = id);

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUPS (declared before goals because goals.group_id references it)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.groups (
  id                      uuid primary key default gen_random_uuid(),
  derived_goal_theme      text,
  representative_embedding vector(1536),
  locality_center         text,
  max_members             int not null default 70,
  member_count            int not null default 0,
  members                 jsonb not null default '[]',
  member_ids              text[] not null default '{}',
  eligible_goal_ids       uuid[] not null default '{}',
  matching_criteria       jsonb,
  created_at              timestamptz not null default now()
);

alter table public.groups enable row level security;

-- Members can read their own groups; all reads go through the server (service key)
create policy "groups: select if member" on public.groups for select
  using (auth.uid()::text = any(member_ids));

-- ─────────────────────────────────────────────────────────────────────────────
-- GOALS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.goals (
  id                       uuid primary key default gen_random_uuid(),
  owner_id                 uuid not null references public.users(id) on delete cascade,
  temp_id                  text unique,
  title                    text,
  description              text,
  category                 text,
  categories               text[] not null default '{}',
  tags                     text[] not null default '{}',
  time_horizon             text,
  progress_percent         int not null default 0,
  status                   text not null default 'active',
  visibility               text not null default 'public',
  public_fields            text[] not null default '{}',
  source_text              text,
  normalized_matching_text text,
  embedding                vector(1536),
  embedding_updated_at     timestamptz,
  matching_metadata        jsonb,
  group_id                 uuid references public.groups(id) on delete set null,
  group_joined             boolean not null default false,
  joined_at                timestamptz,
  eligible_at              timestamptz,
  similar_goals            jsonb,
  similarity_computed_at   timestamptz,
  created_at               timestamptz not null default now()
);

create index goals_owner_id_idx on public.goals(owner_id);
create index goals_group_id_idx on public.goals(group_id);
create index goals_created_at_idx on public.goals(created_at desc);
create index goals_embedding_idx on public.goals using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.goals enable row level security;

create policy "goals: select own" on public.goals for select
  using (owner_id = auth.uid());
create policy "goals: select public" on public.goals for select
  using (visibility = 'public');
create policy "goals: insert own" on public.goals for insert
  with check (owner_id = auth.uid());
create policy "goals: update own" on public.goals for update
  using (owner_id = auth.uid());
create policy "goals: delete own" on public.goals for delete
  using (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- TASKS (was goals/{id}/tasks subcollection)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references public.goals(id) on delete cascade,
  owner_id    uuid not null references public.users(id) on delete cascade,
  text        text not null,
  is_done     boolean not null default false,
  "order"     int not null default 0,
  micro_steps jsonb not null default '[]',
  source      text not null default 'manual',
  reminder_at timestamptz,
  created_at  timestamptz not null default now()
);

create index tasks_goal_id_idx on public.tasks(goal_id);
create index tasks_owner_id_idx on public.tasks(owner_id);
create index tasks_reminder_at_idx on public.tasks(reminder_at) where reminder_at is not null;

alter table public.tasks enable row level security;

create policy "tasks: select own" on public.tasks for select using (owner_id = auth.uid());
create policy "tasks: insert own" on public.tasks for insert with check (owner_id = auth.uid());
create policy "tasks: update own" on public.tasks for update using (owner_id = auth.uid());
create policy "tasks: delete own" on public.tasks for delete using (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- GOAL NOTES (was goals/{id}/notes subcollection)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.goal_notes (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references public.tasks(id) on delete cascade,
  goal_id     uuid not null references public.goals(id) on delete cascade,
  owner_id    uuid not null references public.users(id) on delete cascade,
  text        text,
  reminder_at timestamptz,
  created_at  timestamptz not null default now()
);

create index goal_notes_owner_id_idx on public.goal_notes(owner_id);

alter table public.goal_notes enable row level security;

create policy "goal_notes: select own" on public.goal_notes for select using (owner_id = auth.uid());
create policy "goal_notes: insert own" on public.goal_notes for insert with check (owner_id = auth.uid());
create policy "goal_notes: update own" on public.goal_notes for update using (owner_id = auth.uid());
create policy "goal_notes: delete own" on public.goal_notes for delete using (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- THREADS (was groups/{id}/threads subcollection)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.threads (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references public.groups(id) on delete cascade,
  goal_id          uuid references public.goals(id) on delete set null,
  badge            text,
  title            text,
  linked_task_text text,
  author_id        uuid not null references public.users(id) on delete cascade,
  author_name      text,
  author_avatar    text,
  preview_text     text,
  reply_count      int not null default 0,
  useful_count     int not null default 0,
  reactions        jsonb not null default '{}',
  is_pinned        boolean not null default false,
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create index threads_group_id_idx on public.threads(group_id);
create index threads_last_activity_idx on public.threads(last_activity_at desc);

alter table public.threads enable row level security;

create policy "threads: select if group member" on public.threads for select
  using (
    exists (
      select 1 from public.groups g
      where g.id = group_id and auth.uid()::text = any(g.member_ids)
    )
  );
create policy "threads: insert if group member" on public.threads for insert
  with check (
    exists (
      select 1 from public.groups g
      where g.id = group_id and auth.uid()::text = any(g.member_ids)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- REPLIES (was groups/{id}/threads/{id}/replies subcollection)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.replies (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references public.threads(id) on delete cascade,
  group_id      uuid not null references public.groups(id) on delete cascade,
  author_id     uuid not null references public.users(id) on delete cascade,
  author_name   text,
  author_avatar text,
  text          text,
  useful_count  int not null default 0,
  reactions     jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create index replies_thread_id_idx on public.replies(thread_id);

alter table public.replies enable row level security;

create policy "replies: select if group member" on public.replies for select
  using (
    exists (
      select 1 from public.groups g
      where g.id = group_id and auth.uid()::text = any(g.member_ids)
    )
  );
create policy "replies: insert if group member" on public.replies for insert
  with check (
    exists (
      select 1 from public.groups g
      where g.id = group_id and auth.uid()::text = any(g.member_ids)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP INDEX
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.group_index (
  group_id                uuid primary key references public.groups(id) on delete cascade,
  member_goal_ids         uuid[] not null default '{}',
  member_user_ids         uuid[] not null default '{}',
  member_count            int not null default 0,
  categories              text[] not null default '{}',
  languages               text[] not null default '{}',
  age_categories          text[] not null default '{}',
  locations               text[] not null default '{}',
  nationalities           text[] not null default '{}',
  representative_embedding vector(1536),
  updated_at              timestamptz not null default now()
);

create index group_index_embedding_idx on public.group_index
  using ivfflat (representative_embedding vector_cosine_ops) with (lists = 100);

alter table public.group_index enable row level security;
-- Only service role accesses this table
create policy "group_index: no direct client access" on public.group_index for select using (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- GOALS UNASSIGNED INDEX
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.goals_unassigned_index (
  goal_id          uuid primary key references public.goals(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  embedding        vector(1536),
  age_category     text,
  current_location text,
  nationality      text,
  languages        text[] not null default '{}',
  categories       text[] not null default '{}',
  last_logged_in_at timestamptz,
  activity_status  text not null default 'active',
  updated_at       timestamptz not null default now()
);

create index goals_unassigned_activity_idx on public.goals_unassigned_index(activity_status);
create index goals_unassigned_embedding_idx on public.goals_unassigned_index
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.goals_unassigned_index enable row level security;
create policy "goals_unassigned_index: no direct client access" on public.goals_unassigned_index for select using (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- FAVOURITES
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.favourites (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.users(id) on delete cascade,
  target_user_id   uuid not null references public.users(id) on delete cascade,
  target_user_name text,
  target_avatar_url text,
  created_at       timestamptz not null default now(),
  unique(owner_id, target_user_id)
);

create index favourites_owner_id_idx on public.favourites(owner_id);

alter table public.favourites enable row level security;

create policy "favourites: select own" on public.favourites for select using (owner_id = auth.uid());
create policy "favourites: insert own" on public.favourites for insert with check (owner_id = auth.uid());
create policy "favourites: delete own" on public.favourites for delete using (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  to_user_id  uuid not null references public.users(id) on delete cascade,
  from_user_id uuid references public.users(id) on delete set null,
  from_name   text,
  thread_id   uuid references public.threads(id) on delete set null,
  group_id    uuid references public.groups(id) on delete set null,
  task_text   text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index notifications_to_user_idx on public.notifications(to_user_id);

alter table public.notifications enable row level security;

create policy "notifications: select own" on public.notifications for select using (to_user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- REPORTS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.users(id) on delete cascade,
  reported_user_id uuid references public.users(id) on delete set null,
  group_id         uuid references public.groups(id) on delete set null,
  thread_id        uuid references public.threads(id) on delete set null,
  reply_id         uuid references public.replies(id) on delete set null,
  reason           text,
  status           text not null default 'pending',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

create index reports_status_idx on public.reports(status);

alter table public.reports enable row level security;
-- Only service role (admin) accesses reports
create policy "reports: no direct client access" on public.reports for select using (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- MODERATION EVENTS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.moderation_events (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references public.users(id) on delete cascade,
  target_user_id  uuid references public.users(id) on delete set null,
  action          text not null,
  context         text,
  status          text not null default 'pending',
  created_at      timestamptz not null default now()
);

alter table public.moderation_events enable row level security;
create policy "moderation_events: no direct client access" on public.moderation_events for select using (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- RATE LIMITS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.rate_limits (
  id         text primary key,
  count      int not null default 0,
  last_reset bigint not null
);

alter table public.rate_limits enable row level security;
create policy "rate_limits: no direct client access" on public.rate_limits for select using (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- MODERATION TARGET LIMITS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.moderation_target_limits (
  id           text primary key,
  count        int not null default 0,
  first_at     bigint not null,
  reporter_id  text,
  target_user_id text
);

alter table public.moderation_target_limits enable row level security;
create policy "moderation_target_limits: no direct client access" on public.moderation_target_limits for select using (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- ADMIN FLAGS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.admin_flags (
  id           text primary key,
  completed    boolean not null default false,
  completed_at timestamptz,
  stats        jsonb
);

alter table public.admin_flags enable row level security;
create policy "admin_flags: no direct client access" on public.admin_flags for select using (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- ADMIN SETTINGS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.admin_settings (
  id          text primary key,
  model_order text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

alter table public.admin_settings enable row level security;
create policy "admin_settings: no direct client access" on public.admin_settings for select using (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- ONE-TIME MEDIA
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.one_time_media (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups(id) on delete cascade,
  sender_id      uuid not null references public.users(id) on delete cascade,
  type           text not null,
  url            text not null,
  created_at     timestamptz not null default now(),
  consumed_by    text[] not null default '{}',
  first_opened_at jsonb not null default '{}'
);

alter table public.one_time_media enable row level security;
create policy "one_time_media: no direct client access" on public.one_time_media for select using (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- CALENDAR NOTES (was users/{id}/calendarNotes subcollection)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.calendar_notes (
  user_id    uuid not null references public.users(id) on delete cascade,
  date       text not null,
  text       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index calendar_notes_user_id_idx on public.calendar_notes(user_id);

alter table public.calendar_notes enable row level security;

create policy "calendar_notes: select own" on public.calendar_notes for select using (user_id = auth.uid());
create policy "calendar_notes: insert own" on public.calendar_notes for insert with check (user_id = auth.uid());
create policy "calendar_notes: update own" on public.calendar_notes for update using (user_id = auth.uid());
create policy "calendar_notes: delete own" on public.calendar_notes for delete using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 5: pgvector similarity search RPC functions
-- ─────────────────────────────────────────────────────────────────────────────

-- Match similar goals using cosine similarity (for computeAndStoreSimilarGoals)
create or replace function match_similar_goals(
  query_embedding   vector(1536),
  match_threshold   float,
  match_count       int,
  exclude_goal_id   uuid,
  exclude_owner_id  uuid
)
returns table (
  id                uuid,
  owner_id          uuid,
  title             text,
  description       text,
  group_id          uuid,
  similarity        float
)
language sql stable
as $$
  select
    g.id,
    g.owner_id,
    g.title,
    g.description,
    g.group_id,
    1 - (g.embedding <=> query_embedding) as similarity
  from public.goals g
  where
    g.id <> exclude_goal_id
    and g.owner_id <> exclude_owner_id
    and g.embedding is not null
    and 1 - (g.embedding <=> query_embedding) >= match_threshold
  order by g.embedding <=> query_embedding
  limit match_count;
$$;

-- Match groups by cosine similarity (for runIndexedMatching — step 1)
create or replace function match_group_index(
  query_embedding  vector(1536),
  match_threshold  float,
  match_count      int,
  exclude_user_id  uuid
)
returns table (
  group_id          uuid,
  member_count      int,
  categories        text[],
  languages         text[],
  age_categories    text[],
  locations         text[],
  nationalities     text[],
  member_user_ids   uuid[],
  similarity        float
)
language sql stable
as $$
  select
    gi.group_id,
    gi.member_count,
    gi.categories,
    gi.languages,
    gi.age_categories,
    gi.locations,
    gi.nationalities,
    gi.member_user_ids,
    1 - (gi.representative_embedding <=> query_embedding) as similarity
  from public.group_index gi
  where
    gi.representative_embedding is not null
    and gi.member_count < 100
    and not (exclude_user_id = any(gi.member_user_ids))
    and 1 - (gi.representative_embedding <=> query_embedding) >= match_threshold
  order by gi.representative_embedding <=> query_embedding
  limit match_count;
$$;

-- Match unassigned goals by cosine similarity (for runIndexedMatching — step 2)
create or replace function match_unassigned_goals(
  query_embedding  vector(1536),
  match_threshold  float,
  match_count      int,
  exclude_goal_id  uuid,
  exclude_user_id  uuid
)
returns table (
  goal_id           uuid,
  user_id           uuid,
  age_category      text,
  current_location  text,
  nationality       text,
  languages         text[],
  categories        text[],
  similarity        float
)
language sql stable
as $$
  select
    ui.goal_id,
    ui.user_id,
    ui.age_category,
    ui.current_location,
    ui.nationality,
    ui.languages,
    ui.categories,
    1 - (ui.embedding <=> query_embedding) as similarity
  from public.goals_unassigned_index ui
  where
    ui.goal_id <> exclude_goal_id
    and ui.user_id <> exclude_user_id
    and ui.activity_status = 'active'
    and ui.embedding is not null
    and 1 - (ui.embedding <=> query_embedding) >= match_threshold
  order by ui.embedding <=> query_embedding
  limit match_count;
$$;
