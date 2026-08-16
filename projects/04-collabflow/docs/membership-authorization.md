# CollabFlow Workspace Membership Authorization Contract

CollabFlow uses development client identity for local sync and enforces workspace membership at the HTTP and websocket boundaries. This is not production authentication, but it proves the authorization shape before OAuth or password login is added.

## Development Identity

The development API accepts these headers until a real identity provider is added:

```text
X-CollabFlow-User-Id: user_123
X-CollabFlow-Display-Name: Krishna
```

These headers are not authentication. They are a stable local identity envelope so route ownership, membership checks, presence labels, and audit fields can be implemented before OAuth or password login.

## Roles

| Role | Can read | Can edit | Can export snapshot | Can manage members |
| --- | --- | --- | --- | --- |
| `owner` | Yes | Yes | Yes | Yes |
| `editor` | Yes | Yes | Yes | No |
| `viewer` | Yes | No | No | No |

The creator of a workspace becomes its first `owner`. Owners can invite members and change roles. A workspace must always have at least one owner.

## Membership Table

```sql
create table collabflow_workspace_memberships (
  workspace_id uuid not null references collabflow_workspaces(workspace_id) on delete cascade,
  user_id text not null,
  display_name text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, user_id)
);
```

This table is intentionally separate from Yjs update history. Membership decides who can join a room or mutate a workspace; CRDT updates still remain opaque document bytes. File-mode local checks persist the same membership shape inside `.data/snapshots.json`.

## Route Rules

| Route | Required role |
| --- | --- |
| `POST /api/workspaces` | Creates an `owner` membership for the caller. |
| `GET /api/workspaces` | Returns workspaces where caller is a member. |
| `GET /api/workspaces/{workspace_id}` | `viewer`, `editor`, or `owner`. |
| `GET /api/workspaces/{workspace_id}/sync-contract` | `viewer`, `editor`, or `owner`. |
| `WS /ws/collabflow` `sync_request` | `viewer`, `editor`, or `owner` to join; only `editor` or `owner` may send `yjs_update`. |
| `GET /api/workspaces/{workspace_id}/snapshots` | `viewer`, `editor`, or `owner`. |
| `POST /api/workspaces/{workspace_id}/snapshots` | `editor` or `owner`. |
| `POST /api/workspaces/{workspace_id}/members` | `owner`. |
| `PATCH /api/workspaces/{workspace_id}/members/{user_id}` | `owner`. |
| `DELETE /api/workspaces/{workspace_id}/members/{user_id}` | `owner`, while preserving at least one owner. |

Viewer websocket sessions may receive replay and presence but must not broadcast document updates. They may still send awareness updates because presence is not durable document state.

## Failure Responses

- Missing local identity header: `401` for HTTP routes and `sync_error` with `detail: "Missing workspace identity."` for websocket joins.
- Non-member workspace access: `404` rather than `403`, so private workspace ids are not confirmed.
- Member without enough role: `403`.
- Attempt to remove or demote the last owner: `409`.

## Deferred Production Auth

OAuth, password login, signed session cookies, and invite tokens are deferred. The contract should survive that migration because route authorization depends on `user_id` and role, not on how the user was authenticated.
