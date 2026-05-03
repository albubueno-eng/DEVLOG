/**
 * ============================================================================
 * api.js — Camada de comunicação com o backend (Apps Script)
 * ----------------------------------------------------------------------------
 * Características:
 *   - POST com text/plain (evita preflight CORS no Apps Script).
 *   - GET com query string montada de forma segura.
 *   - Timeout configurável (AbortController).
 *   - Tratamento padronizado de erro: SEMPRE retorna { ok, data?, error? }.
 *   - Token automaticamente injetado quando disponível (auth wrapper).
 *   - Nunca lança exceção fora — captura tudo e devolve { ok:false }.
 * ============================================================================
 */

import { SCRIPT_URL, API_KEY, STORAGE_KEYS } from './config.js';

const DEFAULT_TIMEOUT_MS = 20000; // 20 s

/* ----------------------------------------------------------------------------
 * Helpers internos
 * ------------------------------------------------------------------------- */

function _getToken() {
  try { return localStorage.getItem(STORAGE_KEYS.TOKEN) || ''; }
  catch (_) { return ''; }
}

function _buildQueryString(params) {
  if (!params || typeof params !== 'object') return '';
  const partes = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])));
  return partes.length ? '?' + partes.join('&') : '';
}

function _withTimeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(id) };
}

async function _safeJson(response) {
  try {
    const txt = await response.text();
    if (!txt) return { ok: false, error: 'Resposta vazia do servidor' };
    try { return JSON.parse(txt); }
    catch (_) { return { ok: false, error: 'Resposta não é JSON válido', raw: txt.slice(0, 300) }; }
  } catch (err) {
    return { ok: false, error: 'Falha ao ler resposta: ' + (err && err.message || err) };
  }
}

/* ----------------------------------------------------------------------------
 * apiPost — chamada principal para todas as actions do backend
 * ----------------------------------------------------------------------------
 * @param {string} action       — nome da action (ex: 'logingodmode')
 * @param {object} payload      — corpo da requisição (NÃO inclua apiKey/token)
 * @param {object} [opts]
 *   - withToken (bool, default true): injeta token do localStorage se disponível
 *   - timeoutMs (number): timeout em ms (default 20s)
 *
 * @returns {Promise<{ok:boolean, data?:any, error?:string}>}
 * ------------------------------------------------------------------------- */
export async function apiPost(action, payload = {}, opts = {}) {
  const withToken = opts.withToken !== false;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  const body = {
    action: String(action || '').toLowerCase(),
    apiKey: API_KEY,
    ...payload,
  };

  if (withToken) {
    const tk = _getToken();
    if (tk && !body.token) body.token = tk;
  }

  const t = _withTimeout(timeoutMs);

  try {
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      // text/plain evita preflight CORS no Apps Script
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
      signal: t.signal,
      redirect: 'follow',
      mode: 'cors',
      credentials: 'omit',
    });
    t.cancel();

    if (!response.ok) {
      return { ok: false, error: 'HTTP ' + response.status + ' ' + response.statusText };
    }

    const json = await _safeJson(response);
    return json;
  } catch (err) {
    t.cancel();
    if (err && err.name === 'AbortError') {
      return { ok: false, error: 'Timeout: servidor demorou mais de ' + (timeoutMs / 1000) + 's' };
    }
    return { ok: false, error: 'Falha de rede: ' + (err && err.message || err) };
  }
}

/* ----------------------------------------------------------------------------
 * apiGet — chamada GET (usada apenas para o dashboard consolidado)
 * ----------------------------------------------------------------------------
 * @param {object} [params]    — query string. Se withToken=true e houver token
 *                               no localStorage, ele é adicionado automaticamente.
 * @param {object} [opts]      — { withToken (default true), withApiKey (default false), timeoutMs }
 * ------------------------------------------------------------------------- */
export async function apiGet(params = {}, opts = {}) {
  const withToken = opts.withToken !== false;
  const withApiKey = opts.withApiKey === true;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  const qs = { ...params };
  if (withToken) {
    const tk = _getToken();
    if (tk && !qs.token) qs.token = tk;
  }
  if (withApiKey && !qs.apiKey) qs.apiKey = API_KEY;

  const url = SCRIPT_URL + _buildQueryString(qs);
  const t = _withTimeout(timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: t.signal,
      redirect: 'follow',
      mode: 'cors',
      credentials: 'omit',
    });
    t.cancel();

    if (!response.ok) {
      return { ok: false, error: 'HTTP ' + response.status + ' ' + response.statusText };
    }

    const json = await _safeJson(response);
    return json;
  } catch (err) {
    t.cancel();
    if (err && err.name === 'AbortError') {
      return { ok: false, error: 'Timeout: servidor demorou mais de ' + (timeoutMs / 1000) + 's' };
    }
    return { ok: false, error: 'Falha de rede: ' + (err && err.message || err) };
  }
}

/* ----------------------------------------------------------------------------
 * apiHealthcheck — pinga o backend rapidamente (timeout curto)
 * ------------------------------------------------------------------------- */
export async function apiHealthcheck() {
  const r = await apiGet({}, { withToken: false, withApiKey: false, timeoutMs: 5000 });
  // O backend responde "Não autenticado" sem token/apiKey — isso é sinal de
  // que ele está vivo. Qualquer JSON parseável já basta.
  return { ok: !!r, data: r };
}
