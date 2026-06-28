# CollabFlow

CollabFlow is a local-first collaborative workspace for shared tasks, notes, and lightweight diagrams.

## Architecture Focus

- CRDT-based collaboration
- Presence
- Offline persistence
- Conflict-free sync
- Snapshot and export model

## Proposed Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js | Product UI and routing consistency across the lab. |
| Collaboration | Yjs | Mature CRDT library for shared documents and awareness. |
| Persistence | IndexedDB | Browser-local offline state. |
| Sync | y-websocket or small Node sync server | Minimal sync layer for collaboration. |
| Database | PostgreSQL | Durable workspace metadata and snapshots. |

## Why This Project Matters

This project demonstrates consistency models beyond normal CRUD. It gives strong interview material around collaboration, conflict handling, and offline-first design.

