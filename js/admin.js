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
import { toast } from './ui-shared.js';

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

function setActiveTab(tab) {
  if (!['logs', 'auth', 'sessions'].includes(tab)) return;
  state.activeTab = tab;
  renderTabs();
  renderToolbarVisibility();
  renderEventsList();
  renderHeader();
}

function setSearch(query) {
  const norm = String(query || '').toLowerCase().trim();
  if (norm === state.ui.search) return;
  state.ui.search = norm;
  renderSearchClearVisibility();
  renderEventsList();
  renderHeader();
}

function toggleSeverity(sev) {
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
  if (state.ui.timeRange === '24h') limiteMs = 24 * 60 * 60 * 1000;
  else if (state.ui.timeRange === '7d') limiteMs = 7 * 24 * 60 * 60 * 1000;
  else if (state.ui.timeRange === '30d') limiteMs = 30 * 24 * 60 * 60 * 1000;
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

// ────────────────────────────────────────────────────────────────────────────
// MOTOR DE KPIs — Híbrido inteligente
//   • filtro = '' (Todos) → usa data.totais / data.operacionais (fonte do backend)
//   • filtro = 'crv'      → recalcula em cima de state.logs/eventosAuth/sessoesAtivas
//                            (consistente com o que está na tela)
// ────────────────────────────────────────────────────────────────────────────

const _MS_24H = 24 * 60 * 60 * 1000;

function _isWithin24h(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return false;
  return (Date.now() - t) <= _MS_24H;
}

/**
 * Calcula os KPIs do contexto atual (respeitando filtro de cliente).
 * Retorna sempre o mesmo shape, vindo do backend ou recalculado no frontend.
 */
function computeKPIs() {
  const totais       = state.totais       || {};
  const operacionais = state.operacionais || {};
  const filtroAtivo  = !!state.filtroClienteId;

  if (!filtroAtivo) {
    // ── MODO GLOBAL: backend é a fonte da verdade ───────────────────────
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

  // ── MODO FILTRADO: recalcula sobre os dados já filtrados por cliente ─
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
    clientes:        1,                    // o filtrado em si conta como 1
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
  // Se já vier formatado como string do backend, normaliza
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
    // Backend pode mandar string formatada ou número; trata ambos
    const tx = (typeof k.taxaErro === 'string')
      ? k.taxaErro
      : _formatTaxaErro(k.taxaErro);
    dom.kpiOps.taxaErro.textContent = tx;
  }
  if (dom.kpiOps.loginsFalhos)    dom.kpiOps.loginsFalhos.textContent    = formatNumber(k.loginsFalhos24h);
  if (dom.kpiOps.appsMonitorados) dom.kpiOps.appsMonitorados.textContent = formatNumber(k.appsMonitorados);
  if (dom.kpiOps.totalLogs)       dom.kpiOps.totalLogs.textContent       = formatNumber(k.totalLogs);
}


// Render Live Strip / Tabs / Toolbar / Pills / Search Clear continuam na Parte A2
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
  dom.searchClearBtn.hidden = !state.ui.search;
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

  const items = getEventsForActiveTab();
  if (!items.length) {
    list.appendChild(buildEmptyStateForTab());
    return;
  }

  const frag = document.createDocumentFragment();
  if (state.activeTab === 'logs') {
    for (const log of items) frag.appendChild(buildLogCard(log));
  } else if (state.activeTab === 'auth') {
    for (const ev of items) frag.appendChild(buildAuthCard(ev));
  } else {
    for (const s of items)  frag.appendChild(buildSessionCard(s));
  }
  list.appendChild(frag);
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

// ---- Cards ----
function buildLogCard(log) {
  const tipo = String(log.tipoLog || '').toUpperCase();
  const tipoClass = tipo === 'ERRO'   ? 'log-card--erro'
                  : tipo === 'ALERTA' ? 'log-card--alerta'
                  : tipo === 'INFO'   ? 'log-card--info' : '';

  const card = document.createElement('article');
  card.className = `log-card ${tipoClass}`.trim();
  card.setAttribute('role', 'listitem');

  const icon = document.createElement('div');
  icon.className = 'log-card__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = tipo === 'ERRO' ? '!' : tipo === 'ALERTA' ? '▲' : 'i';

  const body = document.createElement('div');
  body.className = 'log-card__body';

  const head = document.createElement('div');
  head.className = 'log-card__head';
  const app = document.createElement('span');
  app.className = 'log-card__app';
  app.textContent = log.aplicativo || '—';
  const client = document.createElement('span');
  client.className = 'log-card__client';
  client.textContent = getNomeCliente(log.idCliente);
  head.appendChild(app);
  head.appendChild(client);

  // [GM-04] Badge de Status no Card
  const statusLog = String(log.status || 'ABERTO').toUpperCase();
  if (statusLog !== 'ABERTO') {
    const badgeStatus = document.createElement('span');
    badgeStatus.style.marginLeft = '8px';
    badgeStatus.style.padding = '2px 6px';
    badgeStatus.style.borderRadius = '4px';
    badgeStatus.style.fontSize = '10px';
    badgeStatus.style.fontWeight = 'bold';
    badgeStatus.style.backgroundColor = statusLog === 'RESOLVIDO' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.1)';
    badgeStatus.style.color = statusLog === 'RESOLVIDO' ? '#10B981' : '#94A3B8';
    badgeStatus.textContent = statusLog;
    head.appendChild(badgeStatus);
  }

  const message = document.createElement('pre');
  message.className = 'log-card__message';
  message.textContent = log.mensagemErro || '(sem mensagem)';

  const meta = document.createElement('div');
  meta.className = 'log-card__meta';
  meta.appendChild(buildMetaItem('Usuário', log.usuario));
  meta.appendChild(buildMetaItem('Dispositivo', log.dispositivo));

  body.appendChild(head);
  body.appendChild(message);
  body.appendChild(meta);

  const time = document.createElement('time');
  time.className = 'log-card__time';
  time.dateTime = log.timestamp || '';
  time.textContent = relativeTime(log.timestamp);
  time.title = formatAbsoluteTime(log.timestamp);

  card.appendChild(icon);
  card.appendChild(body);
  card.appendChild(time);

  makeCardInteractive(card, () => openDetailDrawer('log', log));
  return card;
}

function buildAuthCard(ev) {
  const tipo = String(ev.tipoEvento || '').toUpperCase();
  const tipoClass = tipo === 'LOGIN_SUCESSO'   ? 'auth-card--success'
                  : tipo === 'LOGIN_FALHA'     ? 'auth-card--fail'
                  : tipo === 'LOGOUT'          ? 'auth-card--logout'
                  : tipo === 'SESSAO_EXPIRADA' ? 'auth-card--expired' : '';
  const tipoIcon = tipo === 'LOGIN_SUCESSO'   ? '✓'
                 : tipo === 'LOGIN_FALHA'     ? '✗'
                 : tipo === 'LOGOUT'          ? '→'
                 : tipo === 'SESSAO_EXPIRADA' ? '◷' : '?';
  const tipoLabel = tipo === 'LOGIN_SUCESSO'   ? 'login'
                  : tipo === 'LOGIN_FALHA'     ? 'falha'
                  : tipo === 'LOGOUT'          ? 'logout'
                  : tipo === 'SESSAO_EXPIRADA' ? 'expirada' : tipo;

  const card = document.createElement('article');
  card.className = `auth-card ${tipoClass}`.trim();
  card.setAttribute('role', 'listitem');

  const icon = document.createElement('div');
  icon.className = 'auth-card__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = tipoIcon;

  const body = document.createElement('div');
  body.className = 'auth-card__body';

  const head = document.createElement('div');
  head.className = 'auth-card__head';
  const user = document.createElement('span');
  user.className = 'auth-card__user';
  user.textContent = ev.usuario || '—';
  const tag = document.createElement('span');
  tag.className = 'auth-card__type';
  tag.textContent = tipoLabel;
  const client = document.createElement('span');
  client.className = 'log-card__client';
  client.textContent = getNomeCliente(ev.idCliente);
  head.appendChild(user);
  head.appendChild(tag);
  head.appendChild(client);

  body.appendChild(head);

  if (ev.detalhes && String(ev.detalhes).trim()) {
    const det = document.createElement('p');
    det.className = 'auth-card__details';
    det.textContent = ev.detalhes;
    body.appendChild(det);
  }

  const meta = document.createElement('div');
  meta.className = 'auth-card__meta';
  meta.appendChild(buildMetaItem('App', ev.aplicativo));
  meta.appendChild(buildMetaItem('Dispositivo', ev.dispositivo));
  body.appendChild(meta);

  const time = document.createElement('time');
  time.className = 'auth-card__time';
  time.dateTime = ev.timestamp || '';
  time.textContent = relativeTime(ev.timestamp);
  time.title = formatAbsoluteTime(ev.timestamp);

  card.appendChild(icon);
  card.appendChild(body);
  card.appendChild(time);

  makeCardInteractive(card, () => openDetailDrawer('auth', ev));
  return card;
}

function buildSessionCard(s) {
  const card = document.createElement('article');
  card.className = 'session-card';
  card.setAttribute('role', 'listitem');

  const avatar = document.createElement('div');
  avatar.className = 'session-card__avatar';
  avatar.textContent = initials(s.usuario);
  avatar.style.background = gradientFromString(s.usuario);

  const body = document.createElement('div');
  body.className = 'session-card__body';

  const head = document.createElement('div');
  head.className = 'session-card__head';
  const name = document.createElement('span');
  name.className = 'session-card__name';
  name.textContent = s.usuario || '—';
  const app = document.createElement('span');
  app.className = 'session-card__app';
  app.textContent = s.aplicativo || '—';
  const client = document.createElement('span');
  client.className = 'log-card__client';
  client.textContent = getNomeCliente(s.idCliente);
  head.appendChild(name);
  head.appendChild(app);
  head.appendChild(client);

  const meta = document.createElement('div');
  meta.className = 'session-card__meta';
  meta.appendChild(buildMetaItem('Dispositivo', s.dispositivo));
  meta.appendChild(buildMetaItem('Último ping', relativeTime(s.ultimoPing)));

  body.appendChild(head);
  body.appendChild(meta);

  const timeWrap = document.createElement('div');
  timeWrap.className = 'session-card__time';
  const dur = document.createElement('span');
  dur.className = 'session-card__duration';
  dur.textContent = formatDuration(s.inicioSessao);
  const since = document.createElement('span');
  since.className = 'session-card__since';
  since.textContent = `desde ${formatAbsoluteTime(s.inicioSessao)}`;
  timeWrap.appendChild(dur);
  timeWrap.appendChild(since);

  card.appendChild(avatar);
  card.appendChild(body);
  card.appendChild(timeWrap);

  makeCardInteractive(card, () => openDetailDrawer('session', s));
  return card;
}

function makeCardInteractive(card, onActivate) {
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.addEventListener('click', onActivate);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  });
}

function buildMetaItem(label, value) {
  const span = document.createElement('span');
  span.className = 'log-card__meta-item';
  span.textContent = `${label}: ${value || '—'}`;
  return span;
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
// 13. DETAIL DRAWER + [GM-04] Resolver Log
// Estratégia X: gera HTML interno via template em #detailDrawerBody
// ============================================================================
function openDetailDrawer(kind, data) {
  if (!dom.detailDrawer || !data) return;

  const kbMatch = (kind === 'log')  ? findPatternMatch(data.mensagemErro)
                : (kind === 'auth') ? findPatternMatch(data.detalhes)
                : null;

  state.ui.detailOpen = true;
  state.ui.detailContext = { kind, data, kbMatch };

  populateDetailDrawer(kind, data, kbMatch);

  dom.detailDrawer.hidden = false;
  dom.detailDrawer.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => dom.detailDrawer.classList.add('drawer--open'));
}

function closeDetailDrawer() {
  if (!dom.detailDrawer) return;
  state.ui.detailOpen = false;
  state.ui.detailContext = null;
  dom.detailDrawer.classList.remove('drawer--open');
  dom.detailDrawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => { dom.detailDrawer.hidden = true; }, 220);
}

// [GM-04] Action principal de resolução
async function actionResolverLog(logData) {
  const resolucao = prompt('Solução aplicada (opcional):', '');
  if (resolucao === null) return;

  // NÃO usa setLoading aqui — deixa loadData() controlar o ciclo de loading
  // sozinho. Senão criamos deadlock: setLoading(true) → loadData aborta com
  // "if (state.isLoading) return" → setLoading(false) nunca é chamado.
  try {
    await adminApiPost('updatelogstatus', {
      timestamp:    logData.timestamp,
      idCliente:    logData.idCliente,
      mensagemErro: logData.mensagemErro,
      novoStatus:   'RESOLVIDO',
      resolucao:    resolucao.trim()
    });
    closeDetailDrawer();
    await loadData();
    toast('Log marcado como resolvido', 'success');
  } catch (err) {
    toast('Falha ao resolver: ' + (err.message || err), 'error');
  }
}



function populateDetailDrawer(kind, data, kbMatch) {
  const titleMap = { log: 'Detalhe do log', auth: 'Detalhe de autenticação', session: 'Detalhe da sessão' };
  if (dom.detailDrawerTitle) dom.detailDrawerTitle.textContent = titleMap[kind] || 'Detalhe do evento';

  const body = dom.detailDrawerBody;
  if (!body) return;

  let html = '';
  if (kind === 'log')          html = _buildLogDetailHTML(data, kbMatch);
  else if (kind === 'auth')    html = _buildAuthDetailHTML(data, kbMatch);
  else if (kind === 'session') html = _buildSessionDetailHTML(data);
  else                         html = '<p class="detail__empty">Tipo desconhecido.</p>';

  body.innerHTML = html;

  // Bind do botão "Marcar Resolvido" (só logs ABERTO + admin)
  const resolveBtn = body.querySelector('#gm-resolve-btn');
  if (resolveBtn) {
    resolveBtn.addEventListener('click', () => actionResolverLog(data));
  }
}

// ----------------------------------------------------------------------------
// Builders por tipo
// ----------------------------------------------------------------------------
function _buildLogDetailHTML(log, kbMatch) {
  const status      = String(log.status || 'ABERTO').toUpperCase();
  const isOpen      = status !== 'RESOLVIDO';
  const sev         = String(log.tipoLog || 'INFO').toUpperCase();
  const sevColor    = sev === 'ERRO' ? '#dc2626' : sev === 'ALERTA' ? '#f59e0b' : '#3b82f6';
  const statusColor = isOpen ? '#dc2626' : '#10b981';
  const ts          = formatAbsoluteTime(log.timestamp);
  const cliente     = getNomeCliente(log.idCliente);
  const app         = log.aplicativo || '—';
  const usuario     = log.usuario || '—';
  const dispositivo = log.dispositivo || '—';
  const mensagem    = _esc(log.mensagemErro || '(sem mensagem)');

  // Histórico
  let historicoHtml = '';
  if (log.historico) {
    const linhas = String(log.historico).split('\n').filter(Boolean);
    if (linhas.length) {
      historicoHtml = `
        <section class="detail__section">
          <h3 class="detail__section-title">Histórico</h3>
          <ul class="detail__history">
            ${linhas.map(l => `<li>${_esc(l)}</li>`).join('')}
          </ul>
        </section>`;
    }
  }

  // Bloco de resolução (se já resolvido)
  const resolucaoHtml = (!isOpen && (log.resolvidoPor || log.resolucao)) ? `
    <section class="detail__section detail__section--resolved">
      <h3 class="detail__section-title">Resolução</h3>
      <dl class="detail__dl">
        ${log.resolvidoPor ? `<dt>Resolvido por</dt><dd>${_esc(log.resolvidoPor)}</dd>` : ''}
        ${log.resolucao    ? `<dt>Notas</dt><dd>${_esc(log.resolucao)}</dd>`           : ''}
      </dl>
    </section>` : '';

  // KB match
  const kbHtml = kbMatch ? `
    <section class="detail__section detail__section--kb">
      <h3 class="detail__section-title">📚 Knowledge Base — ${_esc(kbMatch.id)} · ${_esc(kbMatch.titulo)}</h3>
      <p class="detail__kb-cat">Categoria: <strong>${_esc(kbMatch.categoria)}</strong> · Severidade: <strong>${_esc(kbMatch.severidade)}</strong></p>
      <p class="detail__kb-solution">${_esc(kbMatch.solucao || 'Sem sugestão.')}</p>
    </section>` : '';

  // Botão "Marcar Resolvido" (só se aberto e admin)
  const isAdmin = (state.user?.nivel === 'admin') ||
                  (localStorage.getItem(STORAGE_KEYS.ESCOPO) === '*');
   const resolveBtnHtml = (isOpen && isAdmin) ? `
    <div class="detail__actions">
      <button type="button" class="btn btn--primary btn--block" id="gm-resolve-btn">
        ✓ Marcar como Resolvido
      </button>
    </div>` : '';

  return `
    <div class="detail">
      <header class="detail__header">
        <span class="detail__badge" style="background:${statusColor}1a;color:${statusColor};border:1px solid ${statusColor}">${status}</span>
        <span class="detail__badge" style="background:${sevColor}1a;color:${sevColor};border:1px solid ${sevColor}">${sev}</span>
      </header>

      <section class="detail__section">
        <dl class="detail__dl">
          <dt>Quando</dt><dd>${_esc(ts)}</dd>
          <dt>Cliente</dt><dd>${_esc(cliente)}</dd>
          <dt>Aplicativo</dt><dd>${_esc(app)}</dd>
          <dt>Usuário</dt><dd>${_esc(usuario)}</dd>
          <dt>Dispositivo</dt><dd>${_esc(dispositivo)}</dd>
        </dl>
      </section>

      <section class="detail__section">
        <h3 class="detail__section-title">Mensagem</h3>
        <pre class="detail__message">${mensagem}</pre>
      </section>

      ${kbHtml}
      ${historicoHtml}
      ${resolucaoHtml}
      ${resolveBtnHtml}
    </div>
  `;
}

function _buildAuthDetailHTML(ev, kbMatch) {
  const tipo   = String(ev.tipoEvento || '—').toUpperCase();
  const isFail = /FALHA|FAIL|EXPIRAD/i.test(tipo);
  const cor    = isFail ? '#dc2626' : tipo === 'LOGIN_SUCESSO' ? '#10b981' : '#3b82f6';
  const det    = ev.detalhes ? `
    <section class="detail__section">
      <h3 class="detail__section-title">Detalhes</h3>
      <p class="detail__message">${_esc(ev.detalhes)}</p>
    </section>` : '';
  const kbHtml = kbMatch ? `
    <section class="detail__section detail__section--kb">
      <h3 class="detail__section-title">📚 Knowledge Base — ${_esc(kbMatch.id)} · ${_esc(kbMatch.titulo)}</h3>
      <p class="detail__kb-solution">${_esc(kbMatch.solucao || '')}</p>
    </section>` : '';

  return `
    <div class="detail">
      <header class="detail__header">
        <span class="detail__badge" style="background:${cor}1a;color:${cor};border:1px solid ${cor}">${tipo}</span>
      </header>
      <section class="detail__section">
        <dl class="detail__dl">
          <dt>Quando</dt><dd>${_esc(formatAbsoluteTime(ev.timestamp))}</dd>
          <dt>Cliente</dt><dd>${_esc(getNomeCliente(ev.idCliente))}</dd>
          <dt>Aplicativo</dt><dd>${_esc(ev.aplicativo || '—')}</dd>
          <dt>Usuário</dt><dd>${_esc(ev.usuario || '—')}</dd>
          <dt>Dispositivo</dt><dd>${_esc(ev.dispositivo || '—')}</dd>
        </dl>
      </section>
      ${det}
      ${kbHtml}
    </div>`;
}

function _buildSessionDetailHTML(s) {
  return `
    <div class="detail">
      <header class="detail__header">
        <span class="detail__badge" style="background:#10b9811a;color:#10b981;border:1px solid #10b981">ONLINE</span>
      </header>
      <section class="detail__section">
        <dl class="detail__dl">
          <dt>Cliente</dt><dd>${_esc(getNomeCliente(s.idCliente))}</dd>
          <dt>Aplicativo</dt><dd>${_esc(s.aplicativo || '—')}</dd>
          <dt>Usuário</dt><dd>${_esc(s.usuario || '—')}</dd>
          <dt>Dispositivo</dt><dd>${_esc(s.dispositivo || '—')}</dd>
          <dt>Início</dt><dd>${_esc(formatAbsoluteTime(s.inicioSessao))}</dd>
          <dt>Último ping</dt><dd>${_esc(relativeTime(s.ultimoPing))}</dd>
          <dt>Duração</dt><dd>${_esc(formatDuration(s.inicioSessao))}</dd>
        </dl>
      </section>
    </div>`;
}

// Escape HTML local (evita conflito com escapeHtml de utils.js se assinatura diferir)
function _esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


// ============================================================================
// 14. STATUS PILL + REFRESH BUTTON
// ============================================================================
function updateConnectionStatus() {
  const pill = dom.connectionStatus;
  if (!pill) return;
  // O HTML usa <span class="status-pill__label"> dentro do pill.
  // Procura ambos os nomes para compatibilidade.
  const textEl = pill.querySelector('.status-pill__label') ||
                 pill.querySelector('.status-pill__text');
  if (state.isLoading) {
    pill.dataset.state = 'loading';
    if (textEl) textEl.textContent = 'Sincronizando…';
  } else if (state.error) {
    pill.dataset.state = 'error';
    if (textEl) textEl.textContent = 'Erro de conexão';
  } else {
    pill.dataset.state = 'online'; // CSS provavelmente reage a 'online'
    if (textEl) textEl.textContent = 'Online';
  }
}


function updateRefreshButton() {
  if (!dom.refreshBtn) return;
  dom.refreshBtn.disabled = state.isLoading;
  const span = dom.refreshBtn.querySelector('span');
  if (span) span.textContent = state.isLoading ? 'Atualizando' : 'Atualizar';
}

// ============================================================================
// 15. THEME TOGGLE
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
    dom.themeToggleBtn.setAttribute('aria-label',
      theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro');
    dom.themeToggleBtn.title = theme === 'dark' ? 'Tema escuro ativo' : 'Tema claro ativo';
  }
}

// ============================================================================
// 16. EXPORT CSV & PDF [GM-09]
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
  a.style.display = 'none';
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
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'pt', 'a4');
    const headers = CSV_HEADERS[tab];
    const body = items.map(item => {
      const enriched = { ...item, cliente: getNomeCliente(item.idCliente) };
      return headers.map(h => String(enriched[h] || ''));
    });
    const titles = { logs: 'Logs e Erros', auth: 'Autenticações', sessions: 'Sessões Ativas' };
    const title = `Relatório God Mode — ${titles[tab] || tab.toUpperCase()}`;

    doc.setFontSize(16);
    doc.text(title, 40, 40);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 40, 55);

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
    console.error(e);
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
  const btn = btnElement || dom.exportCsvBtn;
  if (!btn) return;
  const span = btn.querySelector('span');
  if (!span) return;
  const original = span.textContent;
  span.textContent = msg;
  btn.disabled = true;
  setTimeout(() => {
    span.textContent = original;
    btn.disabled = false;
  }, 1400);
}

// ============================================================================
// 17. CAPACITY DRAWER
// ============================================================================
function openCapacityDrawer()  { setCapacityOpen(true); }
function closeCapacityDrawer() { setCapacityOpen(false); }

function renderCapacityBadge() {
  if (!dom.capacityBadge) return;
  const n = contarSaudeAlertas();
  if (n <= 0) {
    dom.capacityBadge.hidden = true;
    dom.capacityBadge.textContent = '0';
  } else {
    dom.capacityBadge.hidden = false;
    dom.capacityBadge.textContent = n > 99 ? '99+' : String(n);
  }
}

function renderCapacityDrawer() {
  if (!dom.capacityDrawer) return;
  if (!state.ui.capacityOpen) {
    dom.capacityDrawer.hidden = true;
    dom.capacityDrawer.setAttribute('aria-hidden', 'true');
    return;
  }
  dom.capacityDrawer.hidden = false;
  dom.capacityDrawer.setAttribute('aria-hidden', 'false');

  if (dom.capacityDrawerSubtitle) {
    const total = state.saudeApps.length;
    dom.capacityDrawerSubtitle.textContent = total
      ? `Saúde e saturação de ${total} app(s) monitorado(s)`
      : 'Saúde e saturação dos apps monitorados';
  }
  renderCapacitySummary();
  renderCapacityList();
  renderCapacityFooter();
}

function renderCapacitySummary() {
  const wrap = dom.capacitySummary;
  if (!wrap) return;
  wrap.textContent = '';
  const counts = contarSaudePorStatus();
  const order = ['CRITICO', 'ALERTA', 'ATENCAO', 'OFFLINE', 'PENDING', 'SAUDAVEL', 'MIGRADO'];
  const labels = {
    SAUDAVEL: 'Saudáveis', ATENCAO: 'Atenção', ALERTA: 'Alerta',
    CRITICO: 'Crítico', OFFLINE: 'Offline', MIGRADO: 'Migrado', PENDING: 'Pendente'
  };
  const frag = document.createDocumentFragment();
  let totalChips = 0;
  for (const st of order) {
    const n = counts[st] || 0;
    if (!n) continue;
    totalChips++;
    const chip = document.createElement('span');
    chip.className = `cap-chip cap-chip--${st.toLowerCase()}`;
    const dot = document.createElement('span');
    dot.className = 'cap-chip__dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = labels[st] || st;
    const count = document.createElement('span');
    count.className = 'cap-chip__count';
    count.textContent = formatNumber(n);
    chip.appendChild(dot);
    chip.appendChild(label);
    chip.appendChild(count);
    frag.appendChild(chip);
  }
  if (totalChips) wrap.appendChild(frag);
}

function renderCapacityList() {
  const wrap = dom.capacityList;
  if (!wrap) return;
  wrap.textContent = '';
  if (!state.saudeApps.length) {
    wrap.appendChild(buildEmptyState({
      icon: '∅',
      title: 'Nenhum app monitorado',
      text: 'Aguardando primeira coleta da Central de Capacity.'
    }));
    return;
  }
  const sorted = [...state.saudeApps].sort((a, b) => {
    const sa = CAP_STATUS_ORDER.indexOf(String(a.status || 'PENDING').toUpperCase());
    const sb = CAP_STATUS_ORDER.indexOf(String(b.status || 'PENDING').toUpperCase());
    if (sa !== sb) return sa - sb;
    const pa = Number(a?.capacidade?.percentualUso) || 0;
    const pb = Number(b?.capacidade?.percentualUso) || 0;
    return pb - pa;
  });
  const frag = document.createDocumentFragment();
  for (const app of sorted) frag.appendChild(buildCapacityCard(app));
  wrap.appendChild(frag);
}

function renderCapacityFooter() {
  if (!dom.capacityMeta) return;
  const ts = state.geradoEm ? relativeTime(state.geradoEm) : '—';
  const total = state.saudeApps.length;
  if (!total) {
    dom.capacityMeta.textContent = `Sem dados · atualizado ${ts}`;
    return;
  }
  const alertas = contarSaudeAlertas();
  dom.capacityMeta.textContent =
    `${formatNumber(total)} app(s) · ${formatNumber(alertas)} requer(em) atenção · atualizado ${ts}`;
}

function buildCapacityCard(app) {
  const status = String(app.status || 'PENDING').toUpperCase();
  const cap = app.capacidade || {};
  const pct = clampPct(Number(cap.percentualUso));
  const dias = Number(cap.diasRestantes);

  const card = document.createElement('article');
  card.className = 'cap-card';
  card.dataset.status = status;
  card.setAttribute('role', 'listitem');

  const head = document.createElement('div');
  head.className = 'cap-card__head';
  const heading = document.createElement('div');
  const title = document.createElement('h3');
  title.className = 'cap-card__title';
  title.textContent = app.nomeApp || app.idApp || '(sem nome)';
  const sub = document.createElement('p');
  sub.className = 'cap-card__sub';
  const tipoStorage = app.tipoStorage ? ` · ${app.tipoStorage}` : '';
  sub.textContent = `${getNomeCliente(app.idCliente)}${tipoStorage}`;
  heading.appendChild(title);
  heading.appendChild(sub);
  const tag = document.createElement('span');
  tag.className = 'cap-card__status';
  tag.textContent = capStatusLabel(status);
  head.appendChild(heading);
  head.appendChild(tag);
  card.appendChild(head);

  if (Number.isFinite(pct)) {
    const bar = document.createElement('div');
    bar.className = 'cap-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(pct.toFixed(1)));
    bar.title = `${pct.toFixed(1)}% utilizado`;
    const fill = document.createElement('div');
    fill.className = 'cap-bar__fill';
    fill.style.setProperty('--cap-fill', `${pct}%`);
    fill.style.setProperty('--cap-fill-num', String(Math.max(pct / 100, 0.01)));
    bar.appendChild(fill);
    card.appendChild(bar);
  }

  const metrics = document.createElement('div');
  metrics.className = 'cap-card__metrics';

  if (Number.isFinite(pct)) {
    metrics.appendChild(buildCapMetric('Uso', `${pct.toFixed(1)}%`, pctColorClass(pct)));
  }
  if (Number.isFinite(Number(cap.totalCelulas)) && Number.isFinite(Number(cap.limiteCelulas))) {
    metrics.appendChild(buildCapMetric('Células',
      `${formatNumber(cap.totalCelulas)} / ${formatNumber(cap.limiteCelulas)}`));
  }
  if (Number.isFinite(Number(cap.totalLinhas))) {
    metrics.appendChild(buildCapMetric('Linhas', formatNumber(cap.totalLinhas)));
  }
  if (Number.isFinite(Number(cap.crescimentoDiarioCelulas))) {
    metrics.appendChild(buildCapMetric('Crescimento/dia',
      `${formatNumber(Math.round(cap.crescimentoDiarioCelulas))} cel.`));
  }
  if (Number.isFinite(dias)) {
    const cls = dias < 30 ? 'danger' : dias < 90 ? 'warning' : 'success';
    const txt = dias < 0 ? 'estourado' : `${formatNumber(Math.round(dias))} dias`;
    metrics.appendChild(buildCapMetric('Tempo restante', txt, cls));
  }

  if (metrics.children.length) card.appendChild(metrics);

  if (!Number.isFinite(pct) && status === 'PENDING') {
    const note = document.createElement('p');
    note.className = 'cap-card__note';
    note.textContent = 'Aguardando primeiro healthCheck do app.';
    card.appendChild(note);
  } else if (status === 'OFFLINE') {
    const note = document.createElement('p');
    note.className = 'cap-card__note';
    note.textContent = 'App não respondeu ao último healthCheck.';
    card.appendChild(note);
  } else if (status === 'MIGRADO') {
    const note = document.createElement('p');
    note.className = 'cap-card__note';
    note.textContent = 'Storage migrado — monitoramento histórico congelado.';
    card.appendChild(note);
  }
  return card;
}

function buildCapMetric(label, value, modifier) {
  const wrap = document.createElement('div');
  wrap.className = 'cap-metric';
  const l = document.createElement('span');
  l.className = 'cap-metric__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'cap-metric__value' + (modifier ? ` cap-metric__value--${modifier}` : '');
  v.textContent = value;
  wrap.appendChild(l);
  wrap.appendChild(v);
  return wrap;
}

function clampPct(n) {
  if (!Number.isFinite(n)) return NaN;
  return Math.max(0, Math.min(100, n));
}

function pctColorClass(pct) {
  if (pct >= 85) return 'danger';
  if (pct >= 65) return 'warning';
  return 'success';
}

function capStatusLabel(status) {
  const map = {
    SAUDAVEL: 'Saudável', ATENCAO: 'Atenção', ALERTA: 'Alerta',
    CRITICO: 'Crítico',   OFFLINE: 'Offline', MIGRADO: 'Migrado', PENDING: 'Pendente'
  };
  return map[status] || status;
}

// ============================================================================
// 18. EVENTS
// ============================================================================
function bindEvents() {
  // Logout
  if (dom.logoutBtn) {
    dom.logoutBtn.addEventListener('click', async () => {
      try { await adminApiPost('logoutgodmode', {}); } catch (_) {}
      forceLogout();
    });
  }

  // Sidebar — click + keyboard
  if (dom.clientList) {
    dom.clientList.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.client-item');
      if (!btn) return;
      const id = btn.dataset.clientId ?? '';
      setFilter(id);
    });

    dom.clientList.addEventListener('keydown', (ev) => {
      if (!['ArrowDown', 'ArrowUp'].includes(ev.key)) return;
      const items = Array.from(dom.clientList.querySelectorAll('.client-item'));
      const idx = items.indexOf(document.activeElement);
      if (idx === -1) return;
      ev.preventDefault();
      const next = ev.key === 'ArrowDown' ? items[idx + 1] : items[idx - 1];
      if (next) next.focus();
    });
  }

  // Tabs
  if (dom.eventTabs) {
    dom.eventTabs.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab');
      if (!btn) return;
      setActiveTab(btn.dataset.tab);
    });
  }

  // Refresh
  if (dom.refreshBtn) dom.refreshBtn.addEventListener('click', loadData);

  // Search
  if (dom.searchInput) {
    const debounced = debounce((val) => setSearch(val), ADMIN_CONFIG.SEARCH_DEBOUNCE_MS);
    dom.searchInput.addEventListener('input', (ev) => debounced(ev.target.value));
    dom.searchInput.addEventListener('search', (ev) => setSearch(ev.target.value));
  }
  if (dom.searchClearBtn) {
    dom.searchClearBtn.addEventListener('click', () => {
      if (dom.searchInput) dom.searchInput.value = '';
      setSearch('');
      if (dom.searchInput) dom.searchInput.focus();
    });
  }

  // Severity pills
  if (dom.severityPills) {
    dom.severityPills.addEventListener('click', (ev) => {
      const pill = ev.target.closest('.pill[data-severity]');
      if (!pill) return;
      toggleSeverity(pill.dataset.severity);
    });
  }

  // [GM-08] Filtro temporal
  if (dom.timeFilterSelect) {
    dom.timeFilterSelect.addEventListener('change', (ev) => {
      state.ui.timeRange = ev.target.value;
      renderEventsList();
      renderHeader();
    });
  }

  // [GM-09] Export
  if (dom.exportCsvBtn) dom.exportCsvBtn.addEventListener('click', exportCurrentTabAsCSV);
  if (dom.exportPdfBtn) dom.exportPdfBtn.addEventListener('click', exportCurrentTabAsPDF);

  // Theme
  if (dom.themeToggleBtn) {
    dom.themeToggleBtn.addEventListener('click', () => {
      setTheme(state.ui.theme === 'dark' ? 'light' : 'dark');
    });
  }

    // Capacity drawer
  if (dom.capacityBtn) dom.capacityBtn.addEventListener('click', openCapacityDrawer);
  if (dom.capacityDrawer) {
    dom.capacityDrawer.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-close], .drawer__close')) closeCapacityDrawer();
    });
  }


    // Detail drawer (X button + backdrop click)
  if (dom.detailDrawer) {
    dom.detailDrawer.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-close], .drawer__close')) closeDetailDrawer();
    });
  }

    if (dom.detailCopyBtn) {
    dom.detailCopyBtn.addEventListener('click', () => {
      const ctx = state.ui.detailContext;
      if (!ctx) return;
      const payload = {
        kind: ctx.kind,
        data: ctx.data,
        knowledgeBaseMatch: ctx.kbMatch || null
      };
      const json = JSON.stringify(payload, null, 2);

      const flash = (msg) => {
        const btn = dom.detailCopyBtn;
        const prev = btn.textContent;
        btn.textContent = msg;
        btn.disabled = true;
        setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1200);
      };

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(json)
          .then(() => flash('Copiado ✓'))
          .catch(() => flash('Falhou ✗'));
      } else {
        const ta = document.createElement('textarea');
        ta.value = json;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); flash('Copiado ✓'); }
        catch (_) { flash('Falhou ✗'); }
        document.body.removeChild(ta);
      }
    });
  }


  // Atalhos de teclado: r / 1 / 2 / 3 / / / t / c / Esc
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && state.ui.detailOpen) {
      closeDetailDrawer();
      return;
    }
    if (ev.key === 'Escape' && state.ui.capacityOpen) {
      closeCapacityDrawer();
      return;
    }
    const isInput = document.activeElement &&
                    ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (isInput || ev.metaKey || ev.ctrlKey) return;
    const k = ev.key.toLowerCase();
    if (k === 'r') loadData();
    else if (k === '1') setActiveTab('logs');
    else if (k === '2') setActiveTab('auth');
    else if (k === '3') setActiveTab('sessions');
    else if (k === '/') {
      if (dom.searchInput) {
        ev.preventDefault();
        dom.searchInput.focus();
        dom.searchInput.select();
      }
    } else if (k === 't') {
      setTheme(state.ui.theme === 'dark' ? 'light' : 'dark');
    } else if (k === 'c') {
      state.ui.capacityOpen ? closeCapacityDrawer() : openCapacityDrawer();
    }
  });

  document.addEventListener('visibilitychange', handleVisibilityChange);
}

// ============================================================================
// 19. CLIENT MODAL (validação anti-duplicata + auto-sanitize)
// ============================================================================
function openClientModal() {
  // Delegado ao handler novo (Patch 1 do formulário inteligente)
  if (typeof window.openNewClientModal === 'function') {
    return window.openNewClientModal();
  }
  // Fallback: abre direto sem reset
  const modal = document.getElementById('newClientModal');
  if (!modal) {
    console.error('[openClientModal] modal não encontrado');
    return;
  }
  const form = document.getElementById('formNovoCliente');
  if (form && typeof form.reset === 'function') {
    form.reset();
  }
  modal.hidden = false;
  modal.removeAttribute('aria-hidden');
}


function closeClientModal() {
  if (!modal.root) return;
  modal.root.hidden = true;
  modal.root.setAttribute('aria-hidden', 'true');
  setSaveButtonLoading(false);
}

function setSaveButtonLoading(isLoading) {
  if (!modal.saveBtn) return;
  modal.saveBtn.classList.toggle('is-loading', isLoading);
  modal.saveBtn.disabled = isLoading;
  const span = modal.saveBtn.querySelector('span');
  if (span) span.textContent = isLoading ? 'Cadastrando' : 'Cadastrar Cliente';
}

function clearFieldErrors() {
  if (modal.fldId)   modal.fldId.classList.remove('is-invalid');
  if (modal.fldName) modal.fldName.classList.remove('is-invalid');
  document.querySelectorAll('[data-error-for]').forEach(el => { el.textContent = ''; });
  if (modal.formError) {
    modal.formError.hidden = true;
    modal.formError.textContent = '';
  }
}

function setFieldError(name, msg) {
  const el = document.querySelector(`[data-error-for="${name}"]`);
  if (el) el.textContent = msg;
  if (name === 'idCliente'   && modal.fldId)   modal.fldId.classList.add('is-invalid');
  if (name === 'nomeCliente' && modal.fldName) modal.fldName.classList.add('is-invalid');
}

function setFormError(msg) {
  if (!modal.formError) return;
  modal.formError.textContent = msg;
  modal.formError.hidden = false;
}

function validateClientForm({ idCliente, nomeCliente }) {
  let ok = true;
  if (!idCliente) {
    setFieldError('idCliente', 'Obrigatório'); ok = false;
  } else if (!/^[a-z0-9_-]+$/.test(idCliente)) {
    setFieldError('idCliente', 'Use apenas letras minúsculas, números, - ou _'); ok = false;
  } else if (state.clientes.some(c => String(c.idCliente).toLowerCase() === idCliente)) {
    setFieldError('idCliente', 'Já existe um cliente com esse ID'); ok = false;
  }
  if (!nomeCliente) { setFieldError('nomeCliente', 'Obrigatório'); ok = false; }
  return ok;
}

async function handleClientSubmit(ev) {
  ev.preventDefault();
  clearFieldErrors();
  const idCliente   = modal.fldId.value.trim().toLowerCase();
  const nomeCliente = modal.fldName.value.trim();
  const ativo       = modal.fldActive.checked;
  if (!validateClientForm({ idCliente, nomeCliente })) return;

  setSaveButtonLoading(true);
  try {
    await adminApiPost('createClient', { idCliente, nomeCliente, ativo });
    closeClientModal();
    await loadData();
    setFilter(idCliente);
    toast('Cliente cadastrado com sucesso', 'success');
  } catch (err) {
    console.error('[GodMode] Falha ao criar cliente:', err);
    setFormError(err.message || 'Não foi possível cadastrar.');
    setSaveButtonLoading(false);
  }
}

function bindClientModalEvents() {
  if (!modal.openBtn || !modal.root) return;
  modal.openBtn.addEventListener('click', openClientModal);
  modal.root.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-close]')) closeClientModal();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !modal.root.hidden) closeClientModal();
  });
  if (modal.form) modal.form.addEventListener('submit', handleClientSubmit);

  // Auto-sanitize do ID enquanto digita
  if (modal.fldId) {
    modal.fldId.addEventListener('input', () => {
      const val = modal.fldId.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (val !== modal.fldId.value) modal.fldId.value = val;
    });
  }
}

// ============================================================================
// 20. UTILS LOCAIS (formato absoluto + duração)
// ============================================================================
function formatAbsoluteTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
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

// ============================================================================
// 21. AUTO-REFRESH (visibility-aware) + LOCAL TICK SEPARADOS
// ============================================================================
let autoRefreshTimer = null;
let localTickTimer = null;

function startAutoRefresh() {
  if (ADMIN_CONFIG.AUTO_REFRESH_MS <= 0) return;
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(() => {
    if (state.isLoading) return;
    if (modal.root && !modal.root.hidden) return; // pausa com modal aberto
    loadData();
  }, ADMIN_CONFIG.AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function startLocalTick() {
  if (localTickTimer) return;
  localTickTimer = setInterval(() => {
    if (state.isLoading) return;
    renderHeader();
    renderLiveStrip();
    renderEventsList();
    if (state.ui.capacityOpen) renderCapacityFooter();
  }, ADMIN_CONFIG.LOCAL_TICK_MS);
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    loadData();
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

// ============================================================================
// 22. ORCHESTRATION
// ============================================================================
async function loadData() {
  if (state.isLoading) return;
  setLoading(true);
  setError(null);
  try {
    const data = await fetchDashboardData();
    if (!data) return; // forceLogout já redirecionou
    setData(data);
    if (state.filtroClienteId &&
        !state.clientes.some(c => String(c.idCliente) === String(state.filtroClienteId))) {
      state.filtroClienteId = '';
    }
    renderSidebar();
    renderMain();
  } catch (err) {
    console.error('[GodMode] Falha no fetch:', err);
    setError(err);
    renderMain();
  } finally {
    setLoading(false);
  }
}

async function init() {
  // GM-03: Auth Guard via auth.js
  requireAuth({ role: 'admin' });

  // Carrega contexto do usuário (token, escopo, nível)
  const ctx = getUserContext();
  state.user.usuario = ctx.usuario;
  state.user.nivel   = ctx.nivel;
  state.user.escopo  = ctx.escopo || '*';
  if (dom.loggedUserDisplay) dom.loggedUserDisplay.textContent = state.user.usuario || 'Admin';

  // Tema
  state.ui.theme = detectInitialTheme();
  applyTheme(state.ui.theme, false);

  // Valida sessão de forma não-bloqueante (redireciona se inválida)
  validateSessionOnBoot().catch(() => {});

  // Bind events
  bindEvents();
  bindClientModalEvents();

  // Primeira carga + timers
  loadData();
  startAutoRefresh();
  startLocalTick();

  // UI chrome + PWA
  bootUIChrome();
  registerServiceWorker();
}

function bootUIChrome() {
  document.body.classList.add('pronto');
  setTimeout(() => {
    const tampa = document.getElementById('tampa-carregamento');
    if (tampa) {
      tampa.style.opacity = '0';
      setTimeout(() => tampa.remove(), 400);
    }
  }, 150);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => console.log('[GodMode] Service Worker registrado:', reg.scope))
      .catch(err => console.warn('[GodMode] Service Worker falhou:', err));
  });
}

// ============================================================================
// 23. ENTRY POINT
// ============================================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* =============================================================================
   FORMULÁRIO INTELIGENTE — Novo Cliente
   Validação inline, máscaras, upload de logo, submit funcional
   ============================================================================= */

(function initFormNovoCliente() {
  const form = document.getElementById('formNovoCliente');
  if (!form) {
    console.warn('[novoCliente] form não encontrado');
    return;
  }

  // ---------- helpers ----------
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
  const btnLabel   = submitBtn?.querySelector('.btn__label');
  const btnSpinner = submitBtn?.querySelector('.btn__spinner');

  function setError(fieldName, msg) {
    const wrap = form.querySelector(`[data-field="${fieldName}"]`);
    if (!wrap) return;
    wrap.classList.add('is-invalid');
    wrap.classList.remove('is-valid');
    const errEl = wrap.querySelector('.form__error');
    if (errEl) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
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
      form.insertBefore(banner, form.firstChild);
    }
    banner.dataset.type = type;
    banner.textContent = msg;
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- máscaras ----------
  function maskCnpj(v) {
    const d = String(v).replace(/\D/g, '').slice(0, 14);
    let out = d;
    if (d.length > 2)  out = d.slice(0, 2) + '.' + d.slice(2);
    if (d.length > 5)  out = d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5);
    if (d.length > 8)  out = d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8);
    if (d.length > 12) out = d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
    return out;
  }
  function maskTelefone(v) {
    const d = String(v).replace(/\D/g, '').slice(0, 11);
    if (d.length <= 10) {
      // (11) 9999-9999
      return d
        .replace(/^(\d{0,2})/,           '($1')
        .replace(/^\((\d{2})(\d)/,       '($1) $2')
        .replace(/(\d{4})(\d)/,          '$1-$2');
    }
    // (11) 99999-9999
    return d
      .replace(/^(\d{2})(\d)/,           '($1) $2')
      .replace(/(\d{5})(\d)/,            '$1-$2');
  }
  function validarCnpj(cnpj) {
    const d = String(cnpj).replace(/\D/g, '');
    if (d.length !== 14) return false;
    if (/^(\d)\1{13}$/.test(d)) return false; // todos iguais
    let t = d.length - 2;
    let n = d.substring(0, t);
    const v = d.substring(t);
    let s = 0, p = t - 7;
    for (let i = t; i >= 1; i--) {
      s += +n.charAt(t - i) * p--;
      if (p < 2) p = 9;
    }
    let r = s % 11 < 2 ? 0 : 11 - s % 11;
    if (r != +v.charAt(0)) return false;
    t = t + 1; n = d.substring(0, t); s = 0; p = t - 7;
    for (let i = t; i >= 1; i--) {
      s += +n.charAt(t - i) * p--;
      if (p < 2) p = 9;
    }
    r = s % 11 < 2 ? 0 : 11 - s % 11;
    return r == +v.charAt(1);
  }
  function validarEmail(e) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim());
  }

  // ---------- aplicar máscaras em tempo real ----------
  fields.cnpj?.addEventListener('input', (e) => {
    const cur = e.target.selectionStart;
    e.target.value = maskCnpj(e.target.value);
    // mantém cursor no fim quando digitando
    e.target.setSelectionRange(e.target.value.length, e.target.value.length);
  });
  fields.telefone?.addEventListener('input', (e) => {
    e.target.value = maskTelefone(e.target.value);
    e.target.setSelectionRange(e.target.value.length, e.target.value.length);
  });
  fields.idCliente?.addEventListener('input', (e) => {
    // só lowercase + a-z, 0-9, _, -
    e.target.value = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
  });

  // ---------- color picker sincronizado ----------
  fields.corPicker?.addEventListener('input', (e) => {
    fields.corPrim.value = e.target.value;
    clearState('corPrimaria');
  });
  fields.corPrim?.addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      fields.corPicker.value = v.toLowerCase();
    }
  });

  // ---------- validação por campo (blur / input) ----------
  function validateField(name) {
  const v = (fields[name === 'corPrim' ? 'corPrim' : (name === 'quota' ? 'quota' : name)]?.value || '').trim();
  switch (name) {
    case 'idCliente': {
      if (!v) return setError('idCliente', 'Obrigatório.');
      if (!/^[a-z0-9_-]{2,32}$/.test(v))
        return setError('idCliente', 'Use 2-32 caracteres: a-z, 0-9, _ ou -.');
      return setValid('idCliente');
    }
    case 'razaoSocial': {
      if (!v) return setError('razaoSocial', 'Obrigatório.');
      if (v.length < 3) return setError('razaoSocial', 'Mínimo 3 caracteres.');
      return setValid('razaoSocial');
    }
    case 'cnpj': {
      if (!v) return setError('cnpj', 'Obrigatório.');
      const d = v.replace(/\D/g, '');
      if (d.length !== 14) return setError('cnpj', 'CNPJ deve ter 14 dígitos.');
      if (!validarCnpj(v)) return setError('cnpj', 'CNPJ inválido (dígito verificador).');
      return setValid('cnpj');
    }
    case 'email': {
      if (!v) { clearState('email'); return; }
      if (!validarEmail(v)) return setError('email', 'Email inválido.');
      return setValid('email');
    }
    case 'quota': {
      const n = Number(v);
      if (!v) return setError('quotaFuncionarios', 'Obrigatório.');
      if (!Number.isFinite(n) || n < 1 || n > 500)
        return setError('quotaFuncionarios', 'Entre 1 e 500.');
      return setValid('quotaFuncionarios');
    }
    case 'corPrim': {
      if (!v) { clearState('corPrimaria'); return; }
      if (!/^#[0-9a-fA-F]{6}$/.test(v))
        return setError('corPrimaria', 'Use formato #RRGGBB.');
      return setValid('corPrimaria');
    }
  }
}


  fields.idCliente?.addEventListener('blur',  () => validateField('idCliente'));
  fields.razaoSocial?.addEventListener('blur', () => validateField('razaoSocial'));
  fields.cnpj?.addEventListener('blur',       () => validateField('cnpj'));
  fields.email?.addEventListener('blur',      () => validateField('email'));
  fields.quota?.addEventListener('input',     () => validateField('quota'));
  fields.corPrim?.addEventListener('blur',    () => validateField('corPrim'));
  // limpa estado ao começar a digitar de novo
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

  // ---------- upload de logo ----------
  const logoFile      = $('#ncLogoFile');
  const logoUploadBtn = $('#ncLogoUploadBtn');
  const logoRemoveBtn = $('#ncLogoRemoveBtn');
  const logoPreview   = $('#ncLogoPreview');
  const MAX_LOGO_KB   = 500;

  logoUploadBtn?.addEventListener('click', () => logoFile.click());

  logoFile?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_KB * 1024) {
      setError('logo', `Arquivo muito grande (${Math.round(file.size/1024)} KB). Máximo ${MAX_LOGO_KB} KB.`);
      logoFile.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      // preview
      logoPreview.innerHTML = `<img src="${dataUrl}" alt="logo" />`;
      logoRemoveBtn.hidden = false;
      // grava no campo URL como data URI
      fields.logoUrl.value = dataUrl;
      setValid('logo');
    };
    reader.onerror = () => setError('logo', 'Falha ao ler o arquivo.');
    reader.readAsDataURL(file);
  });

  logoRemoveBtn?.addEventListener('click', () => {
    fields.logoUrl.value = '';
    logoFile.value = '';
    logoPreview.innerHTML = '<span class="logo-uploader__placeholder">Sem logo</span>';
    logoRemoveBtn.hidden = true;
    clearState('logo');
  });

  // se digitar URL manual, mostra preview
  fields.logoUrl?.addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (!v) {
      logoPreview.innerHTML = '<span class="logo-uploader__placeholder">Sem logo</span>';
      logoRemoveBtn.hidden = true;
      return;
    }
    if (/^https:\/\//.test(v) || /^data:image\//.test(v)) {
      logoPreview.innerHTML = `<img src="${v}" alt="logo" onerror="this.parentNode.innerHTML='<span class=\\'logo-uploader__placeholder\\'>URL inválida</span>'" />`;
      logoRemoveBtn.hidden = false;
    }
  });

  // ---------- submit ----------
 form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  console.log('[novoCliente] submit disparado');
  clearAllErrors();

  ['idCliente', 'razaoSocial', 'cnpj', 'email', 'quota', 'corPrim'].forEach(validateField);

  const invalidFields = form.querySelectorAll('.form__field.is-invalid');
  console.log('[novoCliente] campos inválidos:', invalidFields.length);

  if (invalidFields.length > 0) {
    showBanner('Corrija os campos destacados antes de continuar.', 'error');
    const first = form.querySelector('.form__field.is-invalid input, .form__field.is-invalid select');
    first?.focus();
    return;
  }

  const payload = {
    idCliente:         fields.idCliente.value.trim(),
    nome:              fields.razaoSocial.value.trim(),
    nomeFantasia:      fields.nomeFantasia.value.trim() || fields.razaoSocial.value.trim(),
    cnpj:              fields.cnpj.value.replace(/\D/g, ''),
    email:             fields.email.value.trim(),
    telefone:          fields.telefone.value.trim(),
    plano:             fields.plano.value,
    quotaFuncionarios: Number(fields.quota.value),
    logoUrl:           fields.logoUrl.value.trim(),
    corPrimaria:       fields.corPrim.value.trim() || '#2563eb',
  };
  console.log('[novoCliente] payload:', payload);

  submitBtn.disabled = true;
  if (btnLabel)   btnLabel.textContent = 'Cadastrando…';
  if (btnSpinner) btnSpinner.hidden = false;

  try {
    // Resolve URL e API key de várias fontes possíveis
    const SCRIPT_URL =
      window.CONFIG?.SCRIPT_URL ||
      window.SCRIPT_URL ||
      (typeof CONFIG !== 'undefined' ? CONFIG.SCRIPT_URL : null);

    const API_KEY =
      window.CONFIG?.API_KEY ||
      window.API_KEY ||
      (typeof CONFIG !== 'undefined' ? CONFIG.API_KEY : null);

    if (!SCRIPT_URL) throw new Error('SCRIPT_URL não configurada');
    if (!API_KEY)    throw new Error('API_KEY não configurada');

    const token = localStorage.getItem('gm_token');
    if (!token) throw new Error('Sessão expirada — faça login novamente');

    console.log('[novoCliente] POST', SCRIPT_URL);
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        apiKey: API_KEY,
        token:  token,
        action: 'createClient',
        ...payload,
      }),
    });

    const txt = await res.text();
    console.log('[novoCliente] resposta:', txt);

    let json;
    try { json = JSON.parse(txt); }
    catch { throw new Error('Resposta inválida do servidor: ' + txt.slice(0, 100)); }

    if (!json.ok) throw new Error(json.error || 'Falha desconhecida');

    showBanner('✓ Cliente cadastrado com sucesso!', 'success');
    setTimeout(() => {
      if (typeof window.closeNewClientModal === 'function') {
        window.closeNewClientModal();
      } else {
        const modal = form.closest('.modal');
        if (modal) modal.hidden = true;
      }
      form.reset();
      clearAllErrors();
      if (logoPreview)   logoPreview.innerHTML = '<span class="logo-uploader__placeholder">Sem logo</span>';
      if (logoRemoveBtn) logoRemoveBtn.hidden = true;
      if (typeof loadData === 'function') loadData();
    }, 800);

  } catch (err) {
    console.error('[novoCliente] erro:', err);
    const msg = err?.message || String(err);

    if (/já existe|exists/i.test(msg)) {
      setError('idCliente', 'Este idCliente já está em uso.');
      showBanner('idCliente duplicado. Escolha outro.', 'error');
    } else if (/cnpj/i.test(msg)) {
      setError('cnpj', msg);
    } else if (/permissão|permission|admin/i.test(msg)) {
      showBanner('Sem permissão. Apenas administradores podem cadastrar clientes.', 'error');
    } else if (/sessão|session|token/i.test(msg)) {
      showBanner('Sessão expirada — faça login novamente.', 'error');
    } else {
      showBanner('Falha ao cadastrar: ' + msg, 'error');
    }
  } finally {
    submitBtn.disabled = false;
    if (btnLabel)   btnLabel.textContent = 'Cadastrar cliente';
    if (btnSpinner) btnSpinner.hidden = true;
  }
});

  console.log('[novoCliente] formulário inteligente inicializado');
})();

/* =============================================================================
   PATCH — Garante abertura do modal "Novo Cliente" pelo botão da sidebar/FAB
   ============================================================================= */
(function ensureNewClientModalOpens() {
  const MODAL_ID = 'newClientModal';

  function openModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) {
      console.error('[novoCliente] modal #' + MODAL_ID + ' não encontrado no DOM');
      return;
    }
    modal.hidden = false;
    modal.removeAttribute('aria-hidden');
    modal.setAttribute('aria-modal', 'true');
    document.body.style.overflow = 'hidden'; // trava scroll de fundo

    // foco no primeiro input
    setTimeout(() => {
      modal.querySelector('input, select, textarea')?.focus();
    }, 50);
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  // Expõe globais p/ debug e p/ outros módulos
  window.openNewClientModal  = openModal;
  window.closeNewClientModal = closeModal;

  // Listener delegado: pega QUALQUER clique em elemento que pareça "abrir novo cliente"
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest(
      '[data-action="novo-cliente"], #btnNovoCliente, #fabNovoCliente, .btn-novo-cliente'
    );
    if (t) {
      ev.preventDefault();
      openModal();
      return;
    }
    // Fallback por texto (caso o botão da sidebar não tenha id/data conhecidos)
    const byText = ev.target.closest('button, a');
    if (byText && /(\+\s*)?novo\s*cliente/i.test(byText.textContent || '')) {
      // só abre se não for botão dentro do próprio modal (evita loop)
      if (!byText.closest('#' + MODAL_ID)) {
        ev.preventDefault();
        openModal();
      }
    }
  });

  // Listener para fechar (X, backdrop, botão Cancelar)
  document.addEventListener('click', (ev) => {
    const closer = ev.target.closest('[data-close], .modal__close, #newClientCloseBtn');
    if (closer && closer.closest('#' + MODAL_ID)) {
      ev.preventDefault();
      closeModal();
    }
  });

  // ESC fecha
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      const modal = document.getElementById(MODAL_ID);
      if (modal && !modal.hidden) closeModal();
    }
  });

  console.log('[novoCliente] handlers de abertura/fechamento instalados');
})();

/* =============================================================================
   PATCH — FAB "+" auto-injetado (mobile only)
   Não precisa editar HTML. Aparece apenas em telas <= 768px.
   ============================================================================= */
(function injectFAB() {
  if (document.getElementById('fabNovoCliente')) return; // já existe

  const fab = document.createElement('button');
  fab.id = 'fabNovoCliente';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Novo Cliente');
  fab.title = 'Novo Cliente';
  fab.textContent = '+';

  // Estilos inline garantem que aparece mesmo se o CSS não carregar
  Object.assign(fab.style, {
    position:   'fixed',
    right:      '20px',
    bottom:     '20px',
    width:      '56px',
    height:     '56px',
    borderRadius: '50%',
    border:     'none',
    background: '#2563eb',
    color:      '#fff',
    fontSize:   '32px',
    fontWeight: '600',
    lineHeight: '1',
    cursor:     'pointer',
    boxShadow:  '0 6px 16px rgba(37, 99, 235, 0.4)',
    zIndex:     '800',
    display:    'none',          // controlado por media query abaixo
    alignItems: 'center',
    justifyContent: 'center',
  });

  document.body.appendChild(fab);

  // Media query controla visibilidade
  function updateVisibility() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const modalOpen = !!document.querySelector('.modal:not([hidden])');
    fab.style.display = (isMobile && !modalOpen) ? 'flex' : 'none';
  }
  updateVisibility();
  window.addEventListener('resize', updateVisibility);

  // Atualiza visibilidade quando modal abre/fecha
  const observer = new MutationObserver(updateVisibility);
  document.querySelectorAll('.modal').forEach(m => {
    observer.observe(m, { attributes: true, attributeFilter: ['hidden'] });
  });

  console.log('[FAB] injetado e ativo (mobile <= 768px)');
}

/* =========================================================
 * Monitor de Clientes – v3 (URL/API_KEY auto-detectados + #capacityBtn)
 * ========================================================= */
(function initCapacityMonitor(){
  // Lista branca de gatilhos — inclui o botão da topbar (#capacityBtn)
  const SELETOR_ABRIR = [
    '#capacityBtn',
    '#btnMonitorClientes',
    '#menuMonitorClientes',
    '#btnCapacityMonitor',
    '[data-action="abrir-monitor-clientes"]',
    '[data-action="capacity-monitor"]',
    '[title="Capacity Monitor"]',
    '[aria-label="Abrir Capacity Monitor"]'
  ].join(', ');

  // Auto-detecta SCRIPT_URL e API_KEY de várias fontes possíveis
  function getCfg() {
    const cfg = (window.CONFIG || window.AppConfig || window.ADMIN_CONFIG || {});
    const scriptUrl =
      window.SCRIPT_URL ||
      window.GAS_URL ||
      cfg.SCRIPT_URL ||
      cfg.scriptUrl ||
      cfg.GAS_URL ||
      cfg.API_URL ||
      cfg.apiUrl ||
      (typeof SCRIPT_URL !== 'undefined' ? SCRIPT_URL : '') ||
      '';
    const apiKey =
      window.API_KEY ||
      cfg.API_KEY ||
      cfg.apiKey ||
      (typeof API_KEY !== 'undefined' ? API_KEY : '') ||
      '';
    const token =
      localStorage.getItem('gm_token') ||
      localStorage.getItem('godmode_token') ||
      window.GM_TOKEN ||
      cfg.token ||
      '';
    return { scriptUrl, apiKey, token };
  }

  async function fetchCapacity() {
    const { scriptUrl, apiKey, token } = getCfg();
    if (!scriptUrl) {
      throw new Error('SCRIPT_URL não encontrado. Verifique a configuração do admin.js.');
    }
    if (!apiKey) {
      throw new Error('API_KEY não encontrado. Verifique a configuração do admin.js.');
    }

    // POST padrão (mesmo método das outras actions do admin)
    const r = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        apiKey: apiKey,
        token: token,
        action: 'getcapacitymonitor'
      })
    });

    let j;
    try { j = await r.json(); }
    catch(e) {
      const txt = await r.text().catch(()=>''); 
      throw new Error('Resposta inválida do servidor (HTTP ' + r.status + '): ' + txt.slice(0,150));
    }
    if (!j.ok) throw new Error(j.error || 'Falha ao carregar monitor');
    return j.data;
  }

  function statusBadge(s) {
    if (s === 'cheio')   return '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px;">Cheio</span>';
    if (s === 'atencao') return '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;">Atenção</span>';
    return '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:10px;font-size:11px;">OK</span>';
  }

  function renderRow(c) {
    const apps = Object.entries(c.apps||{})
      .map(([k,v])=>`<span style="background:#eef2ff;color:#3730a3;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:4px;">${k}: ${v}</span>`)
      .join('') || '<span style="color:#9ca3af;">—</span>';
    const barColor = c.status==='cheio' ? '#dc2626' : c.status==='atencao' ? '#f59e0b' : '#10b981';
    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px;"><strong>${c.nome}</strong><br><small style="color:#6b7280;">${c.idCliente}</small></td>
        <td style="padding:8px;">${c.plano}</td>
        <td style="padding:8px;">
          <div style="display:flex;align-items:center;gap:8px;min-width:160px;">
            <div style="flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;">
              <div style="width:${Math.min(100,c.percentual)}%;height:100%;background:${barColor};"></div>
            </div>
            <span style="font-size:12px;white-space:nowrap;">${c.usados}/${c.quota} (${c.percentual}%)</span>
          </div>
        </td>
        <td style="padding:8px;">${apps}</td>
        <td style="padding:8px;">${statusBadge(c.status)}</td>
      </tr>`;
  }

  async function openMonitor() {
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
            <h3 style="margin:0;font-size:18px;">📊 Monitor de Clientes</h3>
            <button type="button" data-close style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;" aria-label="Fechar">✕</button>
          </div>
          <div id="capMonBody" style="padding:16px 20px;overflow-y:auto;flex:1;">
            <p style="color:#6b7280;">Carregando…</p>
          </div>
          <div style="padding:12px 20px;border-top:1px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:flex-end;gap:8px;">
            <button type="button" data-close style="padding:6px 14px;background:#fff;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;">Fechar</button>
            <button type="button" id="capMonRefresh" style="padding:6px 14px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;">🔄 Atualizar</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      // Fechar (escopado dentro do modal)
      modal.addEventListener('click', e => {
        if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) {
          modal.hidden = true;
        }
      });
      modal.querySelector('#capMonRefresh').addEventListener('click', loadAndRender);
    }
    modal.hidden = false;
    await loadAndRender();
  }

  async function loadAndRender() {
    const body = document.getElementById('capMonBody');
    if (!body) return;
    body.innerHTML = '<p style="color:#6b7280;">Carregando…</p>';
    try {
      const data = await fetchCapacity();
      if (!data || !data.clientes || !data.clientes.length) {
        body.innerHTML = '<p style="color:#6b7280;">Nenhum cliente cadastrado.</p>';
        return;
      }
      body.innerHTML = `
        <div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap;font-size:13px;">
          <div><strong>${data.totais.clientes}</strong> clientes</div>
          <div><strong>${data.totais.funcionarios}</strong> funcionários ativos</div>
          <div>Capacidade total: <strong>${data.totais.capacidadeTotal}</strong></div>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead>
              <tr style="background:#f3f4f6;">
                <th style="text-align:left;padding:8px;">Cliente</th>
                <th style="text-align:left;padding:8px;">Plano</th>
                <th style="text-align:left;padding:8px;">Uso</th>
                <th style="text-align:left;padding:8px;">Apps</th>
                <th style="text-align:left;padding:8px;">Status</th>
              </tr>
            </thead>
            <tbody>${data.clientes.map(renderRow).join('')}</tbody>
          </table>
        </div>`;
    } catch (e) {
      console.error('[capmon]', e);
      body.innerHTML = `<div style="background:#fee2e2;color:#991b1b;padding:12px;border-radius:6px;">❌ ${e.message}</div>`;
    }
  }

  window.openCapacityMonitor = openMonitor;

  // Delegação ESTRITA + previne o sistema antigo de capacity drawer
  document.addEventListener('click', e => {
    const t = e.target.closest(SELETOR_ABRIR);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();   // bloqueia handler antigo do #capacityBtn
    openMonitor();
  }, true);   // capture=true → roda ANTES do listener antigo

  console.log('[capmon] v3 carregado. Gatilhos:', SELETOR_ABRIR);
})();
