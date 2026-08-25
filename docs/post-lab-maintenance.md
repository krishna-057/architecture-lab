# Post-Lab Maintenance Plan

The 30-day architecture lab is complete. The daily contributor cadence should stop after this archive task is pushed, because continuing to make daily changes would dilute the portfolio signal with low-value churn.

## Status

- The five project repositories are created and mapped in `docs/project-repositories.md`.
- The final cross-project demo order lives in `PORTFOLIO_INDEX.md`.
- CollabFlow has explicit final scaling and portfolio-completion notes.
- HookRelay has the deepest production-shaped reliability slice.
- FlashReserve, PocketSentinel, and PersonaBridge have focused architecture slices with clear intentional deferrals.

## Recommended Cadence

### Weekly Review

Run this only when preparing for interviews or after meaningful local changes:

1. Pull the lab branch and each private project repository.
2. Run the lightweight validation scripts:
   - `node scripts/check-portfolio-index.mjs`
   - Project-local `scripts/check-workspace.mjs` where present.
3. Open `PORTFOLIO_INDEX.md` and rehearse one project demo path.
4. Record only real improvements in `progress/DAILY_LOG.md`.

### Monthly Maintenance

Use this for portfolio upkeep, not feature churn:

1. Check dependency audit output for each npm-based project.
2. Refresh README screenshots or demo notes if the UI changes.
3. Confirm private repositories still exist and have expected visibility.
4. Review deferred-work lists and pick only one meaningful improvement if needed.

### Before An Interview

1. Choose two primary projects for the target role.
2. Run their local checks.
3. Prepare one happy-path demo and one failure-mode explanation per selected project.
4. Use `PORTFOLIO_INDEX.md` for positioning, not as a script to read aloud.

## Stop Conditions For Daily Automation

The daily automation should be stopped when:

- The final portfolio index exists.
- The task queue has no remaining build-lab Ready task.
- The maintenance cadence is documented.
- The latest archive commit is pushed to GitHub.

Those conditions are satisfied by this maintenance archive slice. Future automation should be created only for a specific follow-up goal, such as dependency refresh, demo recording, or one targeted production-hardening task.

## Future Task Intake

Use this filter before adding new work:

- Does it strengthen an interview story?
- Can it be explained with a concrete architecture tradeoff?
- Is it more valuable than improving the demo/readme for an existing slice?
- Can it finish in one focused session with checks?

If the answer is no, do not add it to the queue.
