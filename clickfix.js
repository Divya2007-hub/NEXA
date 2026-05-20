/**
 * NEXA — Clickability Fix  |  clickfix.js  v4.0
 */
'use strict';

(function () {

  /* ── Core fix: remove all clipping, force pointer-events ── */
  function fixClickability() {

    /* 1. Un-clip containers */
    document.querySelectorAll(
      '.settings-card, .sc-body, #fb-main-card, ' +
      '.settings-grid, #tab-settings, #tab-settings *,' +
      '.reminder-settings-card, #nexa-reminder-settings-card'
    ).forEach(el => {
      el.style.overflow    = 'visible';
      el.style.position    = el.style.position || 'relative';
      el.style.zIndex      = '';   /* clear stale z-index that breaks stacking */
    });

    /* 2. Specifically un-clip the pseudo-element overlay that feedback.css adds */
    const fbCard = document.getElementById('fb-main-card');
    if (fbCard) {
      fbCard.style.overflow = 'visible';
      /* The ::before overlay in feedback.css has pointer-events:none already,
         but belt-and-suspenders: ensure the card itself is transparent to events
         only where there's no real child */
    }

    /* 3. Force-enable every interactive element inside settings */
    const INTERACTIVE = [
      '.fb-star', '.fb-mood-btn',
      '#fb-submit-btn',
      '#fb-bug-btn', '#fb-feature-btn',
      '#fb-message', '.fb-textarea',
      '.fb-support-link', '.fb-quick-btn',
      '#fb-stars-row button',
      '.toggle-btn', '.settings-action-btn',
      '#rs-request-btn',
      '#rs-clear-btn',
      '#rs-default-offset', '#rs-snooze',
      '.rs-action-btn',
      '.reminder-settings-row button',
      '.reminder-settings-row input',
      '.reminder-settings-row select',
    ];

    INTERACTIVE.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.pointerEvents = 'all';
        el.style.position      = 'relative';
        el.style.zIndex        = '1';   /* just enough to be above any overlay */
        if (el.tagName === 'BUTTON') el.style.cursor = 'pointer';
      });
    });

    /* 4. Reminder card deep-fix */
    const rc = document.getElementById('nexa-reminder-settings-card');
    if (rc) {
      rc.style.overflow = 'visible';
      rc.querySelectorAll('button, input, select').forEach(el => {
        el.style.pointerEvents = 'all';
        el.style.position      = 'relative';
        el.style.zIndex        = '1';
      });
    }
  }

  /* ── Re-bind feedback listeners if feedback.js binding was lost ── */
  function _rewireFeedback() {
    /* Stars */
    document.querySelectorAll('.fb-star').forEach(star => {
      if (star.dataset.wired) return;
      star.dataset.wired = '1';
      const val = parseInt(star.dataset.val, 10);
      star.addEventListener('mouseenter', () => _hlStars(val));
      star.addEventListener('mouseleave', () => _hlStars(window._fbStars || 0));
      star.addEventListener('click', () => {
        window._fbStars = val;
        _hlStars(val);
        _updateFbSubmit();
        const row = document.getElementById('fb-stars-row');
        if (row) { row.classList.remove('star-pulse'); void row.offsetWidth; row.classList.add('star-pulse'); }
      });
    });

    /* Mood buttons */
    document.querySelectorAll('.fb-mood-btn').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fb-mood-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        window._fbMood = btn.dataset.mood;
        _updateFbSubmit();
      });
    });

    /* Quick action buttons */
    const bugBtn  = document.getElementById('fb-bug-btn');
    const featBtn = document.getElementById('fb-feature-btn');
    const ta      = document.getElementById('fb-message');

    if (bugBtn && ta && !bugBtn.dataset.wired) {
      bugBtn.dataset.wired = '1';
      bugBtn.addEventListener('click', () => {
        ta.value = '🐛 Bug Report:\n\n';
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      });
    }
    if (featBtn && ta && !featBtn.dataset.wired) {
      featBtn.dataset.wired = '1';
      featBtn.addEventListener('click', () => {
        ta.value = '✨ Feature Request:\n\n';
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      });
    }
  }

  function _hlStars(upTo) {
    document.querySelectorAll('.fb-star').forEach(s => {
      const v = parseInt(s.dataset.val, 10);
      s.classList.toggle('active', v <= upTo);
      s.classList.toggle('dim', v > upTo && upTo > 0);
    });
    const label = document.getElementById('fb-star-label');
    if (label) {
      const labels = ['','Poor','Fair','Good','Great','Excellent'];
      label.textContent = upTo > 0 ? labels[upTo] : '';
      label.className = `fb-star-label sl-${upTo}`;
    }
  }

  function _updateFbSubmit() {
    const btn = document.getElementById('fb-submit-btn');
    const ta  = document.getElementById('fb-message');
    if (!btn) return;
    const ok = (window._fbStars > 0 || (ta && ta.value.trim().length > 0));
    btn.disabled = !ok;
    btn.classList.toggle('ready', ok);
  }

  /* ── Init ── */
  function _ready(cb) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cb);
    else cb();
  }

  _ready(() => {
    fixClickability();
    _rewireFeedback();

    setTimeout(() => { fixClickability(); _rewireFeedback(); }, 300);
    setTimeout(() => { fixClickability(); _rewireFeedback(); }, 800);
    setTimeout(() => { fixClickability(); _rewireFeedback(); }, 2000);

    /* Re-run when settings tab opens */
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-tab]');
      if (btn && btn.dataset.tab === 'settings') {
        [100, 400, 900, 1500].forEach(t =>
          setTimeout(() => { fixClickability(); _rewireFeedback(); }, t)
        );
      }
    });

    /* Watch for dynamically injected content */
    const settingsTab = document.querySelector('#tab-settings');
    if (settingsTab) {
      new MutationObserver(() => {
        fixClickability();
        _rewireFeedback();
      }).observe(settingsTab, { childList: true, subtree: true });
    }
  });

})();