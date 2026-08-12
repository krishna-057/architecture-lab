create table if not exists producer_api_keys (
  key_id text primary key,
  owner_id text not null,
  name text not null,
  role text not null default 'producer' check (role in ('producer', 'operator', 'admin')),
  key_hash text not null unique,
  key_preview text not null,
  status text not null default 'active' check (status in ('active', 'disabled', 'rotated', 'revoked')),
  rotated_from_key_id text references producer_api_keys(key_id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists webhook_endpoints (
  endpoint_id text primary key,
  owner_id text not null default 'owner_demo',
  name text not null,
  target_url text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  signing_secret text not null,
  rate_limit_per_minute integer not null default 60 check (rate_limit_per_minute > 0),
  rate_limit_window_seconds integer not null default 60 check (rate_limit_window_seconds > 0),
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
  failure_class text,
  error text,
  replayed_from_delivery_id text references delivery_attempts(delivery_id),
  replay_reason text,
  replay_requested_by text,
  signature_headers jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists delivery_observability_spans (
  span_id text primary key,
  trace_id text not null,
  parent_span_id text,
  name text not null,
  delivery_id text,
  event_id text,
  endpoint_id text,
  status text not null check (status in ('ok', 'error')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_ms integer not null,
  attributes jsonb not null default '{}'::jsonb,
  error text
);

create table if not exists delivery_saved_views (
  view_id text primary key,
  owner_id text not null,
  name text not null,
  filters jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists receiver_failure_alert_routes (
  route_id text primary key,
  owner_id text not null,
  name text not null,
  failure_class text,
  delivery_status text not null default 'dead_letter' check (delivery_status in ('failed', 'dead_letter', 'any')),
  target_type text not null default 'dashboard' check (target_type in ('dashboard', 'email', 'webhook')),
  target text not null,
  notification_signing_secret text not null,
  enabled boolean not null default true,
  suppression_window_seconds integer not null default 0 check (suppression_window_seconds >= 0),
  last_alert_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists receiver_failure_alerts (
  alert_id text primary key,
  route_id text not null references receiver_failure_alert_routes(route_id) on delete cascade,
  owner_id text not null,
  delivery_id text not null,
  endpoint_id text not null,
  event_id text not null,
  failure_class text,
  delivery_status text not null,
  target_type text not null,
  target text not null,
  notification_signing_secret text,
  message text not null,
  notification_status text not null default 'pending' check (notification_status in ('pending', 'delivered', 'failed', 'skipped')),
  notification_response_status integer,
  notification_error text,
  notification_attempted_at timestamptz,
  notification_attempt_count integer not null default 0 check (notification_attempt_count >= 0),
  notification_next_retry_at timestamptz,
  notification_retry_exhausted boolean not null default false,
  acknowledged_at timestamptz,
  acknowledged_by text,
  acknowledgement_note text,
  created_at timestamptz not null default now()
);

alter table delivery_attempts
  add column if not exists base_delay_seconds integer not null default 0,
  add column if not exists jitter_seconds integer not null default 0,
  add column if not exists scheduled_delay_seconds integer not null default 0,
  add column if not exists failure_class text,
  add column if not exists replay_reason text,
  add column if not exists replay_requested_by text;

alter table webhook_endpoints
  add column if not exists owner_id text not null default 'owner_demo',
  add column if not exists rate_limit_per_minute integer not null default 60,
  add column if not exists rate_limit_window_seconds integer not null default 60;

alter table producer_api_keys
  add column if not exists role text not null default 'producer',
  add column if not exists rotated_from_key_id text references producer_api_keys(key_id),
  add column if not exists revoked_at timestamptz;

alter table receiver_failure_alerts
  add column if not exists notification_status text not null default 'pending',
  add column if not exists notification_response_status integer,
  add column if not exists notification_error text,
  add column if not exists notification_signing_secret text,
  add column if not exists notification_attempted_at timestamptz,
  add column if not exists notification_attempt_count integer not null default 0,
  add column if not exists notification_next_retry_at timestamptz,
  add column if not exists notification_retry_exhausted boolean not null default false,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by text,
  add column if not exists acknowledgement_note text;

alter table receiver_failure_alerts
  drop constraint if exists receiver_failure_alerts_notification_status_check;

alter table receiver_failure_alerts
  add constraint receiver_failure_alerts_notification_status_check
  check (notification_status in ('pending', 'delivered', 'failed', 'skipped'));

alter table receiver_failure_alerts
  drop constraint if exists receiver_failure_alerts_notification_attempt_count_check;

alter table receiver_failure_alerts
  add constraint receiver_failure_alerts_notification_attempt_count_check
  check (notification_attempt_count >= 0);

alter table receiver_failure_alert_routes
  add column if not exists notification_signing_secret text,
  add column if not exists suppression_window_seconds integer not null default 0,
  add column if not exists last_alert_at timestamptz;

alter table producer_api_keys
  drop constraint if exists producer_api_keys_role_check;

alter table producer_api_keys
  add constraint producer_api_keys_role_check
  check (role in ('producer', 'operator', 'admin'));

alter table producer_api_keys
  drop constraint if exists producer_api_keys_status_check;

alter table producer_api_keys
  add constraint producer_api_keys_status_check
  check (status in ('active', 'disabled', 'rotated', 'revoked'));

create index if not exists idx_webhook_events_endpoint_created
  on webhook_events(endpoint_id, created_at desc);

create index if not exists idx_producer_api_keys_owner_created
  on producer_api_keys(owner_id, created_at desc);

create index if not exists idx_delivery_attempts_event_created
  on delivery_attempts(event_id, created_at desc);

create index if not exists idx_delivery_attempts_status_next
  on delivery_attempts(status, next_attempt_at);

create index if not exists idx_delivery_attempts_endpoint_created
  on delivery_attempts(endpoint_id, created_at desc, delivery_id desc);

create index if not exists idx_delivery_attempts_failure_created
  on delivery_attempts(failure_class, created_at desc, delivery_id desc);

create index if not exists idx_delivery_attempts_endpoint_cursor
  on delivery_attempts(endpoint_id, created_at desc, delivery_id desc);

create index if not exists idx_delivery_attempts_failure_cursor
  on delivery_attempts(failure_class, created_at desc, delivery_id desc);

create index if not exists idx_delivery_saved_views_owner_created
  on delivery_saved_views(owner_id, created_at desc);

create index if not exists idx_failure_alert_routes_owner_created
  on receiver_failure_alert_routes(owner_id, created_at desc);

create index if not exists idx_failure_alerts_owner_created
  on receiver_failure_alerts(owner_id, created_at desc);

create index if not exists idx_delivery_observability_spans_trace
  on delivery_observability_spans(trace_id, started_at desc);

create index if not exists idx_delivery_observability_spans_delivery
  on delivery_observability_spans(delivery_id, started_at desc);
