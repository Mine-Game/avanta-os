# Self-Improve Nightly Cron Template

## Цель
Каждую ночь выполнять безопасный цикл самосовершенствования в sandbox, без деплоя в production.

## Pipeline
1. Прочитать контекст (SOUL.md, USER.md, MEMORY.md, модульные файлы Avanta OS).
2. Выбрать **1 улучшение** с максимальным ROI и минимальным риском.
3. Реализовать в локальном sandbox-ветке.
4. Прогнать проверки (lint/tests/smoke).
5. Записать результат в Lab:
   - nightly_runs
   - failed features (если broken)
   - experiment registry
6. Сформировать краткий отчёт для утреннего review.

## Guardrails
- Никаких автоматических production изменений.
- Любой клиентский функционал сначала в `client_prototypes`.
- Если тесты падают — rollback и запись урока в failure log.
