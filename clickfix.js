/**
 * NEXA — Clickability Fix  |  clickfix.js
 * Fixes: Feedback form elements and Quick Action buttons not clickable.
 * Load LAST in index.html, after all other scripts.
 */
'use strict';

(function () {

  function fixClickability() {
    /* 1. Remove overflow:hidden from ALL settings cards */
    document.querySelectorAll(
      '.settings-card, .sc-body, #fb-main-card, .settings-grid, #tab-settings'
    ).forEach(el => {
      el.style.overflow = 'visible';
      el.style.position = el.style.position || 'relative';
    });

    /* 2. Force pointer-events on all interactive feedback elements */
    const selectors = [
      '.fb-star',
      '.fb-mood-btn',
      '#fb-submit-btn',
      '.fb-submit-btn',
      '#fb-bug-btn',
      '#fb-feature-btn',
      '#fb-message',
      '.fb-textarea',
      '.fb-support-link',
      '.fb-quick-btn',
      '#fb-stars-row button',
      '.toggle-btn',
      '.settings-action-btn',
    ];

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.pointerEvents = 'all';
        el.style.position = 'relative';
        el.style.zIndex   = '10';
      });
    });

    /* 3. Hide any ::before overlays by adding an inline style trick —
       we can't remove pseudo-elements via JS but we can ensure the
       card doesn't clip its children */
    document.querySelectorAll('.settings-card').forEach(card => {
      card.style.overflow = 'visible';
      card.style.position = 'relative';
    });

    console.info('[ClickFix] Applied to', document.querySelectorAll('.settings-card').length, 'cards');
  }

  /* Run on DOM ready */
  function _ready(cb) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb);
    } else {
      cb();
    }
  }

  _ready(() => {
    /* Run immediately */
    fixClickability();

    /* Re-run after a short delay (in case feedback.js re-renders) */
    setTimeout(fixClickability, 500);
    setTimeout(fixClickability, 1500);

    /* Re-run whenever the settings tab is opened */
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-tab]');
      if (btn && btn.dataset.tab === 'settings') {
        setTimeout(fixClickability, 100);
        setTimeout(fixClickability, 400);
      }
    });

    /* Also observe DOM mutations in the settings grid */
    const settingsGrid = document.querySelector('#tab-settings');
    if (settingsGrid) {
      new MutationObserver(() => {
        fixClickability();
      }).observe(settingsGrid, { childList: true, subtree: true });
    }
  });

})();
