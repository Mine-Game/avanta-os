# Nightly Feature Generator (Design)

Каждую ночь cron должен:
1. Анализировать контекст (SOUL.md, USER.md, MEMORY.md, codebase).
2. Сформировать shortlist из 3-5 идей.
3. Рассчитать score: impact/effort/risk/strategic-fit.
4. Выбрать топ-1 и создать запись через `POST /api/lab/nightly-candidate` (назначается отдельный preview-port, не 8800).
5. Подготовить sandbox preview URL на выделенном порту.
6. Записать run в nightly logs.

Decision gate:
- approve -> `approved_for_prod`
- iterate -> `needs_iteration`
- reject -> `rejected`
