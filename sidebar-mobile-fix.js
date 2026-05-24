/**
 * NEXA — Mobile Sidebar Fix  v5.0
 * Handles: hamburger open, overlay close, sidebar close button.
 * Does NOT re-wire nav items — script.js owns all tab switching.
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

  function init() {
    /* Overlay tap → close */
    var overlay = document.getElementById('sidebar-overlay');
    if (overlay) {
      overlay.addEventListener('click', closeSidebar);
      overlay.addEventListener('touchend', function (e) {
        e.preventDefault();
        closeSidebar();
      }, { passive: false });
    }

    /* Sidebar close button */
    var closeBtn = document.getElementById('sidebar-close');
    if (closeBtn) {
      closeBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        closeSidebar();
      }, { passive: false });
    }

    /* Nav items: on mobile, close sidebar after tab switch (script.js fires first) */
    document.querySelectorAll('.nav-item[data-tab]').forEach(function (btn) {
      if (btn._nexaSidebarClose) return;
      btn._nexaSidebarClose = true;

      btn.addEventListener('click', function () {
        if (isMobile()) {
          setTimeout(closeSidebar, 60);
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 100); });
  } else {
    setTimeout(init, 100);
  }

})();