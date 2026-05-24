/**
 * NEXA — Responsive Layout Patch v6.0
 * Handles:
 *  1. Sync badge repositioning
 *  2. Body scroll lock when sidebar is open on mobile
 *  3. Close sidebar when nav tab tapped on mobile
 *  4. Resize cleanup
 *
 * Does NOT touch hamburger open/close — script.js owns that via:
 *    hamburger.addEventListener('click', ...) at top level
 */
(function () {
  'use strict';

  var MOBILE_BP = 768;
  var _scrollY  = 0;   /* remember scroll position before lock */

  function isMobile() {
    return window.innerWidth <= MOBILE_BP;
  }

  /* ── Body scroll lock ── */
  function lockScroll() {
    _scrollY = window.scrollY;
    document.body.classList.add('sidebar-open');
    document.body.style.top = '-' + _scrollY + 'px';
  }

  function unlockScroll() {
    document.body.classList.remove('sidebar-open');
    document.body.style.top = '';
    window.scrollTo(0, _scrollY);
  }

  /* ── Close sidebar helper ── */
  function closeSidebar() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    var ham     = document.getElementById('hamburger');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
    if (ham)     ham.setAttribute('aria-expanded', 'false');
    if (isMobile()) unlockScroll();
  }

  /* ── Observe sidebar open/close to apply scroll lock ── */
  function watchSidebar() {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName === 'class') {
          if (sidebar.classList.contains('open') && isMobile()) {
            lockScroll();
          } else {
            unlockScroll();
          }
        }
      });
    });

    observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  }

  /* ── Close sidebar after picking a nav tab on mobile ── */
  function wireNavClose() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (isMobile()) {
          /* small delay lets script.js switchTab run first */
          setTimeout(closeSidebar, 60);
        }
      });
    });
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

  /* ── Resize cleanup ── */
  function onResize() {
    placeBadge();
    if (!isMobile()) {
      /* Auto-close drawer when resizing to desktop */
      var sidebar = document.getElementById('sidebar');
      var overlay = document.getElementById('sidebar-overlay');
      if (sidebar) sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('visible');
      unlockScroll();
    }
  }

  /* ── Init ── */
  function init() {
    placeBadge();
    watchSidebar();
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