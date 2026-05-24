/**
 * NEXA — Mobile Sidebar Fix  v2.0
 * ONLY fixes: hamburger open/close + sidebar visibility
 * Does NOT clone nav items — uses window.switchTab directly
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
    /* ── Hamburger ── */
    var ham = document.getElementById('hamburger');
    if (ham) {
      ham.addEventListener('click', function (e) {
        e.stopPropagation();
        var s = document.getElementById('sidebar');
        s && s.classList.contains('open') ? closeSidebar() : openSidebar();
      });
      ham.addEventListener('touchend', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var s = document.getElementById('sidebar');
        s && s.classList.contains('open') ? closeSidebar() : openSidebar();
      }, { passive: false });
    }

    /* ── Overlay tap ── */
    var overlay = document.getElementById('sidebar-overlay');
    if (overlay) {
      overlay.addEventListener('click', closeSidebar);
      overlay.addEventListener('touchend', function (e) {
        e.preventDefault();
        closeSidebar();
      }, { passive: false });
    }

    /* ── Sidebar close button ── */
    var closeBtn = document.getElementById('sidebar-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeSidebar);
      closeBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        closeSidebar();
      }, { passive: false });
    }

    /* ── Nav items: just close sidebar on mobile, let script.js handle tab switch ── */
    document.querySelectorAll('.nav-item[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (isMobile()) setTimeout(closeSidebar, 80);
      });
      btn.addEventListener('touchend', function (e) {
        /* Don't preventDefault — let the click fire naturally for switchTab */
        if (isMobile()) setTimeout(closeSidebar, 80);
      }, { passive: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 150); });
  } else {
    setTimeout(init, 150);
  }

})();