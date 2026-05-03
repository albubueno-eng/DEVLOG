/* =============================================================================
   client.js — Portal do Cliente (white-label) v1.0
   Parte 1/2 — config, state, API, branding, dashboard, eventos, drawer
   =============================================================================
   Requer: ./client.html, ./style-client.css
   Compartilha: localStorage keys 'gm_token', 'gm_escopo', 'gm_user'
   ============================================================================= */

// ===========================================================================
// 1. CONFIG
// ===========================================================================
const CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzqjZtyCn7X1lWQBSRYLwW-MijJN53YLPoHJrjjBh5y6P0TaBATNpAV13KV9OgNYPx/exec',
  API_KEY:    'ee91297b-685b-4ae4-b131-8434841c882e',
  REFRESH_INTERVAL_MS: 30_000,
  TOAST_TTL_MS:        3_500,
  STORAGE_KEYS: {
    TOKEN:  'gm_token',
    ESCOPO: 'gm_escopo',
    USER:   'gm_user',
    THEME:  'gm_theme',
  },
};

// ===========================================================================
// 2. STATE
// ===========================================================================
const state = {
  // Dados do backend
  data: {
    branding:     { nomeFantasia: '', logoUrl: '', corPrimaria: '#2563eb' },
    kpis:         {},
    logs:         [],
    authEvents:   [],
    sessoes:      [],
    funcionarios: [],
    quota:        { atual: 0, limite: 0 },
    apps:         [],
  },

  // UI
  isLoading:       false,
  error:           null,
  activeSection:   'dashboard',     // 'dashboard' | 'eventos' | 'funcionarios'
  activeTab:       'logs',          // 'logs' | 'auth' | 'sessoes'
  range:           '24h',           // '1h' | '24h' | '7d' | '30d' | 'all'
  search:          '',
  severityFilter:  null,            // null | 'ERRO' | 'ALERTA' | 'INFO'

  // Drawer
  detailContext:   null,            // { kind, event }

  // Auto-refresh
  refreshTimer:    null,

  // User
  user:            null,            // { idCliente, nome, email, ... }
  token:           null,
};

// ===========================================================================
// 3. DOM SHORTHAND
// ===========================================================================
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const dom = {
  // Branding
  brandLogo:        $('#brandLogo'),
  brandName:        $('#brandName'),
  brandSubtitle:    $('#brandSubtitle'),
  themeColorMeta:   $('#themeColorMeta'),
  pageTitle:        $('#pageTitle'),
  pageSubtitle:     $('#pageSubtitle'),

  // Sidebar
  navItems:         $$('.nav-item'),
  navBadgeEventos:  $('#navBadgeEventos'),
  systemStatus:     $('#systemStatus'),

  // Topbar
  btnSolicitarQuota: $('#btnSolicitarQuota'),
  btnRefresh:       $('#btnRefresh'),
  btnTheme:         $('#btnTheme'),
  btnUserMenu:      $('#btnUserMenu'),
  userDropdown:     $('#userDropdown'),
  userName:         $('#userName'),
  btnLogout:        $('#btnLogout'),

  // KPIs
  kpiFuncAtivos:    $('#kpiFuncAtivos'),
  kpiFuncQuota:     $('#kpiFuncQuota'),
  kpiOnline:        $('#kpiOnline'),
  kpiErros24h:      $('#kpiErros24h'),
  kpiErrosAbertos:  $('#kpiErrosAbertos'),
  kpiLoginsFalhos:  $('#kpiLoginsFalhos'),
  kpiAuth24h:       $('#kpiAuth24h'),
  kpiTaxaSucesso:   $('#kpiTaxaSucesso'),
  kpiApps:          $('#kpiApps'),

  // Live strip
  liveStripBody:    $('#liveStripBody'),

  // Eventos
  searchInput:      $('#searchInput'),
  rangeSelect:      $('#rangeSelect'),
  severityPills:    $('#severityPills'),
  tabs:             $$('.tab'),
  tabCountLogs:     $('#tabCountLogs'),
  tabCountAuth:     $('#tabCountAuth'),
  tabCountSessoes:  $('#tabCountSessoes'),
  pillCountErro:    $('#pillCountErro'),
  pillCountAlerta:  $('#pillCountAlerta'),
  pillCountInfo:    $('#pillCountInfo'),
  eventsList:       $('#eventsList'),
  btnExportCsv:     $('#btnExportCsv'),
  btnExportPdf:     $('#btnExportPdf'),

  // Funcionários (parte 2)
  funcSearch:       $('#funcSearch'),
  btnNovoFuncionario: $('#btnNovoFuncionario'),
  funcionariosTbody: $('#funcionariosTbody'),
  funcQuotaInfo:    $('#funcQuotaInfo'),

  // Drawer
  detailDrawer:     $('#detailDrawer'),
  detailDrawerTitle:$('#detailDrawerTitle'),
  detailDrawerBody: $('#detailDrawerBody'),
  detailDrawerCloseBtn: $('#detailDrawerCloseBtn'),
  detailDrawerCopyBtn:  $('#detailDrawerCopyBtn'),

  // Modais (parte 2)
  modalFuncionario: $('#modalFuncionario'),
  formFuncionario:  $('#formFuncionario'),
  modalFuncTitle:   $('#modalFuncTitle'),
  modalQuota:       $('#modalQuota'),
  formQuota:        $('#formQuota'),
  quotaAtualInfo:   $('#quotaAtualInfo'),

  // Toasts
  toastContainer:   $('#toastContainer'),

  // Sections
  sections:         $$('.section'),
};

// ===========================================================================
// 4. HELPERS — cor (para branding white-label)
// ===========================================================================
function hexToRgb(hex) {
  if (!hex) return null;
  const m = String(hex).trim().replace('#', '').match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  const c = (x) => x.toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function shadeHex(hex, percent) {
  const rgb = hexToRgb(hex); if (!rgb) return hex;
  const adj = (v) => Math.max(0, Math.min(255, Math.round(v + (percent / 100) * 255)));
  return rgbToHex(adj(rgb.r), adj(rgb.g), adj(rgb.b));
}
function hexToRgba(hex, alpha) {
  const rgb = hexToRgb(hex); if (!rgb) return `rgba(37,99,235,${alpha})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

// ===========================================================================
// 5. HELPERS — texto / data / sanitização
// ===========================================================================
function _esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
  } catch { return String(iso); }
}
function fmtRelativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d.getTime())) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)    return `${Math.floor(diff)}s atrás`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}
function rangeToMs(range) {
  const map = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
  return map[range] || null; // 'all' → null (sem filtro)
}
function withinRange(iso, range) {
  const ms = rangeToMs(range); if (ms === null) return true;
  const d = new Date(iso); if (isNaN(d.getTime())) return false;
  return (Date.now() - d.getTime()) <= ms;
}

// ===========================================================================
// 6. TOAST
// ===========================================================================
function toast(msg, type = 'info') {
  if (!dom.toastContainer) { console.log(`[${type}] ${msg}`); return; }
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.type = type;
  el.textContent = msg;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 250);
  }, CONFIG.TOAST_TTL_MS);
}

// ===========================================================================
// 7. API LAYER
// ===========================================================================
async function apiPost(action, payload = {}) {
  const body = {
    apiKey: CONFIG.API_KEY,
    token:  state.token,
    action,
    ...payload,
  };
  const res = await fetch(CONFIG.SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let json;
  try { json = JSON.parse(txt); }
  catch { throw new Error('Resposta inválida do servidor'); }
  if (!json.ok) throw new Error(json.error || 'Erro desconhecido');
  return json.data ?? json;
}

async function apiGet(params = {}) {
  const url = new URL(CONFIG.SCRIPT_URL);
  url.searchParams.set('apiKey', CONFIG.API_KEY);
  if (state.token) url.searchParams.set('token', state.token);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Erro desconhecido');
  return json.data ?? json;
}

// ===========================================================================
// 8. BRANDING — aplica white-label no DOM
// ===========================================================================
function applyBranding(branding) {
  const b = {
    nomeFantasia: branding?.nomeFantasia || branding?.razaoSocial || 'Painel',
    logoUrl:      branding?.logoUrl      || './icons/icon-192.png',
    corPrimaria:  branding?.corPrimaria  || '#2563eb',
  };

  // Nome / título
  if (dom.brandName) dom.brandName.textContent = b.nomeFantasia;
  document.title = `Painel — ${b.nomeFantasia}`;

  // Logo (com fallback se URL falhar)
  if (dom.brandLogo) {
    dom.brandLogo.alt = b.nomeFantasia;
    dom.brandLogo.onerror = () => { dom.brandLogo.src = './icons/icon-192.png'; };
    dom.brandLogo.src = b.logoUrl;
  }

  // Cor primária via CSS variables
  const root = document.documentElement;
  root.style.setProperty('--brand-primary',       b.corPrimaria);
  root.style.setProperty('--brand-primary-hover', shadeHex(b.corPrimaria, -10));
  root.style.setProperty('--brand-primary-soft',  hexToRgba(b.corPrimaria, 0.10));
  root.style.setProperty('--brand-primary-ring',  hexToRgba(b.corPrimaria, 0.35));

  // theme-color (PWA / mobile address bar)
  if (dom.themeColorMeta) dom.themeColorMeta.setAttribute('content', b.corPrimaria);
}

// ===========================================================================
// 9. STATUS PILL
// ===========================================================================
function setSystemStatus(s, label) {
  const pill = dom.systemStatus; if (!pill) return;
  pill.dataset.state = s;
  const lbl = pill.querySelector('.status-pill__label');
  if (lbl) lbl.textContent = label;
}

// ===========================================================================
// 10. NAVEGAÇÃO ENTRE SEÇÕES
// ===========================================================================
const SECTION_META = {
  dashboard:    { title: 'Dashboard',    subtitle: 'Visão geral do seu ambiente' },
  eventos:      { title: 'Eventos',      subtitle: 'Logs, autenticação e sessões' },
  funcionarios: { title: 'Funcionários', subtitle: 'Gerencie acessos e permissões' },
};
function activateSection(name) {
  if (!SECTION_META[name]) name = 'dashboard';
  state.activeSection = name;

  dom.sections.forEach(s => s.classList.toggle('is-active', s.dataset.section === name));
  dom.navItems.forEach(n => n.classList.toggle('is-active', n.dataset.section === name));

  const meta = SECTION_META[name];
  if (dom.pageTitle)    dom.pageTitle.textContent    = meta.title;
  if (dom.pageSubtitle) dom.pageSubtitle.textContent = meta.subtitle;
}

// ===========================================================================
// 11. KPIs + LIVE STRIP
// ===========================================================================
function calcKPIs() {
  const logs    = state.data.logs || [];
  const auth    = state.data.authEvents || [];
  const sess    = state.data.sessoes || [];
  const funcs   = state.data.funcionarios || [];
  const quota   = state.data.quota || { atual: 0, limite: 0 };
  const apps    = state.data.apps || [];

  const last24h = (iso) => withinRange(iso, '24h');

  const logs24       = logs.filter(l => last24h(l.timestamp));
  const errosAbertos = logs.filter(l => String(l.tipoLog||'').toUpperCase() === 'ERRO'
                                     && String(l.status||'ABERTO').toUpperCase() !== 'RESOLVIDO').length;
  const auth24       = auth.filter(a => last24h(a.timestamp));
  const loginsOk     = auth24.filter(a => /sucesso|ok|true/i.test(String(a.sucesso ?? a.resultado ?? ''))).length;
  const loginsFalhos = auth24.filter(a => /falha|erro|false/i.test(String(a.sucesso ?? a.resultado ?? ''))).length;
  const taxaSucesso  = auth24.length ? Math.round((loginsOk / auth24.length) * 100) : 0;
  const onlineNow    = sess.filter(s => String(s.status||'').toUpperCase() === 'ATIVA' || s.online).length;
  const funcAtivos   = funcs.filter(f => String(f.status||'ATIVO').toUpperCase() === 'ATIVO').length;

  return {
    funcAtivos,
    quotaLimite:    quota.limite || funcs.length || 0,
    quotaUsada:     quota.atual  || funcAtivos,
    onlineNow,
    erros24h:       logs24.filter(l => String(l.tipoLog||'').toUpperCase() === 'ERRO').length,
    errosAbertos,
    loginsFalhos,
    auth24h:        auth24.length,
    taxaSucesso,
    apps:           apps.length,
  };
}

function renderKPIs() {
  const k = calcKPIs();
  if (dom.kpiFuncAtivos)   dom.kpiFuncAtivos.textContent   = k.funcAtivos;
  if (dom.kpiFuncQuota)    dom.kpiFuncQuota.textContent    = `${k.quotaUsada} de ${k.quotaLimite || '—'}`;
  if (dom.kpiOnline)       dom.kpiOnline.textContent       = k.onlineNow;
  if (dom.kpiErros24h)     dom.kpiErros24h.textContent     = k.erros24h;
  if (dom.kpiErrosAbertos) dom.kpiErrosAbertos.textContent = `${k.errosAbertos} em aberto`;
  if (dom.kpiLoginsFalhos) dom.kpiLoginsFalhos.textContent = k.loginsFalhos;
  if (dom.kpiAuth24h)      dom.kpiAuth24h.textContent      = k.auth24h;
  if (dom.kpiTaxaSucesso)  dom.kpiTaxaSucesso.textContent  = `${k.taxaSucesso}% sucesso`;
  if (dom.kpiApps)         dom.kpiApps.textContent         = k.apps;

  // Badge de eventos abertos no nav
  if (dom.navBadgeEventos) {
    if (k.errosAbertos > 0) {
      dom.navBadgeEventos.hidden = false;
      dom.navBadgeEventos.textContent = k.errosAbertos;
    } else {
      dom.navBadgeEventos.hidden = true;
    }
  }
}

function renderLiveStrip() {
  if (!dom.liveStripBody) return;

  // Combina logs + auth + sessões e pega os 8 mais recentes
  const items = [
    ...(state.data.logs || []).map(x => ({
      kind: 'log',
      ts: x.timestamp,
      icon: String(x.tipoLog||'').toUpperCase() === 'ERRO' ? '🔴'
          : String(x.tipoLog||'').toUpperCase() === 'ALERTA' ? '🟡' : '🔵',
      label: `${x.aplicativo || '—'} · ${x.tipoLog || 'INFO'}`,
      sub: (x.mensagemErro || '').slice(0, 80),
    })),
    ...(state.data.authEvents || []).map(x => ({
      kind: 'auth',
      ts: x.timestamp,
      icon: /falha|erro|false/i.test(String(x.sucesso ?? x.resultado ?? '')) ? '🚫' : '✅',
      label: `Auth · ${x.usuario || '—'}`,
      sub: x.aplicativo ? `app: ${x.aplicativo}` : '',
    })),
  ]
  .filter(x => x.ts)
  .sort((a, b) => new Date(b.ts) - new Date(a.ts))
  .slice(0, 8);

  if (!items.length) {
    dom.liveStripBody.innerHTML = '<div class="empty">Aguardando atividade…</div>';
    return;
  }

  dom.liveStripBody.innerHTML = items.map(it => `
    <div class="live-strip__item" style="display:flex;gap:10px;align-items:center;padding:6px 16px;font-size:12px;border-bottom:1px solid var(--color-border,#f3f4f6);">
      <span style="font-size:14px;">${it.icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:500;">${_esc(it.label)}</div>
        ${it.sub ? `<div style="color:var(--color-text-muted,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(it.sub)}</div>` : ''}
      </div>
      <span style="color:var(--color-text-muted,#6b7280);font-variant-numeric:tabular-nums;">${_esc(fmtRelativeTime(it.ts))}</span>
    </div>
  `).join('');
}

// ===========================================================================
// 12. EVENTOS — abas / contadores / filtros / lista
// ===========================================================================
function setActiveTab(tab) {
  state.activeTab = tab;
  dom.tabs.forEach(t => t.classList.toggle('is-active', t.dataset.tab === tab));
  // pills só fazem sentido para 'logs'
  if (dom.severityPills) dom.severityPills.style.display = (tab === 'logs') ? '' : 'none';
  renderEventsList();
}

function setSeverityFilter(sev) {
  state.severityFilter = (state.severityFilter === sev) ? null : sev;

  $$('.pill', dom.severityPills).forEach(p => {
    p.classList.toggle('is-active', p.dataset.severity === state.severityFilter);
  });
  renderEventsList();
}

function getFilteredEvents() {
  const tab = state.activeTab;
  const range = state.range;
  const q = state.search.trim().toLowerCase();
  const sev = state.severityFilter;

  let arr = [];
  if (tab === 'logs')    arr = state.data.logs || [];
  if (tab === 'auth')    arr = state.data.authEvents || [];
  if (tab === 'sessoes') arr = state.data.sessoes || [];

  return arr.filter(ev => {
    if (!withinRange(ev.timestamp, range)) return false;
    if (tab === 'logs' && sev && String(ev.tipoLog||'').toUpperCase() !== sev) return false;
    if (q) {
      const blob = JSON.stringify(ev).toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}

function renderTabCounts() {
  const inRange = (arr) => arr.filter(x => withinRange(x.timestamp, state.range));
  const logs = inRange(state.data.logs || []);
  const auth = inRange(state.data.authEvents || []);
  const sess = inRange(state.data.sessoes || []);

  if (dom.tabCountLogs)    dom.tabCountLogs.textContent    = logs.length;
  if (dom.tabCountAuth)    dom.tabCountAuth.textContent    = auth.length;
  if (dom.tabCountSessoes) dom.tabCountSessoes.textContent = sess.length;

  if (dom.pillCountErro)   dom.pillCountErro.textContent   = logs.filter(l => String(l.tipoLog||'').toUpperCase() === 'ERRO').length;
  if (dom.pillCountAlerta) dom.pillCountAlerta.textContent = logs.filter(l => String(l.tipoLog||'').toUpperCase() === 'ALERTA').length;
  if (dom.pillCountInfo)   dom.pillCountInfo.textContent   = logs.filter(l => String(l.tipoLog||'').toUpperCase() === 'INFO').length;
}

function renderEventsList() {
  if (!dom.eventsList) return;
  renderTabCounts();

  const items = getFilteredEvents()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (!items.length) {
    dom.eventsList.innerHTML = '<div class="empty">Nenhum evento neste filtro</div>';
    return;
  }

  const tab = state.activeTab;
  dom.eventsList.innerHTML = items.map((ev, idx) => {
    const id = `ev-${tab}-${idx}`;
    let badgeTone = 'INFO', badgeText = 'INFO', title = '', sub = '';

    if (tab === 'logs') {
      badgeTone = String(ev.tipoLog||'INFO').toUpperCase();
      badgeText = badgeTone;
      title = `${ev.aplicativo || '—'} · ${ev.usuario || '—'}`;
      sub = (ev.mensagemErro || '').slice(0, 120);
    } else if (tab === 'auth') {
      const sucesso = !/falha|erro|false/i.test(String(ev.sucesso ?? ev.resultado ?? ''));
      badgeTone = sucesso ? 'SUCESSO' : 'FALHA';
      badgeText = sucesso ? 'OK' : 'FALHA';
      title = `${ev.usuario || '—'} · ${ev.aplicativo || '—'}`;
      sub = `${ev.ip || ''} ${ev.userAgent ? '· ' + String(ev.userAgent).slice(0, 60) : ''}`.trim();
    } else if (tab === 'sessoes') {
      const ativa = String(ev.status||'').toUpperCase() === 'ATIVA' || ev.online;
      badgeTone = ativa ? 'SUCESSO' : 'INFO';
      badgeText = ativa ? 'ONLINE' : 'OFF';
      title = `${ev.usuario || '—'} · ${ev.aplicativo || '—'}`;
      sub = ev.dispositivo || ev.ip || '';
    }

    return `
      <div class="event-item" role="listitem" data-id="${id}" data-tab="${tab}" data-idx="${idx}">
        <div class="event-item__time">${_esc(fmtRelativeTime(ev.timestamp))}</div>
        <div class="event-item__main">
          <div class="event-item__title">${_esc(title)}</div>
          ${sub ? `<div class="event-item__sub">${_esc(sub)}</div>` : ''}
        </div>
        <span class="event-item__badge" data-tone="${badgeTone}">${_esc(badgeText)}</span>
      </div>`;
  }).join('');

  // Click → abre drawer

  $$('.event-item', dom.eventsList).forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx, 10);
      const tab = el.dataset.tab;
      const event = getFilteredEvents().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[idx];
      if (event) openDetailDrawer(event, tab);
    });
  });
}

// ===========================================================================
// 13. DRAWER DE DETALHE (simplificado — sem KB / sem resolve)
// ===========================================================================
function openDetailDrawer(event, kind) {
  state.detailContext = { kind, event };
  populateDetailDrawer(event, kind);
  dom.detailDrawer.hidden = false;
  dom.detailDrawer.setAttribute('aria-hidden', 'false');
}
function closeDetailDrawer() {
  dom.detailDrawer.hidden = true;
  dom.detailDrawer.setAttribute('aria-hidden', 'true');
  state.detailContext = null;
}

function populateDetailDrawer(ev, kind) {
  let title = 'Detalhe';
  let html = '';

  if (kind === 'logs') {
    title = 'Detalhe do Log';
    html  = _buildLogDetail(ev);
  } else if (kind === 'auth') {
    title = 'Detalhe de Autenticação';
    html  = _buildAuthDetail(ev);
  } else if (kind === 'sessoes') {
    title = 'Detalhe da Sessão';
    html  = _buildSessionDetail(ev);
  }

  if (dom.detailDrawerTitle) dom.detailDrawerTitle.textContent = title;
  if (dom.detailDrawerBody)  dom.detailDrawerBody.innerHTML    = html;
}

function _buildLogDetail(log) {
  const tipo   = String(log.tipoLog || 'INFO').toUpperCase();
  const status = String(log.status  || 'ABERTO').toUpperCase();
  return `
    <div class="detail__header">
      <span class="detail__badge" data-tone="${_esc(status)}">${_esc(status)}</span>
      <span class="detail__badge" data-tone="${_esc(tipo)}">${_esc(tipo)}</span>
    </div>
    <div class="detail__section">
      <h4>Informações</h4>
      <dl class="detail__dl">
        <dt>Quando</dt><dd>${_esc(fmtDateTime(log.timestamp))}</dd>
        <dt>Aplicativo</dt><dd>${_esc(log.aplicativo || '—')}</dd>
        <dt>Usuário</dt><dd>${_esc(log.usuario || '—')}</dd>
        <dt>Dispositivo</dt><dd>${_esc(log.dispositivo || '—')}</dd>
      </dl>
    </div>
    <div class="detail__section">
      <h4>Mensagem</h4>
      <div class="detail__message">${_esc(log.mensagemErro || '(sem mensagem)')}</div>
    </div>
    ${log.resolvidoPor || log.resolucao ? `
      <div class="detail__section">
        <h4>Resolução</h4>
        <dl class="detail__dl">
          ${log.resolvidoPor ? `<dt>Resolvido por</dt><dd>${_esc(log.resolvidoPor)}</dd>` : ''}
          ${log.resolucao ? `<dt>Notas</dt><dd>${_esc(log.resolucao)}</dd>` : ''}
        </dl>
      </div>` : ''}
    ${log.historico ? `
      <div class="detail__section">
        <h4>Histórico</h4>
        <pre class="detail__payload">${_esc(log.historico)}</pre>
      </div>` : ''}
  `;
}

function _buildAuthDetail(ev) {
  const sucesso = !/falha|erro|false/i.test(String(ev.sucesso ?? ev.resultado ?? ''));
  return `
    <div class="detail__header">
      <span class="detail__badge" data-tone="${sucesso ? 'INFO' : 'ERRO'}">
        ${sucesso ? 'SUCESSO' : 'FALHA'}
      </span>
    </div>
    <div class="detail__section">
      <h4>Informações</h4>
      <dl class="detail__dl">
        <dt>Quando</dt><dd>${_esc(fmtDateTime(ev.timestamp))}</dd>
        <dt>Usuário</dt><dd>${_esc(ev.usuario || '—')}</dd>
        <dt>Aplicativo</dt><dd>${_esc(ev.aplicativo || '—')}</dd>
        <dt>Tipo</dt><dd>${_esc(ev.tipo || ev.evento || '—')}</dd>
        <dt>IP</dt><dd>${_esc(ev.ip || '—')}</dd>
        <dt>User-Agent</dt><dd style="font-size:11px;">${_esc(ev.userAgent || '—')}</dd>
      </dl>
    </div>
    ${ev.detalhes ? `
      <div class="detail__section">
        <h4>Detalhes</h4>
        <div class="detail__message">${_esc(ev.detalhes)}</div>
      </div>` : ''}
  `;
}

function _buildSessionDetail(ev) {
  const ativa = String(ev.status||'').toUpperCase() === 'ATIVA' || ev.online;
  return `
    <div class="detail__header">
      <span class="detail__badge" data-tone="${ativa ? 'INFO' : 'ABERTO'}">
        ${ativa ? 'ONLINE' : 'OFFLINE'}
      </span>
    </div>
    <div class="detail__section">
      <h4>Informações</h4>
      <dl class="detail__dl">
        <dt>Início</dt><dd>${_esc(fmtDateTime(ev.timestamp || ev.inicio))}</dd>
        <dt>Usuário</dt><dd>${_esc(ev.usuario || '—')}</dd>
        <dt>Aplicativo</dt><dd>${_esc(ev.aplicativo || '—')}</dd>
        <dt>Dispositivo</dt><dd>${_esc(ev.dispositivo || '—')}</dd>
        <dt>IP</dt><dd>${_esc(ev.ip || '—')}</dd>
        <dt>Último heartbeat</dt><dd>${_esc(fmtRelativeTime(ev.ultimoHeartbeat || ev.lastSeen))}</dd>
      </dl>
    </div>
  `;
}

// Copiar JSON
async function copyDetailJson() {
  if (!state.detailContext) return;
  const payload = {
    kind: state.detailContext.kind,
    data: state.detailContext.event,
  };
  const txt = JSON.stringify(payload, null, 2);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(txt);
    } else {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const btn = dom.detailDrawerCopyBtn;
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'Copiado ✓';
      setTimeout(() => { btn.textContent = original; }, 1200);
    }
  } catch (err) {
    toast('Falha ao copiar: ' + err.message, 'error');
  }
}

// ===========================================================================
// 14. TEMA
// ===========================================================================
function toggleTheme() {
  const cur = document.body.dataset.theme || 'light';
  const next = cur === 'light' ? 'dark' : 'light';
  document.body.dataset.theme = next;
  try { localStorage.setItem(CONFIG.STORAGE_KEYS.THEME, next); } catch {}
}
function loadTheme() {
  try {
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.THEME);
    if (saved === 'dark' || saved === 'light') document.body.dataset.theme = saved;
  } catch {}
}

// ===========================================================================
// 15. LOGOUT
// ===========================================================================
async function doLogout() {
  try { await apiPost('logoutGodMode', {}); } catch {}
  try {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.TOKEN);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.ESCOPO);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.USER);
  } catch {}
  window.location.replace('./login.html');
}

// ===========================================================================
// 16. LOAD DATA — orquestração
// ===========================================================================
async function loadData() {
  if (state.isLoading) return;
  state.isLoading = true;
  state.error = null;
  setSystemStatus('loading', 'Sincronizando…');

  try {
    // Endpoint de dashboard cliente — usa o token para resolver escopo
    const data = await apiGet({ scope: 'client', limit: 500 });

    // Mapeia para state.data — resiliente a variações de nome no backend
    state.data.branding     = data.branding     || data.cliente || state.data.branding;
    state.data.kpis         = data.kpis         || {};
    state.data.logs         = data.logs         || [];
    state.data.authEvents   = data.authEvents   || data.auth || [];
    state.data.sessoes      = data.sessoes      || data.sessions || [];
    state.data.funcionarios = data.funcionarios || [];
    state.data.quota        = data.quota        || { atual: 0, limite: 0 };
    state.data.apps         = data.apps         || data.appsMonitorados || [];

    applyBranding(state.data.branding);
    renderKPIs();
    renderLiveStrip();
    renderEventsList();
    // renderFuncionarios() virá no C4

    setSystemStatus('online', 'Online');
  } catch (err) {
    state.error = err.message || String(err);
    console.error('[loadData]', err);
    setSystemStatus('error', 'Offline');
    toast('Erro ao carregar: ' + state.error, 'error');
  } finally {
    state.isLoading = false;
  }
}

// ===========================================================================
// 17. AUTO-REFRESH (com awareness de visibilidade)
// ===========================================================================
function startAutoRefresh() {
  stopAutoRefresh();
  state.refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') loadData();
  }, CONFIG.REFRESH_INTERVAL_MS);
}
function stopAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

// ===========================================================================
// 18. BIND EVENTS
// ===========================================================================
function bindEvents() {
  // Navegação sidebar
  dom.navItems.forEach(n => {
    n.addEventListener('click', () => activateSection(n.dataset.section));
  });

  // Tabs
  dom.tabs.forEach(t => {
    t.addEventListener('click', () => setActiveTab(t.dataset.tab));
  });

  // Severity pills
  if (dom.severityPills) {
    dom.severityPills.addEventListener('click', (e) => {
      const p = e.target.closest('.pill'); if (!p) return;
      setSeverityFilter(p.dataset.severity);
    });
  }

  // Search
  if (dom.searchInput) {
    let to;
    dom.searchInput.addEventListener('input', (e) => {
      clearTimeout(to);
      to = setTimeout(() => {
        state.search = e.target.value || '';
        renderEventsList();
      }, 200);
    });
  }

  // Range
  if (dom.rangeSelect) {
    dom.rangeSelect.addEventListener('change', (e) => {
      state.range = e.target.value;
      renderEventsList();
    });
  }

  // Refresh
  if (dom.btnRefresh) dom.btnRefresh.addEventListener('click', () => loadData());

  // Theme
  if (dom.btnTheme) dom.btnTheme.addEventListener('click', toggleTheme);

  // User menu
  if (dom.btnUserMenu) {
    dom.btnUserMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.userDropdown.hidden = !dom.userDropdown.hidden;
    });
    document.addEventListener('click', () => { if (dom.userDropdown) dom.userDropdown.hidden = true; });
  }
  if (dom.btnLogout) dom.btnLogout.addEventListener('click', doLogout);

  // Drawer — fechar (X + backdrop + ESC)
  if (dom.detailDrawer) {
    dom.detailDrawer.addEventListener('click', (e) => {
      if (e.target.closest('[data-close], .drawer__close')) closeDetailDrawer();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.detailDrawer.hidden) closeDetailDrawer();
  });

  // Drawer — copiar JSON
  if (dom.detailDrawerCopyBtn) dom.detailDrawerCopyBtn.addEventListener('click', copyDetailJson);

  // Visibilidade da aba — refresh ao voltar
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadData();
  });

  // Atalhos
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'r' || e.key === 'R') loadData();
    if (e.key === '1') activateSection('dashboard');
    if (e.key === '2') activateSection('eventos');
    if (e.key === '3') activateSection('funcionarios');
  });
}

// ===========================================================================
// 19. INIT (parcial — finalizado no C4)
// ===========================================================================
function initBase() {
  // Tema
  loadTheme();

  // Token / user
  state.token = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN);
  try {
    const userJson = localStorage.getItem(CONFIG.STORAGE_KEYS.USER);
    state.user = userJson ? JSON.parse(userJson) : null;
  } catch { state.user = null; }

  if (dom.userName && state.user?.nome) dom.userName.textContent = state.user.nome;

  // UI defaults
  state.range = dom.rangeSelect?.value || '24h';

  // Branding placeholder enquanto carrega
  applyBranding(state.data.branding);

  // Bindings
  bindEvents();

  // Carga inicial + auto-refresh
  loadData().then(() => startAutoRefresh());
}

// Inicia ao carregar (parte 2 vai sobrescrever este boot com versão completa)
window.addEventListener('DOMContentLoaded', initBase);

// Exporta para a parte 2 poder estender
window.__clientApp = { state, dom, CONFIG, apiPost, apiGet, toast, _esc, fmtDateTime, fmtRelativeTime, loadData };

/* =============================================================================
   client.js — Portal do Cliente — Parte 2/2
   ESTENDE a parte 1 (acrescentar ao final do mesmo arquivo)
   Adiciona: funcionários (CRUD), modal quota, exports CSV/PDF, init final
   ============================================================================= */

// ===========================================================================
// 20. FUNCIONÁRIOS — render da tabela
// ===========================================================================
function renderFuncionarios() {
  if (!dom.funcionariosTbody) return;

  const q = (dom.funcSearch?.value || '').trim().toLowerCase();
  const list = (state.data.funcionarios || []).filter(f => {
    if (!q) return true;
    return JSON.stringify(f).toLowerCase().includes(q);
  });

  // Atualiza info de quota no toolbar
  const k = calcKPIs();
  if (dom.funcQuotaInfo) {
    dom.funcQuotaInfo.textContent = `${k.quotaUsada} de ${k.quotaLimite || '—'} utilizados`;
  }

  if (!list.length) {
    dom.funcionariosTbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum funcionário encontrado</td></tr>`;
    return;
  }

  dom.funcionariosTbody.innerHTML = list.map((f, idx) => {
    const status = String(f.status || 'ATIVO').toUpperCase();
    const apps = Array.isArray(f.apps)
      ? f.apps
      : (typeof f.apps === 'string' ? f.apps.split(/[,;]/).map(s => s.trim()).filter(Boolean) : []);
    const appsHtml = apps.map(a => `<span class="app-chip">${_esc(a)}</span>`).join('') || '<span style="color:var(--color-text-muted,#9ca3af);">—</span>';
    const ultimoAcesso = f.ultimoAcesso || f.lastSeen || f.ultimoLogin;

    return `
      <tr data-idx="${idx}" data-usuario="${_esc(f.usuario || '')}">
        <td><strong>${_esc(f.nome || '—')}</strong></td>
        <td><code>${_esc(f.usuario || '—')}</code></td>
        <td>${appsHtml}</td>
        <td><span class="badge-status" data-status="${status}">${status}</span></td>
        <td style="font-size:12px;color:var(--color-text-muted,#6b7280);">
          ${_esc(ultimoAcesso ? fmtRelativeTime(ultimoAcesso) : 'Nunca')}
        </td>
        <td>
          <div class="row-actions">
            <button type="button" data-action="edit" title="Editar">✏️</button>
            <button type="button" data-action="toggle" title="${status === 'ATIVO' ? 'Desativar' : 'Reativar'}">
              ${status === 'ATIVO' ? '🚫' : '✅'}
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  // Bind row actions

  $$('tr', dom.funcionariosTbody).forEach(tr => {
    const idx = parseInt(tr.dataset.idx, 10);
    if (Number.isNaN(idx)) return;
    const f = list[idx];
    if (!f) return;

    tr.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openFuncionarioModal(f);
    });
    tr.querySelector('[data-action="toggle"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFuncionarioStatus(f);
    });
  });
}

// ===========================================================================
// 21. FUNCIONÁRIOS — modal create / edit
// ===========================================================================
function openFuncionarioModal(funcionario = null) {
  const isEdit = !!funcionario;
  const form = dom.formFuncionario;
  if (!form || !dom.modalFuncionario) return;

  form.reset();

  // Título
  if (dom.modalFuncTitle) {
    dom.modalFuncTitle.textContent = isEdit ? 'Editar Funcionário' : 'Novo Funcionário';
  }

  // Senha: obrigatória ao criar, opcional ao editar
  const senhaInput = form.querySelector('#funcSenha');
  const senhaHint  = form.querySelector('#funcSenhaHint');
  if (senhaInput) {
    senhaInput.required = !isEdit;
    if (senhaHint) {
      senhaHint.textContent = isEdit ? '(deixe em branco para manter a atual)' : '(min. 8 caracteres)';
    }
  }

  // Usuário: read-only ao editar (é a chave)
  const usuarioInput = form.querySelector('#funcUsuario');
  if (usuarioInput) usuarioInput.readOnly = isEdit;

  if (isEdit) {
    form.querySelector('#funcId').value       = funcionario.usuario || '';
    form.querySelector('#funcNome').value     = funcionario.nome || '';
    form.querySelector('#funcUsuario').value  = funcionario.usuario || '';
    form.querySelector('#funcEmail').value    = funcionario.email || '';
    form.querySelector('#funcTelefone').value = funcionario.telefone || '';
    form.querySelector('#funcStatus').value   = String(funcionario.status || 'ATIVO').toUpperCase();

    // Apps (checkboxes)
    const apps = Array.isArray(funcionario.apps)
      ? funcionario.apps
      : (typeof funcionario.apps === 'string' ? funcionario.apps.split(/[,;]/).map(s => s.trim()).filter(Boolean) : []);
    form.querySelectorAll('input[name="apps"]').forEach(cb => {
      cb.checked = apps.includes(cb.value);
    });
  }

  dom.modalFuncionario.hidden = false;
  dom.modalFuncionario.setAttribute('aria-hidden', 'false');
  setTimeout(() => form.querySelector('#funcNome')?.focus(), 50);
}

function closeFuncionarioModal() {
  if (!dom.modalFuncionario) return;
  dom.modalFuncionario.hidden = true;
  dom.modalFuncionario.setAttribute('aria-hidden', 'true');
}

async function submitFuncionarioForm(e) {
  e.preventDefault();
  const form = dom.formFuncionario;
  if (!form) return;

  const id        = form.querySelector('#funcId').value.trim();
  const isEdit    = !!id;
  const nome      = form.querySelector('#funcNome').value.trim();
  const usuario   = form.querySelector('#funcUsuario').value.trim();
  const email     = form.querySelector('#funcEmail').value.trim();
  const telefone  = form.querySelector('#funcTelefone').value.trim();
  const senha     = form.querySelector('#funcSenha').value;
  const status    = form.querySelector('#funcStatus').value;
  const apps      = $$('input[name="apps"]:checked', form).map(cb => cb.value);

  // Validação client-side
  if (!nome || nome.length < 2) {
    toast('Nome inválido', 'error'); return;
  }
  if (!isEdit && !/^[a-zA-Z0-9._-]+$/.test(usuario)) {
    toast('Usuário inválido (somente letras, números, ._-)', 'error'); return;
  }
  if (!isEdit && senha.length < 8) {
    toast('Senha precisa ter ao menos 8 caracteres', 'error'); return;
  }
  if (!apps.length) {
    toast('Selecione ao menos um app', 'error'); return;
  }

  // Anti-duplicata (criação)
  if (!isEdit) {
    const dup = (state.data.funcionarios || []).some(f => String(f.usuario||'').toLowerCase() === usuario.toLowerCase());
    if (dup) { toast('Já existe um funcionário com esse usuário', 'error'); return; }

    // Quota
    const k = calcKPIs();
    if (k.quotaLimite > 0 && k.quotaUsada >= k.quotaLimite) {
      toast('Quota de funcionários atingida. Solicite aumento.', 'warning');
      return;
    }
  }

  const btn = form.querySelector('#btnSalvarFuncionario');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }

  try {
    const payload = {
      nome, usuario, email, telefone, status, apps,
    };
    if (senha) payload.senha = senha;

    if (isEdit) {
      await apiPost('atualizarFuncionario', { ...payload, usuarioOriginal: id });
      toast('Funcionário atualizado', 'success');
    } else {
      await apiPost('criarFuncionario', payload);
      toast('Funcionário criado', 'success');
    }

    closeFuncionarioModal();
    await loadData();
    renderFuncionarios();
  } catch (err) {
    toast('Falha ao salvar: ' + (err.message || err), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
  }
}

async function toggleFuncionarioStatus(f) {
  const status = String(f.status || 'ATIVO').toUpperCase();
  const novo = status === 'ATIVO' ? 'INATIVO' : 'ATIVO';
  const verbo = novo === 'ATIVO' ? 'reativar' : 'desativar';
  if (!confirm(`Deseja ${verbo} ${f.nome || f.usuario}?`)) return;

  try {
    if (novo === 'INATIVO') {
      // soft-delete
      await apiPost('removerFuncionario', { usuario: f.usuario });
    } else {
      await apiPost('atualizarFuncionario', {
        usuarioOriginal: f.usuario,
        usuario: f.usuario,
        nome: f.nome,
        email: f.email || '',
        telefone: f.telefone || '',
        status: 'ATIVO',
        apps: Array.isArray(f.apps) ? f.apps : [],
      });
    }
    toast(`Funcionário ${verbo === 'desativar' ? 'desativado' : 'reativado'}`, 'success');
    await loadData();
    renderFuncionarios();
  } catch (err) {
    toast('Falha: ' + (err.message || err), 'error');
  }
}

// ===========================================================================
// 22. QUOTA — solicitar aumento
// ===========================================================================
function openQuotaModal() {
  if (!dom.modalQuota || !dom.formQuota) return;

  dom.formQuota.reset();
  const k = calcKPIs();
  if (dom.quotaAtualInfo) dom.quotaAtualInfo.textContent = String(k.quotaLimite || '—');

  // Sugere +5 da atual
  const inp = dom.formQuota.querySelector('#quotaSolicitada');
  if (inp) inp.value = (k.quotaLimite || 5) + 5;

  dom.modalQuota.hidden = false;
  dom.modalQuota.setAttribute('aria-hidden', 'false');
}

function closeQuotaModal() {
  if (!dom.modalQuota) return;
  dom.modalQuota.hidden = true;
  dom.modalQuota.setAttribute('aria-hidden', 'true');
}

async function submitQuotaForm(e) {
  e.preventDefault();
  const form = dom.formQuota;
  if (!form) return;

  const quotaSolicitada = parseInt(form.querySelector('#quotaSolicitada').value, 10);
  const justificativa = form.querySelector('#quotaJustificativa').value.trim();

  if (!Number.isFinite(quotaSolicitada) || quotaSolicitada < 1 || quotaSolicitada > 500) {
    toast('Quota solicitada inválida (1-500)', 'error'); return;
  }
  if (justificativa.length < 10) {
    toast('Justificativa muito curta (min. 10 caracteres)', 'error'); return;
  }

  const k = calcKPIs();
  if (quotaSolicitada <= (k.quotaLimite || 0)) {
    toast('A quota solicitada deve ser maior que a atual', 'warning'); return;
  }

  const btn = form.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }

  try {
    await apiPost('solicitarAumentoQuota', {
      quotaSolicitada,
      justificativa,
    });
    toast('Solicitação enviada. Aguarde aprovação.', 'success');
    closeQuotaModal();
  } catch (err) {
    toast('Falha ao enviar: ' + (err.message || err), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar solicitação'; }
  }
}

// ===========================================================================
// 23. EXPORTS — CSV / PDF
// ===========================================================================
function _csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
}

function _getCurrentEventsForExport() {
  const tab = state.activeTab;
  const items = getFilteredEvents()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  let columns = [];
  let rows = [];

  if (tab === 'logs') {
    columns = ['Quando', 'Aplicativo', 'Usuário', 'Tipo', 'Status', 'Mensagem', 'Dispositivo'];
    rows = items.map(l => [
      fmtDateTime(l.timestamp),
      l.aplicativo || '',
      l.usuario || '',
      String(l.tipoLog || '').toUpperCase(),
      String(l.status || 'ABERTO').toUpperCase(),
      l.mensagemErro || '',
      l.dispositivo || '',
    ]);
  } else if (tab === 'auth') {
    columns = ['Quando', 'Usuário', 'Aplicativo', 'Resultado', 'IP', 'User-Agent'];
    rows = items.map(a => {
      const sucesso = !/falha|erro|false/i.test(String(a.sucesso ?? a.resultado ?? ''));
      return [
        fmtDateTime(a.timestamp),
        a.usuario || '',
        a.aplicativo || '',
        sucesso ? 'SUCESSO' : 'FALHA',
        a.ip || '',
        a.userAgent || '',
      ];
    });
  } else if (tab === 'sessoes') {
    columns = ['Início', 'Usuário', 'Aplicativo', 'Status', 'Dispositivo', 'IP'];
    rows = items.map(s => {
      const ativa = String(s.status||'').toUpperCase() === 'ATIVA' || s.online;
      return [
        fmtDateTime(s.timestamp || s.inicio),
        s.usuario || '',
        s.aplicativo || '',
        ativa ? 'ONLINE' : 'OFFLINE',
        s.dispositivo || '',
        s.ip || '',
      ];
    });
  }

  return { columns, rows, tab };
}

function exportCSV() {
  const { columns, rows, tab } = _getCurrentEventsForExport();
  if (!rows.length) { toast('Nada para exportar', 'warning'); return; }

  const lines = [
    columns.map(_csvEscape).join(','),
    ...rows.map(r => r.map(_csvEscape).join(',')),
  ];
  // BOM para Excel reconhecer UTF-8
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  _downloadBlob(blob, `eventos-${tab}-${ts}.csv`);
  toast('CSV exportado', 'success');
}

function exportPDF() {
  const { columns, rows, tab } = _getCurrentEventsForExport();
  if (!rows.length) { toast('Nada para exportar', 'warning'); return; }

  // jsPDF é carregado via UMD em window.jspdf
  const jsPDFCtor = window.jspdf?.jsPDF;
  if (!jsPDFCtor) { toast('jsPDF não carregado', 'error'); return; }

  const doc = new jsPDFCtor({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const brand = state.data.branding || {};
  const title = `${brand.nomeFantasia || 'Painel'} — ${tab.toUpperCase()}`;

  doc.setFontSize(14);
  doc.text(title, 40, 40);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')} · ${rows.length} registros`, 40, 56);

  if (typeof doc.autoTable === 'function') {
    doc.autoTable({
      head: [columns],
      body: rows,
      startY: 70,
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 40, right: 40 },
    });
  } else {
    // Fallback simples se autoTable não estiver presente
    let y = 80;
    doc.setFontSize(9);
    rows.slice(0, 60).forEach(r => {
      doc.text(r.map(c => String(c).slice(0, 30)).join(' | '), 40, y);
      y += 14;
      if (y > 540) { doc.addPage(); y = 40; }
    });
  }

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  doc.save(`eventos-${tab}-${ts}.pdf`);
  toast('PDF exportado', 'success');
}

// ===========================================================================
// 24. PATCH no loadData → renderFuncionarios após cada ciclo
// ===========================================================================
const _origLoadData = loadData;
window.loadData = async function patchedLoadData() {
  await _origLoadData();
  try { renderFuncionarios(); } catch (e) { console.warn('renderFuncionarios:', e); }
};
// Substitui referência local também
// (a referência exportada em window.__clientApp.loadData continua apontando
//  para a original; quem depender pode chamar window.loadData)

// ===========================================================================
// 25. BIND EVENTS — parte 2 (funcionários, quota, exports)
// ===========================================================================
function bindEventsPart2() {
  // Solicitar quota
  if (dom.btnSolicitarQuota) dom.btnSolicitarQuota.addEventListener('click', openQuotaModal);

  // Modal funcionário
  if (dom.btnNovoFuncionario) {
    dom.btnNovoFuncionario.addEventListener('click', () => openFuncionarioModal(null));
  }
  if (dom.formFuncionario) dom.formFuncionario.addEventListener('submit', submitFuncionarioForm);

  // Modal quota
  if (dom.formQuota) dom.formQuota.addEventListener('submit', submitQuotaForm);

  // Busca de funcionários
  if (dom.funcSearch) {
    let to;
    dom.funcSearch.addEventListener('input', () => {
      clearTimeout(to);
      to = setTimeout(() => renderFuncionarios(), 200);
    });
  }

  // Fechar modais (X, backdrop, botões data-close)
  [dom.modalFuncionario, dom.modalQuota].forEach(modal => {
    if (!modal) return;
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-close], .modal__backdrop, .modal__close')) {
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
      }
    });
  });

  // ESC fecha modais abertos
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    [dom.modalFuncionario, dom.modalQuota].forEach(m => {
      if (m && !m.hidden) {
        m.hidden = true;
        m.setAttribute('aria-hidden', 'true');
      }
    });
  });

  // Exports
  if (dom.btnExportCsv) dom.btnExportCsv.addEventListener('click', exportCSV);
  if (dom.btnExportPdf) dom.btnExportPdf.addEventListener('click', exportPDF);
}

// ===========================================================================
// 26. BOOT FINAL — substitui o initBase da parte 1
// ===========================================================================
function initFull() {
  // Tema
  loadTheme();

  // Token / user
  state.token = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN);
  try {
    const userJson = localStorage.getItem(CONFIG.STORAGE_KEYS.USER);
    state.user = userJson ? JSON.parse(userJson) : null;
  } catch { state.user = null; }

  if (dom.userName) {
    dom.userName.textContent = state.user?.nome || state.user?.usuario || 'Usuário';
  }

  // Range default
  state.range = dom.rangeSelect?.value || '24h';

  // Branding placeholder
  applyBranding(state.data.branding);

  // Bindings
  bindEvents();
  bindEventsPart2();

  // Carga inicial + auto-refresh
  loadData()
    .then(() => { renderFuncionarios(); })
    .finally(() => startAutoRefresh());
}

// Remove o listener da parte 1 e instala o boot completo
window.removeEventListener('DOMContentLoaded', initBase);

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initFull);
} else {
  // DOM já pronto (parte 1 já rodou initBase) — só completa
  bindEventsPart2();
  renderFuncionarios();
}
