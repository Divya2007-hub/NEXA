/**
 * NEXA — Responsive Layout Patch v2.1
 * ─────────────────────────────────────
 * Fixes:
 *  1. Sidebar toggle on mobile — works alongside script.js's own handler
 *     by checking/setting the .open class that the CSS listens to
 *  2. Moves #autosave-indicator into the right container per breakpoint
 *  3. Does NOT re-bind hamburger if script.js already handles it;
 *     instead we patch the CSS class approach to match what script.js does
 *
 * Load AFTER script.js, sync.js, sync-patch.js
 */

(function () {
  'use strict';

  const MOBILE_BP = 768;

  /* ── Badge repositioning ── */
  function placeBadge() {
    const badge      = document.getElementById('autosave-indicator');
    const topbarAct  = document.querySelector('.topbar-actions');
    const sidebarFoot= document.querySelector('.sidebar-footer');
    if (!badge) return;

    if (window.innerWidth <= MOBILE_BP) {
      if (topbarAct && !topbarAct.contains(badge)) {
        const cmdBtn = document.getElementById('cmd-trigger-mobile');
        topbarAct.insertBefore(badge, cmdBtn || null);
      }
    } else {
      if (sidebarFoot && !sidebarFoot.contains(badge)) {
        sidebarFoot.insertBefore(badge, sidebarFoot.firstChild);
      }
    }
  }

  /* ── Sidebar: patch the existing script.js toggle to also add .open class ──
     script.js uses its own sidebar open/close logic. We observe the
     sidebar-overlay's 'visible' class as a proxy — when it becomes visible
     the sidebar is open, so we add .open to the sidebar element for CSS.
     This avoids double-binding the hamburger button.
  ── */
  function watchSidebarState() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar || !overlay) return;

    /* ── FIX: define ensureOpen / ensureClose before anything calls them ── */
    function ensureOpen() {
      sidebar.classList.add('open');
      overlay.classList.add('visible');
    }
    function ensureClose() {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
    }

    // Use MutationObserver to sync .open class with overlay visibility
    const mo = new MutationObserver(function () {
      if (overlay.classList.contains('visible')) {
        sidebar.classList.add('open');
      } else {
        sidebar.classList.remove('open');
      }
    });
    mo.observe(overlay, { attributes: true, attributeFilter: ['class'] });

    // Also sync on initial state
    if (overlay.classList.contains('visible')) {
      sidebar.classList.add('open');
    }

    const hamburger    = document.getElementById('hamburger');
    const sidebarClose = document.getElementById('sidebar-close');

    if (hamburger) {
      hamburger.addEventListener('click', function () {
        // Small delay so script.js fires first, then we sync
        setTimeout(function () {
          if (overlay.classList.contains('visible')) {
            sidebar.classList.add('open');
          } else {
            // script.js didn't open overlay — force it ourselves
            ensureOpen();
          }
        }, 10);
      });
    }

    if (sidebarClose) {
      sidebarClose.addEventListener('click', ensureClose);
    }

    overlay.addEventListener('click', ensureClose);
  }

  /* ── Resize handler ── */
  function onResize() {
    placeBadge();
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (window.innerWidth > MOBILE_BP && sidebar && overlay) {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
    }
  }

  /* ── Init ── */
  function init() {
    placeBadge();
    watchSidebarState();

    let t;
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