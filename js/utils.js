/**
 * ============================================================================
 * utils.js — Utilitários puros (sem side effects, sem DOM dependency externa)
 * ----------------------------------------------------------------------------
 * Conteúdo:
 *   1. Datas/tempo: relativeTime, formatDate, isWithinHours
 *   2. Strings: truncate, escapeHtml, slugify, initials
 *   3. Mascaramento (LGPD): maskCpf, maskCnpj, maskEmail
 *   4. Avatar: gradientFromString
 *   5. Performance: debounce, throttle
 *   6. Misc: clamp, formatNumber, percent, pluralize, uuid
 *   7. CSV: toCsvCell, arrayToCsv
 * ============================================================================
 */

/* ============================================================================
 * 1) DATAS / TEMPO
 * ========================================================================= */

/**
 * Tempo relativo curto, em pt-BR. Ex: "agora", "5 min", "2 h", "ontem", "há 3d".
 */
export function relativeTime(input) {
  if (!input) return '—';
  const d = (input instanceof Date) ? input : new Date(input);
  if (isNaN(d.getTime())) return '—';

  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return 'agora';

  const sec = Math.floor(diffMs / 1000);
  if (sec < 30) return 'agora';
  if (sec < 60) return sec + ' s';

  const min = Math.floor(sec / 60);
  if (min < 60) return min + ' min';

  const h = Math.floor(min / 60);
  if (h < 24) return h + ' h';

  const dia = Math.floor(h / 24);
  if (dia === 1) return 'ontem';
  if (dia < 7) return 'há ' + dia + 'd';

  // Acima de 7 dias, mostra a data curta
  return formatDate(d, 'DD/MM');
}

/**
 * Formata data com tokens simples: YYYY MM DD HH mm ss
 * Ex: formatDate(d, 'DD/MM/YYYY HH:mm') → '03/05/2026 14:32'
 */
export function formatDate(input, mask = 'DD/MM/YYYY HH:mm') {
  if (!input) return '';
  const d = (input instanceof Date) ? input : new Date(input);
  if (isNaN(d.getTime())) return '';

  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const map = {
    YYYY: d.getFullYear(),
    MM:   pad(d.getMonth() + 1),
    DD:   pad(d.getDate()),
    HH:   pad(d.getHours()),
    mm:   pad(d.getMinutes()),
    ss:   pad(d.getSeconds()),
  };
  return mask.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => map[t]);
}

/**
 * Está dentro das últimas N horas?
 */
export function isWithinHours(input, hours) {
  if (!input) return false;
  const d = (input instanceof Date) ? input : new Date(input);
  if (isNaN(d.getTime())) return false;
  return (Date.now() - d.getTime()) <= (hours * 60 * 60 * 1000);
}

/**
 * Calcula duração legível entre duas datas. Ex: "2h 15min", "3d 4h".
 */
export function durationBetween(from, to = new Date()) {
  const a = (from instanceof Date) ? from : new Date(from);
  const b = (to instanceof Date)   ? to   : new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return '—';

  let diff = Math.max(0, b.getTime() - a.getTime());
  const dias = Math.floor(diff / (24 * 3600 * 1000)); diff -= dias * 24 * 3600 * 1000;
  const horas = Math.floor(diff / (3600 * 1000));     diff -= horas * 3600 * 1000;
  const min = Math.floor(diff / 60000);

  if (dias > 0)  return dias + 'd ' + horas + 'h';
  if (horas > 0) return horas + 'h ' + min + 'min';
  if (min > 0)   return min + 'min';
  return '<1min';
}

/* ============================================================================
 * 2) STRINGS
 * ========================================================================= */

export function truncate(str, max = 60, suffix = '…') {
  const s = String(str || '');
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - suffix.length)) + suffix;
}

/**
 * Escapa HTML para inserção segura via textContent ou innerHTML.
 * Sempre prefira textContent quando possível; use isso só quando inevitável.
 */
export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Iniciais para avatar. "João da Silva" → "JS"; "godman" → "GO".
 */
export function initials(name, max = 2) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const partes = s.split(/\s+/).filter(Boolean);
  if (partes.length === 1) return partes[0].slice(0, max).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/* ============================================================================
 * 3) MASCARAMENTO (LGPD)
 * ========================================================================= */

/** 12345678901 → 123.***.***-01 */
export function maskCpf(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return '';
  return d.slice(0, 3) + '.***.***-' + d.slice(9, 11);
}

/** Sem máscara (admin): 12345678901 → 123.456.789-01 */
export function formatCpf(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return String(cpf || '');
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9, 11);
}


export function maskCnpj(cnpj) {
  const d = String(cnpj || '').replace(/\D/g, '');
  if (d.length !== 14) return '';
  return d.slice(0, 2) + '.***.***/' + d.slice(8, 10) + '-' + d.slice(12, 14);
}

/** Sem máscara: 12345678000199 → 12.345.678/0001-99 */
export function formatCnpj(cnpj) {
  const d = String(cnpj || '').replace(/\D/g, '');
  if (d.length !== 14) return String(cnpj || '');
  return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12, 14);
}

/** joao.silva@empresa.com → j***a@empresa.com */
export function maskEmail(email) {
  const s = String(email || '').trim();
  const at = s.indexOf('@');
  if (at < 2) return s;
  const user = s.slice(0, at);
  const dom = s.slice(at);
  if (user.length <= 2) return user[0] + '*' + dom;
  return user[0] + '***' + user[user.length - 1] + dom;
}

/* ============================================================================
 * 4) AVATAR — gradiente determinístico a partir de string
 * ========================================================================= */

/**
 * Gera CSS de gradiente baseado em hash da string. Mesma string = mesma cor.
 * Útil para avatares de usuários sem foto.
 */
export function gradientFromString(str) {
  const s = String(str || '?');
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 40) % 360;
  return 'linear-gradient(135deg, hsl(' + h1 + ',55%,50%), hsl(' + h2 + ',60%,42%))';
}

/* ============================================================================
 * 5) PERFORMANCE — debounce / throttle
 * ========================================================================= */

export function debounce(fn, wait = 300) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function throttle(fn, wait = 300) {
  let lastCall = 0;
  let pendingArgs = null;
  let pendingTimer = null;
  return function (...args) {
    const now = Date.now();
    const remaining = wait - (now - lastCall);
    if (remaining <= 0) {
      lastCall = now;
      fn.apply(this, args);
    } else {
      pendingArgs = args;
      if (!pendingTimer) {
        pendingTimer = setTimeout(() => {
          lastCall = Date.now();
          pendingTimer = null;
          fn.apply(this, pendingArgs);
        }, remaining);
      }
    }
  };
}

/* ============================================================================
 * 6) MISC
 * ========================================================================= */

export function clamp(n, min, max) {
  n = Number(n);
  if (isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}

/**
 * Formata número com separador de milhar pt-BR. 1234567 → '1.234.567'
 */
export function formatNumber(n, decimals = 0) {
  const num = Number(n);
  if (isNaN(num)) return '0';
  try {
    return num.toLocaleString('pt-BR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch (_) {
    return num.toFixed(decimals);
  }
}

export function percent(parte, total, decimals = 0) {
  const t = Number(total);
  if (!t) return '0%';
  const p = (Number(parte) / t) * 100;
  return formatNumber(p, decimals) + '%';
}

export function pluralize(n, singular, plural) {
  return Number(n) === 1 ? singular : (plural || (singular + 's'));
}

/**
 * UUID v4 fallback (caso crypto.randomUUID não exista no browser).
 */
export function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback simples
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ============================================================================
 * 7) CSV
 * ========================================================================= */

/**
 * Escapa célula para CSV (aspas duplas, vírgulas, quebras de linha).
 */
export function toCsvCell(val) {
  const s = String(val == null ? '' : val);
  if (/[",\n;]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Converte array de objetos para CSV, mantendo ordem dos headers.
 */
export function arrayToCsv(rows, headers) {
  if (!rows || !rows.length) return (headers || []).join(',') + '\n';
  const heads = headers || Object.keys(rows[0]);
  const linhas = [heads.join(',')];
  rows.forEach(r => {
    linhas.push(heads.map(h => toCsvCell(r[h])).join(','));
  });
  return linhas.join('\n');
}

/* ============================================================================
 * 8) DOM helpers leves (opcionais — só usar quando há document)
 * ========================================================================= */

/**
 * Atalho seguro para getElementById.
 */
export function $(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

/**
 * querySelectorAll → Array (não NodeList) — facilita map/filter.
 */
export function $$(selector, root) {
  if (typeof document === 'undefined') return [];
  const r = root || document;
  return Array.prototype.slice.call(r.querySelectorAll(selector));
}
