/**
 * NEXA — Feedback & Support Module  |  feedback.js  v2.0
 * Includes:
 * ✅ Star rating
 * ✅ Emoji mood
 * ✅ Firestore save
 * ✅ EmailJS email support
 * ✅ Local draft save
 * ✅ Feedback success banner
 */

'use strict';

(function () {

  /* =========================================
     EMAILJS INIT
  ========================================= */

  (function () {
  emailjs.init({
    publicKey: "z-yya0GwQZ83zwPdw",
  });
})();

  /* =========================================
     CONFIG
  ========================================= */

  const APP_VERSION = '3.1.0';
  const LS_KEY = 'nexa_feedback_drafts';
  const MAX_CHARS = 500;

  let _selectedStars = 0;
  let _selectedMood = null;
  let _submitting = false;

  /* =========================================
     READY
  ========================================= */

  function _ready(cb) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb);
    } else {
      setTimeout(cb, 0);
    }
  }

  _ready(() => setTimeout(_init, 120));

  /* =========================================
     INIT
  ========================================= */

  function _init() {
    _bindStars();
    _bindMoods();
    _bindTextarea();
    _bindSubmit();
    _bindQuickActions();
    _bindSupportLinks();
    _restoreDraft();

    /* Belt-and-suspenders: remove overflow:hidden from ALL settings-cards
       so buttons/links inside are never pointer-event-clipped */
    _fixSettingsCardOverflow();

    /* Re-apply whenever the settings tab becomes active */
    document.querySelectorAll('.nav-item, [data-tab], [data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab || btn.dataset.page;
        if (tab === 'settings') setTimeout(_fixSettingsCardOverflow, 150);
      });
    });

    console.info('[Feedback] Module initialized.');
  }

  function _fixSettingsCardOverflow() {
    document.querySelectorAll('.settings-card, .sc-body').forEach(el => {
      el.style.overflow = 'visible';
    });
  }

  /* =========================================
     STARS
  ========================================= */

  function _bindStars() {
    const stars = document.querySelectorAll('.fb-star');

    if (!stars.length) return;

    stars.forEach(star => {

      const val = parseInt(star.dataset.val, 10);

      star.addEventListener('mouseenter', () => {
        _highlightStars(val);
      });

      star.addEventListener('mouseleave', () => {
        _highlightStars(_selectedStars);
      });

      star.addEventListener('click', () => {

        _selectedStars = val;

        _highlightStars(val);

        _updateSubmitState();

        const row = document.getElementById('fb-stars-row');

        if (row) {
          row.classList.remove('star-pulse');
          void row.offsetWidth;
          row.classList.add('star-pulse');
        }

      });

    });
  }

  function _highlightStars(upTo) {

    document.querySelectorAll('.fb-star').forEach(s => {

      const v = parseInt(s.dataset.val, 10);

      s.classList.toggle('active', v <= upTo);
      s.classList.toggle('dim', v > upTo && upTo > 0);

    });

    const label = document.getElementById('fb-star-label');

    const labels = [
      '',
      'Poor',
      'Fair',
      'Good',
      'Great',
      'Excellent'
    ];

    if (label) {
      label.textContent = upTo > 0 ? labels[upTo] : '';
      label.className = `fb-star-label sl-${upTo}`;
    }

  }

  /* =========================================
     MOODS
  ========================================= */

  function _bindMoods() {

    const moods = document.querySelectorAll('.fb-mood-btn');

    moods.forEach(btn => {

      btn.addEventListener('click', () => {

        moods.forEach(b => b.classList.remove('selected'));

        btn.classList.add('selected');

        _selectedMood = btn.dataset.mood;

        _updateSubmitState();

      });

    });

  }

  /* =========================================
     TEXTAREA
  ========================================= */

  function _bindTextarea() {

    const ta = document.getElementById('fb-message');
    const counter = document.getElementById('fb-char-count');

    if (!ta) return;

    ta.addEventListener('input', () => {

      const len = ta.value.length;

      if (counter) {
        counter.textContent = `${len} / ${MAX_CHARS}`;
        counter.classList.toggle('at-limit', len >= MAX_CHARS);
      }

      _updateSubmitState();

      _saveDraft();

    });

  }

  /* =========================================
     BUTTON STATE
  ========================================= */

  function _updateSubmitState() {

    const btn = document.getElementById('fb-submit-btn');

    if (!btn) return;

    const ta = document.getElementById('fb-message');

    const msg = ta ? ta.value.trim() : '';

    const ok = (_selectedStars > 0 || msg.length > 0) && !_submitting;

    btn.disabled = !ok;

    btn.classList.toggle('ready', ok);

  }

  /* =========================================
     SUBMIT
  ========================================= */

  function _bindSubmit() {

    const btn = document.getElementById('fb-submit-btn');

    if (!btn) return;

    btn.addEventListener('click', _submitFeedback);

  }

  async function _submitFeedback() {

    if (_submitting) return;

    const ta = document.getElementById('fb-message');

    const msg = ta ? ta.value.trim() : '';

    if (!_selectedStars && !msg) return;

    _submitting = true;

    _updateSubmitState();

    const btn = document.getElementById('fb-submit-btn');

    if (btn) {
      btn.textContent = 'Sending...';
    }

    const feedbackId =
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7);

    const payload = {

      id: feedbackId,

      rating: _selectedStars || null,

      mood: _selectedMood || null,

      message: msg || null,

      appVersion: APP_VERSION,

      createdAt: new Date().toISOString(),

      userAgent: navigator.userAgent

    };

    /* =========================================
       SAVE LOCAL
    ========================================= */

    _saveLocal(payload);

    /* =========================================
       SAVE FIRESTORE
    ========================================= */

    await _saveFirestore(payload);

    /* =========================================
       SEND EMAIL
    ========================================= */

    try {

      const currentUser =
        firebase.auth().currentUser;

      await emailjs.send(
        "service_afv7qxr",
        "template_mbdary8",
        {

          app_name: "NEXA",

          rating:
            payload.rating || "No rating",

          mood:
            payload.mood || "No mood",

          message:
            payload.message || "No message",

          created_at:
            payload.createdAt,

          app_version:
            payload.appVersion,

          browser:
            navigator.userAgent,

          user_email:
            currentUser?.email || "Guest User"

        }
      );

      console.log('[Feedback] Email sent');

    } catch (err) {

      console.error(
        '[Feedback] EmailJS failed:',
        err
      );

    }

    /* =========================================
       SUCCESS
    ========================================= */

    _showSuccess();

    _clearDraft();

    _resetForm();

    _submitting = false;

  }

  /* =========================================
     SUCCESS UI
  ========================================= */

  function _showSuccess() {

    if (typeof window.showToast === 'function') {

      window.showToast(
        'Feedback sent! Thank you 🙏',
        't-success',
        3500
      );

    }

    const banner =
      document.getElementById(
        'fb-success-banner'
      );

    if (banner) {

      banner.classList.add('visible');

      setTimeout(() => {
        banner.classList.remove('visible');
      }, 4000);

    }

  }

  /* =========================================
     RESET
  ========================================= */

  function _resetForm() {

    const ta =
      document.getElementById(
        'fb-message'
      );

    if (ta) ta.value = '';

    const counter =
      document.getElementById(
        'fb-char-count'
      );

    if (counter) {
      counter.textContent = `0 / ${MAX_CHARS}`;
    }

    _selectedStars = 0;

    _selectedMood = null;

    _highlightStars(0);

    document
      .querySelectorAll('.fb-mood-btn')
      .forEach(b => {
        b.classList.remove('selected');
      });

    const btn =
      document.getElementById(
        'fb-submit-btn'
      );

    if (btn) {

      btn.textContent =
        'Send Feedback';

      btn.disabled = true;

      btn.classList.remove('ready');

    }

  }

  /* =========================================
     QUICK ACTIONS
  ========================================= */

  function _bindQuickActions() {

    const bugBtn =
      document.getElementById(
        'fb-bug-btn'
      );

    const featBtn =
      document.getElementById(
        'fb-feature-btn'
      );

    const ta =
      document.getElementById(
        'fb-message'
      );

    if (bugBtn && ta) {

      bugBtn.addEventListener('click', () => {

        ta.value =
          '🐛 Bug Report:\n\n';

        ta.dispatchEvent(
          new Event('input')
        );

        ta.focus();

      });

    }

    if (featBtn && ta) {

      featBtn.addEventListener('click', () => {

        ta.value =
          '✨ Feature Request:\n\n';

        ta.dispatchEvent(
          new Event('input')
        );

        ta.focus();

      });

    }

  }

  /* =========================================
     SUPPORT LINKS
  ========================================= */

  function _bindSupportLinks() {

    const emailBtn =
      document.getElementById(
        'fb-email-copy'
      );

    if (!emailBtn) return;

    emailBtn.addEventListener('click', () => {

      const email =
        emailBtn.dataset.email || '';

      if (!email) return;

      navigator.clipboard
        .writeText(email)
        .then(() => {

          const orig =
            emailBtn.textContent;

          emailBtn.textContent =
            '✓ Copied!';

          setTimeout(() => {
            emailBtn.textContent = orig;
          }, 2000);

        });

    });

  }

  /* =========================================
     LOCAL STORAGE
  ========================================= */

  function _saveLocal(payload) {

    try {

      const drafts =
        JSON.parse(
          localStorage.getItem(LS_KEY) || '[]'
        );

      drafts.push(payload);

      if (drafts.length > 20) {
        drafts.splice(
          0,
          drafts.length - 20
        );
      }

      localStorage.setItem(
        LS_KEY,
        JSON.stringify(drafts)
      );

    } catch (e) {

      console.warn(
        '[Feedback] localStorage failed:',
        e
      );

    }

  }

  function _saveDraft() {

    try {

      const ta =
        document.getElementById(
          'fb-message'
        );

      const draft = {

        stars: _selectedStars,

        mood: _selectedMood,

        msg: ta ? ta.value : ''

      };

      localStorage.setItem(
        'nexa_feedback_wip',
        JSON.stringify(draft)
      );

    } catch (_) {}

  }

  function _clearDraft() {

    try {

      localStorage.removeItem(
        'nexa_feedback_wip'
      );

    } catch (_) {}

  }

  function _restoreDraft() {

    try {

      const raw =
        localStorage.getItem(
          'nexa_feedback_wip'
        );

      if (!raw) return;

      const d = JSON.parse(raw);

      if (d.stars) {

        _selectedStars = d.stars;

        _highlightStars(d.stars);

      }

      if (d.msg) {

        const ta =
          document.getElementById(
            'fb-message'
          );

        if (ta) {

          ta.value = d.msg;

          ta.dispatchEvent(
            new Event('input')
          );

        }

      }

    } catch (_) {}

  }

  /* =========================================
     FIRESTORE SAVE
  ========================================= */

  async function _saveFirestore(payload) {

    try {

      const auth =
        firebase.auth();

      const user =
        auth.currentUser;

      if (!user) return;

      const db =
        firebase.firestore();

      const ref =
        db.collection('users')
          .doc(user.uid)
          .collection('feedback')
          .doc(payload.id);

      await ref.set({

        ...payload,

        uid: user.uid,

        email:
          user.email || null

      });

      console.info(
        '[Feedback] Saved to Firestore:',
        payload.id
      );

    } catch (e) {

      console.warn(
        '[Feedback] Firestore failed:',
        e
      );

    }

  }

})();