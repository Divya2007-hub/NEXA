/**
 * NEXA — Responsive Layout Patch v4.0
 * Only does TWO things:
 *  1. Repositions the sync badge (sidebar footer on desktop, hidden on mobile)
 *  2. Ensures nav items close the sidebar on mobile after switching tabs
 *
 * Does NOT touch hamburger/sidebar open/close — script.js owns that.
 */
(function () {
  'use strict';

  const MOBILE_BP = 768;

  /* ── Badge repositioning ── */
  function placeBadge() {
    var badge       = document.getElementById('autosave-indicator');
    var sidebarFoot = document.querySelector('.sidebar-footer');
    if (!badge) return;

    if (window.innerWidth <= MOBILE_BP) {
      badge.style.display = 'none';
    } else {
      badge.style.display = '';
      if (sidebarFoot && !sidebarFoot.contains(badge)) {
        sidebarFoot.insertBefore(badge, sidebarFoot.firstChild);
      }
    }
  }

  /* ── Close sidebar when a nav tab is tapped on mobile ── */
  function wireNavClose() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (window.innerWidth > MOBILE_BP) return;
        /* script.js already handles switchTab; we just close the sidebar */
        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebar-overlay');
        var ham     = document.getElementById('hamburger');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('visible');
        if (ham)     ham.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ── Resize: hide badge on mobile, show on desktop ── */
  function onResize() {
    placeBadge();
    if (window.innerWidth > MOBILE_BP) {
      var sidebar = document.getElementById('sidebar');
      var overlay = document.getElementById('sidebar-overlay');
      if (sidebar) sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('visible');
    }
  }

  function init() {
    placeBadge();
    wireNavClose();
    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(onResize, 120);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

})();