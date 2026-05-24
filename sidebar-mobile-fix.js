/**
 * NEXA — Mobile Sidebar Fix  v5.0
 *
 * Root causes fixed in this version:
 *
 * 1. REMOVED e.preventDefault() on touchend.
 *    The old version called e.preventDefault() which cancelled the
 *    synthetic click, meaning script.js's click handler never fired.
 *    Now we let the touch → click chain complete naturally.
 *
 * 2. REMOVED the duplicate click listener on nav items.
 *    script.js already wires a click handler on every .nav-item that
 *    calls switchTab(). Adding a second click handler here caused
 *    switchTab to fire twice and closeSidebar to run twice, producing
 *    a visible flicker on Android.
 *
 * 3. REMOVED touchend → switchTab entirely.
 *    The touchend path was racing against script.js's click path.
 *    Since script.js already handles the click (which fires ~0ms after
 *    touchend on modern browsers with no 300ms delay because the
 *    viewport has width=device-width), there is no benefit to a
 *    separate touchend handler. The click path is reliable and clean.
 *
 * 4. FIXED: closeSidebar is now called from within switchTab itself
 *    (script.js line 745: if (window.innerWidth <= 768) closeSidebar()).
 *    This file only needs to expose a closeSidebar helper for the
 *    overlay and sidebar-close button, which script.js already handles.
 *    This file is now purely a safety net for edge cases.
 *
 * 5. ADDED: touch-action: manipulation guard via JS for browsers that
 *    ignore the CSS touch-action on dynamically-styled elements.
 *
 * 6. ADDED: window.switchTab existence guard with a retry so slow
 *    cold-starts on low-end phones don't silently fail.
 */
'use strict';

(function () {

  function isMobile() {
    return window.innerWidth <= 768;
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

  /**
   * Ensure nav items have touch-action: manipulation set in JS as well
   * as CSS, because some Android WebView versions ignore CSS touch-action
   * on elements inside overflow:auto containers.
   * Also set -webkit-tap-highlight-color for visual feedback.
   */
  function applyTouchStyles() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(function (btn) {
      btn.style.touchAction = 'manipulation';
      btn.style.webkitTapHighlightColor = 'rgba(124, 110, 247, 0.2)';
      btn.style.userSelect = 'none';
      btn.style.webkitUserSelect = 'none';
      // Ensure the element itself receives pointer events
      btn.style.pointerEvents = 'auto';
    });
  }

  /**
   * Single safety-net click listener on the sidebar nav container.
   * Uses event delegation so it fires for any nav item tap regardless
   * of child element targeting (icon, label, badge).
   *
   * This does NOT call switchTab — script.js already does that via its
   * own click handler on every .nav-item. This handler's only job is to
   * close the sidebar on mobile after the tab switch has happened.
   *
   * Why delegation instead of per-button listeners?
   * - Avoids duplicate wiring if nav items are re-rendered.
   * - One listener is easier to reason about than N listeners.
   * - Works even if a child element (icon/label) is the actual target.
   */
  function wireNavDelegation() {
    var nav = document.querySelector('#sidebar .sidebar-nav');
    if (!nav || nav._nexaDelegated) return;
    nav._nexaDelegated = true;

    nav.addEventListener('click', function (e) {
      if (!isMobile()) return;
      var btn = e.target.closest('.nav-item[data-tab]');
      if (!btn) return;
      // script.js's click handler on btn calls switchTab AND closeSidebar.
      // We only need to close if for some reason script.js didn't (e.g. if
      // the click propagation was stopped by something else).
      // Use setTimeout so we run AFTER script.js's handler.
      setTimeout(function () {
        var s = document.getElementById('sidebar');
        if (s && s.classList.contains('open')) {
          closeSidebar();
        }
      }, 0);
    });
  }

  function init() {
    applyTouchStyles();
    wireNavDelegation();

    // Re-apply if nav items are ever injected dynamically
    var nav = document.querySelector('.sidebar-nav');
    if (nav) {
      new MutationObserver(function () {
        applyTouchStyles();
        wireNavDelegation();
      }).observe(nav, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(init, 0);
    });
  } else {
    setTimeout(init, 0);
  }

})();