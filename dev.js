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
 * ============================================================================
 */

(() => {
  'use strict';

  // ==========================================================================
  // 1. CONFIGURAÇÃO  ← EDITE AQUI
  // ==========================================================================
  const CONFIG = {
    URL_DO_APPS_SCRIPT: 'COLE_AQUI_A_URL_/exec_DA_SUA_IMPLANTACAO',
    API_KEY: 'COLE_AQUI_A_MESMA_API_KEY_DO_BACKEND',

    // Limite de logs por requisição (alinhado com o MAX_LIMIT do backend)
    LIMIT: 500,

    // Auto-refresh opcional (em ms). 0 = desativado.
    AUTO_REFRESH_MS: 0
  };

  // ==========================================================================
  // 2. ESTADO GLOBAL (single source of truth)
  // ==========================================================================
  const state = {
    clientes: [],         // [{ idCliente, nomeCliente, ativo }]
    logs: [],             // logs crus vindos do backend
    totais: null,         // { totalLogs, totalErros, totalAlertas, totalInfos }
    filtroClienteId: '',  // '' = todos
    isLoading: false,
    error: null,
    geradoEm: null
  };

  // ==========================================================================
  // 3. SELETORES DOM (cacheados uma única vez)
  // ==========================================================================
  const dom = {
    clientList:    document.getElementById('clientList'),
    logsList:      document.getElementById('logsList'),
    logsMeta:      document.getElementById('logsMeta'),
    mainTitle:     document.getElementById('mainTitle'),
    mainSubtitle:  document.getElementById('mainSubtitle'),
    refreshBtn:    document.getElementById('refreshBtn'),
    connectionStatus: document.getElementById('connectionStatus'),
    kpi: {
      total:    document.getElementById('kpiTotal'),
      erros:    document.getElementById('kpiErros'),
      alertas:  document.getElementById('kpiAlertas'),
      infos:    document.getElementById('kpiInfos')
    }
  };

  // ==========================================================================
  // 4. API LAYER  (única responsabilidade: falar com o backend)
  // ==========================================================================
  async function fetchDashboardData() {
    const url = `${CONFIG.URL_DO_APPS_SCRIPT}?apiKey=${encodeURIComponent(CONFIG.API_KEY)}&limit=${CONFIG.LIMIT}`;

    const resp = await fetch(url, {
      method: 'GET',
      // text/plain evita preflight CORS no Apps Script (ver Fase 1)
      redirect: 'follow'
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const json = await resp.json();
    if (!json.ok) {
      throw new Error(json.error || 'Resposta inválida do servidor');
    }
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
    renderSidebar();   // atualiza estado visual ativo
    renderMain();      // re-renderiza KPIs + logs filtrados
  }

  // ==========================================================================
  // 6. SELETORES DERIVADOS  (computam visões a partir do state cru)
  // ==========================================================================
  function getLogsFiltrados() {
    if (!state.filtroClienteId) return state.logs;
    return state.logs.filter(l => String(l.idCliente) === String(state.filtroClienteId));
  }

  function calcularKPIs(logs) {
    const r = { total: logs.length, erros: 0, alertas: 0, infos: 0 };
    for (const l of logs) {
      const t = String(l.tipoLog || '').toUpperCase();
      if (t === 'ERRO')    r.erros++;
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

  // ---- Sidebar ----
  function renderSidebar() {
    const ul = dom.clientList;
    ul.textContent = ''; // limpa
    const contagens = contarLogsPorCliente();
    const ativoId   = state.filtroClienteId;

    // Item "Todos os Clientes" no topo
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
    btn.dataset.clientId = id; // event delegation usa isso
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

  // ---- Main (header + KPIs + logs) ----
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

    // Estados especiais
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

    // Render em DocumentFragment → uma única operação no DOM (performance)
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

    // Ícone tipográfico
    const icon = document.createElement('div');
    icon.className = 'log-card__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = tipo === 'ERRO' ? '!' : tipo === 'ALERTA' ? '▲' : 'i';

    // Body
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

    // Timestamp (relativo + tooltip absoluto)
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

  // ---- Status de conexão ----
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
  // 8. EVENT LAYER  (delegation + listeners diretos onde faz sentido)
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

    // Atalho global: R recarrega (padrão Linear/Notion)
    document.addEventListener('keydown', (ev) => {
      if (ev.key.toLowerCase() === 'r' && !ev.metaKey && !ev.ctrlKey
          && document.activeElement.tagName !== 'INPUT'
          && document.activeElement.tagName !== 'TEXTAREA') {
        loadData();
      }
    });
  }

  // ==========================================================================
  // 9. UTILITIES
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
  // 10. ORCHESTRATION
  // ==========================================================================
  async function loadData() {
    if (state.isLoading) return;       // proteção contra duplo-clique
    setLoading(true);
    setError(null);

    try {
      const data = await fetchDashboardData();
      setData(data);
      // Mantém o filtro atual se o cliente ainda existe; senão volta pra "todos"
      if (state.filtroClienteId &&
          !state.clientes.some(c => String(c.idCliente) === String(state.filtroClienteId))) {
        state.filtroClienteId = '';
      }
      renderSidebar();
      renderMain();
    } catch (err) {
      console.error('[GodMode] Falha no fetch:', err);
      setError(err);
      renderMain(); // mostra error state
    } finally {
      setLoading(false);
    }
  }

  function init() {
    // Sanity check de configuração
    if (CONFIG.URL_DO_APPS_SCRIPT.startsWith('COLE_AQUI') ||
        CONFIG.API_KEY.startsWith('COLE_AQUI')) {
      setError(new Error('Configure URL_DO_APPS_SCRIPT e API_KEY no topo do dev.js'));
      renderMain();
      return;
    }

    bindEvents();
    loadData();

    if (CONFIG.AUTO_REFRESH_MS > 0) {
      setInterval(loadData, CONFIG.AUTO_REFRESH_MS);
    }
  }

  // Boot quando o DOM estiver pronto (defer já garante, mas segurança extra)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
