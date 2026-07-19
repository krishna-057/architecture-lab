# Daily AI Contributor Workflow

This file defines how a daily AI contributor should work in this repository.

## Daily Startup

1. Check git status.
2. Pull the latest changes if a remote exists.
3. Read:
   - `MASTER_PLAN.md`
   - `progress/DAILY_LOG.md`
   - The active project's `README.md`
   - The active project's `ARCHITECTURE.md`
   - The active project's `DECISIONS.md`
4. Select the next task from `progress/TASK_QUEUE.md`.
5. Keep the scope small enough to finish in one session.

## During Implementation

Prefer this order:

1. Create or update tests where useful.
2. Implement the smallest vertical slice.
3. Update architecture or decision docs when a meaningful choice is made.
4. Run relevant checks.
5. Record what changed in `progress/DAILY_LOG.md`.

## Definition Of Done

A daily task is done when:

- The code or documentation change is complete.
- Relevant checks were run, or the reason they could not run is documented.
- The progress log has been updated.
- Git status is understood.
- A commit is prepared or created.

## Human Approval Rules

The AI contributor may do these without asking:

- Create branches.
- Edit project code and docs.
- Add tests.
- Run local commands.
- Commit changes.

The AI contributor should ask before:

- Pushing directly to `main` or `master`.
- Deploying.
- Deleting data.
- Changing billing or paid services.
- Rotating credentials.
- Performing account actions.

Human-only tasks:

- OTP or 2FA.
- CAPTCHA.
- Payment approval.
- Private account login.
- Any action that legally requires the user's direct consent.

## Human Notification Fallback

If Codex mobile notifications are not available, use GitHub Issues as the blocker notification channel.

When human input is needed:

1. Create or update a GitHub issue titled `Human needed: <short reason>`.
2. Add the `human-needed` label if possible.
3. Explain the exact action required from the user.
4. Include branch, commit, workspace, and relevant command output.
5. Stop until the user replies or completes the required action.

See `NOTIFICATIONS.md`.

## Documentation Style

Write documentation like an engineer defending design choices in an interview:

- State the decision.
- Explain why it fits this project.
- Compare the rejected alternatives.
- Mention tradeoffs.
- Avoid vague claims like "scalable" unless the mechanism is named.

## Avoid Overengineering

Do not add:

- Kubernetes before local Docker Compose is insufficient.
- Microservices before a boundary has real independent lifecycle needs.
- Event sourcing unless history replay is core to the project.
- Complex folder abstractions before multiple modules need them.
- Generic libraries when a local function is clearer.
