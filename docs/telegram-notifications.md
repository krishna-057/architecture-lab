# Telegram Notifications

Telegram is the fast personal notification channel for the AI contributor workflow. GitHub Issues remain the durable fallback for blockers and audit trails.

## One-Time Setup

1. Open Telegram.
2. Search for the bot.
3. Send:

```text
/start
```

4. From this repo, run:

```powershell
.\scripts\telegram-updates.ps1
```

5. Copy the `ChatId` value into the local ignored file `.env.telegram`:

```text
TELEGRAM_CHAT_ID=<your-chat-id>
```

6. Test sending:

```powershell
.\scripts\telegram-notify.ps1 -Message "FlashReserve notification test"
```

## Local Secret File

Real secrets live in `.env.telegram`, which is ignored by git.

Expected local shape:

```text
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_CHAT_ID=<chat-id>
```

Do not commit real bot tokens.

## Usage Pattern

Use Telegram for quick pings:

- Work completed
- Human approval needed
- Local setup failed
- Daily summary ready

Use GitHub Issues for durable blockers:

- Auth needed
- Deployment approval needed
- Destructive action approval needed
- Anything requiring a traceable decision

