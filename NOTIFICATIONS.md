# Notification Plan

Codex mobile notifications are not required for this project.

The fallback notification channel is GitHub Issues because the project already lives on GitHub and GitHub can notify through the mobile app or email.

## Primary Fallback: GitHub Issues

When the daily AI contributor needs human input, it should:

1. Create or update an issue titled `Human needed: <short reason>`.
2. Add the label `human-needed` if labels are available.
3. Mention the required action clearly.
4. Include the current branch, commit, and exact blocker.
5. Stop if continuing would require guessing, credentials, OTP, billing, deployment approval, or destructive action.

Example issue body:

```text
Human action needed.

Reason:
GitHub auth is required before pushing today's branch.

What I need from you:
Run .\scripts\gh.ps1 auth login and approve the browser/phone prompt.

Current state:
- Workspace: K:\AutoPilot_Projects\FlashReserve
- Branch: codex/flashreserve-reservation-api
- Last commit: abc1234
```

## User Setup

Install the GitHub mobile app or enable email notifications for the repository:

```text
https://github.com/krishna-057/architecture-lab
```

Recommended GitHub notification setting:

```text
Watch -> Custom -> Issues
```

If you do not want all issue notifications, watch only participating/mentions and the AI will mention your username in blocker issues.

## Optional Later Channels

These can be added later if GitHub notifications are not enough:

- Telegram bot
- Discord webhook
- Email via SMTP
- ntfy topic
- Slack webhook

For this project, GitHub Issues is the least extra infrastructure.

