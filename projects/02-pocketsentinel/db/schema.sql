create table if not exists detection_events (
    event_id uuid primary key,
    session_id uuid not null,
    label varchar(80) not null,
    confidence double precision not null check (confidence >= 0 and confidence <= 1),
    occurred_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index if not exists detection_events_session_occurred_at_idx
    on detection_events (session_id, occurred_at desc);
