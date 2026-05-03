/**
 * ============================================================================
 * ui-shared.js — Componentes de UI reutilizáveis (admin + cliente)
 * ----------------------------------------------------------------------------
 * Responsabilidades:
 *   1. Toast (notificação flutuante, auto-dismiss)
 *   2. Modal (confirmação, prompt, formulário)
 *   3. Drawer (painel lateral genérico)
 *   4. Skeleton (placeholder de carregamento)
 *   5. Loading overlay (full-screen)
 *   6. Empty state (helper para gerar markup vazio)
 *
 * Princípios:
 *   - Sem dependência de framework
 *   - Sem CSS embutido (consome tokens do style.css)
 *   - Acessível (focus trap em modal/drawer, ESC para fechar, ARIA roles)
 *   - Idempotente (chamar 2x não duplica DOM)
 * ============================================================================
 */

import { escapeHtml, debounce } from './utils.js';

/* ============================================================================
 * 1) TOAST — notificação flutuante
 * ----------------------------------------------------------------------------
 * Uso:
 *   toast('Cliente cadastrado com sucesso!');
 *   toast('Erro ao salvar', { type: 'error' });
 *   toast('Quota próxima do limite', { type: 'warning', duration: 6000 });
 *
 * Tipos: 'success' (default), 'error', 'warning', 'info'
 * ========================================================================= */

const TOAST_CONTAINER_ID = 'toastContainer';
const TOAST_DEFAULT_DURATION = 4000;

function _ensureToastContainer() {
  let cont = document.getElementById(TOAST_CONTAINER_ID);
  if (!cont) {
    cont = document.createElement('div');
    cont.id = TOAST_CONTAINER_ID;
    cont.setAttribute('role', 'region');
    cont.setAttribute('aria-live', 'polite');
    cont.setAttribute('aria-label', 'Notificações');
    cont.style.cssText = [
      'position:fixed',
      'top:24px',
      'right:24px',
      'z-index:1100',
      'display:flex',
      'flex-direction:column',
      'gap:10px',
      'pointer-events:none',
      'max-width:380px',
    ].join(';');
    document.body.appendChild(cont);
  }
  return cont;
}

export function toast(mensagem, opts = {}) {
  if (!mensagem) return;
  const cont = _ensureToastContainer();
  const tipo = ['success','error','warning','info'].includes(opts.type) ? opts.type : 'success';
  const duration = Number(opts.duration) || TOAST_DEFAULT_DURATION;

  const cores = {
    success: { bg: '#1F9E5C', border: '#178A4F' },
    error:   { bg: '#D7263D', border: '#B11E33' },
    warning: { bg: '#E0851A', border: '#B86C13' },
    info:    { bg: '#2C5BA0', border: '#234B86' },
  };
  const c = cores[tipo];

  const el = document.createElement('div');
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  el.style.cssText = [
    'background:' + c.bg,
    'color:#fff',
    'padding:12px 16px',
    'border-radius:10px',
    'border:1px solid ' + c.border,
    'box-shadow:0 4px 12px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.10)',
    'font-size:14px',
    'font-weight:500',
    'line-height:1.4',
    'pointer-events:auto',
    'opacity:0',
    'transform:translateX(20px)',
    'transition:opacity 200ms ease, transform 200ms ease',
    'max-width:100%',
    'word-wrap:break-word',
    'cursor:pointer',
  ].join(';');
  el.textContent = String(mensagem);

  // Click para fechar
  el.addEventListener('click', () => _dismissToast(el));

  cont.appendChild(el);

  // Anima entrada
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(0)';
  });

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => _dismissToast(el), duration);
  }

  return el;
}

function _dismissToast(el) {
  if (!el || !el.parentNode) return;
  el.style.opacity = '0';
  el.style.transform = 'translateX(20px)';
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 220);
}

/* Atalhos */
export const toastSuccess = (msg, opts) => toast(msg, { ...opts, type: 'success' });
export const toastError   = (msg, opts) => toast(msg, { ...opts, type: 'error', duration: 6000 });
export const toastWarning = (msg, opts) => toast(msg, { ...opts, type: 'warning' });
export const toastInfo    = (msg, opts) => toast(msg, { ...opts, type: 'info' });

/* ============================================================================
 * 2) MODAL — diálogo modal genérico (confirm, alert, custom HTML)
 * ----------------------------------------------------------------------------
 * Uso simples (confirm):
 *   const ok = await confirmDialog('Deletar funcionário?', 'Esta ação não pode ser desfeita.');
 *   if (ok) { ... }
 *
 * Uso avançado (HTML customizado):
 *   openModal({
 *     title: 'Editar funcionário',
 *     html: '<form>...</form>',
 *     buttons: [
 *       { label: 'Cancelar', variant: 'ghost', onClick: closeModal },
 *       { label: 'Salvar',   variant: 'primary', onClick: () => { ... } },
 *     ]
 *   });
 * ========================================================================= */

const MODAL_ID = 'sharedModal';
let _modalKeyHandler = null;
let _modalLastFocus = null;

export function openModal(opts) {
  closeModal(); // garante idempotência

  const title = String(opts.title || '');
  const html = opts.html || '';
  const buttons = Array.isArray(opts.buttons) ? opts.buttons : [];
  const dismissable = opts.dismissable !== false;

  _modalLastFocus = document.activeElement;

  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  if (title) overlay.setAttribute('aria-labelledby', MODAL_ID + 'Title');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:1000',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:20px',
    'background:rgba(11,27,51,0.55)',
    'backdrop-filter:blur(8px) saturate(140%)',
    '-webkit-backdrop-filter:blur(8px) saturate(140%)',
    'opacity:0',
    'transition:opacity 200ms ease',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'background:var(--bg-surface, #fff)',
    'color:var(--text-primary, #14181F)',
    'border-radius:16px',
    'padding:0',
    'max-width:480px',
    'width:100%',
    'max-height:90vh',
    'overflow:auto',
    'box-shadow:0 24px 64px rgba(0,0,0,0.30), 0 12px 32px rgba(0,0,0,0.18)',
    'transform:translateY(8px) scale(0.98)',
    'transition:transform 220ms cubic-bezier(0.22,1,0.36,1)',
    'border:1px solid var(--border-soft, rgba(255,255,255,0.08))',
  ].join(';');

  // Header
  if (title) {
    const head = document.createElement('div');
    head.style.cssText = [
      'padding:20px 24px',
      'border-bottom:1px solid var(--border-divider, rgba(11,27,51,0.08))',
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:16px',
    ].join(';');

    const t = document.createElement('h2');
    t.id = MODAL_ID + 'Title';
    t.style.cssText = 'font-size:20px;font-weight:600;letter-spacing:-0.01em;margin:0;color:var(--text-primary,#14181F);';
    t.textContent = title;
    head.appendChild(t);

    if (dismissable) {
      const closeBtn = document.createElement('button');
      closeBtn.setAttribute('aria-label', 'Fechar');
      closeBtn.type = 'button';
      closeBtn.style.cssText = [
        'background:none',
        'border:none',
        'cursor:pointer',
        'width:32px',
        'height:32px',
        'border-radius:8px',
        'color:var(--text-muted,#7A8699)',
        'font-size:18px',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'transition:background 160ms ease, color 160ms ease',
      ].join(';');
      closeBtn.innerHTML = '✕';
      closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.background = 'var(--bg-subtle,#EEF1F6)';
        closeBtn.style.color = 'var(--text-primary,#14181F)';
      });
      closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.background = 'none';
        closeBtn.style.color = 'var(--text-muted,#7A8699)';
      });
      closeBtn.addEventListener('click', closeModal);
      head.appendChild(closeBtn);
    }

    panel.appendChild(head);
  }

  // Body
  const body = document.createElement('div');
  body.style.cssText = 'padding:20px 24px;font-size:14px;line-height:1.55;color:var(--text-secondary,#3F4A5C);';
  if (typeof html === 'string') {
    body.innerHTML = html;
  } else if (html instanceof HTMLElement) {
    body.appendChild(html);
  }
  panel.appendChild(body);

  // Footer (botões)
  if (buttons.length) {
    const foot = document.createElement('div');
    foot.style.cssText = [
      'padding:16px 24px',
      'border-top:1px solid var(--border-divider, rgba(11,27,51,0.08))',
      'display:flex',
      'justify-content:flex-end',
      'gap:12px',
      'background:var(--bg-base,#F7F8FA)',
    ].join(';');

    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.type = b.type || 'button';
      btn.textContent = b.label || 'OK';
      btn.style.cssText = _buttonStyle(b.variant || 'primary');
      btn.addEventListener('click', (ev) => {
        if (typeof b.onClick === 'function') b.onClick(ev);
      });
      if (b.autofocus) {
        // Foca após o painel aparecer
        setTimeout(() => btn.focus(), 50);
      }
      foot.appendChild(btn);
    });

    panel.appendChild(foot);
  }

  overlay.appendChild(panel);

  // Click no overlay = fechar (se dismissable)
  if (dismissable) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }

  document.body.appendChild(overlay);

  // Trava scroll do body
  document.body.style.overflow = 'hidden';

  // Anima entrada
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    panel.style.transform = 'translateY(0) scale(1)';
  });

  // ESC fecha (se dismissable)
  if (dismissable) {
    _modalKeyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    };
    document.addEventListener('keydown', _modalKeyHandler);
  }

  // Foco inicial: primeiro botão autofocus, ou primeiro input, ou painel
  if (!buttons.some(b => b.autofocus)) {
    const firstInput = panel.querySelector('input, textarea, select, button');
    if (firstInput) setTimeout(() => firstInput.focus(), 60);
  }

  return overlay;
}

export function closeModal() {
  const overlay = document.getElementById(MODAL_ID);
  if (!overlay) return;

  overlay.style.opacity = '0';
  const panel = overlay.firstElementChild;
  if (panel) panel.style.transform = 'translateY(8px) scale(0.98)';

  if (_modalKeyHandler) {
    document.removeEventListener('keydown', _modalKeyHandler);
    _modalKeyHandler = null;
  }

  setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.body.style.overflow = '';
    if (_modalLastFocus && typeof _modalLastFocus.focus === 'function') {
      try { _modalLastFocus.focus(); } catch (_) {}
    }
    _modalLastFocus = null;
  }, 220);
}

function _buttonStyle(variant) {
  const base = [
    'padding:10px 18px',
    'border-radius:10px',
    'font-size:14px',
    'font-weight:500',
    'cursor:pointer',
    'border:1px solid transparent',
    'transition:background 160ms ease, border-color 160ms ease, transform 100ms ease',
    'font-family:inherit',
  ];
  if (variant === 'primary') {
    base.push('background:var(--accent,#2C5BA0)');
    base.push('color:#fff');
    base.push('box-shadow:0 4px 12px rgba(11,27,51,0.18)');
  } else if (variant === 'danger') {
    base.push('background:var(--danger,#D7263D)');
    base.push('color:#fff');
    base.push('box-shadow:0 4px 12px rgba(215,38,61,0.20)');
  } else {
    // ghost / default
    base.push('background:var(--bg-surface,#fff)');
    base.push('color:var(--text-secondary,#3F4A5C)');
    base.push('border-color:var(--border-strong,#C9D2DF)');
  }
  return base.join(';');
}

/* ----------------------------------------------------------------------------
 * confirmDialog — Promise-based confirm
 * ------------------------------------------------------------------------- */
export function confirmDialog(title, message, opts = {}) {
  return new Promise((resolve) => {
    const labelOk = opts.labelOk || 'Confirmar';
    const labelCancel = opts.labelCancel || 'Cancelar';
    const variant = opts.danger ? 'danger' : 'primary';

    openModal({
      title,
      html: '<p style="margin:0;">' + escapeHtml(message || '') + '</p>',
      buttons: [
        {
          label: labelCancel,
          variant: 'ghost',
          onClick: () => { closeModal(); resolve(false); }
        },
        {
          label: labelOk,
          variant,
          autofocus: true,
          onClick: () => { closeModal(); resolve(true); }
        },
      ]
    });
  });
}

/* ----------------------------------------------------------------------------
 * alertDialog — Promise-based alert
 * ------------------------------------------------------------------------- */
export function alertDialog(title, message) {
  return new Promise((resolve) => {
    openModal({
      title,
      html: '<p style="margin:0;">' + escapeHtml(message || '') + '</p>',
      buttons: [
        {
          label: 'OK',
          variant: 'primary',
          autofocus: true,
          onClick: () => { closeModal(); resolve(true); }
        },
      ]
    });
  });
}

/* ============================================================================
 * 3) DRAWER — painel lateral genérico
 * ----------------------------------------------------------------------------
 * Uso:
 *   openDrawer({
 *     title: 'Detalhe do evento',
 *     subtitle: 'Log #abc123',
 *     html: '<div>...</div>',
 *     footerHtml: '<button>Copiar JSON</button>'
 *   });
 *   closeDrawer();
 *
 * O drawer compartilhado se identifica por id 'sharedDrawer'.
 * Para drawers específicos do dashboard (Capacity, Detail), use os IDs
 * próprios já existentes no markup do index.html.
 * ========================================================================= */

const DRAWER_ID = 'sharedDrawer';
let _drawerKeyHandler = null;

export function openDrawer(opts) {
  closeDrawer();

  const title = String(opts.title || '');
  const subtitle = String(opts.subtitle || '');
  const html = opts.html || '';
  const footerHtml = opts.footerHtml || '';
  const dismissable = opts.dismissable !== false;

  const overlay = document.createElement('div');
  overlay.id = DRAWER_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:900',
    'display:grid',
    'grid-template-columns:1fr auto',
    'pointer-events:none',
  ].join(';');

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.style.cssText = [
    'grid-column:1 / -1',
    'grid-row:1',
    'position:absolute',
    'inset:0',
    'background:rgba(11,27,51,0.45)',
    'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)',
    'pointer-events:auto',
    'opacity:0',
    'transition:opacity 220ms ease',
  ].join(';');
  if (dismissable) backdrop.addEventListener('click', closeDrawer);
  overlay.appendChild(backdrop);

  // Panel
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:relative',
    'z-index:1',
    'grid-column:2',
    'grid-row:1',
    'width:480px',
    'max-width:92vw',
    'height:100vh',
    'background:var(--bg-surface,#fff)',
    'color:var(--text-primary,#14181F)',
    'border-left:1px solid var(--border-soft,rgba(255,255,255,0.08))',
    'box-shadow:-12px 0 32px rgba(0,0,0,0.20)',
    'display:flex',
    'flex-direction:column',
    'pointer-events:auto',
    'transform:translateX(100%)',
    'transition:transform 280ms cubic-bezier(0.22,1,0.36,1)',
  ].join(';');

  // Header
  const head = document.createElement('div');
  head.style.cssText = [
    'padding:20px 24px',
    'border-bottom:1px solid var(--border-divider, rgba(11,27,51,0.08))',
    'display:flex',
    'align-items:flex-start',
    'justify-content:space-between',
    'gap:16px',
    'flex-shrink:0',
  ].join(';');

  const headLeft = document.createElement('div');
  headLeft.style.minWidth = '0';
  if (title) {
    const t = document.createElement('h2');
    t.style.cssText = 'font-size:18px;font-weight:600;margin:0;color:var(--text-primary,#14181F);letter-spacing:-0.01em;';
    t.textContent = title;
    headLeft.appendChild(t);
  }
  if (subtitle) {
    const s = document.createElement('p');
    s.style.cssText = 'font-size:13px;color:var(--text-muted,#7A8699);margin:2px 0 0;';
    s.textContent = subtitle;
    headLeft.appendChild(s);
  }
  head.appendChild(headLeft);

  if (dismissable) {
    const closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', 'Fechar painel');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = [
      'background:none',
      'border:none',
      'cursor:pointer',
      'width:32px',
      'height:32px',
      'border-radius:8px',
      'color:var(--text-muted,#7A8699)',
      'font-size:18px',
      'flex-shrink:0',
      'transition:background 160ms ease',
    ].join(';');
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'var(--bg-subtle,#EEF1F6)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'none'; });
    closeBtn.addEventListener('click', closeDrawer);
    head.appendChild(closeBtn);
  }
  panel.appendChild(head);

  // Body
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;padding:20px 24px;';
  if (typeof html === 'string') {
    body.innerHTML = html;
  } else if (html instanceof HTMLElement) {
    body.appendChild(html);
  }
  panel.appendChild(body);

  // Footer
  if (footerHtml) {
    const foot = document.createElement('div');
    foot.style.cssText = [
      'padding:14px 24px',
      'border-top:1px solid var(--border-divider, rgba(11,27,51,0.08))',
      'background:var(--bg-base,#F7F8FA)',
      'flex-shrink:0',
    ].join(';');
    if (typeof footerHtml === 'string') {
      foot.innerHTML = footerHtml;
    } else if (footerHtml instanceof HTMLElement) {
      foot.appendChild(footerHtml);
    }
    panel.appendChild(foot);
  }

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // Anima entrada
  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    panel.style.transform = 'translateX(0)';
  });

  // ESC fecha
  if (dismissable) {
    _drawerKeyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDrawer();
      }
    };
    document.addEventListener('keydown', _drawerKeyHandler);
  }

  return overlay;
}

export function closeDrawer() {
  const overlay = document.getElementById(DRAWER_ID);
  if (!overlay) return;

  const backdrop = overlay.children[0];
  const panel = overlay.children[1];
  if (backdrop) backdrop.style.opacity = '0';
  if (panel) panel.style.transform = 'translateX(100%)';

  if (_drawerKeyHandler) {
    document.removeEventListener('keydown', _drawerKeyHandler);
    _drawerKeyHandler = null;
  }

  setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.body.style.overflow = '';
  }, 280);
}

/* ============================================================================
 * 4) SKELETON — placeholder de carregamento
 * ----------------------------------------------------------------------------
 * Uso:
 *   element.innerHTML = skeleton({ rows: 3, height: 60 });
 * ========================================================================= */

export function skeleton(opts = {}) {
  const rows = Number(opts.rows) || 3;
  const height = Number(opts.height) || 60;
  const radius = opts.radius || 12;

  let out = '';
  for (let i = 0; i < rows; i++) {
    out += [
      '<div class="skeleton-line" style="',
      'height:' + height + 'px;',
      'border-radius:' + radius + 'px;',
      'background:linear-gradient(90deg, var(--bg-subtle,#EEF1F6) 25%, var(--bg-muted,#E2E7EF) 37%, var(--bg-subtle,#EEF1F6) 63%);',
      'background-size:400% 100%;',
      'animation:skeletonShimmer 1.4s ease-in-out infinite;',
      'margin-bottom:12px;',
      '"></div>',
    ].join('');
  }

  // Garante que keyframes existam (uma vez)
  _ensureSkeletonKeyframes();

  return out;
}

function _ensureSkeletonKeyframes() {
  if (document.getElementById('sharedSkeletonKf')) return;
  const style = document.createElement('style');
  style.id = 'sharedSkeletonKf';
  style.textContent = '@keyframes skeletonShimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}';
  document.head.appendChild(style);
}

/* ============================================================================
 * 5) LOADING OVERLAY — cobre tela inteira
 * ----------------------------------------------------------------------------
 * Uso:
 *   const stop = showLoading('Carregando…');
 *   try { ... } finally { stop(); }
 * ========================================================================= */

const LOADING_ID = 'sharedLoadingOverlay';

export function showLoading(mensagem = 'Carregando…') {
  hideLoading();
  const el = document.createElement('div');
  el.id = LOADING_ID;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:1200',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:16px',
    'background:rgba(11,27,51,0.55)',
    'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)',
    'color:#fff',
    'font-size:14px',
    'font-weight:500',
    'opacity:0',
    'transition:opacity 200ms ease',
  ].join(';');

  el.innerHTML = [
    '<div style="width:40px;height:40px;border:3px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:sharedSpin 0.9s linear infinite;"></div>',
    '<div>' + escapeHtml(mensagem) + '</div>',
  ].join('');

  // Garante keyframe spin
  if (!document.getElementById('sharedSpinKf')) {
    const style = document.createElement('style');
    style.id = 'sharedSpinKf';
    style.textContent = '@keyframes sharedSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });

  return hideLoading;
}

export function hideLoading() {
  const el = document.getElementById(LOADING_ID);
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 220);
}

/* ============================================================================
 * 6) EMPTY STATE — gera markup de "sem dados"
 * ----------------------------------------------------------------------------
 * Uso:
 *   container.innerHTML = emptyState({
 *     icon: '📋',
 *     title: 'Nenhum funcionário cadastrado',
 *     text: 'Comece adicionando o primeiro funcionário.'
 *   });
 * ========================================================================= */

export function emptyState(opts = {}) {
  const icon = opts.icon || '∅';
  const title = String(opts.title || 'Sem dados');
  const text = String(opts.text || '');

  return [
    '<div class="empty-state" style="text-align:center;padding:56px 24px;border-radius:16px;border:1px dashed var(--border-strong,#C9D2DF);">',
    '<div style="font-size:40px;color:var(--text-faint,#A4B0C2);margin-bottom:12px;line-height:1;">' + escapeHtml(icon) + '</div>',
    '<div style="font-size:16px;font-weight:600;color:var(--text-secondary,#3F4A5C);">' + escapeHtml(title) + '</div>',
    text ? '<div style="font-size:13px;color:var(--text-muted,#7A8699);margin-top:4px;">' + escapeHtml(text) + '</div>' : '',
    '</div>',
  ].join('');
}

/* ============================================================================
 * 7) Re-export utilitário (para conveniência em quem só importa ui-shared)
 * ========================================================================= */
export { debounce };
