# Setup Checklist

This is the user-side setup checklist for running the portfolio lab as a daily AI contributor project.

## 1. GitHub Repository

Create an empty GitHub repository.

Recommended name if you want one repo for the whole 30-day lab:

```text
architecture-lab
```

Recommended name if you want this repo to focus on the first active project:

```text
flashreserve
```

After creating it, connect this local repo:

```powershell
git remote add origin git@github.com:<your-username>/architecture-lab.git
git branch -M main
git push -u origin main
```

If you use HTTPS instead of SSH:

```powershell
git remote add origin https://github.com/<your-username>/architecture-lab.git
git branch -M main
git push -u origin main
```

## 2. Git Identity

Check your git identity:

```powershell
git config --global user.name
git config --global user.email
```

Set it if needed:

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## 3. GitHub Auth

Choose one:

### Recommended: SSH

Check whether SSH works:

```powershell
ssh -T git@github.com
```

If it fails, create/add an SSH key in GitHub.

### Alternative: GitHub CLI

GitHub CLI is installed portably in this workspace to avoid using space on `C:`.

Use:

```powershell
.\scripts\gh.ps1 auth login
.\scripts\gh.ps1 auth status
```

GitHub CLI is useful later for creating pull requests automatically.

## 4. Local Tools

Install or verify:

```powershell
node --version
npm --version
docker --version
docker compose version
git --version
```

Recommended:

- Node.js LTS
- Docker Desktop
- Git
- GitHub CLI

## 5. Codex Automation Requirements

Before creating a daily automation, confirm:

- This workspace path stays available.
- GitHub auth works without interactive login.
- Docker Desktop can run when needed.
- You are comfortable with the AI creating branches and commits.
- Direct pushes to `main` are disabled or avoided if you want review first.

## 6. Suggested Daily Automation Prompt

Use this after the repo is pushed and auth is working:

```text
Work as the daily AI contributor for this 30-day full-stack architecture portfolio lab.

Start by checking git status and pulling latest changes if a remote exists. Read MASTER_PLAN.md, WORKFLOW.md, progress/DAILY_LOG.md, progress/TASK_QUEUE.md, and the active project's docs.

Pick exactly one small task from the active project's Ready queue. Implement it with the least overengineered approach that still supports the documented architecture. Update docs whenever you make or rely on a design decision. Run relevant checks. Update progress/DAILY_LOG.md and progress/TASK_QUEUE.md. Commit the finished work with a clear message. Push a branch if GitHub auth is available. If a human action is required, stop and clearly explain what is needed.
```
