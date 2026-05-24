/**
 * NEXA — Mobile Sidebar Fix  v3.0
 * FIXED: Single tap nav (no double-click required)
 */
'use strict';

(function () {

  function isMobile() { return window.innerWidth <= 768; }

  function openSidebar() {
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebar-overlay');
    var h = document.getElementById('hamburger');
    if (s) s.classList.add('open');
    if (o) o.classList.add('visible');
    if (h) h.setAttribute('aria-expanded', 'true');
    document.body.classList.add('sidebar-open');
  }

  function closeSidebar() {
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebar-overlay');
    var h = document.getElementById('hamburger');
    if (s) s.classList.remove('open');
    if (o) o.classList.remove('visible');
    if (h) h.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sidebar-open');
  }

  function init() {

    // Removed duplicate hamburger, overlay, and closeBtn listeners
    // These are already handled by script.js, preventing the "double-click" bug.

    /* SINGLE TAP NAV FIX */
    document.querySelectorAll('.nav-item[data-tab]').forEach(function (btn) {
      var tabName = btn.getAttribute('data-tab');

      btn.addEventListener('touchend', function (e) {
        if (!isMobile()) return;
        e.preventDefault();        // cancel ghost click
        e.stopPropagation();

        // Switch tab immediately — no delay
        if (typeof switchTab === 'function') {
          switchTab(tabName);
        }

        // Close sidebar immediately — no setTimeout
        closeSidebar();
      }, { passive: false });

      btn.addEventListener('click', function () {
        if (isMobile()) closeSidebar();
        // desktop: script.js handles switchTab
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 100); });
  } else {
    setTimeout(init, 100);
  }

})();