/**
 * ============================================================================
 * auth.js — Camada de autenticação e sessão
 * ----------------------------------------------------------------------------
 * Responsabilidades:
 *   - Guard de página (redireciona para login se não autenticado).
 *   - Validar token no boot (sliding session).
 *   - Logout (servidor + local).
 *   - Helpers para ler escopo e nível do usuário corrente.
 *   - Detectar role (admin/cliente) sem acoplar com UI.
 * ============================================================================
 */

import { apiPost } from './api.js';
import { STORAGE_KEYS, ROUTES } from './config.js';

/* ----------------------------------------------------------------------------
 * Storage helpers (resilientes — privacy mode pode bloquear localStorage)
 * ------------------------------------------------------------------------- */

function _safeGet(key) {
  try { return localStorage.getItem(key) || ''; }
  catch (_) { return ''; }
}

function _safeSet(key, val) {
  try { localStorage.setItem(key, val == null ? '' : String(val)); }
  catch (_) { /* ignore */ }
}

function _safeRemove(key) {
  try { localStorage.removeItem(key); }
  catch (_) { /* ignore */ }
}

/* ----------------------------------------------------------------------------
 * Leitura de estado de sessão
 * ------------------------------------------------------------------------- */

export function getToken()    { return _safeGet(STORAGE_KEYS.TOKEN); }
export function getUsuario()  { return _safeGet(STORAGE_KEYS.USER); }
export function getNivel()    { return _safeGet(STORAGE_KEYS.NIVEL); }     // 'admin' | 'cliente'
export function getEscopo()   { return _safeGet(STORAGE_KEYS.ESCOPO); }    // '*' | 'crv' | etc.
export function getExpires()  { return _safeGet(STORAGE_KEYS.EXPIRES); }   // ISO string

export function isAuthenticated() {
  return !!getToken();
}

export function isAdmin() {
  return getEscopo() === '*';
}

export function isCliente() {
  const esc = getEscopo();
  return !!esc && esc !== '*';
}

/* ----------------------------------------------------------------------------
 * setSession — grava resultado de login (chamado por login.html via API)
 * ------------------------------------------------------------------------- */
export function setSession(data) {
  if (!data || !data.token) return false;
  _safeSet(STORAGE_KEYS.TOKEN,   data.token);
  _safeSet(STORAGE_KEYS.USER,    data.usuario || '');
  _safeSet(STORAGE_KEYS.NIVEL,   data.nivel || '');
  _safeSet(STORAGE_KEYS.ESCOPO,  data.idClienteVinculado || '');
  _safeSet(STORAGE_KEYS.EXPIRES, data.expiraEm || '');
  return true;
}

/* ----------------------------------------------------------------------------
 * clearSession — remove tudo do localStorage (sem chamar backend)
 * ------------------------------------------------------------------------- */
export function clearSession() {
  _safeRemove(STORAGE_KEYS.TOKEN);
  _safeRemove(STORAGE_KEYS.USER);
  _safeRemove(STORAGE_KEYS.NIVEL);
  _safeRemove(STORAGE_KEYS.ESCOPO);
  _safeRemove(STORAGE_KEYS.EXPIRES);
}

/* ----------------------------------------------------------------------------
 * requireAuth — guard de página
 * ----------------------------------------------------------------------------
 * Coloque NO TOPO do <head> (ou nas primeiras linhas do módulo de boot)
 * para barrar a página antes do paint:
 *
 *   import { requireAuth } from './js/auth.js';
 *   requireAuth();   // redireciona se não tiver token
 *
 * Se quiser barrar tipo de role:
 *   requireAuth({ role: 'admin' })   // só admins
 *   requireAuth({ role: 'cliente' }) // só clientes
 * ------------------------------------------------------------------------- */
export function requireAuth(opts = {}) {
  if (!isAuthenticated()) {
    window.location.replace(ROUTES.LOGIN);
    return false;
  }
  if (opts.role === 'admin' && !isAdmin()) {
    window.location.replace(ROUTES.CLIENT_HOME);
    return false;
  }
  if (opts.role === 'cliente' && !isCliente()) {
    window.location.replace(ROUTES.ADMIN_HOME);
    return false;
  }
  return true;
}

/* ----------------------------------------------------------------------------
 * validateSessionOnBoot — chama o backend para confirmar token
 * ----------------------------------------------------------------------------
 * Se o token expirou ou foi revogado server-side, limpa local e redireciona.
 * Se está válido, atualiza ultimoUso (sliding session) automaticamente.
 *
 * Retorna o objeto { usuario, nivel, idClienteVinculado, expiraEm } ou null.
 * ------------------------------------------------------------------------- */
export async function validateSessionOnBoot() {
  if (!isAuthenticated()) {
    redirectToLogin();
    return null;
  }

  const r = await apiPost('validatesession', {}, { timeoutMs: 10000 });

  if (!r || !r.ok) {
    // Token inválido/expirado — limpa e manda pro login
    clearSession();
    redirectToLogin();
    return null;
  }

  // Atualiza dados locais com a verdade do backend (caso tenham mudado)
  if (r.data) {
    _safeSet(STORAGE_KEYS.USER,    r.data.usuario || getUsuario());
    _safeSet(STORAGE_KEYS.NIVEL,   r.data.nivel || getNivel());
    _safeSet(STORAGE_KEYS.ESCOPO,  r.data.idClienteVinculado || getEscopo());
    _safeSet(STORAGE_KEYS.EXPIRES, r.data.expiraEm || getExpires());
  }

  return r.data || null;
}

/* ----------------------------------------------------------------------------
 * logout — encerra sessão (servidor + local) e redireciona
 * ----------------------------------------------------------------------------
 * Sempre limpa local mesmo se o servidor falhar — se o usuário clicou em
 * "sair", ele precisa sair, ponto. Falha de rede não pode prendê-lo.
 * ------------------------------------------------------------------------- */
export async function logout() {
  try {
    if (getToken()) {
      // Best-effort: tenta avisar o backend, mas não bloqueia
      await apiPost('logoutgodmode', {}, { timeoutMs: 5000 });
    }
  } catch (_) { /* ignore */ }
  clearSession();
  redirectToLogin();
}

/* ----------------------------------------------------------------------------
 * redirectToLogin / redirectToHome — helpers de navegação
 * ------------------------------------------------------------------------- */
export function redirectToLogin() {
  // replace() para não poluir histórico (botão voltar não traz pra cá)
  window.location.replace(ROUTES.LOGIN);
}

export function redirectToHome() {
  if (isAdmin())   { window.location.replace(ROUTES.ADMIN_HOME);  return; }
  if (isCliente()) { window.location.replace(ROUTES.CLIENT_HOME); return; }
  redirectToLogin();
}

/* ----------------------------------------------------------------------------
 * getUserContext — snapshot do contexto atual (útil pra debug/UI)
 * ------------------------------------------------------------------------- */
export function getUserContext() {
  return {
    autenticado: isAuthenticated(),
    usuario: getUsuario(),
    nivel: getNivel(),
    escopo: getEscopo(),
    isAdmin: isAdmin(),
    isCliente: isCliente(),
    expiraEm: getExpires(),
  };
}
