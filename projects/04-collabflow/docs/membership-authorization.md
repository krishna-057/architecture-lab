# CollabFlow Workspace Membership Authorization Contract

CollabFlow uses signed session cookies for the production-shaped identity boundary and keeps development client identity headers for local sync. Workspace membership is enforced at the HTTP and websocket boundaries either way.

## Identity Resolution

The API first looks for a signed `collabflow_session` cookie. If present, the cookie must verify with `COLLABFLOW_SESSION_SIGNING_SECRET`, must not be expired, and supplies the server-owned `user_id` and `display_name`. A previous signing secret can be configured during short rotation windows.

`POST /api/session` can issue that cookie for local portfolio use, and `DELETE /api/session` clears it. Those endpoints prove the session lifecycle, but they are not a full account system.

Development headers remain available only when `COLLABFLOW_DEV_IDENTITY_HEADERS=true`:

The development API accepts these headers until a real identity provider is added:

```text
X-CollabFlow-User-Id: user_123
X-CollabFlow-Display-Name: Krishna
```

These headers are not production authentication. They are a stable local identity envelope so route ownership, membership checks, presence labels, and audit fields can be exercised before OAuth or password login.

Cookie-backed mutating HTTP requests require the double-submit CSRF token: `X-CollabFlow-CSRF` must match the `collabflow_csrf` cookie. Read routes do not require that header.

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
| `POST /api/session` | Issues a signed session for local portfolio use. |
| `DELETE /api/session` | Clears the signed session after CSRF validation. |
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

- Missing or invalid session, or missing local identity fallback: `401` for HTTP routes and `sync_error` for websocket joins.
- Missing or invalid CSRF token on cookie-backed mutation: `403`.
- Non-member workspace access: `404` rather than `403`, so private workspace ids are not confirmed.
- Member without enough role: `403`.
- Attempt to remove or demote the last owner: `409`.

## Deferred Account Management

Signed session enforcement and local issuance are documented in `docs/signed-session-identity.md`. OAuth, password login, invite tokens, and user registration remain deferred. The contract should survive that migration because route authorization depends on `user_id` and role, not on how the user was authenticated.
