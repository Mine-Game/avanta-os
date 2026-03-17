const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
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
const SESSIONS_DIR = path.dirname(SESSIONS_FILE);
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
const OPS_DIR = path.join(ROOT, 'data', 'ops');
const OPS_BOARD_FILE = path.join(OPS_DIR, 'board.json');
const OPS_ARTICLES_FILE = path.join(OPS_DIR, 'articles.json');
const DOCS_DIR = path.join(ROOT, 'data', 'docs');
const WORKSPACE_ROOT = path.resolve(ROOT, '..', '..');

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

const OPENCLAW_BIN = process.platform === 'win32' ? 'C:\\Users\\vboxuser\\AppData\\Roaming\\npm\\openclaw.cmd' : 'openclaw';

function runJsonCli(command, args = []) {
  const bin = command === 'openclaw' ? OPENCLAW_BIN : command;

  const out =
    process.platform === 'win32' && String(bin).toLowerCase().endsWith('.cmd')
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', `${bin} ${args.join(' ')}`], {
          cwd: WORKSPACE_ROOT,
          encoding: 'utf8',
          timeout: 15000,
          windowsHide: true,
        })
      : execFileSync(bin, args, {
          cwd: WORKSPACE_ROOT,
          encoding: 'utf8',
          timeout: 15000,
          windowsHide: true,
        });

  return JSON.parse(out || '{}');
}

function ensureLabDir() {
  if (!fs.existsSync(LAB_DIR)) fs.mkdirSync(LAB_DIR, { recursive: true });
}

function ensureOpsDir() {
  if (!fs.existsSync(OPS_DIR)) fs.mkdirSync(OPS_DIR, { recursive: true });
}

function initOpsBoard() {
  ensureOpsDir();
  if (fs.existsSync(OPS_BOARD_FILE)) return;

  const seed = {
    tasks: [],
    deliverables: [],
  };

  fs.writeFileSync(OPS_BOARD_FILE, JSON.stringify(seed, null, 2), 'utf8');
}

function initOpsArticles() {
  ensureOpsDir();
  if (fs.existsSync(OPS_ARTICLES_FILE)) return;

  const seed = { items: [] };
  fs.writeFileSync(OPS_ARTICLES_FILE, JSON.stringify(seed, null, 2), 'utf8');
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

function maybeDecodeMojibake(text) {
  if (typeof text !== 'string' || text.length === 0) return text || '';

  const looksBroken = /[ÐÑÂÃ]|�|[€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/.test(text);
  if (!looksBroken) return text;

  const score = (s) => {
    const cyr = (s.match(/[А-Яа-яЁё]/g) || []).length;
    const bad = (s.match(/[�ÐÑÂÃ]/g) || []).length;
    return cyr * 3 - bad * 2;
  };

  let best = text;
  let bestScore = score(text);

  try {
    const latin1Decoded = Buffer.from(text, 'latin1').toString('utf8');
    const sc = score(latin1Decoded);
    if (sc > bestScore) {
      best = latin1Decoded;
      bestScore = sc;
    }
  } catch {}

  try {
    // Декодирование случаев, где байты 0x80-0x9F были превращены в CP1252-символы (‡, ‹, … и т.п.)
    const cp1252Map = {
      0x20ac: 0x80,
      0x201a: 0x82,
      0x0192: 0x83,
      0x201e: 0x84,
      0x2026: 0x85,
      0x2020: 0x86,
      0x2021: 0x87,
      0x02c6: 0x88,
      0x2030: 0x89,
      0x0160: 0x8a,
      0x2039: 0x8b,
      0x0152: 0x8c,
      0x017d: 0x8e,
      0x2018: 0x91,
      0x2019: 0x92,
      0x201c: 0x93,
      0x201d: 0x94,
      0x2022: 0x95,
      0x2013: 0x96,
      0x2014: 0x97,
      0x02dc: 0x98,
      0x2122: 0x99,
      0x0161: 0x9a,
      0x203a: 0x9b,
      0x0153: 0x9c,
      0x017e: 0x9e,
      0x0178: 0x9f,
    };

    const bytes = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp <= 0xff) bytes.push(cp);
      else if (cp1252Map[cp] !== undefined) bytes.push(cp1252Map[cp]);
      else bytes.push(0x3f);
    }

    const cp1252Decoded = Buffer.from(bytes).toString('utf8');
    const sc = score(cp1252Decoded);
    if (sc > bestScore) {
      best = cp1252Decoded;
      bestScore = sc;
    }
  } catch {}

  return best;
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
    name: maybeDecodeMojibake(job.name || job.id || 'cron'),
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
    name: maybeDecodeMojibake(job.name || mapped.name),
    description: maybeDecodeMojibake(job.description || ''),
    schedule: mapped.schedule,
    scheduleKind: job?.schedule?.kind || 'cron',
    scheduleExpr: job?.schedule?.expr || '',
    scheduleTz: job?.schedule?.tz || 'Asia/Vladivostok',
    status: mapped.status,
    lastRun: mapped.lastRun,
    nextRun: mapped.nextRun,
    message: maybeDecodeMojibake(job?.payload?.message || ''),
    payloadKind: job?.payload?.kind || 'unknown',
    model: job?.payload?.model || '—',
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

function isValidCronExpr(expr) {
  const text = String(expr || '').trim();
  if (!text) return false;
  const parts = text.split(/\s+/);
  return parts.length === 5 || parts.length === 6;
}

function safeBackupAndWriteCron(payload) {
  const dir = path.dirname(CRON_FILE);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(dir, `jobs.backup.${ts}.json`);
  const tmp = path.join(dir, `jobs.tmp.${process.pid}.${Date.now()}.json`);

  fs.copyFileSync(CRON_FILE, backup);
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, CRON_FILE);

  return backup;
}

async function automationUpdateHandler(req, res) {
  try {
    const body = await readBody(req);
    const id = String(body?.id || '').trim();
    if (!id) return json(res, 400, { error: 'id-required' });

    const cronRaw = readJson(CRON_FILE);
    const jobs = Array.isArray(cronRaw?.jobs) ? cronRaw.jobs : [];
    const idx = jobs.findIndex((x) => String(x?.id || '') === id);
    if (idx < 0) return json(res, 404, { error: 'job-not-found' });

    const job = jobs[idx];
    const nextName = String(body?.name ?? job?.name ?? '').trim();
    const nextDescription = String(body?.description ?? job?.description ?? '').trim();
    const nextEnabled = body?.enabled === undefined ? job?.enabled !== false : !!body.enabled;
    const nextExpr = String(body?.scheduleExpr ?? job?.schedule?.expr ?? '').trim();
    const nextTz = String(body?.scheduleTz ?? job?.schedule?.tz ?? 'Asia/Vladivostok').trim();
    const nextMessage = String(body?.message ?? job?.payload?.message ?? '').trim();

    if (!nextName) return json(res, 400, { error: 'name-required' });
    if (!isValidCronExpr(nextExpr)) return json(res, 400, { error: 'invalid-cron-expr' });
    if (!nextTz) return json(res, 400, { error: 'schedule-tz-required' });
    if (!nextMessage) return json(res, 400, { error: 'message-required' });

    jobs[idx] = {
      ...job,
      name: nextName,
      description: nextDescription,
      enabled: nextEnabled,
      updatedAtMs: Date.now(),
      schedule: {
        ...(job?.schedule || {}),
        kind: 'cron',
        expr: nextExpr,
        tz: nextTz,
      },
      payload: {
        ...(job?.payload || {}),
        kind: job?.payload?.kind || 'agentTurn',
        message: nextMessage,
      },
    };

    const updated = {
      ...(cronRaw || {}),
      jobs,
    };

    const backupPath = safeBackupAndWriteCron(updated);

    return json(res, 200, {
      ok: true,
      job: mapAutomationJob(jobs[idx]),
      backupPath,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, {
      error: 'automation-update-failed',
      message: error.message,
      generatedAt: new Date().toISOString(),
    });
  }
}

async function langSearchHandler(req, res) {
  try {
    const apiKey = process.env.LANGSEARCH_API_KEY;
    if (!apiKey) return json(res, 400, { error: 'langsearch-key-missing' });

    const body = await readBody(req);
    const query = String(body?.query || '').trim();
    if (!query) return json(res, 400, { error: 'query-required' });

    const payload = {
      query,
      freshness: body?.freshness || 'oneMonth',
      summary: body?.summary !== false,
      count: Math.max(1, Math.min(10, Number(body?.count || 5))),
    };

    const response = await fetch('https://api.langsearch.com/v1/web-search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.json();
    const rows = Array.isArray(raw?.data?.webPages?.value) ? raw.data.webPages.value : [];

    return json(res, 200, {
      query,
      count: rows.length,
      items: rows.map((x) => ({
        title: x?.name || '',
        url: x?.url || '',
        snippet: x?.snippet || '',
        summary: x?.summary || '',
        datePublished: x?.datePublished || null,
      })),
      source: 'langsearch',
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, {
      error: 'langsearch-failed',
      message: error.message,
      generatedAt: new Date().toISOString(),
    });
  }
}

async function brainDirectoryHandler(req, res) {
  try {
    const skillsPayload = runJsonCli('openclaw', ['skills', 'list', '--json']);
    const pluginsPayload = runJsonCli('openclaw', ['plugins', 'list', '--json']);
    const cronRaw = readJsonSafe(CRON_FILE, { jobs: [] });

    const skills = Array.isArray(skillsPayload?.skills) ? skillsPayload.skills : [];
    const plugins = Array.isArray(pluginsPayload?.plugins) ? pluginsPayload.plugins : [];
    const cronJobs = Array.isArray(cronRaw?.jobs) ? cronRaw.jobs : [];

    const automationUsageText = cronJobs
      .map((j) => `${j?.id || ''} ${j?.name || ''} ${j?.description || ''} ${j?.payload?.message || ''}`.toLowerCase())
      .join('\n');

    const skillItems = skills.map((s) => ({
      id: `skill:${s.name || 'unknown'}`,
      name: s.name || 'skill',
      kind: 'skill',
      kindLabel: 'Skill',
      origin: String(s.source || '').includes('bundled') ? 'built-in' : 'custom',
      status: s.eligible ? 'eligible' : s.disabled ? 'disabled' : 'installed',
      statusLabel: s.eligible ? 'готово' : s.disabled ? 'disabled' : 'установлено',
      enabled: s.disabled !== true,
      eligible: s.eligible === true,
      usedBy: s.blockedByAllowlist ? 'ограничено allowlist' : 'agent: main',
      description: s.description || '',
      source: s.source || 'unknown',
    }));

    const pluginItems = plugins.map((p) => {
      const pid = String(p.id || '').toLowerCase();
      const pname = String(p.name || '').toLowerCase();
      const isUsedInAutomation =
        !!pid && (automationUsageText.includes(pid) || (pname && automationUsageText.includes(pname.replace('@openclaw/', ''))));

      return {
        id: `plugin:${p.id || 'unknown'}`,
        name: p.name || p.id || 'plugin',
        kind: 'plugin',
        kindLabel: 'Plug-in',
        origin: p.origin === 'bundled' ? 'built-in' : 'custom',
        status: p.status || 'unknown',
        statusLabel: p.enabled ? 'enabled' : p.status || 'disabled',
        enabled: p.enabled === true,
        eligible: p.enabled === true,
        usedBy: p.enabled ? 'gateway / agent runtime' : 'не активирован',
        description: p.description || '',
        source: p.source || 'unknown',
        utilization: {
          inAutomations: isUsedInAutomation,
          summary: isUsedInAutomation ? 'используется в automation' : 'явно не найден в automation',
        },
      };
    });

    return json(res, 200, {
      items: [...skillItems, ...pluginItems].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru')),
      sourceConnected: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, {
      error: 'brain-directory-fetch-failed',
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

function computeCandidatePriority({ impact, effort, risk, strategicFit }) {
  const impactN = Math.max(1, Math.min(10, Number(impact) || 1));
  const effortN = Math.max(1, Math.min(10, Number(effort) || 5));
  const riskN = Math.max(1, Math.min(10, Number(risk) || 5));
  const strategicFitN = Math.max(1, Math.min(10, Number(strategicFit) || 5));

  // Веса смещены в пользу роста продукта и пользовательской ценности (USER.md + MEMORY.md).
  const score = impactN * 0.45 + strategicFitN * 0.35 - effortN * 0.12 - riskN * 0.08;

  return {
    impact: impactN,
    effort: effortN,
    risk: riskN,
    strategicFit: strategicFitN,
    priorityScore: Number(score.toFixed(2)),
  };
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
    const product = body.product && typeof body.product === 'object' ? body.product : null;
    title = String(body.title || product?.name || `Micro-SaaS candidate #${nextId}`);
    const auditedModule = ['ops', 'brain', 'lab'].includes(String(body.auditedModule || body.module || '').toLowerCase())
      ? String(body.auditedModule || body.module).toLowerCase()
      : 'lab';

    const score = computeCandidatePriority({
      impact: body.impact ?? body.goNoGo?.score,
      effort: body.effort,
      risk: body.risk,
      strategicFit: body.strategicFit,
    });

    const summaryText = String(
      body.summary ||
        product?.problem ||
        body.problem ||
        body.note ||
        ''
    );

    const item = {
      id: nextId,
      externalId: body.id || null,
      title,
      summary: summaryText,
      auditedModule,
      impact: score.impact,
      effort: score.effort,
      risk: score.risk,
      strategicFit: score.strategicFit,
      priorityScore: score.priorityScore,
      status: String(body.status || (body.goNoGo?.score >= 6.8 ? 'ready_for_review' : 'needs_research')),
      previewPort,
      previewUrl: body.previewUrl || body.preview?.url || `http://127.0.0.1:${previewPort}/`,
      targetProdPort: 8800,
      icp: product?.icp || body.icp || '',
      monetization: product?.monetization || body.monetization || '',
      createdAt: new Date().toISOString(),
    };

    list.unshift(item);
    saveFeatureCandidates(list);
    saveNightlyAuditOutcome({
      name: title,
      module: auditedModule,
      status: 'ready_for_review',
      summary: `Candidate #${item.id} (${auditedModule}) created for staged preview ${item.previewUrl}; priorityScore=${item.priorityScore}`,
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

function computeOpsTaskUrgency(task, nowTs) {
  const priorityWeights = { low: 1, medium: 2, high: 3, critical: 4 };
  const priorityWeight = priorityWeights[String(task?.priority || '').toLowerCase()] || 2;
  const status = String(task?.status || '').toLowerCase();

  const dueTs = Date.parse(task?.dueAt || '');
  const slaTs = Date.parse(task?.slaAt || '');
  const hasDue = Number.isFinite(dueTs);
  const hasSla = Number.isFinite(slaTs);

  const hoursToDue = hasDue ? (dueTs - nowTs) / 3_600_000 : null;
  const hoursToSla = hasSla ? (slaTs - nowTs) / 3_600_000 : null;
  const overdueByHours = hasDue && dueTs < nowTs ? (nowTs - dueTs) / 3_600_000 : 0;
  const slaBreachedByHours = hasSla && slaTs < nowTs ? (nowTs - slaTs) / 3_600_000 : 0;

  const blockedPenalty = status === 'blocked' ? 3.2 : 0;
  const dueRisk = overdueByHours > 0 ? Math.min(4, overdueByHours / 2) : hoursToDue !== null && hoursToDue <= 8 ? Math.max(0, (8 - hoursToDue) / 2.5) : 0;
  const slaRisk = slaBreachedByHours > 0 ? Math.min(3.6, slaBreachedByHours / 2.5) : hoursToSla !== null && hoursToSla <= 6 ? Math.max(0, (6 - hoursToSla) / 2.2) : 0;

  const riskScore = Number((priorityWeight * 1.8 + blockedPenalty + dueRisk + slaRisk).toFixed(2));

  const riskLevel = riskScore >= 10.5
    ? 'critical'
    : riskScore >= 8
      ? 'high'
      : riskScore >= 5.2
        ? 'medium'
        : 'low';

  const recommendedAction = status === 'blocked'
    ? 'Снять блокер и назначить владельца unblock-действия в течение 60 минут'
    : overdueByHours > 0
      ? 'Перепланировать и подтвердить новый ETA с клиентом сегодня'
      : slaBreachedByHours > 0
        ? 'Сразу отправить апдейт клиенту и зафиксировать компенсационный шаг'
        : riskLevel === 'high' || riskLevel === 'critical'
          ? 'Проверить статус задачи в ближайший стендап и выделить фокус-слот'
          : 'Продолжать по плану';

  return {
    hoursToDue: hoursToDue === null ? null : Number(hoursToDue.toFixed(2)),
    hoursToSla: hoursToSla === null ? null : Number(hoursToSla.toFixed(2)),
    overdueByHours: Number(overdueByHours.toFixed(2)),
    slaBreachedByHours: Number(slaBreachedByHours.toFixed(2)),
    riskScore,
    riskLevel,
    recommendedAction,
  };
}

function buildOpsExecutionSummary(tasks, deliverables) {
  const nowTs = Date.now();
  const normalizedTasks = (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task,
    urgency: computeOpsTaskUrgency(task, nowTs),
  }));

  const riskCounters = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const task of normalizedTasks) {
    const level = task?.urgency?.riskLevel;
    if (level && Object.prototype.hasOwnProperty.call(riskCounters, level)) {
      riskCounters[level] += 1;
    }
  }

  const focusQueue = [...normalizedTasks]
    .sort((a, b) => Number(b?.urgency?.riskScore || 0) - Number(a?.urgency?.riskScore || 0))
    .slice(0, 5)
    .map((task) => ({
      id: task.id,
      title: task.title,
      clientName: task.clientName,
      stage: task.stage,
      status: task.status,
      priority: task.priority,
      riskScore: task.urgency.riskScore,
      riskLevel: task.urgency.riskLevel,
      recommendedAction: task.urgency.recommendedAction,
    }));

  const stageCounters = {};
  for (const task of normalizedTasks) {
    const stage = String(task.stage || 'unknown');
    stageCounters[stage] = (stageCounters[stage] || 0) + 1;
  }

  return {
    tasks: normalizedTasks,
    summary: {
      totalTasks: normalizedTasks.length,
      blockedTasks: normalizedTasks.filter((task) => String(task.status || '').toLowerCase() === 'blocked').length,
      overdueTasks: normalizedTasks.filter((task) => (task?.urgency?.overdueByHours || 0) > 0).length,
      slaBreachedTasks: normalizedTasks.filter((task) => (task?.urgency?.slaBreachedByHours || 0) > 0).length,
      riskCounters,
      stageCounters,
      deliverablesInReview: (Array.isArray(deliverables) ? deliverables : []).filter((item) => String(item.status || '').toLowerCase() === 'in_review').length,
      focusQueue,
    },
  };
}

async function opsBoardHandler(req, res) {
  try {
    initOpsBoard();
    const payload = readJsonSafe(OPS_BOARD_FILE, { tasks: [], deliverables: [] });
    const stages = ['intake', 'scoping', 'activation', 'review', 'execution', 'update'];
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    const deliverables = Array.isArray(payload.deliverables) ? payload.deliverables : [];
    const enriched = buildOpsExecutionSummary(tasks, deliverables);

    return json(res, 200, {
      stages,
      tasks: enriched.tasks,
      deliverables,
      executionSummary: enriched.summary,
      sourceConnected: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, { error: 'ops-board-failed', message: error.message });
  }
}

async function opsBoardMoveStageHandler(req, res) {
  try {
    initOpsBoard();
    const body = await readBody(req);
    const taskId = Number(body.taskId);
    const toStage = String(body.toStage || '');
    const allowedStages = new Set(['intake', 'scoping', 'activation', 'review', 'execution', 'update']);

    if (Number.isNaN(taskId)) return json(res, 400, { error: 'taskId-required' });
    if (!allowedStages.has(toStage)) return json(res, 400, { error: 'invalid-stage' });

    const payload = readJsonSafe(OPS_BOARD_FILE, { tasks: [], deliverables: [] });
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    const idx = tasks.findIndex((t) => Number(t.id) === taskId);
    if (idx < 0) return json(res, 404, { error: 'task-not-found' });

    tasks[idx] = {
      ...tasks[idx],
      stage: toStage,
      status: tasks[idx].status === 'blocked' ? 'blocked' : 'open',
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      OPS_BOARD_FILE,
      JSON.stringify({
        tasks,
        deliverables: Array.isArray(payload.deliverables) ? payload.deliverables : [],
      }, null, 2),
      'utf8'
    );

    return json(res, 200, { ok: true, task: tasks[idx] });
  } catch (error) {
    return json(res, 500, { error: 'ops-board-move-stage-failed', message: error.message });
  }
}

async function opsBoardUpdateTaskHandler(req, res) {
  try {
    initOpsBoard();
    const body = await readBody(req);
    const taskId = Number(body.taskId);
    if (Number.isNaN(taskId)) return json(res, 400, { error: 'taskId-required' });

    const payload = readJsonSafe(OPS_BOARD_FILE, { tasks: [], deliverables: [] });
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    const idx = tasks.findIndex((t) => Number(t.id) === taskId);
    if (idx < 0) return json(res, 404, { error: 'task-not-found' });

    const allowedPriority = new Set(['low', 'medium', 'high', 'critical']);
    const nextPriority = body.priority && allowedPriority.has(String(body.priority)) ? String(body.priority) : tasks[idx].priority;

    const nextTags = Array.isArray(body.tags)
      ? body.tags.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 12)
      : Array.isArray(tasks[idx].tags)
        ? tasks[idx].tags
        : [];

    tasks[idx] = {
      ...tasks[idx],
      priority: nextPriority,
      tags: nextTags,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      OPS_BOARD_FILE,
      JSON.stringify({
        tasks,
        deliverables: Array.isArray(payload.deliverables) ? payload.deliverables : [],
      }, null, 2),
      'utf8'
    );

    return json(res, 200, { ok: true, task: tasks[idx] });
  } catch (error) {
    return json(res, 500, { error: 'ops-board-update-task-failed', message: error.message });
  }
}

async function opsArticlesHandler(req, res) {
  try {
    initOpsArticles();
    const payload = readJsonSafe(OPS_ARTICLES_FILE, { items: [] });
    const items = Array.isArray(payload.items) ? payload.items : [];

    return json(res, 200, {
      items,
      sourceConnected: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, { error: 'ops-articles-failed', message: error.message });
  }
}

async function opsDocsHandler(req, res, url) {
  try {
    if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
    const files = fs.readdirSync(DOCS_DIR).filter((f) => f.toLowerCase().endsWith('.md')).sort((a, b) => a.localeCompare(b));
    const requested = url.searchParams.get('file');
    const selectedFile = files.includes(requested) ? requested : files[0] || null;
    const content = selectedFile ? fs.readFileSync(path.join(DOCS_DIR, selectedFile), 'utf8') : '';

    return json(res, 200, {
      items: files.map((file) => ({ file, title: file.replace(/\.md$/i, '') })),
      selectedFile,
      content,
      sourceConnected: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, { error: 'ops-docs-failed', message: error.message });
  }
}

async function opsWorkspacesHandler(req, res, url) {
  try {
    const workspaceName = url.searchParams.get('workspace') || 'steve';
    const fileRel = url.searchParams.get('file');

    const workspaces = [
      {
        id: 'steve',
        title: 'Steve Workspace',
        root: WORKSPACE_ROOT,
        files: ['SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'MEMORY.md', 'HEARTBEAT.md'],
      },
    ];

    const selectedWorkspace = workspaces.find((w) => w.id === workspaceName) || workspaces[0];
    const selectedRel = selectedWorkspace.files.includes(fileRel) ? fileRel : selectedWorkspace.files[0];
    const abs = path.join(selectedWorkspace.root, selectedRel);
    const content = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';

    return json(res, 200, {
      workspaces: workspaces.map((w) => ({ id: w.id, title: w.title, files: w.files })),
      selectedWorkspace: selectedWorkspace.id,
      selectedFile: selectedRel,
      content,
      sourceConnected: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, { error: 'ops-workspaces-failed', message: error.message });
  }
}

async function sessionHistoryHandler(req, res, url) {
  try {
    const sessionKey = url.searchParams.get('sessionKey');
    if (!sessionKey) return json(res, 400, { error: 'sessionKey-required' });

    const sessionsRaw = readJson(SESSIONS_FILE);
    const session = sessionsRaw?.[sessionKey];
    if (!session) return json(res, 404, { error: 'session-not-found', sessionKey });

    const sessionFileFromMeta = session.sessionFile;
    const fallbackById = session?.sessionId ? path.join(SESSIONS_DIR, `${session.sessionId}.jsonl`) : null;
    const sessionFile =
      (sessionFileFromMeta && fs.existsSync(sessionFileFromMeta) && sessionFileFromMeta) ||
      (fallbackById && fs.existsSync(fallbackById) && fallbackById) ||
      null;

    if (!sessionFile) {
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

  if (url.pathname === '/api/brain/directory') {
    return brainDirectoryHandler(req, res);
  }

  if (url.pathname === '/api/research/langsearch' && req.method === 'POST') {
    return langSearchHandler(req, res);
  }

  if (url.pathname === '/api/automation') {
    return automationHandler(req, res);
  }

  if (url.pathname === '/api/automation/update' && req.method === 'POST') {
    return automationUpdateHandler(req, res);
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

  if (url.pathname === '/api/ops/board') {
    return opsBoardHandler(req, res);
  }

  if (url.pathname === '/api/ops/board/move-stage' && req.method === 'POST') {
    return opsBoardMoveStageHandler(req, res);
  }

  if (url.pathname === '/api/ops/board/update-task' && req.method === 'POST') {
    return opsBoardUpdateTaskHandler(req, res);
  }

  if (url.pathname === '/api/ops/articles') {
    return opsArticlesHandler(req, res);
  }

  if (url.pathname === '/api/ops/docs') {
    return opsDocsHandler(req, res, url);
  }

  if (url.pathname === '/api/ops/workspaces') {
    return opsWorkspacesHandler(req, res, url);
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
