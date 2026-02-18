-- Users table for emoji-pin authentication
create table if not exists public.users (
  id            uuid        primary key default gen_random_uuid(),
  username      text        unique not null,
  password_hash text        not null,   -- argon2id hash of the 4-emoji pin
  created_at    timestamptz not null default now()
);

-- Fast lookup by username
create index if not exists users_username_idx on public.users (username);

-- Row-Level Security: users can only read their own row (service role bypasses)
alter table public.users enable row level security;

create policy "service_role_all" on public.users
  as permissive for all
  to service_role
  using (true)
  with check (true);
