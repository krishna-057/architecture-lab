# CollabFlow Signed Session Identity Notes

CollabFlow now enforces the production-shaped identity boundary with signed session cookies while keeping development identity headers as a local fallback. The signed session identifies the user; workspace authorization still comes from membership role checks.

## Session Shape

Use an HTTP-only, secure, same-site cookie:

```text
collabflow_session=<signed session token>
```

The signed token should contain only stable identity metadata:

```json
{
  "session_id": "sess_...",
  "user_id": "user_...",
  "display_name": "Krishna",
  "issued_at": "2026-08-16T00:00:00Z",
  "expires_at": "2026-08-23T00:00:00Z"
}
```

The token must not contain workspace roles. Roles are loaded from `collabflow_workspace_memberships` on each request so role changes and removals take effect without waiting for session expiry.

## Verification Rule

Every HTTP request resolves identity in this order:

1. Verify `collabflow_session` with `COLLABFLOW_SESSION_SIGNING_SECRET`.
2. Load `user_id` and `display_name` from the verified payload.
3. Evaluate workspace membership with the existing owner/editor/viewer rules.
4. Reject missing or invalid sessions with `401`.

Development identity headers remain a local-only fallback when `COLLABFLOW_DEV_IDENTITY_HEADERS=true`.

`COLLABFLOW_PREVIOUS_SESSION_SIGNING_SECRET` may be set during rotation so active sessions can survive a short overlap window.

## WebSocket Handshake

The websocket authenticates before accepting durable sync work:

1. Browser opens `WS /ws/collabflow` with the session cookie.
2. Server verifies the signed session and binds `user_id` to the connection.
3. `sync_request` still supplies `workspace_id` and `room_id`.
4. Server checks membership before joining the room.
5. Only `owner` and `editor` connections may send `yjs_update`; viewers may send `awareness_update`.

Do not trust a websocket `user_id` field when `collabflow_session` is present. The server-owned session identity replaces the development payload identity; payload identity is accepted only through the local fallback path.

## CSRF Rule

Because the session is cookie-based, mutating HTTP routes need CSRF protection:

- `POST /api/workspaces`
- `POST /api/workspaces/{workspace_id}/snapshots`
- `POST /api/workspaces/{workspace_id}/members`
- `PATCH /api/workspaces/{workspace_id}/members/{user_id}`
- `DELETE /api/workspaces/{workspace_id}/members/{user_id}`

Use a double-submit token: an `X-CollabFlow-CSRF` header must match a non-HTTP-only `collabflow_csrf` cookie. Read-only routes do not need the CSRF header.

## Logout And Rotation

Sessions should expire quickly enough for a portfolio app, for example seven days. Logout can clear the cookie immediately. Secret rotation should accept a current and previous signing secret for a short overlap window, then retire the previous secret after active sessions expire.

## Runtime Scope

Runtime enforcement now verifies signed cookie sessions, checks CSRF tokens on mutating cookie-backed HTTP requests, and binds websocket membership to the verified session identity. Login, logout endpoint wiring, invitation tokens, and real user registration remain deferred because this lab slice is focused on the authorization boundary, not account management.
