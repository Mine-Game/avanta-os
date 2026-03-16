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
      { id: 'ops-mission-control', title: 'Ð¦ÐµÐ½Ñ‚Ñ€ ÑƒÐ¿Ñ€Ð°Ð²Ð»ÐµÐ½Ð¸Ñ' },
      { id: 'ops-pm-board', title: 'PM-Ð´Ð¾ÑÐºÐ°' },
      { id: 'ops-standups', title: 'Standups' },
      { id: 'ops-workspaces', title: 'Workspaces' },
      { id: 'ops-org-chart', title: 'ÐšÐ¾Ð¼Ð°Ð½Ð´Ð°' },
      { id: 'ops-docs', title: 'Docs' },
    ],
    brain: [
      { id: 'brain-daily-summaries', title: 'Ð•Ð¶ÐµÐ´Ð½ÐµÐ²Ð½Ñ‹Ðµ ÑÐ²Ð¾Ð´ÐºÐ¸' },
      { id: 'brain-skills-directory', title: 'Skills Directory' },
      { id: 'brain-automation', title: 'Automations' },
      { id: 'brain-config-inspector', title: 'Config Inspector' },
    ],
    lab: [
      { id: 'lab-dashboard', title: 'ÐžÐ±Ð·Ð¾Ñ€' },
      { id: 'lab-prototype-factory', title: 'Prototype Factory' },
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
  if (!value) return 'â€”';
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? 'â€”' : dt.toLocaleString();
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
  if (!response.ok) throw new Error('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð¸ÑÑ‚Ð¾Ñ€Ð¸ÑŽ ÑÐµÑÑÐ¸Ð¸');
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
    state.sessionViewer.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ¸';
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
    state.sessionViewer.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° realtime-Ð¾Ð±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ñ';
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
              title="ÐŸÐµÑ€ÐµÑ‚Ð°Ñ‰Ð¸Ñ‚Ðµ, Ñ‡Ñ‚Ð¾Ð±Ñ‹ Ð¸Ð·Ð¼ÐµÐ½Ð¸Ñ‚ÑŒ Ð¿Ð¾Ñ€ÑÐ´Ð¾Ðº"
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
      <div class="title-row">ÐžÐ¿ÐµÑ€Ð°Ñ†Ð¸Ð¾Ð½Ð½Ñ‹Ð¹ Ð¾Ð±Ð·Ð¾Ñ€</div>
      <div class="grid">
        <button class="card module-nav-card" data-open-tab="ops-mission-control"><h3>Ð¦ÐµÐ½Ñ‚Ñ€ ÑƒÐ¿Ñ€Ð°Ð²Ð»ÐµÐ½Ð¸Ñ</h3><p>ÐœÐ¾Ð´ÐµÐ»ÑŒ, ÑÐµÑÑÐ¸Ð¸, cron Ð¸ Ð±Ñ‹ÑÑ‚Ñ€Ñ‹Ð¹ health-check.</p></button>
        <button class="card module-nav-card" data-open-tab="ops-org-chart"><h3>ÐžÑ€Ð³Ð´Ð¸Ð°Ð³Ñ€Ð°Ð¼Ð¼Ð°</h3><p>Ð§ÐµÑ€Ð½Ð¾Ð²Ð¾Ð¹ ÐºÐ°Ñ€ÐºÐ°Ñ Ð¸ÐµÑ€Ð°Ñ€Ñ…Ð¸Ð¸ Ð°Ð³ÐµÐ½Ñ‚Ð¾Ð² Ð¸ Ð¿Ð¾Ð¼Ð¾Ñ‰Ð½Ð¸ÐºÐ¾Ð².</p></button>
        <div class="card"><h3>Ð˜Ð½Ñ†Ð¸Ð´ÐµÐ½Ñ‚Ñ‹</h3><p>Ð¡Ð±Ð¾Ð¸, Ð°Ð»ÐµÑ€Ñ‚Ñ‹ Ð¸ Ð´Ð¸Ð°Ð³Ð½Ð¾ÑÑ‚Ð¸ÐºÐ°.</p></div>
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
      <div class="title-row">ÐžÐ±Ð·Ð¾Ñ€ Brain</div>
      <div class="grid">
        <button class="card module-nav-card" data-open-tab="brain-daily-summaries"><h3>Ð•Ð¶ÐµÐ´Ð½ÐµÐ²Ð½Ñ‹Ðµ ÑÐ²Ð¾Ð´ÐºÐ¸</h3><p>ÐŸÑ€Ð¸Ð¾Ñ€Ð¸Ñ‚ÐµÑ‚Ñ‹ Ð´Ð½Ñ, Ñ€Ð¸ÑÐºÐ¸ Ð¸ ÑÐ»ÐµÐ´ÑƒÑŽÑ‰Ð¸Ðµ Ð´ÐµÐ¹ÑÑ‚Ð²Ð¸Ñ.</p></button>
        <button class="card module-nav-card" data-open-tab="brain-skills-directory"><h3>Skills Directory</h3><p>Ð•Ð´Ð¸Ð½Ñ‹Ð¹ ÐºÐ°Ñ‚Ð°Ð»Ð¾Ð³ skills Ð¸ plug-ins: Ð¸ÑÑ‚Ð¾Ñ‡Ð½Ð¸Ðº, ÑÑ‚Ð°Ñ‚ÑƒÑ Ð¸ Ð¾Ð¿Ð¸ÑÐ°Ð½Ð¸Ðµ.</p></button>
        <button class="card module-nav-card" data-open-tab="brain-automation"><h3>Automations</h3><p>Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð° Ð²ÑÐµÑ… cron-Ð·Ð°Ð´Ð°Ñ‡ Ñ Ñ€Ð°ÑÐºÑ€Ñ‹Ñ‚Ð¸ÐµÐ¼ Ð¿Ð¾Ð»Ð½Ð¾Ð¹ ÐºÐ¾Ð½Ñ„Ð¸Ð³ÑƒÑ€Ð°Ñ†Ð¸Ð¸.</p></button>
      </div>
    `;
  }

  if (moduleId === 'brain' && activeTab === 'brain-daily-summaries') return renderDailySummaries();
  if (moduleId === 'brain' && activeTab === 'brain-skills-directory') return renderSkillsDirectory();
  if (moduleId === 'brain' && activeTab === 'brain-automation') return renderAutomation();

  if (moduleId === 'lab' && activeTab === 'lab-dashboard') return renderLabDashboard();
  if (moduleId === 'lab' && activeTab === 'lab-prototype-factory') return renderPrototypeFactory();

  return '<div class="session-meta">ÐÐµÑ‚ Ð´Ð°Ð½Ð½Ñ‹Ñ….</div>';
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
        <p>Operations overview â€” click any card to dive deeper</p>
      </header>

      <div class="ops-metric-grid">
        <article class="ops-metric-card" data-open-tab="ops-mission-control">
          <small>MODEL</small>
          <strong>${escapeHtml(m.model || 'â€”')}</strong>
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
                (s) => `<button class="ops-session-row" data-open-session="${escapeHtml(s.sessionKey || '')}"><span>${escapeHtml(s.title || 'session')}</span><span>${escapeHtml(s.ago || 'â€”')}</span></button>`
              )
              .join('') || '<div class="session-meta">ÐÐµÑ‚ Ð°ÐºÑ‚Ð¸Ð²Ð½Ñ‹Ñ… ÑÐµÑÑÐ¸Ð¹</div>'}
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
        <button class="ops-shortcut" data-open-tab="ops-org-chart"><h4>ÐšÐ¾Ð¼Ð°Ð½Ð´Ð°</h4><p>Ð¡Ñ‚Ñ€ÑƒÐºÑ‚ÑƒÑ€Ð° Ð°Ð³ÐµÐ½Ñ‚Ð¾Ð² Ð¸ Ñ€Ð¾Ð»ÐµÐ¹</p></button>
        <button class="ops-shortcut" data-open-tab="ops-workspaces"><h4>Workspaces</h4><p>SOUL.md, IDENTITY.md, TOOLS.md Ð¸ Ð´Ñ€.</p></button>
        <button class="ops-shortcut" data-open-tab="ops-docs"><h4>Docs</h4><p>Ð¡Ð¸ÑÑ‚ÐµÐ¼Ð½Ð°Ñ Ð´Ð¾ÐºÑƒÐ¼ÐµÐ½Ñ‚Ð°Ñ†Ð¸Ñ Ñ Ð¿Ð¾Ð¸ÑÐºÐ¾Ð¼</p></button>
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
  if (!response.ok) throw new Error('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð¾Ð±Ð½Ð¾Ð²Ð¸Ñ‚ÑŒ ÐºÐ°Ñ€Ñ‚Ð¾Ñ‡ÐºÑƒ');
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
  }[String(t.stage || '').toLowerCase()] || String(t.stage || 'â€”');

  const dueMs = t.dueAt ? new Date(t.dueAt).getTime() : NaN;
  const leftDays = Number.isFinite(dueMs) ? Math.ceil((dueMs - Date.now()) / 86400000) : null;
  const dueHint = leftDays === null ? 'â€”' : leftDays >= 0 ? `${leftDays}d left` : `${Math.abs(leftDays)}d overdue`;

  const history = [
    { stage: stageLabel, at: t.updatedAt || t.dueAt || new Date().toISOString() },
    ...(blockers.length ? [{ stage: 'blocked', at: t.updatedAt || new Date().toISOString() }] : []),
  ];

  return `
    <div class="pm-modal-backdrop" id="pmTaskModalBackdrop">
      <div class="pm-modal pm-modal-luxe" role="dialog" aria-modal="true">
        <button class="session-modal-close" id="pmTaskModalClose" title="Ð—Ð°ÐºÑ€Ñ‹Ñ‚ÑŒ">âœ•</button>

        <div class="pm-modal-title-wrap">
          <h3>${escapeHtml(t.title || 'Task')}</h3>
          <div class="pm-modal-client">${escapeHtml(t.clientName || 'â€”')}</div>
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
          <div><small>ASSIGNEE</small><strong>ðŸ‘¤ ${escapeHtml(t.assignee || 'ÐÐ½Ð´Ñ€ÐµÐ¹')}</strong></div>
          <div><small>DUE DATE</small><strong>${escapeHtml(formatTime(t.dueAt))} <span class="pm-subtle">(${escapeHtml(dueHint)})</span></strong></div>
          <div><small>STAGE</small><strong>${escapeHtml(stageLabel)}</strong></div>
        </div>

        <div class="pm-modal-section">
          <small>TAGS</small>
          <div class="pm-tags-wrap">
            ${Array.isArray(t.tags) && t.tags.length
              ? t.tags
                  .map(
                    (x) => `<span class="pm-chip">#${escapeHtml(x)} <button class="pm-chip-x" data-pm-tag-remove="${escapeHtml(x)}" title="Ð£Ð´Ð°Ð»Ð¸Ñ‚ÑŒ Ñ‚ÐµÐ³">Ã—</button></span>`
                  )
                  .join('')
              : '<span class="session-meta">No tags</span>'}
          </div>
          <div class="pm-tag-input-row">
            <input class="search-input" data-pm-tag-input placeholder="Ð”Ð¾Ð±Ð°Ð²Ð¸Ñ‚ÑŒ Ñ‚ÐµÐ³ (Ð½Ð°Ð¿Ñ€Ð¸Ð¼ÐµÑ€ urgent)" />
            <button class="ghost-btn" data-pm-tag-add>Ð”Ð¾Ð±Ð°Ð²Ð¸Ñ‚ÑŒ</button>
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
          <span>Assignee <b>ÐÐ½Ð´Ñ€ÐµÐ¹</b></span>
        </div>
      </header>

      ${b.loading ? '<div class="session-meta">Ð—Ð°Ð³Ñ€ÑƒÐ·ÐºÐ°â€¦</div>' : ''}
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
                          const due = t.dueAt ? formatTime(t.dueAt) : 'â€”';
                          return `
                            <article class="pm-luxe-task" draggable="true" data-pm-task-id="${t.id}" data-pm-stage="${stage}" data-open-pm-task="${t.id}">
                              <div class="pm-task-top">
                                <strong>${escapeHtml(t.title)}</strong>
                                <span class="pm-priority pr-${pr}">${escapeHtml(priorityLabels[pr] || pr)}</span>
                              </div>
                              <div class="pm-task-client">${escapeHtml(t.clientName || 'â€”')}</div>
                              ${isBlocked ? `<div class="pm-task-alert">âš  ${escapeHtml((t.blockers || [])[0]?.reason || 'Blocked')}</div>` : ''}
                              <div class="pm-task-meta">
                                <span>ðŸ‘¤ ${escapeHtml(t.assignee || 'ÐÐ½Ð´Ñ€ÐµÐ¹')}</span>
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
        <button class="session-modal-close" id="standupModalClose" title="Ð—Ð°ÐºÑ€Ñ‹Ñ‚ÑŒ">âœ•</button>

        <div class="pm-modal-title-wrap">
          <h3>ðŸ‘¥ ${escapeHtml(s.title || 'Ð¡Ñ‚ÐµÐ½Ð´Ð°Ð¿')}</h3>
          <div class="pm-modal-client">${escapeHtml(s.day || '')} Â· ${escapeHtml(s.time || '')} Â· ${escapeHtml(s.duration || '15 Ð¼Ð¸Ð½')} <span class="standups-pill" style="margin-left:6px;">Ð•Ð–Ð•Ð”ÐÐ•Ð’ÐÐž</span></div>
        </div>

        <div class="pm-modal-section">
          <small>Ð£Ð§ÐÐ¡Ð¢ÐÐ˜ÐšÐ˜</small>
          <div class="pm-tags-wrap">
            ${participants.map((p) => `<span class="pm-chip">${escapeHtml(p)}</span>`).join('') || '<span class="session-meta">ÐÐµÑ‚ ÑƒÑ‡Ð°ÑÑ‚Ð½Ð¸ÐºÐ¾Ð²</span>'}
          </div>
        </div>

        <div class="pm-modal-section">
          <small>ÐžÐ‘Ð¡Ð£Ð–Ð”ÐÐÐÐ«Ð• Ð¢Ð•ÐœÐ«</small>
          <div class="standup-topic-list">
            ${topics
              .map(
                (t) => `<div class="standup-topic-row ${t.status === 'done' ? 'done' : 'progress'}">
                  <span>â€¢ ${escapeHtml(t.text || 'â€”')}</span>
                  <b>${t.status === 'done' ? 'Ð³Ð¾Ñ‚Ð¾Ð²Ð¾' : 'Ð² Ñ€Ð°Ð±Ð¾Ñ‚Ðµ'}</b>
                </div>`
              )
              .join('')}
          </div>
        </div>

        <div class="pm-modal-section">
          <small>Ð¡Ð’ÐžÐ”ÐšÐ</small>
          <div class="pm-note-box">${escapeHtml(s.summary || 'Ð‘ÐµÐ· Ð±Ð»Ð¾ÐºÐµÑ€Ð¾Ð². Ð Ð°Ð±Ð¾Ñ‚Ð° Ð¿Ð¾ Ð¿Ð»Ð°Ð½Ñƒ.')}</div>
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

  const weekDayNames = ['ÐŸÐ', 'Ð’Ð¢', 'Ð¡Ð ', 'Ð§Ð¢', 'ÐŸÐ¢', 'Ð¡Ð‘', 'Ð’Ð¡'];
  const monthNames = ['ÑÐ½Ð²Ð°Ñ€ÑŒ', 'Ñ„ÐµÐ²Ñ€Ð°Ð»ÑŒ', 'Ð¼Ð°Ñ€Ñ‚', 'Ð°Ð¿Ñ€ÐµÐ»ÑŒ', 'Ð¼Ð°Ð¹', 'Ð¸ÑŽÐ½ÑŒ', 'Ð¸ÑŽÐ»ÑŒ', 'Ð°Ð²Ð³ÑƒÑÑ‚', 'ÑÐµÐ½Ñ‚ÑÐ±Ñ€ÑŒ', 'Ð¾ÐºÑ‚ÑÐ±Ñ€ÑŒ', 'Ð½Ð¾ÑÐ±Ñ€ÑŒ', 'Ð´ÐµÐºÐ°Ð±Ñ€ÑŒ'];

  const buildStandupPayload = (dateObj, dueTasks = []) => ({
    title: dueTasks.length ? `Ð¡Ñ‚ÐµÐ½Ð´Ð°Ð¿ Ð¿Ð¾ Ð·Ð°Ð´Ð°Ñ‡Ð°Ð¼ Ð´Ð½Ñ (${dueTasks.length})` : 'ÐžÐ¿ÐµÑ€Ð°Ñ†Ð¸Ð¾Ð½Ð½Ñ‹Ð¹ ÑÐ¸Ð½Ðº',
    day: dateObj.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }),
    time: '09:00',
    duration: '15 Ð¼Ð¸Ð½',
    lead: 'Ð¡Ñ‚Ð¸Ð²',
    participants: ['ÐÐ½Ð´Ñ€ÐµÐ¹', 'Ð¡Ñ‚Ð¸Ð²'],
    topics: [
      { text: `ÐžÐ±Ð·Ð¾Ñ€ Ð·Ð°Ð´Ð°Ñ‡ Ð½Ð° Ð´ÐµÐ½ÑŒ (${dueTasks.length})`, status: dueTasks.length ? 'progress' : 'done' },
      { text: 'ÐŸÑ€Ð¾Ð²ÐµÑ€ÐºÐ° SLA Ð¸ Ð±Ð»Ð¾ÐºÐµÑ€Ð¾Ð²', status: blocked ? 'progress' : 'done' },
      { text: 'Ð¤Ð¸ÐºÑÐ°Ñ†Ð¸Ñ Ñ€ÐµÑˆÐµÐ½Ð¸Ð¹ Ð¸ next steps', status: 'done' },
    ],
    summary: `Ð—Ð°Ð´Ð°Ñ‡: ${tasks.length}, Ð±Ð»Ð¾ÐºÐµÑ€Ñ‹: ${blocked}, Ð¿Ñ€Ð¾ÑÑ€Ð¾Ñ‡ÐµÐ½Ð¾: ${overdue}.`,
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

  const weekRange = `${weekDays[0].date} ${monthNames[new Date(weekDays[0].iso).getMonth()]} â€” ${weekDays[6].date} ${monthNames[new Date(weekDays[6].iso).getMonth()]}`;

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
        <div class="standups-v2-title">ðŸ‘¥ Ð¡Ñ‚ÐµÐ½Ð´Ð°Ð¿Ñ‹</div>
        <div class="standups-v2-controls">
          <button class="standups-toggle ${view === 'week' ? 'active' : ''}" data-standups-view="week">ÐÐµÐ´ÐµÐ»Ñ</button>
          <button class="standups-toggle ${view === 'month' ? 'active' : ''}" data-standups-view="month">ÐœÐµÑÑÑ†</button>
          <button class="standups-nav-btn" data-standups-nav="prev">â€¹</button>
          <span class="standups-range">${escapeHtml(view === 'week' ? weekRange : monthLabel)}</span>
          <button class="standups-nav-btn" data-standups-nav="next">â€º</button>
        </div>
      </header>

      <div class="standups-v2-kpi">
        <span>Ð—Ð°Ð´Ð°Ñ‡Ð¸ PM <b>${tasks.length}</b></span>
        <span>Ð—Ð°Ð±Ð»Ð¾ÐºÐ¸Ñ€Ð¾Ð²Ð°Ð½Ð¾ <b>${blocked}</b></span>
        <span>ÐŸÑ€Ð¾ÑÑ€Ð¾Ñ‡ÐµÐ½Ð¾ <b>${overdue}</b></span>
        <span>Ð˜ÑÑ‚Ð¾Ñ‡Ð½Ð¸Ðº <b>PM-Ð´Ð¾ÑÐºÐ°</b></span>
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
                              <div class="standups-event-tag">Ð•Ð–Ð•Ð”ÐÐ•Ð’ÐÐž</div>
                              <h4>${escapeHtml(it.title)}</h4>
                              <p>ðŸ•˜ ${escapeHtml(it.time)} Â· ${escapeHtml(it.lead)}</p>
                            </button>`
                          )
                          .join('')
                      : '<div class="standups-empty-slot">â€”</div>'}
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
            .join('') || '<div class="session-meta">ÐÐµÑ‚ Ñ„Ð°Ð¹Ð»Ð¾Ð²</div>'}
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
            .join('') || '<div class="session-meta">ÐÐµÑ‚ Ñ„Ð°Ð¹Ð»Ð¾Ð²</div>'}
        </div>
      </aside>
      <article class="split-preview markdown-preview pleasant-markdown">${highlightMarkdownByQuery(w.content, w.query)}</article>
    </section>
  `;
}

function renderDailySummaries() {
  const d = state.dailySummaries;
  return `
    <h2 class="section-title">Ð•Ð¶ÐµÐ´Ð½ÐµÐ²Ð½Ñ‹Ðµ ÑÐ²Ð¾Ð´ÐºÐ¸</h2>
    <section class="daily-layout panel">
      <aside class="daily-sidebar">
        <div class="daily-sidebar-title">Ð˜ÑÑ‚Ð¾Ñ€Ð¸Ñ</div>
        <div class="daily-list">
          ${d.items.length === 0
            ? '<div class="session-meta">ÐŸÐ¾ÐºÐ° Ð½ÐµÑ‚ ÑÐ²Ð¾Ð´Ð¾Ðº</div>'
            : d.items.map((it) => `<button class="daily-item ${it.file === d.selectedFile ? 'active' : ''}" data-daily-file="${it.file}">${it.title}</button>`).join('')}
        </div>
      </aside>
      <article class="daily-viewer">
        <div class="daily-viewer-head">
          <strong>${d.selectedFile ? d.selectedFile.replace(/\.md$/i, '') : 'ÐŸÐ¾ÑÐ»ÐµÐ´Ð½ÑÑ ÑÐ²Ð¾Ð´ÐºÐ°'}</strong>
          ${d.loading ? '<span class="session-meta">Ð—Ð°Ð³Ñ€ÑƒÐ·ÐºÐ°â€¦</span>' : ''}
        </div>
        ${d.error ? `<div class="session-meta" style="color:#ff9cb3;">${escapeHtml(d.error)}</div>` : ''}
        <div class="daily-markdown">${d.content ? markdownToHtml(d.content) : '<p class="session-meta">ÐÐµÑ‚ Ð´Ð°Ð½Ð½Ñ‹Ñ….</p>'}</div>
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

      ${d.loading ? '<div class="session-meta">Ð—Ð°Ð³Ñ€ÑƒÐ·ÐºÐ° ÐºÐ°Ñ‚Ð°Ð»Ð¾Ð³Ð°â€¦</div>' : ''}
      ${d.error ? `<div class="session-meta" style="color:#ff9cb3;">${escapeHtml(d.error)}</div>` : ''}

      <div class="skills-grid">
        ${filtered.length === 0
          ? '<div class="session-meta">ÐÐ¸Ñ‡ÐµÐ³Ð¾ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾ Ð¿Ð¾ Ñ‚ÐµÐºÑƒÑ‰ÐµÐ¼Ñƒ Ñ„Ð¸Ð»ÑŒÑ‚Ñ€Ñƒ.</div>'
          : filtered
              .map(
                (x) => `<article class="skill-card">
                    <div class="skill-card-head">
                      <div class="skill-icon">â—ˆ</div>
                      <div>
                        <h4>${escapeHtml(x.name || x.id || 'â€”')}</h4>
                        <small>${escapeHtml((x.id || '').replace(/^.*:/, ''))}</small>
                      </div>
                    </div>
                    <p>${escapeHtml(x.description || 'No description')}</p>
                    <div class="skill-tags">
                      <span class="skill-tag kind-${escapeHtml((x.kind || 'unknown').toLowerCase())}">${escapeHtml(x.kindLabel || x.kind || 'â€”')}</span>
                      <span class="skill-tag source-${escapeHtml((x.origin || 'unknown').toLowerCase().replace(/[^a-z-]/g, '-'))}">${escapeHtml(x.origin || 'â€”')}</span>
                      <span class="skill-tag status">${escapeHtml(x.statusLabel || x.status || 'â€”')}</span>
                      ${x.kind === 'plugin' ? `<span class="skill-tag ${x.enabled ? 'plugin-enabled' : 'plugin-disabled'}">${x.enabled ? 'enabled' : 'disabled'}</span>` : ''}
                      ${x.kind === 'plugin' ? `<span class="skill-tag utilization ${x.utilization?.inAutomations ? 'in-use' : ''}">${escapeHtml(x.utilization?.summary || 'â€”')}</span>` : ''}
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

  if (!raw || raw === 'â€”' || raw === '-' || raw === 'default') {
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
      throw new Error(payload?.error || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ ÑÐ¾Ñ…Ñ€Ð°Ð½Ð¸Ñ‚ÑŒ cron-Ð·Ð°Ð´Ð°Ñ‡Ñƒ');
    }

    await loadAutomationData({ silent: true });
    closeAutomationEditModal();
  } catch (err) {
    state.automation.editModal.saving = false;
    state.automation.editModal.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° ÑÐ¾Ñ…Ñ€Ð°Ð½ÐµÐ½Ð¸Ñ';
    render();
  }
}

function renderAutomationEditModal() {
  const m = state.automation.editModal;
  if (!m?.open || !m.form) return '';

  return `
    <div class="session-modal-backdrop" id="automationEditBackdrop">
      <div class="session-modal" style="max-width:900px;" role="dialog" aria-modal="true">
        <button class="session-modal-close" id="automationEditClose" title="Ð—Ð°ÐºÑ€Ñ‹Ñ‚ÑŒ">âœ•</button>
        <div class="session-modal-header">
          <h3>Ð ÐµÐ´Ð°ÐºÑ‚Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ cron-Ð·Ð°Ð´Ð°Ñ‡Ð¸</h3>
        </div>

        <div class="automation-edit-grid">
          <label><small>ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ</small><input class="search-input" data-auto-edit="name" value="${escapeHtml(m.form.name || '')}"/></label>
          <label><small>Timezone</small><input class="search-input" data-auto-edit="scheduleTz" value="${escapeHtml(m.form.scheduleTz || 'Asia/Vladivostok')}"/></label>
          <label style="grid-column:1 / -1;"><small>ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ</small><input class="search-input" data-auto-edit="description" value="${escapeHtml(m.form.description || '')}"/></label>
          <label style="grid-column:1 / -1;"><small>Cron expression</small><input class="search-input" data-auto-edit="scheduleExpr" value="${escapeHtml(m.form.scheduleExpr || '')}" placeholder="0 8 * * *"/></label>
          <label style="grid-column:1 / -1;"><small>Ð˜Ð½ÑÑ‚Ñ€ÑƒÐºÑ†Ð¸Ð¸ (message)</small><textarea class="search-input" data-auto-edit="message" style="min-height:180px;resize:vertical;">${escapeHtml(m.form.message || '')}</textarea></label>
          <label class="automation-enabled-toggle"><input type="checkbox" data-auto-edit="enabled" ${m.form.enabled ? 'checked' : ''}/> <span>Enabled</span></label>
        </div>

        ${m.error ? `<div class="session-meta" style="color:#ff9cb3;margin-top:10px;">${escapeHtml(m.error)}</div>` : ''}

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px;">
          <button class="ghost-btn" id="automationEditCancel">ÐžÑ‚Ð¼ÐµÐ½Ð°</button>
          <button class="ghost-btn" id="automationEditSave">${m.saving ? 'Ð¡Ð¾Ñ…Ñ€Ð°Ð½ÐµÐ½Ð¸Ðµâ€¦' : 'Ð¡Ð¾Ñ…Ñ€Ð°Ð½Ð¸Ñ‚ÑŒ'}</button>
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
      ${a.loading ? '<div class="session-meta" style="margin-bottom:10px;">Ð—Ð°Ð³Ñ€ÑƒÐ·ÐºÐ° Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð¸Ð·Ð°Ñ†Ð¸Ð¹â€¦</div>' : ''}
      ${a.error ? `<div class="session-meta" style="color:#ff9cb3;margin-bottom:10px;">${escapeHtml(a.error)}</div>` : ''}

      <table class="mc-table automation-table">
        <thead>
          <tr>
            <th style="width:60px;">#</th>
            <th>ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ</th>
            <th>Ð Ð°ÑÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ</th>
            <th>Ð¡Ñ‚Ð°Ñ‚ÑƒÑ</th>
            <th>ÐœÐ¾Ð´ÐµÐ»ÑŒ</th>
            <th>Ð¡Ð»ÐµÐ´ÑƒÑŽÑ‰Ð¸Ð¹ Ð·Ð°Ð¿ÑƒÑÐº</th>
          </tr>
        </thead>
        <tbody>
          ${jobs.length === 0
            ? '<tr><td colspan="6" class="session-meta">ÐÐµÑ‚ cron-Ð·Ð°Ð´Ð°Ñ‡ Ð¿Ð¾Ð´ Ð²Ñ‹Ð±Ñ€Ð°Ð½Ð½Ñ‹Ð¹ Ñ„Ð¸Ð»ÑŒÑ‚Ñ€</td></tr>'
            : jobs
                .map((job) => {
                  const isOpen = expandedSet.has(job.id);
                  const modelPill = getModelPill(job.model);
                  return `
                    <tr class="automation-row-main ${isOpen ? 'open' : ''}">
                      <td><button class="ghost-btn automation-expand-btn" data-automation-toggle-id="${escapeHtml(job.id || '')}">${isOpen ? 'âˆ’' : '+'}</button></td>
                      <td>${escapeHtml(job.name || 'cron')}</td>
                      <td>${escapeHtml(job.schedule || 'â€”')}</td>
                      <td>${escapeHtml(job.status || 'â€”')}</td>
                      <td><span class="model-pill model-pill-${escapeHtml(modelPill.tone)}">${escapeHtml(modelPill.label || 'â€”')}</span></td>
                      <td>${escapeHtml(job.nextRun || 'â€”')}</td>
                    </tr>
                    <tr class="automation-row-details ${isOpen ? 'open' : ''}">
                      <td colspan="6">
                        <div class="automation-details-grid">
                          <div><small>ID</small><strong>${escapeHtml(job.id || 'â€”')}</strong></div>
                          <div><small>ÐŸÐ¾ÑÐ»ÐµÐ´Ð½Ð¸Ð¹ Ð·Ð°Ð¿ÑƒÑÐº</small><strong>${escapeHtml(job.lastRun || 'â€”')}</strong></div>
                          <div><small>Ð¡ÐµÑÑÐ¸Ñ</small><strong>${escapeHtml(job.sessionTarget || 'â€”')}</strong></div>
                          <div><small>Payload</small><strong>${escapeHtml(job.payloadKind || 'â€”')}</strong></div>
                          <div><small>Wake mode</small><strong>${escapeHtml(job.wakeMode || 'â€”')}</strong></div>
                          <div><small>Delivery</small><strong>${escapeHtml([job.deliveryMode, job.deliveryChannel].filter(Boolean).join(' / ') || 'â€”')}</strong></div>
                          <div><small>ÐžÑˆÐ¸Ð±ÐºÐ¸ Ð¿Ð¾Ð´Ñ€ÑÐ´</small><strong>${escapeHtml(String(job.consecutiveErrors ?? 0))}</strong></div>
                          <div><small>Enabled</small><strong>${job.enabled ? 'yes' : 'no'}</strong></div>
                        </div>
                        <div class="automation-instruction-block">
                          <h4>Ð˜Ð½ÑÑ‚Ñ€ÑƒÐºÑ†Ð¸Ð¸ cron-Ð·Ð°Ð´Ð°Ñ‡Ð¸</h4>
                          <pre class="history-text" style="font-size:13px;white-space:pre-wrap;">${escapeHtml(job.message || 'â€”')}</pre>
                          <div style="margin-top:10px;display:flex;justify-content:flex-end;">
                            <button class="ghost-btn" data-automation-edit-id="${escapeHtml(job.id || '')}">Ð ÐµÐ´Ð°ÐºÑ‚Ð¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒ</button>
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
        <button class="session-modal-close" id="sessionModalClose" title="Ð—Ð°ÐºÑ€Ñ‹Ñ‚ÑŒ">âœ•</button>
        <div class="session-modal-header">
          <h3>${s.sessionKey || 'session'}</h3>
          <span class="badge success"><span class="dot green"></span>active</span>
        </div>

        <div class="session-head-grid">
          <div><small>ÐšÐ»ÑŽÑ‡ ÑÐµÑÑÐ¸Ð¸</small><strong>${s.sessionKey || 'â€”'}</strong></div>
          <div><small>ÐœÐ¾Ð´ÐµÐ»ÑŒ</small><strong>${s.model || 'â€”'}</strong></div>
          <div><small>ÐšÐ°Ð½Ð°Ð»</small><strong>${s.channel || 'â€”'}</strong></div>
          <div><small>Ð¢Ð¾ÐºÐµÐ½Ñ‹</small><strong>${s.tokens?.total ?? 0}</strong></div>
        </div>
        <div class="session-meta" style="margin-top:10px;">ÐžÐ±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¾: ${formatTime(s.updatedAt)}</div>

        <div class="session-history-title"><span>Ð˜ÑÑ‚Ð¾Ñ€Ð¸Ñ ÑÐµÑÑÐ¸Ð¸</span></div>
        <div class="session-history-body">
          ${v.loading
            ? '<div class="session-meta">Ð—Ð°Ð³Ñ€ÑƒÐ·ÐºÐ° Ð¸ÑÑ‚Ð¾Ñ€Ð¸Ð¸â€¦</div>'
            : v.error
              ? `<div class="session-meta" style="color:#ff9cb3;">${escapeHtml(v.error)}</div>`
              : v.history.length === 0
                ? '<div class="session-meta">Ð˜ÑÑ‚Ð¾Ñ€Ð¸Ñ Ð¿Ð¾ÐºÐ° Ð¿ÑƒÑÑ‚Ð°Ñ.</div>'
                : v.history
                    .map(
                      (m) => `
                    <article class="history-item role-${(m.role || 'unknown').toLowerCase()}">
                      <div class="history-top">
                        <span class="history-role">${escapeHtml(m.role || 'unknown')}</span>
                        <span class="session-meta">${formatTime(m.timestamp)}</span>
                      </div>
                      <pre class="history-text">${escapeHtml(m.text || 'â€”')}</pre>
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
    ? '<span class="badge success"><span class="dot green"></span>live-Ð¸ÑÑ‚Ð¾Ñ‡Ð½Ð¸Ðº</span>'
    : m.stale
      ? '<span class="badge idle"><span class="dot yellow"></span>ÑƒÑÑ‚Ð°Ñ€ÐµÐ²ÑˆÐ¸Ðµ Ð´Ð°Ð½Ð½Ñ‹Ðµ</span>'
      : '<span class="badge failed"><span class="dot red"></span>Ð¸ÑÑ‚Ð¾Ñ‡Ð½Ð¸Ðº Ð½Ðµ Ð¿Ð¾Ð´ÐºÐ»ÑŽÑ‡Ñ‘Ð½</span>';

  return `
    <h2 class="section-title">Ð¦ÐµÐ½Ñ‚Ñ€ ÑƒÐ¿Ñ€Ð°Ð²Ð»ÐµÐ½Ð¸Ñ</h2>

    <section class="panel">
      <h3 style="margin:0 0 12px; display:flex; justify-content:space-between; align-items:center;">
        <span>ÐŸÑ€Ð¾Ñ„Ð¸Ð»ÑŒ Ð¼Ð¾Ð´ÐµÐ»Ð¸</span>
        ${connectedBadge}
      </h3>
      <div class="info-grid">
        <div class="info-cell"><small>ÐœÐ¾Ð´ÐµÐ»ÑŒ</small><strong>${escapeHtml(m.model || 'â€”')}</strong></div>
        <div class="info-cell"><small>ÐŸÑ€Ð¾Ð²Ð°Ð¹Ð´ÐµÑ€</small><strong>${escapeHtml(m.provider || 'â€”')}</strong></div>
        <div class="info-cell"><small>Ð¡Ñ‚Ð°Ñ‚ÑƒÑ</small><strong>${escapeHtml(m.status || 'â€”')}</strong></div>
        <div class="info-cell"><small>ÐšÐ¾Ð½Ñ‚ÐµÐºÑÑ‚</small><strong>${escapeHtml(m.context || 'â€”')}</strong></div>
      </div>
      <div class="session-meta" style="margin-top:10px;">ÐŸÐ¾ÑÐ»ÐµÐ´Ð½ÑÑ ÑÐ¸Ð½Ñ…Ñ€Ð¾Ð½Ð¸Ð·Ð°Ñ†Ð¸Ñ: ${escapeHtml(m.lastSyncAt || 'Ð½ÐµÑ‚ Ð´Ð°Ð½Ð½Ñ‹Ñ…')}</div>
      ${m.error ? `<div class="session-meta" style="margin-top:6px;color:#ff9cb3;">API: ${escapeHtml(m.error)}</div>` : ''}
    </section>

    <h3 style="margin:14px 0 10px;">ÐÐºÑ‚Ð¸Ð²Ð½Ñ‹Ðµ ÑÐµÑÑÐ¸Ð¸ (${m.sessions.length})</h3>
    <section class="session-grid">
      ${m.sessions.length === 0
        ? '<article class="session-card"><div class="session-meta">ÐÐµÑ‚ Ð´Ð°Ð½Ð½Ñ‹Ñ….</div></article>'
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

    <h3 style="margin:14px 0 10px;">Ð¡Ð¾ÑÑ‚Ð¾ÑÐ½Ð¸Ðµ cron (${m.crons.length})</h3>
    <section class="panel table-wrap">
      <table class="mc-table">
        <thead>
          <tr>
            <th>ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ</th>
            <th>Ð Ð°ÑÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ</th>
            <th>ÐŸÐ¾ÑÐ»ÐµÐ´Ð½Ð¸Ð¹ Ð·Ð°Ð¿ÑƒÑÐº</th>
            <th>Ð¡Ñ‚Ð°Ñ‚ÑƒÑ</th>
            <th>Ð¡Ð»ÐµÐ´ÑƒÑŽÑ‰Ð¸Ð¹ Ð·Ð°Ð¿ÑƒÑÐº</th>
          </tr>
        </thead>
        <tbody>
          ${m.crons.length === 0
            ? '<tr><td colspan="5" class="session-meta">ÐÐµÑ‚ live-Ð´Ð°Ð½Ð½Ñ‹Ñ… cron.</td></tr>'
            : m.crons
                .map((c) => {
                  const failed = c.status === 'failed';
                  return `
                    <tr class="${failed ? 'row-failed' : ''}">
                      <td>
                        <strong>${escapeHtml(c.name || 'cron')}</strong>
                        ${c.error ? `<div class="session-meta" style="margin-top:4px;">${escapeHtml(c.error)}</div>` : ''}
                        ${c.id ? `<div style="margin-top:6px;"><button class="ghost-btn" data-open-automation-id="${c.id}">ÐžÑ‚ÐºÑ€Ñ‹Ñ‚ÑŒ Ð² Brain â†’ ÐÐ²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð¸Ð·Ð°Ñ†Ð¸Ñ</button></div>` : ''}
                      </td>
                      <td>${escapeHtml(c.schedule || 'â€”')}</td>
                      <td>${escapeHtml(c.lastRun || 'â€”')}</td>
                      <td>
                        <span class="badge ${failed ? 'failed' : 'success'}">
                          <span class="dot ${failed ? 'red' : 'green'}"></span>${escapeHtml(c.status || 'unknown')}
                        </span>
                      </td>
                      <td>${escapeHtml(c.nextRun || 'â€”')}</td>
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
      title: 'ÐÐ³ÐµÐ½Ñ‚ Ñ€Ð¾ÑÑ‚Ð°',
      mission: 'ÐŸÑ€Ð¸Ð²Ð»ÐµÑ‡ÐµÐ½Ð¸Ðµ Ð¸ Ð°ÐºÑ‚Ð¸Ð²Ð°Ñ†Ð¸Ñ Ð¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÐµÐ»ÐµÐ¹ 10â†’100â†’1000',
      assistants: ['ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ ÐºÐ¾Ð½Ñ‚ÐµÐ½Ñ‚Ð°', 'ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ Ð³Ð¸Ð¿Ð¾Ñ‚ÐµÐ·', 'ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ Ð°Ð½Ð°Ð»Ð¸Ñ‚Ð¸ÐºÐ¸'],
    },
    {
      title: 'ÐÐ³ÐµÐ½Ñ‚ Ð¿Ñ€Ð¾Ð´ÑƒÐºÑ‚Ð°',
      mission: 'ÐŸÑ€Ð¸Ð¾Ñ€Ð¸Ñ‚ÐµÐ·Ð°Ñ†Ð¸Ñ Ñ„Ð¸Ñ‡, UX Ð¸ Ñ†ÐµÐ½Ð½Ð¾ÑÑ‚ÑŒ Ð´Ð»Ñ ÐºÐ»Ð¸ÐµÐ½Ñ‚Ð¾Ð²',
      assistants: ['ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ UX', 'ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ Ð±ÑÐºÐ»Ð¾Ð³Ð°', 'ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ customer-feedback'],
    },
    {
      title: 'ÐÐ³ÐµÐ½Ñ‚ Ð¾Ð¿ÐµÑ€Ð°Ñ†Ð¸Ð¹',
      mission: 'SOP, ÐºÐ¾Ð½Ñ‚Ñ€Ð¾Ð»ÑŒ Ð¸ÑÐ¿Ð¾Ð»Ð½ÐµÐ½Ð¸Ñ Ð¸ ÑÑ‚Ð°Ð±Ð¸Ð»ÑŒÐ½Ð¾ÑÑ‚ÑŒ Ð¿Ñ€Ð¾Ñ†ÐµÑÑÐ¾Ð²',
      assistants: ['ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ cron/Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð¸Ð·Ð°Ñ†Ð¸Ð¹', 'ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ ÐºÐ¾Ð½Ñ‚Ñ€Ð¾Ð»Ñ Ð·Ð°Ð´Ð°Ñ‡', 'ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ Ð¾Ñ‚Ñ‡Ñ‘Ñ‚Ð½Ð¾ÑÑ‚Ð¸'],
    },
    {
      title: 'ÐÐ³ÐµÐ½Ñ‚ Ð»Ð°Ð±Ð¾Ñ€Ð°Ñ‚Ð¾Ñ€Ð¸Ð¸',
      mission: 'Ð­ÐºÑÐ¿ÐµÑ€Ð¸Ð¼ÐµÐ½Ñ‚Ñ‹, staged-Ð¿Ñ€Ð¾Ñ‚Ð¾Ñ‚Ð¸Ð¿Ñ‹ Ð¸ Ð±ÐµÐ·Ð¾Ð¿Ð°ÑÐ½Ð¾Ðµ Ñ‚ÐµÑÑ‚Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ',
      assistants: ['ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ ÑÐºÑÐ¿ÐµÑ€Ð¸Ð¼ÐµÐ½Ñ‚Ð¾Ð²', 'ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ ÐºÐ°Ñ‡ÐµÑÑ‚Ð²Ð°', 'ÐÑÑÐ¸ÑÑ‚ÐµÐ½Ñ‚ Ð´ÐµÐ¿Ð»Ð¾Ð¹-Ð³ÐµÐ¹Ñ‚Ð¾Ð²'],
    },
  ];

  return `
    <h2 class="section-title">ÐžÑ€Ð³Ð´Ð¸Ð°Ð³Ñ€Ð°Ð¼Ð¼Ð° (Ñ‡ÐµÑ€Ð½Ð¾Ð²Ð¸Ðº v0)</h2>
    <section class="panel" style="margin-bottom:14px;">
      <div class="info-grid">
        <div class="info-cell"><small>Ð£Ñ€Ð¾Ð²ÐµÐ½ÑŒ 1</small><strong>ÐÐ½Ð´Ñ€ÐµÐ¹ (Ñ‡ÐµÐ»Ð¾Ð²ÐµÐº / Ð²Ð»Ð°Ð´ÐµÐ»ÐµÑ†)</strong></div>
        <div class="info-cell"><small>Ð£Ñ€Ð¾Ð²ÐµÐ½ÑŒ 2</small><strong>Ð¡Ñ‚Ð¸Ð² (Ð¾Ð¿ÐµÑ€Ð°Ñ†Ð¸Ð¾Ð½Ð½Ñ‹Ð¹ Ð¿Ð°Ñ€Ñ‚Ð½Ñ‘Ñ€ / Chief of Execution)</strong></div>
        <div class="info-cell"><small>Ð¡Ñ‚Ð°Ñ‚ÑƒÑ</small><strong>ÐšÐ°Ñ€ÐºÐ°Ñ, Ð±ÐµÐ· wiring</strong></div>
        <div class="info-cell"><small>Ð¦ÐµÐ»ÑŒ</small><strong>ÐžÐ¿Ñ€ÐµÐ´ÐµÐ»Ð¸Ñ‚ÑŒ ÑÐ¾ÑÑ‚Ð°Ð² ÑÑƒÐ±Ð°Ð³ÐµÐ½Ñ‚Ð¾Ð² Ðº ÑÐ¿Ð¸Ð·Ð¾Ð´Ñƒ 3</strong></div>
      </div>
    </section>

    <section class="panel">
      <h3 style="margin:0 0 10px;">Ð£Ñ€Ð¾Ð²ÐµÐ½ÑŒ 3 â€” Ð¿Ð¾Ð´Ñ‡Ð¸Ð½Ñ‘Ð½Ð½Ñ‹Ðµ Ð°Ð³ÐµÐ½Ñ‚Ñ‹ Ð¡Ñ‚Ð¸Ð²Ð°</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;">
        ${agentColumns
          .map(
            (col) => `
          <article class="card" style="text-align:left;">
            <h3 style="margin:0 0 6px;">${escapeHtml(col.title)}</h3>
            <p class="session-meta" style="margin:0 0 10px;">${escapeHtml(col.mission)}</p>
            <div class="session-meta" style="margin-bottom:6px;"><strong>ÐŸÐ¾Ð´ Ð½Ð¸Ð¼ Ð¿Ð¾Ð¼Ð¾Ñ‰Ð½Ð¸ÐºÐ¸:</strong></div>
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
      <h3 style="margin:0 0 10px;">Ð§Ñ‚Ð¾ Ð¾Ð±ÑÑƒÐ´Ð¸Ñ‚ÑŒ Ð² ÑÐ»ÐµÐ´ÑƒÑŽÑ‰Ð¸Ñ… ÑÐ¿Ð¸Ð·Ð¾Ð´Ð°Ñ…</h3>
      <ul style="margin:0;padding-left:18px;">
        <li>ÐšÐ°ÐºÐ¸Ðµ Ð¸Ð· ÑÑ‚Ð¸Ñ… Ð°Ð³ÐµÐ½Ñ‚Ð¾Ð² Ð·Ð°Ð¿ÑƒÑÐºÐ°ÐµÐ¼ Ð¿ÐµÑ€Ð²Ñ‹Ð¼Ð¸ (MVP-ÑÐ¾ÑÑ‚Ð°Ð²).</li>
        <li>ÐšÐ°ÐºÐ¸Ðµ Ð¼ÐµÑ‚Ñ€Ð¸ÐºÐ¸ Ð¸ SLA Ð·Ð°ÐºÑ€ÐµÐ¿Ð»ÑÐµÐ¼ Ð·Ð° ÐºÐ°Ð¶Ð´Ñ‹Ð¼ Ð°Ð³ÐµÐ½Ñ‚Ð¾Ð¼.</li>
        <li>ÐšÐ°ÐºÐ¸Ðµ Ð¾Ñ‚Ð´ÐµÐ»ÑŒÐ½Ñ‹Ðµ workspace Ð¸ Ð¿Ñ€Ð°Ð²Ð° Ð½ÑƒÐ¶Ð½Ñ‹ ÐºÐ°Ð¶Ð´Ð¾Ð¼Ñƒ Ð°Ð³ÐµÐ½Ñ‚Ñƒ.</li>
        <li>ÐšÐ°Ðº Ð´ÐµÐ»ÐµÐ³Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ Ð¿Ñ€Ð¾Ñ…Ð¾Ð´Ð¸Ñ‚ Ñ‡ÐµÑ€ÐµÐ· Ð¡Ñ‚Ð¸Ð²Ð° Ð¸ Ð³Ð´Ðµ Ñ‡ÐµÐ»Ð¾Ð²ÐµÐº ÑƒÑ‚Ð²ÐµÑ€Ð¶Ð´Ð°ÐµÑ‚ Ñ€ÐµÑˆÐµÐ½Ð¸Ñ.</li>
      </ul>
    </section>
  `;
}

function renderOrgChart() {
  const leads = [
    {
      role: 'CTO',
      icon: 'ðŸ§ ',
      title: 'ÐŸÑ€Ð¾Ð´ÑƒÐºÑ‚ Ð¸ Ñ‚ÐµÑ…Ð½Ð¾Ð»Ð¾Ð³Ð¸Ð¸',
      mission: 'Ð¢ÐµÑ…ÑÑ‚Ñ€Ð°Ñ‚ÐµÐ³Ð¸Ñ, Ð°Ñ€Ñ…Ð¸Ñ‚ÐµÐºÑ‚ÑƒÑ€Ð°, UX Ð¸ ÐºÐ°Ñ‡ÐµÑÑ‚Ð²Ð¾ Ñ€ÐµÐ»Ð¸Ð·Ð¾Ð²',
      color: 'blue',
      kpi: 'Release Stability 99.5%',
      teams: [
        { name: 'Backend Ð¸ Ð¸Ð½Ñ‚ÐµÐ³Ñ€Ð°Ñ†Ð¸Ð¸', count: 2 },
        { name: 'Frontend Ð¸ UX', count: 2 },
        { name: 'QA Ð¸ Ð½Ð°Ð´Ñ‘Ð¶Ð½Ð¾ÑÑ‚ÑŒ', count: 1 },
      ],
    },
    {
      role: 'CMO',
      icon: 'ðŸ“ˆ',
      title: 'Ð Ð¾ÑÑ‚ Ð¸ Ð¼Ð°Ñ€ÐºÐµÑ‚Ð¸Ð½Ð³',
      mission: 'Ð’Ð¾Ñ€Ð¾Ð½ÐºÐ° 10â†’100â†’1000, ÑÐºÑÐ¿ÐµÑ€Ð¸Ð¼ÐµÐ½Ñ‚Ñ‹ Ð¸ ÐºÐ¾Ð½Ñ‚ÐµÐ½Ñ‚-ÑÐ¸ÑÑ‚ÐµÐ¼Ð°',
      color: 'gold',
      kpi: 'Activation +18% WoW',
      teams: [
        { name: 'ÐšÐ¾Ð½Ñ‚ÐµÐ½Ñ‚-ÑÐ¸ÑÑ‚ÐµÐ¼Ð°', count: 2 },
        { name: 'Ð­ÐºÑÐ¿ÐµÑ€Ð¸Ð¼ÐµÐ½Ñ‚Ñ‹ Ð¿Ñ€Ð¸Ð²Ð»ÐµÑ‡ÐµÐ½Ð¸Ñ', count: 2 },
        { name: 'ÐÐ½Ð°Ð»Ð¸Ñ‚Ð¸ÐºÐ° Ð¸ Ð¸Ð½ÑÐ°Ð¹Ñ‚Ñ‹', count: 1 },
      ],
    },
    {
      role: 'COO',
      icon: 'âš™ï¸',
      title: 'ÐžÐ¿ÐµÑ€Ð°Ñ†Ð¸Ð¸ Ð¸ delivery',
      mission: 'SOP, ÐºÐ¾Ð½Ñ‚Ñ€Ð¾Ð»ÑŒ Ð¸ÑÐ¿Ð¾Ð»Ð½ÐµÐ½Ð¸Ñ, SLA Ð¸ Ð¿Ñ€Ð¾Ð·Ñ€Ð°Ñ‡Ð½Ð¾ÑÑ‚ÑŒ delivery',
      color: 'teal',
      kpi: 'SLA On-time 96%',
      teams: [
        { name: 'ÐšÐ¾Ð½Ñ‚Ñ€Ð¾Ð»ÑŒ Ð¸ÑÐ¿Ð¾Ð»Ð½ÐµÐ½Ð¸Ñ', count: 2 },
        { name: 'Automation Ops', count: 2 },
        { name: 'ÐšÐ»Ð¸ÐµÐ½Ñ‚ÑÐºÐ¸Ð¹ delivery', count: 1 },
      ],
    },
  ];

  const totalTeams = leads.reduce((sum, lead) => sum + lead.teams.length, 0);
  const totalAgents = 2 + leads.length + leads.reduce((sum, lead) => sum + lead.teams.reduce((n, t) => n + t.count, 0), 0);

  return `
    <section class="team-v2-shell">
      <header class="team-v2-head">
        <div>
          <h2 class="section-title team-v2-title">ÐšÐ¾Ð¼Ð°Ð½Ð´Ð° v2</h2>
          <p class="team-v2-sub">ÐžÐ¿ÐµÑ€Ð°Ñ†Ð¸Ð¾Ð½Ð½Ð°Ñ ÑÑ‚Ñ€ÑƒÐºÑ‚ÑƒÑ€Ð° Avanta OS Â· Ð²Ð¸Ð·ÑƒÐ°Ð» Ð´Ð»Ñ ÐµÐ¶ÐµÐ´Ð½ÐµÐ²Ð½Ð¾Ð³Ð¾ ÑƒÐ¿Ñ€Ð°Ð²Ð»ÐµÐ½Ð¸Ñ</p>
        </div>
        <div class="team-v2-chip">Live Org</div>
      </header>

      <div class="team-v2-metrics">
        <article class="team-v2-metric"><span>${totalAgents}</span><small>Ð’ÑÐµÐ³Ð¾ Ð°Ð³ÐµÐ½Ñ‚Ð¾Ð²</small></article>
        <article class="team-v2-metric"><span>${leads.length + 1}</span><small>Ð ÑƒÐºÐ¾Ð²Ð¾Ð´ÑÑ‰Ð¸Ð¹ ÐºÐ¾Ð½Ñ‚ÑƒÑ€</small></article>
        <article class="team-v2-metric"><span>${totalTeams}</span><small>ÐšÐ¾Ð¼Ð°Ð½Ð´</small></article>
        <article class="team-v2-metric"><span>3</span><small>ÐÐºÑ‚Ð¸Ð²Ð½Ñ‹Ñ… Ñ‚Ñ€ÐµÐºÐ°</small></article>
      </div>

      <section class="team-v2-core">
        <article class="team-v2-node owner">
          <div class="team-v2-person-row">
            <div class="team-avatar team-avatar-owner">Ð</div>
            <div>
              <div class="team-v2-role">Owner</div>
              <h3>ÐÐ½Ð´Ñ€ÐµÐ¹</h3>
              <p>Ð¡Ñ‚Ñ€Ð°Ñ‚ÐµÐ³Ð¸Ñ, Ñ„Ð¾ÐºÑƒÑ Ð¸ Ñ„Ð¸Ð½Ð°Ð»ÑŒÐ½Ð¾Ðµ Ñ€ÐµÑˆÐµÐ½Ð¸Ðµ</p>
            </div>
          </div>
        </article>

        <div class="team-v2-connector"></div>

        <article class="team-v2-node chief">
          <div class="team-v2-person-row">
            <div class="team-avatar team-avatar-chief">ðŸ§­</div>
            <div>
              <div class="team-v2-role">Chief of Execution</div>
              <h3>Ð¡Ñ‚Ð¸Ð²</h3>
              <p>ÐžÑ€ÐºÐµÑÑ‚Ñ€Ð°Ñ†Ð¸Ñ Ð·Ð°Ð´Ð°Ñ‡, Ð¿Ñ€Ð¸Ð¾Ñ€Ð¸Ñ‚ÐµÑ‚Ñ‹, ÐºÐ¾Ð½Ñ‚Ñ€Ð¾Ð»ÑŒ Ð¸ÑÐ¿Ð¾Ð»Ð½ÐµÐ½Ð¸Ñ</p>
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
              const leadName = lead.role === 'CTO' ? 'Ð˜Ð»ÑŒÑ' : lead.role === 'CMO' ? 'ÐœÐ°Ñ€Ð¸Ñ' : 'ÐÐ»ÐµÐºÑÐµÐ¹';
              const leadAvatar = lead.role === 'CTO' ? 'Ð˜' : lead.role === 'CMO' ? 'Ðœ' : 'Ð';
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
                  <small>${escapeHtml(team.count)} Ð°Ð³ÐµÐ½Ñ‚Ð°</small>
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
        <h2>Ð›Ð°Ð±Ð¾Ñ€Ð°Ñ‚Ð¾Ñ€Ð¸Ñ</h2>
        <p>Ð­ÐºÑÐ¿ÐµÑ€Ð¸Ð¼ÐµÐ½Ñ‚Ñ‹, Ð¿Ñ€Ð¾Ñ‚Ð¾Ñ‚Ð¸Ð¿Ñ‹ Ð¸ Ð½Ð¾Ñ‡Ð½Ñ‹Ðµ ÑÐ±Ð¾Ñ€ÐºÐ¸</p>
        <span class="session-meta">Ð¥Ñ€Ð°Ð½Ð¸Ð»Ð¸Ñ‰Ðµ: ${escapeHtml(l.storageMode || 'json')}</span>
      </section>

      ${l.loading ? '<div class="session-meta" style="margin-top:8px;">Ð—Ð°Ð³Ñ€ÑƒÐ·ÐºÐ°â€¦</div>' : ''}
      ${l.error ? `<div class="session-meta" style="margin-top:8px;color:#ff9cb3;">${escapeHtml(l.error)}</div>` : ''}

      <div class="lab-hero-grid">
        <section class="lab-hero-card">
          <h3>ÐŸÑ€Ð¾Ñ‚Ð¾Ñ‚Ð¸Ð¿Ñ‹</h3>
          <div class="lab-list">
            ${l.prototypes.length === 0 ? '<div class="session-meta">ÐŸÐ¾ÐºÐ° Ð½ÐµÑ‚ Ð¿Ñ€Ð¾Ñ‚Ð¾Ñ‚Ð¸Ð¿Ð¾Ð²</div>' : l.prototypes.map((p, i) => `<button class="lab-link" data-open-lab-preview="prototype:${i}">${escapeHtml(p.name || 'Ð¿Ñ€Ð¾Ñ‚Ð¾Ñ‚Ð¸Ð¿')}<span>${escapeHtml(p.url || 'â€”')}</span></button>`).join('')}
          </div>
        </section>

        <section class="lab-hero-card">
          <h3>Ð­ÐºÑÐ¿ÐµÑ€Ð¸Ð¼ÐµÐ½Ñ‚Ñ‹</h3>
          <div class="lab-list">
            ${l.experiments.length === 0 ? '<div class="session-meta">ÐŸÐ¾ÐºÐ° Ð½ÐµÑ‚ ÑÐºÑÐ¿ÐµÑ€Ð¸Ð¼ÐµÐ½Ñ‚Ð¾Ð²</div>' : l.experiments.map((e, i) => `<button class="lab-link" data-open-lab-preview="experiment:${i}">${escapeHtml(e.name || 'ÑÐºÑÐ¿ÐµÑ€Ð¸Ð¼ÐµÐ½Ñ‚')}<span>${escapeHtml(e.status || 'planned')}</span></button>`).join('')}
          </div>
        </section>
      </div>

      <section class="lab-hero-card" style="margin-top:14px;">
        <h3>ÐšÐ°Ð½Ð´Ð¸Ð´Ð°Ñ‚Ñ‹ Ñ„Ð¸Ñ‡ (${l.featureCandidates.length})</h3>
        <div class="lab-list">
          ${l.featureCandidates.length === 0
            ? '<div class="session-meta">ÐŸÐ¾ÐºÐ° Ð½ÐµÑ‚ ÐºÐ°Ð½Ð´Ð¸Ð´Ð°Ñ‚Ð¾Ð²</div>'
            : l.featureCandidates
                .map(
                  (c) => `<div class="lab-link" style="cursor:default;">
                  <strong>${escapeHtml(c.title || c.name || 'ÐºÐ°Ð½Ð´Ð¸Ð´Ð°Ñ‚')}</strong>
                  <span>${escapeHtml(c.status || 'ready_for_review')} Â· Ð¼Ð¾Ð´ÑƒÐ»ÑŒ: ${escapeHtml(c.auditedModule || 'lab')} Â· score: ${escapeHtml(c.priorityScore ?? 'n/a')}</span>
                  <span>Ð²Ð»Ð¸ÑÐ½Ð¸Ðµ: ${escapeHtml(c.impact ?? 'n/a')} Â· fit: ${escapeHtml(c.strategicFit ?? 'n/a')} Â· effort: ${escapeHtml(c.effort ?? 'n/a')} Â· Ñ€Ð¸ÑÐº: ${escapeHtml(c.risk ?? 'n/a')}</span>
                  <span>preview: ${escapeHtml(c.previewUrl || 'Ð½Ðµ Ð¿Ð¾Ð´Ð³Ð¾Ñ‚Ð¾Ð²Ð»ÐµÐ½Ð¾')}</span>
                  <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                    ${c.previewUrl ? `<button class="ghost-btn" data-open-external-url="${c.previewUrl}">ÐžÑ‚ÐºÑ€Ñ‹Ñ‚ÑŒ Ð¿Ñ€ÐµÐ²ÑŒÑŽ</button>` : ''}
                    <button class="ghost-btn" data-lab-decision="approve" data-candidate-id="${c.id}">ÐžÐ´Ð¾Ð±Ñ€Ð¸Ñ‚ÑŒ Ð² Ð¿Ñ€Ð¾Ð´</button>
                    <button class="ghost-btn" data-lab-decision="iterate" data-candidate-id="${c.id}">ÐÐ° Ð´Ð¾Ñ€Ð°Ð±Ð¾Ñ‚ÐºÑƒ</button>
                    <button class="ghost-btn" data-lab-decision="reject" data-candidate-id="${c.id}">ÐžÑ‚ÐºÐ»Ð¾Ð½Ð¸Ñ‚ÑŒ</button>
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
        <button class="session-modal-close" id="labPreviewClose" title="Ð—Ð°ÐºÑ€Ñ‹Ñ‚ÑŒ">âœ•</button>
        <div class="daily-viewer-head" style="margin-bottom:12px;padding-right:26px;">
          <strong>${escapeHtml(p.title || 'ÐŸÑ€ÐµÐ²ÑŒÑŽ')}</strong>
        </div>
        ${p.type === 'url'
          ? `<iframe class="lab-frame" src="${p.url}" title="${escapeHtml(p.title || 'lab preview')}"></iframe>`
          : `<div class="daily-markdown"><pre class="history-text" style="font-size:13px;">${escapeHtml(p.content || 'ÐÐµÑ‚ Ð´Ð°Ð½Ð½Ñ‹Ñ…')}</pre></div>`}
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
    title: item.name || 'ÐŸÑ€ÐµÐ²ÑŒÑŽ',
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
      state.lab.preview = { open: true, title: 'ÐŸÑ€ÐµÐ²ÑŒÑŽ Ð¿ÐµÑÐ¾Ñ‡Ð½Ð¸Ñ†Ñ‹', type: 'url', url, content: '' };
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
          state.opsBoard.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° Ð¾Ð±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ñ Ð¿Ñ€Ð¸Ð¾Ñ€Ð¸Ñ‚ÐµÑ‚Ð°';
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
        state.opsBoard.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° Ð´Ð¾Ð±Ð°Ð²Ð»ÐµÐ½Ð¸Ñ Ñ‚ÐµÐ³Ð°';
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
        state.opsBoard.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° ÑƒÐ´Ð°Ð»ÐµÐ½Ð¸Ñ Ñ‚ÐµÐ³Ð°';
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
      // text/plain Ð½ÑƒÐ¶ÐµÐ½ Ð´Ð»Ñ ÑÑ‚Ð°Ð±Ð¸Ð»ÑŒÐ½Ð¾Ð³Ð¾ drag&drop Ð² Ñ‡Ð°ÑÑ‚Ð¸ Ð±Ñ€Ð°ÑƒÐ·ÐµÑ€Ð¾Ð²
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
    if (!response.ok) throw new Error('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ ÑÐ¾Ñ…Ñ€Ð°Ð½Ð¸Ñ‚ÑŒ Ñ€ÐµÑˆÐµÐ½Ð¸Ðµ');
    await loadLabData({ silent: true });
  } catch (err) {
    state.lab.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° ÑÐ¾Ñ…Ñ€Ð°Ð½ÐµÐ½Ð¸Ñ Ñ€ÐµÑˆÐµÐ½Ð¸Ñ';
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
    if (!response.ok) throw new Error('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð¿ÐµÑ€ÐµÐ¼ÐµÑÑ‚Ð¸Ñ‚ÑŒ Ð·Ð°Ð´Ð°Ñ‡Ñƒ');
    await loadOpsBoard();
  } catch (err) {
    state.opsBoard.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° Ð¿ÐµÑ€ÐµÐ¼ÐµÑ‰ÐµÐ½Ð¸Ñ Ð·Ð°Ð´Ð°Ñ‡Ð¸';
    render();
  }
}

async function loadOpsBoard() {
  state.opsBoard.loading = true;
  state.opsBoard.error = null;
  render();
  try {
    const response = await fetch('/api/ops/board', { cache: 'no-store' });
    if (!response.ok) throw new Error('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ PM Board');
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
    state.opsBoard.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° PM Board';
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
    if (!response.ok) throw new Error('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ docs');
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
    state.opsDocs.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° docs';
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
    if (!response.ok) throw new Error('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ workspaces');
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
    state.opsWorkspaces.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° workspaces';
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
    if (!response.ok) throw new Error('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð»Ð°Ð±Ð¾Ñ€Ð°Ñ‚Ð¾Ñ€Ð½Ñ‹Ð¹ Ð¼Ð¾Ð´ÑƒÐ»ÑŒ');
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
    state.lab.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ¸ Ð»Ð°Ð±Ð¾Ñ€Ð°Ñ‚Ð¾Ñ€Ð¸Ð¸';
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
    if (!response.ok) throw new Error('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð¸Ð·Ð°Ñ†Ð¸Ð¸');
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
    state.automation.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ¸ Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð¸Ð·Ð°Ñ†Ð¸Ð¹';
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
    if (!response.ok) throw new Error('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ ÐºÐ°Ñ‚Ð°Ð»Ð¾Ð³ skills/plugins');
    const payload = await response.json();

    state.skillsDirectory = {
      ...state.skillsDirectory,
      loading: false,
      error: null,
      items: Array.isArray(payload.items) ? payload.items : [],
    };
  } catch (err) {
    state.skillsDirectory.loading = false;
    state.skillsDirectory.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ¸ ÐºÐ°Ñ‚Ð°Ð»Ð¾Ð³Ð°';
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
    if (!response.ok) throw new Error('ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ ÐµÐ¶ÐµÐ´Ð½ÐµÐ²Ð½Ñ‹Ðµ ÑÐ²Ð¾Ð´ÐºÐ¸');
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
    state.dailySummaries.error = err?.message || 'ÐžÑˆÐ¸Ð±ÐºÐ° Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐ¸ ÑÐ²Ð¾Ð´Ð¾Ðº';
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


