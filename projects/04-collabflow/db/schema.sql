create table if not exists collabflow_workspaces (
  workspace_id uuid primary key,
  name text not null,
  status text not null check (status in ('local_ready', 'sync_ready')),
  created_at timestamptz not null
);

create table if not exists collabflow_snapshots (
  snapshot_id uuid primary key,
  workspace_id uuid not null references collabflow_workspaces(workspace_id) on delete cascade,
  title text not null,
  notes text not null default '',
  tasks jsonb not null default '[]'::jsonb,
  version_vector integer not null check (version_vector >= 0),
  created_at timestamptz not null
);

create index if not exists idx_collabflow_snapshots_workspace_created
  on collabflow_snapshots(workspace_id, created_at);

create table if not exists collabflow_yjs_updates (
  update_id bigserial primary key,
  workspace_id uuid not null references collabflow_workspaces(workspace_id) on delete cascade,
  update_seq bigint not null,
  update_bytes bytea not null,
  update_hash text not null,
  client_id text not null,
  created_at timestamptz not null,
  compacted_at timestamptz,
  unique (workspace_id, update_seq),
  unique (workspace_id, update_hash)
);

create table if not exists collabflow_compaction_checkpoints (
  checkpoint_id uuid primary key,
  workspace_id uuid not null references collabflow_workspaces(workspace_id) on delete cascade,
  compacted_through_seq bigint not null,
  state_vector bytea not null,
  snapshot_update bytea not null,
  created_at timestamptz not null
);

create index if not exists idx_collabflow_yjs_updates_workspace_seq
  on collabflow_yjs_updates(workspace_id, update_seq);

create index if not exists idx_collabflow_yjs_updates_compacted_at
  on collabflow_yjs_updates(compacted_at)
  where compacted_at is not null;

create table if not exists collabflow_workspace_memberships (
  workspace_id uuid not null references collabflow_workspaces(workspace_id) on delete cascade,
  user_id text not null,
  display_name text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, user_id)
);
