/**
 * ============================================================================
 *  CENTRAL DE DESENVOLVEDOR — MOTOR LÓGICO (God Mode) v2
 *  Vanilla JS ES6+ | Zero dependências
 *  ----------------------------------------------------------------------------
 *  Arquitetura:
 *    [API] → [State] → [Render Dispatcher] ← [Events]
 *
 *  Estado consumido:
 *    - clientes, logs, eventosAuth, sessoesAtivas, saudeApps
 *    - totais (KPIs de logs), operacionais (KPIs comportamentais)
 *    - ui: search, severity{ERRO,ALERTA,INFO}, theme, capacityOpen
 *
 *  Princípios:
 *    - Single source of truth
 *    - Render idempotente por tab
 *    - Auto-refresh visibility-aware
 *    - DOM seguro (textContent / DocumentFragment)
 *    - Filtros compostos in-memory (zero fetch extra)
 * ============================================================================
 */

(() => {
  'use strict';

  // ==========================================================================
  // 1. CONFIGURAÇÃO
  // ==========================================================================
  const CONFIG = {
    URL_DO_APPS_SCRIPT: 'https://script.google.com/macros/s/AKfycbzqjZtyCn7X1lWQBSRYLwW-MijJN53YLPoHJrjjBh5y6P1kTaBATNpAV13KV9OgNYPx/exec',
    API_KEY: 'ee91297b-685b-4ae4-b131-8434841c882e',

    LIMIT: 500,
    AUTO_REFRESH_MS: 30000,        // 30s — só quando aba está visível
    FETCH_TIMEOUT_MS: 20000,
    SEARCH_DEBOUNCE_MS: 180,       // search input debounce
    LS_THEME_KEY: 'godmode.theme'  // chave de persistência do tema
  };

  // ==========================================================================
  // 2. ESTADO
  // ==========================================================================
  const state = {
    clientes: [],
    logs: [],
    eventosAuth: [],
    sessoesAtivas: [],
    saudeApps: [],                 // ← NOVO: array de apps monitorados (Capacity)
    totais: null,
    operacionais: null,
    filtroClienteId: '',
    activeTab: 'logs',             // 'logs' | 'auth' | 'sessions'
    isLoading: false,
    error: null,
    geradoEm: null,

    // ─── UI sub-state (só client-side, não vem do backend) ──────────────────
    ui: {
      search: '',                  // string normalizada (lowercase, trim)
      severity: {                  // toggle de gravidade (tab Logs)
        ERRO:    true,
        ALERTA:  true,
        INFO:    true
      },
      theme: 'light',              // 'light' | 'dark'
      capacityOpen: false,         // drawer Capacity Monitor aberto?
      detailOpen: false,           // drawer Detalhe do evento aberto?
      detailContext: null          // { kind:'log'|'auth'|'session', data:{}, kbMatch:{} }
    }
  };

  // ==========================================================================
  // 2.b KNOWLEDGE BASE — 40 padrões (espelhada do backend para matching local)
  //     Mantida embutida para diagnóstico INSTANTÂNEO (zero round-trip).
  // ==========================================================================
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

  // Encontra o PRIMEIRO padrão que casa com o texto. Retorna null se nenhum.
  function findPatternMatch(text) {
    if (!text) return null;
    const s = String(text);
    for (let i = 0; i < KB_PATTERNS.length; i++) {
      if (KB_PATTERNS[i].regex.test(s)) return KB_PATTERNS[i];
    }
    return null;
  }

  // ==========================================================================
  // 3. SELETORES DOM
  // ==========================================================================
  const dom = {
    clientList:       document.getElementById('clientList'),
    logsList:         document.getElementById('logsList'),
    logsMeta:         document.getElementById('logsMeta'),
    mainTitle:        document.getElementById('mainTitle'),
    mainSubtitle:     document.getElementById('mainSubtitle'),
    refreshBtn:       document.getElementById('refreshBtn'),
    connectionStatus: document.getElementById('connectionStatus'),

    // Live Strip
    liveStripList:    document.getElementById('liveStripList'),
    liveStripMeta:    document.getElementById('liveStripMeta'),

    // Tabs
    eventTabs:        document.getElementById('eventTabs'),
    tabCounts: {
      logs:     document.getElementById('tabCountLogs'),
      auth:     document.getElementById('tabCountAuth'),
      sessions: document.getElementById('tabCountSessions')
    },

    // KPIs operacionais
    kpiOps: {
      online:     document.getElementById('kpiOnline'),
      logins:     document.getElementById('kpiLogins'),
      falhas:     document.getElementById('kpiFalhas'),
      expiradas:  document.getElementById('kpiExpiradas')
    },

    // KPIs de logs
    kpi: {
      total:    document.getElementById('kpiTotal'),
      erros:    document.getElementById('kpiErros'),
      alertas:  document.getElementById('kpiAlertas'),
      infos:    document.getElementById('kpiInfos')
    },

    // ─── NOVO: Toolbar de eventos (search + pills + export) ────────────────
    searchInput:      document.getElementById('searchInput'),
    searchClearBtn:   document.getElementById('searchClearBtn'),
    severityPills:    document.getElementById('severityPills'),
    pillCountErro:    document.getElementById('pillCountErro'),
    pillCountAlerta:  document.getElementById('pillCountAlerta'),
    pillCountInfo:    document.getElementById('pillCountInfo'),
    exportCsvBtn:     document.getElementById('exportCsvBtn'),

    // ─── NOVO: Theme toggle ────────────────────────────────────────────────
    themeToggleBtn:   document.getElementById('themeToggleBtn'),

    // ─── NOVO: Capacity Drawer ─────────────────────────────────────────────
    capacityBtn:      document.getElementById('capacityBtn'),
    capacityBadge:    document.getElementById('capacityBadge'),
    capacityDrawer:   document.getElementById('capacityDrawer'),
    capacityDrawerSubtitle: document.getElementById('capacityDrawerSubtitle'),
    capacitySummary:  document.getElementById('capacitySummary'),
    capacityList:     document.getElementById('capacityList'),
    capacityMeta:     document.getElementById('capacityMeta'),

    // ─── NOVO Wave 1: Detail Drawer (log/auth/session) ─────────────────────
    detailDrawer:        document.getElementById('detailDrawer'),
    detailDrawerTitle:   document.getElementById('detailDrawerTitle'),
    detailDrawerSubtitle:document.getElementById('detailDrawerSubtitle'),
    detailMeta:          document.getElementById('detailMeta'),
    detailMessage:       document.getElementById('detailMessage'),
    detailKbWrap:        document.getElementById('detailKbWrap'),
    detailKbId:          document.getElementById('detailKbId'),
    detailKbCat:         document.getElementById('detailKbCat'),
    detailKbSev:         document.getElementById('detailKbSev'),
    detailKbTitle:       document.getElementById('detailKbTitle'),
    detailKbSolucao:     document.getElementById('detailKbSolucao'),
    detailCopyBtn:       document.getElementById('detailCopyBtn'),
    detailMetaFoot:      document.getElementById('detailMetaFoot')
  };

  // Modal de novo cliente
  const modal = {
    root:      document.getElementById('clientModal'),
    form:      document.getElementById('clientForm'),
    fldId:     document.getElementById('fldClientId'),
    fldName:   document.getElementById('fldClientName'),
    fldActive: document.getElementById('fldClientActive'),
    saveBtn:   document.getElementById('clientSaveBtn'),
    formError: document.getElementById('clientFormError'),
    openBtn:   document.getElementById('newClientBtn')
  };

  // ==========================================================================
  // 4. API LAYER
  // ==========================================================================
  async function fetchDashboardData() {
    const url = `${CONFIG.URL_DO_APPS_SCRIPT}?apiKey=${encodeURIComponent(CONFIG.API_KEY)}&limit=${CONFIG.LIMIT}`;

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), CONFIG.FETCH_TIMEOUT_MS);

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
        throw new Error(`Tempo de resposta excedido (${CONFIG.FETCH_TIMEOUT_MS / 1000}s).`);
      }
      throw new Error('Falha de rede ou CORS. Verifique a implantação.');
    }
    clearTimeout(timeoutId);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const raw = await resp.text();
    let json;
    try { json = JSON.parse(raw); }
    catch {
      console.error('[GodMode] Resposta não-JSON:', raw.slice(0, 300));
      if (raw.includes('<!DOCTYPE') || raw.includes('accounts.google.com')) {
        throw new Error('Apps Script exigiu login. Reimplante como "Qualquer pessoa".');
      }
      throw new Error('Resposta inválida do servidor.');
    }
    if (!json.ok) throw new Error(json.error || 'Resposta inválida do servidor');
    return json.data;
  }

  async function apiPost(action, payload) {
    const resp = await fetch(CONFIG.URL_DO_APPS_SCRIPT, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ apiKey: CONFIG.API_KEY, action, ...payload })
    });
    const raw = await resp.text();
    let json;
    try { json = JSON.parse(raw); }
    catch { throw new Error('Resposta inválida do servidor'); }
    if (!json.ok) throw new Error(json.error || 'Falha na operação');
    return json.data;
  }

  // ==========================================================================
  // 5. STATE MUTATIONS
  // ==========================================================================
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
    state.saudeApps     = Array.isArray(data.saudeApps)     ? data.saudeApps     : []; // ← NOVO
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
    renderHeader();              // atualiza meta de contagem
  }

  // Mutações de UI ────────────────────────────────────────────────────────
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
    applyTheme(next, /* withTransition */ true);
    try { localStorage.setItem(CONFIG.LS_THEME_KEY, next); } catch (_) {}
  }

  function setCapacityOpen(open) {
    state.ui.capacityOpen = !!open;
    renderCapacityDrawer();
  }

  // ==========================================================================
  // 6. SELETORES DERIVADOS
  // ==========================================================================
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

  // KPIs SEMPRE consideram apenas o filtro de cliente (não search/severity)
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

  function contarLogsPorCliente() {
    const map = new Map();
    for (const l of state.logs) {
      const id = String(l.idCliente);
      map.set(id, (map.get(id) || 0) + 1);
    }
    return map;
  }

  function getNomeCliente(id) {
    if (!id) return 'Todos os Clientes';
    const c = state.clientes.find(c => String(c.idCliente) === String(id));
    return c ? c.nomeCliente : id;
  }

  // ─── Pipeline de filtro composto ────────────────────────────────────────
  // Ordem: cliente → severidade (só logs) → search (todos)
  function applySeverityFilter(logs) {
    const sev = state.ui.severity;
    if (sev.ERRO && sev.ALERTA && sev.INFO) return logs; // tudo ligado: passthrough
    return logs.filter(l => {
      const t = String(l.tipoLog || '').toUpperCase();
      if (t === 'ERRO')   return sev.ERRO;
      if (t === 'ALERTA') return sev.ALERTA;
      if (t === 'INFO')   return sev.INFO;
      return true; // tipo desconhecido sempre passa
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
    // sessions
    return items.filter(s =>
      contains(s.aplicativo, q) ||
      contains(s.usuario, q) ||
      contains(s.dispositivo, q) ||
      contains(getNomeCliente(s.idCliente), q)
    );
  }

  function contains(field, q) {
    if (field === null || field === undefined) return false;
    return String(field).toLowerCase().includes(q);
  }

  // Resultado final que vai pra UI (lista renderizada)
  function getEventsForActiveTab() {
    if (state.activeTab === 'auth') {
      return applySearchFilter(getAuthFiltradosCliente(), 'auth');
    }
    if (state.activeTab === 'sessions') {
      return applySearchFilter(getSessoesFiltradasCliente(), 'sessions');
    }
    // logs: pipeline completo
    const c = getLogsFiltradosCliente();
    const s = applySeverityFilter(c);
    return applySearchFilter(s, 'logs');
  }

  // Capacity helpers
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
    // o que "merece" o badge no botão da topbar
    let n = 0;
    for (const a of state.saudeApps) {
      const st = String(a.status || '').toUpperCase();
      if (st === 'CRITICO' || st === 'ALERTA' || st === 'OFFLINE') n++;
    }
    return n;
  }

  // ==========================================================================
  // 7. RENDER LAYER — Sidebar
  // ==========================================================================
  function renderSidebar() {
    const ul = dom.clientList;
    ul.textContent = '';
    const contagens = contarLogsPorCliente();
    const ativoId = state.filtroClienteId;

    ul.appendChild(buildClientItem({
      id: '', nome: 'Todos os Clientes',
      count: state.logs.length, ativo: ativoId === '',
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
        count: contagens.get(id) || 0,
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
    countEl.textContent = formatNumber(count);

    btn.appendChild(nameEl);
    btn.appendChild(countEl);
    li.appendChild(btn);
    return li;
  }

  // ==========================================================================
  // 8. RENDER LAYER — Main
  // ==========================================================================
  function renderMain() {
    renderHeader();
    renderKPIsOps();
    renderLiveStrip();
    renderKPIsLogs();
    renderTabs();
    renderToolbarVisibility();
    renderSeverityPills();
    renderSearchClearVisibility();
    renderEventsList();
    renderCapacityBadge();
    if (state.ui.capacityOpen) renderCapacityDrawer(); // re-render quando dados mudam
  }

  function renderHeader() {
    const filtrando = !!state.filtroClienteId;
    const nome = getNomeCliente(state.filtroClienteId);

    dom.mainTitle.textContent = filtrando ? nome : 'Visão Geral';
    dom.mainSubtitle.textContent = filtrando
      ? `Telemetria isolada do cliente ${nome}`
      : 'Telemetria consolidada de todos os ecossistemas';

    const ts = state.geradoEm ? `· atualizado ${formatRelativeTime(state.geradoEm)}` : '';
    const total = getEventsForActiveTab().length;
    const filtroAtivo = isAnyExtraFilterActive() ? ' (filtrados)' : '';
    dom.logsMeta.textContent = `${formatNumber(total)} evento(s)${filtroAtivo} ${ts}`;
  }

  function isAnyExtraFilterActive() {
    if (state.ui.search) return true;
    if (state.activeTab === 'logs') {
      const s = state.ui.severity;
      if (!(s.ERRO && s.ALERTA && s.INFO)) return true;
    }
    return false;
  }

  // KPIs operacionais (sempre globais — não respeitam filtro de cliente)
  function renderKPIsOps() {
    const ops = state.operacionais || {};
    dom.kpiOps.online.textContent    = formatNumber(ops.onlineAgora);
    dom.kpiOps.logins.textContent    = formatNumber(ops.loginsHoje);
    dom.kpiOps.falhas.textContent    = formatNumber(ops.falhasLoginHoje);
    dom.kpiOps.expiradas.textContent = formatNumber(ops.sessoesExpiradasHoje);
  }

  // KPIs de logs (respeitam apenas filtro de cliente, NÃO search/severity)
  function renderKPIsLogs() {
    const kpis = calcularKPIsLogs(getLogsFiltradosCliente());
    dom.kpi.total.textContent   = formatNumber(kpis.total);
    dom.kpi.erros.textContent   = formatNumber(kpis.erros);
    dom.kpi.alertas.textContent = formatNumber(kpis.alertas);
    dom.kpi.infos.textContent   = formatNumber(kpis.infos);
  }

  // ==========================================================================
  // 9. RENDER LAYER — Live Activity Strip
  // ==========================================================================
  function renderLiveStrip() {
    const list = dom.liveStripList;
    list.textContent = '';

    const sessoes = state.sessoesAtivas;

    if (!sessoes.length) {
      list.dataset.empty = 'true';
      dom.liveStripMeta.textContent = '0 ativos';
      return;
    }
    delete list.dataset.empty;
    dom.liveStripMeta.textContent = `${sessoes.length} ${sessoes.length === 1 ? 'ativo' : 'ativos'}`;

    const frag = document.createDocumentFragment();
    for (const s of sessoes) {
      frag.appendChild(buildLiveChip(s));
    }
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
    avatar.textContent = getInitials(sessao.usuario);
    avatar.style.background = avatarGradient(sessao.usuario);

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

  // ==========================================================================
  // 10. RENDER LAYER — Tabs + Toolbar
  // ==========================================================================
  function renderTabs() {
    // Counts da tab refletem APENAS o filtro de cliente (consistência visual)
    const counts = {
      logs:     getLogsFiltradosCliente().length,
      auth:     getAuthFiltradosCliente().length,
      sessions: getSessoesFiltradasCliente().length
    };
    dom.tabCounts.logs.textContent     = formatNumber(counts.logs);
    dom.tabCounts.auth.textContent     = formatNumber(counts.auth);
    dom.tabCounts.sessions.textContent = formatNumber(counts.sessions);

    const buttons = dom.eventTabs.querySelectorAll('.tab');
    buttons.forEach(btn => {
      const isActive = btn.dataset.tab === state.activeTab;
      btn.classList.toggle('tab--active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  // Mostra/esconde os pills de severidade (só fazem sentido na tab Logs)
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
    // counts respeitam o filtro de cliente atual
    const logs = getLogsFiltradosCliente();
    const counts = { ERRO: 0, ALERTA: 0, INFO: 0 };
    for (const l of logs) {
      const t = String(l.tipoLog || '').toUpperCase();
      if (t in counts) counts[t]++;
    }
    if (dom.pillCountErro)    dom.pillCountErro.textContent    = formatNumber(counts.ERRO);
    if (dom.pillCountAlerta)  dom.pillCountAlerta.textContent  = formatNumber(counts.ALERTA);
    if (dom.pillCountInfo)    dom.pillCountInfo.textContent    = formatNumber(counts.INFO);

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

  // ==========================================================================
  // 11. RENDER LAYER — Events List (Dispatcher)
  // ==========================================================================
  function renderEventsList() {
    const list = dom.logsList;
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
    time.textContent = formatRelativeTime(log.timestamp);
    time.title = formatAbsoluteTime(log.timestamp);

    card.appendChild(icon);
    card.appendChild(body);
    card.appendChild(time);

    // ► Wave 1: clique no card abre drawer de detalhes
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
    time.textContent = formatRelativeTime(ev.timestamp);
    time.title = formatAbsoluteTime(ev.timestamp);

    card.appendChild(icon);
    card.appendChild(body);
    card.appendChild(time);

    // ► Wave 1: clique no card abre drawer de detalhes
    makeCardInteractive(card, () => openDetailDrawer('auth', ev));

    return card;
  }

  function buildSessionCard(s) {
    const card = document.createElement('article');
    card.className = 'session-card';
    card.setAttribute('role', 'listitem');

    const avatar = document.createElement('div');
    avatar.className = 'session-card__avatar';
    avatar.textContent = getInitials(s.usuario);
    avatar.style.background = avatarGradient(s.usuario);

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
    meta.appendChild(buildMetaItem('Último ping', formatRelativeTime(s.ultimoPing)));

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

    // ► Wave 1: clique no card abre drawer de detalhes
    makeCardInteractive(card, () => openDetailDrawer('session', s));

    return card;
  }

  // ─── Wave 1: Helper para tornar um card clicável + acessível ───
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

  // ==========================================================================
  // 11.b DETAIL DRAWER (Wave 1) — abrir/fechar/popular
  // ==========================================================================
  function openDetailDrawer(kind, data) {
    if (!dom.detailDrawer || !data) return;

    const kbMatch = (kind === 'log') ? findPatternMatch(data.mensagemErro)
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

  function populateDetailDrawer(kind, data, kbMatch) {
    // Título + subtítulo
    const titleMap = { log: 'Detalhe do log', auth: 'Detalhe de autenticação', session: 'Detalhe da sessão' };
    if (dom.detailDrawerTitle) dom.detailDrawerTitle.textContent = titleMap[kind] || 'Detalhe do evento';
    if (dom.detailDrawerSubtitle) {
      dom.detailDrawerSubtitle.textContent = formatAbsoluteTime(data.timestamp || data.inicioSessao || '');
    }

    // Bloco meta (key/value)
    if (dom.detailMeta) {
      dom.detailMeta.innerHTML = '';
      const rows = [];

      if (kind === 'log') {
        const sev = String(data.tipoLog || '').toUpperCase();
        rows.push(['Severidade', buildSevPill(sev)]);
        rows.push(['Cliente',    getNomeCliente(data.idCliente)]);
        rows.push(['Aplicativo', data.aplicativo || '—']);
        rows.push(['Usuário',    data.usuario || '—']);
        rows.push(['Dispositivo',data.dispositivo || '—']);
        rows.push(['Timestamp',  formatAbsoluteTime(data.timestamp)]);
      } else if (kind === 'auth') {
        const tipo = String(data.tipoEvento || '').toUpperCase();
        const sevClass = tipo === 'LOGIN_SUCESSO' ? 'success'
                       : tipo === 'LOGIN_FALHA'   ? 'fail'
                       : tipo === 'SESSAO_EXPIRADA' ? 'alerta' : 'info';
        rows.push(['Evento',     buildSevPillRaw(tipo.toLowerCase(), sevClass)]);
        rows.push(['Cliente',    getNomeCliente(data.idCliente)]);
        rows.push(['Aplicativo', data.aplicativo || '—']);
        rows.push(['Usuário',    data.usuario || '—']);
        rows.push(['Dispositivo',data.dispositivo || '—']);
        rows.push(['Timestamp',  formatAbsoluteTime(data.timestamp)]);
      } else {
        rows.push(['Status',     buildSevPillRaw('online', 'success')]);
        rows.push(['Cliente',    getNomeCliente(data.idCliente)]);
        rows.push(['Aplicativo', data.aplicativo || '—']);
        rows.push(['Usuário',    data.usuario || '—']);
        rows.push(['Dispositivo',data.dispositivo || '—']);
        rows.push(['Início',     formatAbsoluteTime(data.inicioSessao)]);
        rows.push(['Último ping',formatRelativeTime(data.ultimoPing)]);
        rows.push(['Duração',    formatDuration(data.inicioSessao)]);
      }

      const frag = document.createDocumentFragment();
      rows.forEach(([key, val]) => {
        const k = document.createElement('span');
        k.className = 'detail-meta__key';
        k.textContent = key;
        const v = document.createElement('span');
        v.className = 'detail-meta__val';
        if (val instanceof HTMLElement) v.appendChild(val);
        else v.textContent = val;
        frag.appendChild(k);
        frag.appendChild(v);
      });
      dom.detailMeta.appendChild(frag);
    }

    // Mensagem completa
    if (dom.detailMessage) {
      const msg = (kind === 'log')    ? (data.mensagemErro || '(sem mensagem)')
                : (kind === 'auth')   ? (data.detalhes     || '(sem detalhes)')
                : `Sessão ativa há ${formatDuration(data.inicioSessao)}. Último ping: ${formatRelativeTime(data.ultimoPing)}.`;
      dom.detailMessage.textContent = msg;
    }

    // Sugestão da Knowledge Base
    if (dom.detailKbWrap) {
      if (kbMatch) {
        dom.detailKbWrap.hidden = false;
        if (dom.detailKbId)      dom.detailKbId.textContent = kbMatch.id;
        if (dom.detailKbCat)     dom.detailKbCat.textContent = kbMatch.categoria;
        if (dom.detailKbSev) {
          dom.detailKbSev.textContent = kbMatch.severidade;
          dom.detailKbSev.className = 'kb-suggestion__sev kb-suggestion__sev--' +
            kbMatch.severidade.toLowerCase();
        }
        if (dom.detailKbTitle)   dom.detailKbTitle.textContent = kbMatch.titulo;
        if (dom.detailKbSolucao) dom.detailKbSolucao.textContent = kbMatch.solucao;
      } else {
        dom.detailKbWrap.hidden = true;
      }
    }

    // Rodapé
    if (dom.detailMetaFoot) {
      dom.detailMetaFoot.textContent = kbMatch
        ? `Padrão reconhecido: ${kbMatch.id}`
        : 'Nenhum padrão da Knowledge Base reconhecido para este evento.';
    }
  }

  // Helpers de pílula de severidade dentro do drawer
  function buildSevPill(sev) {
    const cls = sev === 'ERRO' ? 'erro' : sev === 'ALERTA' ? 'alerta' : 'info';
    return buildSevPillRaw(sev.toLowerCase(), cls);
  }
  function buildSevPillRaw(label, cls) {
    const el = document.createElement('span');
    el.className = 'detail-meta__sev detail-meta__sev--' + cls;
    el.textContent = label;
    return el;
  }

  // ==========================================================================
  // 12. EMPTY / ERROR STATES
  // ==========================================================================
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

  // ==========================================================================
  // 13. STATUS PILL + REFRESH BUTTON
  // ==========================================================================
  function updateConnectionStatus() {
    const pill = dom.connectionStatus;
    if (!pill) return;
    const textEl = pill.querySelector('.status-pill__text');
    if (state.isLoading) {
      pill.dataset.state = 'loading';
      textEl.textContent = 'Sincronizando…';
    } else if (state.error) {
      pill.dataset.state = 'error';
      textEl.textContent = 'Erro de conexão';
    } else {
      pill.dataset.state = 'ok';
      textEl.textContent = 'Online';
    }
  }

  function updateRefreshButton() {
    if (!dom.refreshBtn) return;
    dom.refreshBtn.disabled = state.isLoading;
    const span = dom.refreshBtn.querySelector('span');
    if (span) span.textContent = state.isLoading ? 'Atualizando' : 'Atualizar';
  }

  // ==========================================================================
  // 14. THEME TOGGLE — Light/Dark via [data-theme] + localStorage
  // ==========================================================================
  function detectInitialTheme() {
    // Prioridade: localStorage → atributo HTML atual → preferência do SO → light
    try {
      const stored = localStorage.getItem(CONFIG.LS_THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (_) {}
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
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

  // ==========================================================================
  // 15. EXPORT CSV — Dados filtrados → Blob download (RFC 4180)
  // ==========================================================================
  const CSV_HEADERS = {
    logs:     ['timestamp', 'tipoLog', 'idCliente', 'cliente', 'aplicativo', 'usuario', 'dispositivo', 'mensagemErro'],
    auth:     ['timestamp', 'tipoEvento', 'idCliente', 'cliente', 'aplicativo', 'usuario', 'dispositivo', 'detalhes'],
    sessions: ['inicioSessao', 'ultimoPing', 'idCliente', 'cliente', 'aplicativo', 'usuario', 'dispositivo']
  };

  function exportCurrentTabAsCSV() {
    const tab = state.activeTab;
    const items = getEventsForActiveTab();
    if (!items.length) {
      flashExportButton('Nada para exportar');
      return;
    }
    const headers = CSV_HEADERS[tab];
    const lines = [headers.join(',')];

    for (const item of items) {
      const enriched = { ...item, cliente: getNomeCliente(item.idCliente) };
      const row = headers.map(h => csvEscape(enriched[h]));
      lines.push(row.join(','));
    }

    // BOM UTF-8 para Excel reconhecer acentos
    const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);

    const filename = buildCsvFilename(tab);
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

    flashExportButton(`✓ ${items.length} linha(s)`);
  }

  function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    // RFC 4180: campos com vírgula, aspas ou quebra de linha precisam de aspas duplas
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function buildCsvFilename(tab) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
    const cli = state.filtroClienteId ? `_${slugify(getNomeCliente(state.filtroClienteId))}` : '_todos';
    return `godmode_${tab}${cli}_${stamp}.csv`;
  }

  function slugify(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function flashExportButton(msg) {
    if (!dom.exportCsvBtn) return;
    const span = dom.exportCsvBtn.querySelector('span');
    if (!span) return;
    const original = span.textContent;
    span.textContent = msg;
    dom.exportCsvBtn.disabled = true;
    setTimeout(() => {
      span.textContent = original;
      dom.exportCsvBtn.disabled = false;
    }, 1400);
  }

  // ==========================================================================
  // 16. CAPACITY DRAWER — Visualização de saudeApps[]
  // ==========================================================================
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

    // Subtitle
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

    // Ordena: piores status primeiro, depois maior % de uso
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
    const ts = state.geradoEm ? formatRelativeTime(state.geradoEm) : '—';
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

    // Head
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

    // Smart progress bar (só faz sentido se há capacidade reportada)
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

    // Métricas
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

    // Nota explicativa quando não há capacity reportada
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

  // ==========================================================================
  // 17. EVENTS
  // ==========================================================================
  function bindEvents() {
    // ─── Filtro de cliente (sidebar) ──────────────────────────────────────
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

    // ─── Tabs ─────────────────────────────────────────────────────────────
    dom.eventTabs.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab');
      if (!btn) return;
      setActiveTab(btn.dataset.tab);
    });

    // ─── Refresh ──────────────────────────────────────────────────────────
    dom.refreshBtn.addEventListener('click', loadData);

    // ─── Search (debounced) ───────────────────────────────────────────────
    if (dom.searchInput) {
      const debounced = debounce((val) => setSearch(val), CONFIG.SEARCH_DEBOUNCE_MS);
      dom.searchInput.addEventListener('input', (ev) => debounced(ev.target.value));
      dom.searchInput.addEventListener('search', (ev) => setSearch(ev.target.value)); // X nativo do input[type=search]
    }
    if (dom.searchClearBtn) {
      dom.searchClearBtn.addEventListener('click', () => {
        if (dom.searchInput) dom.searchInput.value = '';
        setSearch('');
        if (dom.searchInput) dom.searchInput.focus();
      });
    }

    // ─── Severity Pills ───────────────────────────────────────────────────
    if (dom.severityPills) {
      dom.severityPills.addEventListener('click', (ev) => {
        const pill = ev.target.closest('.pill[data-severity]');
        if (!pill) return;
        toggleSeverity(pill.dataset.severity);
      });
    }

    // ─── Export CSV ───────────────────────────────────────────────────────
    if (dom.exportCsvBtn) {
      dom.exportCsvBtn.addEventListener('click', exportCurrentTabAsCSV);
    }

    // ─── Theme toggle ─────────────────────────────────────────────────────
    if (dom.themeToggleBtn) {
      dom.themeToggleBtn.addEventListener('click', () => {
        setTheme(state.ui.theme === 'dark' ? 'light' : 'dark');
      });
    }

    // ─── Capacity Drawer ──────────────────────────────────────────────────
    if (dom.capacityBtn) {
      dom.capacityBtn.addEventListener('click', openCapacityDrawer);
    }
    if (dom.capacityDrawer) {
      dom.capacityDrawer.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-close]')) closeCapacityDrawer();
      });
    }

    // ─── Wave 1: Detail Drawer (log/auth/session) ────────────────────────
    if (dom.detailDrawer) {
      dom.detailDrawer.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-close]')) closeDetailDrawer();
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
          const original = dom.detailCopyBtn.querySelector('span');
          if (!original) return;
          const prev = original.textContent;
          original.textContent = msg;
          setTimeout(() => { original.textContent = prev; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(json).then(
            () => flash('Copiado ✓'),
            () => flash('Falhou ✗')
          );
        } else {
          // Fallback: textarea + execCommand
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

    // ─── Atalhos globais ──────────────────────────────────────────────────
    document.addEventListener('keydown', (ev) => {
      // ESC fecha drawers (precedência: detail > capacity)
      if (ev.key === 'Escape' && state.ui.detailOpen) {
        closeDetailDrawer();
        return;
      }
      if (ev.key === 'Escape' && state.ui.capacityOpen) {
        closeCapacityDrawer();
        return;
      }
      const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
      if (isInput || ev.metaKey || ev.ctrlKey) return;
      const k = ev.key.toLowerCase();
      if (k === 'r') loadData();
      else if (k === '1') setActiveTab('logs');
      else if (k === '2') setActiveTab('auth');
      else if (k === '3') setActiveTab('sessions');
      else if (k === '/') {
        // foca a busca como em apps modernos
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

    // Auto-refresh visibility-aware
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  // ==========================================================================
  // 18. CLIENT MODAL
  // ==========================================================================
  function openClientModal() {
    if (!modal.root) return;
    modal.form.reset();
    modal.fldActive.checked = true;
    modal.formError.hidden = true;
    clearFieldErrors();
    modal.root.hidden = false;
    modal.root.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => modal.fldId.focus());
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
    if (!modal.fldId) return;
    modal.fldId.classList.remove('is-invalid');
    modal.fldName.classList.remove('is-invalid');
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
    if (!idCliente) { setFieldError('idCliente', 'Obrigatório'); ok = false; }
    else if (!/^[a-z0-9_-]+$/.test(idCliente)) {
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
      await apiPost('createClient', { idCliente, nomeCliente, ativo });
      closeClientModal();
      await loadData();
      setFilter(idCliente);
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
    modal.form.addEventListener('submit', handleClientSubmit);
    modal.fldId.addEventListener('input', () => {
      const val = modal.fldId.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (val !== modal.fldId.value) modal.fldId.value = val;
    });
  }

  // ==========================================================================
  // 19. UTILITIES
  // ==========================================================================
  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function formatNumber(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return new Intl.NumberFormat('pt-BR').format(n);
  }

  function formatRelativeTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '—';
    const sec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (sec < 10)  return 'agora';
    if (sec < 60)  return `há ${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60)  return `há ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24)   return `há ${hr}h`;
    const d = Math.floor(hr / 24);
    if (d < 7)     return `há ${d} dia(s)`;
    return formatAbsoluteTime(iso);
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

  function getInitials(nome) {
    if (!nome) return '?';
    const parts = String(nome).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function avatarGradient(nome) {
    const palette = [
      ['#2C5BA0', '#6E8DBF'],
      ['#1F9E5C', '#4FC080'],
      ['#E0851A', '#F2A24A'],
      ['#7A4FBF', '#A684D9'],
      ['#1F7A8C', '#4DA6B8'],
      ['#BF4F4F', '#D97A7A'],
      ['#5C5C8C', '#8C8CB8']
    ];
    let hash = 0;
    const str = String(nome || '?');
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
    const [a, b] = palette[Math.abs(hash) % palette.length];
    return `linear-gradient(135deg, ${a}, ${b})`;
  }

  // ==========================================================================
  // 20. AUTO-REFRESH (visibility-aware)
  // ==========================================================================
  let autoRefreshTimer = null;

  function startAutoRefresh() {
    if (CONFIG.AUTO_REFRESH_MS <= 0) return;
    if (autoRefreshTimer) return;
    autoRefreshTimer = setInterval(() => {
      if (state.isLoading) return;
      if (modal.root && !modal.root.hidden) return;
      loadData();
    }, CONFIG.AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      loadData();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  }

  function startLocalTick() {
    setInterval(() => {
      if (state.isLoading) return;
      renderHeader();
      renderLiveStrip();
      renderEventsList();
      if (state.ui.capacityOpen) renderCapacityFooter();
    }, 30000);
  }

  // ==========================================================================
  // 21. ORCHESTRATION
  // ==========================================================================
  async function loadData() {
    if (state.isLoading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDashboardData();
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

  function init() {
    if (CONFIG.URL_DO_APPS_SCRIPT.startsWith('COLE_AQUI') ||
        CONFIG.API_KEY.startsWith('COLE_AQUI')) {
      setError(new Error('Configure URL_DO_APPS_SCRIPT e API_KEY no topo do dev.js'));
      renderMain();
      return;
    }

    // Tema: aplicar antes de tudo (sem transição na carga inicial = anti-FOUC)
    state.ui.theme = detectInitialTheme();
    applyTheme(state.ui.theme, /* withTransition */ false);

    bindEvents();
    bindClientModalEvents();
    loadData();
    startAutoRefresh();
    startLocalTick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // ==========================================================================
// 22. PWA — Service Worker registration
// ==========================================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => {
        console.log('[GodMode] Service Worker registrado:', reg.scope);
      })
      .catch(err => {
        console.warn('[GodMode] Service Worker falhou:', err);
      });
  });
}
})();
