/**
 * NEXA — Responsive Layout Patch v3.0
 * Fixes:
 *  1. Sidebar open/close on mobile (hamburger + overlay + close btn)
 *  2. Nav tab switching from inside the sidebar on mobile
 *  3. Autosave/sync indicator repositioning per breakpoint
 */

(function () {
  'use strict';

  const MOBILE_BP = 768;

  /* ════════════════════════════════
     BADGE REPOSITIONING
  ════════════════════════════════ */
  function placeBadge() {
    const badge       = document.getElementById('autosave-indicator');
    const topbarAct   = document.querySelector('.topbar-actions');
    const sidebarFoot = document.querySelector('.sidebar-footer');
    if (!badge) return;

    if (window.innerWidth <= MOBILE_BP) {
      /* On mobile: hide from topbar — it's too cluttered. Just hide it. */
      badge.style.display = 'none';
    } else {
      /* On desktop: put it back in the sidebar footer, inline */
      badge.style.display = '';
      if (sidebarFoot && !sidebarFoot.contains(badge)) {
        sidebarFoot.insertBefore(badge, sidebarFoot.firstChild);
      }
    }
  }

  /* ════════════════════════════════
     SIDEBAR OPEN / CLOSE
  ════════════════════════════════ */
  function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const hamburger = document.getElementById('hamburger');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('visible');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const hamburger = document.getElementById('hamburger');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
  }

  function isMobile() {
    return window.innerWidth <= MOBILE_BP;
  }

  /* ════════════════════════════════
     WIRE ALL SIDEBAR TRIGGERS
  ════════════════════════════════ */
  function wireSidebar() {
    const hamburger   = document.getElementById('hamburger');
    const sidebarClose= document.getElementById('sidebar-close');
    const overlay     = document.getElementById('sidebar-overlay');

    /* Hamburger — toggle sidebar */
    if (hamburger) {
      hamburger.addEventListener('click', function (e) {
        e.stopPropagation();
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
          closeSidebar();
        } else {
          openSidebar();
        }
      });
    }

    /* Close button inside sidebar */
    if (sidebarClose) {
      sidebarClose.addEventListener('click', function (e) {
        e.stopPropagation();
        closeSidebar();
      });
    }

    /* Overlay tap — close */
    if (overlay) {
      overlay.addEventListener('click', function () {
        closeSidebar();
      });
    }
  }

  /* ════════════════════════════════
     WIRE NAV ITEMS — close sidebar after tab switch on mobile
  ════════════════════════════════ */
  function wireNavItems() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (isMobile()) {
          /* Small delay so script.js tab switch runs first */
          setTimeout(closeSidebar, 80);
        }
      });
    });
  }

  /* ════════════════════════════════
     RESIZE HANDLER
  ════════════════════════════════ */
  function onResize() {
    placeBadge();
    /* Auto-close sidebar when resizing to desktop */
    if (!isMobile()) {
      closeSidebar();
    }
  }

  /* ════════════════════════════════
     INIT
  ════════════════════════════════ */
  function init() {
    placeBadge();
    wireSidebar();
    wireNavItems();

    let resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(onResize, 120);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

})();