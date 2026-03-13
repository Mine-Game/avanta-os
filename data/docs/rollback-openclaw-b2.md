# B2 — encrypted full snapshot (disaster recovery)

Цель: восстановление системы после поломки VM/диска.

## Важно
- Этот режим сохраняет **полный state** OpenClaw + полный workspace в зашифрованном виде.
- Пароль шифрования не хранится в репозитории.
- Потеря пароля = невозможность восстановления.

## Создать B2 snapshot
```powershell
cd C:\Users\vboxuser\.openclaw\workspace-finfak\projects\avanta-os
$env:OPENCLAW_B2_PASSPHRASE = "<сильный_пароль>"
.\tools\full-backup-b2.ps1 -Push
Remove-Item Env:OPENCLAW_B2_PASSPHRASE
```

Результат:
- `data/openclaw-full-backup/latest.enc`
- `data/openclaw-full-backup/latest.meta.json`

## Восстановить B2 snapshot на новой VM
```powershell
cd C:\Users\vboxuser\.openclaw\workspace-finfak\projects\avanta-os
.\tools\restore-b2.ps1 -Passphrase "<тот_же_пароль>"
```

Скрипт распакует в `C:\restore-openclaw-b2\snapshot`.
Дальше вручную копируешь:
- `snapshot\openclaw-state` -> `C:\Users\vboxuser\.openclaw-finfak`
- `snapshot\workspace` -> `C:\Users\vboxuser\.openclaw\workspace-finfak`

После копирования:
```powershell
openclaw gateway restart
```

## Рекомендация
- Делать B2 после крупных изменений и минимум 1 раз в день.
- Хранить пароль офлайн (менеджер паролей / бумажный emergency-kit).
