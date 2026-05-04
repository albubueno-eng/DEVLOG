/**
 * ============================================================================
 *  ADMIN.JS — Painel God Mode (Admin) v2.3
 *  Arquivo Único Unificado - SRE, Quotas, Modais e Renderização
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

import { requireAuth, validateSessionOnBoot, getUserContext } from './auth.js';
import {
  relativeTime,
  formatDate,
  truncate,
  escapeHtml,
  initials,
  gradientFromString,
  debounce,
  formatNumber,
  slugify,
  maskCnpj
} from './utils.js';
import { matchKB } from './kb.js';
import { toast, toastSuccess, toastError } from './ui-shared.js';

// ============================================================================
// 1. CONFIG LOCAL DO ADMIN
// ============================================================================
const ADMIN_CONFIG = {
  LIMIT: 500,
  AUTO_REFRESH_MS: REFRESH_INTERVAL_MS,
  FETCH_TIMEOUT_MS: 20000,
  SEARCH_DEBOUNCE_MS: 180,
  LOCAL_TICK_MS: 30000
};

// ============================================================================
// 2. STATE GLOBAL
// ============================================================================
const state = {
  clientes: [],
  logs: [],
  eventosAuth: [],
  sessoesAtivas: [],
  saudeApps: [],
  totais: null,
  operacionais: null,
  filtroClienteId: '',
  activeTab: 'logs',
  isLoading: false,
  error: null,
  geradoEm: null,

  ui: {
    search: '',
    timeRange: '24h',                       
    severity: { ERRO: true, ALERTA: true, INFO: true },
    theme: 'light',
    capacityOpen: false,
    detailOpen: false,
    detailContext: null
  },

  user: {
    usuario: null,
    nivel: null,
    escopo: '*'
  }
};

// ============================================================================
// 3. SELETORES DOM
// ============================================================================
const dom = {
  // Topbar Auth
  loggedUserDisplay: document.getElementById('userMenu'),
  logoutBtn:         document.getElementById('logoutBtn'),

  // Layout & Sidebar
  clientList:       document.getElementById('clientList'),
  logsList:         document.getElementById('eventsList'),
  logsMeta:         document.getElementById('eventsMeta'),
  mainTitle:        document.getElementById('topbarTitle'),
  mainSubtitle:     document.getElementById('topbarSubtitle'),
  refreshBtn:       document.getElementById('refreshBtn'),
  connectionStatus: document.getElementById('systemStatus'),

  // Live Strip
  liveStripList:    document.getElementById('liveStripList'),
  liveStripMeta:    document.getElementById('liveStripMeta'),

  // Tabs
  eventTabs:        document.getElementById('tabsContainer'),
  tabCounts: {
    logs:     document.getElementById('tabCountLogs'),
    auth:     document.getElementById('tabCountAuth'),
    sessions: document.getElementById('tabCountSessions')
  },

  // KPIs
  kpiMain: {
    clientes:  document.getElementById('kpiClientes'),
    online:    document.getElementById('kpiOnline'),
    erros24h:  document.getElementById('kpiErros24h'),
    auth24h:   document.getElementById('kpiAuth24h')
  },
  kpiOps: {
    taxaErro:        document.getElementById('kpiTaxaErro'),
    loginsFalhos:    document.getElementById('kpiLoginsFalhos'),
    appsMonitorados: document.getElementById('kpiAppsMonitorados'),
    totalLogs:       document.getElementById('kpiTotalLogs')
  },

  // Toolbar
  searchInput:      document.getElementById('searchInput'),
  searchClearBtn:   document.getElementById('searchClear'),
  severityPills:    document.getElementById('severityPills'),
  pillCountErro:    document.getElementById('pillCountErro'),
  pillCountAlerta:  document.getElementById('pillCountAlerta'),
  pillCountInfo:    document.getElementById('pillCountInfo'),
  exportCsvBtn:     document.getElementById('exportCsvBtn'),
  exportPdfBtn:     document.getElementById('exportPdfBtn'),
  themeToggleBtn:   document.getElementById('themeToggleBtn'),
  timeFilterSelect: document.getElementById('timeRangeSelect'),

  // Drawers e Modais principais
  capacityBtn:            document.getElementById('capacityBtn'),
  capacityBadge:          document.getElementById('capacityBadge'),
  capacityDrawer:         document.getElementById('capacityDrawer'),
  capacitySummary:        document.getElementById('capacityDrawerSummary'),
  capacityList:           document.getElementById('capacityDrawerBody'),
  capacityMeta:           document.getElementById('capacityDrawerMeta'),

  detailDrawer:        document.getElementById('detailDrawer'),
  detailDrawerTitle:   document.getElementById('detailDrawerTitle'),
  detailDrawerBody:    document.getElementById('detailDrawerBody'),
  detailCopyBtn:       document.getElementById('detailDrawerCopyBtn'),
};

// ============================================================================
// 4. API LAYER
// ============================================================================
async function fetchDashboardData() {
  const token = localStorage.getItem(STORAGE_KEYS.TOKEN) || '';
  const escopo = state.user.escopo || '*';

  const url = `${SCRIPT_URL}?apiKey=${encodeURIComponent(API_KEY)}` +
              `&token=${encodeURIComponent(token)}` +
              `&limit=${ADMIN_CONFIG.LIMIT}` +
              `&idClienteVinculado=${encodeURIComponent(escopo)}`;

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), ADMIN_CONFIG.FETCH_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: ctrl.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error(`Timeout (${ADMIN_CONFIG.FETCH_TIMEOUT_MS / 1000}s).`);
    throw new Error('Falha de rede ou CORS.');
  }
  clearTimeout(timeoutId);

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const raw = await resp.text();
  let json;
  try { json = JSON.parse(raw); }
  catch { throw new Error('Resposta inválida do servidor.'); }

  if (json.error === 'Sessão inválida ou expirada') {
    forceLogout(); return;
  }
  if (!json.ok) throw new Error(json.error || 'Erro do servidor');
  return json.data;
}

async function adminApiPost(action, payload) {
  const token = localStorage.getItem(STORAGE_KEYS.TOKEN) || '';
  const resp = await fetch(SCRIPT_URL, {
    method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ apiKey: API_KEY, token, action, ...payload })
  });
  const raw = await resp.text();
  let json;
  try { json = JSON.parse(raw); }
  catch { throw new Error('Resposta inválida'); }

  if (json.error === 'Sessão inválida ou expirada') { forceLogout(); return; }
  if (!json.ok) throw new Error(json.error || 'Falha na operação');
  return json.data;
}

function forceLogout() {
  Object.values(STORAGE_KEYS).forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
  window.location.replace(ROUTES.LOGIN || './login.html');
}

// ============================================================================
// 5. STATE MUTATIONS
// ============================================================================
function setLoading(isLoading) {
  state.isLoading = isLoading;
  updateConnectionStatus();
  if (dom.refreshBtn) {
    dom.refreshBtn.disabled = isLoading;
    dom.refreshBtn.classList.toggle('is-loading', isLoading);
  }
}

function setError(error) {
  state.error = error;
  updateConnectionStatus();
}

function setData(data) {
  state.clientes      = Array.isArray(data.clientes)      ? data.clientes      : [];
  state.logs          = Array.isArray(data.logs)          ? data.logs          : [];
  state.eventosAuth   = Array.isArray(data.eventosAuth)   ? data.eventosAuth   : [];
  state.sessoesAtivas = Array.isArray(data.sessoesAtivas) ? data.sessoesAtivas : [];
  state.saudeApps     = Array.isArray(data.saudeApps)     ? data.saudeApps     : [];
  state.totais        = data.totais       || null;
  state.operacionais  = data.operacionais || null;
  state.geradoEm      = data.geradoEm     || new Date().toISOString();
  state.error         = null;
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
  if (!(sev in state.ui.severity)) return;
  state.ui.severity[sev] = !state.ui.severity[sev];
  renderSeverityPills();
  renderEventsList();
  renderHeader();
}

// ============================================================================
// 6. SELETORES DERIVADOS & MTTR
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

function getNomeCliente(id) {
  if (!id) return 'Todos os Clientes';
  const c = state.clientes.find(c => String(c.idCliente) === String(id));
  return c ? c.nomeCliente : id;
}

// MTTR [GM-06]
function calcularMTTR(logs) {
  const resolvidos = logs.filter(l => String(l.status).toUpperCase() === 'RESOLVIDO');
  if (!resolvidos.length) return null;

  let totalMs = 0;
  let validCount = 0;

  for (const l of resolvidos) {
    const criadoEm = new Date(l.timestamp).getTime();
    if (isNaN(criadoEm)) continue;

    const resolvidoEm = new Date(l.resolvidoEm).getTime();
    if (!isNaN(resolvidoEm) && resolvidoEm >= criadoEm) {
      totalMs += (resolvidoEm - criadoEm);
      validCount++;
    } else {
      const linhasHist = String(l.historico || '').split('\n');
      const linhaRes = linhasHist.find(x => x.includes('RESOLVIDO'));
      if (linhaRes) {
        const match = linhaRes.match(/\[(.*?)\]/);
        if (match && match[1]) {
          const partes = match[1].replace(',', '').split(' ');
          if (partes.length >= 2) {
            const [d, m, y] = partes[0].split('/');
            const [hora, min, sec] = partes[1].split(':');
            const fallbackEm = new Date(y, m - 1, d, hora, min, sec).getTime();
            if (!isNaN(fallbackEm) && fallbackEm >= criadoEm) {
              totalMs += (fallbackEm - criadoEm);
              validCount++;
            }
          }
        }
      }
    }
  }

  if (validCount === 0) return null;
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

// Filtros
function applyTimeFilter(items) {
  if (state.ui.timeRange === 'all') return items;
  const agora = Date.now();
  let limiteMs = 0;
  if (state.ui.timeRange === '1h')  limiteMs = 1 * 60 * 60 * 1000;
  if (state.ui.timeRange === '24h') limiteMs = 24 * 60 * 60 * 1000;
  if (state.ui.timeRange === '7d')  limiteMs = 7 * 24 * 60 * 60 * 1000;
  if (state.ui.timeRange === '30d') limiteMs = 30 * 24 * 60 * 60 * 1000;
  const dataCorte = agora - limiteMs;
  return items.filter(item => {
    const dataStr = item.timestamp || item.inicioSessao;
    if (!dataStr) return true;
    const ts = new Date(dataStr).getTime();
    if (isNaN(ts)) return true;
    return ts >= dataCorte;
  });
}

function contains(field, q) {
  if (!field) return false;
  return String(field).toLowerCase().includes(q);
}

function applySearchFilter(items, kind) {
  const q = state.ui.search;
  if (!q) return items;
  if (kind === 'logs') {
    return items.filter(l => contains(l.aplicativo, q) || contains(l.usuario, q) || contains(l.mensagemErro, q) || contains(getNomeCliente(l.idCliente), q));
  }
  if (kind === 'auth') {
    return items.filter(a => contains(a.aplicativo, q) || contains(a.usuario, q) || contains(a.tipoEvento, q) || contains(getNomeCliente(a.idCliente), q));
  }
  return items.filter(s => contains(s.aplicativo, q) || contains(s.usuario, q) || contains(getNomeCliente(s.idCliente), q));
}

function getEventsForActiveTab() {
  if (state.activeTab === 'auth') return applySearchFilter(applyTimeFilter(getAuthFiltradosCliente()), 'auth');
  if (state.activeTab === 'sessions') return applySearchFilter(applyTimeFilter(getSessoesFiltradasCliente()), 'sessions');
  const logs = getLogsFiltradosCliente().filter(l => state.ui.severity[String(l.tipoLog || 'INFO').toUpperCase()] === true);
  return applySearchFilter(applyTimeFilter(logs), 'logs');
}

function contarSaudeAlertas() {
  let n = 0;
  for (const a of state.saudeApps) {
    const st = String(a.status || '').toUpperCase();
    if (st === 'CRITICO' || st === 'ALERTA' || st === 'OFFLINE') n++;
  }
  return n;
}

// ============================================================================
// 7. RENDER LAYER
// ============================================================================
function contarErrosAbertosPorCliente() {
  const map = new Map();
  let totalErros = 0;
  for (const l of state.logs) {
    if (String(l.tipoLog).toUpperCase() === 'ERRO' && String(l.status).toUpperCase() !== 'RESOLVIDO') {
      const id = String(l.idCliente);
      map.set(id, (map.get(id) || 0) + 1);
      totalErros++;
    }
  }
  return { map, totalErros };
}

function renderSidebar() {
  const ul = dom.clientList;
  if (!ul) return;
  ul.textContent = '';
  
  const { map: contagensErros, totalErros } = contarErrosAbertosPorCliente();
  const ativoId = state.filtroClienteId;
  ul.appendChild(buildClientItem('', 'Todos os Clientes', totalErros, ativoId === '', 'client-item--all'));

  if (!state.clientes.length) {
    ul.innerHTML += '<li class="client-list__placeholder">Nenhum cliente cadastrado.</li>';
    return;
  }
  for (const c of state.clientes) {
    const id = String(c.idCliente);
    ul.appendChild(buildClientItem(id, c.nomeFantasia || c.nome || id, contagensErros.get(id) || 0, ativoId === id));
  }
}

function buildClientItem(id, nome, count, ativo, mod = '') {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `client-item ${ativo ? 'client-item--active' : ''} ${mod}`;
  btn.dataset.clientId = id;
  
  const nameEl = document.createElement('span');
  nameEl.className = 'client-item__name';
  nameEl.textContent = nome;

  const countEl = document.createElement('span');
  countEl.className = 'client-item__count';
  if (count > 0) {
    countEl.style.cssText = 'background:rgba(239,68,68,0.15); color:#EF4444; border:1px solid rgba(239,68,68,0.3); font-weight:bold;';
  }
  countEl.textContent = count;

  btn.append(nameEl, countEl);
  li.appendChild(btn);
  return li;
}

function computeKPIs() {
  const totais = state.totais || {};
  const ops = state.operacionais || {};
  const isGlobal = !state.filtroClienteId;
  
  if (isGlobal) {
    return {
      clientes: totais.clientes || 0,
      online: ops.appsMonitorados || state.sessoesAtivas.length,
      erros24h: totais.erros24h || 0,
      auth24h: totais.autenticacoes24h || 0,
      taxaErro: typeof ops.taxaErro === 'string' ? ops.taxaErro : `${ops.taxaErro || 0}%`,
      loginsFalhos: ops.loginsFalhos24h || 0,
      apps: ops.appsMonitorados || state.saudeApps.length,
      totalLogs: totais.logs || state.logs.length
    };
  }
  
  const logsCli = getLogsFiltradosCliente();
  const authCli = getAuthFiltradosCliente();
  const logs24h = applyTimeFilter(logsCli);
  const erros24h = logs24h.filter(l => String(l.tipoLog).toUpperCase() === 'ERRO').length;
  const taxaErroNum = logs24h.length ? Math.round((erros24h / logs24h.length) * 100) : 0;

  return {
    clientes: 1,
    online: getSessoesFiltradasCliente().length,
    erros24h,
    auth24h: applyTimeFilter(authCli).length,
    taxaErro: `${taxaErroNum}%`,
    loginsFalhos: authCli.filter(a => String(a.tipoEvento).toUpperCase() === 'LOGIN_FALHA').length,
    apps: state.saudeApps.filter(a => String(a.idCliente) === state.filtroClienteId).length,
    totalLogs: logsCli.length
  };
}

function renderMain() {
  renderHeader();
  const kpis = computeKPIs();
  
  if (dom.kpiMain.clientes) dom.kpiMain.clientes.textContent = formatNumber(kpis.clientes);
  if (dom.kpiMain.online)   dom.kpiMain.online.textContent   = formatNumber(kpis.online);
  if (dom.kpiMain.erros24h) dom.kpiMain.erros24h.textContent = formatNumber(kpis.erros24h);
  if (dom.kpiMain.auth24h)  dom.kpiMain.auth24h.textContent  = formatNumber(kpis.auth24h);

  if (dom.kpiOps.taxaErro)        dom.kpiOps.taxaErro.textContent        = kpis.taxaErro;
  if (dom.kpiOps.loginsFalhos)    dom.kpiOps.loginsFalhos.textContent    = formatNumber(kpis.loginsFalhos);
  if (dom.kpiOps.appsMonitorados) dom.kpiOps.appsMonitorados.textContent = formatNumber(kpis.apps);
  if (dom.kpiOps.totalLogs)       dom.kpiOps.totalLogs.textContent       = formatNumber(kpis.totalLogs);

  renderLiveStrip();
  renderTabs();
  renderToolbarVisibility();
  renderSeverityPills();
  renderSearchClearVisibility();
  renderEventsList();
  
  if (dom.kpiOps.totalLogs && !state.filtroClienteId) {
    const mttr = calcularMTTR(state.logs);
    dom.kpiOps.totalLogs.title = `MTTR Global: ${mttr || 'N/A'}`; 
  }
}

function renderHeader() {
  const nome = getNomeCliente(state.filtroClienteId);
  const filtrando = !!state.filtroClienteId;
  if (dom.mainTitle) dom.mainTitle.textContent = filtrando ? nome : 'Central de Desenvolvedor';
  if (dom.mainSubtitle) dom.mainSubtitle.textContent = filtrando ? `Telemetria isolada do cliente ${nome}` : 'God Mode';
  
  const total = getEventsForActiveTab().length;
  if (dom.logsMeta) dom.logsMeta.textContent = `${formatNumber(total)} evento(s) listado(s)`;
}

function renderLiveStrip() {
  const list = dom.liveStripList;
  if (!list) return;
  list.textContent = '';
  const sessoes = state.sessoesAtivas;

  if (!sessoes.length) {
    list.dataset.empty = 'true';
    if (dom.liveStripMeta) dom.liveStripMeta.textContent = '0 ativos';
    return;
  }
  delete list.dataset.empty;
  if (dom.liveStripMeta) dom.liveStripMeta.textContent = `${sessoes.length} ativo(s)`;

  sessoes.slice(0, 10).forEach(s => {
    const chip = document.createElement('div');
    chip.className = 'live-chip';
    chip.innerHTML = `
      <div class="live-chip__avatar" style="background:${gradientFromString(s.usuario)}">${initials(s.usuario)}</div>
      <div class="live-chip__body">
        <span class="live-chip__name">${escapeHtml(s.usuario || '—')}</span>
        <span class="live-chip__sub">${escapeHtml(s.aplicativo)} · online</span>
      </div>`;
    list.appendChild(chip);
  });
}

function renderTabs() {
  if (dom.tabCounts.logs) dom.tabCounts.logs.textContent = formatNumber(getLogsFiltradosCliente().length);
  if (dom.tabCounts.auth) dom.tabCounts.auth.textContent = formatNumber(getAuthFiltradosCliente().length);
  if (dom.tabCounts.sessions) dom.tabCounts.sessions.textContent = formatNumber(getSessoesFiltradasCliente().length);

  if (dom.eventTabs) {
    dom.eventTabs.querySelectorAll('.tab').forEach(btn => {
      btn.classList.toggle('tab--active', btn.dataset.tab === state.activeTab);
    });
  }
}

function renderToolbarVisibility() {
  if (dom.severityPills) dom.severityPills.hidden = (state.activeTab !== 'logs');
}

function renderSeverityPills() {
  if (!dom.severityPills) return;
  const logs = getLogsFiltradosCliente();
  const counts = { ERRO: 0, ALERTA: 0, INFO: 0 };
  logs.forEach(l => { const t = String(l.tipoLog || '').toUpperCase(); if (t in counts) counts[t]++; });

  if (dom.pillCountErro)   dom.pillCountErro.textContent   = formatNumber(counts.ERRO);
  if (dom.pillCountAlerta) dom.pillCountAlerta.textContent = formatNumber(counts.ALERTA);
  if (dom.pillCountInfo)   dom.pillCountInfo.textContent   = formatNumber(counts.INFO);

  dom.severityPills.querySelectorAll('.pill').forEach(p => {
    p.classList.toggle('is-active', !!state.ui.severity[p.dataset.severity]);
  });
}

function renderSearchClearVisibility() {
  if (dom.searchClearBtn) dom.searchClearBtn.style.visibility = state.ui.search ? 'visible' : 'hidden';
}

function renderEventsList() {
  const list = dom.logsList;
  if (!list) return;
  list.textContent = '';

  const items = getEventsForActiveTab().sort((a,b) => new Date(b.timestamp || b.inicioSessao) - new Date(a.timestamp || a.inicioSessao));

  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state__icon">✓</div><p class="empty-state__title">Nenhum registro encontrado</p></div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  items.slice(0, 100).forEach(item => {
    const card = document.createElement('article');
    
    if (state.activeTab === 'logs') {
      const isErro = String(item.tipoLog).toUpperCase() === 'ERRO';
      const status = String(item.status || 'ABERTO').toUpperCase();
      card.className = `log-card ${isErro ? 'log-card--erro' : 'log-card--info'}`;
      card.innerHTML = `
        <div class="log-card__icon">${isErro ? '!' : 'i'}</div>
        <div class="log-card__body">
          <div class="log-card__head">
            <span class="log-card__app">${escapeHtml(item.aplicativo)}</span>
            <span class="log-card__client">${escapeHtml(getNomeCliente(item.idCliente))}</span>
            ${status === 'RESOLVIDO' 
              ? `<span style="margin-left:8px; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; background:rgba(16,185,129,0.1); color:#10B981;">RESOLVIDO</span>`
              : (isErro ? `<span style="margin-left:8px; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; background:rgba(239,68,68,0.1); color:#EF4444;">ABERTO</span>` : '')
            }
          </div>
          <pre class="log-card__message">${escapeHtml(truncate(item.mensagemErro, 200))}</pre>
        </div>
        <time class="log-card__time">${relativeTime(item.timestamp)}</time>`;
      card.onclick = () => openDetailDrawer('log', item);
    } 
    else if (state.activeTab === 'auth') {
      const isFail = String(item.tipoEvento).toUpperCase().includes('FALHA');
      card.className = `auth-card ${isFail ? 'auth-card--fail' : 'auth-card--success'}`;
      card.innerHTML = `
        <div class="auth-card__icon">${isFail ? '✗' : '✓'}</div>
        <div class="auth-card__body">
          <div class="auth-card__head">
            <span class="auth-card__user">${escapeHtml(item.usuario)}</span>
            <span class="log-card__client">${escapeHtml(getNomeCliente(item.idCliente))}</span>
          </div>
          <div class="auth-card__meta"><span>${escapeHtml(item.aplicativo)}</span></div>
        </div>
        <time class="auth-card__time">${relativeTime(item.timestamp)}</time>`;
      card.onclick = () => openDetailDrawer('auth', item);
    }
    else if (state.activeTab === 'sessions') {
      const isOnline = String(item.status).toUpperCase() === 'ATIVA';
      card.className = 'session-card';
      card.innerHTML = `
        <div class="session-card__avatar" style="background:${gradientFromString(item.usuario)}">${initials(item.usuario)}</div>
        <div class="session-card__body">
          <div class="session-card__head">
            <span class="session-card__name">${escapeHtml(item.usuario || '—')}</span>
            <span class="session-card__app">${escapeHtml(item.aplicativo || '—')}</span>
            <span class="log-card__client">${escapeHtml(getNomeCliente(item.idCliente))}</span>
          </div>
          <div class="session-card__meta">
            <span>${escapeHtml(item.dispositivo)}</span>
            <span>· Último ping: ${relativeTime(item.ultimoPing)}</span>
          </div>
        </div>
        <div class="session-card__time">
          <span class="session-card__duration">Online</span>
        </div>`;
      card.onclick = () => openDetailDrawer('session', item);
    }
    
    frag.appendChild(card);
  });
  list.appendChild(frag);
}

// ============================================================================
// 8. DETAIL DRAWER + [GM-04] Resolver Log
// ============================================================================
function openDetailDrawer(kind, data) {
  state.ui.detailOpen = true;
  state.ui.detailContext = { kind, data };
  
  if (dom.detailDrawerTitle) dom.detailDrawerTitle.textContent = kind === 'log' ? 'Detalhe do Log' : 'Detalhe do Evento';
  
  const body = dom.detailDrawerBody;
  if (!body) return;

  if (kind === 'log') {
    const status = String(data.status || 'ABERTO').toUpperCase();
    const isResolvido = status === 'RESOLVIDO';
    const kbMatch = matchKB(data.mensagemErro);
    
    let kbHtml = '';
    if (kbMatch) {
      kbHtml = `
        <div class="detail-section" style="margin-top:16px; padding:12px; background:rgba(59,130,246,0.05); border:1px solid #3b82f6; border-radius:8px;">
          <h3 class="detail-section__title" style="color:#3b82f6; font-size:13px;">📚 Knowledge Base</h3>
          <p style="font-size:12px; margin-top:4px;"><strong>Padrão:</strong> ${escapeHtml(kbMatch.id)} - ${escapeHtml(kbMatch.titulo)}</p>
          <p style="font-size:12px; margin-top:4px;"><strong>Solução Sugerida:</strong> ${escapeHtml(kbMatch.solucao)}</p>
        </div>`;
    }

    body.innerHTML = `
      <div class="detail-meta">
        <div class="detail-meta__key">Status</div>
        <div class="detail-meta__val" style="font-weight:bold; color:${isResolvido ? '#10b981' : '#dc2626'}">${status}</div>
        <div class="detail-meta__key">Usuário</div><div class="detail-meta__val">${escapeHtml(data.usuario)}</div>
        <div class="detail-meta__key">App</div><div class="detail-meta__val">${escapeHtml(data.aplicativo)}</div>
        ${isResolvido ? `
          <div class="detail-meta__key">Resolvido por</div><div class="detail-meta__val">${escapeHtml(data.resolvidoPor)}</div>
          <div class="detail-meta__key">Resolução</div><div class="detail-meta__val">${escapeHtml(data.resolucao)}</div>
        ` : ''}
      </div>
      <div class="detail-section">
        <h3 class="detail-section__title">Mensagem</h3>
        <pre class="detail-message">${escapeHtml(data.mensagemErro)}</pre>
      </div>
      ${kbHtml}
      ${!isResolvido && String(data.tipoLog).toUpperCase() === 'ERRO' ? `
        <button class="btn btn--primary btn--block" id="gm-resolve-btn" style="margin-top:16px;">
          ✓ Marcar como Resolvido
        </button>
      ` : ''}
    `;

    const resolveBtn = body.querySelector('#gm-resolve-btn');
    if (resolveBtn) {
      resolveBtn.onclick = async () => {
        const resolucao = prompt('Anotação de resolução (opcional):');
        if (resolucao === null) return;
        try {
          resolveBtn.textContent = 'Resolvendo...';
          await adminApiPost('updatelogstatus', { idLog: data.idLog, resolucao });
          toastSuccess('Log marcado como resolvido!');
          closeDetailDrawer();
          loadData();
        } catch(e) {
          toastError('Falha ao resolver: ' + e.message);
          resolveBtn.textContent = '✓ Marcar como Resolvido';
        }
      };
    }
  } else {
    body.innerHTML = `<pre class="detail-message">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  }

  dom.detailDrawer.hidden = false;
  dom.detailDrawer.classList.add('drawer--open');
}

export function closeDetailDrawer() {
  state.ui.detailOpen = false;
  state.ui.detailContext = null;
  if(dom.detailDrawer) {
    dom.detailDrawer.classList.remove('drawer--open');
    setTimeout(() => { dom.detailDrawer.hidden = true; }, 250);
  }
}

// ============================================================================
// 9. REFRESH E CONEXÃO
// ============================================================================
function updateConnectionStatus() {
  const pill = dom.connectionStatus;
  if (!pill) return;
  const textEl = pill.querySelector('.status-pill__label') || pill.querySelector('.status-pill__text');
  if (state.isLoading) {
    pill.dataset.state = 'loading';
    if (textEl) textEl.textContent = 'Sincronizando…';
  } else if (state.error) {
    pill.dataset.state = 'error';
    if (textEl) textEl.textContent = 'Erro de conexão';
  } else {
    pill.dataset.state = 'online';
    if (textEl) textEl.textContent = 'Online';
  }
}

function updateRefreshButton() {
  if (!dom.refreshBtn) return;
  dom.refreshBtn.disabled = state.isLoading;
}

// ============================================================================
// 10. TEMA (Ligh/Dark)
// ============================================================================
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
    dom.themeToggleBtn.setAttribute('aria-label', theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro');
    dom.themeToggleBtn.title = theme === 'dark' ? 'Tema escuro ativo' : 'Tema claro ativo';
  }
}

// ============================================================================
// 11. EXPORT CSV & PDF [GM-09]
// ============================================================================
const CSV_HEADERS = {
  logs:     ['timestamp', 'tipoLog', 'idCliente', 'cliente', 'aplicativo', 'usuario', 'dispositivo', 'mensagemErro'],
  auth:     ['timestamp', 'tipoEvento', 'idCliente', 'cliente', 'aplicativo', 'usuario', 'dispositivo', 'detalhes'],
  sessions: ['inicioSessao', 'ultimoPing', 'idCliente', 'cliente', 'aplicativo', 'usuario', 'dispositivo']
};

function exportCurrentTabAsCSV() {
  const tab = state.activeTab;
  const items = getEventsForActiveTab();
  if (!items.length) {
    flashExportButton('Nada para exportar', dom.exportCsvBtn);
    return;
  }
  const headers = CSV_HEADERS[tab];
  const lines = [headers.join(',')];

  for (const item of items) {
    const enriched = { ...item, cliente: getNomeCliente(item.idCliente) };
    const row = headers.map(h => csvEscape(enriched[h]));
    lines.push(row.join(','));
  }

  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const filename = buildExportFilename(tab, 'csv');

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
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
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'pt', 'a4');
    const headers = CSV_HEADERS[tab];
    const body = items.map(item => {
      const enriched = { ...item, cliente: getNomeCliente(item.idCliente) };
      return headers.map(h => String(enriched[h] || ''));
    });

    const titles = { logs: 'Logs e Erros', auth: 'Autenticações', sessions: 'Sessões Ativas' };
    doc.setFontSize(16);
    doc.text(`Relatório God Mode - ${titles[tab] || tab.toUpperCase()}`, 40, 40);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')} · ${items.length} registros`, 40, 55);

    doc.autoTable({
      startY: 70,
      head: [headers],
      body: body,
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [11, 27, 51], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] }
    });

    doc.save(buildExportFilename(tab, 'pdf'));
    flashExportButton('✓ Gerado', dom.exportPdfBtn);
  } catch (e) {
    flashExportButton('Erro', dom.exportPdfBtn);
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildExportFilename(tab, ext) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const cli = state.filtroClienteId ? `_${slugify(getNomeCliente(state.filtroClienteId))}` : '_todos';
  return `godmode_${tab}${cli}_${stamp}.${ext}`;
}

function flashExportButton(msg, btnElement) {
  if (!btnElement) return;
  const original = btnElement.textContent;
  btnElement.textContent = msg;
  btnElement.disabled = true;
  setTimeout(() => { btnElement.textContent = original; btnElement.disabled = false; }, 1400);
}

// ============================================================================
// 12. CAPACITY MONITOR (Saúde do BD)
// ============================================================================
function renderCapacityBadge() {
  if (!dom.capacityBadge) return;
  const apps = state.saudeApps || [];
  const criticos = apps.filter(a => ['CRITICO', 'ALERTA'].includes(String(a.status || ''))).length;
  if (criticos > 0) {
    dom.capacityBadge.textContent = String(criticos);
    dom.capacityBadge.style.display = '';
  } else {
    dom.capacityBadge.style.display = 'none';
  }
}

export function openCapacityDrawer() {
  state.ui.capacityOpen = true;
  if (!dom.capacityDrawer) return;
  
  const apps = state.saudeApps || [];
  if (dom.capacitySummary) {
    const cont = { SAUDAVEL:0, ATENCAO:0, ALERTA:0, CRITICO:0, OFFLINE:0, MIGRADO:0, PENDING:0 };
    apps.forEach(a => { const s = String(a.status || 'PENDING').toUpperCase(); if (cont[s] !== undefined) cont[s]++; });
    const ordem = ['CRITICO','ALERTA','ATENCAO','SAUDAVEL','PENDING','OFFLINE','MIGRADO'];
    dom.capacitySummary.innerHTML = ordem.filter(k => cont[k] > 0).map(k => `
      <span class="cap-chip cap-chip--${k.toLowerCase()}">
        <span class="cap-chip__dot"></span><span>${escapeHtml(k)}</span><span class="cap-chip__count">${cont[k]}</span>
      </span>
    `).join('');
  }

  if (dom.capacityList) {
    if (!apps.length) {
      dom.capacityList.innerHTML = `<div class="empty-state"><p>Nenhum app monitorado.</p></div>`;
    } else {
      const peso = (s) => ({ CRITICO:0, ALERTA:1, ATENCAO:2, SAUDAVEL:3, PENDING:4, OFFLINE:5, MIGRADO:6 })[String(s||'').toUpperCase()] ?? 9;
      const sorted = [...apps].sort((a, b) => peso(a.status) - peso(b.status));
      dom.capacityList.innerHTML = sorted.map(a => {
        const status = String(a.status || 'PENDING').toUpperCase();
        const perc = Number(a.percUso) || 0;
        const fillNum = Math.max(0.01, Math.min(1, perc / 100));
        return `
          <article class="cap-card" data-status="${escapeHtml(status)}">
            <div class="cap-card__head">
              <div>
                <div class="cap-card__title">${escapeHtml((a.app || 'app') + ' · ' + (a.idCliente || ''))}</div>
                <div class="cap-card__sub">${escapeHtml(a.idApp ? 'ID: ' + truncate(a.idApp, 20) : '')}</div>
              </div>
              <span class="cap-card__status">${escapeHtml(status)}</span>
            </div>
            <div class="cap-bar">
              <div class="cap-bar__fill" style="width:${perc.toFixed(1)}%;--cap-fill:${perc.toFixed(1)}%;--cap-fill-num:${fillNum}"></div>
            </div>
            <div class="cap-card__metrics">
              <div class="cap-metric"><div class="cap-metric__label">Uso</div><div class="cap-metric__value">${perc.toFixed(1)}%</div></div>
              <div class="cap-metric"><div class="cap-metric__label">Linhas</div><div class="cap-metric__value">${formatNumber(a.qtdLinhas || 0)}</div></div>
              <div class="cap-metric"><div class="cap-metric__label">Tamanho</div><div class="cap-metric__value">${(a.tamanhoMB || 0).toFixed(2)} MB</div></div>
            </div>
          </article>
        `;
      }).join('');
    }
  }

  dom.capacityDrawer.hidden = false;
  dom.capacityDrawer.setAttribute('aria-hidden', 'false');
}

export function closeCapacityDrawer() {
  state.ui.capacityOpen = false;
  if (dom.capacityDrawer) {
    dom.capacityDrawer.hidden = true;
    dom.capacityDrawer.setAttribute('aria-hidden', 'true');
  }
}

// ============================================================================
// 13. MONITOR DE CLIENTES V3 (Quotas)
// ============================================================================
export async function openQuotaMonitor() {
  let modal = document.getElementById('capacityMonitorModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'capacityMonitorModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.hidden = true;
    modal.innerHTML = `
      <div data-close style="position:absolute;inset:0;background:rgba(0,0,0,0.5);"></div>
      <div style="position:relative;background:#fff;border-radius:12px;max-width:920px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:18px;color:#000;">👥 Monitor de Clientes (Quotas)</h3>
          <button type="button" data-close style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;">✕</button>
        </div>
        <div id="capMonBody" style="padding:16px 20px;overflow-y:auto;flex:1;color:#000;">
          <p style="color:#6b7280;">Buscando dados de licenciamento...</p>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', e => {
      if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) modal.hidden = true;
    });
  }
  
  modal.hidden = false;
  const body = document.getElementById('capMonBody');
  body.innerHTML = '<p style="color:#6b7280;">Carregando métricas de licenciamento...</p>';
  
  try {
    const data = await adminApiPost('getcapacitymonitor', {});
    if (!data || !data.clientes || !data.clientes.length) {
      body.innerHTML = '<p style="color:#6b7280;">Nenhum cliente cadastrado.</p>';
      return;
    }
    body.innerHTML = `
      <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;font-size:13px;">
        <div style="background:#f3f4f6;padding:8px 12px;border-radius:6px;"><strong>${data.totais.clientes}</strong> clientes</div>
        <div style="background:#f3f4f6;padding:8px 12px;border-radius:6px;"><strong>${data.totais.funcionarios}</strong> licenças ativas</div>
        <div style="background:#f3f4f6;padding:8px 12px;border-radius:6px;">Capacidade Total: <strong>${data.totais.capacidadeTotal}</strong></div>
      </div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;text-align:left;">
        <thead>
          <tr style="background:#f3f4f6;border-bottom:2px solid #e5e7eb;">
            <th style="padding:10px;">Cliente</th>
            <th style="padding:10px;">Plano</th>
            <th style="padding:10px;width:40%;">Uso (Assentos)</th>
            <th style="padding:10px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.clientes.map(c => `
            <tr style="border-bottom:1px solid #e5e7eb;">
              <td style="padding:10px;"><strong>${c.nome}</strong><br><small style="color:#6b7280;">${c.idCliente}</small></td>
              <td style="padding:10px;">${c.plano}</td>
              <td style="padding:10px;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <div style="flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;">
                    <div style="width:${Math.min(100,c.percentual)}%;height:100%;background:${c.status==='cheio'?'#dc2626':c.status==='atencao'?'#f59e0b':'#10b981'};"></div>
                  </div>
                  <span style="font-size:12px;">${c.usados}/${c.quota}</span>
                </div>
              </td>
              <td style="padding:10px;">
                <span style="padding:2px 8px;border-radius:10px;font-size:11px;background:${c.status==='cheio'?'#fee2e2':c.status==='atencao'?'#fef3c7':'#d1fae5'};color:${c.status==='cheio'?'#991b1b':c.status==='atencao'?'#92400e':'#065f46'}">
                  ${c.status.toUpperCase()}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    body.innerHTML = `<div style="background:#fee2e2;color:#991b1b;padding:12px;border-radius:6px;">❌ Falha ao carregar as Quotas: ${e.message}</div>`;
  }
}

// ============================================================================
// 14. FORMULÁRIO NOVO CLIENTE
// ============================================================================
function openNewClientModal() {
  const modalObj = document.getElementById('newClientModal');
  const formObj = document.getElementById('formNovoCliente');
  if (!modalObj || !formObj) return;
  formObj.reset();
  formObj.querySelectorAll('.is-invalid, .is-valid').forEach(el => el.classList.remove('is-invalid', 'is-valid'));
  const banner = formObj.querySelector('.form__banner');
  if (banner) banner.remove();
  
  modalObj.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => formObj.querySelector('input')?.focus(), 50);
}

function closeNewClientModal() {
  const modalObj = document.getElementById('newClientModal');
  if (modalObj) modalObj.hidden = true;
  document.body.style.overflow = '';
}

async function handleNewClientSubmit(e) {
  e.preventDefault();
  const formObj = e.target;
  const btnSubmit = formObj.querySelector('button[type="submit"]');
  const banner = formObj.querySelector('.form__banner');
  if (banner) banner.remove();

  const getVal = id => formObj.querySelector(`#${id}`)?.value.trim() || '';
  const payload = {
    idCliente: getVal('ncIdCliente').toLowerCase(),
    nome: getVal('ncRazaoSocial'),
    nomeFantasia: getVal('ncNomeFantasia') || getVal('ncRazaoSocial'),
    cnpj: getVal('ncCnpj').replace(/\D/g, ''),
    email: getVal('ncEmail'),
    telefone: getVal('ncTelefone'),
    plano: getVal('ncPlano'),
    quotaFuncionarios: Number(getVal('ncQuota')),
    logoUrl: getVal('ncLogoUrl'),
    corPrimaria: getVal('ncCorPrimaria') || '#2563eb'
  };

  if (!/^[a-z0-9_-]{2,32}$/.test(payload.idCliente)) {
    toastError('O ID do Cliente deve conter apenas a-z, 0-9, - ou _');
    return;
  }

  btnSubmit.disabled = true;
  btnSubmit.innerHTML = 'Cadastrando...';

  try {
    await adminApiPost('createClient', payload);
    toastSuccess('Cliente cadastrado com sucesso!');
    closeNewClientModal();
    await loadData();
    setFilter(payload.idCliente);
  } catch (err) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'form__banner';
    errorDiv.style.cssText = 'margin:12px 20px 0; padding:8px 12px; border-radius:6px; font-size:12px; font-weight:500; background:rgba(220,38,38,0.08); color:#b91c1c; border-left:3px solid #dc2626;';
    errorDiv.textContent = `Falha ao cadastrar: ${err.message}`;
    formObj.insertBefore(errorDiv, formObj.firstChild);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = 'Cadastrar cliente';
  }
}

// ============================================================================
// 15. BIND EVENTS
// ============================================================================
function bindEvents() {
  // Topbar
  if (dom.refreshBtn) dom.refreshBtn.addEventListener('click', () => loadData());
  if (dom.logoutBtn) dom.logoutBtn.addEventListener('click', forceLogout);
  if (dom.themeToggleBtn) dom.themeToggleBtn.addEventListener('click', () => setTheme(state.ui.theme === 'dark' ? 'light' : 'dark'));

  // Sidebar e Filtros
  if (dom.clientList) {
    dom.clientList.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.client-item');
      if (btn) setFilter(btn.dataset.clientId ?? '');
    });
  }
  if (dom.eventTabs) {
    dom.eventTabs.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab');
      if (btn) setActiveTab(btn.dataset.tab);
    });
  }
  if (dom.searchInput) {
    const dSearch = debounce((val) => setSearch(val), ADMIN_CONFIG.SEARCH_DEBOUNCE_MS);
    dom.searchInput.addEventListener('input', (ev) => dSearch(ev.target.value));
  }
  if (dom.searchClearBtn) {
    dom.searchClearBtn.addEventListener('click', () => {
      dom.searchInput.value = '';
      setSearch('');
    });
  }
  if (dom.severityPills) {
    dom.severityPills.addEventListener('click', (ev) => {
      const p = ev.target.closest('.pill');
      if (p) toggleSeverity(p.dataset.severity);
    });
  }
  if (dom.timeFilterSelect) {
    dom.timeFilterSelect.addEventListener('change', (ev) => {
      state.ui.timeRange = ev.target.value;
      renderEventsList();
      renderHeader();
    });
  }

  // Drawers & Modals
  if (dom.exportCsvBtn) dom.exportCsvBtn.addEventListener('click', exportCurrentTabAsCSV);
  if (dom.exportPdfBtn) dom.exportPdfBtn.addEventListener('click', exportCurrentTabAsPDF);
  if (dom.capacityBtn)  dom.capacityBtn.addEventListener('click', openCapacityDrawer);
  
  // Delegação de fechar modais/drawers
  document.addEventListener('click', e => {
    if (e.target.closest('#capacityDrawerCloseBtn') || e.target.closest('#capacityDrawer .drawer__backdrop')) {
      closeCapacityDrawer();
    }
    if (e.target.closest('#detailDrawerCloseBtn') || e.target.closest('#detailDrawer .drawer__backdrop')) {
      closeDetailDrawer();
    }
    if (e.target.closest('#newClientCloseBtn') || e.target.closest('#newClientModal .modal__backdrop') || e.target.closest('#newClientModal .btn--ghost')) {
      closeNewClientModal();
    }
    // Abre modal de cliente se clicar no botão +
    if (e.target.closest('#newClientBtn') || e.target.closest('#fabNovoCliente')) {
      openNewClientModal();
    }
  });

  // Intercepta submit do form de novo cliente
  const formNovoCliente = document.getElementById('formNovoCliente');
  if (formNovoCliente) formNovoCliente.addEventListener('submit', handleNewClientSubmit);

  // Máscaras de formulário
  const cnpjInput = document.getElementById('ncCnpj');
  if (cnpjInput) {
    cnpjInput.addEventListener('input', (e) => {
      e.target.value = maskCnpj(e.target.value);
    });
  }

  // Atalhos Globais
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closeDetailDrawer();
      closeCapacityDrawer();
      closeNewClientModal();
      return;
    }
    const isInput = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (isInput || ev.metaKey || ev.ctrlKey) return;
    
    const k = ev.key.toLowerCase();
    if (k === 'r') loadData();
    else if (k === '1') setActiveTab('logs');
    else if (k === '2') setActiveTab('auth');
    else if (k === '3') setActiveTab('sessions');
    else if (k === '/') {
      ev.preventDefault();
      if (dom.searchInput) dom.searchInput.focus();
    } 
    else if (k === 't') setTheme(state.ui.theme === 'dark' ? 'light' : 'dark');
    else if (k === 'c') state.ui.capacityOpen ? closeCapacityDrawer() : openCapacityDrawer();
  });
}

// ============================================================================
// 16. AUTO-REFRESH E TICK
// ============================================================================
let autoRefreshTimer = null;
let localTickTimer = null;

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(() => {
    if (!state.isLoading && document.visibilityState === 'visible') loadData();
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
// 17. ORCHESTRATION (Load Data)
// ============================================================================
async function loadData() {
  if (state.isLoading) return;
  setLoading(true);
  setError(null);
  try {
    const data = await fetchDashboardData();
    if (!data) return; // forceLogout já redirecionou
    setData(data);
    if (state.filtroClienteId && !state.clientes.some(c => String(c.idCliente) === String(state.filtroClienteId))) {
      state.filtroClienteId = '';
    }
    renderSidebar();
    renderMain();
  } catch (err) {
    setError(err);
    renderMain();
  } finally {
    setLoading(false);
  }
}

// ============================================================================
// 18. BOOT
// ============================================================================
async function init() {
  requireAuth({ role: 'admin' });
  const ctx = getUserContext();
  state.user.usuario = ctx.usuario;
  state.user.nivel   = ctx.nivel;
  state.user.escopo  = ctx.escopo || '*';
  if (dom.loggedUserDisplay) dom.loggedUserDisplay.textContent = state.user.usuario || 'Admin';

  state.ui.theme = detectInitialTheme();
  applyTheme(state.ui.theme, false);

  validateSessionOnBoot().catch(() => {});
  bindEvents();
  
  await loadData();
  startAutoRefresh();
  startLocalTick();

  document.body.classList.add('pronto');
  const tampa = document.getElementById('tampa-carregamento');
  if (tampa) { tampa.style.opacity = '0'; setTimeout(() => tampa.remove(), 400); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.openQuotaMonitor = openQuotaMonitor;
