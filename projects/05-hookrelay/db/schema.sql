create table if not exists webhook_endpoints (
  endpoint_id text primary key,
  name text not null,
  target_url text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  signing_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists webhook_events (
  event_id text primary key,
  endpoint_id text not null references webhook_endpoints(endpoint_id),
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null,
  status text not null default 'accepted' check (status in ('accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint_id, idempotency_key)
);

create table if not exists delivery_attempts (
  delivery_id text primary key,
  event_id text not null references webhook_events(event_id),
  endpoint_id text not null references webhook_endpoints(endpoint_id),
  target_url text not null,
  status text not null default 'queued' check (status in ('queued', 'delivering', 'succeeded', 'failed', 'dead_letter')),
  attempt_number integer not null check (attempt_number > 0),
  next_attempt_at timestamptz not null,
  base_delay_seconds integer not null default 0,
  jitter_seconds integer not null default 0,
  scheduled_delay_seconds integer not null default 0,
  response_status integer,
  error text,
  replayed_from_delivery_id text references delivery_attempts(delivery_id),
  replay_reason text,
  replay_requested_by text,
  signature_headers jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table delivery_attempts
  add column if not exists base_delay_seconds integer not null default 0,
  add column if not exists jitter_seconds integer not null default 0,
  add column if not exists scheduled_delay_seconds integer not null default 0,
  add column if not exists replay_reason text,
  add column if not exists replay_requested_by text;

create index if not exists idx_webhook_events_endpoint_created
  on webhook_events(endpoint_id, created_at desc);

create index if not exists idx_delivery_attempts_event_created
  on delivery_attempts(event_id, created_at desc);

create index if not exists idx_delivery_attempts_status_next
  on delivery_attempts(status, next_attempt_at);
