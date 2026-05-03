/**
 * ============================================================================
 * admin.js — Dashboard God Mode (substitui dev.js monolítico)
 * Parte 1/2 — Boot, estado, seletores, data loading, renderização principal
 * ----------------------------------------------------------------------------
 * Esta é a entrada do dashboard ADMIN. Importa módulos compartilhados de /js/
 * e renderiza toda a UI da página index.html.
 *
 * IMPORTANTE: Este módulo só é executado quando o usuário é admin
 * (idClienteVinculado === '*'). O auth.requireAuth({role:'admin'}) garante isso
 * antes do paint da página.
 * ============================================================================
 */

import {
  APP_VERSION,
  REFRESH_INTERVAL_MS,
  UI_LIMITS,
  SEVERIDADES,
  STORAGE_KEYS,
} from './config.js';

import { apiGet, apiPost } from './api.js';

import {
  requireAuth,
  validateSessionOnBoot,
  logout,
  getUserContext,
} from './auth.js';

import {
  $, $$,
  relativeTime, formatDate, durationBetween, isWithinHours,
  truncate, escapeHtml, initials, gradientFromString,
  debounce, throttle,
  formatNumber, percent,
  formatCpf, formatCnpj,
  arrayToCsv,
} from './utils.js';

import { matchKB, findKBById } from './kb.js';

import {
  toast, toastSuccess, toastError, toastWarning,
  openModal, closeModal, confirmDialog,
  openDrawer, closeDrawer,
  skeleton, showLoading, hideLoading,
  emptyState,
} from './ui-shared.js';

/* ============================================================================
 * 1) ESTADO GLOBAL (single source of truth)
 * ----------------------------------------------------------------------------
 * Tudo que a UI renderiza vem daqui. Nunca acesse o DOM para "ler" estado;
 * sempre escreva em state e chame renderXxx().
 * ========================================================================= */
const state = {
  // Dados crus do backend
  raw: {
    clientes: [],
    logs: [],
    eventosAuth: [],
    sessoesAtivas: [],
    saudeApps: [],
    totais: {},
    operacionais: {},
  },

  // Filtros aplicados (UI-driven)
  filtros: {
    clienteSelecionado: '*',         // '*' = todos
    abaAtiva: 'logs',                // 'logs' | 'auth' | 'sessions'
    timeRange: '24h',                // '1h' | '24h' | '7d' | '30d' | 'all'
    busca: '',
    severidades: {                   // pills da tab Logs
      erro: true,
      alerta: true,
      info: true,
    },
  },

  // UI ephemera
  ui: {
    boot: false,                     // true após primeiro load
    refreshTimerId: null,
    pageVisible: true,
    capacityDrawerOpen: false,
  },

  // Contexto do usuário logado (preenchido após validateSession)
  user: {
    usuario: '',
    nivel: '',
    escopo: '',
  },
};

/* ============================================================================
 * 2) SELETORES (cache de elementos DOM — populado em initDomRefs)
 * ========================================================================= */
const els = {
  // Layout
  loadingOverlay: null,
  appShell: null,

  // Sidebar
  clientList: null,
  systemStatus: null,
  newClientBtn: null,

  // Topbar
  topbarTitle: null,
  topbarSubtitle: null,
  themeToggleBtn: null,
  refreshBtn: null,
  logoutBtn: null,
  userMenu: null,
  capacityBtn: null,
  capacityBadge: null,

  // KPIs
  kpiClientes: null,
  kpiOnline: null,
  kpiErros24h: null,
  kpiAuth24h: null,
  kpiTaxaErro: null,
  kpiLoginsFalhos: null,
  kpiAppsMonitorados: null,
  kpiTotalLogs: null,

  // Live strip
  liveStripList: null,
  liveStripMeta: null,

  // Events section
  tabsContainer: null,
  tabLogs: null,
  tabAuth: null,
  tabSessions: null,
  tabCountLogs: null,
  tabCountAuth: null,
  tabCountSessions: null,
  searchInput: null,
  searchClear: null,
  severityPills: null,
  pillErro: null,
  pillAlerta: null,
  pillInfo: null,
  pillCountErro: null,
  pillCountAlerta: null,
  pillCountInfo: null,
  timeRangeSelect: null,
  exportCsvBtn: null,
  exportPdfBtn: null,
  eventsList: null,
  eventsMeta: null,

  // Modal: novo cliente
  newClientModal: null,
  newClientForm: null,
  newClientCloseBtn: null,
  newClientCancelBtn: null,
  newClientSubmitBtn: null,
  newClientFormError: null,

  // Drawer: capacity
  capacityDrawer: null,
  capacityDrawerCloseBtn: null,
  capacityDrawerSummary: null,
  capacityDrawerBody: null,
  capacityDrawerMeta: null,

  // Drawer: detail
  detailDrawer: null,
  detailDrawerCloseBtn: null,
  detailDrawerBody: null,
  detailDrawerCopyBtn: null,
};

function initDomRefs() {
  els.loadingOverlay = $('loadingOverlay');
  els.appShell       = $('appShell');

  // Sidebar
  els.clientList    = $('clientList');
  els.systemStatus  = $('systemStatus');
  els.newClientBtn  = $('newClientBtn');

  // Topbar
  els.topbarTitle    = $('topbarTitle');
  els.topbarSubtitle = $('topbarSubtitle');
  els.themeToggleBtn = $('themeToggleBtn');
  els.refreshBtn     = $('refreshBtn');
  els.logoutBtn      = $('logoutBtn');
  els.userMenu       = $('userMenu');
  els.capacityBtn    = $('capacityBtn');
  els.capacityBadge  = $('capacityBadge');

  // KPIs
  els.kpiClientes        = $('kpiClientes');
  els.kpiOnline          = $('kpiOnline');
  els.kpiErros24h        = $('kpiErros24h');
  els.kpiAuth24h         = $('kpiAuth24h');
  els.kpiTaxaErro        = $('kpiTaxaErro');
  els.kpiLoginsFalhos    = $('kpiLoginsFalhos');
  els.kpiAppsMonitorados = $('kpiAppsMonitorados');
  els.kpiTotalLogs       = $('kpiTotalLogs');

  // Live strip
  els.liveStripList = $('liveStripList');
  els.liveStripMeta = $('liveStripMeta');

  // Events
  els.tabsContainer  = $('tabsContainer');
  els.tabLogs        = $('tabLogs');
  els.tabAuth        = $('tabAuth');
  els.tabSessions    = $('tabSessions');
  els.tabCountLogs   = $('tabCountLogs');
  els.tabCountAuth   = $('tabCountAuth');
  els.tabCountSessions = $('tabCountSessions');
  els.searchInput    = $('searchInput');
  els.searchClear    = $('searchClear');
  els.severityPills  = $('severityPills');
  els.pillErro       = $('pillErro');
  els.pillAlerta     = $('pillAlerta');
  els.pillInfo       = $('pillInfo');
  els.pillCountErro  = $('pillCountErro');
  els.pillCountAlerta= $('pillCountAlerta');
  els.pillCountInfo  = $('pillCountInfo');
  els.timeRangeSelect= $('timeRangeSelect');
  els.exportCsvBtn   = $('exportCsvBtn');
  els.exportPdfBtn   = $('exportPdfBtn');
  els.eventsList     = $('eventsList');
  els.eventsMeta     = $('eventsMeta');

  // Modal
  els.newClientModal     = $('newClientModal');
  els.newClientForm      = $('newClientForm');
  els.newClientCloseBtn  = $('newClientCloseBtn');
  els.newClientCancelBtn = $('newClientCancelBtn');
  els.newClientSubmitBtn = $('newClientSubmitBtn');
  els.newClientFormError = $('newClientFormError');

  // Drawer capacity
  els.capacityDrawer        = $('capacityDrawer');
  els.capacityDrawerCloseBtn= $('capacityDrawerCloseBtn');
  els.capacityDrawerSummary = $('capacityDrawerSummary');
  els.capacityDrawerBody    = $('capacityDrawerBody');
  els.capacityDrawerMeta    = $('capacityDrawerMeta');

  // Drawer detail
  els.detailDrawer         = $('detailDrawer');
  els.detailDrawerCloseBtn = $('detailDrawerCloseBtn');
  els.detailDrawerBody     = $('detailDrawerBody');
  els.detailDrawerCopyBtn  = $('detailDrawerCopyBtn');
}

/* ============================================================================
 * 3) BOOT SEQUENCE — entrada da aplicação
 * ----------------------------------------------------------------------------
 * Ordem:
 *  1. requireAuth (guard sincrônico, pré-paint)
 *  2. initDomRefs (popular els.*)
 *  3. applyTheme + bind theme toggle
 *  4. validateSession (assíncrono — confirma token com backend)
 *  5. loadDashboardData (primeiro fetch)
 *  6. bindEvents (cliques, atalhos, visibility)
 *  7. setupAutoRefresh (timer de 30s)
 *  8. revelar UI (body.pronto)
 * ========================================================================= */

(async function boot() {
  // 1) Guard sincrônico — se não tiver token, redireciona ANTES de qualquer paint
  if (!requireAuth({ role: 'admin' })) return;

  // 2) Refs DOM
  initDomRefs();

  // 3) Tema
  applyThemeFromStorage();
  bindThemeToggle();

  // 4) Valida sessão com backend (sliding TTL)
  const ctx = await validateSessionOnBoot();
  if (!ctx) return; // já redirecionou
  state.user.usuario = ctx.usuario || '';
  state.user.nivel   = ctx.nivel || '';
  state.user.escopo  = ctx.idClienteVinculado || '';

  renderUserMenu();

  // 5) Bind eventos (antes do primeiro load para que cliques funcionem cedo)
  bindEvents();

  // 6) Primeiro load
  await loadDashboardData({ initial: true });

  // 7) Auto-refresh + visibility
  setupAutoRefresh();
  setupVisibilityHandlers();

  // 8) PWA service worker (best-effort)
  registerServiceWorker();

  // 9) Reveal
  state.ui.boot = true;
  document.body.classList.add('pronto');
})();

/* ============================================================================
 * 4) THEME — light/dark com persistência
 * ========================================================================= */
function applyThemeFromStorage() {
  let theme;
  try { theme = localStorage.getItem(STORAGE_KEYS.THEME); }
  catch (_) { theme = null; }
  if (theme !== 'dark' && theme !== 'light') {
    // Auto-detect via prefers-color-scheme
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
  const html = document.documentElement;
  const cur = html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';

  // Anti-FOUC: ativa transition global APENAS durante a troca
  html.classList.add('theme-transitioning');
  html.setAttribute('data-theme', next);
  try { localStorage.setItem(STORAGE_KEYS.THEME, next); } catch (_) {}

  setTimeout(() => html.classList.remove('theme-transitioning'), 500);
}

function bindThemeToggle() {
  if (!els.themeToggleBtn) return;
  els.themeToggleBtn.addEventListener('click', toggleTheme);
}

/* ============================================================================
 * 5) DATA LOADING
 * ========================================================================= */

async function loadDashboardData(opts = {}) {
  const initial = !!opts.initial;

  // Em load inicial, mostra skeleton; em refresh, indica sutilmente
  if (initial && els.eventsList) {
    els.eventsList.innerHTML = skeleton({ rows: 5, height: 90 });
  }
  if (els.refreshBtn) {
    els.refreshBtn.classList.add('is-loading');
    els.refreshBtn.disabled = true;
  }

  try {
    const r = await apiGet({}, { withToken: true, timeoutMs: 25000 });

    if (!r || !r.ok) {
      const msg = (r && r.error) || 'Falha ao carregar dados';
      if (initial) {
        // Hard fail no boot — tela de erro
        renderBootError(msg);
        return;
      }
      toastError('Falha ao atualizar: ' + msg);
      return;
    }

    if (r.modo !== 'admin') {
      // Se backend respondeu modo cliente para um admin, algo está errado
      toastError('Sessão inconsistente. Faça login novamente.');
      setTimeout(logout, 1500);
      return;
    }

    // Atualiza estado
    state.raw.clientes      = Array.isArray(r.data.clientes)      ? r.data.clientes      : [];
    state.raw.logs          = Array.isArray(r.data.logs)          ? r.data.logs          : [];
    state.raw.eventosAuth   = Array.isArray(r.data.eventosAuth)   ? r.data.eventosAuth   : [];
    state.raw.sessoesAtivas = Array.isArray(r.data.sessoesAtivas) ? r.data.sessoesAtivas : [];
    state.raw.saudeApps     = Array.isArray(r.data.saudeApps)     ? r.data.saudeApps     : [];
    state.raw.totais        = r.data.totais || {};
    state.raw.operacionais  = r.data.operacionais || {};

    // Renderiza tudo
    renderAll();

    if (initial) {
      // mostra contagem inicial discretamente
      if (els.eventsMeta) {
        els.eventsMeta.textContent = formatNumber(state.raw.logs.length) + ' logs · '
          + formatNumber(state.raw.eventosAuth.length) + ' auth · '
          + formatNumber(state.raw.sessoesAtivas.length) + ' online';
      }
    }
  } catch (err) {
    if (initial) {
      renderBootError('Erro inesperado: ' + (err && err.message || err));
    } else {
      toastError('Erro ao atualizar dashboard');
    }
  } finally {
    if (els.refreshBtn) {
      els.refreshBtn.classList.remove('is-loading');
      els.refreshBtn.disabled = false;
    }
  }
}

function renderBootError(msg) {
  if (els.eventsList) {
    els.eventsList.innerHTML = emptyState({
      icon: '⚠',
      title: 'Não foi possível carregar o dashboard',
      text: msg,
    });
  }
  document.body.classList.add('pronto');
}

function setupAutoRefresh() {
  if (state.ui.refreshTimerId) clearInterval(state.ui.refreshTimerId);
  state.ui.refreshTimerId = setInterval(() => {
    if (state.ui.pageVisible) loadDashboardData();
  }, REFRESH_INTERVAL_MS);
}

function setupVisibilityHandlers() {
  document.addEventListener('visibilitychange', () => {
    state.ui.pageVisible = !document.hidden;
    if (state.ui.pageVisible) {
      // Quando volta a aba, força refresh imediato
      loadDashboardData();
    }
  });
}

/* ============================================================================
 * 6) RENDER ALL — orquestra todos os renderers
 * ========================================================================= */
function renderAll() {
  renderTopbar();
  renderSystemStatus();
  renderClientList();
  renderKpis();
  renderCapacityBadge();
  renderLiveStrip();
  renderTabCounts();
  renderActiveTab();
  renderSeverityPillCounts();
}

/* ============================================================================
 * 7) RENDER: TOPBAR + USER MENU
 * ========================================================================= */
function renderTopbar() {
  if (els.topbarTitle) els.topbarTitle.textContent = 'Central de Desenvolvedor';
  if (els.topbarSubtitle) {
    els.topbarSubtitle.textContent = 'God Mode · ' + APP_VERSION;
  }
}

function renderUserMenu() {
  if (!els.userMenu) return;
  const u = state.user.usuario || 'admin';
  els.userMenu.textContent = u;
  els.userMenu.title = 'Logado como ' + u + ' (admin)';
}

function renderSystemStatus() {
  if (!els.systemStatus) return;
  const dot = els.systemStatus.querySelector('.status-pill__dot');
  const label = els.systemStatus.querySelector('.status-pill__label');
  els.systemStatus.setAttribute('data-state', 'ok');
  if (label) label.textContent = 'Sistema operacional';
}

/* ============================================================================
 * 8) RENDER: SIDEBAR (lista de clientes)
 * ========================================================================= */
function renderClientList() {
  if (!els.clientList) return;

  const clientes = state.raw.clientes || [];
  const sel = state.filtros.clienteSelecionado;

  // Calcula contadores por cliente (logs do tenant)
  const contagem = {};
  state.raw.logs.forEach(l => {
    const id = String(l.idCliente || '');
    contagem[id] = (contagem[id] || 0) + 1;
  });

  const allCount = state.raw.logs.length;

  let html = '';

  // Item "Todos" (admin only)
  html += [
    '<button type="button" class="client-item client-item--all',
    sel === '*' ? ' client-item--active' : '',
    '" data-id="*">',
    '<span class="client-item__name">Todos os clientes</span>',
    '<span class="client-item__count">' + formatNumber(allCount) + '</span>',
    '</button>',
  ].join('');

  // Lista
  if (!clientes.length) {
    html += '<div class="client-list__placeholder">Nenhum cliente cadastrado.</div>';
  } else {
    clientes
      .filter(c => String(c.ativo).toUpperCase() === 'TRUE' || !c.ativo) // ativos primeiro
      .forEach(c => {
        const id = String(c.idCliente || '');
        const nome = c.nomeFantasia || c.nome || id;
        const count = contagem[id] || 0;
        const ativo = sel === id;
        html += [
          '<button type="button" class="client-item',
          ativo ? ' client-item--active' : '',
          '" data-id="' + escapeHtml(id) + '" title="' + escapeHtml(c.nome || nome) + '">',
          '<span class="client-item__name">' + escapeHtml(truncate(nome, 22)) + '</span>',
          '<span class="client-item__count">' + formatNumber(count) + '</span>',
          '</button>',
        ].join('');
      });
  }

  els.clientList.innerHTML = html;

  // Bind cliques (delegação simples)

  $$('.client-item', els.clientList).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id') || '*';
      state.filtros.clienteSelecionado = id;
      renderClientList();         // re-render para atualizar :active
      renderActiveTab();          // re-aplica filtro
      renderTabCounts();
      renderLiveStrip();
      renderKpis();
    });
  });
}

/* ============================================================================
 * 9) RENDER: KPI CARDS
 * ========================================================================= */
function renderKpis() {
  const data = filtrarPorClienteSelecionado();

  if (els.kpiClientes) {
    els.kpiClientes.textContent = formatNumber(state.raw.clientes.filter(c => String(c.ativo).toUpperCase() === 'TRUE').length);
  }
  if (els.kpiOnline) {
    els.kpiOnline.textContent = formatNumber(data.sessoesAtivas.length);
  }
  if (els.kpiErros24h) {
    const erros = data.logs.filter(l =>
      String(l.severidade).toLowerCase() === 'erro' && isWithinHours(l.timestamp, 24)
    ).length;
    els.kpiErros24h.textContent = formatNumber(erros);
  }
  if (els.kpiAuth24h) {
    const auth = data.eventosAuth.filter(ev => isWithinHours(ev.timestamp, 24)).length;
    els.kpiAuth24h.textContent = formatNumber(auth);
  }
  if (els.kpiTaxaErro) {
    els.kpiTaxaErro.textContent = (state.raw.operacionais.taxaErro || 0) + '%';
  }
  if (els.kpiLoginsFalhos) {
    els.kpiLoginsFalhos.textContent = formatNumber(state.raw.operacionais.loginsFalhos24h || 0);
  }
  if (els.kpiAppsMonitorados) {
    els.kpiAppsMonitorados.textContent = formatNumber(state.raw.saudeApps.length);
  }
  if (els.kpiTotalLogs) {
    els.kpiTotalLogs.textContent = formatNumber(data.logs.length);
  }
}

/* ============================================================================
 * 10) RENDER: LIVE ACTIVITY STRIP
 * ========================================================================= */
function renderLiveStrip() {
  if (!els.liveStripList) return;

  const data = filtrarPorClienteSelecionado();
  const sessoes = data.sessoesAtivas || [];

  if (els.liveStripMeta) {
    els.liveStripMeta.textContent = sessoes.length === 1
      ? '1 usuário online'
      : formatNumber(sessoes.length) + ' usuários online';
  }

  if (!sessoes.length) {
    els.liveStripList.setAttribute('data-empty', 'true');
    els.liveStripList.innerHTML = '';
    return;
  }
  els.liveStripList.removeAttribute('data-empty');

  els.liveStripList.innerHTML = sessoes
    .slice(0, UI_LIMITS.SESSOES_VISIVEIS)
    .map(s => {
      const nome = s.usuario || 'anônimo';
      const ini = initials(nome);
      const grad = gradientFromString(nome);
      const sub = (s.app || '?') + ' · ' + relativeTime(s.ultimoHb);
      return [
        '<div class="live-chip" title="' + escapeHtml(nome + ' • ' + (s.idCliente || '')) + '">',
        '<div class="live-chip__avatar" style="background:' + grad + '">' + escapeHtml(ini) + '</div>',
        '<div class="live-chip__body">',
        '<div class="live-chip__name">' + escapeHtml(truncate(nome, UI_LIMITS.CHIP_NOME_MAX_CHARS)) + '</div>',
        '<div class="live-chip__sub">' + escapeHtml(sub) + '</div>',
        '</div>',
        '</div>',
      ].join('');
    })
    .join('');
}

/* ============================================================================
 * 11) FILTROS — pipeline de transformação (cliente → tempo → busca → severidade)
 * ========================================================================= */

function filtrarPorClienteSelecionado() {
  const sel = state.filtros.clienteSelecionado;
  if (sel === '*') {
    return {
      logs: state.raw.logs,
      eventosAuth: state.raw.eventosAuth,
      sessoesAtivas: state.raw.sessoesAtivas,
    };
  }
  return {
    logs: state.raw.logs.filter(l => String(l.idCliente) === sel),
    eventosAuth: state.raw.eventosAuth.filter(e => String(e.idCliente) === sel),
    sessoesAtivas: state.raw.sessoesAtivas.filter(s => String(s.idCliente) === sel),
  };
}

function filtrarPorTimeRange(items) {
  const range = state.filtros.timeRange;
  if (range === 'all') return items;
  const horas = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 }[range] || 24;
  return items.filter(i => isWithinHours(i.timestamp || i.iniciadoEm || i.ultimoHb, horas));
}

function filtrarPorBusca(items, campos) {
  const q = String(state.filtros.busca || '').toLowerCase().trim();
  if (!q) return items;
  return items.filter(i => {
    for (let k = 0; k < campos.length; k++) {
      const v = String(i[campos[k]] || '').toLowerCase();
      if (v.indexOf(q) >= 0) return true;
    }
    return false;
  });
}

function filtrarPorSeveridade(logs) {
  const sev = state.filtros.severidades;
  return logs.filter(l => {
    const s = String(l.severidade || 'info').toLowerCase();
    return !!sev[s];
  });
}

/* ============================================================================
 * 12) RENDER: TAB COUNTS + ACTIVE TAB
 * ========================================================================= */

function renderTabCounts() {
  const data = filtrarPorClienteSelecionado();
  const logs = filtrarPorTimeRange(data.logs);
  const auths = filtrarPorTimeRange(data.eventosAuth);
  const sess = data.sessoesAtivas;

  if (els.tabCountLogs)     els.tabCountLogs.textContent     = formatNumber(logs.length);
  if (els.tabCountAuth)     els.tabCountAuth.textContent     = formatNumber(auths.length);
  if (els.tabCountSessions) els.tabCountSessions.textContent = formatNumber(sess.length);
}

function renderActiveTab() {
  const aba = state.filtros.abaAtiva;

  // Visibilidade do bloco de pílulas (só faz sentido em logs)
  if (els.severityPills) {
    if (aba === 'logs') els.severityPills.removeAttribute('hidden');
    else els.severityPills.setAttribute('hidden', '');
  }

  // Marca tab ativa
  if (els.tabLogs)     els.tabLogs.classList.toggle('tab--active', aba === 'logs');
  if (els.tabAuth)     els.tabAuth.classList.toggle('tab--active', aba === 'auth');
  if (els.tabSessions) els.tabSessions.classList.toggle('tab--active', aba === 'sessions');

  if (aba === 'logs')          renderLogsTab();
  else if (aba === 'auth')     renderAuthTab();
  else if (aba === 'sessions') renderSessionsTab();
}

/* ============================================================================
 * 13) RENDER: LOGS TAB
 * ========================================================================= */
function renderLogsTab() {
  if (!els.eventsList) return;

  const data = filtrarPorClienteSelecionado();
  let logs = filtrarPorTimeRange(data.logs);
  logs = filtrarPorSeveridade(logs);
  logs = filtrarPorBusca(logs, ['mensagem', 'app', 'idCliente', 'severidade']);

  // Ordena por timestamp desc
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Atualiza meta
  if (els.eventsMeta) {
    els.eventsMeta.textContent = formatNumber(logs.length) + ' resultado' + (logs.length === 1 ? '' : 's');
  }

  if (!logs.length) {
    els.eventsList.innerHTML = emptyState({
      icon: '🔍',
      title: 'Nenhum log encontrado',
      text: 'Ajuste filtros, severidade ou intervalo de tempo.',
    });
    return;
  }

  const visiveis = logs.slice(0, UI_LIMITS.LOGS_VISIVEIS);
  els.eventsList.innerHTML = visiveis.map(l => renderLogCard(l)).join('');

  // Bind cliques para abrir drawer de detalhe

  $$('.log-card', els.eventsList).forEach(card => {
    card.addEventListener('click', () => {
      const idLog = card.getAttribute('data-id-log');
      const log = logs.find(x => String(x.idLog) === idLog);
      if (log) openLogDetailDrawer(log);
    });
    card.tabIndex = 0;
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
  });
}

function renderLogCard(l) {
  const sev = String(l.severidade || 'info').toLowerCase();
  const sevClass = ['erro', 'alerta', 'info'].includes(sev) ? sev : 'info';
  const icon = { erro: '✕', alerta: '⚠', info: 'i' }[sevClass];

  const kb = matchKB(l.mensagem);
  const kbBadge = kb ? '<span class="log-card__kb-badge" title="' + escapeHtml(kb.titulo) + '">KB' + escapeHtml(kb.id.replace('KB','')) + '</span>' : '';

  return [
    '<article class="log-card log-card--' + sevClass + '" data-id-log="' + escapeHtml(l.idLog || '') + '" role="button">',
    '<div class="log-card__icon">' + icon + '</div>',
    '<div class="log-card__body">',
      '<div class="log-card__head">',
        '<span class="log-card__app">' + escapeHtml(l.app || 'app') + '</span>',
        l.idCliente ? '<span class="log-card__client">' + escapeHtml(l.idCliente) + '</span>' : '',
        kbBadge,
      '</div>',
      '<pre class="log-card__message">' + escapeHtml(truncate(l.mensagem || '', 400)) + '</pre>',
      '<div class="log-card__meta">',
        l.versao ? '<span class="log-card__meta-item">v' + escapeHtml(l.versao) + '</span>' : '',
        '<span class="log-card__meta-item">' + escapeHtml(formatDate(l.timestamp, 'DD/MM HH:mm:ss')) + '</span>',
      '</div>',
    '</div>',
    '<div class="log-card__time">' + escapeHtml(relativeTime(l.timestamp)) + '</div>',
    '</article>',
  ].join('');
}

/* ============================================================================
 * 14) RENDER: AUTH TAB
 * ========================================================================= */
function renderAuthTab() {
  if (!els.eventsList) return;

  const data = filtrarPorClienteSelecionado();
  let evs = filtrarPorTimeRange(data.eventosAuth);
  evs = filtrarPorBusca(evs, ['usuario', 'app', 'idCliente', 'tipo', 'detalhes']);

  evs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (els.eventsMeta) {
    els.eventsMeta.textContent = formatNumber(evs.length) + ' evento' + (evs.length === 1 ? '' : 's');
  }

  if (!evs.length) {
    els.eventsList.innerHTML = emptyState({
      icon: '🔐',
      title: 'Nenhum evento de autenticação',
      text: 'Tente ampliar o intervalo de tempo.',
    });
    return;
  }

  const visiveis = evs.slice(0, UI_LIMITS.EVENTOS_AUTH_VISIVEIS);
  els.eventsList.innerHTML = visiveis.map(e => renderAuthCard(e)).join('');


  $$('.auth-card', els.eventsList).forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id-evt');
      const ev = evs.find(x => String(x.idEvento) === id);
      if (ev) openAuthDetailDrawer(ev);
    });
    card.tabIndex = 0;
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
    });
  });
}

function renderAuthCard(ev) {
  const tipoLower = String(ev.tipo || '').toLowerCase();
  let cls = 'logout', icon = '↪', label = 'Evento';

  if (tipoLower.includes('success') || tipoLower === 'login' || tipoLower === 'login_success') {
    cls = 'success'; icon = '✓'; label = 'Login OK';
  } else if (tipoLower.includes('fail') || tipoLower.includes('falh') || tipoLower === 'login_fail') {
    cls = 'fail'; icon = '✕'; label = 'Falha';
  } else if (tipoLower === 'logout') {
    cls = 'logout'; icon = '⎋'; label = 'Logout';
  } else if (tipoLower.includes('expir')) {
    cls = 'expired'; icon = '⏱'; label = 'Expirada';
  }

  return [
    '<article class="auth-card auth-card--' + cls + '" data-id-evt="' + escapeHtml(ev.idEvento || '') + '" role="button">',
    '<div class="auth-card__icon">' + icon + '</div>',
    '<div class="auth-card__body">',
      '<div class="auth-card__head">',
        '<span class="auth-card__user">' + escapeHtml(ev.usuario || ev.idFuncionario || 'anônimo') + '</span>',
        '<span class="auth-card__type">' + escapeHtml(label) + '</span>',
      '</div>',
      '<div class="auth-card__meta">',
        '<span>' + escapeHtml(ev.app || 'app') + '</span>',
        ev.idCliente ? '<span>· ' + escapeHtml(ev.idCliente) + '</span>' : '',
        ev.ip ? '<span>· ' + escapeHtml(ev.ip) + '</span>' : '',
      '</div>',
    '</div>',
    '<div class="auth-card__time">' + escapeHtml(relativeTime(ev.timestamp)) + '</div>',
    '</article>',
  ].join('');
}

/* ============================================================================
 * 15) RENDER: SESSIONS TAB
 * ========================================================================= */
function renderSessionsTab() {
  if (!els.eventsList) return;

  const data = filtrarPorClienteSelecionado();
  let sess = data.sessoesAtivas || [];
  sess = filtrarPorBusca(sess, ['usuario', 'app', 'idCliente']);

  // Mais recentes primeiro
  sess.sort((a, b) => new Date(b.ultimoHb).getTime() - new Date(a.ultimoHb).getTime());

  if (els.eventsMeta) {
    els.eventsMeta.textContent = formatNumber(sess.length) + ' sess' + (sess.length === 1 ? 'ão ativa' : 'ões ativas');
  }

  if (!sess.length) {
    els.eventsList.innerHTML = emptyState({
      icon: '👥',
      title: 'Ninguém online no momento',
      text: 'Nenhuma sessão ativa em apps cliente.',
    });
    return;
  }

  els.eventsList.innerHTML = sess.map(s => renderSessionCard(s)).join('');
}

function renderSessionCard(s) {
  const nome = s.usuario || 'anônimo';
  const ini = initials(nome);
  const grad = gradientFromString(nome);
  return [
    '<article class="session-card">',
    '<div class="session-card__avatar" style="background:' + grad + '">' + escapeHtml(ini) + '</div>',
    '<div class="session-card__body">',
      '<div class="session-card__head">',
        '<span class="session-card__name">' + escapeHtml(nome) + '</span>',
        '<span class="session-card__app">' + escapeHtml(s.app || 'app') + '</span>',
      '</div>',
      '<div class="session-card__meta">',
        s.idCliente ? '<span>' + escapeHtml(s.idCliente) + '</span>' : '',
        s.ip ? '<span>· ' + escapeHtml(s.ip) + '</span>' : '',
        '<span>· iniciada ' + escapeHtml(relativeTime(s.iniciadoEm)) + '</span>',
      '</div>',
    '</div>',
    '<div class="session-card__time">',
      '<div class="session-card__duration">' + escapeHtml(durationBetween(s.iniciadoEm)) + '</div>',
      '<div class="session-card__since">hb: ' + escapeHtml(relativeTime(s.ultimoHb)) + '</div>',
    '</div>',
    '</article>',
  ].join('');
}

/* ============================================================================
 * 16) RENDER: SEVERITY PILLS — contagens
 * ========================================================================= */
function renderSeverityPillCounts() {
  const data = filtrarPorClienteSelecionado();
  const logs = filtrarPorTimeRange(data.logs);

  let cE = 0, cA = 0, cI = 0;
  logs.forEach(l => {
    const s = String(l.severidade || 'info').toLowerCase();
    if (s === 'erro') cE++;
    else if (s === 'alerta') cA++;
    else cI++;
  });

  if (els.pillCountErro)   els.pillCountErro.textContent   = formatNumber(cE);
  if (els.pillCountAlerta) els.pillCountAlerta.textContent = formatNumber(cA);
  if (els.pillCountInfo)   els.pillCountInfo.textContent   = formatNumber(cI);

  // Sincroniza estado visual is-active
  if (els.pillErro)   els.pillErro.classList.toggle('is-active', state.filtros.severidades.erro);
  if (els.pillAlerta) els.pillAlerta.classList.toggle('is-active', state.filtros.severidades.alerta);
  if (els.pillInfo)   els.pillInfo.classList.toggle('is-active', state.filtros.severidades.info);
}

/* ============================================================================
 * 17) RENDER: CAPACITY BADGE (no botão da topbar)
 * ========================================================================= */
function renderCapacityBadge() {
  if (!els.capacityBadge) return;
  const apps = state.raw.saudeApps || [];
  const criticos = apps.filter(a => ['CRITICO', 'ALERTA'].includes(String(a.status || ''))).length;
  if (criticos > 0) {
    els.capacityBadge.textContent = String(criticos);
    els.capacityBadge.style.display = '';
  } else {
    els.capacityBadge.textContent = '';
    els.capacityBadge.style.display = 'none';
  }
}

/* ============================================================================
 * 18) PWA — registra service worker (best-effort)
 * ========================================================================= */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      // PWA é opcional; falha aqui não impede o app de funcionar
      console.warn('SW registration failed:', err);
    });
  } catch (_) {}
}

/* ============================================================================
 * 19) BIND EVENTS — pré-declarado aqui, implementado na PARTE 2/2
 * ----------------------------------------------------------------------------
 * Todos os event listeners de UI (cliques de tab, busca, exports, drawers,
 * modal de novo cliente, atalhos de teclado) ficam na Parte 2 para manter
 * esta Parte 1 focada em estrutura + render.
 * ========================================================================= */

// Stub. A implementação real chega na Parte 2/2.
function bindEvents() {
  // Esta função é implementada na Parte 2/2.
  // Aqui só evitamos crash caso boot rode antes da Parte 2 carregar.
  // Será sobrescrita pelo bloco da Parte 2.
  if (typeof window.__gmBindEventsImpl === 'function') {
    window.__gmBindEventsImpl();
  }
}

/* ============================================================================
 * 20) Drawers de detalhe — stubs (impl real na Parte 2/2)
 * ========================================================================= */
function openLogDetailDrawer(log) {
  if (typeof window.__gmOpenLogDetail === 'function') {
    window.__gmOpenLogDetail(log);
  }
}
function openAuthDetailDrawer(ev) {
  if (typeof window.__gmOpenAuthDetail === 'function') {
    window.__gmOpenAuthDetail(ev);
  }
}

/* ============================================================================
 * 21) EXPORT (interno) — usado pela Parte 2/2 via closure global do módulo
 * ----------------------------------------------------------------------------
 * Como ES Modules não compartilham escopo entre arquivos, "expomos" funções
 * internas e o estado para a Parte 2/2 através de um namespace privado.
 * ========================================================================= */
window.__gm = window.__gm || {};
window.__gm.state = state;
window.__gm.els = els;
window.__gm.api = { apiGet, apiPost };
window.__gm.actions = {
  loadDashboardData,
  renderAll,
  renderClientList,
  renderActiveTab,
  renderTabCounts,
  renderSeverityPillCounts,
  renderLiveStrip,
  renderKpis,
  renderCapacityBadge,
};
window.__gm.ui = {
  toast, toastSuccess, toastError, toastWarning,
  openModal, closeModal, confirmDialog,
  openDrawer, closeDrawer,
  showLoading, hideLoading,
};
window.__gm.utils = {
  escapeHtml, truncate, formatDate, formatNumber,
  formatCpf, formatCnpj, arrayToCsv, debounce, throttle,
};
window.__gm.auth = { logout };

/* FIM DA PARTE 1/2 ===========================================================
 * Próximo: Parte 2/2 — bind events completo, exports CSV/PDF, drawers de
 * detalhe (log + auth + capacity), modal de novo cliente, atalhos de teclado.
 * E o index.html atualizado para apontar para este módulo.
 * ========================================================================= */
/* ============================================================================
 * PARTE 2/2 — Bind events, exports, drawers de detalhe, modal Novo Cliente
 * ========================================================================= */

/* ============================================================================
 * 22) BIND EVENTS — implementação real (sobrescreve o stub da Parte 1)
 * ========================================================================= */

window.__gmBindEventsImpl = function bindEventsReal() {
  // ---- Topbar ----
  if (els.refreshBtn) {
    els.refreshBtn.addEventListener('click', () => loadDashboardData());
  }
  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', async () => {
      const ok = await confirmDialog('Sair da conta?', 'Você precisará fazer login novamente.');
      if (ok) logout();
    });
  }

  // ---- Botão "Novo Cliente" ----
  if (els.newClientBtn) {
    els.newClientBtn.addEventListener('click', openNewClientModal);
  }

  // ---- Modal Novo Cliente ----
  if (els.newClientCloseBtn)  els.newClientCloseBtn.addEventListener('click', closeNewClientModal);
  if (els.newClientCancelBtn) els.newClientCancelBtn.addEventListener('click', closeNewClientModal);
  if (els.newClientForm)      els.newClientForm.addEventListener('submit', handleNewClientSubmit);

  // ---- Tabs ----
  if (els.tabLogs)     els.tabLogs.addEventListener('click', () => switchTab('logs'));
  if (els.tabAuth)     els.tabAuth.addEventListener('click', () => switchTab('auth'));
  if (els.tabSessions) els.tabSessions.addEventListener('click', () => switchTab('sessions'));

  // ---- Search ----
  if (els.searchInput) {
    const onSearch = debounce(() => {
      state.filtros.busca = els.searchInput.value;
      toggleSearchClear();
      renderActiveTab();
    }, 220);
    els.searchInput.addEventListener('input', onSearch);
    toggleSearchClear();
  }
  if (els.searchClear) {
    els.searchClear.addEventListener('click', () => {
      if (!els.searchInput) return;
      els.searchInput.value = '';
      state.filtros.busca = '';
      toggleSearchClear();
      renderActiveTab();
      els.searchInput.focus();
    });
  }

  // ---- Severity pills ----
  if (els.pillErro)   els.pillErro.addEventListener('click',   () => togglePill('erro'));
  if (els.pillAlerta) els.pillAlerta.addEventListener('click', () => togglePill('alerta'));
  if (els.pillInfo)   els.pillInfo.addEventListener('click',   () => togglePill('info'));

  // ---- Time range ----
  if (els.timeRangeSelect) {
    els.timeRangeSelect.value = state.filtros.timeRange;
    els.timeRangeSelect.addEventListener('change', () => {
      state.filtros.timeRange = els.timeRangeSelect.value;
      renderActiveTab();
      renderTabCounts();
      renderSeverityPillCounts();
      renderKpis();
    });
  }

  // ---- Exports ----
  if (els.exportCsvBtn) els.exportCsvBtn.addEventListener('click', exportCurrentTabCsv);
  if (els.exportPdfBtn) els.exportPdfBtn.addEventListener('click', exportCurrentTabPdf);

  // ---- Capacity drawer ----
  if (els.capacityBtn) els.capacityBtn.addEventListener('click', openCapacityDrawer);
  if (els.capacityDrawerCloseBtn) {
    els.capacityDrawerCloseBtn.addEventListener('click', closeCapacityDrawer);
  }

  // ---- Detail drawer ----
  if (els.detailDrawerCloseBtn) {
    els.detailDrawerCloseBtn.addEventListener('click', closeDetailDrawer);
  }
  if (els.detailDrawerCopyBtn) {
    els.detailDrawerCopyBtn.addEventListener('click', copyDetailJsonToClipboard);
  }

  // ---- Atalhos de teclado ----
  document.addEventListener('keydown', handleKeyboardShortcuts);
};

function toggleSearchClear() {
  if (!els.searchClear) return;
  const hasText = !!(els.searchInput && els.searchInput.value);
  els.searchClear.style.visibility = hasText ? 'visible' : 'hidden';
}

function switchTab(tab) {
  if (state.filtros.abaAtiva === tab) return;
  state.filtros.abaAtiva = tab;
  renderActiveTab();
}

function togglePill(sev) {
  state.filtros.severidades[sev] = !state.filtros.severidades[sev];
  // Pelo menos uma deve estar ativa — se desligou todas, religa a que clicou
  const algumaAtiva = Object.values(state.filtros.severidades).some(v => v);
  if (!algumaAtiva) {
    state.filtros.severidades[sev] = true;
    toast('Pelo menos uma severidade deve estar ativa', { type: 'info' });
  }
  renderSeverityPillCounts();
  renderActiveTab();
}

function handleKeyboardShortcuts(e) {
  // Ignora se está digitando em input/textarea
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  // ESC — fecha drawers/modal
  if (e.key === 'Escape') {
    if (els.detailDrawer && !els.detailDrawer.hasAttribute('hidden')) closeDetailDrawer();
    if (els.capacityDrawer && !els.capacityDrawer.hasAttribute('hidden')) closeCapacityDrawer();
    return;
  }

  // / — foca busca
  if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (els.searchInput) els.searchInput.focus();
    return;
  }

  // R — refresh manual (sem ctrl)
  if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    loadDashboardData();
    return;
  }

  // 1/2/3 — alterna abas
  if (e.key === '1') { switchTab('logs');     return; }
  if (e.key === '2') { switchTab('auth');     return; }
  if (e.key === '3') { switchTab('sessions'); return; }
}

/* ============================================================================
 * 23) MODAL: NOVO CLIENTE
 * ----------------------------------------------------------------------------
 * Inclui campos GM-10: nomeFantasia, cnpj, logoUrl, corPrimaria, quotaFuncionarios.
 * ========================================================================= */

function openNewClientModal() {
  if (!els.newClientModal) return;
  // Reseta form
  if (els.newClientForm) els.newClientForm.reset();
  if (els.newClientFormError) {
    els.newClientFormError.textContent = '';
    els.newClientFormError.style.display = 'none';
  }
  els.newClientModal.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
  // Foca primeiro campo
  setTimeout(() => {
    const first = els.newClientForm && els.newClientForm.querySelector('input, select, textarea');
    if (first) first.focus();
  }, 80);
}

function closeNewClientModal() {
  if (!els.newClientModal) return;
  els.newClientModal.setAttribute('hidden', '');
  document.body.style.overflow = '';
}

async function handleNewClientSubmit(e) {
  e.preventDefault();
  if (!els.newClientForm) return;

  const fd = new FormData(els.newClientForm);
  const idCliente        = String(fd.get('idCliente') || '').trim().toLowerCase();
  const nome             = String(fd.get('nome') || '').trim();
  const nomeFantasia     = String(fd.get('nomeFantasia') || '').trim();
  const cnpj             = String(fd.get('cnpj') || '').replace(/\D/g, '');
  const email            = String(fd.get('email') || '').trim();
  const telefone         = String(fd.get('telefone') || '').trim();
  const plano            = String(fd.get('plano') || 'starter').trim();
  const logoUrl          = String(fd.get('logoUrl') || '').trim();
  const corPrimaria      = String(fd.get('corPrimaria') || '').trim();
  const quotaFuncionarios= Number(fd.get('quotaFuncionarios')) || 5;

  // Validação básica client-side
  if (!idCliente || !/^[a-z0-9_-]{2,32}$/.test(idCliente)) {
    return showFormError('idCliente inválido (apenas letras minúsculas, números, _ ou -; 2 a 32 chars)');
  }
  if (!nome) return showFormError('Nome é obrigatório');
  if (cnpj && cnpj.length !== 14) return showFormError('CNPJ deve ter 14 dígitos');
  if (quotaFuncionarios < 1 || quotaFuncionarios > 1000) {
    return showFormError('Quota deve estar entre 1 e 1000');
  }

  // Loading state
  if (els.newClientSubmitBtn) {
    els.newClientSubmitBtn.classList.add('is-loading');
    els.newClientSubmitBtn.disabled = true;
  }

  const r = await apiPost('createclient', {
    idCliente, nome, nomeFantasia, cnpj, email, telefone, plano,
    logoUrl, corPrimaria, quotaFuncionarios
  });

  if (els.newClientSubmitBtn) {
    els.newClientSubmitBtn.classList.remove('is-loading');
    els.newClientSubmitBtn.disabled = false;
  }

  if (!r || !r.ok) {
    return showFormError((r && r.error) || 'Falha ao cadastrar cliente');
  }

  closeNewClientModal();
  toastSuccess('Cliente "' + nome + '" cadastrado com sucesso');
  loadDashboardData(); // refresh imediato
}

function showFormError(msg) {
  if (!els.newClientFormError) {
    toastError(msg);
    return;
  }
  els.newClientFormError.textContent = msg;
  els.newClientFormError.style.display = 'block';
}

/* ============================================================================
 * 24) DRAWER: CAPACITY MONITOR
 * ========================================================================= */

function openCapacityDrawer() {
  if (!els.capacityDrawer) return;
  els.capacityDrawer.removeAttribute('hidden');
  state.ui.capacityDrawerOpen = true;
  renderCapacityDrawer();
}

function closeCapacityDrawer() {
  if (!els.capacityDrawer) return;
  els.capacityDrawer.setAttribute('hidden', '');
  state.ui.capacityDrawerOpen = false;
}

function renderCapacityDrawer() {
  const apps = state.raw.saudeApps || [];

  // Resumo (chips por status)
  if (els.capacityDrawerSummary) {
    const cont = { SAUDAVEL:0, ATENCAO:0, ALERTA:0, CRITICO:0, OFFLINE:0, MIGRADO:0, PENDING:0 };
    apps.forEach(a => {
      const s = String(a.status || 'PENDING').toUpperCase();
      if (cont[s] !== undefined) cont[s]++;
    });
    const ordem = ['CRITICO','ALERTA','ATENCAO','SAUDAVEL','PENDING','OFFLINE','MIGRADO'];
    els.capacityDrawerSummary.innerHTML = ordem
      .filter(k => cont[k] > 0)
      .map(k => [
        '<span class="cap-chip cap-chip--' + k.toLowerCase() + '">',
        '<span class="cap-chip__dot"></span>',
        '<span>' + escapeHtml(k) + '</span>',
        '<span class="cap-chip__count">' + formatNumber(cont[k]) + '</span>',
        '</span>',
      ].join(''))
      .join('');
  }

  // Body (cards)
  if (els.capacityDrawerBody) {
    if (!apps.length) {
      els.capacityDrawerBody.innerHTML = emptyState({
        icon: '📊',
        title: 'Nenhum app monitorado',
        text: 'Apps são registrados automaticamente quando enviam logs.',
      });
    } else {
      // Ordena: CRITICO/ALERTA primeiro, depois ATENCAO, SAUDAVEL, PENDING/OFFLINE/MIGRADO no final
      const peso = (s) => ({ CRITICO:0, ALERTA:1, ATENCAO:2, SAUDAVEL:3, PENDING:4, OFFLINE:5, MIGRADO:6 })[String(s||'').toUpperCase()] ?? 9;
      const sorted = [...apps].sort((a, b) => peso(a.status) - peso(b.status));
      els.capacityDrawerBody.innerHTML = sorted.map(renderCapacityCard).join('');
    }
  }

  // Meta footer
  if (els.capacityDrawerMeta) {
    const ultima = apps.reduce((acc, a) => {
      const t = new Date(a.ultimaColeta || 0).getTime();
      return t > acc ? t : acc;
    }, 0);
    els.capacityDrawerMeta.textContent = ultima
      ? 'Última coleta: ' + relativeTime(new Date(ultima))
      : 'Sem coletas ainda';
  }
}

function renderCapacityCard(a) {
  const status = String(a.status || 'PENDING').toUpperCase();
  const perc = Number(a.percUso) || 0;
  const fillNum = Math.max(0.01, Math.min(1, perc / 100));

  return [
    '<article class="cap-card" data-status="' + escapeHtml(status) + '">',
    '<div class="cap-card__head">',
      '<div>',
        '<div class="cap-card__title">' + escapeHtml((a.app || 'app') + ' · ' + (a.idCliente || '')) + '</div>',
        '<div class="cap-card__sub">' + escapeHtml(a.idApp ? 'ID: ' + truncate(a.idApp, 20) : '') + '</div>',
      '</div>',
      '<span class="cap-card__status">' + escapeHtml(status) + '</span>',
    '</div>',
    '<div class="cap-bar">',
      '<div class="cap-bar__fill" style="width:' + perc.toFixed(1) + '%;--cap-fill:' + perc.toFixed(1) + '%;--cap-fill-num:' + fillNum + '"></div>',
    '</div>',
    '<div class="cap-card__metrics">',
      _capMetric('Uso',         perc.toFixed(1) + '%', perc >= 95 ? 'danger' : perc >= 85 ? 'warning' : 'success'),
      _capMetric('Linhas',      formatNumber(a.qtdLinhas || 0)),
      _capMetric('Tamanho',     (a.tamanhoMB || 0).toFixed(2) + ' MB'),
      _capMetric('Abas',        formatNumber(a.qtdAbas || 0)),
    '</div>',
    a.observacoes ? '<div class="cap-card__note">' + escapeHtml(a.observacoes) + '</div>' : '',
    '</article>',
  ].join('');
}

function _capMetric(label, value, modifier) {
  const cls = modifier ? ' cap-metric__value--' + modifier : '';
  return [
    '<div class="cap-metric">',
    '<div class="cap-metric__label">' + escapeHtml(label) + '</div>',
    '<div class="cap-metric__value' + cls + '">' + escapeHtml(value) + '</div>',
    '</div>',
  ].join('');
}

/* ============================================================================
 * 25) DRAWER: DETAIL (log ou auth event)
 * ========================================================================= */

let _currentDetailItem = null;

window.__gmOpenLogDetail = function (log) {
  _currentDetailItem = { type: 'log', data: log };
  if (!els.detailDrawer) return;
  renderDetailDrawer();
  els.detailDrawer.removeAttribute('hidden');
};

window.__gmOpenAuthDetail = function (ev) {
  _currentDetailItem = { type: 'auth', data: ev };
  if (!els.detailDrawer) return;
  renderDetailDrawer();
  els.detailDrawer.removeAttribute('hidden');
};

function closeDetailDrawer() {
  if (!els.detailDrawer) return;
  els.detailDrawer.setAttribute('hidden', '');
  _currentDetailItem = null;
}

function renderDetailDrawer() {
  if (!els.detailDrawerBody || !_currentDetailItem) return;
  if (_currentDetailItem.type === 'log')  return renderLogDetail(_currentDetailItem.data);
  if (_currentDetailItem.type === 'auth') return renderAuthDetail(_currentDetailItem.data);
}

function renderLogDetail(l) {
  const sev = String(l.severidade || 'info').toLowerCase();
  const kb = matchKB(l.mensagem);

  const meta = [
    ['ID',        truncate(String(l.idLog || '—'), 28)],
    ['App',       l.app || '—'],
    ['Cliente',   l.idCliente || '—'],
    ['Versão',    l.versao || '—'],
    ['Severidade', '<span class="detail-meta__sev detail-meta__sev--' + sev + '">' + escapeHtml(sev) + '</span>'],
    ['Quando',    formatDate(l.timestamp, 'DD/MM/YYYY HH:mm:ss') + ' (' + relativeTime(l.timestamp) + ')'],
  ];

  const metaHtml = meta.map(([k, v]) => [
    '<div class="detail-meta__key">' + escapeHtml(k) + '</div>',
    '<div class="detail-meta__val' + (k === 'ID' ? ' detail-meta__val--mono' : '') + '">' + (k === 'Severidade' ? v : escapeHtml(v)) + '</div>',
  ].join('')).join('');

  const stackHtml = l.stack
    ? '<div class="detail-section"><h3 class="detail-section__title">Stack</h3><pre class="detail-message">' + escapeHtml(l.stack) + '</pre></div>'
    : '';

  const ctxHtml = l.contexto
    ? '<div class="detail-section"><h3 class="detail-section__title">Contexto</h3><pre class="detail-message">' + escapeHtml(_prettyJson(l.contexto)) + '</pre></div>'
    : '';

  const kbHtml = kb ? renderKbSuggestion(kb) : '';

  els.detailDrawerBody.innerHTML = [
    '<div class="detail-meta">' + metaHtml + '</div>',
    '<div class="detail-section">',
      '<h3 class="detail-section__title">Mensagem</h3>',
      '<pre class="detail-message">' + escapeHtml(l.mensagem || '') + '</pre>',
    '</div>',
    stackHtml,
    ctxHtml,
    kbHtml,
  ].join('');
}

function renderAuthDetail(ev) {
  const tipo = String(ev.tipo || '').toLowerCase();
  let sevClass = 'info';
  if (tipo.includes('success') || tipo === 'login')           sevClass = 'success';
  else if (tipo.includes('fail') || tipo.includes('falh'))    sevClass = 'fail';
  else if (tipo.includes('expir'))                            sevClass = 'alerta';

  const meta = [
    ['ID',         truncate(String(ev.idEvento || '—'), 28)],
    ['Tipo',       '<span class="detail-meta__sev detail-meta__sev--' + sevClass + '">' + escapeHtml(ev.tipo || '—') + '</span>'],
    ['App',        ev.app || '—'],
    ['Cliente',    ev.idCliente || '—'],
    ['Usuário',    ev.usuario || '—'],
    ['Funcionário',ev.idFuncionario || '—'],
    ['IP',         ev.ip || '—'],
    ['Quando',     formatDate(ev.timestamp, 'DD/MM/YYYY HH:mm:ss') + ' (' + relativeTime(ev.timestamp) + ')'],
  ];

  const metaHtml = meta.map(([k, v]) => [
    '<div class="detail-meta__key">' + escapeHtml(k) + '</div>',
    '<div class="detail-meta__val' + (k === 'ID' ? ' detail-meta__val--mono' : '') + '">' + (k === 'Tipo' ? v : escapeHtml(v)) + '</div>',
  ].join('')).join('');

  const detalhesHtml = ev.detalhes
    ? '<div class="detail-section"><h3 class="detail-section__title">Detalhes</h3><pre class="detail-message">' + escapeHtml(_prettyJson(ev.detalhes)) + '</pre></div>'
    : '';

  const uaHtml = ev.userAgent
    ? '<div class="detail-section"><h3 class="detail-section__title">User Agent</h3><pre class="detail-message">' + escapeHtml(ev.userAgent) + '</pre></div>'
    : '';

  els.detailDrawerBody.innerHTML = [
    '<div class="detail-meta">' + metaHtml + '</div>',
    detalhesHtml,
    uaHtml,
  ].join('');
}

function renderKbSuggestion(kb) {
  return [
    '<div class="detail-section">',
    '<h3 class="detail-section__title"><span class="kb-badge">KB</span> Padrão reconhecido</h3>',
    '<div class="kb-suggestion">',
      '<div class="kb-suggestion__head">',
        '<span class="kb-suggestion__id">' + escapeHtml(kb.id) + '</span>',
        '<span class="kb-suggestion__cat">' + escapeHtml(kb.categoria) + '</span>',
        '<span class="kb-suggestion__sev kb-suggestion__sev--' + escapeHtml(kb.severidade) + '">' + escapeHtml(kb.severidade) + '</span>',
      '</div>',
      '<h4 class="kb-suggestion__title">' + escapeHtml(kb.titulo) + '</h4>',
      '<p class="kb-suggestion__solucao">' + escapeHtml(kb.solucao) + '</p>',
    '</div>',
    '</div>',
  ].join('');
}

function _prettyJson(val) {
  if (typeof val === 'object' && val !== null) {
    try { return JSON.stringify(val, null, 2); } catch (_) { return String(val); }
  }
  // Pode ser string já em JSON
  try {
    const parsed = JSON.parse(String(val));
    return JSON.stringify(parsed, null, 2);
  } catch (_) {
    return String(val);
  }
}

function copyDetailJsonToClipboard() {
  if (!_currentDetailItem) return;
  const json = _prettyJson(_currentDetailItem.data);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(json)
      .then(() => toastSuccess('JSON copiado'))
      .catch(() => toastError('Falha ao copiar'));
  } else {
    // Fallback antigo
    try {
      const ta = document.createElement('textarea');
      ta.value = json; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      toastSuccess('JSON copiado');
    } catch (_) { toastError('Falha ao copiar'); }
  }
}

/* ============================================================================
 * 26) EXPORTS — CSV + PDF (jsPDF/AutoTable carregados via CDN no index.html)
 * ========================================================================= */

function exportCurrentTabCsv() {
  const aba = state.filtros.abaAtiva;
  let rows, headers, filename;

  if (aba === 'logs') {
    const data = filtrarPorClienteSelecionado();
    let logs = filtrarPorTimeRange(data.logs);
    logs = filtrarPorSeveridade(logs);
    logs = filtrarPorBusca(logs, ['mensagem','app','idCliente','severidade']);
    rows = logs.map(l => ({
      timestamp: l.timestamp, idCliente: l.idCliente, app: l.app, versao: l.versao,
      severidade: l.severidade, mensagem: l.mensagem, contexto: typeof l.contexto === 'object' ? JSON.stringify(l.contexto) : l.contexto,
    }));
    headers = ['timestamp','idCliente','app','versao','severidade','mensagem','contexto'];
    filename = 'logs';
  } else if (aba === 'auth') {
    const data = filtrarPorClienteSelecionado();
    let evs = filtrarPorTimeRange(data.eventosAuth);
    evs = filtrarPorBusca(evs, ['usuario','app','idCliente','tipo','detalhes']);
    rows = evs.map(e => ({
      timestamp: e.timestamp, idCliente: e.idCliente, app: e.app, tipo: e.tipo,
      usuario: e.usuario, idFuncionario: e.idFuncionario, ip: e.ip, detalhes: typeof e.detalhes === 'object' ? JSON.stringify(e.detalhes) : e.detalhes,
    }));
    headers = ['timestamp','idCliente','app','tipo','usuario','idFuncionario','ip','detalhes'];
    filename = 'auth-events';
  } else {
    const data = filtrarPorClienteSelecionado();
    rows = (data.sessoesAtivas || []).map(s => ({
      idSessao: s.idSessao, usuario: s.usuario, app: s.app, idCliente: s.idCliente,
      iniciadoEm: s.iniciadoEm, ultimoHb: s.ultimoHb, ip: s.ip,
    }));
    headers = ['idSessao','usuario','app','idCliente','iniciadoEm','ultimoHb','ip'];
    filename = 'sessoes';
  }

  if (!rows.length) {
    toast('Nada para exportar nesta aba', { type: 'info' });
    return;
  }

  const csv = arrayToCsv(rows, headers);
  const stamp = formatDate(new Date(), 'YYYY-MM-DD-HHmm');
  _downloadFile(filename + '-' + stamp + '.csv', csv, 'text/csv;charset=utf-8');
  toastSuccess('CSV exportado (' + rows.length + ' linhas)');
}

function exportCurrentTabPdf() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toastError('jsPDF não carregado. Verifique conexão com CDN.');
    return;
  }

  const aba = state.filtros.abaAtiva;
  let rows, headers, title;

  const data = filtrarPorClienteSelecionado();
  if (aba === 'logs') {
    let logs = filtrarPorTimeRange(data.logs);
    logs = filtrarPorSeveridade(logs);
    logs = filtrarPorBusca(logs, ['mensagem','app','idCliente','severidade']);
    rows = logs.slice(0, 500).map(l => [
      formatDate(l.timestamp, 'DD/MM HH:mm'),
      l.idCliente || '',
      l.app || '',
      l.severidade || '',
      truncate(l.mensagem || '', 80),
    ]);
    headers = [['Quando','Cliente','App','Severidade','Mensagem']];
    title = 'Relatório de Logs';
  } else if (aba === 'auth') {
    let evs = filtrarPorTimeRange(data.eventosAuth);
    evs = filtrarPorBusca(evs, ['usuario','app','idCliente','tipo']);
    rows = evs.slice(0, 500).map(e => [
      formatDate(e.timestamp, 'DD/MM HH:mm'),
      e.idCliente || '',
      e.app || '',
      e.tipo || '',
      e.usuario || e.idFuncionario || '',
      e.ip || '',
    ]);
    headers = [['Quando','Cliente','App','Tipo','Usuário','IP']];
    title = 'Eventos de Autenticação';
  } else {
    rows = (data.sessoesAtivas || []).map(s => [
      s.usuario || '',
      s.app || '',
      s.idCliente || '',
      formatDate(s.iniciadoEm, 'DD/MM HH:mm'),
      relativeTime(s.ultimoHb),
      s.ip || '',
    ]);
    headers = [['Usuário','App','Cliente','Iniciada','Último HB','IP']];
    title = 'Sessões Ativas';
  }

  if (!rows.length) {
    toast('Nada para exportar nesta aba', { type: 'info' });
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(16);
  doc.text(title, 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(120);
  const subtitle = 'Gerado em ' + formatDate(new Date(), 'DD/MM/YYYY HH:mm') +
    ' · Cliente: ' + (state.filtros.clienteSelecionado === '*' ? 'Todos' : state.filtros.clienteSelecionado) +
    ' · ' + rows.length + ' linhas';
  doc.text(subtitle, 14, 22);

  if (typeof doc.autoTable === 'function') {
    doc.autoTable({
      head: headers,
      body: rows,
      startY: 28,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [44, 91, 160], textColor: 255 },
      alternateRowStyles: { fillColor: [247, 248, 250] },
      margin: { left: 10, right: 10 },
    });
  } else {
    // Fallback se autoTable não estiver disponível
    let y = 30;
    doc.setFontSize(8);
    doc.text(headers[0].join(' | '), 14, y); y += 6;
    rows.forEach(r => {
      if (y > 200) { doc.addPage(); y = 16; }
      doc.text(r.map(c => String(c).slice(0, 30)).join(' | '), 14, y);
      y += 5;
    });
  }

  const stamp = formatDate(new Date(), 'YYYY-MM-DD-HHmm');
  doc.save(title.toLowerCase().replace(/\s+/g, '-') + '-' + stamp + '.pdf');
  toastSuccess('PDF exportado (' + rows.length + ' linhas)');
}

function _downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/* FIM DA PARTE 2/2 — admin.js completo
 * ========================================================================= */
