/**
 * ============================================================================
 * config.js — Constantes globais do God Mode Central
 * ----------------------------------------------------------------------------
 * Único lugar onde se altera URL do Apps Script, chaves, timers e versão.
 * Importado por todos os outros módulos (api, auth, admin, client).
 * ============================================================================
 */

export const APP_VERSION = 'v2.2';
export const APP_BUILD = '2026-05-03';

/* ----------------------------------------------------------------------------
 * Backend (Google Apps Script)
 * ------------------------------------------------------------------------- */
export const SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzqjZtyCn7X1lWQBSRYLwW-MijJN53YLPoHJrjjBh5y6P1kTaBATNpAV13KV9OgNYPx/exec';

export const API_KEY = 'ee91297b-685b-4ae4-b131-8434841c882e';

/* ----------------------------------------------------------------------------
 * LocalStorage keys (centralizadas para evitar typos espalhados)
 * ------------------------------------------------------------------------- */
export const STORAGE_KEYS = Object.freeze({
  TOKEN:    'gm_token',
  USER:     'gm_user',
  NIVEL:    'gm_nivel',
  ESCOPO:   'gm_escopo',     // '*' = admin; 'crv' = cliente CRV; etc.
  EXPIRES:  'gm_expires',
  THEME:    'gm_theme',      // 'light' | 'dark'
});

/* ----------------------------------------------------------------------------
 * Rotas de página (para redirects)
 * ------------------------------------------------------------------------- */
export const ROUTES = Object.freeze({
  LOGIN:        './login.html',
  ADMIN_HOME:   './index.html',
  CLIENT_HOME:  './client.html',
});

/* ----------------------------------------------------------------------------
 * Auto-refresh do dashboard (ms)
 * ------------------------------------------------------------------------- */
export const REFRESH_INTERVAL_MS = 30 * 1000;       // 30 s
export const HEARTBEAT_INTERVAL_MS = 45 * 1000;     // 45 s

/* ----------------------------------------------------------------------------
 * Limites de UI / paginação
 * ------------------------------------------------------------------------- */
export const UI_LIMITS = Object.freeze({
  LOGS_VISIVEIS:        100,
  EVENTOS_AUTH_VISIVEIS:100,
  SESSOES_VISIVEIS:     50,
  FUNCIONARIOS_VISIVEIS:200,
  CHIP_NOME_MAX_CHARS:  18,
});

/* ----------------------------------------------------------------------------
 * Severidades (mantém alinhado com backend)
 * ------------------------------------------------------------------------- */
export const SEVERIDADES = Object.freeze({
  ERRO:    'erro',
  ALERTA:  'alerta',
  INFO:    'info',
});

/* ----------------------------------------------------------------------------
 * Apps suportados (alinhado com CONFIG.APPS_VALIDOS do backend)
 * ------------------------------------------------------------------------- */
export const APPS_SUPORTADOS = Object.freeze(['ponto', 'estoque']);

/* ----------------------------------------------------------------------------
 * Tema (default ao carregar pela primeira vez)
 * ------------------------------------------------------------------------- */
export const THEME_DEFAULT = 'light';
