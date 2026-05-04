/**
 * ============================================================================
 * ADMIN.JS — Painel God Mode Admin v2.3
 * ----------------------------------------------------------------------------
 * Frontend Admin — GitHub Pages + Apps Script backend
 *
 * Features:
 * [GM-03] Auth Guard admin
 * [GM-04] Logs ABERTO/RESOLVIDO
 * [GM-06] MTTR
 * [GM-07] Telegram backend-ready
 * [GM-08] Filtro temporal
 * [GM-09] Export CSV/PDF
 * [GM-10] RBAC-ready
 * Heatmap, auto-refresh, shortcuts, Capacity, Quotas, Product Insights,
 * Novo Cliente, Migration Readiness, Firebase migration action-ready.
 *
 * IMPORTANTE:
 * - Este arquivo é frontend.
 * - NÃO colocar SpreadsheetApp, PropertiesService, DriveApp ou UrlFetchApp aqui.
 * - Backend fica em Code.gs.
 * ============================================================================
 */

import {
  SCRIPT_URL,
  API_KEY,
  STORAGE_KEYS,
  ROUTES,
  REFRESH_INTERVAL_MS,
  THEME_DEFAULT
} from './config.js';

import {
  requireAuth,
  validateSessionOnBoot,
  getUserContext
} from './auth.js';

import {
  relativeTime,
  formatDate,
  truncate,
  escapeHtml,
  initials,
  gradientFromString,
  debounce,
  formatNumber,
  slugify
} from './utils.js';

import { matchKB } from './kb.js';
import { toastSuccess, toastError } from './ui-shared.js';

// ============================================================================
// 1. CONFIG LOCAL
// ============================================================================

const ADMIN_CONFIG = {
  LIMIT: 500,
  AUTO_REFRESH_MS: REFRESH_INTERVAL_MS || 60000,
  FETCH_TIMEOUT_MS: 20000,
  SEARCH_DEBOUNCE_MS: 180,
  LOCAL_TICK_MS: 30000,
  MAX_RENDERED_EVENTS: 120,
  DEFAULT_TIME_RANGE: '24h',
  PRODUCT_INSIGHTS_CACHE_MS: 30000
};

const APP_LABELS = {
  ponto: 'Ponto Digital',
  estoque: 'Estoque',
  pdv: 'PDV',
  outro: 'Outro'
};

const CAP_STATUS_ORDER = [
  'CRITICO',
  'ALERTA',
  'ATENCAO',
  'OFFLINE',
  'PENDING',
  'SAUDAVEL',
  'MIGRADO'
];

const CSV_HEADERS = {
  logs: [
    'timestamp',
    'tipoLog',
    'status',
    'idCliente',
    'aplicativo',
    'usuario',
    'dispositivo',
    'mensagemErro'
  ],
  auth: [
    'timestamp',
    'tipoEvento',
    'idCliente',
    'aplicativo',
    'usuario',
    'dispositivo',
    'detalhes',
    'ip'
  ],
  sessions: [
    'inicioSessao',
    'ultimoPing',
    'idCliente',
    'aplicativo',
    'usuario',
    'dispositivo',
    'ip'
  ]
};

const _MS_24H = 24 * 60 * 60 * 1000;

// ============================================================================
// 2. STATE
// ============================================================================

const state = {
  clientes: [],
  logs: [],
  eventosAuth: [],
  sessoesAtivas: [],
  saudeApps: [],
  totais: null,
  operacionais: null,
  geradoEm: null,

  filtroClienteId: '',
  activeTab: 'logs',
  isLoading: false,
  error: null,

  ui: {
    search: '',
    timeRange: ADMIN_CONFIG.DEFAULT_TIME_RANGE,
    severity: {
      ERRO: true,
      ALERTA: true,
      INFO: true
    },
    theme: 'light',
    capacityOpen: false,
    detailOpen: false,
    detailContext: null,
    productInsightsOpen: false,
    quotaMonitorOpen: false
  },

  user: {
    usuario: null,
    nivel: null,
    escopo: '*',
    role: 'admin'
  },

  productInsights: {
    data: null,
    loadedAt: 0,
    loading: false,
    error: null
  }
};

// Compat legado caso algum trecho antigo leia state.uiui.
state.uiui = state.ui;

// ============================================================================
// 3. DOM REFS
// ============================================================================

const dom = {
  loggedUserDisplay: document.getElementById('userMenu'),
  logoutBtn: document.getElementById('logoutBtn'),

  clientList: document.getElementById('clientList'),
  logsList: document.getElementById('eventsList'),
  logsMeta: document.getElementById('eventsMeta'),
  mainTitle: document.getElementById('topbarTitle'),
  mainSubtitle: document.getElementById('topbarSubtitle'),
  refreshBtn: document.getElementById('refreshBtn'),
  connectionStatus: document.getElementById('systemStatus'),

  liveStripList: document.getElementById('liveStripList'),
  liveStripMeta: document.getElementById('liveStripMeta'),

  eventTabs: document.getElementById('tabsContainer'),
  tabCounts: {
    logs: document.getElementById('tabCountLogs'),
    auth: document.getElementById('tabCountAuth'),
    sessions: document.getElementById('tabCountSessions')
  },

  kpiMain: {
    clientes: document.getElementById('kpiClientes'),
    online: document.getElementById('kpiOnline'),
    erros24h: document.getElementById('kpiErros24h'),
    auth24h: document.getElementById('kpiAuth24h')
  },

  kpiOps: {
    taxaErro: document.getElementById('kpiTaxaErro'),
    loginsFalhos: document.getElementById('kpiLoginsFalhos'),
    appsMonitorados: document.getElementById('kpiAppsMonitorados'),
    totalLogs: document.getElementById('kpiTotalLogs')
  },

  searchInput: document.getElementById('searchInput'),
  searchClearBtn: document.getElementById('searchClear'),
  severityPills: document.getElementById('severityPills'),
  pillCountErro: document.getElementById('pillCountErro'),
  pillCountAlerta: document.getElementById('pillCountAlerta'),
  pillCountInfo: document.getElementById('pillCountInfo'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  exportPdfBtn: document.getElementById('exportPdfBtn'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  timeFilterSelect: document.getElementById('timeRangeSelect'),

  capacityBtn: document.getElementById('capacityBtn'),
  capacityBadge: document.getElementById('capacityBadge'),
  capacityDrawer: document.getElementById('capacityDrawer'),
  capacitySummary: document.getElementById('capacityDrawerSummary'),
  capacityList: document.getElementById('capacityDrawerBody'),
  capacityMeta: document.getElementById('capacityDrawerMeta'),

  detailDrawer: document.getElementById('detailDrawer'),
  detailDrawerTitle: document.getElementById('detailDrawerTitle'),
  detailDrawerBody: document.getElementById('detailDrawerBody'),
  detailCopyBtn: document.getElementById('detailDrawerCopyBtn')
};

// Compat legado.
dom.kpi = {
  total: dom.kpiOps.totalLogs,
  erros: dom.kpiMain.erros24h,
  alertas: null,
  infos: null,
  mttr: null
};

// ============================================================================
// 4. HELPERS SEGUROS
// ============================================================================

function safeText(v, fallback = '—') {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
}

function safeEscape(v) {
  try {
    return escapeHtml(v ?? '');
  } catch (_) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

function safeRelativeTime(v) {
  try {
    return relativeTime(v);
  } catch (_) {
    return '—';
  }
}

function safeFormatNumber(v) {
  try {
    return formatNumber(Number(v) || 0);
  } catch (_) {
    return String(Number(v) || 0);
  }
}

function safeTruncate(v, n = 160) {
  try {
    return truncate(String(v ?? ''), n);
  } catch (_) {
    const s = String(v ?? '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
}

function contains(field, q) {
  if (field === null || field === undefined) return false;
  return String(field).toLowerCase().includes(String(q || '').toLowerCase());
}

function isTruthy(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').toLowerCase().trim();
  return ['true', '1', 'sim', 's', 'ativo', 'active'].includes(s);
}

function normalizeAction(action) {
  return String(action || '').trim().toLowerCase();
}

function normalizeAppValue(app) {
  const raw = String(app || '').trim().toLowerCase();

  if (!raw) return '';
  if (raw.includes('ponto')) return 'ponto';
  if (raw.includes('estoque')) return 'estoque';
  if (raw.includes('pdv')) return 'pdv';

  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '');
}

function getAppLabel(app) {
  const key = normalizeAppValue(app);
  return APP_LABELS[key] || safeText(app, 'App');
}

function maskCnpj(value) {
  const d = String(value || '').replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function maskCpfCnpj(value) {
  const d = String(value || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.***.***-$4');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.***.***/$4-$5');
  return value || '';
}

function validarCnpj(cnpj) {
  const d = String(cnpj || '').replace(/\D/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  let t = d.length - 2;
  let n = d.substring(0, t);
  let v = d.substring(t);
  let s = 0;
  let p = t - 7;

  for (let i = t; i >= 1; i--) {
    s += Number(n.charAt(t - i)) * p--;
    if (p < 2) p = 9;
  }

  let r = s % 11 < 2 ? 0 : 11 - (s % 11);
  if (r !== Number(v.charAt(0))) return false;

  t += 1;
  n = d.substring(0, t);
  s = 0;
  p = t - 7;

  for (let i = t; i >= 1; i--) {
    s += Number(n.charAt(t - i)) * p--;
    if (p < 2) p = 9;
  }

  r = s % 11 < 2 ? 0 : 11 - (s % 11);
  return r === Number(v.charAt(1));
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
}

function _isWithin24h(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= _MS_24H;
}

function formatDuration(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const sec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (sec < 60) return `${sec}s`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min`;

  const hr = Math.floor(min / 60);
  const restoMin = min % 60;
  if (hr < 24) return restoMin ? `${hr}h${restoMin}min` : `${hr}h`;

  const d = Math.floor(hr / 24);
  return `${d}d`;
}

function formatAbsoluteTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function getToken() {
  try {
    return localStorage.getItem(STORAGE_KEYS.TOKEN) || '';
  } catch (_) {
    return '';
  }
}

function getNomeCliente(id) {
  if (!id) return 'Todos os Clientes';

  const c = state.clientes.find(cli => String(cli.idCliente) === String(id));
  if (!c) return String(id);

  return (
    c.nomeFantasia ||
    c.nomeCliente ||
    c.nome ||
    c.razaoSocial ||
    c.idCliente ||
    String(id)
  );
}

function getClienteById(id) {
  if (!id) return null;
  return state.clientes.find(c => String(c.idCliente) === String(id)) || null;
}

function getTopbarActionsContainer() {
  return (
    document.querySelector('.topbar__actions') ||
    document.querySelector('.topbar-actions') ||
    document.querySelector('.header-actions') ||
    dom.refreshBtn?.parentElement ||
    document.body
  );
}

function showFatalBootError(err) {
  document.body.classList.add('pronto');

  const old = document.getElementById('godmodeBootError');
  if (old) old.remove();

  const box = document.createElement('div');
  box.id = 'godmodeBootError';
  box.style.cssText = `
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 16px;
    z-index: 99999;
    background: #991b1b;
    color: #fff;
    padding: 16px;
    border-radius: 14px;
    font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-shadow: 0 20px 50px rgba(0,0,0,.28);
    white-space: pre-wrap;
    max-height: 45vh;
    overflow: auto;
  `;

  box.textContent =
    'Erro ao iniciar God Mode Admin:\n\n' +
    (err && err.stack ? err.stack : err && err.message ? err.message : String(err));

  document.body.appendChild(box);
}

function safeToastSuccess(msg) {
  try {
    toastSuccess(msg);
  } catch (_) {
    console.info('[GodMode]', msg);
  }
}

function safeToastError(msg) {
  try {
    toastError(msg);
  } catch (_) {
    console.error('[GodMode]', msg);
  }
}

// ============================================================================
// 5. API LAYER
// ============================================================================

async function fetchDashboardData() {
  const token = getToken();
  const escopo = state.user.escopo || '*';

  const url =
    `${SCRIPT_URL}?apiKey=${encodeURIComponent(API_KEY)}` +
    `&token=${encodeURIComponent(token)}` +
    `&limit=${encodeURIComponent(ADMIN_CONFIG.LIMIT)}` +
    `&idClienteVinculado=${encodeURIComponent(escopo)}`;

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), ADMIN_CONFIG.FETCH_TIMEOUT_MS);

  let resp;

  try {
    resp = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: ctrl.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      throw new Error(`Tempo de resposta excedido (${ADMIN_CONFIG.FETCH_TIMEOUT_MS / 1000}s).`);
    }

    throw new Error('Falha de rede ou CORS. Verifique deploy do Apps Script.');
  }

  clearTimeout(timeoutId);

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const raw = await resp.text();
  let json;

  try {
    json = JSON.parse(raw);
  } catch (_) {
    if (raw.includes('<!DOCTYPE') || raw.includes('accounts.google.com')) {
      throw new Error('Apps Script exigiu login. Reimplante como "Qualquer pessoa".');
    }
    throw new Error('Resposta inválida do servidor.');
  }

  if (json.error === 'Sessão inválida ou expirada') {
    forceLogout();
    return null;
  }

  if (!json.ok) {
    throw new Error(json.error || 'Resposta inválida do servidor.');
  }

  return json.data || {};
}

async function adminApiPost(action, payload = {}) {
  const token = getToken();
  const safeAction = normalizeAction(action);

  const resp = await fetch(SCRIPT_URL, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({
      apiKey: API_KEY,
      token,
      ...payload,
      action: safeAction
    })
  });

  const raw = await resp.text();

  let json;
  try {
    json = JSON.parse(raw);
  } catch (_) {
    if (raw.includes('<!DOCTYPE') || raw.includes('accounts.google.com')) {
      throw new Error('Apps Script exigiu login. Reimplante como "Qualquer pessoa".');
    }
    throw new Error('Resposta inválida do servidor.');
  }

  if (json.error === 'Sessão inválida ou expirada') {
    forceLogout();
    return null;
  }

  if (!json.ok) {
    throw new Error(json.error || 'Falha na operação.');
  }

  return json.data || {};
}

function forceLogout() {
  try {
    Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
  } catch (_) {}

  window.location.replace(ROUTES.LOGIN || './login.html');
}

// ============================================================================
// 6. STATE MUTATIONS
// ============================================================================

function setLoading(isLoading) {
  state.isLoading = Boolean(isLoading);
  updateConnectionStatus();
  updateRefreshButton();
}

function setError(error) {
  state.error = error || null;
  updateConnectionStatus();
}

function setData(data = {}) {
  state.clientes = Array.isArray(data.clientes) ? data.clientes : [];
  state.logs = Array.isArray(data.logs) ? data.logs : [];
  state.eventosAuth = Array.isArray(data.eventosAuth) ? data.eventosAuth : [];
  state.sessoesAtivas = Array.isArray(data.sessoesAtivas) ? data.sessoesAtivas : [];
  state.saudeApps = Array.isArray(data.saudeApps) ? data.saudeApps : [];

  state.totais = data.totais || null;
  state.operacionais = data.operacionais || null;
  state.geradoEm = data.geradoEm || new Date().toISOString();
  state.error = null;
}

function setFilter(clienteId) {
  state.filtroClienteId = clienteId || '';
  renderSidebar();
  renderMain();
}

export function setActiveTab(tab) {
  if (!['logs', 'auth', 'sessions'].includes(tab)) return;

  state.activeTab = tab;
  renderTabs();
  renderToolbarVisibility();
  renderEventsList();
  renderHeader();
}

export function setSearch(query) {
  const norm = String(query || '').toLowerCase().trim();

  if (norm === state.ui.search) return;

  state.ui.search = norm;
  renderSearchClearVisibility();
  renderEventsList();
  renderHeader();
}

export function toggleSeverity(sev) {
  const key = String(sev || '').toUpperCase();

  if (!(key in state.ui.severity)) return;

  state.ui.severity[key] = !state.ui.severity[key];
  renderSeverityPills();
  renderEventsList();
  renderHeader();
}

function setTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';

  if (state.ui.theme === next) return;

  state.ui.theme = next;
  applyTheme(next, true);

  try {
    localStorage.setItem(STORAGE_KEYS.THEME, next);
  } catch (_) {}
}

function setCapacityOpen(open) {
  state.ui.capacityOpen = Boolean(open);
  renderCapacityDrawer();
}

// ============================================================================
// 7. SELECTORS
// ============================================================================

function getLogsFiltradosCliente() {
  if (!state.filtroClienteId) return state.logs;
  return state.logs.filter(l => String(l.idCliente) === String(state.filtroClienteId));
}

function getAuthFiltradosCliente() {
  if (!state.filtroClienteId) return state.eventosAuth;
  return state.eventosAuth.filter(a => String(a.idCliente) === String(state.filtroClienteId));
}

function getSessoesFiltradasCliente() {
  if (!state.filtroClienteId) return state.sessoesAtivas;
  return state.sessoesAtivas.filter(s => String(s.idCliente) === String(state.filtroClienteId));
}

function calcularKPIsLogs(logs) {
  const r = {
    total: logs.length,
    erros: 0,
    alertas: 0,
    infos: 0
  };

  for (const l of logs) {
    const t = String(l.tipoLog || '').toUpperCase();

    if (t === 'ERRO') r.erros++;
    else if (t === 'ALERTA') r.alertas++;
    else if (t === 'INFO') r.infos++;
  }

  return r;
}

function calcularMTTR(logs) {
  const resolvidos = logs.filter(l => String(l.status || '').toUpperCase() === 'RESOLVIDO');

  if (!resolvidos.length) return null;

  let totalMs = 0;
  let validCount = 0;

  for (const l of resolvidos) {
    const criadoEm = new Date(l.timestamp).getTime();

    if (Number.isNaN(criadoEm)) continue;

    const historico = String(l.historico || '');
    let resolvidoEm = null;

    const linhasHist = historico.split('\n');
    const linhaRes = linhasHist.find(x => /RESOLVIDO/i.test(x));

    if (linhaRes) {
      const match = linhaRes.match(/\[(.*?)\]/);

      if (match && match[1]) {
        const strLimpa = match[1].replace(',', '');
        const partes = strLimpa.split(' ');

        if (partes.length >= 2) {
          const [d, m, y] = partes[0].split('/');
          const [hora, min, sec] = partes[1].split(':');
          const ts = new Date(y, Number(m) - 1, d, hora, min, sec || 0).getTime();

          if (!Number.isNaN(ts)) resolvidoEm = ts;
        }
      }
    }

    if (!resolvidoEm && l.resolvidoEm) {
      const ts = new Date(l.resolvidoEm).getTime();
      if (!Number.isNaN(ts)) resolvidoEm = ts;
    }

    if (resolvidoEm && resolvidoEm >= criadoEm) {
      totalMs += resolvidoEm - criadoEm;
      validCount++;
    }
  }

  if (!validCount) return null;

  const mediaMs = totalMs / validCount;
  const minM = Math.floor(mediaMs / 60000);

  if (minM < 60) return `${minM}m`;

  const hrM = Math.floor(minM / 60);
  const restoMin = minM % 60;

  if (hrM < 24) return restoMin ? `${hrM}h ${restoMin}m` : `${hrM}h`;

  const diasM = Math.floor(hrM / 24);
  const restoHr = hrM % 24;

  return restoHr ? `${diasM}d ${restoHr}h` : `${diasM}d`;
}

function contarErrosAbertosPorCliente() {
  const map = new Map();
  let totalErros = 0;

  for (const l of state.logs) {
    const id = String(l.idCliente || '');
    const isErro = String(l.tipoLog || '').toUpperCase() === 'ERRO';
    const isAberto = String(l.status || 'ABERTO').toUpperCase() !== 'RESOLVIDO';

    if (!map.has(id)) map.set(id, 0);

    if (isErro && isAberto) {
      map.set(id, map.get(id) + 1);
      totalErros++;
    }
  }

  return { map, totalErros };
}

function applySeverityFilter(logs) {
  const sev = state.ui.severity;

  if (sev.ERRO && sev.ALERTA && sev.INFO) return logs;

  return logs.filter(l => {
    const t = String(l.tipoLog || '').toUpperCase();

    if (t === 'ERRO') return sev.ERRO;
    if (t === 'ALERTA') return sev.ALERTA;
    if (t === 'INFO') return sev.INFO;

    return true;
  });
}

function applySearchFilter(items, kind) {
  const q = state.ui.search;

  if (!q) return items;

  if (kind === 'logs') {
    return items.filter(l =>
      contains(l.aplicativo, q) ||
      contains(l.usuario, q) ||
      contains(l.dispositivo, q) ||
      contains(l.mensagemErro, q) ||
      contains(l.tipoLog, q) ||
      contains(l.status, q) ||
      contains(getNomeCliente(l.idCliente), q)
    );
  }

  if (kind === 'auth') {
    return items.filter(a =>
      contains(a.aplicativo, q) ||
      contains(a.usuario, q) ||
      contains(a.dispositivo, q) ||
      contains(a.tipoEvento, q) ||
      contains(a.detalhes, q) ||
      contains(getNomeCliente(a.idCliente), q)
    );
  }

  return items.filter(s =>
    contains(s.aplicativo, q) ||
    contains(s.usuario, q) ||
    contains(s.dispositivo, q) ||
    contains(getNomeCliente(s.idCliente), q)
  );
}

function applyTimeFilter(items) {
  if (state.ui.timeRange === 'all') return items;

  const agora = Date.now();
  let limiteMs = 0;

  if (state.ui.timeRange === '1h') limiteMs = 1 * 60 * 60 * 1000;
  if (state.ui.timeRange === '24h') limiteMs = 24 * 60 * 60 * 1000;
  if (state.ui.timeRange === '7d') limiteMs = 7 * 24 * 60 * 60 * 1000;
  if (state.ui.timeRange === '30d') limiteMs = 30 * 24 * 60 * 60 * 1000;

  if (!limiteMs) return items;

  const dataCorte = agora - limiteMs;

  return items.filter(item => {
    const dataStr = item.timestamp || item.inicioSessao || item.ultimoPing;
    if (!dataStr) return true;

    const ts = new Date(dataStr).getTime();
    if (Number.isNaN(ts)) return true;

    return ts >= dataCorte;
  });
}

function getEventsForActiveTab() {
  if (state.activeTab === 'auth') {
    const auth = getAuthFiltradosCliente();
    return applySearchFilter(applyTimeFilter(auth), 'auth');
  }

  if (state.activeTab === 'sessions') {
    const ses = getSessoesFiltradasCliente();
    return applySearchFilter(applyTimeFilter(ses), 'sessions');
  }

  const logs = getLogsFiltradosCliente();
  return applySearchFilter(applyTimeFilter(applySeverityFilter(logs)), 'logs');
}

function contarSaudeAlertas() {
  let n = 0;

  for (const a of state.saudeApps) {
    const st = String(a.status || '').toUpperCase();

    if (st === 'CRITICO' || st === 'ALERTA' || st === 'OFFLINE') {
      n++;
    }
  }

  return n;
}

function isAnyExtraFilterActive() {
  if (state.ui.search) return true;
  if (state.ui.timeRange !== 'all') return true;

  if (state.activeTab === 'logs') {
    const s = state.ui.severity;
    if (!(s.ERRO && s.ALERTA && s.INFO)) return true;
  }

  return false;
}

function computeKPIs() {
  const totais = state.totais || {};
  const operacionais = state.operacionais || {};
  const filtroAtivo = Boolean(state.filtroClienteId);

  if (!filtroAtivo) {
    return {
      clientes: Number(totais.clientes ?? state.clientes.length) || 0,
      online: Number(operacionais.appsMonitorados ?? state.sessoesAtivas.length) || state.sessoesAtivas.length,
      erros24h: Number(totais.erros24h ?? operacionais.erros24h ?? 0),
      auth24h: Number(totais.autenticacoes24h ?? 0),
      taxaErro: Number(operacionais.taxaErro ?? 0),
      loginsFalhos24h: Number(operacionais.loginsFalhos24h ?? 0),
      appsMonitorados: Number(operacionais.appsMonitorados ?? state.saudeApps.length) || state.saudeApps.length,
      totalLogs: Number(totais.logs ?? state.logs.length) || state.logs.length
    };
  }

  const cid = String(state.filtroClienteId);

  const logsCli = state.logs.filter(l => String(l.idCliente) === cid);
  const authCli = state.eventosAuth.filter(a => String(a.idCliente) === cid);
  const sessCli = state.sessoesAtivas.filter(s => String(s.idCliente) === cid);
  const appsCli = state.saudeApps.filter(a => String(a.idCliente) === cid);

  const logs24h = logsCli.filter(l => _isWithin24h(l.timestamp));
  const erros24h = logs24h.filter(l => String(l.tipoLog || '').toUpperCase() === 'ERRO').length;
  const auth24h = authCli.filter(a => _isWithin24h(a.timestamp)).length;

  const loginsFalhos24h = authCli.filter(a =>
    _isWithin24h(a.timestamp) &&
    String(a.tipoEvento || '').toUpperCase().includes('FALHA')
  ).length;

  const taxaErro = logs24h.length > 0 ? (erros24h / logs24h.length) * 100 : 0;

  return {
    clientes: 1,
    online: sessCli.length,
    erros24h,
    auth24h,
    taxaErro,
    loginsFalhos24h,
    appsMonitorados: appsCli.length,
    totalLogs: logsCli.length
  };
}

// ============================================================================
// 8. RENDER PRINCIPAL
// ============================================================================

function renderSidebar() {
  const ul = dom.clientList;
  if (!ul) return;

  ul.textContent = '';

  const { map: contagensErros, totalErros } = contarErrosAbertosPorCliente();
  const ativoId = state.filtroClienteId;

  ul.appendChild(buildClientItem({
    id: '',
    nome: 'Todos os Clientes',
    count: totalErros,
    ativo: ativoId === '',
    modificador: 'client-item--all'
  }));

  if (!state.clientes.length) {
    const li = document.createElement('li');
    li.className = 'client-list__placeholder';
    li.textContent = 'Nenhum cliente cadastrado.';
    ul.appendChild(li);
    return;
  }

  for (const c of state.clientes) {
    const id = String(c.idCliente || '');

    ul.appendChild(buildClientItem({
      id,
      nome: getNomeCliente(id),
      count: contagensErros.get(id) || 0,
      ativo: ativoId === id
    }));
  }
}

function buildClientItem({ id, nome, count, ativo, modificador }) {
  const li = document.createElement('li');
  const btn = document.createElement('button');

  btn.type = 'button';
  btn.className =
    'client-item' +
    (ativo ? ' client-item--active' : '') +
    (modificador ? ' ' + modificador : '');

  btn.dataset.clientId = id;
  btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');

  const nameEl = document.createElement('span');
  nameEl.className = 'client-item__name';
  nameEl.textContent = nome;

  const countEl = document.createElement('span');
  countEl.className = 'client-item__count';

  if (count > 0) {
    countEl.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    countEl.style.color = '#EF4444';
    countEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
    countEl.style.fontWeight = 'bold';
  }

  countEl.textContent = count;

  btn.appendChild(nameEl);
  btn.appendChild(countEl);
  li.appendChild(btn);

  return li;
}

function renderMain() {
  renderHeader();
  renderKPIsMain();
  renderKPIsOps();
  renderLiveStrip();
  renderTabs();
  renderToolbarVisibility();
  renderSeverityPills();
  renderSearchClearVisibility();
  renderEventsList();
  renderCapacityBadge();

  if (state.ui.capacityOpen) {
    renderCapacityDrawer();
  }
}

function renderHeader() {
  const filtrando = Boolean(state.filtroClienteId);
  const nome = getNomeCliente(state.filtroClienteId);

  if (dom.mainTitle) {
    dom.mainTitle.textContent = filtrando ? nome : 'Central de Desenvolvedor';
  }

  if (dom.mainSubtitle) {
    dom.mainSubtitle.textContent = filtrando
      ? `Telemetria isolada do cliente ${nome}`
      : 'God Mode';
  }

  const ts = state.geradoEm ? `· atualizado ${safeRelativeTime(state.geradoEm)}` : '';
  const total = getEventsForActiveTab().length;
  const filtroAtivo = isAnyExtraFilterActive() ? ' filtrado(s)' : '';

  if (dom.logsMeta) {
    dom.logsMeta.textContent = `${safeFormatNumber(total)} evento(s)${filtroAtivo} ${ts}`;
  }
}

function _formatTaxaErro(n) {
  if (!Number.isFinite(n)) return '—';
  if (typeof n === 'string') return n;
  if (n === 0) return '0%';
  if (n < 1) return n.toFixed(2) + '%';
  if (n < 10) return n.toFixed(1) + '%';
  return Math.round(n) + '%';
}

function renderKPIsMain() {
  const k = computeKPIs();

  if (dom.kpiMain.clientes) dom.kpiMain.clientes.textContent = safeFormatNumber(k.clientes);
  if (dom.kpiMain.online) dom.kpiMain.online.textContent = safeFormatNumber(k.online);
  if (dom.kpiMain.erros24h) dom.kpiMain.erros24h.textContent = safeFormatNumber(k.erros24h);
  if (dom.kpiMain.auth24h) dom.kpiMain.auth24h.textContent = safeFormatNumber(k.auth24h);
}

function renderKPIsOps() {
  const k = computeKPIs();

  if (dom.kpiOps.taxaErro) dom.kpiOps.taxaErro.textContent = _formatTaxaErro(k.taxaErro);
  if (dom.kpiOps.loginsFalhos) dom.kpiOps.loginsFalhos.textContent = safeFormatNumber(k.loginsFalhos24h);
  if (dom.kpiOps.appsMonitorados) dom.kpiOps.appsMonitorados.textContent = safeFormatNumber(k.appsMonitorados);
  if (dom.kpiOps.totalLogs) dom.kpiOps.totalLogs.textContent = safeFormatNumber(k.totalLogs);

  const mttr = calcularMTTR(state.filtroClienteId ? getLogsFiltradosCliente() : state.logs);
  if (dom.kpiOps.totalLogs) {
    dom.kpiOps.totalLogs.title = `MTTR: ${mttr || 'N/A'}`;
  }
}

// ============================================================================
// 9. LIVE STRIP
// ============================================================================

function renderLiveStrip() {
  const list = dom.liveStripList;
  if (!list) return;

  list.textContent = '';

  const sessoes = state.filtroClienteId
    ? state.sessoesAtivas.filter(s => String(s.idCliente) === String(state.filtroClienteId))
    : state.sessoesAtivas;

  if (!sessoes.length) {
    list.dataset.empty = 'true';

    if (dom.liveStripMeta) {
      dom.liveStripMeta.textContent = '0 ativos';
    }

    return;
  }

  delete list.dataset.empty;

  if (dom.liveStripMeta) {
    dom.liveStripMeta.textContent = `${sessoes.length} ${sessoes.length === 1 ? 'ativo' : 'ativos'}`;
  }

  const frag = document.createDocumentFragment();

  for (const s of sessoes.slice(0, 30)) {
    frag.appendChild(buildLiveChip(s));
  }

  list.appendChild(frag);
}

function buildLiveChip(sessao) {
  const chip = document.createElement('div');
  chip.className = 'live-chip';
  chip.setAttribute('role', 'listitem');

  chip.title =
    `Usuário: ${safeText(sessao.usuario)}\n` +
    `App: ${safeText(sessao.aplicativo)}\n` +
    `Cliente: ${getNomeCliente(sessao.idCliente)}\n` +
    `Dispositivo: ${safeText(sessao.dispositivo)}\n` +
    `Online há: ${formatDuration(sessao.inicioSessao)}`;

  const avatar = document.createElement('div');
  avatar.className = 'live-chip__avatar';
  avatar.textContent = initials(sessao.usuario || '?');
  avatar.style.background = gradientFromString(sessao.usuario || 'user');

  const body = document.createElement('div');
  body.className = 'live-chip__body';

  const name = document.createElement('span');
  name.className = 'live-chip__name';
  name.textContent = sessao.usuario || '—';

  const sub = document.createElement('span');
  sub.className = 'live-chip__sub';
  sub.textContent = `${safeText(sessao.aplicativo)} · há ${formatDuration(sessao.inicioSessao)}`;

  body.appendChild(name);
  body.appendChild(sub);
  chip.appendChild(avatar);
  chip.appendChild(body);

  return chip;
}

// ============================================================================
// 10. TABS / TOOLBAR
// ============================================================================

function renderTabs() {
  const counts = {
    logs: getLogsFiltradosCliente().length,
    auth: getAuthFiltradosCliente().length,
    sessions: getSessoesFiltradasCliente().length
  };

  if (dom.tabCounts.logs) dom.tabCounts.logs.textContent = safeFormatNumber(counts.logs);
  if (dom.tabCounts.auth) dom.tabCounts.auth.textContent = safeFormatNumber(counts.auth);
  if (dom.tabCounts.sessions) dom.tabCounts.sessions.textContent = safeFormatNumber(counts.sessions);

  if (!dom.eventTabs) return;

  const buttons = dom.eventTabs.querySelectorAll('.tab');

  buttons.forEach(btn => {
    const isActive = btn.dataset.tab === state.activeTab;
    btn.classList.toggle('tab--active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function renderToolbarVisibility() {
  if (dom.severityPills) {
    dom.severityPills.hidden = state.activeTab !== 'logs';
  }

  if (dom.searchInput) {
    const placeholders = {
      logs: 'Buscar em mensagens, apps, usuários…',
      auth: 'Buscar em eventos, usuários, apps…',
      sessions: 'Buscar em sessões, usuários, dispositivos…'
    };

    dom.searchInput.placeholder = placeholders[state.activeTab] || 'Buscar…';
  }
}

function renderSeverityPills() {
  if (!dom.severityPills) return;

  const logs = getLogsFiltradosCliente();
  const counts = {
    ERRO: 0,
    ALERTA: 0,
    INFO: 0
  };

  for (const l of logs) {
    const t = String(l.tipoLog || '').toUpperCase();
    if (t in counts) counts[t]++;
  }

  if (dom.pillCountErro) dom.pillCountErro.textContent = safeFormatNumber(counts.ERRO);
  if (dom.pillCountAlerta) dom.pillCountAlerta.textContent = safeFormatNumber(counts.ALERTA);
  if (dom.pillCountInfo) dom.pillCountInfo.textContent = safeFormatNumber(counts.INFO);

  const pills = dom.severityPills.querySelectorAll('.pill[data-severity]');

  pills.forEach(p => {
    const sev = String(p.dataset.severity || '').toUpperCase();
    const active = Boolean(state.ui.severity[sev]);

    p.classList.toggle('is-active', active);
    p.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function renderSearchClearVisibility() {
  if (!dom.searchClearBtn) return;
  dom.searchClearBtn.style.visibility = state.ui.search ? 'visible' : 'hidden';
}

// ============================================================================
// 11. EVENTS LIST
// ============================================================================

function renderEventsList() {
  const list = dom.logsList;
  if (!list) return;

  list.textContent = '';

  if (
    state.isLoading &&
    state.logs.length === 0 &&
    state.eventosAuth.length === 0 &&
    state.sessoesAtivas.length === 0
  ) {
    list.appendChild(buildEmptyState({
      icon: '◐',
      title: 'Carregando eventos…',
      text: 'Buscando dados da Planilha Mestra.'
    }));
    return;
  }

  if (state.error) {
    list.appendChild(buildErrorState());
    return;
  }

  const items = getEventsForActiveTab()
    .sort((a, b) => {
      const da = new Date(a.timestamp || a.inicioSessao || a.ultimoPing).getTime();
      const db = new Date(b.timestamp || b.inicioSessao || b.ultimoPing).getTime();
      return (Number.isNaN(db) ? 0 : db) - (Number.isNaN(da) ? 0 : da);
    });

  if (!items.length) {
    list.appendChild(buildEmptyStateForTab());
    return;
  }

  const frag = document.createDocumentFragment();

  items.slice(0, ADMIN_CONFIG.MAX_RENDERED_EVENTS).forEach(item => {
    const card = document.createElement('article');

    if (state.activeTab === 'logs') {
      buildLogCard(card, item);
    } else if (state.activeTab === 'auth') {
      buildAuthCard(card, item);
    } else {
      buildSessionCard(card, item);
    }

    frag.appendChild(card);
  });

  list.appendChild(frag);
}

function buildLogCard(card, item) {
  const isErro = String(item.tipoLog || '').toUpperCase() === 'ERRO';
  const isAlerta = String(item.tipoLog || '').toUpperCase() === 'ALERTA';
  const status = String(item.status || 'ABERTO').toUpperCase();
  const isResolvido = status === 'RESOLVIDO';

  card.className =
    'log-card ' +
    (isErro ? 'log-card--erro' : isAlerta ? 'log-card--alerta' : 'log-card--info');

  card.innerHTML = `
    <div class="log-card__icon">${isErro ? '!' : isAlerta ? '⚠' : 'i'}</div>
    <div class="log-card__body">
      <div class="log-card__head">
        <span class="log-card__app">${safeEscape(item.aplicativo || item.app || 'App')}</span>
        <span class="log-card__client">${safeEscape(getNomeCliente(item.idCliente))}</span>
        ${renderStatusBadge(status, isErro)}
      </div>
      <pre class="log-card__message">${safeEscape(safeTruncate(item.mensagemErro || item.message || '', 220))}</pre>
    </div>
    <time class="log-card__time">${safeRelativeTime(item.timestamp)}</time>
  `;

  card.onclick = () => openDetailDrawer('log', item);
}

function buildAuthCard(card, item) {
  const tipo = String(item.tipoEvento || '').toUpperCase();
  const isFail = tipo.includes('FALHA') || tipo.includes('FAIL') || tipo.includes('ERRO');

  card.className = `auth-card ${isFail ? 'auth-card--fail' : 'auth-card--success'}`;

  card.innerHTML = `
    <div class="auth-card__icon">${isFail ? '✗' : '✓'}</div>
    <div class="auth-card__body">
      <div class="auth-card__head">
        <span class="auth-card__user">${safeEscape(item.usuario || '—')}</span>
        <span class="log-card__client">${safeEscape(getNomeCliente(item.idCliente))}</span>
      </div>
      <div class="auth-card__meta">
        <span>${safeEscape(item.aplicativo || item.app || 'App')}</span>
        ${item.detalhes ? `<span>· ${safeEscape(safeTruncate(item.detalhes, 90))}</span>` : ''}
      </div>
    </div>
    <time class="auth-card__time">${safeRelativeTime(item.timestamp)}</time>
  `;

  card.onclick = () => openDetailDrawer('auth', item);
}

function buildSessionCard(card, item) {
  card.className = 'session-card';

  card.innerHTML = `
    <div class="session-card__avatar" style="background:${gradientFromString(item.usuario || 'user')}">
      ${safeEscape(initials(item.usuario || '?'))}
    </div>
    <div class="session-card__body">
      <div class="session-card__head">
        <span class="session-card__name">${safeEscape(item.usuario || '—')}</span>
        <span class="session-card__app">${safeEscape(item.aplicativo || item.app || '—')}</span>
        <span class="log-card__client">${safeEscape(getNomeCliente(item.idCliente))}</span>
      </div>
      <div class="session-card__meta">
        <span>${safeEscape(item.dispositivo || 'Dispositivo')}</span>
        <span>· Último ping: ${safeRelativeTime(item.ultimoPing || item.ultimoHb)}</span>
      </div>
    </div>
    <div class="session-card__time">
      <span class="session-card__duration">${formatDuration(item.inicioSessao || item.timestamp)}</span>
    </div>
  `;

  card.onclick = () => openDetailDrawer('session', item);
}

function renderStatusBadge(status, isErro) {
  if (status === 'RESOLVIDO') {
    return `
      <span style="margin-left:8px;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;background:rgba(16,185,129,.1);color:#10B981;">
        RESOLVIDO
      </span>
    `;
  }

  if (isErro) {
    return `
      <span style="margin-left:8px;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;background:rgba(239,68,68,.1);color:#EF4444;">
        ABERTO
      </span>
    `;
  }

  return '';
}

function buildEmptyState({ icon, title, text }) {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const i = document.createElement('div');
  i.className = 'empty-state__icon';
  i.setAttribute('aria-hidden', 'true');
  i.textContent = icon;

  const t = document.createElement('p');
  t.className = 'empty-state__title';
  t.textContent = title;

  const d = document.createElement('p');
  d.className = 'empty-state__text';
  d.textContent = text;

  wrap.appendChild(i);
  wrap.appendChild(t);
  wrap.appendChild(d);

  return wrap;
}

function buildEmptyStateForTab() {
  const filtrando = Boolean(state.filtroClienteId);
  const cliente = getNomeCliente(state.filtroClienteId);
  const buscando = Boolean(state.ui.search);

  if (buscando) {
    return buildEmptyState({
      icon: '⌕',
      title: 'Nada encontrado',
      text: `Nenhum resultado para "${state.ui.search}".`
    });
  }

  if (state.activeTab === 'logs') {
    const s = state.ui.severity;

    if (!s.ERRO && !s.ALERTA && !s.INFO) {
      return buildEmptyState({
        icon: '◌',
        title: 'Filtros desligados',
        text: 'Ative ao menos uma severidade.'
      });
    }

    return buildEmptyState({
      icon: '✓',
      title: 'Nenhum log registrado',
      text: filtrando
        ? `${cliente} não possui logs no período.`
        : 'O ecossistema está silencioso. Bom sinal.'
    });
  }

  if (state.activeTab === 'auth') {
    return buildEmptyState({
      icon: '◌',
      title: 'Nenhum evento de autenticação',
      text: filtrando
        ? `${cliente} não tem eventos de auth registrados.`
        : 'Nenhum login/logout foi registrado.'
    });
  }

  return buildEmptyState({
    icon: '○',
    title: 'Nenhuma sessão ativa',
    text: filtrando
      ? `${cliente} não tem usuários online.`
      : 'Nenhum usuário está online agora.'
  });
}

function buildErrorState() {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const i = document.createElement('div');
  i.className = 'empty-state__icon';
  i.style.color = 'var(--danger, #dc2626)';
  i.textContent = '⚠';

  const t = document.createElement('p');
  t.className = 'empty-state__title';
  t.textContent = 'Falha ao carregar dados';

  const d = document.createElement('p');
  d.className = 'empty-state__text';
  d.textContent = state.error?.message || 'Verifique SCRIPT_URL, API_KEY e deploy.';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--ghost';
  btn.style.marginTop = '20px';
  btn.textContent = 'Tentar novamente';
  btn.addEventListener('click', loadData);

  wrap.appendChild(i);
  wrap.appendChild(t);
  wrap.appendChild(d);
  wrap.appendChild(btn);

  return wrap;
}

// ============================================================================
// 12. DETAIL DRAWER + RESOLVER LOG
// ============================================================================

function openDetailDrawer(kind, data) {
  state.ui.detailOpen = true;
  state.ui.detailContext = { kind, data };

  if (dom.detailDrawerTitle) {
    dom.detailDrawerTitle.textContent =
      kind === 'log'
        ? 'Detalhe do Log'
        : kind === 'auth'
          ? 'Detalhe de Autenticação'
          : 'Detalhe da Sessão';
  }

  const body = dom.detailDrawerBody;
  if (!body) return;

  if (kind === 'log') {
    renderLogDetail(body, data);
  } else {
    body.innerHTML = `<pre class="detail-message">${safeEscape(JSON.stringify(data, null, 2))}</pre>`;
  }

  if (dom.detailDrawer) {
    dom.detailDrawer.hidden = false;
    dom.detailDrawer.classList.add('drawer--open');
    dom.detailDrawer.setAttribute('aria-hidden', 'false');
  }
}

function renderLogDetail(body, data) {
  const status = String(data.status || 'ABERTO').toUpperCase();
  const isResolvido = status === 'RESOLVIDO';
  const tipo = String(data.tipoLog || '').toUpperCase();

  let kbMatch = null;

  try {
    kbMatch = matchKB(data.mensagemErro || data.message || '');
  } catch (_) {
    kbMatch = null;
  }

  const kbHtml = kbMatch
    ? `
      <div class="detail-section" style="margin-top:16px;padding:12px;background:rgba(59,130,246,.05);border:1px solid rgba(59,130,246,.35);border-radius:8px;">
        <h3 class="detail-section__title" style="color:#3b82f6;font-size:13px;">📚 Knowledge Base</h3>
        <p style="font-size:12px;margin-top:4px;"><strong>Padrão:</strong> ${safeEscape(kbMatch.id)} - ${safeEscape(kbMatch.titulo)}</p>
        <p style="font-size:12px;margin-top:4px;"><strong>Solução:</strong> ${safeEscape(kbMatch.solucao || kbMatch.solution || '')}</p>
      </div>
    `
    : '';

  body.innerHTML = `
    <div class="detail-meta">
      <div class="detail-meta__key">Status</div>
      <div class="detail-meta__val" style="font-weight:bold;color:${isResolvido ? '#10b981' : '#dc2626'}">${safeEscape(status)}</div>

      <div class="detail-meta__key">Cliente</div>
      <div class="detail-meta__val">${safeEscape(getNomeCliente(data.idCliente))}</div>

      <div class="detail-meta__key">Usuário</div>
      <div class="detail-meta__val">${safeEscape(data.usuario || '—')}</div>

      <div class="detail-meta__key">App</div>
      <div class="detail-meta__val">${safeEscape(data.aplicativo || data.app || '—')}</div>

      <div class="detail-meta__key">Quando</div>
      <div class="detail-meta__val">${safeEscape(formatAbsoluteTime(data.timestamp))}</div>

      ${isResolvido ? `
        <div class="detail-meta__key">Resolvido por</div>
        <div class="detail-meta__val">${safeEscape(data.resolvidoPor || '—')}</div>

        <div class="detail-meta__key">Resolução</div>
        <div class="detail-meta__val">${safeEscape(data.resolucao || '—')}</div>
      ` : ''}
    </div>

    <div class="detail-section">
      <h3 class="detail-section__title">Mensagem</h3>
      <pre class="detail-message">${safeEscape(data.mensagemErro || data.message || '')}</pre>
    </div>

    ${kbHtml}

    ${!isResolvido && tipo === 'ERRO' ? `
      <button class="btn btn--primary btn--block" id="gm-resolve-btn" style="margin-top:16px;">
        ✓ Marcar como Resolvido
      </button>
    ` : ''}

    <button class="btn btn--ghost btn--block" id="gm-copy-detail-btn" style="margin-top:8px;">
      Copiar JSON
    </button>
  `;

  const resolveBtn = body.querySelector('#gm-resolve-btn');

  if (resolveBtn) {
    resolveBtn.onclick = async () => {
      const resolucao = window.prompt('Anotação de resolução (opcional):', '');

      if (resolucao === null) return;

      try {
        resolveBtn.disabled = true;
        resolveBtn.textContent = 'Resolvendo...';

        await adminApiPost('updatelogstatus', {
          timestamp: data.timestamp,
          idCliente: data.idCliente,
          mensagemErro: data.mensagemErro || data.message || '',
          novoStatus: 'RESOLVIDO',
          resolucao: String(resolucao || '').trim()
        });

        closeDetailDrawer();
        await loadData();
        safeToastSuccess('Log marcado como resolvido.');
      } catch (e) {
        safeToastError('Falha ao resolver: ' + e.message);
        resolveBtn.disabled = false;
        resolveBtn.textContent = '✓ Marcar como Resolvido';
      }
    };
  }

  const copyBtn = body.querySelector('#gm-copy-detail-btn');

  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        safeToastSuccess('Detalhe copiado.');
      } catch (_) {
        safeToastError('Não foi possível copiar.');
      }
    };
  }
}

export function closeDetailDrawer() {
  state.ui.detailOpen = false;
  state.ui.detailContext = null;

  if (dom.detailDrawer) {
    dom.detailDrawer.classList.remove('drawer--open');
    dom.detailDrawer.setAttribute('aria-hidden', 'true');

    setTimeout(() => {
      dom.detailDrawer.hidden = true;
    }, 250);
  }
}

// ============================================================================
// 13. STATUS / TEMA
// ============================================================================

function updateConnectionStatus() {
  const pill = dom.connectionStatus;
  if (!pill) return;

  const textEl = pill.querySelector('.status-pill__label') || pill.querySelector('.status-pill__text') || pill;

  if (state.isLoading) {
    pill.dataset.state = 'loading';
    textEl.textContent = 'Sincronizando…';
  } else if (state.error) {
    pill.dataset.state = 'error';
    textEl.textContent = 'Erro de conexão';
  } else {
    pill.dataset.state = 'online';
    textEl.textContent = 'Online';
  }
}

function updateRefreshButton() {
  if (!dom.refreshBtn) return;

  dom.refreshBtn.disabled = state.isLoading;
  dom.refreshBtn.classList.toggle('is-loading', state.isLoading);
}

function detectInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.THEME);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch (_) {}

  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return THEME_DEFAULT || 'light';
}

function applyTheme(theme, withTransition) {
  const root = document.documentElement;

  if (withTransition) {
    root.classList.add('theme-transitioning');
    setTimeout(() => root.classList.remove('theme-transitioning'), 500);
  }

  root.setAttribute('data-theme', theme);

  if (dom.themeToggleBtn) {
    dom.themeToggleBtn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    dom.themeToggleBtn.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'
    );
    dom.themeToggleBtn.title = theme === 'dark' ? 'Tema escuro ativo' : 'Tema claro ativo';
  }
}

// ============================================================================
// 14. EXPORT CSV / PDF
// ============================================================================

function exportCurrentTabAsCSV() {
  const tab = state.activeTab;
  const items = getEventsForActiveTab();

  if (!items.length) {
    flashExportButton('Nada para exportar', dom.exportCsvBtn);
    return;
  }

  const headers = CSV_HEADERS[tab] || CSV_HEADERS.logs;
  const lines = [headers.join(',')];

  for (const item of items) {
    const row = headers.map(h => csvEscape(sanitizeExportValue(item[h], h)));
    lines.push(row.join(','));
  }

  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const filename = buildExportFilename(tab, 'csv');

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);

  flashExportButton(`✓ ${items.length} linha(s)`, dom.exportCsvBtn);
}

function exportCurrentTabAsPDF() {
  const tab = state.activeTab;
  const items = getEventsForActiveTab();

  if (!items.length) {
    flashExportButton('Vazio', dom.exportPdfBtn);
    return;
  }

  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('jsPDF não carregado.');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'pt', 'a4');
    const headers = CSV_HEADERS[tab] || CSV_HEADERS.logs;
    const body = items.map(item => headers.map(h => String(sanitizeExportValue(item[h], h) || '')));

    const titles = {
      logs: 'Logs e Erros',
      auth: 'Autenticações',
      sessions: 'Sessões Ativas'
    };

    doc.setFontSize(16);
    doc.text(`Relatório God Mode - ${titles[tab] || tab.toUpperCase()}`, 40, 40);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')} · ${items.length} registros`, 40, 58);

    if (typeof doc.autoTable !== 'function') {
      throw new Error('AutoTable não carregado.');
    }

    doc.autoTable({
      startY: 76,
      head: [headers],
      body,
      theme: 'striped',
      styles: {
        fontSize: 8,
        cellPadding: 4,
        overflow: 'linebreak'
      },
      headStyles: {
        fillColor: [11, 27, 51],
        textColor: 255
      },
      alternateRowStyles: {
        fillColor: [245, 247, 250]
      }
    });

    doc.save(buildExportFilename(tab, 'pdf'));
    flashExportButton('✓ Gerado', dom.exportPdfBtn);
  } catch (e) {
    console.error('[GodMode] PDF export failed:', e);
    flashExportButton('Erro', dom.exportPdfBtn);
    safeToastError(e.message || 'Falha ao gerar PDF.');
  }
}

function sanitizeExportValue(value, field) {
  const f = String(field || '').toLowerCase();

  if (f === 'ip') return value ? '[IP_REMOVIDO]' : '';
  if (f.includes('cpf') || f.includes('cnpj') || f.includes('documento')) return maskCpfCnpj(value);

  return value ?? '';
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';

  const s = String(value);

  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }

  return s;
}

function buildExportFilename(tab, ext) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}`;

  const cli = state.filtroClienteId
    ? `_${slugify(getNomeCliente(state.filtroClienteId))}`
    : '_todos';

  return `godmode_${tab}${cli}_${stamp}.${ext}`;
}

function flashExportButton(msg, btnElement) {
  if (!btnElement) return;

  const original = btnElement.textContent;
  btnElement.textContent = msg;
  btnElement.disabled = true;

  setTimeout(() => {
    btnElement.textContent = original;
    btnElement.disabled = false;
  }, 1400);
}

// ============================================================================
// 15. CAPACITY MONITOR
// ============================================================================

function renderCapacityBadge() {
  if (!dom.capacityBadge) return;

  const criticos = contarSaudeAlertas();

  if (criticos > 0) {
    dom.capacityBadge.textContent = String(criticos);
    dom.capacityBadge.style.display = '';
  } else {
    dom.capacityBadge.style.display = 'none';
  }
}

function renderCapacityDrawer() {
  if (state.ui.capacityOpen) {
    openCapacityDrawer();
  } else {
    closeCapacityDrawer();
  }
}

export function openCapacityDrawer() {
  state.ui.capacityOpen = true;

  if (!dom.capacityDrawer) return;

  const apps = state.filtroClienteId
    ? state.saudeApps.filter(a => String(a.idCliente) === String(state.filtroClienteId))
    : state.saudeApps;

  if (dom.capacitySummary) {
    const cont = {
      SAUDAVEL: 0,
      ATENCAO: 0,
      ALERTA: 0,
      CRITICO: 0,
      OFFLINE: 0,
      MIGRADO: 0,
      PENDING: 0
    };

    apps.forEach(a => {
      const s = String(a.status || 'PENDING').toUpperCase();
      if (cont[s] !== undefined) cont[s]++;
      else cont.PENDING++;
    });

    const ordem = ['CRITICO', 'ALERTA', 'ATENCAO', 'SAUDAVEL', 'PENDING', 'OFFLINE', 'MIGRADO'];

    dom.capacitySummary.innerHTML = ordem
      .filter(k => cont[k] > 0)
      .map(k => `
        <span class="cap-chip cap-chip--${k.toLowerCase()}">
          <span class="cap-chip__dot"></span>
          <span>${safeEscape(k)}</span>
          <span class="cap-chip__count">${safeFormatNumber(cont[k])}</span>
        </span>
      `)
      .join('');
  }

  if (dom.capacityMeta) {
    dom.capacityMeta.textContent = `${safeFormatNumber(apps.length)} app(s) monitorado(s)`;
  }

  if (dom.capacityList) {
    if (!apps.length) {
      dom.capacityList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">○</div>
          <p class="empty-state__title">Nenhum app monitorado</p>
          <p class="empty-state__text">Cadastre clientes/apps para iniciar o monitoramento.</p>
        </div>
      `;
    } else {
      const peso = s => ({
        CRITICO: 0,
        ALERTA: 1,
        ATENCAO: 2,
        OFFLINE: 3,
        PENDING: 4,
        SAUDAVEL: 5,
        MIGRADO: 6
      })[String(s || '').toUpperCase()] ?? 9;

      const sorted = [...apps].sort((a, b) => peso(a.status) - peso(b.status));

      dom.capacityList.innerHTML = sorted.map(a => {
        const status = String(a.status || 'PENDING').toUpperCase();
        const perc = Number(a.percUso ?? a.percentual ?? 0) || 0;
        const fillNum = Math.max(0.01, Math.min(1, perc / 100));
        const idCliente = a.idCliente || '';
        const clienteNome = getNomeCliente(idCliente);
        const appNome = getAppLabel(a.app || a.aplicativo);

        return `
          <article class="cap-card" data-status="${safeEscape(status)}">
            <div class="cap-card__head">
              <div>
                <div class="cap-card__title">${safeEscape(appNome)} · ${safeEscape(clienteNome)}</div>
                <div class="cap-card__sub">
                  ${a.idApp ? `ID: ${safeEscape(safeTruncate(a.idApp, 26))}` : 'Sem ID de app vinculado'}
                </div>
              </div>
              <span class="cap-card__status">${safeEscape(status)}</span>
            </div>

            <div class="cap-bar">
              <div
                class="cap-bar__fill"
                style="width:${Math.max(0, Math.min(100, perc)).toFixed(1)}%;--cap-fill:${perc.toFixed(1)}%;--cap-fill-num:${fillNum}"
              ></div>
            </div>

            <div class="cap-card__metrics">
              <div class="cap-metric">
                <div class="cap-metric__label">Uso</div>
                <div class="cap-metric__value">${perc.toFixed(1)}%</div>
              </div>
              <div class="cap-metric">
                <div class="cap-metric__label">Linhas</div>
                <div class="cap-metric__value">${safeFormatNumber(a.qtdLinhas || 0)}</div>
              </div>
              <div class="cap-metric">
                <div class="cap-metric__label">Tamanho</div>
                <div class="cap-metric__value">${Number(a.tamanhoMB || 0).toFixed(2)} MB</div>
              </div>
            </div>

            <div style="margin-top:10px;font-size:12px;color:#6b7280;">
              ${safeEscape(a.observacoes || '')}
            </div>
          </article>
        `;
      }).join('');
    }
  }

  dom.capacityDrawer.hidden = false;
  dom.capacityDrawer.classList.add('drawer--open');
  dom.capacityDrawer.setAttribute('aria-hidden', 'false');
}

export function closeCapacityDrawer() {
  state.ui.capacityOpen = false;

  if (dom.capacityDrawer) {
    dom.capacityDrawer.classList.remove('drawer--open');
    dom.capacityDrawer.setAttribute('aria-hidden', 'true');

    setTimeout(() => {
      dom.capacityDrawer.hidden = true;
    }, 220);
  }
}

// ============================================================================
// 16. QUOTA MONITOR — Seats globais por cliente
// ============================================================================

export async function openQuotaMonitor() {
  let modal = document.getElementById('capacityMonitorModal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'capacityMonitorModal';
    modal.style.cssText = `
      position:fixed;
      inset:0;
      z-index:10000;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:20px;
    `;
    modal.hidden = true;

    modal.innerHTML = `
      <div data-close style="position:absolute;inset:0;background:rgba(0,0,0,.5);"></div>

      <div style="position:relative;background:#fff;border-radius:16px;max-width:980px;width:100%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.32);">
        <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <h3 style="margin:0;font-size:18px;color:#111827;">👥 Monitor de Clientes e Quotas</h3>
            <p style="margin:4px 0 0;color:#6b7280;font-size:12px;">Seats globais por cliente — válidos para Ponto Digital e Estoque.</p>
          </div>
          <button type="button" data-close style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;">✕</button>
        </div>

        <div id="capMonBody" style="padding:16px 20px;overflow-y:auto;flex:1;color:#111827;">
          <p style="color:#6b7280;">Buscando dados de licenciamento...</p>
        </div>

        <div style="padding:12px 20px;border-top:1px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" data-refresh-quota class="btn btn--ghost">Atualizar</button>
          <button type="button" data-close class="btn btn--primary">Fechar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener('click', e => {
      if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) {
        modal.hidden = true;
        state.ui.quotaMonitorOpen = false;
      }

      if (e.target.matches('[data-refresh-quota]') || e.target.closest('[data-refresh-quota]')) {
        renderQuotaMonitorBody();
      }
    });
  }

  state.ui.quotaMonitorOpen = true;
  modal.hidden = false;

  await renderQuotaMonitorBody();
}

async function renderQuotaMonitorBody() {
  const body = document.getElementById('capMonBody');
  if (!body) return;

  body.innerHTML = '<p style="color:#6b7280;">Carregando métricas de licenciamento...</p>';

  try {
    const data = await adminApiPost('getcapacitymonitor', {});

    if (!data || !Array.isArray(data.clientes) || !data.clientes.length) {
      body.innerHTML = `
        <div style="padding:20px;border-radius:12px;background:#f9fafb;color:#6b7280;">
          Nenhum cliente cadastrado.
        </div>
      `;
      return;
    }

    const totais = data.totais || {};
    const clientes = data.clientes || [];

    body.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;font-size:13px;">
        ${renderQuotaKpi('Clientes', totais.clientes ?? clientes.length)}
        ${renderQuotaKpi('Funcionários ativos', totais.funcionarios ?? totais.funcionariosAtivos ?? 0)}
        ${renderQuotaKpi('Capacidade total', totais.capacidadeTotal ?? totais.seatsContratados ?? 0)}
        ${renderQuotaKpi('Restantes', totais.restantes ?? totais.seatsRestantes ?? 0)}
      </div>

      <table style="width:100%;font-size:13px;border-collapse:collapse;text-align:left;">
        <thead>
          <tr style="background:#f3f4f6;border-bottom:2px solid #e5e7eb;">
            <th style="padding:10px;">Cliente</th>
            <th style="padding:10px;">Plano</th>
            <th style="padding:10px;">Apps</th>
            <th style="padding:10px;width:34%;">Uso global</th>
            <th style="padding:10px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${clientes.map(renderQuotaRow).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    body.innerHTML = `
      <div style="background:#fee2e2;color:#991b1b;padding:12px;border-radius:8px;">
        ❌ Falha ao carregar quotas: ${safeEscape(e.message)}
      </div>
    `;
  }
}

function renderQuotaKpi(label, value) {
  return `
    <div style="background:#f3f4f6;padding:10px 12px;border-radius:8px;min-width:140px;">
      <div style="font-size:11px;color:#6b7280;">${safeEscape(label)}</div>
      <strong style="font-size:18px;color:#111827;">${safeFormatNumber(value)}</strong>
    </div>
  `;
}

function renderQuotaRow(c) {
  const nome = c.nome || c.nomeFantasia || c.nomeCliente || c.idCliente || 'Cliente';
  const idCliente = c.idCliente || c.id || '';
  const plano = c.plano || '—';
  const usados = Number(c.usados ?? c.funcionariosAtivos ?? c.emUso ?? 0) || 0;
  const quota = Number(c.quota ?? c.quotaFuncionarios ?? c.limiteFuncionarios ?? 0) || 0;
  const percentual = quota > 0
    ? Math.min(100, Math.round((usados / quota) * 100))
    : Number(c.percentual || 0);

  const status = c.status || (
    percentual >= 100 ? 'cheio' :
    percentual >= 80 ? 'atencao' :
    'ok'
  );

  const apps = Array.isArray(c.apps)
    ? c.apps
    : String(c.apps || c.appsContratados || '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);

  const color = status === 'cheio'
    ? '#dc2626'
    : status === 'atencao'
      ? '#f59e0b'
      : '#10b981';

  return `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:10px;">
        <strong>${safeEscape(nome)}</strong>
        <br>
        <small style="color:#6b7280;">${safeEscape(idCliente)}</small>
      </td>
      <td style="padding:10px;">${safeEscape(plano)}</td>
      <td style="padding:10px;">
        ${apps.length
          ? apps.map(a => `<span style="display:inline-block;margin:2px;padding:2px 6px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:11px;">${safeEscape(getAppLabel(a))}</span>`).join('')
          : '<span style="color:#9ca3af;">—</span>'
        }
      </td>
      <td style="padding:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;">
            <div style="width:${percentual}%;height:100%;background:${color};"></div>
          </div>
          <span style="font-size:12px;white-space:nowrap;">${safeFormatNumber(usados)}/${safeFormatNumber(quota)}</span>
        </div>
      </td>
      <td style="padding:10px;">
        <span style="padding:2px 8px;border-radius:10px;font-size:11px;background:${status === 'cheio' ? '#fee2e2' : status === 'atencao' ? '#fef3c7' : '#d1fae5'};color:${status === 'cheio' ? '#991b1b' : status === 'atencao' ? '#92400e' : '#065f46'}">
          ${safeEscape(String(status).toUpperCase())}
        </span>
      </td>
    </tr>
  `;
}

// ============================================================================
// 17. PRODUCT INSIGHTS + MIGRATION READINESS
// ============================================================================

function initProductInsightsButton() {
  const container = getTopbarActionsContainer();
  if (!container) return;

  if (!document.getElementById('productInsightsBtn')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'productInsightsBtn';
    btn.className = 'btn btn--ghost btn--small';
    btn.title = 'Product Insights';
    btn.textContent = '🧠 Insights';
    btn.addEventListener('click', openProductInsightsModal);
    container.insertBefore(btn, container.firstChild || null);
  }

  if (!document.getElementById('migrationReadinessBtn')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'migrationReadinessBtn';
    btn.className = 'btn btn--ghost btn--small';
    btn.title = 'Preparar migração Firebase';
    btn.textContent = '🔥 Migração';
    btn.addEventListener('click', openMigrationReadinessModal);
    container.insertBefore(btn, container.firstChild || null);
  }

  if (!document.getElementById('quotaMonitorBtn')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'quotaMonitorBtn';
    btn.className = 'btn btn--ghost btn--small';
    btn.title = 'Monitor de quotas';
    btn.textContent = '👥 Quotas';
    btn.addEventListener('click', openQuotaMonitor);
    container.insertBefore(btn, container.firstChild || null);
  }
}

async function openProductInsightsModal() {
  const modal = ensureProductInsightsModal();
  const body = modal.querySelector('#productInsightsBody');

  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  body.innerHTML = `
    <div style="padding:20px;color:#6b7280;">
      Carregando insights do produto...
    </div>
  `;

  try {
    const data = await getProductInsightsData();
    body.innerHTML = renderProductInsightsHtml(data);
  } catch (e) {
    body.innerHTML = `
      <div style="margin:20px;padding:12px;border-radius:10px;background:#fee2e2;color:#991b1b;">
        ❌ Falha ao carregar Product Insights: ${safeEscape(e.message)}
      </div>
    `;
  }
}

function ensureProductInsightsModal() {
  let modal = document.getElementById('productInsightsModal');

  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'productInsightsModal';
  modal.hidden = true;
  modal.style.cssText = `
    position:fixed;
    inset:0;
    z-index:10020;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:20px;
  `;

  modal.innerHTML = `
    <div data-close style="position:absolute;inset:0;background:rgba(0,0,0,.55);"></div>

    <section style="position:relative;background:#fff;color:#111827;border-radius:18px;width:min(1180px,100%);max-height:88vh;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.35);">
      <header style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;gap:12px;align-items:center;">
        <div>
          <h2 style="margin:0;font-size:20px;">🧠 Product Insights</h2>
          <p style="margin:4px 0 0;color:#6b7280;font-size:12px;">Health Score, Migration Readiness, seats, uso por app e incidentes agrupados.</p>
        </div>
        <button type="button" data-close style="border:none;background:none;font-size:22px;cursor:pointer;color:#6b7280;">✕</button>
      </header>

      <div id="productInsightsBody" style="overflow:auto;padding:0;flex:1;"></div>

      <footer style="padding:12px 20px;border-top:1px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:space-between;gap:8px;">
        <button type="button" data-refresh-insights class="btn btn--ghost">Atualizar</button>
        <button type="button" data-close class="btn btn--primary">Fechar</button>
      </footer>
    </section>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', async e => {
    if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) {
      modal.hidden = true;
      document.body.style.overflow = '';
      state.ui.productInsightsOpen = false;
    }

    if (e.target.matches('[data-refresh-insights]') || e.target.closest('[data-refresh-insights]')) {
      state.productInsights.loadedAt = 0;
      await openProductInsightsModal();
    }
  });

  return modal;
}

async function getProductInsightsData() {
  const now = Date.now();

  if (
    state.productInsights.data &&
    now - state.productInsights.loadedAt < ADMIN_CONFIG.PRODUCT_INSIGHTS_CACHE_MS
  ) {
    return state.productInsights.data;
  }

  state.productInsights.loading = true;
  state.productInsights.error = null;

  try {
    const data = await adminApiPost('getproductinsights', {});
    state.productInsights.data = data;
    state.productInsights.loadedAt = Date.now();
    return data;
  } catch (e) {
    state.productInsights.error = e;
    throw e;
  } finally {
    state.productInsights.loading = false;
  }
}

function renderProductInsightsHtml(data) {
  const clientes = Array.isArray(data.clientes) ? data.clientes : [];
  const incidentes = Array.isArray(data.incidentes) ? data.incidentes : [];
  const totais = data.totais || {};

  return `
    <div style="padding:20px;">
      <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:18px;">
        ${renderInsightKpi('Clientes', totais.clientes ?? clientes.length, '🏢')}
        ${renderInsightKpi('Seats ativos', totais.funcionariosAtivos ?? totais.funcionarios ?? 0, '👥')}
        ${renderInsightKpi('Seats contratados', totais.seatsContratados ?? 0, '🎟️')}
        ${renderInsightKpi('Incidentes abertos', totais.incidentesAbertos ?? incidentes.length, '🚨')}
        ${renderInsightKpi('Atenção/críticos', (totais.clientesCriticos ?? 0) + (totais.clientesAtencao ?? 0), '⚠️')}
      </div>

      <div style="display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px;align-items:start;">
        <div style="display:grid;gap:12px;">
          ${clientes.length
            ? clientes.map(renderClientInsightCard).join('')
            : '<div style="padding:16px;background:#f9fafb;border-radius:12px;color:#6b7280;">Nenhum cliente para analisar.</div>'
          }
        </div>

        ${renderIncidentsPanel(incidentes)}
      </div>
    </div>
  `;
}

function renderInsightKpi(label, value, icon) {
  return `
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:14px;">
      <div style="font-size:20px;">${safeEscape(icon)}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:6px;">${safeEscape(label)}</div>
      <strong style="display:block;font-size:22px;margin-top:2px;">${safeFormatNumber(value)}</strong>
    </div>
  `;
}

function renderClientInsightCard(c) {
  const cliente = c.cliente || c;
  const idCliente = cliente.idCliente || c.idCliente || '';
  const nome = cliente.nomeFantasia || cliente.nome || cliente.nomeCliente || getNomeCliente(idCliente);

  const health = c.health || {};
  const migration = c.migration || {};
  const seats = c.seats || {};
  const apps = Array.isArray(c.apps) ? c.apps : [];
  const logs = c.logs || {};
  const auth = c.auth || {};

  const score = Number(health.score ?? c.healthScore ?? 0) || 0;
  const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#dc2626';

  const migStatus = migration.status || c.migrationStatus || 'SAUDAVEL';
  const migColor = getMigrationColor(migStatus);

  return `
    <article style="border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#fff;">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
        <div>
          <h3 style="margin:0;font-size:16px;">${safeEscape(nome)}</h3>
          <p style="margin:4px 0 0;color:#6b7280;font-size:12px;">${safeEscape(idCliente)} · ${safeEscape(cliente.plano || 'sem plano')}</p>
        </div>

        <div style="display:flex;gap:8px;align-items:center;">
          <span style="padding:4px 8px;border-radius:999px;background:${scoreColor}22;color:${scoreColor};font-size:12px;font-weight:700;">
            Health ${score}
          </span>
          <span style="padding:4px 8px;border-radius:999px;background:${migColor}22;color:${migColor};font-size:12px;font-weight:700;">
            ${safeEscape(migStatus)}
          </span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:14px;">
        ${renderMiniMetric('Seats', `${seats.usados ?? 0}/${seats.contratados ?? seats.quota ?? 0}`)}
        ${renderMiniMetric('Restantes', seats.restantes ?? 0)}
        ${renderMiniMetric('Erros 24h', logs.erros24h ?? 0)}
        ${renderMiniMetric('Falhas auth', auth.falhas24h ?? 0)}
        ${renderMiniMetric('MTTR', logs.mttr || '—')}
      </div>

      <div style="margin-top:14px;">
        <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Apps</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${apps.length
            ? apps.map(a => {
                const status = String(a.status || 'PENDING').toUpperCase();
                return `
                  <span style="padding:4px 8px;border-radius:999px;background:#f3f4f6;color:#374151;font-size:12px;">
                    ${safeEscape(getAppLabel(a.app || a.aplicativo))} · ${safeEscape(status)}
                  </span>
                `;
              }).join('')
            : '<span style="color:#9ca3af;font-size:12px;">Nenhum app vinculado</span>'
          }
        </div>
      </div>

      <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" class="btn btn--ghost btn--small" onclick="window.gmFilterClient('${safeEscape(idCliente)}')">Ver cliente</button>
        <button type="button" class="btn btn--primary btn--small" onclick="window.gmPrepareFirebaseMigration('${safeEscape(idCliente)}')">Preparar migração</button>
      </div>
    </article>
  `;
}

function renderMiniMetric(label, value) {
  return `
    <div style="background:#f9fafb;border-radius:10px;padding:8px;">
      <div style="font-size:11px;color:#6b7280;">${safeEscape(label)}</div>
      <strong style="font-size:14px;">${safeEscape(value)}</strong>
    </div>
  `;
}

function renderIncidentsPanel(incidentes) {
  return `
    <aside style="border:1px solid #e5e7eb;border-radius:16px;background:#fff;overflow:hidden;">
      <div style="padding:14px 16px;border-bottom:1px solid #e5e7eb;">
        <h3 style="margin:0;font-size:15px;">🚨 Incidentes agrupados</h3>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Erros repetidos por cliente/app.</p>
      </div>

      <div style="max-height:520px;overflow:auto;">
        ${incidentes.length
          ? incidentes.map(i => `
            <div style="padding:12px 16px;border-bottom:1px solid #f3f4f6;">
              <div style="display:flex;justify-content:space-between;gap:8px;">
                <strong style="font-size:13px;">${safeEscape(i.titulo || i.mensagem || 'Incidente')}</strong>
                <span style="font-size:11px;color:#dc2626;font-weight:700;">${safeFormatNumber(i.total || i.count || 1)}x</span>
              </div>
              <div style="font-size:12px;color:#6b7280;margin-top:4px;">
                ${safeEscape(getNomeCliente(i.idCliente))} · ${safeEscape(getAppLabel(i.app || i.aplicativo))}
              </div>
              ${i.causaProvavel ? `<div style="font-size:12px;margin-top:6px;color:#374151;">${safeEscape(i.causaProvavel)}</div>` : ''}
            </div>
          `).join('')
          : '<div style="padding:16px;color:#6b7280;font-size:13px;">Nenhum incidente aberto.</div>'
        }
      </div>
    </aside>
  `;
}

function getMigrationColor(status) {
  const s = String(status || '').toUpperCase();

  if (s.includes('MIGRAR') || s.includes('CRITICO')) return '#dc2626';
  if (s.includes('PLANEJAR') || s.includes('ATENCAO') || s.includes('ALERTA')) return '#f59e0b';
  return '#10b981';
}

async function openMigrationReadinessModal() {
  const modal = ensureProductInsightsModal();
  const body = modal.querySelector('#productInsightsBody');

  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  body.innerHTML = `
    <div style="padding:20px;color:#6b7280;">
      Calculando prontidão de migração...
    </div>
  `;

  try {
    const data = await getProductInsightsData();
    const clientes = Array.isArray(data.clientes) ? data.clientes : [];

    const ordered = [...clientes].sort((a, b) => {
      const sa = Number(a.health?.score ?? a.healthScore ?? 0);
      const sb = Number(b.health?.score ?? b.healthScore ?? 0);
      return sa - sb;
    });

    body.innerHTML = `
      <div style="padding:20px;">
        <h3 style="margin:0 0 6px;font-size:18px;">🔥 Migration Readiness</h3>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">
          Prioridade para migração Firebase baseada em saúde, uso, erros, capacidade e risco operacional.
        </p>

        <div style="display:grid;gap:12px;">
          ${ordered.length
            ? ordered.map(renderMigrationCard).join('')
            : '<div style="padding:16px;background:#f9fafb;border-radius:12px;color:#6b7280;">Nenhum cliente analisado.</div>'
          }
        </div>
      </div>
    `;
  } catch (e) {
    body.innerHTML = `
      <div style="margin:20px;padding:12px;border-radius:10px;background:#fee2e2;color:#991b1b;">
        ❌ Falha ao calcular migração: ${safeEscape(e.message)}
      </div>
    `;
  }
}

function renderMigrationCard(c) {
  const cliente = c.cliente || c;
  const idCliente = cliente.idCliente || c.idCliente || '';
  const nome = cliente.nomeFantasia || cliente.nome || cliente.nomeCliente || getNomeCliente(idCliente);
  const health = c.health || {};
  const migration = c.migration || {};
  const score = Number(health.score ?? c.healthScore ?? 0) || 0;
  const status = migration.status || c.migrationStatus || (
    score < 55 ? 'MIGRAR_AGORA' : score < 75 ? 'PLANEJAR_15D' : 'SAUDAVEL'
  );

  const color = getMigrationColor(status);
  const dias = migration.diasEstimados ?? migration.diasRestantes ?? '—';

  return `
    <article style="border:1px solid #e5e7eb;border-radius:14px;padding:14px;background:#fff;">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
        <div>
          <strong>${safeEscape(nome)}</strong>
          <div style="font-size:12px;color:#6b7280;">${safeEscape(idCliente)} · Health ${score}</div>
        </div>

        <div style="text-align:right;">
          <div style="display:inline-block;padding:4px 8px;border-radius:999px;background:${color}22;color:${color};font-size:12px;font-weight:700;">
            ${safeEscape(status)}
          </div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Estimativa: ${safeEscape(dias)} dias</div>
        </div>
      </div>

      <div style="margin-top:10px;color:#374151;font-size:13px;">
        ${safeEscape(migration.recomendacao || migration.recommendation || 'Monitorar uso, incidentes e capacidade antes da migração.')}
      </div>

      <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn--ghost btn--small" onclick="window.gmFilterClient('${safeEscape(idCliente)}')">Abrir cliente</button>
        <button type="button" class="btn btn--primary btn--small" onclick="window.gmPrepareFirebaseMigration('${safeEscape(idCliente)}')">Preparar plano</button>
      </div>
    </article>
  `;
}

async function prepareFirebaseMigration(idCliente) {
  const cliente = getClienteById(idCliente);

  const nome = cliente
    ? (cliente.nomeFantasia || cliente.nome || cliente.nomeCliente || idCliente)
    : idCliente;

  const ok = window.confirm(
    `Preparar plano de migração Firebase para ${nome}?\n\n` +
    `Nesta fase isso registra a intenção/alerta no backend se o endpoint existir.`
  );

  if (!ok) return;

  try {
    await adminApiPost('preparemigration', { idCliente });
    safeToastSuccess('Plano de migração registrado.');
  } catch (e) {
    safeToastError(
      'Endpoint preparemigration ainda não está ativo no backend. ' +
      'A estrutura do frontend já está pronta.'
    );
    console.warn('[GodMode] preparemigration pendente no backend:', e);
  }
}

// ============================================================================
// 18. NOVO CLIENTE — Modal + validação
// ============================================================================

function openNewClientModal() {
  const modalObj = document.getElementById('newClientModal');
  const formObj =
    document.getElementById('formNovoCliente') ||
    document.getElementById('newClientForm');

  if (!modalObj || !formObj) {
    safeToastError('Modal de novo cliente não encontrado no HTML.');
    return;
  }

  formObj.reset();
  formObj.querySelectorAll('.is-invalid, .is-valid').forEach(el => {
    el.classList.remove('is-invalid', 'is-valid');
  });

  const banner = formObj.querySelector('.form__banner');
  if (banner) banner.remove();

  const logoPreview = document.getElementById('ncLogoPreview');
  const logoRemoveBtn = document.getElementById('ncLogoRemoveBtn');

  if (logoPreview) {
    logoPreview.innerHTML = '<span class="logo-uploader__placeholder">Sem logo</span>';
  }

  if (logoRemoveBtn) {
    logoRemoveBtn.hidden = true;
  }

  modalObj.hidden = false;
  document.body.style.overflow = 'hidden';

  setTimeout(() => formObj.querySelector('input')?.focus(), 50);
}

function closeNewClientModal() {
  const modalObj = document.getElementById('newClientModal');

  if (modalObj) modalObj.hidden = true;

  document.body.style.overflow = '';
}

function initFormNovoCliente() {
  const form =
    document.getElementById('formNovoCliente') ||
    document.getElementById('newClientForm');

  if (!form || form.dataset.gmBound === 'true') return;

  form.dataset.gmBound = 'true';

  const $ = sel => form.querySelector(sel);

  const fields = {
    idCliente: $('#ncIdCliente'),
    razaoSocial: $('#ncRazaoSocial') || $('#ncNome'),
    nomeFantasia: $('#ncNomeFantasia'),
    cnpj: $('#ncCnpj'),
    email: $('#ncEmail'),
    telefone: $('#ncTelefone'),
    plano: $('#ncPlano'),
    quota: $('#ncQuota') || $('#ncQuotaFuncionarios'),
    logoUrl: $('#ncLogoUrl'),
    corPrim: $('#ncCorPrimaria'),
    corPicker: $('#ncCorPicker')
  };

  const submitBtn =
    $('#ncSubmitBtn') ||
    $('#newClientSubmitBtn') ||
    form.querySelector('button[type="submit"]');

  const btnLabel = submitBtn?.querySelector('.btn__label') || submitBtn;
  const btnSpinner = submitBtn?.querySelector('.btn__spinner');

  function getFieldWrap(fieldName) {
    return (
      form.querySelector(`[data-field="${fieldName}"]`) ||
      fields[fieldName]?.closest('.form__field') ||
      fields[fieldName]?.parentElement
    );
  }

  function setFieldError(fieldName, msg) {
    const wrap = getFieldWrap(fieldName);
    if (!wrap) return;

    wrap.classList.add('is-invalid');
    wrap.classList.remove('is-valid');

    const errEl = wrap.querySelector('.form__error');

    if (errEl) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  }

  function setFieldValid(fieldName) {
    const wrap = getFieldWrap(fieldName);
    if (!wrap) return;

    wrap.classList.remove('is-invalid');
    wrap.classList.add('is-valid');

    const errEl = wrap.querySelector('.form__error');

    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
  }

  function clearFieldState(fieldName) {
    const wrap = getFieldWrap(fieldName);
    if (!wrap) return;

    wrap.classList.remove('is-invalid', 'is-valid');

    const errEl = wrap.querySelector('.form__error');

    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
  }

  function clearAllErrors() {
    form.querySelectorAll('.form__field, [data-field]').forEach(f => {
      f.classList.remove('is-invalid', 'is-valid');

      const e = f.querySelector('.form__error');

      if (e) {
        e.textContent = '';
        e.hidden = true;
      }
    });

    const banner = form.querySelector('.form__banner');
    if (banner) banner.remove();
  }

  function showBanner(msg, type = 'error') {
    let banner = form.querySelector('.form__banner');

    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'form__banner';
      banner.style.cssText = `
        margin:12px 20px 0;
        padding:10px 12px;
        border-radius:8px;
        font-size:12px;
        font-weight:600;
      `;
      form.insertBefore(banner, form.firstChild);
    }

    if (type === 'error') {
      banner.style.background = 'rgba(220,38,38,.08)';
      banner.style.color = '#b91c1c';
      banner.style.borderLeft = '3px solid #dc2626';
    } else {
      banner.style.background = 'rgba(16,185,129,.08)';
      banner.style.color = '#047857';
      banner.style.borderLeft = '3px solid #10b981';
    }

    banner.textContent = msg;
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function validateField(name) {
    const field = fields[name];
    const v = String(field?.value || '').trim();

    switch (name) {
      case 'idCliente': {
        if (!v) {
          setFieldError('idCliente', 'Obrigatório.');
          return false;
        }

        if (!/^[a-z0-9_-]{2,32}$/.test(v)) {
          setFieldError('idCliente', 'Use 2-32 caracteres: a-z, 0-9, _ ou -.');
          return false;
        }

        if (state.clientes.some(c => String(c.idCliente).toLowerCase() === v.toLowerCase())) {
          setFieldError('idCliente', 'ID já em uso.');
          return false;
        }

        setFieldValid('idCliente');
        return true;
      }

      case 'razaoSocial': {
        if (!v) {
          setFieldError('razaoSocial', 'Obrigatório.');
          return false;
        }

        if (v.length < 3) {
          setFieldError('razaoSocial', 'Mínimo 3 caracteres.');
          return false;
        }

        setFieldValid('razaoSocial');
        return true;
      }

      case 'cnpj': {
        if (!v) {
          setFieldError('cnpj', 'Obrigatório.');
          return false;
        }

        if (v.replace(/\D/g, '').length !== 14) {
          setFieldError('cnpj', 'CNPJ incompleto.');
          return false;
        }

        if (!validarCnpj(v)) {
          setFieldError('cnpj', 'CNPJ inválido.');
          return false;
        }

        setFieldValid('cnpj');
        return true;
      }

      case 'email': {
        if (!v) {
          clearFieldState('email');
          return true;
        }

        if (!validarEmail(v)) {
          setFieldError('email', 'Email inválido.');
          return false;
        }

        setFieldValid('email');
        return true;
      }

      case 'quota': {
        const n = Number(v);

        if (!v) {
          setFieldError('quota', 'Obrigatório.');
          return false;
        }

        if (!Number.isFinite(n) || n < 1 || n > 1000) {
          setFieldError('quota', 'Entre 1 e 1000.');
          return false;
        }

        setFieldValid('quota');
        return true;
      }

      case 'corPrim': {
        if (!v) {
          clearFieldState('corPrim');
          return true;
        }

        if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
          setFieldError('corPrim', 'Use formato #RRGGBB.');
          return false;
        }

        setFieldValid('corPrim');
        return true;
      }

      default:
        return true;
    }
  }

  fields.cnpj?.addEventListener('input', e => {
    e.target.value = maskCnpj(e.target.value);
  });

  fields.idCliente?.addEventListener('input', e => {
    e.target.value = e.target.value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]/g, '');
  });

  fields.corPicker?.addEventListener('input', e => {
    if (fields.corPrim) fields.corPrim.value = e.target.value;
    clearFieldState('corPrim');
  });

  fields.corPrim?.addEventListener('input', e => {
    const v = e.target.value.trim();

    if (/^#[0-9a-fA-F]{6}$/.test(v) && fields.corPicker) {
      fields.corPicker.value = v.toLowerCase();
    }
  });

  fields.idCliente?.addEventListener('blur', () => validateField('idCliente'));
  fields.razaoSocial?.addEventListener('blur', () => validateField('razaoSocial'));
  fields.cnpj?.addEventListener('blur', () => validateField('cnpj'));
  fields.email?.addEventListener('blur', () => validateField('email'));
  fields.quota?.addEventListener('input', () => validateField('quota'));
  fields.corPrim?.addEventListener('blur', () => validateField('corPrim'));

  Object.values(fields).forEach(el => {
    el?.addEventListener('input', () => {
      const wrap = el.closest('.form__field') || el.closest('[data-field]');

      if (wrap?.classList.contains('is-invalid')) {
        wrap.classList.remove('is-invalid');

        const e = wrap.querySelector('.form__error');

        if (e) {
          e.textContent = '';
          e.hidden = true;
        }
      }
    });
  });

  const logoFile = document.getElementById('ncLogoFile');
  const logoUploadBtn = document.getElementById('ncLogoUploadBtn');
  const logoRemoveBtn = document.getElementById('ncLogoRemoveBtn');
  const logoPreview = document.getElementById('ncLogoPreview');
  const MAX_LOGO_KB = 500;

  if (logoUploadBtn && logoFile) {
    logoUploadBtn.addEventListener('click', () => logoFile.click());
  }

  if (logoFile) {
    logoFile.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > MAX_LOGO_KB * 1024) {
        setFieldError('logo', `Máximo ${MAX_LOGO_KB} KB.`);
        logoFile.value = '';
        return;
      }

      if (!/^image\//.test(file.type)) {
        setFieldError('logo', 'Envie uma imagem.');
        logoFile.value = '';
        return;
      }

      const reader = new FileReader();

      reader.onload = ev => {
        const dataUrl = ev.target.result;

        if (logoPreview) {
          logoPreview.innerHTML = `<img src="${dataUrl}" alt="logo" style="width:100%;height:100%;object-fit:contain;"/>`;
        }

        if (logoRemoveBtn) logoRemoveBtn.hidden = false;
        if (fields.logoUrl) fields.logoUrl.value = dataUrl;

        setFieldValid('logo');
      };

      reader.onerror = () => setFieldError('logo', 'Falha na leitura.');
      reader.readAsDataURL(file);
    });
  }

  if (logoRemoveBtn) {
    logoRemoveBtn.addEventListener('click', () => {
      if (fields.logoUrl) fields.logoUrl.value = '';
      if (logoFile) logoFile.value = '';
      if (logoPreview) logoPreview.innerHTML = '<span class="logo-uploader__placeholder">Sem logo</span>';

      logoRemoveBtn.hidden = true;
      clearFieldState('logo');
    });
  }

  fields.logoUrl?.addEventListener('input', e => {
    const v = e.target.value.trim();

    if (!v) {
      if (logoPreview) logoPreview.innerHTML = '<span class="logo-uploader__placeholder">Sem logo</span>';
      if (logoRemoveBtn) logoRemoveBtn.hidden = true;
      return;
    }

    if (/^https:\/\//.test(v) || /^data:image\//.test(v)) {
      if (logoPreview) {
        logoPreview.innerHTML = `<img src="${safeEscape(v)}" alt="logo" style="width:100%;height:100%;object-fit:contain;"/>`;
      }

      if (logoRemoveBtn) logoRemoveBtn.hidden = false;
    }
  });

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    clearAllErrors();

    const requiredOk = [
      validateField('idCliente'),
      validateField('razaoSocial'),
      validateField('cnpj'),
      validateField('email'),
      validateField('quota'),
      validateField('corPrim')
    ].every(Boolean);

    if (!requiredOk) {
      showBanner('Corrija os campos destacados.', 'error');
      return;
    }

    const appsSelecionados = Array.from(
      form.querySelectorAll('input[name="ncApps"]:checked, input[name="appsContratados"]:checked')
    )
      .map(cb => normalizeAppValue(cb.value))
      .filter(Boolean);

    if (!appsSelecionados.length) {
      showBanner('Selecione pelo menos um app contratado: Ponto Digital ou Estoque.', 'error');
      return;
    }

    const payload = {
      idCliente: fields.idCliente.value.trim().toLowerCase(),
      nome: fields.razaoSocial.value.trim(),
      nomeFantasia: fields.nomeFantasia?.value?.trim() || fields.razaoSocial.value.trim(),
      cnpj: fields.cnpj.value.replace(/\D/g, ''),
      email: fields.email?.value?.trim() || '',
      telefone: fields.telefone?.value?.trim() || '',
      plano: fields.plano?.value || 'basico',
      quotaFuncionarios: Number(fields.quota.value),
      logoUrl: fields.logoUrl?.value?.trim() || '',
      corPrimaria: fields.corPrim?.value?.trim() || '#2563eb',
      appsContratados: appsSelecionados.join(','),
      ativo: true
    };

    if (submitBtn) submitBtn.disabled = true;
    if (btnLabel) btnLabel.textContent = 'Cadastrando...';
    if (btnSpinner) btnSpinner.hidden = false;

    try {
      await adminApiPost('createclient', payload);

      safeToastSuccess('Cliente cadastrado com sucesso.');
      closeNewClientModal();

      await loadData();
      setFilter(payload.idCliente);
    } catch (err) {
      showBanner(`Falha ao cadastrar: ${err.message}`, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (btnLabel) btnLabel.textContent = 'Cadastrar cliente';
      if (btnSpinner) btnSpinner.hidden = true;
    }
  });
}

// ============================================================================
// 19. BIND EVENTS
// ============================================================================

function bindEvents() {
  if (dom.refreshBtn) {
    dom.refreshBtn.addEventListener('click', () => loadData());
  }

  if (dom.logoutBtn) {
    dom.logoutBtn.addEventListener('click', forceLogout);
  }

  if (dom.themeToggleBtn) {
    dom.themeToggleBtn.addEventListener('click', () => {
      setTheme(state.ui.theme === 'dark' ? 'light' : 'dark');
    });
  }

  if (dom.clientList) {
    dom.clientList.addEventListener('click', ev => {
      const btn = ev.target.closest('.client-item');
      if (btn) setFilter(btn.dataset.clientId ?? '');
    });
  }

  if (dom.eventTabs) {
    dom.eventTabs.addEventListener('click', ev => {
      const btn = ev.target.closest('.tab');
      if (btn) setActiveTab(btn.dataset.tab);
    });
  }

  if (dom.searchInput) {
    const dSearch = debounce(val => setSearch(val), ADMIN_CONFIG.SEARCH_DEBOUNCE_MS);
    dom.searchInput.addEventListener('input', ev => dSearch(ev.target.value));
  }

  if (dom.searchClearBtn) {
    dom.searchClearBtn.addEventListener('click', () => {
      if (dom.searchInput) dom.searchInput.value = '';
      setSearch('');
    });
  }

  if (dom.severityPills) {
    dom.severityPills.addEventListener('click', ev => {
      const p = ev.target.closest('.pill');
      if (p) toggleSeverity(p.dataset.severity);
    });
  }

  if (dom.timeFilterSelect) {
    dom.timeFilterSelect.value = state.ui.timeRange;

    dom.timeFilterSelect.addEventListener('change', ev => {
      state.ui.timeRange = ev.target.value || '24h';
      renderEventsList();
      renderHeader();
    });
  }

  if (dom.exportCsvBtn) {
    dom.exportCsvBtn.addEventListener('click', exportCurrentTabAsCSV);
  }

  if (dom.exportPdfBtn) {
    dom.exportPdfBtn.addEventListener('click', exportCurrentTabAsPDF);
  }

  if (dom.capacityBtn) {
    dom.capacityBtn.addEventListener('click', () => {
      state.ui.capacityOpen ? closeCapacityDrawer() : openCapacityDrawer();
    });
  }

  document.addEventListener('click', e => {
    if (
      e.target.closest('#capacityDrawerCloseBtn') ||
      e.target.closest('#capacityDrawer .drawer__backdrop') ||
      e.target.closest('[data-close-capacity]')
    ) {
      closeCapacityDrawer();
    }

    if (
      e.target.closest('#detailDrawerCloseBtn') ||
      e.target.closest('#detailDrawer .drawer__backdrop') ||
      e.target.closest('[data-close-detail]')
    ) {
      closeDetailDrawer();
    }

    if (
      e.target.closest('#newClientCloseBtn') ||
      e.target.closest('#newClientModal .modal__backdrop') ||
      e.target.closest('#newClientModal [data-close]')
    ) {
      closeNewClientModal();
    }

    if (
      e.target.closest('#newClientBtn') ||
      e.target.closest('#fabNovoCliente') ||
      e.target.closest('[data-open-new-client]')
    ) {
      openNewClientModal();
    }
  });

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      closeDetailDrawer();
      closeCapacityDrawer();
      closeNewClientModal();

      const pi = document.getElementById('productInsightsModal');
      if (pi && !pi.hidden) {
        pi.hidden = true;
        document.body.style.overflow = '';
      }

      const qm = document.getElementById('capacityMonitorModal');
      if (qm && !qm.hidden) {
        qm.hidden = true;
      }

      return;
    }

    const active = document.activeElement;
    const isInput = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);

    if (isInput || ev.metaKey || ev.ctrlKey || ev.altKey) return;

    const k = ev.key.toLowerCase();

    if (k === 'r') loadData();
    else if (k === '1') setActiveTab('logs');
    else if (k === '2') setActiveTab('auth');
    else if (k === '3') setActiveTab('sessions');
    else if (k === '/') {
      ev.preventDefault();
      dom.searchInput?.focus();
    } else if (k === 't') {
      setTheme(state.ui.theme === 'dark' ? 'light' : 'dark');
    } else if (k === 'c') {
      state.ui.capacityOpen ? closeCapacityDrawer() : openCapacityDrawer();
    } else if (k === 'i') {
      openProductInsightsModal();
    } else if (k === 'q') {
      openQuotaMonitor();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !state.isLoading) {
      loadData();
    }
  });
}

// ============================================================================
// 20. AUTO REFRESH / LOCAL TICK
// ============================================================================

let autoRefreshTimer = null;
let localTickTimer = null;

function startAutoRefresh() {
  if (autoRefreshTimer) return;

  autoRefreshTimer = setInterval(() => {
    if (!state.isLoading && document.visibilityState === 'visible') {
      loadData();
    }
  }, ADMIN_CONFIG.AUTO_REFRESH_MS);
}

function startLocalTick() {
  if (localTickTimer) return;

  localTickTimer = setInterval(() => {
    if (state.isLoading) return;

    renderHeader();
    renderLiveStrip();
    renderEventsList();
  }, ADMIN_CONFIG.LOCAL_TICK_MS);
}

// ============================================================================
// 21. LOAD DATA
// ============================================================================

async function loadData() {
  if (state.isLoading) return;

  setLoading(true);
  setError(null);

  try {
    const data = await fetchDashboardData();

    if (!data) return;

    setData(data);

    if (
      state.filtroClienteId &&
      !state.clientes.some(c => String(c.idCliente) === String(state.filtroClienteId))
    ) {
      state.filtroClienteId = '';
    }

    renderSidebar();
    renderMain();
  } catch (err) {
    console.error('[GodMode] loadData falhou:', err);
    setError(err);
    renderMain();
  } finally {
    setLoading(false);
  }
}

// ============================================================================
// 22. EXPOSIÇÕES CONTROLADAS PARA HTML INLINE / DEBUG
// ============================================================================

window.openQuotaMonitor = openQuotaMonitor;
window.openCapacityDrawer = openCapacityDrawer;
window.closeCapacityDrawer = closeCapacityDrawer;
window.closeDetailDrawer = closeDetailDrawer;
window.gmLoadData = loadData;

window.gmFilterClient = function gmFilterClient(idCliente) {
  const modal = document.getElementById('productInsightsModal');

  if (modal) {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  setFilter(idCliente || '');
};

window.gmPrepareFirebaseMigration = function gmPrepareFirebaseMigration(idCliente) {
  prepareFirebaseMigration(idCliente);
};

// ============================================================================
// 23. BOOT
// ============================================================================

async function init() {
  requireAuth({ role: 'admin' });

  const ctx = getUserContext() || {};

  state.user.usuario = ctx.usuario || ctx.email || 'Admin';
  state.user.nivel = ctx.nivel || ctx.role || 'admin';
  state.user.escopo = ctx.escopo || ctx.gmEscopo || '*';
  state.user.role = 'admin';

  if (dom.loggedUserDisplay) {
    dom.loggedUserDisplay.textContent = state.user.usuario || 'Admin';
  }

  state.ui.theme = detectInitialTheme();
  applyTheme(state.ui.theme, false);

  bindEvents();
  initFormNovoCliente();
  initProductInsightsButton();

  document.body.classList.add('pronto');

  const tampa = document.getElementById('tampa-carregamento');
  if (tampa) {
    tampa.style.opacity = '0';
    setTimeout(() => tampa.remove(), 400);
  }

  renderSidebar();
  renderMain();

  loadData();

  startAutoRefresh();
  startLocalTick();

  validateSessionOnBoot().catch(err => {
    console.warn('[GodMode] validateSessionOnBoot falhou:', err);
  });
}

async function safeInitGodMode() {
  try {
    document.body.classList.add('pronto');
    await init();
  } catch (err) {
    console.error('[GodMode] Falha no boot:', err);
    showFatalBootError(err);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', safeInitGodMode);
} else {
  safeInitGodMode();
}
