# Avanta OS Manual

Обновлено: 2026-03-13 00:00 (Asia/Vladivostok)
Версия: nightly-doc-sync

## 1) Назначение Avanta OS

Avanta OS — операционная оболочка для управления AI-исполнением и продуктовым циклом в 3 модулях:

- **Ops** — оперативное управление, live-мониторинг сессий и cron.
- **Brain** — управленческое мышление и ежедневные сводки.
- **Lab** — эксперименты, прототипы, ночные прогоны и очередь фич.

Ключевой принцип: **никаких mock-данных в UI**, только реальные источники или явный статус отсутствия источника.

---

## 2) Что существует сейчас (по модулям / вкладкам / фичам)

## Ops

### 2.1 Dashboard
**Purpose:** точка входа в операционный слой.

**Что есть:**
- Навигационная карточка в **Mission Control**.
- Заглушки будущих зон:
  - Execution Queue
  - Incident Desk

**Workflow:**
1. Открыть Ops.
2. Нажать Mission Control.
3. Перейти к live-статусам.

### 2.2 Mission Control
**Purpose:** live-обзор модели, активных сессий и cron-здоровья.

**Что есть:**
- Блок **Model Profile** (model/provider/status/context).
- Статус источника:
  - `live source`
  - `stale data`
  - `source not connected`
- Таблица активных сессий (state/model/tokens/age).
- Таблица cron health (name/schedule/last run/status/next run).
- Кнопка refresh.

**Workflow:**
1. Нажать **Refresh status** или дождаться автообновления.
2. Проверить source badge.
3. Просмотреть сессии и crons.
4. При необходимости открыть историю конкретной сессии.

### 2.3 Session Viewer (модальное окно)
**Purpose:** просмотр истории сообщений активной сессии.

**Что есть:**
- Открытие по клику на session card.
- Загрузка истории через `/api/session-history`.
- Realtime-подтягивание новых сообщений.
- Защита чтения: если пользователь скроллит старые сообщения, live-автоскролл не мешает.
- Кнопка «Новых: N · Показать» для возврата к live-голове.

**Workflow:**
1. Открыть сессию из Mission Control.
2. Читать историю (новые сверху).
3. Если отстал от live — нажать кнопку новых сообщений.
4. Закрыть модалку.

---

## Brain

### 3.1 Dashboard
**Purpose:** стратегический центр и запуск интеллектуальных рабочих экранов.

**Что есть:**
- Карточка перехода в **Ежедневные сводки**.
- Заготовки:
  - Strategy Map
  - Cron Planner

**Workflow:**
1. Открыть Brain.
2. Перейти в нужный стратегический экран.

### 3.2 Ежедневные сводки (Daily Summaries)
**Purpose:** единый markdown-канал для ежедневного executive briefing.

**Что есть:**
- История файлов из `data/daily-summaries/*.md`.
- Выбор нужной сводки.
- Встроенный markdown-renderer (заголовки, списки, код, ссылки).
- Показ ошибок источника и пустых состояний.

**Workflow:**
1. Открыть Brain → Ежедневные сводки.
2. Выбрать файл в левой колонке.
3. Прочитать/проанализировать markdown-отчёт.
4. Использовать отчёт как daily planning input.

---

## Lab

### 4.1 Dashboard
**Purpose:** операционный R&D-центр: прототипы, реестр экспериментов, ночные сборки, failed features.

**Что есть:**
- Переключение вьюх:
  - **Prototypes**
  - **Build Logs**
- Индикатор storage mode (`json` или `sqlite+json`).
- Автообновление данных (30 сек + при возврате вкладки).

### 4.2 Prototypes view
**Что есть:**
- Список внутренних прототипов.
- Список client prototypes.
- Experiment Registry.
- **Daily Feature Candidate Queue** с действиями:
  - Approve to prod
  - Iterate
  - Reject
- Поддержка preview URL и открытия sandbox внутри iframe-модалки.

**Workflow:**
1. Проверить кандидатов фич.
2. Открыть preview.
3. Принять решение (approve/iterate/reject).
4. Решение уходит в `/api/lab/decision` и фиксирует статус кандидата.

### 4.3 Build Logs view
**Что есть:**
- Лента nightly runs (из sqlite + cron source).
- Лента self-build записей.
- Блок failed features для анализа сбоев.

**Workflow:**
1. Открыть Build Logs.
2. Проверить статус ночных запусков.
3. Открыть детали неуспешных кейсов.
4. Сформировать action items по надёжности.

### 4.4 Lab Preview Modal
**Purpose:** безопасный просмотр артефактов.

**Что есть:**
- Открытие URL (iframe) или текстового payload.
- Закрытие по кнопке/бекдропу.

---

## 5) API и источники данных

## Core endpoints
- `GET /api/mission-control`
- `GET /api/session-history?sessionKey=...`
- `GET /api/daily-summaries[?file=...]`
- `GET /api/lab`
- `POST /api/lab/decision`
- `POST /api/lab/nightly-candidate`

## Data sources
- Sessions: `C:\Users\vboxuser\.openclaw-finfak\agents\main\sessions\sessions.json`
- Crons: `C:\Users\vboxuser\.openclaw-finfak\cron\jobs.json`
- Daily summaries: `projects/avanta-os/data/daily-summaries/*.md`
- Lab JSON: `projects/avanta-os/data/lab/*.json`
- Lab SQLite: `projects/avanta-os/data/lab/lab.db`

## Port / runtime
- Fixed preview: `http://127.0.0.1:8800/`
- Server: `server.js` (Node HTTP server)

---

## 6) Операционные workflow (сквозные)

## Workflow A — Утренний контроль
1. Ops → Mission Control: проверить source, сессии, cron health.
2. Brain → Daily Summaries: прочитать текущую сводку.
3. Lab → Build Logs: убедиться в наличии run-telemetry и артефактов.
4. Зафиксировать top-3 action на день.

## Workflow B — Отбор nightly feature
1. Lab → Prototypes → Candidate Queue.
2. Открыть preview кандидата.
3. Принять решение (approve/iterate/reject).
4. Проверить обновление статуса в очереди.

## Workflow C — Диагностика сессии
1. Ops → Mission Control → выбрать активную сессию.
2. Просмотреть историю в Session Viewer.
3. При чтении старых сообщений контролировать `Новых: N`.
4. Вернуться к live-голове для актуального состояния.

---

## 7) Recent changes (срез на 2026-03-13 00:00)

Ниже отражены изменения, которые появились/стали явными в текущем состоянии к полуночи:

### Ops
- Добавлен **Session Viewer** с realtime-обновлением истории.
- Реализован режим «не ломать чтение истории» (live pause при скролле вниз).
- Улучшена визуализация статуса источника Mission Control (live/stale/offline).

### Brain
- Вкладка **Ежедневные сводки** стала рабочей: список файлов + markdown-рендеринг.
- Подтягиваются фактические `.md` файлы из `data/daily-summaries`.
- Подготовлен контур для регулярного executive briefing.

### Lab
- Lab расширен из каркаса до операционного экрана:
  - Prototypes / Build Logs views.
  - Candidate Queue с решениями (approve/iterate/reject).
  - Preview modal (URL/text).
- В backend добавлена гибридная модель хранилища (`sqlite+json`).
- Добавлены API для ночного создания кандидатов и фиксации решений.

### Reliability контур
- По сводке 2026-03-12 зафиксировано, что nightly pipeline пока не дал подтверждённых run-результатов (0 run-записей, 0 артефактов).
- Приоритет смещён на telemetry, hard-fail и post-run checks.

---

## 8) Changelog (today)

## 2026-03-13
- Обновлена и сформирована единая документация Avanta OS для Brain docs tab.
- Зафиксировано текущее покрытие по всем модулям, вкладкам и ключевым workflow.
- Добавлен consolidated блок recent changes по Ops/Brain/Lab.
- Добавлен daily changelog-раздел для дальнейших ночных автосинков.

---

## 9) Open gaps / next doc updates

1. Добавить раздел **Architecture map** (UI → API → storage).
2. Вынести **стандарты формата daily summary** в отдельный шаблон.
3. Добавить **SLO/SLA раздел** для nightly pipeline (ожидаемые run-метрики).
4. После внедрения telemetry — добавить в manual таблицу KPI nightly reliability.
