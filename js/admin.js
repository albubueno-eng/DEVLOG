/**
 * ============================================================================
 *  ADMIN.JS — Painel God Mode (Admin) v2.2
 *  Restauração fiel do dev.js v2.1 + arquitetura ES Modules da Onda 2
 *  ----------------------------------------------------------------------------
 *  Features restauradas do dev.js original:
 *   [GM-03] Auth Guard via auth.js (requireAuth role=admin)
 *   [GM-04] Status ABERTO/RESOLVIDO + botão "Marcar Resolvido" + badges
 *   [GM-06] MTTR (Mean Time To Resolution) com parser de histórico
 *   [GM-07] (backend) Telegram alerts — ver Code.gs Parte B
 *   [GM-08] Filtro temporal in-memory (24h / 7d / 30d / Tudo)
 *   [GM-09] Export PDF via jsPDF + AutoTable
 *   [GM-10] (futuro) RBAC morphing — este arquivo é só admin
 *   Heatmap de erros críticos abertos na sidebar (vermelho/zerado)
 *   Auto-refresh visibility-aware + local tick separados
 *   Atalhos de teclado: r / 1 / 2 / 3 / / / t / c / Esc
 *   Validação anti-duplicata no modal de cliente + auto-sanitize do ID
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


import { apiPost, apiGet } from './api.js';
import { requireAuth, validateSessionOnBoot, logout, getUserContext } from './auth.js';
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
  filtroClienteId: '',
  activeTab: 'logs',
  isLoading: false,
  error: null,
  geradoEm: null,

  ui: {
    search: '',
    timeRange: 'all',                       // [GM-08]
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
// 3. KNOWLEDGE BASE — 40 padrões locais (espelho do backend)
// ============================================================================
const KB_PATTERNS = [
  { id:'sh-001', categoria:'sheets', regex:/Service invoked too many times/i,         titulo:'Quota de execuções esgotada',       severidade:'ERRO',   solucao:'Implementar batch + cache; reduzir frequência de gravações.' },
  { id:'sh-002', categoria:'sheets', regex:/Exceeded maximum execution time/i,        titulo:'Timeout 6 min do Apps Script',      severidade:'ERRO',   solucao:'Quebrar em chunks via PropertiesService + trigger.' },
  { id:'sh-003', categoria:'sheets', regex:/limit.*cells|10.?000.?000/i,              titulo:'Limite de 10M células atingido',    severidade:'ERRO',   solucao:'Migrar dados frios; arquivar abas antigas.' },
  { id:'sh-004', categoria:'sheets', regex:/Range not found|aba não encontrada/i,     titulo:'Range/aba não encontrada',          severidade:'ALERTA',solucao:'Verificar nomes via getSheetByName antes de getRange.' },
  { id:'sh-005', categoria:'sheets', regex:/getValue.*null|getValues.*null/i,         titulo:'Leitura de célula vazia',           severidade:'INFO',  solucao:'Validar com getLastRow/Column antes de ler.' },
  { id:'sh-006', categoria:'sheets', regex:/Lock timeout|waitLock/i,                  titulo:'LockService travado',               severidade:'ALERTA',solucao:'Reduzir tempo crítico; usar tryLock(0) com retry.' },
  { id:'sh-007', categoria:'sheets', regex:/too large|payload exceeded/i,             titulo:'Payload de escrita > 50MB',         severidade:'ERRO',   solucao:'Quebrar setValues em blocos de 5k linhas.' },
  { id:'sh-008', categoria:'sheets', regex:/do not have permission|access denied/i,   titulo:'Permissão de planilha revogada',    severidade:'ERRO',   solucao:'Reautorizar conta de serviço; validar OAuth scopes.' },
  { id:'sh-009', categoria:'sheets', regex:/Document.*deleted|file not found/i,       titulo:'Documento excluído',                severidade:'ERRO',   solucao:'Restaurar do Drive Trash em até 30d.' },
  { id:'sh-010', categoria:'sheets', regex:/Authorization is required/i,              titulo:'Token expirado',                    severidade:'ERRO',   solucao:'Forçar reLogin; renovar refresh_token.' },
  { id:'nw-001', categoria:'rede',   regex:/DNS|getaddrinfo|ENOTFOUND/i,              titulo:'Falha de DNS',                      severidade:'ERRO',   solucao:'Verificar conectividade e DNS.' },
  { id:'nw-002', categoria:'rede',   regex:/ECONNREFUSED|connection refused/i,        titulo:'Conexão recusada',                  severidade:'ERRO',   solucao:'Endpoint offline; ativar fallback.' },
  { id:'nw-003', categoria:'rede',   regex:/ETIMEDOUT|timeout|timed out/i,            titulo:'Timeout de fetch',                  severidade:'ALERTA',solucao:'Aumentar timeout ou usar circuit breaker.' },
  { id:'nw-004', categoria:'rede',   regex:/CORS|Access-Control-Allow/i,              titulo:'CORS bloqueado',                    severidade:'ERRO',   solucao:'Configurar Access-Control-Allow-Origin no servidor.' },
  { id:'nw-005', categoria:'rede',   regex:/SSL|certificate|TLS/i,                    titulo:'Certificado SSL inválido',          severidade:'ERRO',   solucao:'Renovar TLS; conferir cadeia.' },
  { id:'nw-006', categoria:'rede',   regex:/429|Too Many Requests|rate limit/i,       titulo:'Rate limit',                        severidade:'ALERTA',solucao:'Backoff exponencial + jitter.' },
  { id:'nw-007', categoria:'rede',   regex:/502|503|504|gateway/i,                    titulo:'Gateway/upstream',                  severidade:'ALERTA',solucao:'Retry com circuit breaker.' },
  { id:'nw-008', categoria:'rede',   regex:/NetworkError|Failed to fetch/i,           titulo:'Falha de rede no client',           severidade:'ALERTA',solucao:'Detectar offline + retry on visibility.' },
  { id:'au-001', categoria:'auth',   regex:/invalid_grant|token revoked/i,            titulo:'Token revogado',                    severidade:'ERRO',   solucao:'Forçar reautenticação OAuth.' },
  { id:'au-002', categoria:'auth',   regex:/401|Unauthorized/i,                       titulo:'Sem credenciais válidas',           severidade:'ERRO',   solucao:'Renovar API key/token.' },
  { id:'au-003', categoria:'auth',   regex:/403|Forbidden/i,                          titulo:'Permissão negada',                  severidade:'ERRO',   solucao:'Verificar roles do usuário.' },
  { id:'au-004', categoria:'auth',   regex:/session.*expired|sess(a|ã)o.*expirad/i,   titulo:'Sessão expirada',                   severidade:'INFO',  solucao:'Comportamento esperado após 90s sem heartbeat.' },
  { id:'au-005', categoria:'auth',   regex:/wrong password|senha incorreta/i,         titulo:'Login falho',                       severidade:'ALERTA',solucao:'Bloquear após 5 tentativas em 10min.' },
  { id:'au-006', categoria:'auth',   regex:/2FA|two-factor|TOTP/i,                    titulo:'2FA pendente',                      severidade:'INFO',  solucao:'Aguardar código TOTP do usuário.' },
  { id:'dt-001', categoria:'dados',  regex:/undefined is not|Cannot read prop/i,      titulo:'Acesso a undefined',                severidade:'ERRO',   solucao:'Optional chaining + default values.' },
  { id:'dt-002', categoria:'dados',  regex:/NaN|Invalid Number/i,                     titulo:'Conversão numérica falha',          severidade:'ALERTA',solucao:'Number(x) com isFinite() check.' },
  { id:'dt-003', categoria:'dados',  regex:/Invalid Date/i,                           titulo:'Data inválida',                     severidade:'ALERTA',solucao:'ISO-8601 obrigatório; validar antes de new Date().' },
  { id:'dt-004', categoria:'dados',  regex:/JSON.parse|Unexpected token/i,            titulo:'JSON malformado',                   severidade:'ERRO',   solucao:'try/catch + logar primeiros 200 chars.' },
  { id:'dt-005', categoria:'dados',  regex:/duplicate.*key|UNIQUE constraint/i,       titulo:'Chave duplicada',                   severidade:'ALERTA',solucao:'Upsert em vez de insert.' },
  { id:'dt-006', categoria:'dados',  regex:/foreign key|FK constraint/i,              titulo:'FK órfã',                           severidade:'ALERTA',solucao:'Cascata ou validação prévia.' },
  { id:'dt-007', categoria:'dados',  regex:/string.*too long|too long for type/i,     titulo:'String estourou limite',            severidade:'INFO',  solucao:'Truncar antes de gravar (slice).' },
  { id:'dt-008', categoria:'dados',  regex:/required.*missing|campo obrigat/i,        titulo:'Campo obrigatório ausente',         severidade:'ALERTA',solucao:'Validar payload no client + server.' },
  { id:'rt-001', categoria:'device', regex:/out of memory|allocation failed|OOM/i,    titulo:'Out Of Memory',                     severidade:'ERRO',   solucao:'Streamar dados; paginar; liberar refs.' },
  { id:'rt-002', categoria:'device', regex:/storage.*full|QuotaExceededError/i,       titulo:'localStorage cheio',                severidade:'ALERTA',solucao:'Purgar caches antigos; usar IndexedDB.' },
  { id:'rt-003', categoria:'device', regex:/IndexedDB|IDB.*error/i,                   titulo:'IndexedDB falhou',                  severidade:'ALERTA',solucao:'Fallback para memória; alertar usuário.' },
  { id:'rt-004', categoria:'device', regex:/ServiceWorker|sw\.js/i,                   titulo:'Service Worker erro',               severidade:'INFO',  solucao:'Limpar cache do SW; reinstalar.' },
  { id:'rt-005', categoria:'device', regex:/GPU.*lost|WebGL context/i,                titulo:'Contexto GPU perdido',              severidade:'ALERTA',solucao:'Reinicializar canvas; degradar para 2D.' },
  { id:'rt-006', categoria:'device', regex:/battery|low power/i,                      titulo:'Modo baixa energia',                severidade:'INFO',  solucao:'Reduzir polling; pausar animações.' },
  { id:'rt-007', categoria:'device', regex:/permission.*camera|microphone|geo/i,      titulo:'Permissão de mídia negada',         severidade:'ALERTA',solucao:'Solicitar via gesto do usuário; explicar uso.' },
  { id:'rt-008', categoria:'device', regex:/Maximum call stack|stack overflow/i,      titulo:'Stack overflow',                    severidade:'ERRO',   solucao:'Trocar recursão por iteração; checar caso-base.' }
];

function findPatternMatch(text) {
  if (!text) return null;
  const s = String(text);
  for (const p of KB_PATTERNS) {
    if (p.regex.test(s)) return p;
  }
  return null;
}

// ============================================================================
// 4. DOM REFS — IDs adaptados ao index.html v2.2 (kpi-grid + kpi-grid--ops)
// ============================================================================
const dom = {
  // Topbar Auth
  loggedUserDisplay: document.getElementById('userMenu'),
  logoutBtn:         document.getElementById('logoutBtn'),

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

  // KPIs principais (seção kpi-grid)
  kpiMain: {
    clientes:  document.getElementById('kpiClientes'),
    online:    document.getElementById('kpiOnline'),
    erros24h:  document.getElementById('kpiErros24h'),
    auth24h:   document.getElementById('kpiAuth24h')
  },

  // KPIs operacionais (seção kpi-grid--ops)
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

  // Capacity drawer
  capacityBtn:            document.getElementById('capacityBtn'),
  capacityBadge:          document.getElementById('capacityBadge'),
  capacityDrawer:         document.getElementById('capacityDrawer'),
  capacityDrawerSubtitle: null, // não existe no HTML atual — protegido em todos os usos
  capacitySummary:        document.getElementById('capacityDrawerSummary'),
  capacityList:           document.getElementById('capacityDrawerBody'),
  capacityMeta:           document.getElementById('capacityDrawerMeta'),

  // Detail drawer (estrutura simplificada — sem campos pré-prontos no HTML)
  detailDrawer:        document.getElementById('detailDrawer'),
  detailDrawerTitle:   document.getElementById('detailDrawerTitle'),
  detailDrawerSubtitle: null,
  detailDrawerBody:    document.getElementById('detailDrawerBody'),
  detailMeta:          null,
  detailMessage:       null,
  detailKbWrap:        null,
  detailKbId:          null,
  detailKbCat:         null,
  detailKbSev:         null,
  detailKbTitle:       null,
  detailKbSolucao:     null,
  detailCopyBtn:       document.getElementById('detailDrawerCopyBtn'),
  detailMetaFoot:      null
};

// Compat com código que ainda usa dom.kpi.* (algumas partes legacy do admin.js)
// Aponta pros novos KPIs principais (manter consistência sem quebrar nada).
dom.kpi = {
  total:   dom.kpiOps.totalLogs,
  erros:   dom.kpiMain.erros24h,
  alertas: null,
  infos:   null,
  mttr:    null
};

const modal = {
  root:      document.getElementById('newClientModal'),
  form:      document.getElementById('newClientForm'),
  fldId:     document.getElementById('ncIdCliente'),
  fldName:   document.getElementById('ncNome'),
  fldActive: null, // não existe no HTML — wizard usa 'ativo' default true
  saveBtn:   document.getElementById('newClientSubmitBtn'),
  formError: document.getElementById('newClientFormError'),
  openBtn:   document.getElementById('newClientBtn')
};

// ============================================================================
// 5. API LAYER (admin-scoped)
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
    throw new Error('Falha de rede ou CORS. Verifique a implantação.');
  }
  clearTimeout(timeoutId);

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const raw = await resp.text();
  let json;
  try { json = JSON.parse(raw); }
  catch {
    if (raw.includes('<!DOCTYPE') || raw.includes('accounts.google.com')) {
      throw new Error('Apps Script exigiu login. Reimplante como "Qualquer pessoa".');
    }
    throw new Error('Resposta inválida do servidor.');
  }

  if (json.error === 'Sessão inválida ou expirada') {
    forceLogout();
    return;
  }

  if (!json.ok) throw new Error(json.error || 'Resposta inválida do servidor');
  return json.data;
}

async function adminApiPost(action, payload) {
  const token = localStorage.getItem(STORAGE_KEYS.TOKEN) || '';
  const resp = await fetch(SCRIPT_URL, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ apiKey: API_KEY, token, action, ...payload })
  });
  const raw = await resp.text();
  let json;
  try { json = JSON.parse(raw); }
  catch { throw new Error('Resposta inválida do servidor'); }

  if (json.error === 'Sessão inválida ou expirada') {
    forceLogout();
    return;
  }
  if (!json.ok) throw new Error(json.error || 'Falha na operação');
  return json.data;
}

function forceLogout() {
  Object.values(STORAGE_KEYS).forEach(k => {
    try { localStorage.removeItem(k); } catch (_) {}
  });
  window.location.replace(ROUTES.LOGIN || './login.html');
}

// ============================================================================
// 6. STATE MUTATIONS
// ============================================================================
function setLoading(isLoading) {
  state.isLoading = isLoading;
  updateConnectionStatus();
  updateRefreshButton();
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

function setTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  if (state.ui.theme === next) return;
  state.ui.theme = next;
  applyTheme(next, true);
  try { localStorage.setItem(STORAGE_KEYS.THEME, next); } catch (_) {}
}

function setCapacityOpen(open) {
  state.ui.capacityOpen = !!open;
  renderCapacityDrawer();
}

// ============================================================================
// 7. SELETORES DERIVADOS
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
  const r = { total: logs.length, erros: 0, alertas: 0, infos: 0 };
  for (const l of logs) {
    const t = String(l.tipoLog || '').toUpperCase();
    if (t === 'ERRO')        r.erros++;
    else if (t === 'ALERTA') r.alertas++;
    else if (t === 'INFO')   r.infos++;
  }
  return r;
}

// [GM-06] MTTR — Mean Time To Resolution
function calcularMTTR(logs) {
  const resolvidos = logs.filter(l => String(l.status).toUpperCase() === 'RESOLVIDO');
  if (!resolvidos.length) return null;

  let totalMs = 0;
  let validCount = 0;

  for (const l of resolvidos) {
    const criadoEm = new Date(l.timestamp).getTime();
    if (isNaN(criadoEm)) continue;

    const linhasHist = String(l.historico || '').split('\n');
    const linhaRes = linhasHist.find(x => x.includes('RESOLVIDO'));
    if (!linhaRes) continue;

    const match = linhaRes.match(/\[(.*?)\]/);
    if (match && match[1]) {
      const strLimpa = match[1].replace(',', '');
      const partes = strLimpa.split(' ');
      if (partes.length >= 2) {
        const [d, m, y] = partes[0].split('/');
        const [hora, min, sec] = partes[1].split(':');
        const resolvidoEm = new Date(y, m - 1, d, hora, min, sec).getTime();

        if (!isNaN(resolvidoEm) && resolvidoEm >= criadoEm) {
          totalMs += (resolvidoEm - criadoEm);
          validCount++;
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

// HEATMAP — conta apenas ERRO + status !== RESOLVIDO
function contarErrosAbertosPorCliente() {
  const map = new Map();
  let totalErros = 0;
  for (const l of state.logs) {
    const id = String(l.idCliente);
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

function getNomeCliente(id) {
  if (!id) return 'Todos os Clientes';
  const c = state.clientes.find(c => String(c.idCliente) === String(id));
  return c ? c.nomeCliente : id;
}

function applySeverityFilter(logs) {
  const sev = state.ui.severity;
  if (sev.ERRO && sev.ALERTA && sev.INFO) return logs;
  return logs.filter(l => {
    const t = String(l.tipoLog || '').toUpperCase();
    if (t === 'ERRO')   return sev.ERRO;
    if (t === 'ALERTA') return sev.ALERTA;
    if (t === 'INFO')   return sev.INFO;
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

// [GM-08] filtro temporal in-memory
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

// Pipeline: cliente → severidade (só logs) → tempo → busca
function getEventsForActiveTab() {
  if (state.activeTab === 'auth') {
    const auth = getAuthFiltradosCliente();
    const tempoFiltrado = applyTimeFilter(auth);
    return applySearchFilter(tempoFiltrado, 'auth');
  }
  if (state.activeTab === 'sessions') {
    const ses = getSessoesFiltradasCliente();
    const tempoFiltrado = applyTimeFilter(ses);
    return applySearchFilter(tempoFiltrado, 'sessions');
  }
  const c = getLogsFiltradosCliente();
  const s = applySeverityFilter(c);
  const tempoFiltrado = applyTimeFilter(s);
  return applySearchFilter(tempoFiltrado, 'logs');
}

function contains(field, q) {
  if (field === null || field === undefined) return false;
  return String(field).toLowerCase().includes(q);
}

const CAP_STATUS_ORDER = ['CRITICO', 'ALERTA', 'ATENCAO', 'OFFLINE', 'PENDING', 'SAUDAVEL', 'MIGRADO'];

function contarSaudePorStatus() {
  const map = { SAUDAVEL: 0, ATENCAO: 0, ALERTA: 0, CRITICO: 0, OFFLINE: 0, MIGRADO: 0, PENDING: 0 };
  for (const a of state.saudeApps) {
    const st = String(a.status || 'PENDING').toUpperCase();
    if (st in map) map[st]++;
    else map.PENDING++;
  }
  return map;
}

function contarSaudeAlertas() {
  let n = 0;
  for (const a of state.saudeApps) {
    const st = String(a.status || '').toUpperCase();
    if (st === 'CRITICO' || st === 'ALERTA' || st === 'OFFLINE') n++;
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

// ============================================================================
// 8. RENDER LAYER — Sidebar (HEATMAP de erros críticos abertos)
// ============================================================================
function renderSidebar() {
  const ul = dom.clientList;
  if (!ul) return;
  ul.textContent = '';
  const { map: contagensErros, totalErros } = contarErrosAbertosPorCliente();
  const ativoId = state.filtroClienteId;

  ul.appendChild(buildClientItem({
    id: '', nome: 'Todos os Clientes',
    count: totalErros, ativo: ativoId === '',
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
    const id = String(c.idCliente);
    ul.appendChild(buildClientItem({
      id, nome: c.nomeCliente || id,
      count: contagensErros.get(id) || 0,
      ativo: ativoId === id
    }));
  }
}

function buildClientItem({ id, nome, count, ativo, modificador }) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'client-item' + (ativo ? ' client-item--active' : '') +
                  (modificador ? ' ' + modificador : '');
  btn.dataset.clientId = id;
  btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');

  const nameEl = document.createElement('span');
  nameEl.className = 'client-item__name';
  nameEl.textContent = nome;

  const countEl = document.createElement('span');
  countEl.className = 'client-item__count';

  // HEATMAP: vermelho se houver erro crítico aberto, "0" sutil caso contrário
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

// ============================================================================
// 9. RENDER LAYER — Main + KPIs híbridos (consistentes com filtro de cliente)
// ============================================================================
function renderMain() {
  renderHeader();
  renderKPIsMain();      // 4 cards principais
  renderKPIsOps();       // 4 cards operacionais
  renderLiveStrip();
  renderTabs();
  renderToolbarVisibility();
  renderSeverityPills();
  renderSearchClearVisibility();
  renderEventsList();
  renderCapacityBadge();
  if (state.ui.capacityOpen) renderCapacityDrawer();
}

function renderHeader() {
  const filtrando = !!state.filtroClienteId;
  const nome = getNomeCliente(state.filtroClienteId);

  if (dom.mainTitle) {
    dom.mainTitle.textContent = filtrando ? nome : 'Central de Desenvolvedor';
  }
  if (dom.mainSubtitle) {
    dom.mainSubtitle.textContent = filtrando
      ? `Telemetria isolada do cliente ${nome}`
      : 'God Mode';
  }

  const ts = state.geradoEm ? `· atualizado ${relativeTime(state.geradoEm)}` : '';
  const total = getEventsForActiveTab().length;
  const filtroAtivo = isAnyExtraFilterActive() ? ' (filtrados)' : '';
  if (dom.logsMeta) {
    dom.logsMeta.textContent = `${formatNumber(total)} evento(s)${filtroAtivo} ${ts}`;
  }
}

const _MS_24H = 24 * 60 * 60 * 1000;

function _isWithin24h(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return false;
  return (Date.now() - t) <= _MS_24H;
}

function computeKPIs() {
  const totais       = state.totais       || {};
  const operacionais = state.operacionais || {};
  const filtroAtivo  = !!state.filtroClienteId;

  if (!filtroAtivo) {
    return {
      clientes:        Number(totais.clientes ?? state.clientes.length) || 0,
      online:          Number(operacionais.appsMonitorados ?? state.sessoesAtivas.length) || state.sessoesAtivas.length,
      erros24h:        Number(totais.erros24h ?? operacionais.erros24h ?? 0),
      auth24h:         Number(totais.autenticacoes24h ?? 0),
      taxaErro:        Number(operacionais.taxaErro ?? 0),
      loginsFalhos24h: Number(operacionais.loginsFalhos24h ?? 0),
      appsMonitorados: Number(operacionais.appsMonitorados ?? state.saudeApps.length) || state.saudeApps.length,
      totalLogs:       Number(totais.logs ?? state.logs.length) || state.logs.length
    };
  }

  const cid = String(state.filtroClienteId);

  const logsCli = state.logs.filter(l => String(l.idCliente) === cid);
  const authCli = state.eventosAuth.filter(a => String(a.idCliente) === cid);
  const sessCli = state.sessoesAtivas.filter(s => String(s.idCliente) === cid);
  const appsCli = state.saudeApps.filter(a => String(a.idCliente) === cid);

  const logs24h     = logsCli.filter(l => _isWithin24h(l.timestamp));
  const erros24h    = logs24h.filter(l => String(l.tipoLog || '').toUpperCase() === 'ERRO').length;
  const auth24h     = authCli.filter(a => _isWithin24h(a.timestamp)).length;
  const loginsFalhos24h = authCli.filter(a =>
    _isWithin24h(a.timestamp) &&
    String(a.tipoEvento || '').toUpperCase() === 'LOGIN_FALHA'
  ).length;

  const taxaErro = logs24h.length > 0
    ? (erros24h / logs24h.length) * 100
    : 0;

  return {
    clientes:        1,
    online:          sessCli.length,
    erros24h:        erros24h,
    auth24h:         auth24h,
    taxaErro:        taxaErro,
    loginsFalhos24h: loginsFalhos24h,
    appsMonitorados: appsCli.length,
    totalLogs:       logsCli.length
  };
}

function _formatTaxaErro(n) {
  if (!Number.isFinite(n)) return '—';
  if (typeof n === 'string') return n;
  if (n === 0) return '0%';
  if (n < 1)  return n.toFixed(2) + '%';
  if (n < 10) return n.toFixed(1) + '%';
  return Math.round(n) + '%';
}

function renderKPIsMain() {
  const k = computeKPIs();
  if (dom.kpiMain.clientes) dom.kpiMain.clientes.textContent = formatNumber(k.clientes);
  if (dom.kpiMain.online)   dom.kpiMain.online.textContent   = formatNumber(k.online);
  if (dom.kpiMain.erros24h) dom.kpiMain.erros24h.textContent = formatNumber(k.erros24h);
  if (dom.kpiMain.auth24h)  dom.kpiMain.auth24h.textContent  = formatNumber(k.auth24h);
}

function renderKPIsOps() {
  const k = computeKPIs();
  if (dom.kpiOps.taxaErro) {
    const tx = (typeof k.taxaErro === 'string')
      ? k.taxaErro
      : _formatTaxaErro(k.taxaErro);
    dom.kpiOps.taxaErro.textContent = tx;
  }
  if (dom.kpiOps.loginsFalhos)    dom.kpiOps.loginsFalhos.textContent    = formatNumber(k.loginsFalhos24h);
  if (dom.kpiOps.appsMonitorados) dom.kpiOps.appsMonitorados.textContent = formatNumber(k.appsMonitorados);
  if (dom.kpiOps.totalLogs)       dom.kpiOps.totalLogs.textContent       = formatNumber(k.totalLogs);
  
  // MTTR Global [GM-06]
  if (dom.kpiOps.totalLogs && !state.filtroClienteId) {
    const mttr = calcularMTTR(state.logs);
    dom.kpiOps.totalLogs.title = `MTTR Global: ${mttr || 'N/A'}`; 
  }
}

// ============================================================================
// 10. RENDER LAYER — Live Activity Strip
// ============================================================================
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
  if (dom.liveStripMeta) {
    dom.liveStripMeta.textContent = `${sessoes.length} ${sessoes.length === 1 ? 'ativo' : 'ativos'}`;
  }

  const frag = document.createDocumentFragment();
  for (const s of sessoes) frag.appendChild(buildLiveChip(s));
  list.appendChild(frag);
}

function buildLiveChip(sessao) {
  const chip = document.createElement('div');
  chip.className = 'live-chip';
  chip.setAttribute('role', 'listitem');
  chip.title =
    `Usuário: ${sessao.usuario}\n` +
    `App: ${sessao.aplicativo}\n` +
    `Cliente: ${getNomeCliente(sessao.idCliente)}\n` +
    `Dispositivo: ${sessao.dispositivo}\n` +
    `Online há: ${formatDuration(sessao.inicioSessao)}`;

  const avatar = document.createElement('div');
  avatar.className = 'live-chip__avatar';
  avatar.textContent = initials(sessao.usuario);
  avatar.style.background = gradientFromString(sessao.usuario);

  const body = document.createElement('div');
  body.className = 'live-chip__body';

  const name = document.createElement('span');
  name.className = 'live-chip__name';
  name.textContent = sessao.usuario || '—';

  const sub = document.createElement('span');
  sub.className = 'live-chip__sub';
  sub.textContent = `${sessao.aplicativo} · há ${formatDuration(sessao.inicioSessao)}`;

  body.appendChild(name);
  body.appendChild(sub);
  chip.appendChild(avatar);
  chip.appendChild(body);
  return chip;
}

function formatDuration(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';
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
  if (isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
}

// ============================================================================
// 11. RENDER LAYER — Tabs + Toolbar + Severity Pills + Search Clear
// ============================================================================
function renderTabs() {
  const counts = {
    logs:     getLogsFiltradosCliente().length,
    auth:     getAuthFiltradosCliente().length,
    sessions: getSessoesFiltradasCliente().length
  };
  if (dom.tabCounts.logs)     dom.tabCounts.logs.textContent     = formatNumber(counts.logs);
  if (dom.tabCounts.auth)     dom.tabCounts.auth.textContent     = formatNumber(counts.auth);
  if (dom.tabCounts.sessions) dom.tabCounts.sessions.textContent = formatNumber(counts.sessions);

  if (!dom.eventTabs) return;
  const buttons = dom.eventTabs.querySelectorAll('.tab');
  buttons.forEach(btn => {
    const isActive = btn.dataset.tab === state.activeTab;
    btn.classList.toggle('tab--active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function renderToolbarVisibility() {
  if (!dom.severityPills) return;
  const showPills = state.activeTab === 'logs';
  dom.severityPills.hidden = !showPills;
  if (dom.searchInput) {
    const placeholders = {
      logs:     'Buscar em mensagens, apps, usuários…',
      auth:     'Buscar em eventos, usuários, apps…',
      sessions: 'Buscar em sessões, usuários, dispositivos…'
    };
    dom.searchInput.placeholder = placeholders[state.activeTab] || 'Buscar…';
  }
}

function renderSeverityPills() {
  if (!dom.severityPills) return;
  const logs = getLogsFiltradosCliente();
  const counts = { ERRO: 0, ALERTA: 0, INFO: 0 };
  for (const l of logs) {
    const t = String(l.tipoLog || '').toUpperCase();
    if (t in counts) counts[t]++;
  }
  if (dom.pillCountErro)   dom.pillCountErro.textContent   = formatNumber(counts.ERRO);
  if (dom.pillCountAlerta) dom.pillCountAlerta.textContent = formatNumber(counts.ALERTA);
  if (dom.pillCountInfo)   dom.pillCountInfo.textContent   = formatNumber(counts.INFO);

  const pills = dom.severityPills.querySelectorAll('.pill[data-severity]');
  pills.forEach(p => {
    const sev = p.dataset.severity;
    const active = !!state.ui.severity[sev];
    p.classList.toggle('is-active', active);
    p.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function renderSearchClearVisibility() {
  if (!dom.searchClearBtn) return;
  dom.searchClearBtn.style.visibility = state.ui.search ? 'visible' : 'hidden';
}

// ============================================================================
// 12. RENDER LAYER — Events List (Dispatcher + Cards)
// ============================================================================
function renderEventsList() {
  const list = dom.logsList;
  if (!list) return;
  list.textContent = '';

  if (state.isLoading && state.logs.length === 0 &&
      state.eventosAuth.length === 0 && state.sessoesAtivas.length === 0) {
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

  const items = getEventsForActiveTab().sort((a,b) => new Date(b.timestamp || b.inicioSessao) - new Date(a.timestamp || a.inicioSessao));
  if (!items.length) {
    list.appendChild(buildEmptyStateForTab());
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
      const isOnline = String(item.status).toUpperCase() === 'ATIVA' || item.online;
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
  const filtrando = !!state.filtroClienteId;
  const cliente = getNomeCliente(state.filtroClienteId);
  const buscando = !!state.ui.search;

  if (buscando) {
    return buildEmptyState({
      icon: '⌕',
      title: 'Nada encontrado',
      text: `Nenhum resultado para "${state.ui.search}". Limpe a busca ou tente outros termos.`
    });
  }

  if (state.activeTab === 'logs') {
    const s = state.ui.severity;
    const todasOff = !s.ERRO && !s.ALERTA && !s.INFO;
    if (todasOff) {
      return buildEmptyState({
        icon: '◌',
        title: 'Filtros desligados',
        text: 'Ative ao menos uma severidade (Erro, Alerta ou Info) para ver logs.'
      });
    }
    return buildEmptyState({
      icon: '✓',
      title: 'Nenhum log registrado',
      text: filtrando
        ? `${cliente} não possui logs no período carregado.`
        : 'O ecossistema está silencioso. Bom sinal.'
    });
  }
  if (state.activeTab === 'auth') {
    return buildEmptyState({
      icon: '◌',
      title: 'Nenhum evento de autenticação',
      text: filtrando
        ? `${cliente} não tem eventos de auth registrados.`
        : 'Nenhum login ou logout foi registrado ainda.'
    });
  }
  return buildEmptyState({
    icon: '○',
    title: 'Nenhuma sessão ativa',
    text: filtrando
      ? `${cliente} não tem usuários online no momento.`
      : 'Nenhum usuário está online agora.'
  });
}

function buildErrorState() {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';
  const i = document.createElement('div');
  i.className = 'empty-state__icon';
  i.style.color = 'var(--danger)';
  i.textContent = '⚠';
  const t = document.createElement('p');
  t.className = 'empty-state__title';
  t.textContent = 'Falha ao carregar dados';
  const d = document.createElement('p');
  d.className = 'empty-state__text';
  d.textContent = state.error?.message || 'Verifique a URL e a API_KEY.';
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
// ============================================================================
// 8. DETAIL DRAWER + [GM-04] Resolver Log (Corrigido)
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
        const resolucao = prompt('Anotação de resolução (opcional):', '');
        if (resolucao === null) return;
        try {
          resolveBtn.disabled = true;
          resolveBtn.textContent = 'Resolvendo...';
          
          // PAYLOAD CORRIGIDO PARA O BACKEND
          await adminApiPost('updatelogstatus', { 
            timestamp: data.timestamp,
            idCliente: data.idCliente,
            mensagemErro: data.mensagemErro,
            novoStatus: 'RESOLVIDO',
            resolucao: resolucao.trim() 
          });
          
          closeDetailDrawer();
          await loadData();
          toastSuccess('Log marcado como resolvido!');
        } catch(e) {
          toastError('Falha ao resolver: ' + e.message);
          resolveBtn.disabled = false;
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
  dom.refreshBtn.classList.toggle('is-loading', state.isLoading);
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
  logs:     ['timestamp', 'tipoLog', 'idCliente', 'aplicativo', 'usuario', 'dispositivo', 'mensagemErro', 'status'],
  auth:     ['timestamp', 'tipoEvento', 'idCliente', 'aplicativo', 'usuario', 'dispositivo', 'detalhes', 'ip'],
  sessions: ['inicioSessao', 'ultimoPing', 'idCliente', 'aplicativo', 'usuario', 'dispositivo', 'ip']
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
    const row = headers.map(h => csvEscape(item[h]));
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
    const body = items.map(item => headers.map(h => String(item[h] || '')));

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
        <div style="padding:12px 20px;border-top:1px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" data-close class="btn btn--ghost">Fechar</button>
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
              <td style="padding:10px;"><strong>${escapeHtml(c.nome)}</strong><br><small style="color:#6b7280;">${escapeHtml(c.idCliente)}</small></td>
              <td style="padding:10px;">${escapeHtml(c.plano)}</td>
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
    body.innerHTML = `<div style="background:#fee2e2;color:#991b1b;padding:12px;border-radius:6px;">❌ Falha ao carregar as Quotas: ${escapeHtml(e.message)}</div>`;
  }
}

// ============================================================================
// 14. FORMULÁRIO INTELIGENTE — Novo Cliente (Restaurado e Blindado)
// ============================================================================
function openNewClientModal() {
  const modalObj = document.getElementById('newClientModal');
  const formObj = document.getElementById('formNovoCliente');
  if (!modalObj || !formObj) return;
  
  formObj.reset();
  formObj.querySelectorAll('.is-invalid, .is-valid').forEach(el => el.classList.remove('is-invalid', 'is-valid'));
  const banner = formObj.querySelector('.form__banner');
  if (banner) banner.remove();
  
  const logoPreview = document.getElementById('ncLogoPreview');
  const logoRemoveBtn = document.getElementById('ncLogoRemoveBtn');
  if (logoPreview) logoPreview.innerHTML = '<span class="logo-uploader__placeholder">Sem logo</span>';
  if (logoRemoveBtn) logoRemoveBtn.hidden = true;
  
  modalObj.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => formObj.querySelector('input')?.focus(), 50);
}

function closeNewClientModal() {
  const modalObj = document.getElementById('newClientModal');
  if (modalObj) modalObj.hidden = true;
  document.body.style.overflow = '';
}

// RESTAURAÇÃO: O motor completo do formulário isolado em um IIFE.
(function initFormNovoCliente() {
  const form = document.getElementById('formNovoCliente');
  if (!form) return;

  const $ = (sel) => form.querySelector(sel);
  const fields = {
    idCliente:    $('#ncIdCliente'),
    razaoSocial:  $('#ncRazaoSocial'),
    nomeFantasia: $('#ncNomeFantasia'),
    cnpj:         $('#ncCnpj'),
    email:        $('#ncEmail'),
    telefone:     $('#ncTelefone'),
    plano:        $('#ncPlano'),
    quota:        $('#ncQuota'),
    logoUrl:      $('#ncLogoUrl'),
    corPrim:      $('#ncCorPrimaria'),
    corPicker:    $('#ncCorPicker'),
  };
  
  const submitBtn  = $('#ncSubmitBtn');
  const btnLabel   = submitBtn?.querySelector('.btn__label') || submitBtn;
  const btnSpinner = submitBtn?.querySelector('.btn__spinner');

  function setError(fieldName, msg) {
    const wrap = form.querySelector(`[data-field="${fieldName}"]`);
    if (!wrap) return;
    wrap.classList.add('is-invalid');
    wrap.classList.remove('is-valid');
    const errEl = wrap.querySelector('.form__error');
    if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
  }

  function setValid(fieldName) {
    const wrap = form.querySelector(`[data-field="${fieldName}"]`);
    if (!wrap) return;
    wrap.classList.remove('is-invalid');
    wrap.classList.add('is-valid');
    const errEl = wrap.querySelector('.form__error');
    if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
  }

  function clearState(fieldName) {
    const wrap = form.querySelector(`[data-field="${fieldName}"]`);
    if (!wrap) return;
    wrap.classList.remove('is-invalid', 'is-valid');
    const errEl = wrap.querySelector('.form__error');
    if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
  }

  function clearAllErrors() {
    form.querySelectorAll('.form__field').forEach(f => {
      f.classList.remove('is-invalid', 'is-valid');
      const e = f.querySelector('.form__error');
      if (e) { e.textContent = ''; e.hidden = true; }
    });
    const banner = form.querySelector('.form__banner');
    if (banner) banner.remove();
  }

  function showBanner(msg, type = 'error') {
    let banner = form.querySelector('.form__banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'form__banner';
      banner.style.cssText = 'margin:12px 20px 0; padding:8px 12px; border-radius:6px; font-size:12px; font-weight:500;';
      form.insertBefore(banner, form.firstChild);
    }
    if (type === 'error') {
      banner.style.background = 'rgba(220,38,38,0.08)';
      banner.style.color = '#b91c1c';
      banner.style.borderLeft = '3px solid #dc2626';
    } else {
      banner.style.background = 'rgba(16,185,129,0.08)';
      banner.style.color = '#047857';
      banner.style.borderLeft = '3px solid #10b981';
    }
    banner.textContent = msg;
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function validarCnpj(cnpj) {
    const d = String(cnpj).replace(/\D/g, '');
    if (d.length !== 14) return false;
    if (/^(\d)\1{13}$/.test(d)) return false; 
    let t = d.length - 2, n = d.substring(0, t), v = d.substring(t), s = 0, p = t - 7;
    for (let i = t; i >= 1; i--) { s += +n.charAt(t - i) * p--; if (p < 2) p = 9; }
    let r = s % 11 < 2 ? 0 : 11 - s % 11;
    if (r != +v.charAt(0)) return false;
    t = t + 1; n = d.substring(0, t); s = 0; p = t - 7;
    for (let i = t; i >= 1; i--) { s += +n.charAt(t - i) * p--; if (p < 2) p = 9; }
    r = s % 11 < 2 ? 0 : 11 - s % 11;
    return r == +v.charAt(1);
  }

  function validarEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim()); }

  // Mascaras e Listeners Visuais
  fields.cnpj?.addEventListener('input', (e) => {
    e.target.value = maskCnpj(e.target.value);
  });
  fields.idCliente?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  });
  fields.corPicker?.addEventListener('input', (e) => {
    fields.corPrim.value = e.target.value;
    clearState('corPrimaria');
  });
  fields.corPrim?.addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) fields.corPicker.value = v.toLowerCase();
  });

  function validateField(name) {
    const v = (fields[name === 'corPrim' ? 'corPrim' : (name === 'quota' ? 'quota' : name)]?.value || '').trim();
    switch (name) {
      case 'idCliente':
        if (!v) return setError('idCliente', 'Obrigatório.');
        if (!/^[a-z0-9_-]{2,32}$/.test(v)) return setError('idCliente', 'Use 2-32 caracteres: a-z, 0-9, _ ou -.');
        if (state.clientes.some(c => String(c.idCliente).toLowerCase() === v)) return setError('idCliente', 'ID já em uso.');
        return setValid('idCliente');
      case 'razaoSocial':
        if (!v) return setError('razaoSocial', 'Obrigatório.');
        if (v.length < 3) return setError('razaoSocial', 'Mínimo 3 caracteres.');
        return setValid('razaoSocial');
      case 'cnpj':
        if (!v) return setError('cnpj', 'Obrigatório.');
        if (v.replace(/\D/g, '').length !== 14) return setError('cnpj', 'CNPJ incompleto.');
        if (!validarCnpj(v)) return setError('cnpj', 'CNPJ inválido.');
        return setValid('cnpj');
      case 'email':
        if (!v) { clearState('email'); return; }
        if (!validarEmail(v)) return setError('email', 'Email inválido.');
        return setValid('email');
      case 'quota':
        const n = Number(v);
        if (!v) return setError('quotaFuncionarios', 'Obrigatório.');
        if (!Number.isFinite(n) || n < 1 || n > 500) return setError('quotaFuncionarios', 'Entre 1 e 500.');
        return setValid('quotaFuncionarios');
      case 'corPrim':
        if (!v) { clearState('corPrimaria'); return; }
        if (!/^#[0-9a-fA-F]{6}$/.test(v)) return setError('corPrimaria', 'Use formato #RRGGBB.');
        return setValid('corPrimaria');
    }
  }

  fields.idCliente?.addEventListener('blur',   () => validateField('idCliente'));
  fields.razaoSocial?.addEventListener('blur', () => validateField('razaoSocial'));
  fields.cnpj?.addEventListener('blur',        () => validateField('cnpj'));
  fields.email?.addEventListener('blur',       () => validateField('email'));
  fields.quota?.addEventListener('input',      () => validateField('quota'));
  fields.corPrim?.addEventListener('blur',     () => validateField('corPrim'));

  Object.values(fields).forEach(el => {
    el?.addEventListener('input', () => {
      const wrap = el.closest('.form__field');
      if (wrap?.classList.contains('is-invalid')) {
        wrap.classList.remove('is-invalid');
        const e = wrap.querySelector('.form__error');
        if (e) { e.textContent = ''; e.hidden = true; }
      }
    });
  });

  const logoFile      = document.getElementById('ncLogoFile');
  const logoUploadBtn = document.getElementById('ncLogoUploadBtn');
  const logoRemoveBtn = document.getElementById('ncLogoRemoveBtn');
  const logoPreview   = document.getElementById('ncLogoPreview');
  const MAX_LOGO_KB   = 500;

  if (logoUploadBtn && logoFile) {
    logoUploadBtn.addEventListener('click', () => logoFile.click());
  }

  if (logoFile) {
    logoFile.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_LOGO_KB * 1024) {
        setError('logo', `Máximo ${MAX_LOGO_KB} KB.`);
        logoFile.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        if (logoPreview) logoPreview.innerHTML = `<img src="${dataUrl}" alt="logo" style="width:100%;height:100%;object-fit:contain;"/>`;
        if (logoRemoveBtn) logoRemoveBtn.hidden = false;
        fields.logoUrl.value = dataUrl;
        setValid('logo');
      };
      reader.onerror = () => setError('logo', 'Falha na leitura.');
      reader.readAsDataURL(file);
    });
  }

  if (logoRemoveBtn) {
    logoRemoveBtn.addEventListener('click', () => {
      fields.logoUrl.value = '';
      if (logoFile) logoFile.value = '';
      if (logoPreview) logoPreview.innerHTML = '<span class="logo-uploader__placeholder">Sem logo</span>';
      logoRemoveBtn.hidden = true;
      clearState('logo');
    });
  }

  fields.logoUrl?.addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (!v) {
      if (logoPreview) logoPreview.innerHTML = '<span class="logo-uploader__placeholder">Sem logo</span>';
      if (logoRemoveBtn) logoRemoveBtn.hidden = true;
      return;
    }
    if (/^https:\/\//.test(v) || /^data:image\//.test(v)) {
      if (logoPreview) logoPreview.innerHTML = `<img src="${v}" alt="logo" style="width:100%;height:100%;object-fit:contain;"/>`;
      if (logoRemoveBtn) logoRemoveBtn.hidden = false;
    }
  });

  // RESTAURAÇÃO: SUBMIT PROTEGIDO COM A API NATIVA E AVALIAÇÃO DE ERROS
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearAllErrors();

    // Força a validação visual de todos os campos antes de continuar
    ['idCliente', 'razaoSocial', 'cnpj', 'email', 'quota', 'corPrim'].forEach(validateField);

    const invalidFields = form.querySelectorAll('.form__field.is-invalid');
    if (invalidFields.length > 0) {
      showBanner('Corrija os campos destacados.', 'error');
      return; // Trava aqui se houver erros visíveis (Borda Vermelha)
    }

    // NOVA TRAVA: Captura os Apps selecionados nas caixinhas do HTML
    const appsSelecionados = Array.from(form.querySelectorAll('input[name="ncApps"]:checked')).map(cb => cb.value);
    
    if (appsSelecionados.length === 0) {
      showBanner('Selecione pelo menos um App Contratado!', 'error');
      return; // Trava se não escolheu nem Ponto nem Estoque
    }

    const payload = {
      idCliente:         fields.idCliente.value.trim().toLowerCase(),
      nome:              fields.razaoSocial.value.trim(),
      nomeFantasia:      fields.nomeFantasia.value.trim() || fields.razaoSocial.value.trim(),
      cnpj:              fields.cnpj.value.replace(/\D/g, ''),
      email:             fields.email.value.trim(),
      telefone:          fields.telefone.value.trim(),
      plano:             fields.plano.value,
      quotaFuncionarios: Number(fields.quota.value),
      logoUrl:           fields.logoUrl.value.trim(),
      corPrimaria:       fields.corPrim.value.trim() || '#2563eb',
      appsContratados:   appsSelecionados.join(','), // ENVIANDO OS APPS AQUI
      ativo:             true
    };

    submitBtn.disabled = true;
    if (btnLabel) btnLabel.textContent = 'Cadastrando...';
    if (btnSpinner) btnSpinner.hidden = false;

    try {
      await adminApiPost('createClient', payload);
      toastSuccess('Cliente cadastrado com sucesso!');
      closeNewClientModal();
      await loadData();
      setFilter(payload.idCliente);
    } catch (err) {
      showBanner(`Falha ao cadastrar: ${err.message}`, 'error');
    } finally {
      submitBtn.disabled = false;
      if (btnLabel) btnLabel.textContent = 'Cadastrar cliente';
      if (btnSpinner) btnSpinner.hidden = true;
    }
  });
})(); // <--- ESSA É A CHAVE ABENÇOADA QUE FALTAVA!

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
  
  // Delegação de cliques global - fecha e abre modais corretamente
  document.addEventListener('click', e => {
    if (e.target.closest('#capacityDrawerCloseBtn') || e.target.closest('#capacityDrawer .drawer__backdrop')) {
      closeCapacityDrawer();
    }
    if (e.target.closest('#detailDrawerCloseBtn') || e.target.closest('#detailDrawer .drawer__backdrop')) {
      closeDetailDrawer();
    }
    // CORREÇÃO: Removemos a busca por .btn--ghost aqui para que não bloqueie o botão de UPLOAD FOTO
    if (e.target.closest('#newClientCloseBtn') || e.target.closest('#newClientModal .modal__backdrop') || e.target.closest('#newClientModal [data-close]')) {
      closeNewClientModal();
    }
    // Abre modal de cliente
    if (e.target.closest('#newClientBtn') || e.target.closest('#fabNovoCliente')) {
      openNewClientModal();
    }
  });

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

// Torna o Monitor de Clientes (V3) disponível globalmente se precisar ser chamado de fora
window.openQuotaMonitor = openQuotaMonitor;
