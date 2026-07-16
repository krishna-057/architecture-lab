# Project Repository Strategy

The five portfolio builds are independent projects, not features of one product. The lab repository remains useful for planning, shared progress notes, and automation coordination, but project code should also live in each project's own private GitHub repository.

## Private Project Repositories

| Project | Private repository | Source folder in this lab |
| --- | --- | --- |
| FlashReserve | `https://github.com/krishna-057/FlashReserve` | `projects/01-flashreserve` |
| PocketSentinel | `https://github.com/krishna-057/PocketSentinel` | `projects/02-pocketsentinel` |
| PersonaBridge | `https://github.com/krishna-057/PersonaBridge` | `projects/03-personabridge` |
| CollabFlow | `https://github.com/krishna-057/CollabFlow` | `projects/04-collabflow` |
| HookRelay | `https://github.com/krishna-057/HookRelay` | `projects/05-hookrelay` |

## Push Policy

Daily project work should produce ordinary incremental commits in the active project's private repository. Avoid large catch-up dumps. When code still starts inside the lab workspace, split or mirror only the active project folder into the matching repository before the daily run is considered complete.

Use history-preserving splits when moving existing lab work into project repositories. The first split on 2026-07-16 used `git subtree split` so each private repository received the commits that touched that project, with original commit dates and messages preserved.

The lab repository can still receive planning updates, daily logs, task queue changes, and cross-project documentation. Project implementation commits should be visible in the matching private project repository.
