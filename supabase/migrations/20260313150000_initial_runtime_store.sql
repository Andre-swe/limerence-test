create extension if not exists vector;

insert into storage.buckets (id, name, public)
values ('limerence-uploads', 'limerence-uploads', true)
on conflict (id) do nothing;

create table if not exists runtime_store (
  store_key text primary key,
  revision bigint not null default 1,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists personas (
  id text primary key,
  user_id text not null references users(id),
  name text not null,
  relationship text not null,
  source text not null,
  description text not null,
  status text not null,
  avatar_url text,
  pasted_text text not null default '',
  screenshot_summaries jsonb not null default '[]'::jsonb,
  interview_answers jsonb not null default '{}'::jsonb,
  heartbeat_policy jsonb not null,
  voice jsonb not null,
  consent jsonb not null,
  dossier jsonb not null,
  mind_state jsonb not null,
  telegram_chat_id bigint,
  telegram_username text,
  last_active_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists voice_samples (
  id text primary key,
  persona_id text not null references personas(id) on delete cascade,
  file_name text not null,
  original_name text not null,
  url text not null,
  mime_type text not null,
  size integer not null
);

create table if not exists screenshots (
  id text primary key,
  persona_id text not null references personas(id) on delete cascade,
  file_name text not null,
  original_name text not null,
  url text not null,
  mime_type text not null,
  size integer not null,
  extracted_text text
);

create table if not exists messages (
  id text primary key,
  persona_id text not null references personas(id) on delete cascade,
  role text not null,
  kind text not null,
  channel text not null,
  body text not null,
  audio_url text,
  audio_status text not null,
  reply_mode text,
  delivery jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists feedback_events (
  id text primary key,
  persona_id text not null references personas(id) on delete cascade,
  message_id text not null,
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists processed_telegram_updates (
  update_id text primary key,
  created_at timestamptz not null default now()
);
