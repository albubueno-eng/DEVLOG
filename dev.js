/**
 * ============================================================================
 *  CENTRAL DE DESENVOLVEDOR — MOTOR LÓGICO (God Mode)
 *  Vanilla JS ES6+ | Zero dependências | Stack: GitHub Pages + Apps Script
 *  ----------------------------------------------------------------------------
 *  Arquitetura:
 *    [API] → [State] → [Render] ← [Events]
 *
 *  Princípios:
 *    - Single source of truth (objeto `state`)
 *    - Render idempotente (mesmo state = mesmo DOM)
 *    - Event delegation (zero listeners duplicados)
 *    - DOM seguro (textContent, sem innerHTML em conteúdo dinâmico)
 *    - Erros descritivos e acionáveis (padrão Stripe)
 * ============================================================================
 */

(() => {
  'use strict';

  // ==========================================================================
  // 1. CONFIGURAÇÃO  ← EDITE AQUI
  // ==========================================================================
  const CONFIG = {
    URL_DO_APPS_SCRIPT: 'https://script.google.com/macros/s/AKfycbzqjZtyCn7X1lWQBSRYLwW-MijJN53YLPoHJrjjBh5y6P1kTaBATNpAV13KV9OgNYPx/exec',
    API_KEY: 'ee91297b-685b-4ae4-b131-8434841c882e',

    // Limite de logs por requisição (alinhado com o MAX_LIMIT do backend)
    LIMIT: 500,

    // Auto-refresh opcional (em ms). 0 = desativado.
    AUTO_REFRESH_MS: 0,

    // Timeout do fetch (ms). Apps Script tem cold start de ~10s.
    FETCH_TIMEOUT_MS: 20000
  };

  // ==========================================================================
  // 2. ESTADO GLOBAL (single source of truth)
  // ==========================================================================
  const state = {
    clientes: [],
    logs: [],
    totais: null,
    filtroClienteId: '',
    isLoading: false,
    error: null,
    geradoEm: null
  };

  // ==========================================================================
  // 3. SELETORES DOM (cacheados uma única vez)
  // ==========================================================================
  const dom = {
    clientList:       document.getElementById('clientList'),
    logsList:         document.getElementById('logsList'),
    logsMeta:         document.getElementById('logsMeta'),
    mainTitle:        document.getElementById('mainTitle'),
    mainSubtitle:     document.getElementById('mainSubtitle'),
    refreshBtn:       document.getElementById('refreshBtn'),
    connectionStatus: document.getElementById('connectionStatus'),
    kpi: {
      total:    document.getElementById('kpiTotal'),
      erros:    document.getElementById('kpiErros'),
      alertas:  document.getElementById('kpiAlertas'),
      infos:    document.getElementById('kpiInfos')
    }
  };

  // Modal de novo cliente (pode não existir ainda em layouts antigos)
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
  // 4. API LAYER  (única responsabilidade: falar com o backend)
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
        throw new Error(`Tempo de resposta excedido (${CONFIG.FETCH_TIMEOUT_MS / 1000}s). Tente novamente.`);
      }
      throw new Error(
        'Falha de rede ou CORS. Confirme: (1) implantação atualizada com NOVA VERSÃO, ' +
        '(2) "Quem pode acessar" = Qualquer pessoa, (3) teste em aba anônima sem extensões.'
      );
    }
    clearTimeout(timeoutId);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} — implantação inválida ou sem permissão pública.`);
    }

    const raw = await resp.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      console.error('[GodMode] Resposta não-JSON recebida:', raw.slice(0, 300));
      if (raw.includes('<!DOCTYPE') || raw.includes('accounts.google.com')) {
        throw new Error('Apps Script exigiu login. Reimplante como "Qualquer pessoa" + Nova versão.');
      }
      throw new Error('Resposta do servidor não é JSON válido. Veja o console para detalhes.');
    }

    if (!json.ok) {
      throw new Error(json.error || 'Resposta inválida do servidor');
    }
    return json.data;
  }

  /**
   * POST genérico para o backend (ações: createClient, updateClient, etc.)
   * Usa text/plain para evitar preflight CORS (mesmo padrão dos logs).
   */
  async function apiPost(action, payload) {
    const resp = await fetch(CONFIG.URL_DO_APPS_SCRIPT, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        apiKey: CONFIG.API_KEY,
        action,
        ...payload
      })
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
    state.clientes = Array.isArray(data.clientes) ? data.clientes : [];
    state.logs     = Array.isArray(data.logs)     ? data.logs     : [];
    state.totais   = data.totais || null;
    state.geradoEm = data.geradoEm || new Date().toISOString();
    state.error    = null;
  }

  function setFilter(clienteId) {
    state.filtroClienteId = clienteId || '';
    renderSidebar();
    renderMain();
  }

  // ==========================================================================
  // 6. SELETORES DERIVADOS
  // ==========================================================================
  function getLogsFiltrados() {
    if (!state.filtroClienteId) return state.logs;
    return state.logs.filter(l => String(l.idCliente) === String(state.filtroClienteId));
  }

  function calcularKPIs(logs) {
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
  // 7. RENDER LAYER
  // ==========================================================================

  function renderSidebar() {
    const ul = dom.clientList;
    ul.textContent = '';
    const contagens = contarLogsPorCliente();
    const ativoId   = state.filtroClienteId;

    ul.appendChild(buildClientItem({
      id: '',
      nome: 'Todos os Clientes',
      count: state.logs.length,
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
      const id = String(c.idCliente);
      ul.appendChild(buildClientItem({
        id,
        nome: c.nomeCliente || id,
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

  function renderMain() {
    const logsFiltrados = getLogsFiltrados();
    const kpis = calcularKPIs(logsFiltrados);

    renderHeader(logsFiltrados);
    renderKPIs(kpis);
    renderLogs(logsFiltrados);
  }

  function renderHeader(logsFiltrados) {
    const filtrando = !!state.filtroClienteId;
    const nome = getNomeCliente(state.filtroClienteId);

    dom.mainTitle.textContent = filtrando ? nome : 'Visão Geral';
    dom.mainSubtitle.textContent = filtrando
      ? `Telemetria isolada do cliente ${nome}`
      : 'Telemetria consolidada de todos os ecossistemas';

    const ts = state.geradoEm
      ? `· atualizado ${formatRelativeTime(state.geradoEm)}`
      : '';
    dom.logsMeta.textContent = `${formatNumber(logsFiltrados.length)} evento(s) ${ts}`;
  }

  function renderKPIs(kpis) {
    dom.kpi.total.textContent   = formatNumber(kpis.total);
    dom.kpi.erros.textContent   = formatNumber(kpis.erros);
    dom.kpi.alertas.textContent = formatNumber(kpis.alertas);
    dom.kpi.infos.textContent   = formatNumber(kpis.infos);
  }

  function renderLogs(logs) {
    const list = dom.logsList;
    list.textContent = '';

    if (state.isLoading && !logs.length) {
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

    if (!logs.length) {
      list.appendChild(buildEmptyState({
        icon: '✓',
        title: 'Nenhum evento registrado',
        text: state.filtroClienteId
          ? 'Este cliente não possui logs no período carregado.'
          : 'O ecossistema está silencioso. Bom sinal.'
      }));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const log of logs) {
      frag.appendChild(buildLogCard(log));
    }
    list.appendChild(frag);
  }

  function buildLogCard(log) {
    const tipo = String(log.tipoLog || '').toUpperCase();
    const tipoClass = tipo === 'ERRO'   ? 'log-card--erro'
                    : tipo === 'ALERTA' ? 'log-card--alerta'
                    : tipo === 'INFO'   ? 'log-card--info'
                    : '';

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
    const tsAbs = formatAbsoluteTime(log.timestamp);
    time.dateTime = log.timestamp || '';
    time.textContent = formatRelativeTime(log.timestamp);
    time.title = tsAbs;

    card.appendChild(icon);
    card.appendChild(body);
    card.appendChild(time);
    return card;
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
    if (span) span.textContent = state.isLoading ? 'Atualizando…' : 'Atualizar';
  }

  // ==========================================================================
  // 8. EVENT LAYER
  // ==========================================================================
  function bindEvents() {
    // Filtro de cliente — UM listener, captura todos os botões
    dom.clientList.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.client-item');
      if (!btn) return;
      const id = btn.dataset.clientId ?? '';
      setFilter(id);
    });

    // Atalho de teclado: setas ↑/↓ navegam entre clientes
    dom.clientList.addEventListener('keydown', (ev) => {
      if (!['ArrowDown', 'ArrowUp'].includes(ev.key)) return;
      const items = Array.from(dom.clientList.querySelectorAll('.client-item'));
      const idx = items.indexOf(document.activeElement);
      if (idx === -1) return;
      ev.preventDefault();
      const next = ev.key === 'ArrowDown' ? items[idx + 1] : items[idx - 1];
      if (next) next.focus();
    });

    // Botão Atualizar
    dom.refreshBtn.addEventListener('click', loadData);

    // Atalho global: R recarrega
    document.addEventListener('keydown', (ev) => {
      if (ev.key.toLowerCase() === 'r' && !ev.metaKey && !ev.ctrlKey
          && document.activeElement.tagName !== 'INPUT'
          && document.activeElement.tagName !== 'TEXTAREA') {
        loadData();
      }
    });
  }

  // ==========================================================================
  // 9. CLIENT MODAL  (cadastro de cliente pela Central)
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
    if (!idCliente) {
      setFieldError('idCliente', 'Obrigatório');
      ok = false;
    } else if (!/^[a-z0-9_-]+$/.test(idCliente)) {
      setFieldError('idCliente', 'Use apenas letras minúsculas, números, - ou _');
      ok = false;
    } else if (state.clientes.some(c => String(c.idCliente).toLowerCase() === idCliente)) {
      setFieldError('idCliente', 'Já existe um cliente com esse ID');
      ok = false;
    }
    if (!nomeCliente) {
      setFieldError('nomeCliente', 'Obrigatório');
      ok = false;
    }
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
      setFormError(err.message || 'Não foi possível cadastrar. Tente novamente.');
      setSaveButtonLoading(false);
    }
  }

  function bindClientModalEvents() {
    if (!modal.openBtn || !modal.root) return;

    modal.openBtn.addEventListener('click', openClientModal);

    // Fecha em qualquer elemento com [data-close]
    modal.root.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-close]')) closeClientModal();
    });

    // ESC fecha
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !modal.root.hidden) closeClientModal();
    });

    modal.form.addEventListener('submit', handleClientSubmit);

    // Sanitização do ID em tempo real
    modal.fldId.addEventListener('input', () => {
      const val = modal.fldId.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (val !== modal.fldId.value) modal.fldId.value = val;
    });
  }

  // ==========================================================================
  // 10. UTILITIES
  // ==========================================================================
  function formatNumber(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return new Intl.NumberFormat('pt-BR').format(n);
  }

  function formatRelativeTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '—';

    const diffMs = Date.now() - date.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 10)    return 'agora';
    if (sec < 60)    return `há ${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60)    return `há ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24)     return `há ${hr}h`;
    const d = Math.floor(hr / 24);
    if (d < 7)       return `há ${d} dia(s)`;
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

  // ==========================================================================
  // 11. ORCHESTRATION
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

    bindEvents();
    bindClientModalEvents();
    loadData();

    if (CONFIG.AUTO_REFRESH_MS > 0) {
      setInterval(loadData, CONFIG.AUTO_REFRESH_MS);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
