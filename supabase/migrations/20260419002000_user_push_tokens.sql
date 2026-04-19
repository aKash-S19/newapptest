create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  expo_push_token text not null,
  device_id text,
  platform text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create index if not exists user_push_tokens_user_active_idx
  on public.user_push_tokens (user_id, is_active);

create index if not exists user_push_tokens_token_idx
  on public.user_push_tokens (expo_push_token);

alter table public.user_push_tokens enable row level security;

revoke all on public.user_push_tokens from anon, authenticated;
grant select, insert, update, delete on public.user_push_tokens to service_role;

drop policy if exists "service_role_push_tokens" on public.user_push_tokens;

create policy "service_role_push_tokens"
  on public.user_push_tokens
  for all
  to service_role
  using (true)
  with check (true);
