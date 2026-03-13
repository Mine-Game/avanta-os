const http = require('http');
const fs = require('fs');
const path = require('path');
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const HOST = '127.0.0.1';
const PORT = Number(process.env.AVANTA_PORT || process.env.PORT || 8800);
const ROOT = __dirname;
const SESSIONS_FILE = 'C:\\Users\\vboxuser\\.openclaw-finfak\\agents\\main\\sessions\\sessions.json';
const CRON_FILE = 'C:\\Users\\vboxuser\\.openclaw-finfak\\cron\\jobs.json';
const DAILY_SUMMARIES_DIR = path.join(ROOT, 'data', 'daily-summaries');
const LAB_DIR = path.join(ROOT, 'data', 'lab');
const LAB_PROTOTYPES_FILE = path.join(LAB_DIR, 'prototypes.json');
const LAB_SELF_BUILDS_FILE = path.join(LAB_DIR, 'self-builds.json');
const LAB_DB_FILE = path.join(LAB_DIR, 'lab.db');
const LAB_FAILED_FILE = path.join(LAB_DIR, 'failed-features.json');
const LAB_CLIENT_PROTOTYPES_FILE = path.join(LAB_DIR, 'client-prototypes.json');
const LAB_CANDIDATES_FILE = path.join(LAB_DIR, 'feature-candidates.json');
const LAB_NIGHTLY_AUDIT_LOG_FILE = path.join(LAB_DIR, 'nightly-audit-log.jsonl');

let lastGoodPayload = null;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function ensureLabDir() {
  if (!fs.existsSync(LAB_DIR)) fs.mkdirSync(LAB_DIR, { recursive: true });
}

function initLabDb() {
  if (!DatabaseSync) return null;
  ensureLabDir();
  const db = new DatabaseSync(LAB_DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner TEXT,
      scope TEXT,
      status TEXT,
      url TEXT,
      notes TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      module TEXT,
      status TEXT,
      rootCause TEXT,
      resolution TEXT,
      loggedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS nightly_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT,
      summary TEXT,
      loggedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS client_prototypes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientName TEXT NOT NULL,
      featureName TEXT NOT NULL,
      status TEXT,
      url TEXT,
      notes TEXT,
      loggedAt TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function seedLabDb() {
  // В Lab никаких автозаглушек: показываем только реально созданные записи.
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) reject(new Error('payload-too-large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
}

function safePath(urlPath) {
  const normalized = path.normalize(decodeURIComponent(urlPath).replace(/^\/+/, ''));
  const fullPath = path.join(ROOT, normalized || 'index.html');
  if (!fullPath.startsWith(ROOT)) return null;
  return fullPath;
}

function mapSession(key, s) {
  const state = s.abortedLastRun ? 'failed' : 'active';
  const ageMs = s.updatedAt ? Math.max(0, Date.now() - Number(s.updatedAt)) : 0;
  const agoMin = Math.round(ageMs / 60000);
  return {
    id: s.sessionId || key || 'session',
    sessionKey: key,
    title: key || s.sessionId || 'session',
    subtitle: `agent: main | kind: ${s.chatType || 'unknown'}`,
    text: `tokens in/out/total: ${s.inputTokens || 0}/${s.outputTokens || 0}/${s.totalTokens || 0}`,
    model: s.model || 'unknown',
    state,
    ago: `${agoMin} min ago`,
  };
}

function formatMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return new Date(n).toLocaleString();
}

function mapCron(job) {
  const enabled = job.enabled !== false;
  const lastStatus = String(job?.state?.lastStatus || job?.state?.lastRunStatus || '').toLowerCase();
  const status = !enabled ? 'idle' : lastStatus === 'error' || lastStatus === 'failed' ? 'failed' : 'success';

  const scheduleText =
    typeof job.schedule === 'string'
      ? job.schedule
      : job?.schedule?.kind === 'cron'
        ? `${job.schedule.expr || '—'}${job.schedule.tz ? ` (${job.schedule.tz})` : ''}`
        : job?.schedule?.kind === 'every'
          ? `every ${job.schedule.everyMs || '—'}ms`
          : job?.schedule?.kind === 'at'
            ? job.schedule.at || '—'
            : job.cron || '—';

  const nextRun = job.nextRunAt || formatMs(job?.state?.nextRunAtMs);
  const lastRun = job.lastRunAt || formatMs(job?.state?.lastRunAtMs);

  return {
    id: job.id || null,
    name: job.name || job.id || 'cron',
    schedule: scheduleText,
    lastRun,
    status,
    nextRun,
    error: '',
  };
}

function toPreviewText(message) {
  const parts = Array.isArray(message?.content) ? message.content : [];
  const chunks = [];

  for (const part of parts) {
    if (part?.type === 'text' && part.text) chunks.push(part.text);
    else if (part?.type === 'toolCall') chunks.push(`toolCall: ${part.name || 'tool'}`);
    else if (part?.type === 'thinking' && part.thinking) chunks.push('thinking…');
  }

  const combined = chunks.join('\n').trim();
  if (!combined) return '—';
  return combined.length > 1200 ? `${combined.slice(0, 1200)}\n…` : combined;
}

function parseSessionHistory(sessionFilePath) {
  const raw = fs.readFileSync(sessionFilePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const history = [];

  for (const line of lines) {
    try {
      const evt = JSON.parse(line);
      if (evt.type !== 'message' || !evt.message) continue;

      history.push({
        id: evt.id || `${history.length}`,
        role: evt.message.role || 'unknown',
        timestamp: evt.timestamp || null,
        text: toPreviewText(evt.message),
      });
    } catch {
      // ignore malformed jsonl line
    }
  }

  return history;
}

async function missionControlHandler(res) {
  try {
    const sessionsRaw = readJson(SESSIONS_FILE);
    const cronRaw = readJson(CRON_FILE);

    const sessionEntries = Object.entries(sessionsRaw || {});
    const sessions = sessionEntries.map(([key, value]) => mapSession(key, value));

    const first = sessionEntries[0]?.[1] || {};
    const model = first.model || null;
    const provider = first.modelProvider || (model && model.includes('/') ? model.split('/')[0] : 'unknown');
    const context = first.contextTokens ? String(first.contextTokens) : null;

    const payload = {
      model,
      provider,
      status: 'online',
      context,
      sessions,
      crons: Array.isArray(cronRaw?.jobs) ? cronRaw.jobs.map(mapCron) : [],
      sourceConnected: true,
      generatedAt: new Date().toISOString(),
      stale: false,
      error: null,
    };

    lastGoodPayload = payload;
    json(res, 200, payload);
  } catch (error) {
    if (lastGoodPayload) {
      return json(res, 200, {
        ...lastGoodPayload,
        sourceConnected: false,
        stale: true,
        error: error.message,
        generatedAt: new Date().toISOString(),
      });
    }

    json(res, 500, {
      error: 'mission-control-fetch-failed',
      message: error.message,
      sourceConnected: false,
      generatedAt: new Date().toISOString(),
    });
  }
}

function mapAutomationJob(job) {
  const mapped = mapCron(job);
  return {
    id: job.id || mapped.id || null,
    name: job.name || mapped.name,
    description: job.description || '',
    schedule: mapped.schedule,
    status: mapped.status,
    lastRun: mapped.lastRun,
    nextRun: mapped.nextRun,
    message: job?.payload?.message || '',
    payloadKind: job?.payload?.kind || 'unknown',
    sessionTarget: job?.sessionTarget || 'unknown',
    wakeMode: job?.wakeMode || 'unknown',
    deliveryMode: job?.delivery?.mode || 'unknown',
    deliveryChannel: job?.delivery?.channel || 'unknown',
    consecutiveErrors: Number(job?.state?.consecutiveErrors || 0),
    enabled: job?.enabled !== false,
  };
}

async function automationHandler(req, res) {
  try {
    const cronRaw = readJson(CRON_FILE);
    const jobs = Array.isArray(cronRaw?.jobs) ? cronRaw.jobs.map(mapAutomationJob) : [];

    return json(res, 200, {
      jobs,
      sourceConnected: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, {
      error: 'automation-fetch-failed',
      message: error.message,
      sourceConnected: false,
      generatedAt: new Date().toISOString(),
    });
  }
}

async function dailySummariesHandler(req, res, url) {
  try {
    if (!fs.existsSync(DAILY_SUMMARIES_DIR)) {
      fs.mkdirSync(DAILY_SUMMARIES_DIR, { recursive: true });
    }

    const files = fs
      .readdirSync(DAILY_SUMMARIES_DIR)
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .sort((a, b) => b.localeCompare(a));

    const requested = url.searchParams.get('file');
    const selectedFile = files.includes(requested) ? requested : files[0] || null;

    let content = '';
    if (selectedFile) {
      content = fs.readFileSync(path.join(DAILY_SUMMARIES_DIR, selectedFile), 'utf8');
    }

    return json(res, 200, {
      items: files.map((file) => ({ file, title: file.replace(/\.md$/i, '') })),
      selectedFile,
      content,
      sourceConnected: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, {
      error: 'daily-summaries-fetch-failed',
      message: error.message,
      sourceConnected: false,
      generatedAt: new Date().toISOString(),
    });
  }
}

async function labHandler(req, res) {
  try {
    ensureLabDir();

    const prototypesPayload = readJsonSafe(LAB_PROTOTYPES_FILE, { prototypes: [] });
    const selfBuildsPayload = readJsonSafe(LAB_SELF_BUILDS_FILE, { selfBuilds: [] });
    const failedPayload = readJsonSafe(LAB_FAILED_FILE, { failedFeatures: [] });
    const clientPrototypesPayload = readJsonSafe(LAB_CLIENT_PROTOTYPES_FILE, { clientPrototypes: [] });
    const candidatesPayload = readJsonSafe(LAB_CANDIDATES_FILE, { featureCandidates: [] });
    const cronRaw = readJsonSafe(CRON_FILE, { jobs: [] });

    let experiments = [];
    let dbNightlyRuns = [];
    let dbFailures = [];
    let dbClientPrototypes = [];

    const db = initLabDb();
    if (db) {
      seedLabDb(db);
      experiments = db.prepare('SELECT id, name, owner, scope, status, url, notes, createdAt FROM experiments ORDER BY id DESC LIMIT 100').all();
      dbNightlyRuns = db.prepare('SELECT id, name, status, summary as notes, loggedAt FROM nightly_runs ORDER BY id DESC LIMIT 100').all();
      dbFailures = db
        .prepare('SELECT id, name, module, status, rootCause, resolution, loggedAt FROM failures ORDER BY id DESC LIMIT 100')
        .all()
        .map((x) => ({ ...x, notes: `root cause: ${x.rootCause || '—'}\nresolution: ${x.resolution || '—'}` }));
      dbClientPrototypes = db
        .prepare('SELECT id, clientName, featureName, status, url, notes, loggedAt FROM client_prototypes ORDER BY id DESC LIMIT 100')
        .all()
        .map((x) => ({
          id: x.id,
          name: `${x.clientName} — ${x.featureName}`,
          clientName: x.clientName,
          featureName: x.featureName,
          status: x.status,
          url: x.url,
          notes: x.notes,
          loggedAt: x.loggedAt,
        }));
      db.close();
    }

    const nightlyBuilds = Array.isArray(cronRaw?.jobs)
      ? cronRaw.jobs.map((job) => ({
          name: job.name || job.id || 'cron-job',
          schedule: job.schedule || job.cron || '—',
          status: job.enabled === false ? 'idle' : 'scheduled',
          lastRun: job.lastRunAt || '—',
          nextRun: job.nextRunAt || '—',
          notes: `Schedule: ${job.schedule || job.cron || '—'}\nLast run: ${job.lastRunAt || '—'}\nNext run: ${job.nextRunAt || '—'}\nEnabled: ${job.enabled !== false ? 'yes' : 'no'}`,
        }))
      : [];

    return json(res, 200, {
      storageMode: dbNightlyRuns.length || experiments.length ? 'sqlite+json' : 'json',
      prototypes: Array.isArray(prototypesPayload.prototypes) ? prototypesPayload.prototypes : [],
      experiments,
      nightlyBuilds: [...dbNightlyRuns, ...nightlyBuilds],
      selfBuilds: Array.isArray(selfBuildsPayload.selfBuilds) ? selfBuildsPayload.selfBuilds : [],
      failedFeatures: dbFailures.length ? dbFailures : Array.isArray(failedPayload.failedFeatures) ? failedPayload.failedFeatures : [],
      clientPrototypes: dbClientPrototypes.length
        ? dbClientPrototypes
        : Array.isArray(clientPrototypesPayload.clientPrototypes)
          ? clientPrototypesPayload.clientPrototypes
          : [],
      featureCandidates: Array.isArray(candidatesPayload.featureCandidates) ? candidatesPayload.featureCandidates : [],
      sourceConnected: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, {
      error: 'lab-fetch-failed',
      message: error.message,
      sourceConnected: false,
      generatedAt: new Date().toISOString(),
    });
  }
}

function loadFeatureCandidates() {
  const payload = readJsonSafe(LAB_CANDIDATES_FILE, { featureCandidates: [] });
  return Array.isArray(payload.featureCandidates) ? payload.featureCandidates : [];
}

function saveFeatureCandidates(list) {
  fs.writeFileSync(LAB_CANDIDATES_FILE, JSON.stringify({ featureCandidates: list }, null, 2), 'utf8');
}

function appendNightlyAuditLog(event) {
  ensureLabDir();
  fs.appendFileSync(LAB_NIGHTLY_AUDIT_LOG_FILE, `${JSON.stringify(event)}\n`, 'utf8');
}

function saveNightlyAuditOutcome({ name, status, summary, module = 'lab', rootCause = '', resolution = '' }) {
  const db = initLabDb();
  if (db) {
    if (status === 'failed') {
      db.prepare('INSERT INTO failures (name, module, status, rootCause, resolution) VALUES (?, ?, ?, ?, ?)').run(
        name,
        module,
        status,
        rootCause,
        resolution
      );
    } else {
      db.prepare('INSERT INTO nightly_runs (name, status, summary) VALUES (?, ?, ?)').run(name, status, summary);
    }
  }

  appendNightlyAuditLog({
    at: new Date().toISOString(),
    name,
    module,
    status,
    summary,
    rootCause,
    resolution,
  });
}

function getNextPreviewPort(list) {
  const used = new Set(
    (Array.isArray(list) ? list : [])
      .map((x) => Number(x.previewPort))
      .filter((x) => Number.isFinite(x) && x >= 8811 && x <= 8999)
  );
  for (let p = 8811; p <= 8999; p += 1) {
    if (!used.has(p)) return p;
  }
  return 0;
}

async function labCandidateNightlyHandler(req, res) {
  let title = 'Nightly feature candidate';
  try {
    ensureLabDir();
    const body = await readBody(req);
    const list = loadFeatureCandidates();
    const previewPort = getNextPreviewPort(list);
    if (!previewPort) {
      saveNightlyAuditOutcome({
        name: title,
        status: 'failed',
        summary: 'Could not create nightly candidate: no free staged preview ports',
        module: 'lab',
        rootCause: 'no-free-preview-ports',
        resolution: 'Free an existing staged candidate port between 8811-8999',
      });
      return json(res, 500, { error: 'no-free-preview-ports' });
    }

    const nextId = list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
    title = String(body.title || 'Nightly feature candidate');

    const item = {
      id: nextId,
      title,
      summary: String(body.summary || ''),
      impact: body.impact ?? null,
      risk: body.risk ?? null,
      status: 'ready_for_review',
      previewPort,
      previewUrl: body.previewUrl || `http://127.0.0.1:${previewPort}/`,
      targetProdPort: 8800,
      createdAt: new Date().toISOString(),
    };

    list.unshift(item);
    saveFeatureCandidates(list);
    saveNightlyAuditOutcome({
      name: title,
      status: 'ready_for_review',
      summary: `Candidate #${item.id} created for staged preview ${item.previewUrl}`,
    });

    return json(res, 200, { ok: true, item });
  } catch (error) {
    saveNightlyAuditOutcome({
      name: title,
      status: 'failed',
      summary: `Nightly candidate creation failed: ${error.message}`,
      module: 'lab',
      rootCause: error.message,
      resolution: 'Review nightly-candidate payload and staged preview availability',
    });
    return json(res, 500, { error: 'nightly-candidate-create-failed', message: error.message });
  }
}

async function labDecisionHandler(req, res) {
  try {
    ensureLabDir();
    const body = await readBody(req);
    const id = Number(body.id);
    const decision = String(body.decision || '').toLowerCase();

    if (Number.isNaN(id)) return json(res, 400, { error: 'id-required' });
    if (!['approve', 'reject', 'iterate'].includes(decision)) return json(res, 400, { error: 'invalid-decision' });

    const list = loadFeatureCandidates();
    const idx = list.findIndex((x) => Number(x.id) === id);
    if (idx < 0) return json(res, 404, { error: 'candidate-not-found' });

    const nextStatus = decision === 'approve' ? 'approved_for_prod' : decision === 'reject' ? 'rejected' : 'needs_iteration';
    list[idx] = {
      ...list[idx],
      status: nextStatus,
      decidedAt: new Date().toISOString(),
      promoteToProd: nextStatus === 'approved_for_prod',
    };

    saveFeatureCandidates(list);
    return json(res, 200, { ok: true, item: list[idx] });
  } catch (error) {
    return json(res, 500, { error: 'lab-decision-failed', message: error.message });
  }
}

async function sessionHistoryHandler(req, res, url) {
  try {
    const sessionKey = url.searchParams.get('sessionKey');
    if (!sessionKey) return json(res, 400, { error: 'sessionKey-required' });

    const sessionsRaw = readJson(SESSIONS_FILE);
    const session = sessionsRaw?.[sessionKey];
    if (!session) return json(res, 404, { error: 'session-not-found', sessionKey });

    const sessionFile = session.sessionFile;
    if (!sessionFile || !fs.existsSync(sessionFile)) {
      return json(res, 404, { error: 'session-file-not-found', sessionKey });
    }

    const history = parseSessionHistory(sessionFile);

    return json(res, 200, {
      session: {
        sessionKey,
        sessionId: session.sessionId || null,
        model: session.model || null,
        channel: session.lastChannel || session?.deliveryContext?.channel || null,
        updatedAt: session.updatedAt || null,
        tokens: {
          input: session.inputTokens || 0,
          output: session.outputTokens || 0,
          total: session.totalTokens || 0,
        },
      },
      history,
      sourceConnected: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, {
      error: 'session-history-fetch-failed',
      message: error.message,
      sourceConnected: false,
      generatedAt: new Date().toISOString(),
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (url.pathname === '/api/mission-control') {
    return missionControlHandler(res);
  }

  if (url.pathname === '/api/session-history') {
    return sessionHistoryHandler(req, res, url);
  }

  if (url.pathname === '/api/daily-summaries') {
    return dailySummariesHandler(req, res, url);
  }

  if (url.pathname === '/api/automation') {
    return automationHandler(req, res);
  }

  if (url.pathname === '/api/lab') {
    return labHandler(req, res);
  }

  if (url.pathname === '/api/lab/decision' && req.method === 'POST') {
    return labDecisionHandler(req, res);
  }

  if (url.pathname === '/api/lab/nightly-candidate' && req.method === 'POST') {
    return labCandidateNightlyHandler(req, res);
  }

  const fullPath = safePath(url.pathname === '/' ? '/index.html' : url.pathname);
  if (!fullPath) return json(res, 403, { error: 'forbidden' });

  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType(fullPath), 'Cache-Control': 'no-store' });
    fs.createReadStream(fullPath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Avanta-OS running at http://${HOST}:${PORT}/`);
});
