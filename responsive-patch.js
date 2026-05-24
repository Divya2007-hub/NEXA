/**
 * NEXA — Responsive Layout Patch v5.0
 * Clean, minimal. Does NOT duplicate script.js hamburger logic.
 * Only handles:
 *  1. Sync badge repositioning (sidebar footer on desktop, hidden mobile)
 *  2. Closing sidebar when a nav tab is picked on mobile
 *  3. Cleanup on resize
 */
(function () {
  'use strict';

  var MOBILE_BP = 768;

  function isMobile() {
    return window.innerWidth <= MOBILE_BP;
  }

  /* ── Move sync badge into sidebar footer on desktop ── */
  function placeBadge() {
    var badge = document.getElementById('autosave-indicator');
    var foot  = document.querySelector('.sidebar-footer');
    if (!badge) return;
    if (isMobile()) {
      badge.style.display = 'none';
    } else {
      badge.style.display = '';
      if (foot && !foot.contains(badge)) {
        foot.insertBefore(badge, foot.firstChild);
      }
    }
  }

  /* ── Close sidebar after picking a nav tab on mobile ── */
  function wireNavClose() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!isMobile()) return;
        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebar-overlay');
        var ham     = document.getElementById('hamburger');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('visible');
        if (ham)     ham.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ── Reset sidebar state on resize to desktop ── */
  function onResize() {
    placeBadge();
    if (!isMobile()) {
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
      t = setTimeout(onResize, 100);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

})();