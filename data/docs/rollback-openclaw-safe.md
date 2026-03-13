# Safe rollback (Avanta + OpenClaw state)

Режим: **без секретов** (tokens/cookies/sessions не сохраняются).

## Что бэкапится
- `projects/avanta-os` (обычный git-репозиторий)
- `data/openclaw-safe-backup/openclaw-state/openclaw.json` (redacted)
- `data/openclaw-safe-backup/openclaw-state/cron/jobs.json`
- `data/openclaw-safe-backup/workspace/*.md` и `workspace/memory/*.md`

## Как сделать свежий safe-backup
```powershell
cd C:\Users\vboxuser\.openclaw\workspace-finfak\projects\avanta-os
.\tools\safe-backup.ps1 -Push
```

## Быстрый откат проекта Avanta
```powershell
cd C:\Users\vboxuser\.openclaw\workspace-finfak\projects\avanta-os
git fetch --all
git log --oneline --decorate -n 20
git reset --hard <commit_sha>
git push origin main --force-with-lease
git push backup main --force-with-lease
```

## Откат cron-конфига OpenClaw
1. Скопировать `data/openclaw-safe-backup/openclaw-state/cron/jobs.json`
2. Восстановить в:
   `C:\Users\vboxuser\.openclaw-finfak\cron\jobs.json`
3. Перезапустить gateway:
```powershell
openclaw gateway restart
```

## Важно
- После полного падения/переезда потребуется заново авторизовать интеграции (секреты не бэкапятся в safe-режиме).
- Источник backup remote: `git@github.com:Mine-Game/avanta-os-backup.git`
