const workspace = document.getElementById('workspace');
const dockButtons = [...document.querySelectorAll('.dock-item')];
const refreshStatusBtn = document.getElementById('refreshStatusBtn');

let sessionViewerRealtimeInFlight = false;
const UI_STATE_KEY = 'avanta-os-ui-state-v1';

const state = {
  currentModule: 'ops',
  refreshInFlight: false,
  tabsByModule: {
    ops: [
      { id: 'ops-mission-control', title: 'Центр управления' },
      { id: 'ops-pm-board', title: 'PM-доска' },
      { id: 'ops-standups', title: 'Стендапы' },
      { id: 'ops-workspaces', title: 'Файлы' },
      { id: 'ops-org-chart', title: 'Команда' },
      { id: 'ops-docs', title: 'Документы' },
    ],
    brain: [
      { id: 'brain-daily-summaries', title: 'Ежедневные сводки' },
      { id: 'brain-skills-directory', title: 'Каталог навыков' },
      { id: 'brain-automation', title: 'Автоматизации' },
      { id: 'brain-config-inspector', title: 'Инспектор конфигурации' },
    ],
    lab: [
      { id: 'lab-dashboard', title: 'Обзор' },
      { id: 'lab-prototype-factory', title: 'Фабрика прототипов' },
    ],
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
  opsBoard: {
    loading: false,
    error: null,
    stages: ['intake', 'scoping', 'activation', 'review', 'execution', 'update'],
    tasks: [],
    deliverables: [],
  },
  pmTaskModal: {
    open: false,
    task: null,
  },
  opsDocs: {
    loading: false,
    error: null,
    items: [],
    selectedFile: null,
    content: '',
    query: '',
  },
  opsWorkspaces: {
    loading: false,
    error: null,
    workspaces: [],
    selectedWorkspace: 'steve',
    selectedFile: null,
    content: '',
    query: '',
  },
  standupsView: 'week',
  standupsCursorMs: Date.now(),
  standupModal: {
    open: false,
    item: null,
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
    expandedJobIds: [],
    modelFilter: 'all',
    editModal: {
      open: false,
      saving: false,
      error: null,
      jobId: null,
      form: null,
    },
  },
  skillsDirectory: {
    loading: false,
    error: null,
    items: [],
    filter: 'all',
    query: '',
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
    research: {
      loading: false,
      error: null,
      query: 'micro saas product market fit validation framework',
      items: [],
      lastRunAt: null,
    },
    preview: {
      open: false,
      title: '',
      type: 'text',
      url: '',
      content: '',
    },
  },
};

function saveUiState() {
  try {
    const snapshot = {
      currentModule: state.currentModule,
      activeTabByModule: state.activeTabByModule,
    };
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore storage errors
  }
}

function restoreUiState() {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);

    if (parsed?.currentModule && state.tabsByModule[parsed.currentModule]) {
      state.currentModule = parsed.currentModule;
    }

    if (parsed?.activeTabByModule && typeof parsed.activeTabByModule === 'object') {
      for (const moduleId of Object.keys(state.tabsByModule)) {
        const tabId = parsed.activeTabByModule[moduleId];
        if (tabId && state.tabsByModule[moduleId].some((t) => t.id === tabId)) {
          state.activeTabByModule[moduleId] = tabId;
        }
      }
    }
  } catch {
    // ignore corrupted state
  }
}

function setModule(moduleId) {
  state.currentModule = moduleId;
  dockButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.module === moduleId));

  if (moduleId === 'brain') {
    state.activeTabByModule.brain = 'brain-dashboard';
  }

  if (moduleId === 'brain' && state.activeTabByModule.brain === 'brain-dashboard') {
    loadDailySummaries();
    loadSkillsDirectoryData({ silent: true });
    loadAutomationData({ silent: true });
  }
  if (moduleId === 'brain' && state.activeTabByModule.brain === 'brain-daily-summaries') loadDailySummaries();
  if (moduleId === 'brain' && state.activeTabByModule.brain === 'brain-skills-directory') loadSkillsDirectoryData();
  if (moduleId === 'brain' && state.activeTabByModule.brain === 'brain-automation') loadAutomationData();
  if (moduleId === 'brain' && state.activeTabByModule.brain === 'brain-config-inspector') loadOpsWorkspaces();
  if (moduleId === 'lab') {
    loadLabData();
    if (state.activeTabByModule.lab === 'lab-prototype-factory' && !(state.lab.research.items || []).length && !state.lab.research.loading) {
      runPrototypeResearch({ silent: true });
    }
  }
  if (moduleId === 'ops' && state.activeTabByModule.ops === 'ops-dashboard') loadOpsBoard();
  if (moduleId === 'ops' && state.activeTabByModule.ops === 'ops-pm-board') loadOpsBoard();
  if (moduleId === 'ops' && state.activeTabByModule.ops === 'ops-standups') loadOpsBoard();
  if (moduleId === 'ops' && state.activeTabByModule.ops === 'ops-docs') loadOpsDocs();
  if (moduleId === 'ops' && state.activeTabByModule.ops === 'ops-workspaces') loadOpsWorkspaces();

  saveUiState();
  render();
}

function setActiveTab(tabId) {
  state.activeTabByModule[state.currentModule] = tabId;

  if (state.currentModule === 'brain' && tabId === 'brain-dashboard') {
    loadDailySummaries();
    loadSkillsDirectoryData({ silent: true });
    loadAutomationData({ silent: true });
  }
  if (state.currentModule === 'brain' && tabId === 'brain-daily-summaries') loadDailySummaries();
  if (state.currentModule === 'brain' && tabId === 'brain-skills-directory') loadSkillsDirectoryData();
  if (state.currentModule === 'brain' && tabId === 'brain-automation') loadAutomationData();
  if (state.currentModule === 'brain' && tabId === 'brain-config-inspector') loadOpsWorkspaces();
  if (state.currentModule === 'lab' && (tabId === 'lab-dashboard' || tabId === 'lab-prototype-factory')) loadLabData();
  if (state.currentModule === 'lab' && tabId === 'lab-prototype-factory' && !(state.lab.research.items || []).length && !state.lab.research.loading) {
    runPrototypeResearch({ silent: true });
  }
  if (state.currentModule === 'ops' && tabId === 'ops-dashboard') loadOpsBoard();
  if (state.currentModule === 'ops' && tabId === 'ops-pm-board') loadOpsBoard();
  if (state.currentModule === 'ops' && tabId === 'ops-standups') loadOpsBoard();
  if (state.currentModule === 'ops' && tabId === 'ops-docs') loadOpsDocs();
  if (state.currentModule === 'ops' && tabId === 'ops-workspaces') loadOpsWorkspaces();

  saveUiState();
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
        <button class="card module-nav-card" data-open-tab="ops-org-chart"><h3>Оргдиаграмма</h3><p>Черновой каркас иерархии агентов и помощников.</p></button>
        <div class="card"><h3>Инциденты</h3><p>Сбои, алерты и диагностика.</p></div>
      </div>
    `;
  }

  if (moduleId === 'ops' && activeTab === 'ops-mission-control') return renderMissionControl();
  if (moduleId === 'ops' && activeTab === 'ops-pm-board') return renderOpsBoard();
  if (moduleId === 'ops' && activeTab === 'ops-standups') return renderOpsStandups();
  if (moduleId === 'ops' && activeTab === 'ops-workspaces') return renderOpsWorkspaces();
  if (moduleId === 'ops' && activeTab === 'ops-docs') return renderOpsDocs();
  if (moduleId === 'ops' && activeTab === 'ops-org-chart') return renderOrgChart();

  if (moduleId === 'brain' && activeTab === 'brain-dashboard') {
    return `
      <div class="title-row">Обзор Brain</div>
      <div class="grid">
        <button class="card module-nav-card" data-open-tab="brain-daily-summaries"><h3>Ежедневные сводки</h3><p>Приоритеты дня, риски и следующие действия.</p></button>
        <button class="card module-nav-card" data-open-tab="brain-skills-directory"><h3>Skills Directory</h3><p>Единый каталог skills и plug-ins: источник, статус и описание.</p></button>
        <button class="card module-nav-card" data-open-tab="brain-automation"><h3>Automations</h3><p>Таблица всех cron-задач с раскрытием полной конфигурации.</p></button>
      </div>
    `;
  }

  if (moduleId === 'brain' && activeTab === 'brain-daily-summaries') return renderDailySummaries();
  if (moduleId === 'brain' && activeTab === 'brain-skills-directory') return renderSkillsDirectory();
  if (moduleId === 'brain' && activeTab === 'brain-automation') return renderAutomation();

  if (moduleId === 'lab' && activeTab === 'lab-dashboard') return renderLabDashboard();
  if (moduleId === 'lab' && activeTab === 'lab-prototype-factory') return renderPrototypeFactory();

  return '<div class="session-meta">Нет данных.</div>';
}

function highlightMarkdownByQuery(content, query) {
  if (!query) return markdownToHtml(content || '');
  const escQ = escapeHtml(query.trim());
  if (!escQ) return markdownToHtml(content || '');
  const html = markdownToHtml(content || '');
  const re = new RegExp(`(${escQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  return html.replace(re, '<mark>$1</mark>');
}

function renderOpsDashboard() {
  const m = state.missionControl;
  const b = state.opsBoard;
  const tasks = Array.isArray(b.tasks) ? b.tasks : [];
  const sessions = Array.isArray(m.sessions) ? m.sessions : [];
  const crons = Array.isArray(m.crons) ? m.crons : [];

  const tokenTotal = sessions.reduce((sum, s) => {
    const text = String(s?.text || '');
    const mt = text.match(/total:\s*(\d+)/i);
    return sum + (mt ? Number(mt[1]) : 0);
  }, 0);

  const pipelineBuckets = {
    intake: tasks.filter((t) => t.stage === 'intake').length,
    scoping: tasks.filter((t) => t.stage === 'scoping').length,
    activation: tasks.filter((t) => t.stage === 'activation').length,
    review: tasks.filter((t) => t.stage === 'review').length,
    execution: tasks.filter((t) => t.stage === 'execution').length,
    update: tasks.filter((t) => t.stage === 'update').length,
  };

  const maxBucket = Math.max(1, ...Object.values(pipelineBuckets));

  return `
    <section class="ops-dashboard-v2">
      <header class="ops-dash-head">
        <h2>Ops Dashboard</h2>
        <p>Operations overview — click any card to dive deeper</p>
      </header>

      <div class="ops-metric-grid">
        <article class="ops-metric-card" data-open-tab="ops-mission-control">
          <small>MODEL</small>
          <strong>${escapeHtml(m.model || '—')}</strong>
          <span class="session-meta ${m.sourceConnected ? 'ok' : ''}">${m.sourceConnected ? 'online' : 'offline'}</span>
        </article>
        <article class="ops-metric-card" data-open-tab="ops-mission-control">
          <small>TOKENS</small>
          <strong>${tokenTotal.toLocaleString('ru-RU')}</strong>
          <span class="session-meta">${sessions.length} sessions</span>
        </article>
        <article class="ops-metric-card" data-open-tab="ops-mission-control">
          <small>CRON</small>
          <strong>${crons.length}</strong>
          <span class="session-meta ${crons.every((c) => c.status !== 'failed') ? 'ok' : ''}">${crons.every((c) => c.status !== 'failed') ? 'all healthy' : 'check issues'}</span>
        </article>
        <article class="ops-metric-card" data-open-tab="ops-pm-board">
          <small>TASKS</small>
          <strong>${tasks.length}</strong>
          <span class="session-meta">${tasks.filter((t) => t.status === 'open').length} active</span>
        </article>
      </div>

      <div class="ops-main-grid">
        <section class="ops-panel">
          <div class="ops-panel-head"><h3>Active Sessions</h3><span>${sessions.length} total</span></div>
          <div class="ops-session-list">
            ${sessions
              .slice(0, 6)
              .map(
                (s) => `<button class="ops-session-row" data-open-session="${escapeHtml(s.sessionKey || '')}"><span>${escapeHtml(s.title || 'session')}</span><span>${escapeHtml(s.ago || '—')}</span></button>`
              )
              .join('') || '<div class="session-meta">Нет активных сессий</div>'}
          </div>
        </section>

        <section class="ops-panel" data-open-tab="ops-pm-board">
          <div class="ops-panel-head"><h3>Task Pipeline</h3><span>${tasks.length} tasks</span></div>
          <div class="ops-pipeline-bars">
            ${Object.entries(pipelineBuckets)
              .map(([k, v]) => {
                const pct = Math.max(6, Math.round((v / maxBucket) * 100));
                return `<div class="ops-pipe-row"><label>${k}</label><div class="ops-pipe-track"><i style="width:${pct}%;"></i></div><span>${v}</span></div>`;
              })
              .join('')}
          </div>
        </section>
      </div>

      <div class="ops-shortcuts-grid">
        <button class="ops-shortcut" data-open-tab="ops-org-chart"><h4>Команда</h4><p>Структура агентов и ролей</p></button>
        <button class="ops-shortcut" data-open-tab="ops-workspaces"><h4>Workspaces</h4><p>SOUL.md, IDENTITY.md, TOOLS.md и др.</p></button>
        <button class="ops-shortcut" data-open-tab="ops-docs"><h4>Docs</h4><p>Системная документация с поиском</p></button>
      </div>
    </section>
    ${renderPmTaskModal()}
  `;
}

function openPmTaskModal(taskId) {
  const task = (state.opsBoard.tasks || []).find((t) => Number(t.id) === Number(taskId));
  if (!task) return;
  state.pmTaskModal = { open: true, task };
  render();
}

function closePmTaskModal() {
  state.pmTaskModal = { open: false, task: null };
  render();
}

async function savePmTaskMeta(taskId, patch = {}) {
  const current = (state.opsBoard.tasks || []).find((t) => Number(t.id) === Number(taskId));
  if (!current) return;

  const body = {
    taskId: Number(taskId),
    priority: patch.priority || current.priority || 'medium',
    tags: Array.isArray(patch.tags) ? patch.tags : Array.isArray(current.tags) ? current.tags : [],
  };

  const response = await fetch('/api/ops/board/update-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Не удалось обновить карточку');
  await loadOpsBoard();
  openPmTaskModal(taskId);
}

function renderPmTaskModal() {
  const m = state.pmTaskModal;
  if (!m.open || !m.task) return '';

  const t = m.task;
  const blockers = Array.isArray(t.blockers) ? t.blockers : [];
  const deliverables = (state.opsBoard.deliverables || []).filter(
    (d) => Number(d.taskId) === Number(t.id) || String(d.clientName || '').toLowerCase() === String(t.clientName || '').toLowerCase()
  );

  const priorityLabel = { low: 'Low', medium: 'Med', high: 'High', critical: 'High' }[String(t.priority || '').toLowerCase()] || 'Med';
  const stageLabel = {
    intake: 'to-do',
    scoping: 'scoping',
    activation: 'in-progress',
    review: 'review',
    execution: 'execution',
    update: 'done',
  }[String(t.stage || '').toLowerCase()] || String(t.stage || '—');

  const dueMs = t.dueAt ? new Date(t.dueAt).getTime() : NaN;
  const leftDays = Number.isFinite(dueMs) ? Math.ceil((dueMs - Date.now()) / 86400000) : null;
  const dueHint = leftDays === null ? '—' : leftDays >= 0 ? `${leftDays}d left` : `${Math.abs(leftDays)}d overdue`;

  const history = [
    { stage: stageLabel, at: t.updatedAt || t.dueAt || new Date().toISOString() },
    ...(blockers.length ? [{ stage: 'blocked', at: t.updatedAt || new Date().toISOString() }] : []),
  ];

  return `
    <div class="pm-modal-backdrop" id="pmTaskModalBackdrop">
      <div class="pm-modal pm-modal-luxe" role="dialog" aria-modal="true">
        <button class="session-modal-close" id="pmTaskModalClose" title="Закрыть">✕</button>

        <div class="pm-modal-title-wrap">
          <h3>${escapeHtml(t.title || 'Task')}</h3>
          <div class="pm-modal-client">${escapeHtml(t.clientName || '—')}</div>
        </div>

        <div class="pm-modal-grid">
          <div>
            <small>PRIORITY</small>
            <strong>
              <button class="pm-priority pm-priority-btn pr-${escapeHtml(String(t.priority || 'medium').toLowerCase())}" data-pm-priority-toggle>
                ${priorityLabel}
              </button>
            </strong>
            <div class="pm-priority-popover" data-pm-priority-popover>
              <button class="pm-priority-option pr-low" data-pm-priority-option="low">Low</button>
              <button class="pm-priority-option pr-medium" data-pm-priority-option="medium">Med</button>
              <button class="pm-priority-option pr-high" data-pm-priority-option="high">High</button>
              <button class="pm-priority-option pr-critical" data-pm-priority-option="critical">Critical</button>
            </div>
          </div>
          <div><small>ASSIGNEE</small><strong>👤 ${escapeHtml(t.assignee || 'Андрей')}</strong></div>
          <div><small>DUE DATE</small><strong>${escapeHtml(formatTime(t.dueAt))} <span class="pm-subtle">(${escapeHtml(dueHint)})</span></strong></div>
          <div><small>STAGE</small><strong>${escapeHtml(stageLabel)}</strong></div>
        </div>

        <div class="pm-modal-section">
          <small>TAGS</small>
          <div class="pm-tags-wrap">
            ${Array.isArray(t.tags) && t.tags.length
              ? t.tags
                  .map(
                    (x) => `<span class="pm-chip">#${escapeHtml(x)} <button class="pm-chip-x" data-pm-tag-remove="${escapeHtml(x)}" title="Удалить тег">×</button></span>`
                  )
                  .join('')
              : '<span class="session-meta">No tags</span>'}
          </div>
          <div class="pm-tag-input-row">
            <input class="search-input" data-pm-tag-input placeholder="Добавить тег (например urgent)" />
            <button class="ghost-btn" data-pm-tag-add>Добавить</button>
          </div>
        </div>

        <div class="pm-modal-section">
          <small>NOTES</small>
          <div class="pm-note-box">${blockers.length ? `âš  ${escapeHtml(blockers[0].reason || 'Blocked')}` : 'Task is in progress. No blockers right now.'}</div>
        </div>

        <div class="pm-modal-section">
          <small>STAGE HISTORY</small>
          <ul class="pm-history-list">
            ${history
              .map((h) => `<li><span class="dot yellow"></span><b>${escapeHtml(h.stage)}</b> <span class="pm-subtle">${escapeHtml(formatTime(h.at))}</span></li>`)
              .join('')}
          </ul>
        </div>

        <div class="pm-modal-section">
          <small>CLIENT DELIVERABLES ${escapeHtml(t.clientName || '')}</small>
          <div class="pm-deliverables-list">
            ${deliverables.length
              ? deliverables
                  .map(
                    (d) => `<div class="pm-deliverable-row"><span>â€¢ ${escapeHtml(d.deliverableName || 'Deliverable')}</span><span class="pm-chip">${escapeHtml(String(d.status || 'planned').replace(/_/g, '-'))}</span></div>`
                  )
                  .join('')
              : '<div class="session-meta">No deliverables yet</div>'}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderOpsBoard() {
  const b = state.opsBoard;
  const stages = b.stages || [];
  const stageMeta = {
    intake: { label: 'To Do', icon: 'âšª', tone: 'todo' },
    scoping: { label: 'Scoping', icon: 'ðŸŸ¦', tone: 'scoping' },
    activation: { label: 'In Progress', icon: 'ðŸŸ¡', tone: 'progress' },
    review: { label: 'Review', icon: 'ðŸŸ ', tone: 'review' },
    execution: { label: 'On Hold', icon: 'ðŸŸ£', tone: 'hold' },
    update: { label: 'Done', icon: 'ðŸŸ¢', tone: 'done' },
  };
  const priorityLabels = {
    low: 'Low',
    medium: 'Med',
    high: 'High',
    critical: 'Critical',
  };

  const tasks = Array.isArray(b.tasks) ? b.tasks : [];
  const blockedCount = tasks.filter((t) => t.status === 'blocked' || (t.blockers || []).length).length;

  return `
    <section class="pm-luxe-shell">
      <header class="pm-luxe-head">
        <h2>âœ¨ PM Board</h2>
        <div class="pm-luxe-kpis">
          <span>Tasks <b>${tasks.length}</b></span>
          <span>Blocked <b>${blockedCount}</b></span>
          <span>Assignee <b>Андрей</b></span>
        </div>
      </header>

      ${b.loading ? '<div class="session-meta">Загрузка…</div>' : ''}
      ${b.error ? `<div class="session-meta" style="color:#ff9cb3;">${escapeHtml(b.error)}</div>` : ''}

      <div class="pm-luxe-grid">
        ${stages
          .map((stage) => {
            const meta = stageMeta[stage] || { label: stage, icon: 'â€¢', tone: 'todo' };
            const items = tasks.filter((t) => t.stage === stage);
            return `
              <section class="pm-luxe-col tone-${meta.tone}">
                <div class="pm-luxe-col-head">
                  <h3>${meta.icon} ${meta.label}</h3>
                  <span>${items.length}</span>
                </div>
                <div class="pm-luxe-list" data-pm-drop-stage="${stage}">
                  ${items.length === 0
                    ? '<div class="pm-empty">No tasks</div>'
                    : items
                        .map((t) => {
                          const pr = String(t.priority || 'medium').toLowerCase();
                          const isBlocked = t.status === 'blocked' || (t.blockers || []).length;
                          const due = t.dueAt ? formatTime(t.dueAt) : '—';
                          return `
                            <article class="pm-luxe-task" draggable="true" data-pm-task-id="${t.id}" data-pm-stage="${stage}" data-open-pm-task="${t.id}">
                              <div class="pm-task-top">
                                <strong>${escapeHtml(t.title)}</strong>
                                <span class="pm-priority pr-${pr}">${escapeHtml(priorityLabels[pr] || pr)}</span>
                              </div>
                              <div class="pm-task-client">${escapeHtml(t.clientName || '—')}</div>
                              ${isBlocked ? `<div class="pm-task-alert">âš  ${escapeHtml((t.blockers || [])[0]?.reason || 'Blocked')}</div>` : ''}
                              <div class="pm-task-meta">
                                <span>👤 ${escapeHtml(t.assignee || 'Андрей')}</span>
                                <span>â± ${escapeHtml(due)}</span>
                              </div>
                            </article>
                          `;
                        })
                        .join('')}
                </div>
              </section>
            `;
          })
          .join('')}
      </div>
    </section>
    ${renderPmTaskModal()}
  `;
}

function openStandupModal(payloadJson) {
  try {
    const item = JSON.parse(payloadJson);
    state.standupModal = { open: true, item };
    render();
  } catch {
    // ignore
  }
}

function closeStandupModal() {
  state.standupModal = { open: false, item: null };
  render();
}

function renderStandupModal() {
  const m = state.standupModal;
  if (!m.open || !m.item) return '';

  const s = m.item;
  const topics = Array.isArray(s.topics) ? s.topics : [];
  const participants = Array.isArray(s.participants) ? s.participants : [];

  return `
    <div class="pm-modal-backdrop" id="standupModalBackdrop">
      <div class="pm-modal pm-modal-luxe" role="dialog" aria-modal="true">
        <button class="session-modal-close" id="standupModalClose" title="Закрыть">✕</button>

        <div class="pm-modal-title-wrap">
          <h3>👥 ${escapeHtml(s.title || 'Стендап')}</h3>
          <div class="pm-modal-client">${escapeHtml(s.day || '')} · ${escapeHtml(s.time || '')} · ${escapeHtml(s.duration || '15 мин')} <span class="standups-pill" style="margin-left:6px;">ЕЖЕДНЕВНО</span></div>
        </div>

        <div class="pm-modal-section">
          <small>УЧАСТНИКИ</small>
          <div class="pm-tags-wrap">
            ${participants.map((p) => `<span class="pm-chip">${escapeHtml(p)}</span>`).join('') || '<span class="session-meta">Нет участников</span>'}
          </div>
        </div>

        <div class="pm-modal-section">
          <small>ОБСУЖДЁННЫЕ ТЕМЫ</small>
          <div class="standup-topic-list">
            ${topics
              .map(
                (t) => `<div class="standup-topic-row ${t.status === 'done' ? 'done' : 'progress'}">
                  <span>â€¢ ${escapeHtml(t.text || '—')}</span>
                  <b>${t.status === 'done' ? 'готово' : 'в работе'}</b>
                </div>`
              )
              .join('')}
          </div>
        </div>

        <div class="pm-modal-section">
          <small>СВОДКА</small>
          <div class="pm-note-box">${escapeHtml(s.summary || 'Без блокеров. Работа по плану.')}</div>
        </div>
      </div>
    </div>
  `;
}

function renderOpsStandups() {
  const tasks = Array.isArray(state.opsBoard.tasks) ? state.opsBoard.tasks : [];
  const blocked = tasks.filter((t) => t.status === 'blocked' || (t.blockers || []).length).length;
  const overdue = tasks.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < Date.now()).length;
  const view = state.standupsView || 'week';

  const cursor = new Date(state.standupsCursorMs || Date.now());
  cursor.setHours(0, 0, 0, 0);

  const weekDayNames = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
  const monthNames = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

  const buildStandupPayload = (dateObj, dueTasks = []) => ({
    title: dueTasks.length ? `Стендап по задачам дня (${dueTasks.length})` : 'Операционный синк',
    day: dateObj.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }),
    time: '09:00',
    duration: '15 мин',
    lead: 'Стив',
    participants: ['Андрей', 'Стив'],
    topics: [
      { text: `Обзор задач на день (${dueTasks.length})`, status: dueTasks.length ? 'progress' : 'done' },
      { text: 'Проверка SLA и блокеров', status: blocked ? 'progress' : 'done' },
      { text: 'Фиксация решений и next steps', status: 'done' },
    ],
    summary: `Задач: ${tasks.length}, блокеры: ${blocked}, просрочено: ${overdue}.`,
  });

  const tasksByDate = tasks.reduce((acc, t) => {
    if (!t?.dueAt) return acc;
    const d = new Date(t.dueAt);
    if (Number.isNaN(d.getTime())) return acc;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  const monday = new Date(cursor);
  const dayFromMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dayFromMonday);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const dueTasks = tasksByDate[key] || [];
    const list = dueTasks.length ? [buildStandupPayload(d, dueTasks)] : [];
    return {
      label: weekDayNames[i],
      date: d.getDate(),
      iso: d.toISOString(),
      isToday: d.toDateString() === new Date().toDateString(),
      items: list,
    };
  });

  const weekRange = `${weekDays[0].date} ${monthNames[new Date(weekDays[0].iso).getMonth()]} — ${weekDays[6].date} ${monthNames[new Date(weekDays[6].iso).getMonth()]}`;

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const monthLabel = `${monthNames[cursor.getMonth()]} ${cursor.getFullYear()}`;

  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));

  const monthCells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const dueTasks = tasksByDate[key] || [];
    const list = dueTasks.length ? [buildStandupPayload(d, dueTasks)] : [];
    return {
      date: d,
      inMonth: d.getMonth() === cursor.getMonth(),
      isToday: d.toDateString() === new Date().toDateString(),
      items: list,
    };
  });

  return `
    <section class="standups-v2-shell">
      <header class="standups-v2-head">
        <div class="standups-v2-title">👥 Стендапы</div>
        <div class="standups-v2-controls">
          <button class="standups-toggle ${view === 'week' ? 'active' : ''}" data-standups-view="week">Неделя</button>
          <button class="standups-toggle ${view === 'month' ? 'active' : ''}" data-standups-view="month">Месяц</button>
          <button class="standups-nav-btn" data-standups-nav="prev">‹</button>
          <span class="standups-range">${escapeHtml(view === 'week' ? weekRange : monthLabel)}</span>
          <button class="standups-nav-btn" data-standups-nav="next">›</button>
        </div>
      </header>

      <div class="standups-v2-kpi">
        <span>Задачи PM <b>${tasks.length}</b></span>
        <span>Заблокировано <b>${blocked}</b></span>
        <span>Просрочено <b>${overdue}</b></span>
        <span>Источник <b>PM-доска</b></span>
      </div>

      ${view === 'week'
        ? `<div class="standups-week-board">
            ${weekDays
              .map(
                (d) => `<section class="standups-day-col ${d.isToday ? 'active' : ''}">
                  <div class="standups-day-head"><small>${d.label}</small><strong>${d.date}</strong></div>
                  <div class="standups-day-body">
                    ${d.items.length
                      ? d.items
                          .map(
                            (it) => `<button class="standups-event-card" data-open-standup='${escapeHtml(JSON.stringify(it))}'>
                              <div class="standups-event-tag">ЕЖЕДНЕВНО</div>
                              <h4>${escapeHtml(it.title)}</h4>
                              <p>🕘 ${escapeHtml(it.time)} · ${escapeHtml(it.lead)}</p>
                            </button>`
                          )
                          .join('')
                      : '<div class="standups-empty-slot">—</div>'}
                  </div>
                </section>`
              )
              .join('')}
          </div>`
        : `<div class="standups-month-calendar">
            <div class="standups-month-weekdays">${weekDayNames.map((n) => `<span>${n}</span>`).join('')}</div>
            <div class="standups-month-grid">
              ${monthCells
                .map(
                  (c) => `<article class="standups-month-cell ${c.inMonth ? '' : 'muted'} ${c.isToday ? 'today' : ''}">
                    <div class="standups-month-date">${c.date.getDate()}</div>
                    <div class="standups-month-events">
                      ${c.items
                        .slice(0, 2)
                        .map(
                          (it) => `<button class="standups-month-event" data-open-standup='${escapeHtml(JSON.stringify(it))}'>${escapeHtml(it.title)}</button>`
                        )
                        .join('')}
                    </div>
                  </article>`
                )
                .join('')}
            </div>
          </div>`}

      <div class="standups-v2-note">Источник: реальные данные из PM-доски.</div>
      ${renderStandupModal()}
    </section>
  `;
}

function renderOpsDocs() {
  const d = state.opsDocs;
  return `
    <h2 class="section-title">Ops Docs</h2>
    <section class="split-layout panel">
      <aside class="split-nav">
        <input class="search-input" placeholder="Search docs keyword" value="${escapeHtml(d.query || '')}" data-ops-docs-search />
        <div class="daily-list" style="margin-top:10px;">
          ${d.items
            .filter((it) => !d.query || it.title.toLowerCase().includes(d.query.toLowerCase()))
            .map((it) => `<button class="daily-item ${it.file === d.selectedFile ? 'active' : ''}" data-ops-doc-file="${it.file}">${escapeHtml(it.title)}</button>`)
            .join('') || '<div class="session-meta">Нет файлов</div>'}
        </div>
      </aside>
      <article class="split-preview markdown-preview pleasant-markdown">${highlightMarkdownByQuery(d.content, d.query)}</article>
    </section>
  `;
}

function renderOpsWorkspaces() {
  const w = state.opsWorkspaces;
  const selected = w.workspaces.find((x) => x.id === w.selectedWorkspace) || w.workspaces[0];
  return `
    <h2 class="section-title">Ops Workspaces</h2>
    <section class="split-layout panel">
      <aside class="split-nav">
        <div class="daily-sidebar-title">Workspaces</div>
        ${w.workspaces.map((x) => `<button class="daily-item ${x.id === selected?.id ? 'active' : ''}" data-ops-workspace="${x.id}">${escapeHtml(x.title)}</button>`).join('')}
        <input class="search-input" placeholder="Search file" value="${escapeHtml(w.query || '')}" data-ops-workspace-search style="margin-top:10px;"/>
        <div class="daily-list" style="margin-top:8px;">
          ${(selected?.files || [])
            .filter((f) => !w.query || f.toLowerCase().includes(w.query.toLowerCase()))
            .map((f) => `<button class="daily-item ${f === w.selectedFile ? 'active' : ''}" data-ops-workspace-file="${escapeHtml(f)}">${escapeHtml(f)}</button>`)
            .join('') || '<div class="session-meta">Нет файлов</div>'}
        </div>
      </aside>
      <article class="split-preview markdown-preview pleasant-markdown">${highlightMarkdownByQuery(w.content, w.query)}</article>
    </section>
  `;
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

function getSkillsDirectoryFilteredItems() {
  const d = state.skillsDirectory;
  const list = Array.isArray(d.items) ? d.items : [];
  const f = d.filter || 'all';
  const q = String(d.query || '').trim().toLowerCase();

  let filtered = list;
  if (f === 'skill') filtered = filtered.filter((x) => x.kind === 'skill');
  if (f === 'plugin') filtered = filtered.filter((x) => x.kind === 'plugin');
  if (f === 'builtin') filtered = filtered.filter((x) => x.origin === 'built-in');
  if (f === 'custom') filtered = filtered.filter((x) => x.origin === 'custom');
  if (f === 'enabled') filtered = filtered.filter((x) => x.enabled === true || x.eligible === true);

  if (q) {
    filtered = filtered.filter((x) => {
      const text = [x.name, x.description, x.kindLabel, x.origin, x.statusLabel].join(' ').toLowerCase();
      return text.includes(q);
    });
  }

  return filtered;
}

function renderSkillsDirectory() {
  const d = state.skillsDirectory;
  const filtered = getSkillsDirectoryFilteredItems();

  const pills = [
    { id: 'all', label: `All ${d.items.length}` },
    { id: 'plugin', label: `Plugins ${d.items.filter((x) => x.kind === 'plugin').length}` },
    { id: 'skill', label: `Skills ${d.items.filter((x) => x.kind === 'skill').length}` },
    { id: 'builtin', label: 'Built-in' },
    { id: 'custom', label: 'Custom' },
    { id: 'enabled', label: 'Active' },
  ];

  return `
    <h2 class="section-title">Skills Directory</h2>
    <section class="panel skills-shell">
      <div class="skills-toolbar">
        <div class="pill-row">
          ${pills
            .map(
              (p) => `<button class="pill-btn ${d.filter === p.id ? 'active' : ''}" data-skill-filter="${p.id}">${escapeHtml(p.label)}</button>`
            )
            .join('')}
        </div>
        <input class="search-input skills-search" data-skill-search placeholder="Search skills..." value="${escapeHtml(d.query || '')}" />
      </div>

      ${d.loading ? '<div class="session-meta">Загрузка каталога…</div>' : ''}
      ${d.error ? `<div class="session-meta" style="color:#ff9cb3;">${escapeHtml(d.error)}</div>` : ''}

      <div class="skills-grid">
        ${filtered.length === 0
          ? '<div class="session-meta">Ничего не найдено по текущему фильтру.</div>'
          : filtered
              .map(
                (x) => `<article class="skill-card">
                    <div class="skill-card-head">
                      <div class="skill-icon">â—ˆ</div>
                      <div>
                        <h4>${escapeHtml(x.name || x.id || '—')}</h4>
                        <small>${escapeHtml((x.id || '').replace(/^.*:/, ''))}</small>
                      </div>
                    </div>
                    <p>${escapeHtml(x.description || 'No description')}</p>
                    <div class="skill-tags">
                      <span class="skill-tag kind-${escapeHtml((x.kind || 'unknown').toLowerCase())}">${escapeHtml(x.kindLabel || x.kind || '—')}</span>
                      <span class="skill-tag source-${escapeHtml((x.origin || 'unknown').toLowerCase().replace(/[^a-z-]/g, '-'))}">${escapeHtml(x.origin || '—')}</span>
                      <span class="skill-tag status">${escapeHtml(x.statusLabel || x.status || '—')}</span>
                      ${x.kind === 'plugin' ? `<span class="skill-tag ${x.enabled ? 'plugin-enabled' : 'plugin-disabled'}">${x.enabled ? 'enabled' : 'disabled'}</span>` : ''}
                      ${x.kind === 'plugin' ? `<span class="skill-tag utilization ${x.utilization?.inAutomations ? 'in-use' : ''}">${escapeHtml(x.utilization?.summary || '—')}</span>` : ''}
                    </div>
                  </article>`
              )
              .join('')}
      </div>
    </section>
  `;
}

function getModelPill(modelRaw) {
  const raw = String(modelRaw || '').trim().toLowerCase();

  if (!raw || raw === '—' || raw === '-' || raw === 'default') {
    return { label: 'GPT 5.3', tone: 'gpt' };
  }
  if (raw.includes('gemini')) {
    return { label: 'Gemini', tone: 'gemini' };
  }
  if (raw.includes('openai') || raw.includes('gpt')) {
    return { label: 'OpenAI', tone: 'openai' };
  }
  return { label: modelRaw, tone: 'neutral' };
}

function openAutomationEditModal(jobId) {
  const job = (state.automation.jobs || []).find((x) => String(x.id) === String(jobId));
  if (!job) return;

  state.automation.editModal = {
    open: true,
    saving: false,
    error: null,
    jobId: job.id,
    form: {
      name: job.name || '',
      description: job.description || '',
      enabled: job.enabled !== false,
      scheduleExpr: job.scheduleExpr || '',
      scheduleTz: job.scheduleTz || 'Asia/Vladivostok',
      message: job.message || '',
    },
  };

  render();
}

function closeAutomationEditModal() {
  state.automation.editModal = {
    open: false,
    saving: false,
    error: null,
    jobId: null,
    form: null,
  };
  render();
}

async function saveAutomationEditModal() {
  const m = state.automation.editModal;
  if (!m?.open || !m.jobId || !m.form) return;

  state.automation.editModal.saving = true;
  state.automation.editModal.error = null;
  render();

  try {
    const response = await fetch('/api/automation/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.jobId, ...m.form }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || 'Не удалось сохранить cron-задачу');
    }

    await loadAutomationData({ silent: true });
    closeAutomationEditModal();
  } catch (err) {
    state.automation.editModal.saving = false;
    state.automation.editModal.error = err?.message || 'Ошибка сохранения';
    render();
  }
}

function renderAutomationEditModal() {
  const m = state.automation.editModal;
  if (!m?.open || !m.form) return '';

  return `
    <div class="session-modal-backdrop" id="automationEditBackdrop">
      <div class="session-modal" style="max-width:900px;" role="dialog" aria-modal="true">
        <button class="session-modal-close" id="automationEditClose" title="Закрыть">✕</button>
        <div class="session-modal-header">
          <h3>Редактирование cron-задачи</h3>
        </div>

        <div class="automation-edit-grid">
          <label><small>Название</small><input class="search-input" data-auto-edit="name" value="${escapeHtml(m.form.name || '')}"/></label>
          <label><small>Timezone</small><input class="search-input" data-auto-edit="scheduleTz" value="${escapeHtml(m.form.scheduleTz || 'Asia/Vladivostok')}"/></label>
          <label style="grid-column:1 / -1;"><small>Описание</small><input class="search-input" data-auto-edit="description" value="${escapeHtml(m.form.description || '')}"/></label>
          <label style="grid-column:1 / -1;"><small>Cron expression</small><input class="search-input" data-auto-edit="scheduleExpr" value="${escapeHtml(m.form.scheduleExpr || '')}" placeholder="0 8 * * *"/></label>
          <label style="grid-column:1 / -1;"><small>Инструкции (message)</small><textarea class="search-input" data-auto-edit="message" style="min-height:180px;resize:vertical;">${escapeHtml(m.form.message || '')}</textarea></label>
          <label class="automation-enabled-toggle"><input type="checkbox" data-auto-edit="enabled" ${m.form.enabled ? 'checked' : ''}/> <span>Enabled</span></label>
        </div>

        ${m.error ? `<div class="session-meta" style="color:#ff9cb3;margin-top:10px;">${escapeHtml(m.error)}</div>` : ''}

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px;">
          <button class="ghost-btn" id="automationEditCancel">Отмена</button>
          <button class="ghost-btn" id="automationEditSave">${m.saving ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  `;
}

function renderAutomation() {
  const a = state.automation;
  const expandedSet = new Set(Array.isArray(a.expandedJobIds) ? a.expandedJobIds : []);
  const modelFilter = a.modelFilter || 'all';
  const jobs = (a.jobs || []).filter((job) => {
    if (modelFilter === 'all') return true;
    return getModelPill(job.model).tone === modelFilter;
  });

  return `
    <h2 class="section-title">Automations</h2>
    <section class="panel table-wrap">
      <div class="pill-row" style="margin-bottom:10px;">
        <button class="pill-btn ${modelFilter === 'all' ? 'active' : ''}" data-automation-model-filter="all">All ${a.jobs.length}</button>
        <button class="pill-btn ${modelFilter === 'gpt' ? 'active' : ''}" data-automation-model-filter="gpt">GPT 5.3</button>
        <button class="pill-btn ${modelFilter === 'gemini' ? 'active' : ''}" data-automation-model-filter="gemini">Gemini</button>
        <button class="pill-btn ${modelFilter === 'openai' ? 'active' : ''}" data-automation-model-filter="openai">OpenAI</button>
      </div>
      ${a.loading ? '<div class="session-meta" style="margin-bottom:10px;">Загрузка автоматизаций…</div>' : ''}
      ${a.error ? `<div class="session-meta" style="color:#ff9cb3;margin-bottom:10px;">${escapeHtml(a.error)}</div>` : ''}

      <table class="mc-table automation-table">
        <thead>
          <tr>
            <th style="width:60px;">#</th>
            <th>Название</th>
            <th>Расписание</th>
            <th>Статус</th>
            <th>Модель</th>
            <th>Следующий запуск</th>
          </tr>
        </thead>
        <tbody>
          ${jobs.length === 0
            ? '<tr><td colspan="6" class="session-meta">Нет cron-задач под выбранный фильтр</td></tr>'
            : jobs
                .map((job) => {
                  const isOpen = expandedSet.has(job.id);
                  const modelPill = getModelPill(job.model);
                  return `
                    <tr class="automation-row-main ${isOpen ? 'open' : ''}">
                      <td><button class="ghost-btn automation-expand-btn" data-automation-toggle-id="${escapeHtml(job.id || '')}">${isOpen ? 'âˆ’' : '+'}</button></td>
                      <td>${escapeHtml(job.name || 'cron')}</td>
                      <td>${escapeHtml(job.schedule || '—')}</td>
                      <td>${escapeHtml(job.status || '—')}</td>
                      <td><span class="model-pill model-pill-${escapeHtml(modelPill.tone)}">${escapeHtml(modelPill.label || '—')}</span></td>
                      <td>${escapeHtml(job.nextRun || '—')}</td>
                    </tr>
                    <tr class="automation-row-details ${isOpen ? 'open' : ''}">
                      <td colspan="6">
                        <div class="automation-details-grid">
                          <div><small>ID</small><strong>${escapeHtml(job.id || '—')}</strong></div>
                          <div><small>Последний запуск</small><strong>${escapeHtml(job.lastRun || '—')}</strong></div>
                          <div><small>Сессия</small><strong>${escapeHtml(job.sessionTarget || '—')}</strong></div>
                          <div><small>Payload</small><strong>${escapeHtml(job.payloadKind || '—')}</strong></div>
                          <div><small>Wake mode</small><strong>${escapeHtml(job.wakeMode || '—')}</strong></div>
                          <div><small>Delivery</small><strong>${escapeHtml([job.deliveryMode, job.deliveryChannel].filter(Boolean).join(' / ') || '—')}</strong></div>
                          <div><small>Ошибки подряд</small><strong>${escapeHtml(String(job.consecutiveErrors ?? 0))}</strong></div>
                          <div><small>Enabled</small><strong>${job.enabled ? 'yes' : 'no'}</strong></div>
                        </div>
                        <div class="automation-instruction-block">
                          <h4>Инструкции cron-задачи</h4>
                          <pre class="history-text" style="font-size:13px;white-space:pre-wrap;">${escapeHtml(job.message || '—')}</pre>
                          <div style="margin-top:10px;display:flex;justify-content:flex-end;">
                            <button class="ghost-btn" data-automation-edit-id="${escapeHtml(job.id || '')}">Редактировать</button>
                          </div>
                        </div>
                      </td>
                    </tr>`;
                })
                .join('')}
        </tbody>
      </table>
    </section>
    ${renderAutomationEditModal()}
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

function renderOrgChart() {
  const agentColumns = [
    {
      title: 'Агент роста',
      mission: 'Привлечение и активация пользователей 10→100→1000',
      assistants: ['Ассистент контента', 'Ассистент гипотез', 'Ассистент аналитики'],
    },
    {
      title: 'Агент продукта',
      mission: 'Приоритезация фич, UX и ценность для клиентов',
      assistants: ['Ассистент UX', 'Ассистент бэклога', 'Ассистент customer-feedback'],
    },
    {
      title: 'Агент операций',
      mission: 'SOP, контроль исполнения и стабильность процессов',
      assistants: ['Ассистент cron/автоматизаций', 'Ассистент контроля задач', 'Ассистент отчётности'],
    },
    {
      title: 'Агент лаборатории',
      mission: 'Эксперименты, staged-прототипы и безопасное тестирование',
      assistants: ['Ассистент экспериментов', 'Ассистент качества', 'Ассистент деплой-гейтов'],
    },
  ];

  return `
    <h2 class="section-title">Оргдиаграмма (черновик v0)</h2>
    <section class="panel" style="margin-bottom:14px;">
      <div class="info-grid">
        <div class="info-cell"><small>Уровень 1</small><strong>Андрей (человек / владелец)</strong></div>
        <div class="info-cell"><small>Уровень 2</small><strong>Стив (операционный партнёр / Chief of Execution)</strong></div>
        <div class="info-cell"><small>Статус</small><strong>Каркас, без wiring</strong></div>
        <div class="info-cell"><small>Цель</small><strong>Определить состав субагентов к эпизоду 3</strong></div>
      </div>
    </section>

    <section class="panel">
      <h3 style="margin:0 0 10px;">Уровень 3 — подчинённые агенты Стива</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;">
        ${agentColumns
          .map(
            (col) => `
          <article class="card" style="text-align:left;">
            <h3 style="margin:0 0 6px;">${escapeHtml(col.title)}</h3>
            <p class="session-meta" style="margin:0 0 10px;">${escapeHtml(col.mission)}</p>
            <div class="session-meta" style="margin-bottom:6px;"><strong>Под ним помощники:</strong></div>
            <ul style="margin:0;padding-left:18px;">
              ${col.assistants.map((a) => `<li style="margin:4px 0;">${escapeHtml(a)}</li>`).join('')}
            </ul>
          </article>
        `
          )
          .join('')}
      </div>
    </section>

    <section class="panel" style="margin-top:14px;">
      <h3 style="margin:0 0 10px;">Что обсудить в следующих эпизодах</h3>
      <ul style="margin:0;padding-left:18px;">
        <li>Какие из этих агентов запускаем первыми (MVP-состав).</li>
        <li>Какие метрики и SLA закрепляем за каждым агентом.</li>
        <li>Какие отдельные workspace и права нужны каждому агенту.</li>
        <li>Как делегирование проходит через Стива и где человек утверждает решения.</li>
      </ul>
    </section>
  `;
}

function renderOrgChart() {
  const leads = [
    {
      role: 'CTO',
      icon: 'ðŸ§ ',
      title: 'Продукт и технологии',
      mission: 'Техстратегия, архитектура, UX и качество релизов',
      color: 'blue',
      kpi: 'Release Stability 99.5%',
      teams: [
        { name: 'Backend и интеграции', count: 2 },
        { name: 'Frontend и UX', count: 2 },
        { name: 'QA и надёжность', count: 1 },
      ],
    },
    {
      role: 'CMO',
      icon: 'ðŸ“ˆ',
      title: 'Рост и маркетинг',
      mission: 'Воронка 10→100→1000, эксперименты и контент-система',
      color: 'gold',
      kpi: 'Activation +18% WoW',
      teams: [
        { name: 'Контент-система', count: 2 },
        { name: 'Эксперименты привлечения', count: 2 },
        { name: 'Аналитика и инсайты', count: 1 },
      ],
    },
    {
      role: 'COO',
      icon: 'âš™ï¸',
      title: 'Операции и delivery',
      mission: 'SOP, контроль исполнения, SLA и прозрачность delivery',
      color: 'teal',
      kpi: 'SLA On-time 96%',
      teams: [
        { name: 'Контроль исполнения', count: 2 },
        { name: 'Automation Ops', count: 2 },
        { name: 'Клиентский delivery', count: 1 },
      ],
    },
  ];

  const totalTeams = leads.reduce((sum, lead) => sum + lead.teams.length, 0);
  const totalAgents = 2 + leads.length + leads.reduce((sum, lead) => sum + lead.teams.reduce((n, t) => n + t.count, 0), 0);

  return `
    <section class="team-v2-shell">
      <header class="team-v2-head">
        <div>
          <h2 class="section-title team-v2-title">Команда v2</h2>
          <p class="team-v2-sub">Операционная структура Avanta OS · визуал для ежедневного управления</p>
        </div>
        <div class="team-v2-chip">Live Org</div>
      </header>

      <div class="team-v2-metrics">
        <article class="team-v2-metric"><span>${totalAgents}</span><small>Всего агентов</small></article>
        <article class="team-v2-metric"><span>${leads.length + 1}</span><small>Руководящий контур</small></article>
        <article class="team-v2-metric"><span>${totalTeams}</span><small>Команд</small></article>
        <article class="team-v2-metric"><span>3</span><small>Активных трека</small></article>
      </div>

      <section class="team-v2-core">
        <article class="team-v2-node owner">
          <div class="team-v2-person-row">
            <div class="team-avatar team-avatar-owner">А</div>
            <div>
              <div class="team-v2-role">Owner</div>
              <h3>Андрей</h3>
              <p>Стратегия, фокус и финальное решение</p>
            </div>
          </div>
        </article>

        <div class="team-v2-connector"></div>

        <article class="team-v2-node chief">
          <div class="team-v2-person-row">
            <div class="team-avatar team-avatar-chief">ðŸ§­</div>
            <div>
              <div class="team-v2-role">Chief of Execution</div>
              <h3>Стив</h3>
              <p>Оркестрация задач, приоритеты, контроль исполнения</p>
              <div class="team-v2-tags">
                <span>Ops Command Center</span>
                <span>Execution OS</span>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section class="team-v2-leads">
        ${leads
          .map(
            (lead) => {
              const leadName = lead.role === 'CTO' ? 'Илья' : lead.role === 'CMO' ? 'Мария' : 'Алексей';
              const leadAvatar = lead.role === 'CTO' ? 'И' : lead.role === 'CMO' ? 'М' : 'А';
              return `
          <article class="team-v2-lead tone-${escapeHtml(lead.color)}">
            <div class="team-v2-lead-top">
              <span>${escapeHtml(lead.icon)} ${escapeHtml(lead.role)}</span>
              <span class="team-v2-kpi">${escapeHtml(lead.kpi)}</span>
            </div>

            <div class="team-v2-lead-person">
              <div class="team-avatar team-avatar-${escapeHtml(lead.color)}">${escapeHtml(leadAvatar)}</div>
              <div>
                <div class="team-v2-role">${escapeHtml(lead.role)} Lead</div>
                <h3>${escapeHtml(leadName)}</h3>
              </div>
            </div>

            <h4 class="team-v2-lead-title">${escapeHtml(lead.title)}</h4>
            <p>${escapeHtml(lead.mission)}</p>
            <div class="team-v2-team-list">
              ${lead.teams
                .map(
                  (team) => `
                <div class="team-v2-team-item">
                  <span>${escapeHtml(team.name)}</span>
                  <small>${escapeHtml(team.count)} агента</small>
                </div>`
                )
                .join('')}
            </div>
          </article>`;
            }
          )
          .join('')}
      </section>
    </section>
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
                  <span>${escapeHtml(c.status || 'ready_for_review')} · модуль: ${escapeHtml(c.auditedModule || 'lab')} · score: ${escapeHtml(c.priorityScore ?? 'n/a')}</span>
                  <span>влияние: ${escapeHtml(c.impact ?? 'n/a')} · fit: ${escapeHtml(c.strategicFit ?? 'n/a')} · effort: ${escapeHtml(c.effort ?? 'n/a')} · риск: ${escapeHtml(c.risk ?? 'n/a')}</span>
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

  document.querySelectorAll('[data-automation-toggle-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-automation-toggle-id');
      if (!id) return;
      const list = Array.isArray(state.automation.expandedJobIds) ? [...state.automation.expandedJobIds] : [];
      const has = list.includes(id);
      state.automation.expandedJobIds = has ? list.filter((x) => x !== id) : [...list, id];
      render();
    });
  });

  document.querySelectorAll('[data-automation-model-filter]').forEach((el) => {
    el.addEventListener('click', () => {
      state.automation.modelFilter = el.getAttribute('data-automation-model-filter') || 'all';
      render();
    });
  });

  document.querySelectorAll('[data-skill-filter]').forEach((el) => {
    el.addEventListener('click', () => {
      state.skillsDirectory.filter = el.getAttribute('data-skill-filter') || 'all';
      render();
    });
  });

  const skillSearch = document.querySelector('[data-skill-search]');
  if (skillSearch) {
    skillSearch.addEventListener('input', (e) => {
      state.skillsDirectory.query = e.target.value || '';
      render();
    });
  }

  document.querySelectorAll('[data-automation-edit-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-automation-edit-id');
      if (id) openAutomationEditModal(id);
    });
  });

  document.querySelectorAll('[data-open-lab-preview]').forEach((el) => {
    el.addEventListener('click', () => {
      const ref = el.getAttribute('data-open-lab-preview');
      if (ref) openLabPreview(ref);
    });
  });

  const protoResearchQuery = document.querySelector('[data-proto-research-query]');
  if (protoResearchQuery) {
    protoResearchQuery.addEventListener('input', (e) => {
      state.lab.research.query = e.target.value || '';
    });
    protoResearchQuery.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runPrototypeResearch();
      }
    });
  }

  const protoResearchRun = document.querySelector('[data-proto-research-run]');
  if (protoResearchRun) {
    protoResearchRun.addEventListener('click', () => runPrototypeResearch());
  }

  document.querySelectorAll('[data-standups-view]').forEach((el) => {
    el.addEventListener('click', () => {
      const view = el.getAttribute('data-standups-view');
      if (!view) return;
      state.standupsView = view;
      render();
    });
  });

  document.querySelectorAll('[data-standups-nav]').forEach((el) => {
    el.addEventListener('click', () => {
      const dir = el.getAttribute('data-standups-nav');
      const sign = dir === 'prev' ? -1 : 1;
      const current = new Date(state.standupsCursorMs || Date.now());
      if (state.standupsView === 'month') current.setMonth(current.getMonth() + sign);
      else current.setDate(current.getDate() + sign * 7);
      state.standupsCursorMs = current.getTime();
      render();
    });
  });

  document.querySelectorAll('[data-open-standup]').forEach((el) => {
    el.addEventListener('click', () => {
      const payload = el.getAttribute('data-open-standup');
      if (payload) openStandupModal(payload);
    });
  });

  document.querySelectorAll('[data-ops-doc-file]').forEach((el) => {
    el.addEventListener('click', () => {
      const file = el.getAttribute('data-ops-doc-file');
      if (file) loadOpsDocs(file);
    });
  });

  const docsSearch = document.querySelector('[data-ops-docs-search]');
  if (docsSearch) {
    docsSearch.addEventListener('input', (e) => {
      state.opsDocs.query = e.target.value || '';
      render();
    });
  }

  document.querySelectorAll('[data-ops-workspace]').forEach((el) => {
    el.addEventListener('click', () => {
      const ws = el.getAttribute('data-ops-workspace');
      if (!ws) return;
      state.opsWorkspaces.selectedWorkspace = ws;
      loadOpsWorkspaces();
    });
  });

  document.querySelectorAll('[data-ops-workspace-file]').forEach((el) => {
    el.addEventListener('click', () => {
      const file = el.getAttribute('data-ops-workspace-file');
      if (!file) return;
      loadOpsWorkspaces(file);
    });
  });

  const wsSearch = document.querySelector('[data-ops-workspace-search]');
  if (wsSearch) {
    wsSearch.addEventListener('input', (e) => {
      state.opsWorkspaces.query = e.target.value || '';
      render();
    });
  }

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

  const pmCloseBtn = document.getElementById('pmTaskModalClose');
  if (pmCloseBtn) pmCloseBtn.addEventListener('click', closePmTaskModal);

  const pmBackdrop = document.getElementById('pmTaskModalBackdrop');
  if (pmBackdrop) pmBackdrop.addEventListener('click', (e) => e.target === pmBackdrop && closePmTaskModal());

  const standupCloseBtn = document.getElementById('standupModalClose');
  if (standupCloseBtn) standupCloseBtn.addEventListener('click', closeStandupModal);

  const autoEditCloseBtn = document.getElementById('automationEditClose');
  if (autoEditCloseBtn) autoEditCloseBtn.addEventListener('click', closeAutomationEditModal);

  const autoEditCancelBtn = document.getElementById('automationEditCancel');
  if (autoEditCancelBtn) autoEditCancelBtn.addEventListener('click', closeAutomationEditModal);

  const autoEditSaveBtn = document.getElementById('automationEditSave');
  if (autoEditSaveBtn) autoEditSaveBtn.addEventListener('click', saveAutomationEditModal);

  const autoEditBackdrop = document.getElementById('automationEditBackdrop');
  if (autoEditBackdrop) autoEditBackdrop.addEventListener('click', (e) => e.target === autoEditBackdrop && closeAutomationEditModal());

  document.querySelectorAll('[data-auto-edit]').forEach((el) => {
    el.addEventListener('input', (e) => {
      const key = el.getAttribute('data-auto-edit');
      if (!key || !state.automation.editModal?.form) return;
      const isCheckbox = e.target instanceof HTMLInputElement && e.target.type === 'checkbox';
      state.automation.editModal.form[key] = isCheckbox ? !!e.target.checked : e.target.value;
    });
  });

  const standupBackdrop = document.getElementById('standupModalBackdrop');
  if (standupBackdrop) standupBackdrop.addEventListener('click', (e) => e.target === standupBackdrop && closeStandupModal());

  const pmPriorityToggle = document.querySelector('[data-pm-priority-toggle]');
  const pmPriorityPopover = document.querySelector('[data-pm-priority-popover]');
  if (pmPriorityToggle && pmPriorityPopover && state.pmTaskModal?.task?.id) {
    pmPriorityToggle.addEventListener('click', (e) => {
      e.preventDefault();
      pmPriorityPopover.classList.toggle('open');
    });

    pmPriorityPopover.querySelectorAll('[data-pm-priority-option]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await savePmTaskMeta(state.pmTaskModal.task.id, { priority: btn.getAttribute('data-pm-priority-option') });
        } catch (err) {
          state.opsBoard.error = err?.message || 'Ошибка обновления приоритета';
          render();
        }
      });
    });
  }

  const pmTagAddBtn = document.querySelector('[data-pm-tag-add]');
  const pmTagInput = document.querySelector('[data-pm-tag-input]');
  if (pmTagAddBtn && pmTagInput && state.pmTaskModal?.task?.id) {
    const submitTag = async () => {
      const raw = String(pmTagInput.value || '').trim();
      if (!raw) return;
      const existing = Array.isArray(state.pmTaskModal.task.tags) ? state.pmTaskModal.task.tags : [];
      const merged = [...new Set([...existing, raw])];
      try {
        await savePmTaskMeta(state.pmTaskModal.task.id, { tags: merged });
      } catch (err) {
        state.opsBoard.error = err?.message || 'Ошибка добавления тега';
        render();
      }
    };

    pmTagAddBtn.addEventListener('click', submitTag);
    pmTagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitTag();
      }
    });
  }

  document.querySelectorAll('[data-pm-tag-remove]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const tag = String(btn.getAttribute('data-pm-tag-remove') || '').trim();
      if (!tag || !state.pmTaskModal?.task?.id) return;
      const existing = Array.isArray(state.pmTaskModal.task.tags) ? state.pmTaskModal.task.tags : [];
      const next = existing.filter((x) => String(x) !== tag);
      try {
        await savePmTaskMeta(state.pmTaskModal.task.id, { tags: next });
      } catch (err) {
        state.opsBoard.error = err?.message || 'Ошибка удаления тега';
        render();
      }
    });
  });

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

  document.querySelectorAll('[data-open-pm-task]').forEach((el) => {
    el.addEventListener('click', () => {
      const taskId = el.getAttribute('data-open-pm-task');
      if (taskId) openPmTaskModal(taskId);
    });
  });

  document.querySelectorAll('[data-pm-task-id]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      const taskId = el.getAttribute('data-pm-task-id');
      const fromStage = el.getAttribute('data-pm-stage');
      if (!taskId || !e.dataTransfer) return;
      // text/plain нужен для стабильного drag&drop в части браузеров
      e.dataTransfer.setData('text/plain', `pm-task:${taskId}`);
      e.dataTransfer.setData('text/pm-task-id', taskId);
      e.dataTransfer.setData('text/pm-from-stage', fromStage || '');
      e.dataTransfer.effectAllowed = 'move';
      document.body.classList.add('pm-dragging');
    });
    el.addEventListener('dragend', () => {
      document.body.classList.remove('pm-dragging');
      document.querySelectorAll('.pm-drop-target').forEach((x) => x.classList.remove('pm-drop-target'));
    });
  });

  document.querySelectorAll('[data-pm-drop-stage]').forEach((el) => {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      el.classList.add('pm-drop-target');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('pm-drop-target');
    });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('pm-drop-target');
      const toStage = el.getAttribute('data-pm-drop-stage');

      const taskIdRaw = e.dataTransfer?.getData('text/pm-task-id') || '';
      const fallback = e.dataTransfer?.getData('text/plain') || '';
      const fallbackMatch = fallback.match(/^pm-task:(\d+)$/);
      const resolvedTaskId = taskIdRaw || (fallbackMatch ? fallbackMatch[1] : '');

      const fromStage = e.dataTransfer?.getData('text/pm-from-stage');
      const taskId = Number(resolvedTaskId);
      if (!toStage || Number.isNaN(taskId)) return;
      if (fromStage === toStage) return;
      await moveOpsTaskStage(taskId, toStage);
    });
  });

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

async function moveOpsTaskStage(taskId, toStage) {
  try {
    const response = await fetch('/api/ops/board/move-stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, toStage }),
    });
    if (!response.ok) throw new Error('Не удалось переместить задачу');
    await loadOpsBoard();
  } catch (err) {
    state.opsBoard.error = err?.message || 'Ошибка перемещения задачи';
    render();
  }
}

async function loadOpsBoard() {
  state.opsBoard.loading = true;
  state.opsBoard.error = null;
  render();
  try {
    const response = await fetch('/api/ops/board', { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить PM Board');
    const payload = await response.json();
    state.opsBoard = {
      loading: false,
      error: null,
      stages: Array.isArray(payload.stages) ? payload.stages : state.opsBoard.stages,
      tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
      deliverables: Array.isArray(payload.deliverables) ? payload.deliverables : [],
    };
  } catch (err) {
    state.opsBoard.loading = false;
    state.opsBoard.error = err?.message || 'Ошибка PM Board';
  }
  render();
}

async function loadOpsDocs(file) {
  state.opsDocs.loading = true;
  state.opsDocs.error = null;
  render();
  try {
    const suffix = file ? `?file=${encodeURIComponent(file)}` : '';
    const response = await fetch(`/api/ops/docs${suffix}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить docs');
    const payload = await response.json();
    state.opsDocs = {
      ...state.opsDocs,
      loading: false,
      error: null,
      items: Array.isArray(payload.items) ? payload.items : [],
      selectedFile: payload.selectedFile || null,
      content: payload.content || '',
    };
  } catch (err) {
    state.opsDocs.loading = false;
    state.opsDocs.error = err?.message || 'Ошибка docs';
  }
  render();
}

async function loadOpsWorkspaces(file) {
  state.opsWorkspaces.loading = true;
  state.opsWorkspaces.error = null;
  render();
  try {
    const ws = state.opsWorkspaces.selectedWorkspace || 'steve';
    const params = new URLSearchParams({ workspace: ws });
    if (file) params.set('file', file);
    const response = await fetch(`/api/ops/workspaces?${params.toString()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить workspaces');
    const payload = await response.json();
    state.opsWorkspaces = {
      ...state.opsWorkspaces,
      loading: false,
      error: null,
      workspaces: Array.isArray(payload.workspaces) ? payload.workspaces : [],
      selectedWorkspace: payload.selectedWorkspace || ws,
      selectedFile: payload.selectedFile || null,
      content: payload.content || '',
    };
  } catch (err) {
    state.opsWorkspaces.loading = false;
    state.opsWorkspaces.error = err?.message || 'Ошибка workspaces';
  }
  render();
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
      ...state.automation,
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

async function loadSkillsDirectoryData(options = {}) {
  const silent = options.silent === true;
  if (!silent) {
    state.skillsDirectory.loading = true;
    state.skillsDirectory.error = null;
    render();
  }

  try {
    const response = await fetch('/api/brain/directory', { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить каталог skills/plugins');
    const payload = await response.json();

    state.skillsDirectory = {
      ...state.skillsDirectory,
      loading: false,
      error: null,
      items: Array.isArray(payload.items) ? payload.items : [],
    };
  } catch (err) {
    state.skillsDirectory.loading = false;
    state.skillsDirectory.error = err?.message || 'Ошибка загрузки каталога';
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
dockButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    const moduleId = btn.dataset.module;
    setModule(moduleId);
    if (moduleId === 'ops') setActiveTab('ops-dashboard');
  })
);

restoreUiState();
setModule(state.currentModule || 'ops');
refreshMissionControlData();

setInterval(() => {
  if (document.hidden) return;
  if (state.currentModule === 'ops') refreshMissionControlData();
}, 15000);

setInterval(() => {
  if (document.hidden) return;
  if (state.currentModule === 'lab') loadLabData({ silent: true });
  if (state.currentModule === 'brain' && state.activeTabByModule.brain === 'brain-automation') loadAutomationData({ silent: true });
  if (state.currentModule === 'brain' && state.activeTabByModule.brain === 'brain-dashboard') {
    loadAutomationData({ silent: true });
    loadSkillsDirectoryData({ silent: true });
  }
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
  if (state.currentModule === 'brain' && state.activeTabByModule.brain === 'brain-dashboard') {
    loadAutomationData({ silent: true });
    loadSkillsDirectoryData({ silent: true });
    loadDailySummaries();
  }
  refreshSessionViewerRealtime();
});



