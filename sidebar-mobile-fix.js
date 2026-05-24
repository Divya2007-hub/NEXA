/**
 * NEXA — Mobile Sidebar Fix  v4.0
 * FIXED: Nav items now reliably switch tabs on single tap.
 *
 * Root cause of the bug:
 *   - switchTab() was a const inside script.js, NOT on window.
 *   - touchend was calling e.stopPropagation(), blocking script.js's
 *     own click listener from firing as a fallback.
 *
 * Fix:
 *   - script.js now exposes window.switchTab (patched above).
 *   - touchend calls window.switchTab() directly — no stopPropagation.
 *   - click listener also calls window.switchTab() so desktop works too.
 */
'use strict';

(function () {

  function isMobile() { return window.innerWidth <= 768; }

  function closeSidebar() {
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebar-overlay');
    var h = document.getElementById('hamburger');
    if (s) s.classList.remove('open');
    if (o) o.classList.remove('visible');
    if (h) h.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sidebar-open');
  }

  function wireNavItems() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(function (btn) {
      var tabName = btn.getAttribute('data-tab');

      // Remove any previously-attached mobile listeners to avoid duplicates
      if (btn._nexaMobileBound) return;
      btn._nexaMobileBound = true;

      /* ── TOUCH: fire switchTab immediately on finger-lift ── */
      btn.addEventListener('touchend', function (e) {
        if (!isMobile()) return;
        // Do NOT stopPropagation — let script.js click handler also run
        // (they both call switchTab, which is idempotent, so no harm)
        e.preventDefault(); // prevent the 300ms ghost click

        if (typeof window.switchTab === 'function') {
          window.switchTab(tabName);
        }
        closeSidebar();
      }, { passive: false });

      /* ── CLICK: fallback for desktop and cases where touch isn't used ── */
      btn.addEventListener('click', function () {
        // script.js also has a click listener that calls switchTab.
        // On mobile, just make sure the sidebar closes.
        if (isMobile()) {
          closeSidebar();
        }
      });
    });
  }

  function init() {
    wireNavItems();

    // Re-wire if new nav items are ever injected dynamically
    var nav = document.querySelector('.sidebar-nav');
    if (nav) {
      new MutationObserver(wireNavItems).observe(nav, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 150); });
  } else {
    setTimeout(init, 150);
  }

})();