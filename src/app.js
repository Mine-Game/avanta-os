const workspace = document.getElementById('workspace');
const dockButtons = [...document.querySelectorAll('.dock-item')];
const refreshStatusBtn = document.getElementById('refreshStatusBtn');

let sessionViewerRealtimeInFlight = false;

const state = {
  currentModule: 'ops',
  refreshInFlight: false,
  tabsByModule: {
    ops: [
      { id: 'ops-dashboard', title: 'Обзор' },
      { id: 'ops-mission-control', title: 'Центр управления' },
    ],
    brain: [
      { id: 'brain-dashboard', title: 'Обзор' },
      { id: 'brain-daily-summaries', title: 'Ежедневные сводки' },
      { id: 'brain-automation', title: 'Автоматизация' },
    ],
    lab: [{ id: 'lab-dashboard', title: 'Обзор' }],
  },
  activeTabByModule: {
    ops: 'ops-mission-control',
    brain: 'brain-dashboard',
    lab: 'lab-dashboard',
  },
  missionControl: {
    model: null,
    provider: null,
    status: null,
    context: null,
    sessions: [],
    crons: [],
    sourceConnected: false,
    stale: false,
    error: null,
    lastSyncAt: null,
  },
  sessionViewer: {
    open: false,
    loading: false,
    error: null,
    session: null,
    history: [],
    historySig: '',
    scrollTop: 0,
    isUserBrowsingHistory: false,
    pendingNewCount: 0,
  },
  dailySummaries: {
    loading: false,
    error: null,
    items: [],
    selectedFile: null,
    content: '',
  },
  automation: {
    loading: false,
    error: null,
    jobs: [],
    selectedJobId: null,
  },
  lab: {
    loading: false,
    error: null,
    storageMode: 'json',
    activeView: 'prototypes',
    prototypes: [],
    experiments: [],
    nightlyBuilds: [],
    selfBuilds: [],
    failedFeatures: [],
    clientPrototypes: [],
    featureCandidates: [],
    preview: {
      open: false,
      title: '',
      type: 'text',
      url: '',
      content: '',
    },
  },
};

function setModule(moduleId) {
  state.currentModule = moduleId;
  dockButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.module === moduleId));

  if (moduleId === 'brain' && state.activeTabByModule.brain === 'brain-daily-summaries') loadDailySummaries();
  if (moduleId === 'brain' && state.activeTabByModule.brain === 'brain-automation') loadAutomationData();
  if (moduleId === 'lab') loadLabData();

  render();
}

function setActiveTab(tabId) {
  state.activeTabByModule[state.currentModule] = tabId;

  if (state.currentModule === 'brain' && tabId === 'brain-daily-summaries') loadDailySummaries();
  if (state.currentModule === 'brain' && tabId === 'brain-automation') loadAutomationData();
  if (state.currentModule === 'lab' && tabId === 'lab-dashboard') loadLabData();

  render();
}

function reorderTabs(moduleId, fromIndex, toIndex) {
  const tabs = state.tabsByModule[moduleId];
  const [moved] = tabs.splice(fromIndex, 1);
  tabs.splice(toIndex, 0, moved);
  render();
}

function formatTime(value) {
  if (!value) return '—';
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleString();
}

function sortHistoryNewestFirst(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const ta = new Date(a?.timestamp || 0).getTime() || 0;
    const tb = new Date(b?.timestamp || 0).getTime() || 0;
    return tb - ta;
  });
}

function historySignature(items) {
  const arr = Array.isArray(items) ? items : [];
  const head = arr
    .slice(0, 8)
    .map((m) => `${m.id || ''}:${m.timestamp || ''}`)
    .join('|');
  return `${arr.length}#${head}`;
}

async function fetchSessionHistory(sessionKey) {
  const response = await fetch(`/api/session-history?sessionKey=${encodeURIComponent(sessionKey)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Не удалось загрузить историю сессии');
  return response.json();
}

function closeSessionViewer() {
  state.sessionViewer = {
    open: false,
    loading: false,
    error: null,
    session: null,
    history: [],
    historySig: '',
    scrollTop: 0,
    isUserBrowsingHistory: false,
    pendingNewCount: 0,
  };
  render();
}

async function openSessionViewer(sessionKey) {
  state.sessionViewer = {
    open: true,
    loading: true,
    error: null,
    session: { sessionKey },
    history: [],
    historySig: '',
    scrollTop: 0,
    isUserBrowsingHistory: false,
    pendingNewCount: 0,
  };
  render();

  try {
    const payload = await fetchSessionHistory(sessionKey);
    const nextHistory = sortHistoryNewestFirst(payload.history);
    state.sessionViewer = {
      open: true,
      loading: false,
      error: null,
      session: payload.session || { sessionKey },
      history: nextHistory,
      historySig: historySignature(nextHistory),
      scrollTop: 0,
      isUserBrowsingHistory: false,
      pendingNewCount: 0,
    };
  } catch (err) {
    state.sessionViewer.loading = false;
    state.sessionViewer.error = err?.message || 'Ошибка загрузки';
  }

  render();
}

function getSessionHistoryBodyEl() {
  return document.querySelector('.session-history-body');
}

function isSessionViewerPinnedToLive() {
  const el = getSessionHistoryBodyEl();
  if (!el) return true;
  return el.scrollTop <= 2;
}

async function refreshSessionViewerRealtime() {
  if (!state.sessionViewer.open || sessionViewerRealtimeInFlight) return;

  if (!isSessionViewerPinnedToLive()) {
    state.sessionViewer.isUserBrowsingHistory = true;
    return;
  }

  state.sessionViewer.isUserBrowsingHistory = false;

  const sessionKey = state.sessionViewer.session?.sessionKey;
  if (!sessionKey) return;

  sessionViewerRealtimeInFlight = true;
  try {
    const payload = await fetchSessionHistory(sessionKey);
    const nextHistory = sortHistoryNewestFirst(payload.history);
    const nextSig = historySignature(nextHistory);
    const changed = nextSig !== state.sessionViewer.historySig;

    if (changed) {
      state.sessionViewer = {
        ...state.sessionViewer,
        loading: false,
        error: null,
        session: payload.session || state.sessionViewer.session,
        history: nextHistory,
        historySig: nextSig,
        pendingNewCount: 0,
      };
      render();
    }
  } catch (err) {
    state.sessionViewer.error = err?.message || 'Ошибка realtime-обновления';
    render();
  } finally {
    sessionViewerRealtimeInFlight = false;
  }
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function markdownToHtml(mdText) {
  const esc = escapeHtml(mdText || '');
  const lines = esc.split(/\r?\n/);
  const out = [];
  let inList = false;

  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  for (const line of lines) {
    if (!line.trim()) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }

    if (inList) {
      out.push('</ul>');
      inList = false;
    }
    out.push(`<p>${inline(line)}</p>`);
  }

  if (inList) out.push('</ul>');
  return out.join('\n');
}

function render() {
  const moduleId = state.currentModule;
  const tabs = state.tabsByModule[moduleId];
  const activeTab = state.activeTabByModule[moduleId];

  const existingHistoryBody = document.querySelector('.session-history-body');
  if (existingHistoryBody) state.sessionViewer.scrollTop = existingHistoryBody.scrollTop;

  workspace.classList.toggle('lab-mode', moduleId === 'lab');

  workspace.innerHTML = `
    <div class="module-shell">
      <div class="module-header">
        <div class="tabbar" id="tabbar">
          ${tabs
            .map(
              (tab, i) => `
            <button
              class="tab ${tab.id === activeTab ? 'active' : ''}"
              data-tab="${tab.id}"
              data-index="${i}"
              draggable="true"
              title="Перетащите, чтобы изменить порядок"
            >${tab.title}</button>`
            )
            .join('')}
        </div>
      </div>
      <div class="module-content">${renderContent(moduleId, activeTab)}</div>
    </div>
  `;

  attachTabHandlers();

  const historyBody = document.querySelector('.session-history-body');
  if (historyBody && state.sessionViewer.open) historyBody.scrollTop = state.sessionViewer.scrollTop || 0;
}

function renderContent(moduleId, activeTab) {
  if (moduleId === 'ops' && activeTab === 'ops-dashboard') {
    return `
      <div class="title-row">Операционный обзор</div>
      <div class="grid">
        <button class="card module-nav-card" data-open-tab="ops-mission-control"><h3>Центр управления</h3><p>Модель, сессии, cron и быстрый health-check.</p></button>
        <div class="card"><h3>Очередь исполнения</h3><p>Очередь задач и контроль выполнения.</p></div>
        <div class="card"><h3>Инциденты</h3><p>Сбои, алерты и диагностика.</p></div>
      </div>
    `;
  }

  if (moduleId === 'ops' && activeTab === 'ops-mission-control') return renderMissionControl();

  if (moduleId === 'brain' && activeTab === 'brain-dashboard') {
    return `
      <div class="title-row">Обзор Brain</div>
      <div class="grid">
        <button class="card module-nav-card" data-open-tab="brain-daily-summaries"><h3>Ежедневные сводки</h3><p>Приоритеты дня, риски и следующие действия.</p></button>
        <button class="card module-nav-card" data-open-tab="brain-automation"><h3>Автоматизация</h3><p>Полная расшифровка cron-задач: цель, инструкции, расписание и статусы.</p></button>
        <div class="card"><h3>Карта стратегии</h3><p>Стратегии роста и гипотезы.</p></div>
      </div>
    `;
  }

  if (moduleId === 'brain' && activeTab === 'brain-daily-summaries') return renderDailySummaries();
  if (moduleId === 'brain' && activeTab === 'brain-automation') return renderAutomation();

  if (moduleId === 'lab' && activeTab === 'lab-dashboard') return renderLabDashboard();

  return '<div class="session-meta">Нет данных.</div>';
}

function renderDailySummaries() {
  const d = state.dailySummaries;
  return `
    <h2 class="section-title">Ежедневные сводки</h2>
    <section class="daily-layout panel">
      <aside class="daily-sidebar">
        <div class="daily-sidebar-title">История</div>
        <div class="daily-list">
          ${d.items.length === 0
            ? '<div class="session-meta">Пока нет сводок</div>'
            : d.items.map((it) => `<button class="daily-item ${it.file === d.selectedFile ? 'active' : ''}" data-daily-file="${it.file}">${it.title}</button>`).join('')}
        </div>
      </aside>
      <article class="daily-viewer">
        <div class="daily-viewer-head">
          <strong>${d.selectedFile ? d.selectedFile.replace(/\.md$/i, '') : 'Последняя сводка'}</strong>
          ${d.loading ? '<span class="session-meta">Загрузка…</span>' : ''}
        </div>
        ${d.error ? `<div class="session-meta" style="color:#ff9cb3;">${escapeHtml(d.error)}</div>` : ''}
        <div class="daily-markdown">${d.content ? markdownToHtml(d.content) : '<p class="session-meta">Нет данных.</p>'}</div>
      </article>
    </section>
  `;
}

function renderAutomation() {
  const a = state.automation;
  const selected = a.jobs.find((j) => j.id === a.selectedJobId) || a.jobs[0] || null;

  return `
    <h2 class="section-title">Автоматизация</h2>
    <section class="daily-layout panel">
      <aside class="daily-sidebar">
        <div class="daily-sidebar-title">Cron-задачи (${a.jobs.length})</div>
        <div class="daily-list">
          ${a.jobs.length === 0
            ? '<div class="session-meta">Пока нет cron-задач</div>'
            : a.jobs
                .map(
                  (job) => `<button class="daily-item ${job.id === selected?.id ? 'active' : ''}" data-automation-id="${job.id}">${escapeHtml(job.name || 'cron')}<span class="session-meta" style="display:block;margin-top:4px;">${escapeHtml(job.status || 'неизвестно')} · ${escapeHtml(job.schedule || '—')}</span></button>`
                )
                .join('')}
        </div>
      </aside>

      <article class="daily-viewer">
        <div class="daily-viewer-head">
          <strong>${selected ? escapeHtml(selected.name || selected.id) : 'Выберите cron-задачу'}</strong>
          ${a.loading ? '<span class="session-meta">Загрузка…</span>' : ''}
        </div>

        ${a.error ? `<div class="session-meta" style="color:#ff9cb3;">${escapeHtml(a.error)}</div>` : ''}

        ${!selected
          ? '<p class="session-meta">Нет данных.</p>'
          : `<div class="info-grid" style="margin-bottom:14px;">
              <div class="info-cell"><small>ID</small><strong>${escapeHtml(selected.id || '—')}</strong></div>
              <div class="info-cell"><small>Расписание</small><strong>${escapeHtml(selected.schedule || '—')}</strong></div>
              <div class="info-cell"><small>Статус</small><strong>${escapeHtml(selected.status || '—')}</strong></div>
              <div class="info-cell"><small>Следующий запуск</small><strong>${escapeHtml(selected.nextRun || '—')}</strong></div>
              <div class="info-cell"><small>Последний запуск</small><strong>${escapeHtml(selected.lastRun || '—')}</strong></div>
              <div class="info-cell"><small>Доставка</small><strong>${escapeHtml(selected.deliveryMode || '—')}</strong></div>
            </div>

            <div class="daily-markdown">
              <h3>Описание</h3>
              <p>${escapeHtml(selected.description || '—')}</p>
              <h3>Инструкции cron-задачи</h3>
              <pre class="history-text" style="font-size:13px;white-space:pre-wrap;">${escapeHtml(selected.message || '—')}</pre>
            </div>`}
      </article>
    </section>
  `;
}

function renderSessionViewer() {
  const v = state.sessionViewer;
  if (!v.open) return '';

  const s = v.session || {};

  return `
    <div class="session-modal-backdrop" id="sessionModalBackdrop">
      <div class="session-modal" role="dialog" aria-modal="true">
        <button class="session-modal-close" id="sessionModalClose" title="Закрыть">✕</button>
        <div class="session-modal-header">
          <h3>${s.sessionKey || 'session'}</h3>
          <span class="badge success"><span class="dot green"></span>active</span>
        </div>

        <div class="session-head-grid">
          <div><small>Ключ сессии</small><strong>${s.sessionKey || '—'}</strong></div>
          <div><small>Модель</small><strong>${s.model || '—'}</strong></div>
          <div><small>Канал</small><strong>${s.channel || '—'}</strong></div>
          <div><small>Токены</small><strong>${s.tokens?.total ?? 0}</strong></div>
        </div>
        <div class="session-meta" style="margin-top:10px;">Обновлено: ${formatTime(s.updatedAt)}</div>

        <div class="session-history-title"><span>История сессии</span></div>
        <div class="session-history-body">
          ${v.loading
            ? '<div class="session-meta">Загрузка истории…</div>'
            : v.error
              ? `<div class="session-meta" style="color:#ff9cb3;">${escapeHtml(v.error)}</div>`
              : v.history.length === 0
                ? '<div class="session-meta">История пока пустая.</div>'
                : v.history
                    .map(
                      (m) => `
                    <article class="history-item role-${(m.role || 'unknown').toLowerCase()}">
                      <div class="history-top">
                        <span class="history-role">${escapeHtml(m.role || 'unknown')}</span>
                        <span class="session-meta">${formatTime(m.timestamp)}</span>
                      </div>
                      <pre class="history-text">${escapeHtml(m.text || '—')}</pre>
                    </article>`
                    )
                    .join('')}
        </div>
      </div>
    </div>
  `;
}

function renderMissionControl() {
  const m = state.missionControl;
  const connectedBadge = m.sourceConnected
    ? '<span class="badge success"><span class="dot green"></span>live-источник</span>'
    : m.stale
      ? '<span class="badge idle"><span class="dot yellow"></span>устаревшие данные</span>'
      : '<span class="badge failed"><span class="dot red"></span>источник не подключён</span>';

  return `
    <h2 class="section-title">Центр управления</h2>

    <section class="panel">
      <h3 style="margin:0 0 12px; display:flex; justify-content:space-between; align-items:center;">
        <span>Профиль модели</span>
        ${connectedBadge}
      </h3>
      <div class="info-grid">
        <div class="info-cell"><small>Модель</small><strong>${escapeHtml(m.model || '—')}</strong></div>
        <div class="info-cell"><small>Провайдер</small><strong>${escapeHtml(m.provider || '—')}</strong></div>
        <div class="info-cell"><small>Статус</small><strong>${escapeHtml(m.status || '—')}</strong></div>
        <div class="info-cell"><small>Контекст</small><strong>${escapeHtml(m.context || '—')}</strong></div>
      </div>
      <div class="session-meta" style="margin-top:10px;">Последняя синхронизация: ${escapeHtml(m.lastSyncAt || 'нет данных')}</div>
      ${m.error ? `<div class="session-meta" style="margin-top:6px;color:#ff9cb3;">API: ${escapeHtml(m.error)}</div>` : ''}
    </section>

    <h3 style="margin:14px 0 10px;">Активные сессии (${m.sessions.length})</h3>
    <section class="session-grid">
      ${m.sessions.length === 0
        ? '<article class="session-card"><div class="session-meta">Нет данных.</div></article>'
        : m.sessions
            .map((s) => {
              const st = s.state === 'active' ? 'success' : s.state === 'idle' ? 'idle' : 'success';
              const dot = s.state === 'active' ? 'green' : s.state === 'idle' ? 'yellow' : 'green';
              return `
                <button class="session-card session-card-btn" data-open-session="${s.sessionKey || ''}">
                  <div class="session-top">
                    <span>${escapeHtml(s.title || s.id || 'session')}</span>
                    <span class="badge ${st}"><span class="dot ${dot}"></span>${escapeHtml(s.state || 'unknown')}</span>
                  </div>
                  <div class="session-meta">${escapeHtml(s.subtitle || '')}</div>
                  <div class="session-meta" style="margin-top:6px;">${escapeHtml(s.text || '')}</div>
                  <div class="session-meta" style="margin-top:8px; display:flex; justify-content:space-between;">
                    <span>${escapeHtml(s.model || '')}</span>
                    <span>${escapeHtml(s.ago || '')}</span>
                  </div>
                </button>
              `;
            })
            .join('')}
    </section>

    <h3 style="margin:14px 0 10px;">Состояние cron (${m.crons.length})</h3>
    <section class="panel table-wrap">
      <table class="mc-table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Расписание</th>
            <th>Последний запуск</th>
            <th>Статус</th>
            <th>Следующий запуск</th>
          </tr>
        </thead>
        <tbody>
          ${m.crons.length === 0
            ? '<tr><td colspan="5" class="session-meta">Нет live-данных cron.</td></tr>'
            : m.crons
                .map((c) => {
                  const failed = c.status === 'failed';
                  return `
                    <tr class="${failed ? 'row-failed' : ''}">
                      <td>
                        <strong>${escapeHtml(c.name || 'cron')}</strong>
                        ${c.error ? `<div class="session-meta" style="margin-top:4px;">${escapeHtml(c.error)}</div>` : ''}
                        ${c.id ? `<div style="margin-top:6px;"><button class="ghost-btn" data-open-automation-id="${c.id}">Открыть в Brain → Автоматизация</button></div>` : ''}
                      </td>
                      <td>${escapeHtml(c.schedule || '—')}</td>
                      <td>${escapeHtml(c.lastRun || '—')}</td>
                      <td>
                        <span class="badge ${failed ? 'failed' : 'success'}">
                          <span class="dot ${failed ? 'red' : 'green'}"></span>${escapeHtml(c.status || 'unknown')}
                        </span>
                      </td>
                      <td>${escapeHtml(c.nextRun || '—')}</td>
                    </tr>
                  `;
                })
                .join('')}
        </tbody>
      </table>
    </section>

    ${renderSessionViewer()}
  `;
}

function renderLabDashboard() {
  const l = state.lab;

  return `
    <div class="lab-shell">
      <section class="lab-title-block">
        <h2>Лаборатория</h2>
        <p>Эксперименты, прототипы и ночные сборки</p>
        <span class="session-meta">Хранилище: ${escapeHtml(l.storageMode || 'json')}</span>
      </section>

      ${l.loading ? '<div class="session-meta" style="margin-top:8px;">Загрузка…</div>' : ''}
      ${l.error ? `<div class="session-meta" style="margin-top:8px;color:#ff9cb3;">${escapeHtml(l.error)}</div>` : ''}

      <div class="lab-hero-grid">
        <section class="lab-hero-card">
          <h3>Прототипы</h3>
          <div class="lab-list">
            ${l.prototypes.length === 0 ? '<div class="session-meta">Пока нет прототипов</div>' : l.prototypes.map((p, i) => `<button class="lab-link" data-open-lab-preview="prototype:${i}">${escapeHtml(p.name || 'прототип')}<span>${escapeHtml(p.url || '—')}</span></button>`).join('')}
          </div>
        </section>

        <section class="lab-hero-card">
          <h3>Эксперименты</h3>
          <div class="lab-list">
            ${l.experiments.length === 0 ? '<div class="session-meta">Пока нет экспериментов</div>' : l.experiments.map((e, i) => `<button class="lab-link" data-open-lab-preview="experiment:${i}">${escapeHtml(e.name || 'эксперимент')}<span>${escapeHtml(e.status || 'planned')}</span></button>`).join('')}
          </div>
        </section>
      </div>

      <section class="lab-hero-card" style="margin-top:14px;">
        <h3>Кандидаты фич (${l.featureCandidates.length})</h3>
        <div class="lab-list">
          ${l.featureCandidates.length === 0
            ? '<div class="session-meta">Пока нет кандидатов</div>'
            : l.featureCandidates
                .map(
                  (c) => `<div class="lab-link" style="cursor:default;">
                  <strong>${escapeHtml(c.title || c.name || 'кандидат')}</strong>
                  <span>${escapeHtml(c.status || 'ready_for_review')} · влияние: ${escapeHtml(c.impact ?? 'n/a')} · риск: ${escapeHtml(c.risk ?? 'n/a')}</span>
                  <span>preview: ${escapeHtml(c.previewUrl || 'не подготовлено')}</span>
                  <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                    ${c.previewUrl ? `<button class="ghost-btn" data-open-external-url="${c.previewUrl}">Открыть превью</button>` : ''}
                    <button class="ghost-btn" data-lab-decision="approve" data-candidate-id="${c.id}">Одобрить в прод</button>
                    <button class="ghost-btn" data-lab-decision="iterate" data-candidate-id="${c.id}">На доработку</button>
                    <button class="ghost-btn" data-lab-decision="reject" data-candidate-id="${c.id}">Отклонить</button>
                  </div>
                </div>`
                )
                .join('')}
        </div>
      </section>
    </div>

    ${renderLabPreview()}
  `;
}

function renderLabPreview() {
  const p = state.lab.preview;
  if (!p.open) return '';

  return `
    <div class="lab-preview-backdrop" id="labPreviewBackdrop">
      <div class="lab-preview-modal" role="dialog" aria-modal="true">
        <button class="session-modal-close" id="labPreviewClose" title="Закрыть">✕</button>
        <div class="daily-viewer-head" style="margin-bottom:12px;padding-right:26px;">
          <strong>${escapeHtml(p.title || 'Превью')}</strong>
        </div>
        ${p.type === 'url'
          ? `<iframe class="lab-frame" src="${p.url}" title="${escapeHtml(p.title || 'lab preview')}"></iframe>`
          : `<div class="daily-markdown"><pre class="history-text" style="font-size:13px;">${escapeHtml(p.content || 'Нет данных')}</pre></div>`}
      </div>
    </div>
  `;
}

function closeLabPreview() {
  state.lab.preview = { open: false, title: '', type: 'text', url: '', content: '' };
  render();
}

function openLabPreview(ref) {
  const [kind, idxRaw] = String(ref).split(':');
  const idx = Number(idxRaw);
  if (Number.isNaN(idx)) return;

  let item = null;
  if (kind === 'prototype') item = state.lab.prototypes[idx];
  if (kind === 'experiment') item = state.lab.experiments[idx];
  if (kind === 'nightly') item = state.lab.nightlyBuilds[idx];
  if (kind === 'self') item = state.lab.selfBuilds[idx];
  if (kind === 'failed') item = state.lab.failedFeatures[idx];
  if (kind === 'client') item = state.lab.clientPrototypes[idx];
  if (!item) return;

  const hasUrl = !!item.url;
  state.lab.preview = {
    open: true,
    title: item.name || 'Превью',
    type: hasUrl ? 'url' : 'text',
    url: item.url || '',
    content: item.notes || JSON.stringify(item, null, 2),
  };
  render();
}

function attachTabHandlers() {
  const tabbar = document.getElementById('tabbar');
  const tabs = [...tabbar.querySelectorAll('.tab')];

  document.querySelectorAll('[data-open-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      const tabId = el.getAttribute('data-open-tab');
      if (tabId) setActiveTab(tabId);
    });
  });

  document.querySelectorAll('[data-open-session]').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.getAttribute('data-open-session');
      if (key) openSessionViewer(key);
    });
  });

  document.querySelectorAll('[data-daily-file]').forEach((el) => {
    el.addEventListener('click', () => {
      const file = el.getAttribute('data-daily-file');
      if (file) loadDailySummaries(file);
    });
  });

  document.querySelectorAll('[data-automation-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-automation-id');
      if (!id) return;
      state.automation.selectedJobId = id;
      render();
    });
  });

  document.querySelectorAll('[data-open-automation-id]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.getAttribute('data-open-automation-id');
      setModule('brain');
      setActiveTab('brain-automation');
      if (id) state.automation.selectedJobId = id;
      await loadAutomationData({ silent: true });
      render();
    });
  });

  document.querySelectorAll('[data-open-lab-preview]').forEach((el) => {
    el.addEventListener('click', () => {
      const ref = el.getAttribute('data-open-lab-preview');
      if (ref) openLabPreview(ref);
    });
  });

  document.querySelectorAll('[data-lab-decision]').forEach((el) => {
    el.addEventListener('click', () => {
      const decision = el.getAttribute('data-lab-decision');
      const id = Number(el.getAttribute('data-candidate-id'));
      if (!decision || Number.isNaN(id)) return;
      decideFeatureCandidate(id, decision);
    });
  });

  document.querySelectorAll('[data-open-external-url]').forEach((el) => {
    el.addEventListener('click', () => {
      const url = el.getAttribute('data-open-external-url');
      if (!url) return;
      state.lab.preview = { open: true, title: 'Превью песочницы', type: 'url', url, content: '' };
      render();
    });
  });

  const closeBtn = document.getElementById('sessionModalClose');
  if (closeBtn) closeBtn.addEventListener('click', closeSessionViewer);

  const backdrop = document.getElementById('sessionModalBackdrop');
  if (backdrop) backdrop.addEventListener('click', (e) => e.target === backdrop && closeSessionViewer());

  const historyBody = document.querySelector('.session-history-body');
  if (historyBody) {
    historyBody.addEventListener('scroll', () => {
      state.sessionViewer.scrollTop = historyBody.scrollTop;
      state.sessionViewer.isUserBrowsingHistory = !isSessionViewerPinnedToLive();
    });
  }

  const labCloseBtn = document.getElementById('labPreviewClose');
  if (labCloseBtn) labCloseBtn.addEventListener('click', closeLabPreview);

  const labBackdrop = document.getElementById('labPreviewBackdrop');
  if (labBackdrop) labBackdrop.addEventListener('click', (e) => e.target === labBackdrop && closeLabPreview());

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
    tab.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', tab.dataset.index));
    tab.addEventListener('dragover', (e) => e.preventDefault());
    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('text/plain'));
      const to = Number(tab.dataset.index);
      if (!Number.isNaN(from) && !Number.isNaN(to) && from !== to) reorderTabs(state.currentModule, from, to);
    });
  });
}

async function decideFeatureCandidate(id, decision) {
  try {
    const response = await fetch('/api/lab/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision }),
    });
    if (!response.ok) throw new Error('Не удалось сохранить решение');
    await loadLabData({ silent: true });
  } catch (err) {
    state.lab.error = err?.message || 'Ошибка сохранения решения';
    render();
  }
}

async function loadLabData(options = {}) {
  const silent = options.silent === true;
  if (!silent) {
    state.lab.loading = true;
    state.lab.error = null;
    render();
  }

  try {
    const response = await fetch('/api/lab', { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить лабораторный модуль');
    const payload = await response.json();

    state.lab = {
      ...state.lab,
      loading: false,
      error: null,
      storageMode: payload.storageMode || 'json',
      prototypes: Array.isArray(payload.prototypes) ? payload.prototypes : [],
      experiments: Array.isArray(payload.experiments) ? payload.experiments : [],
      nightlyBuilds: Array.isArray(payload.nightlyBuilds) ? payload.nightlyBuilds : [],
      selfBuilds: Array.isArray(payload.selfBuilds) ? payload.selfBuilds : [],
      failedFeatures: Array.isArray(payload.failedFeatures) ? payload.failedFeatures : [],
      clientPrototypes: Array.isArray(payload.clientPrototypes) ? payload.clientPrototypes : [],
      featureCandidates: Array.isArray(payload.featureCandidates) ? payload.featureCandidates : [],
    };
  } catch (err) {
    state.lab.loading = false;
    state.lab.error = err?.message || 'Ошибка загрузки лаборатории';
  }

  render();
}

async function loadAutomationData(options = {}) {
  const silent = options.silent === true;
  if (!silent) {
    state.automation.loading = true;
    state.automation.error = null;
    render();
  }

  try {
    const response = await fetch('/api/automation', { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить автоматизации');
    const payload = await response.json();
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    const selectedExists = jobs.some((x) => x.id === state.automation.selectedJobId);

    state.automation = {
      loading: false,
      error: null,
      jobs,
      selectedJobId: selectedExists ? state.automation.selectedJobId : jobs[0]?.id || null,
    };
  } catch (err) {
    state.automation.loading = false;
    state.automation.error = err?.message || 'Ошибка загрузки автоматизаций';
  }

  render();
}

async function loadDailySummaries(file) {
  state.dailySummaries.loading = true;
  state.dailySummaries.error = null;
  render();

  try {
    const suffix = file ? `?file=${encodeURIComponent(file)}` : '';
    const response = await fetch(`/api/daily-summaries${suffix}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить ежедневные сводки');
    const payload = await response.json();

    state.dailySummaries = {
      loading: false,
      error: null,
      items: Array.isArray(payload.items) ? payload.items : [],
      selectedFile: payload.selectedFile || null,
      content: payload.content || '',
    };
  } catch (err) {
    state.dailySummaries.loading = false;
    state.dailySummaries.error = err?.message || 'Ошибка загрузки сводок';
  }

  render();
}

async function refreshMissionControlData() {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  try {
    const response = await fetch('/api/mission-control', { cache: 'no-store' });
    if (!response.ok) throw new Error('API unavailable');
    const payload = await response.json();

    state.missionControl = {
      model: payload.model ?? null,
      provider: payload.provider ?? null,
      status: payload.status ?? null,
      context: payload.context ?? null,
      sessions: Array.isArray(payload.sessions) ? payload.sessions : [],
      crons: Array.isArray(payload.crons) ? payload.crons : [],
      sourceConnected: payload.sourceConnected !== false,
      stale: payload.stale === true,
      error: payload.error || null,
      lastSyncAt: payload.generatedAt ? new Date(payload.generatedAt).toLocaleString() : new Date().toLocaleString(),
    };
  } catch (err) {
    state.missionControl.sourceConnected = false;
    state.missionControl.stale = true;
    state.missionControl.error = err?.message || 'fetch failed';
    state.missionControl.lastSyncAt = new Date().toLocaleString();
  } finally {
    state.refreshInFlight = false;
  }

  if (!state.sessionViewer.open) render();
}

refreshStatusBtn.addEventListener('click', refreshMissionControlData);
dockButtons.forEach((btn) => btn.addEventListener('click', () => setModule(btn.dataset.module)));

setModule('ops');
refreshMissionControlData();

setInterval(() => {
  if (document.hidden) return;
  if (state.currentModule === 'ops') refreshMissionControlData();
}, 15000);

setInterval(() => {
  if (document.hidden) return;
  if (state.currentModule === 'lab') loadLabData({ silent: true });
  if (state.currentModule === 'brain' && state.activeTabByModule.brain === 'brain-automation') loadAutomationData({ silent: true });
}, 30000);

setInterval(() => {
  if (document.hidden) return;
  refreshSessionViewerRealtime();
}, 2500);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (state.currentModule === 'ops') refreshMissionControlData();
  if (state.currentModule === 'lab') loadLabData({ silent: true });
  if (state.currentModule === 'brain' && state.activeTabByModule.brain === 'brain-automation') loadAutomationData({ silent: true });
  refreshSessionViewerRealtime();
});
