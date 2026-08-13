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
