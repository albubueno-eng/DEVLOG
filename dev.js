/**
 * ============================================================================
 *  CENTRAL DE DESENVOLVEDOR — MOTOR LÓGICO (God Mode)
 *  Vanilla JS ES6+ | Zero dependências
 *  ----------------------------------------------------------------------------
 *  Arquitetura:
 *    [API] → [State] → [Render Dispatcher] ← [Events]
 *
 *  Estado consumido:
 *    - clientes, logs, eventosAuth, sessoesAtivas
 *    - totais (KPIs de logs)
 *    - operacionais (KPIs comportamentais)
 *
 *  Princípios:
 *    - Single source of truth
 *    - Render idempotente por tab
 *    - Auto-refresh visibility-aware
 *    - DOM seguro (textContent)
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
    FETCH_TIMEOUT_MS: 20000
  };

  // ==========================================================================
  // 2. ESTADO
  // ==========================================================================
  const state = {
    clientes: [],
    logs: [],
    eventosAuth: [],
    sessoesAtivas: [],
    totais: null,
    operacionais: null,
    filtroClienteId: '',
    activeTab: 'logs',         // 'logs' | 'auth' | 'sessions'
    isLoading: false,
    error: null,
    geradoEm: null
  };

  // ==========================================================================
  // 3. SELETORES DOM
  // ==========================================================================
  const dom = {
    clientList:       document.getElementById('clientList'),
    logsList:         document.getElementById('logsList'),       // área de eventos (multi-tab)
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
    }
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
    renderEventsList();
  }

  // ==========================================================================
  // 6. SELETORES DERIVADOS
  // ==========================================================================
  function getLogsFiltrados() {
    if (!state.filtroClienteId) return state.logs;
    return state.logs.filter(l => String(l.idCliente) === String(state.filtroClienteId));
  }

  function getAuthFiltrados() {
    if (!state.filtroClienteId) return state.eventosAuth;
    return state.eventosAuth.filter(a => String(a.idCliente) === String(state.filtroClienteId));
  }

  function getSessoesFiltradas() {
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
    renderEventsList();
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
    dom.logsMeta.textContent = `${formatNumber(total)} evento(s) ${ts}`;
  }

  // KPIs operacionais (sempre globais — não respeitam filtro de cliente)
  function renderKPIsOps() {
    const ops = state.operacionais || {};
    dom.kpiOps.online.textContent    = formatNumber(ops.onlineAgora);
    dom.kpiOps.logins.textContent    = formatNumber(ops.loginsHoje);
    dom.kpiOps.falhas.textContent    = formatNumber(ops.falhasLoginHoje);
    dom.kpiOps.expiradas.textContent = formatNumber(ops.sessoesExpiradasHoje);
  }

  // KPIs de logs (respeitam filtro de cliente)
  function renderKPIsLogs() {
    const kpis = calcularKPIsLogs(getLogsFiltrados());
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

    // Live Strip é sempre global — independente do filtro de cliente
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
  // 10. RENDER LAYER — Tabs
  // ==========================================================================
  function renderTabs() {
    const counts = {
      logs:     getLogsFiltrados().length,
      auth:     getAuthFiltrados().length,
      sessions: getSessoesFiltradas().length
    };
    dom.tabCounts.logs.textContent     = formatNumber(counts.logs);
    dom.tabCounts.auth.textContent     = formatNumber(counts.auth);
    dom.tabCounts.sessions.textContent = formatNumber(counts.sessions);

    // Estado ativo visual
    const buttons = dom.eventTabs.querySelectorAll('.tab');
    buttons.forEach(btn => {
      const isActive = btn.dataset.tab === state.activeTab;
      btn.classList.toggle('tab--active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function getEventsForActiveTab() {
    if (state.activeTab === 'auth')     return getAuthFiltrados();
    if (state.activeTab === 'sessions') return getSessoesFiltradas();
    return getLogsFiltrados();
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

    if (state.activeTab === 'logs') {
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
    return card;
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
  // 14. EVENTS
  // ==========================================================================
  function bindEvents() {
    // Filtro de cliente
    dom.clientList.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.client-item');
      if (!btn) return;
      const id = btn.dataset.clientId ?? '';
      setFilter(id);
    });

    // Setas para navegar a sidebar
    dom.clientList.addEventListener('keydown', (ev) => {
      if (!['ArrowDown', 'ArrowUp'].includes(ev.key)) return;
      const items = Array.from(dom.clientList.querySelectorAll('.client-item'));
      const idx = items.indexOf(document.activeElement);
      if (idx === -1) return;
      ev.preventDefault();
      const next = ev.key === 'ArrowDown' ? items[idx + 1] : items[idx - 1];
      if (next) next.focus();
    });

    // Tabs
    dom.eventTabs.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab');
      if (!btn) return;
      setActiveTab(btn.dataset.tab);
    });

    // Refresh
    dom.refreshBtn.addEventListener('click', loadData);

    // Atalhos globais
    document.addEventListener('keydown', (ev) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
      if (isInput || ev.metaKey || ev.ctrlKey) return;
      const k = ev.key.toLowerCase();
      if (k === 'r') loadData();
      else if (k === '1') setActiveTab('logs');
      else if (k === '2') setActiveTab('auth');
      else if (k === '3') setActiveTab('sessions');
    });

    // Auto-refresh visibility-aware
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  // ==========================================================================
  // 15. CLIENT MODAL
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
  // 16. UTILITIES
  // ==========================================================================
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

  /**
   * Gera um gradient determinístico a partir do nome do usuário.
   * Mesmo nome = mesma cor sempre. Padrão GitHub.
   */
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
  // 17. AUTO-REFRESH (visibility-aware)
  // ==========================================================================
  let autoRefreshTimer = null;

  function startAutoRefresh() {
    if (CONFIG.AUTO_REFRESH_MS <= 0) return;
    if (autoRefreshTimer) return;
    autoRefreshTimer = setInterval(() => {
      // Não dispara se modal aberto ou já está carregando
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
      // Quando volta pra aba, refaz fetch imediato + retoma timer
      loadData();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  }

  // Tick local: atualiza durações ("há 12 min") sem refazer fetch.
  // Chama renderLiveStrip e renderEventsList a cada 30s.
  function startLocalTick() {
    setInterval(() => {
      if (state.isLoading) return;
      // Re-render apenas dos blocos com tempo relativo
      renderHeader();
      renderLiveStrip();
      renderEventsList();
    }, 30000);
  }

  // ==========================================================================
  // 18. ORCHESTRATION
  // ==========================================================================
  async function loadData() {
    if (state.isLoading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDashboardData();
      setData(data);
      // Se o cliente filtrado deixou de existir, volta para "todos"
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
})();
