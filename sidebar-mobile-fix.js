/**
 * NEXA — Mobile Sidebar Fix  |  sidebar-mobile-fix.js
 * Ensures hamburger opens sidebar and nav items navigate + close sidebar on mobile.
 * Load LAST, after all other scripts.
 */
'use strict';

(function () {

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const hamburger = document.getElementById('hamburger');
    if (sidebar)   sidebar.classList.add('open');
    if (overlay)   overlay.classList.add('visible');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('sidebar-open');
  }

  function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const hamburger = document.getElementById('hamburger');
    if (sidebar)   sidebar.classList.remove('open');
    if (overlay)   overlay.classList.remove('visible');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sidebar-open');
  }

  function init() {
    const hamburger = document.getElementById('hamburger');
    const overlay   = document.getElementById('sidebar-overlay');
    const sidebarClose = document.getElementById('sidebar-close');

    // Hamburger — replace existing listeners by cloning
    if (hamburger) {
      const newHam = hamburger.cloneNode(true);
      hamburger.parentNode.replaceChild(newHam, hamburger);
      newHam.addEventListener('click',   (e) => { e.stopPropagation(); const s = document.getElementById('sidebar'); s && s.classList.contains('open') ? closeSidebar() : openSidebar(); }, { passive: false });
      newHam.addEventListener('touchend',(e) => { e.preventDefault(); e.stopPropagation(); const s = document.getElementById('sidebar'); s && s.classList.contains('open') ? closeSidebar() : openSidebar(); }, { passive: false });
    }

    // Overlay click → close
    if (overlay) {
      overlay.addEventListener('click',    closeSidebar);
      overlay.addEventListener('touchend', (e) => { e.preventDefault(); closeSidebar(); }, { passive: false });
    }

    // Sidebar close button
    if (sidebarClose) {
      sidebarClose.addEventListener('click',    closeSidebar);
      sidebarClose.addEventListener('touchend', (e) => { e.preventDefault(); closeSidebar(); }, { passive: false });
    }

    // Nav items — wire tab switching + close sidebar on mobile
    document.querySelectorAll('.nav-item[data-tab]').forEach(function (btn) {
      // Remove old listeners by cloning
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      function handleNav(e) {
        e.preventDefault();
        e.stopPropagation();
        const tab = newBtn.dataset.tab;
        if (!tab) return;

        // Switch tab (use the app's own switchTab if available)
        if (typeof window.switchTab === 'function') {
          window.switchTab(tab);
        } else {
          // Manual tab switch fallback
          document.querySelectorAll('.nav-item').forEach(function (b) {
            b.classList.toggle('active', b.dataset.tab === tab);
            b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
          });
          document.querySelectorAll('.tab-panel').forEach(function (p) {
            p.classList.toggle('active', p.id === 'tab-' + tab);
          });
          var inputBar = document.getElementById('input-bar');
          if (inputBar) inputBar.classList.toggle('hidden', tab !== 'tasks');
          var topbarTitle = document.getElementById('topbar-title');
          if (topbarTitle) {
            var titles = { tasks:'Tasks', analytics:'Analytics', calendar:'Calendar', focus:'Focus', settings:'Settings' };
            topbarTitle.textContent = titles[tab] || tab;
          }
        }

        // Close sidebar on mobile after a short delay
        if (isMobile()) {
          setTimeout(closeSidebar, 80);
        }
      }

      newBtn.addEventListener('click',    handleNav, { passive: false });
      newBtn.addEventListener('touchend', function(e) { e.preventDefault(); handleNav(e); }, { passive: false });
    });
  }

  // Run after DOM + other scripts are ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 100); });
  } else {
    setTimeout(init, 100);
  }

})();
