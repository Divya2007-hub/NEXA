/* ============================================================
   NEXA — script.js  |  SaaS Productivity Platform v3 + Auth
   Firebase Authentication layer prepended.
   All original features 100% preserved.
   Data is UID-scoped so every user has isolated storage.
   ============================================================ */
'use strict';

/* ════════════════════════════════════════════════════════════
   ①  FIREBASE CONFIG
   ════════════════════════════════════════════════════════════
   HOW TO GET THESE VALUES:
     1. https://console.firebase.google.com → your project
     2. Gear ⚙ → Project Settings → "Your apps" tab
     3. Click your Web app (or "Add app" → Web)
     4. Copy every value from the firebaseConfig shown
     5. Paste below, replacing each placeholder string

   ENABLE AUTH PROVIDERS (Firebase Console):
     Build → Authentication → Get started → Sign-in method
       • Email/Password → Enable → Save
       • Google         → Enable → pick support email → Save

   AUTHORISED DOMAINS:
     Authentication → Settings → Authorised domains
       → add your production hostname (localhost is pre-added)

   FUTURE FIRESTORE SYNC ARCHITECTURE:
     When you're ready to move from localStorage to Firestore:
       • Uncomment the Firestore SDK <script> in index.html
       • Replace load(LS.TASKS, []) with:
           await db.collection('users').doc(AUTH.currentUser.uid)
                   .collection('tasks').get()
       • Replace saveWithIndicator(LS.TASKS, tasks) with:
           batch-write to users/{uid}/tasks/{taskId}
       • All state keys below already use uid-prefixed keys,
         so the migration is purely a swap of read/write fns.
   ════════════════════════════════════════════════════════════ */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCd_pwMAWDm-0S81tbY9Zc4KhMfR_DHTR0",
  authDomain:        "velora-os-5fc9e.firebaseapp.com",
  projectId:         "velora-os-5fc9e",
  storageBucket:     "velora-os-5fc9e.firebasestorage.app",
  messagingSenderId: "744879781525",
  appId:             "1:744879781525:web:e17623b6b8e11e9a800d9c",
};

/* Initialise Firebase (only once) */
firebase.initializeApp(FIREBASE_CONFIG);
const AUTH = firebase.auth();

/* Google provider */
const GOOGLE_PROVIDER = new firebase.auth.GoogleAuthProvider();
GOOGLE_PROVIDER.addScope('email');
GOOGLE_PROVIDER.addScope('profile');

/* Persist session across browser restarts */
AUTH.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

/* ── Current authenticated user (set by onAuthStateChanged) ── */
let currentUser = null;

/* ─────────────────────────────────────────────────────────
   requireAuth(action)
   Single centralized auth check. Call this before any
   action that needs a real user. Returns true if authed.
   In guest mode: shows auth modal + toast, returns false.
   ─────────────────────────────────────────────────────────*/
function requireAuth(action = "use this feature") {
  if (currentUser) return true;
  showAuthModal();
  authShowToast(`Sign in to ${action}`, "warn");
  return false;
}

/* ════════════════════════════════════════════════════════════
   ②  AUTH UI HELPERS  (Preview-first system)
   The app is ALWAYS visible. Auth gate is now an in-app modal
   shown only when a guest clicks a locked feature.
   ════════════════════════════════════════════════════════════ */
const authGate    = document.getElementById('auth-gate');
const authLoader  = document.getElementById('auth-loader');
const appWrapper  = document.getElementById('app-wrapper');

const showAuthLoader = (text = 'Loading…') => {
  document.getElementById('auth-loader-text').textContent = text;
  authLoader.classList.remove('auth-loader-hidden');
};
const hideAuthLoader = () => authLoader.classList.add('auth-loader-hidden');

/* Show/hide auth as an in-app modal (NOT a blocking gate) */
const showAuthModal = () => {
  authGate.classList.remove('auth-gate-hidden');
};
const hideAuthModal = () => {
  authGate.classList.add('auth-gate-hidden');
  /* Reset any loading states on auth buttons */
  document.querySelectorAll('.auth-submit-btn, .auth-google-btn').forEach(b => setBtnLoading(b, false));
};

/* Legacy alias */
const showAuthGate = showAuthModal;

/* showApp: only hides the modal, never needed to show appWrapper
   (appWrapper is always visible — loader covers it during boot) */
const showApp = () => {
  hideAuthModal();
};

/* Button loading state */
const setBtnLoading = (btn, on) => {
  btn.disabled = on;
  btn.classList.toggle('auth-btn-loading', on);
};

/* Auth error → friendly message */
const authErrMsg = code => ({
  'auth/invalid-email':         'Please enter a valid email address.',
  'auth/user-not-found':        'No account found with that email.',
  'auth/wrong-password':        'Incorrect password. Try again.',
  'auth/invalid-credential':    'Invalid email or password.',
  'auth/email-already-in-use':  'That email is already registered. Sign in instead.',
  'auth/weak-password':         'Password must be at least 6 characters.',
  'auth/too-many-requests':     'Too many attempts — please wait a moment.',
  'auth/network-request-failed':'Network error. Check your connection.',
  'auth/popup-closed-by-user':  null,           /* user cancelled — stay silent */
  'auth/popup-blocked':         'Popup was blocked. Allow popups for this site.',
  'auth/account-exists-with-different-credential':
                                'An account already exists with this email using a different sign-in method.',
}[code] || `Something went wrong (${code}).`);

/* ════════════════════════════════════════════════════════════
   ③  AUTH TAB SWITCHING
   ════════════════════════════════════════════════════════════ */
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`auth-panel-${tab.dataset.authTab}`).classList.add('active');
  });
});

/* ── Password show/hide toggles ── */
document.querySelectorAll('.auth-pw-eye').forEach(btn => {
  btn.addEventListener('click', () => {
    const inp = document.getElementById(btn.dataset.target);
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '👁' : '🙈';
  });
});

/* ── Enter key on auth inputs ── */
['auth-login-email', 'auth-login-pass'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('auth-login-btn').click();
  });
});
['auth-signup-name', 'auth-signup-email', 'auth-signup-pass'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('auth-signup-btn').click();
  });
});

/* ════════════════════════════════════════════════════════════
   ④  EMAIL / PASSWORD  — SIGN IN
   ════════════════════════════════════════════════════════════ */
document.getElementById('auth-login-btn').addEventListener('click', async () => {
  const email = document.getElementById('auth-login-email').value.trim();
  const pass  = document.getElementById('auth-login-pass').value;
  const btn   = document.getElementById('auth-login-btn');

  if (!email) return authShowToast('Please enter your email address.', 'warn');
  if (!pass)  return authShowToast('Please enter your password.', 'warn');

  setBtnLoading(btn, true);
  try {
    await AUTH.signInWithEmailAndPassword(email, pass);
    /* onAuthStateChanged will fire and boot the app */
  } catch (err) {
    const msg = authErrMsg(err.code);
    if (msg) authShowToast(msg, 'error');
    setBtnLoading(btn, false);
  }
});

/* ════════════════════════════════════════════════════════════
   ⑤  EMAIL / PASSWORD  — SIGN UP
   ════════════════════════════════════════════════════════════ */
document.getElementById('auth-signup-btn').addEventListener('click', async () => {
  const name  = document.getElementById('auth-signup-name').value.trim();
  const email = document.getElementById('auth-signup-email').value.trim();
  const pass  = document.getElementById('auth-signup-pass').value;
  const btn   = document.getElementById('auth-signup-btn');

  if (!name)          return authShowToast('Please enter your name.', 'warn');
  if (!email)         return authShowToast('Please enter your email address.', 'warn');
  if (pass.length < 6)return authShowToast('Password must be at least 6 characters.', 'warn');

  setBtnLoading(btn, true);
  try {
    const cred = await AUTH.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    await cred.user.reload();
    /* onAuthStateChanged fires next */
  } catch (err) {
    const msg = authErrMsg(err.code);
    if (msg) authShowToast(msg, 'error');
    setBtnLoading(btn, false);
  }
});

/* ════════════════════════════════════════════════════════════
   ⑥  GOOGLE SIGN-IN  (shared by both panels)
   ════════════════════════════════════════════════════════════ */
const handleGoogleSignIn = async btnId => {
  const btn = document.getElementById(btnId);
  setBtnLoading(btn, true);
  try {
    await AUTH.signInWithPopup(GOOGLE_PROVIDER);
  } catch (err) {
    const msg = authErrMsg(err.code);
    if (msg) authShowToast(msg, 'error');
    setBtnLoading(btn, false);
  }
};
document.getElementById('auth-google-login-btn') .addEventListener('click', () => handleGoogleSignIn('auth-google-login-btn'));
document.getElementById('auth-google-signup-btn').addEventListener('click', () => handleGoogleSignIn('auth-google-signup-btn'));

/* ════════════════════════════════════════════════════════════
   ⑦  FORGOT PASSWORD
   ════════════════════════════════════════════════════════════ */
document.getElementById('auth-forgot-btn').addEventListener('click', async () => {
  const email = document.getElementById('auth-login-email').value.trim();
  if (!email) return authShowToast('Enter your email above, then click "Forgot password".', 'warn');
  try {
    await AUTH.sendPasswordResetEmail(email);
    authShowToast('Password reset email sent — check your inbox.', 'success');
  } catch (err) {
    const msg = authErrMsg(err.code);
    if (msg) authShowToast(msg, 'error');
  }
});

/* ════════════════════════════════════════════════════════════
   ⑧  SIGN OUT  (called from sidebar chip + settings card)
   ════════════════════════════════════════════════════════════ */
const handleSignOut = async () => {
  try {
    await AUTH.signOut();
    /* onAuthStateChanged fires → showAuthGate() */
  } catch (err) {
    showToast('Sign-out failed. Please try again.', 't-warning');
  }
};

/* ════════════════════════════════════════════════════════════
   ⑨  AUTH-GATE TOAST  (small inline toasts on the auth card,
       separate from the main app toast system)
   ════════════════════════════════════════════════════════════ */
let _authToastTimer = null;
const authShowToast = (msg, type = 'info') => {
  let el = document.getElementById('auth-inline-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'auth-inline-toast';
    document.getElementById('auth-card').appendChild(el);
  }
  el.textContent = msg;
  el.className = `auth-inline-toast auth-toast-${type} auth-toast-show`;
  clearTimeout(_authToastTimer);
  _authToastTimer = setTimeout(() => el.classList.remove('auth-toast-show'), 4500);
};

/* ════════════════════════════════════════════════════════════
   GLOBAL AUTH STATE (Preview-first LOCK SYSTEM)
   ════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   GLOBAL AUTH STATE — DETERMINISTIC, NO FLICKER
   ─────────────────────────────────────────────────────────
   Flow:
     1. Auth loader covers the app during Firebase boot
     2. onAuthStateChanged fires exactly once after boot
     3. If user → bootApp(uid), remove guest-mode
     4. If no user → bootGuestMode(), add guest-mode
     5. Loader hides — app is fully visible, no flicker
   ════════════════════════════════════════════════════════════ */

let _authBooted = false; /* prevent double-boot on hot reloads */

/* ── NUCLEAR FALLBACK: if ANYTHING blocks Firebase from responding
   (wrong authDomain, network issue, Vercel config, cold start offline)
   this timer fires after 5s and boots the app no matter what.
   Without this, a single Firebase hiccup = infinite loading screen. ── */
const _authFallbackTimer = setTimeout(() => {
  if (_authBooted) return; /* Firebase already responded — do nothing */
  _authBooted = true;

  console.warn('[NEXA] Firebase Auth did not respond within 5s — forcing boot.');
  hideAuthLoader();

  /* Try to recover a cached Firebase user from localStorage */
  let cachedUser = null;
  try {
    const fbKey = Object.keys(localStorage)
      .find(k => k.startsWith('firebase:authUser:') || k.includes(':authUser:'));
    if (fbKey) {
      const parsed = JSON.parse(localStorage.getItem(fbKey));
      if (parsed && parsed.uid) cachedUser = parsed;
    }
  } catch (_) { /* ignore */ }

  if (cachedUser) {
    /* Restore session from cache — user won't need to re-login */
    currentUser = cachedUser;
    document.body.classList.remove('guest-mode');
    hideAuthModal();
    try { populateUserUI(cachedUser); } catch(_) {}
    bootApp(cachedUser.uid);
    showToast('📶 Offline mode — showing your cached data', 't-info', 4000);
  } else {
    /* No cached session — boot as guest so app is usable */
    currentUser = null;
    document.body.classList.add('guest-mode');
    bootGuestMode();
  }
}, 5000);

AUTH.onAuthStateChanged(user => {
  /* Firebase responded — cancel the fallback timer immediately */
  clearTimeout(_authFallbackTimer);

  /* If fallback already ran, handle sign-in/out transitions only */
  if (_authBooted) {
    currentUser = user || null;
    if (user) {
      document.body.classList.remove('guest-mode');
      hideAuthModal();
      populateUserUI(user);
      bootApp(user.uid);
    } else {
      document.body.classList.add('guest-mode');
      bootGuestMode();
    }
    return;
  }

  /* Normal first-boot path */
  _authBooted = true;
  hideAuthLoader();
  currentUser = user || null;

  if (user) {
    document.body.classList.remove('guest-mode');
    hideAuthModal();
    populateUserUI(user);
    bootApp(user.uid);
  } else {
    document.body.classList.add('guest-mode');
    bootGuestMode();
  }
});

/* ════════════════════════════════════════════════════════════
   ⑪  USER UI — populate sidebar chip + settings profile card
   ════════════════════════════════════════════════════════════ */
const getInitials = name => {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(w => w[0].toUpperCase()).slice(0, 2).join('');
};

const populateUserUI = user => {
  const name     = user.displayName || user.email.split('@')[0];
  const email    = user.email || '';
  const initials = getInitials(name);
  const photoURL = user.photoURL;
  const provider = (user.providerData[0]?.providerId || 'password') === 'google.com' ? 'Google' : 'Email';

  /* Sidebar chip */
  const ava = document.getElementById('suc-avatar');
  if (photoURL) {
    ava.innerHTML = `<img src="${photoURL}" alt="${escH(name)}" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  } else {
    ava.textContent = initials;
  }
  document.getElementById('suc-name').textContent  = name;
  document.getElementById('suc-email').textContent = email;

  /* Settings account card */
  const sa = document.getElementById('settings-avatar');
  if (sa) {
    if (photoURL) {
      sa.innerHTML = `<img src="${photoURL}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    } else {
      sa.textContent = initials;
    }
  }
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('settings-display-name',  name);
  setText('settings-email',         email);
  setText('settings-provider-tag',  provider);
  setText('settings-uid',           user.uid);
  setText('settings-verified',      user.emailVerified ? '✓ Yes' : '✗ No');
  setText('settings-created',       user.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', {year:'numeric',month:'short',day:'numeric'})
    : '—');
  setText('settings-lastlogin',     user.metadata?.lastSignInTime
    ? new Date(user.metadata.lastSignInTime).toLocaleDateString('en-US', {year:'numeric',month:'short',day:'numeric'})
    : '—');
};

/* ── Sidebar user chip flyout ── */
const sucFlyout  = document.getElementById('suc-flyout');
const sucMenuBtn = document.getElementById('suc-menu-btn');
sucMenuBtn.addEventListener('click', e => {
  e.stopPropagation();
  sucFlyout.classList.toggle('hidden');
});
document.addEventListener('click', () => sucFlyout.classList.add('hidden'));

document.getElementById('suc-signout-btn').addEventListener('click', handleSignOut);
document.getElementById('suc-profile-btn').addEventListener('click', () => {
  sucFlyout.classList.add('hidden');
  switchTab('settings');
});

/* ════════════════════════════════════════════════════════════
   ⑪b  AUTH MODAL CONTROLS
        Close button, backdrop click, guest sign-in buttons
   ════════════════════════════════════════════════════════════ */
document.getElementById('auth-modal-close').addEventListener('click', hideAuthModal);
authGate.addEventListener('click', e => { if (e.target === authGate) hideAuthModal(); });

/* All "Sign In" triggers throughout the guest UI */
const wireGuestSignIn = (id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', showAuthModal);
};
wireGuestSignIn('sidebar-guest-btn');
wireGuestSignIn('guest-banner-btn');

/* ════════════════════════════════════════════════════════════
   ⑪c  GUEST MODE — CAPTURE-PHASE INTERCEPTOR
        Intercepts clicks on locked interactive elements
        before any existing handlers can fire.
   ════════════════════════════════════════════════════════════ */
const LOCKED_SELECTORS = [
  '#add-btn', '.task-input', '.edit-btn', '.delete-btn', '.task-check',
  '.notes-btn', '.drag-handle',
  '#pomo-start', '#pomo-reset', '#pomo-skip',
  '#fs-start', '#fs-reset', '#fs-skip',
  '#fullscreen-btn',
  '#bulk-toggle-btn', '#bulk-complete', '#bulk-delete', '#bulk-priority-btn',
  '#export-btn', '#import-btn',
  '#settings-export', '#settings-import', '#settings-clear',
  '.settings-action-btn', '.toggle-btn',
  '.pomo-mode-btn', '.set-input',
  '.p-chip', '.date-input', '#due-date', '#recur-select',
];

document.addEventListener('click', e => {
  if (currentUser) return;  /* authenticated — allow everything */
  /* Never intercept navigation — nav items must always work in guest mode */
  if (e.target.closest('.nav-item')) return;
  if (e.target.closest('.sidebar-guest-btn')) return;
  if (e.target.closest('.guest-banner-btn')) return;
  if (e.target.closest('.auth-modal-close')) return;
  if (e.target.closest('#hamburger')) return;
  if (e.target.closest('#sidebar-close')) return;
  if (e.target.closest('#theme-toggle')) return;
  if (e.target.closest('#sound-toggle')) return;
  if (e.target.closest('#cmd-trigger')) return;
  const isLocked = LOCKED_SELECTORS.some(sel => e.target.closest(sel));
  if (isLocked) {
    e.preventDefault();
    e.stopImmediatePropagation();
    showAuthModal();
  }
}, true); /* ← capture phase */

/* Also block keyboard entry in task input for guests */
document.addEventListener('keydown', e => {
  if (currentUser) return;
  const inTaskInput = e.target.closest('#task-input');
  if (inTaskInput && e.key !== 'Tab') {
    e.preventDefault();
    e.stopImmediatePropagation();
    showAuthModal();
  }
}, true);

/* Block drag events for guests */
document.addEventListener('dragstart', e => {
  if (currentUser) return;
  if (e.target.closest('.task-item')) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

/* Block touch-swipe actions for guests */
let _guestTouchBlocked = false;
document.addEventListener('touchstart', e => {
  if (currentUser) return;
  if (e.target.closest('.task-item .task-check') ||
      e.target.closest('.task-item .edit-btn') ||
      e.target.closest('.task-item .delete-btn')) {
    _guestTouchBlocked = true;
  }
}, { capture: true, passive: true });
document.addEventListener('touchend', e => {
  if (_guestTouchBlocked) {
    _guestTouchBlocked = false;
    showAuthModal();
  }
}, { capture: true, passive: true });

/* ════════════════════════════════════════════════════════════
   ⑫  UID-SCOPED STORAGE KEYS
       Every key is prefixed with the user's UID so multiple
       accounts on the same browser stay completely isolated.
       Swap these read/write helpers for Firestore calls later.
   ════════════════════════════════════════════════════════════ */
let LS = {
  TASKS:   'taskr_tasks',
  FILTER:  'taskr_filter',
  THEME:   'taskr_theme',
  STREAK:  'taskr_streak',
  HISTORY: 'taskr_history',
  POMO:    'taskr_pomo_sets',
};

const scopeStorageKeys = uid => {
  LS = {
    TASKS:   `taskr_${uid}_tasks`,
    FILTER:  `taskr_${uid}_filter`,
    THEME:   `taskr_theme`,         /* theme is device-level, not per-user */
    STREAK:  `taskr_${uid}_streak`,
    HISTORY: `taskr_${uid}_history`,
    POMO:    `taskr_${uid}_pomo_sets`,
  };
};

/* ════════════════════════════════════════════════════════════
   ════════════════════════════════════════════════════════════
   ORIGINAL TASKR APPLICATION CODE — 100% PRESERVED
   Only changes:
     • LS keys are now UID-scoped (set in bootApp below)
     • INIT block moved into bootApp() so it runs post-auth
     • initSettingsPage() wires signout buttons
   ════════════════════════════════════════════════════════════
   ════════════════════════════════════════════════════════════ */

/* ── Helpers ── */
const isGuest = () => document.body.classList.contains('guest-mode');
const uid     = () => Math.random().toString(36).slice(2, 9);
const today   = () => new Date().toISOString().slice(0, 10);
const escH    = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmt     = s => { if (!s) return ''; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}); };
const fmtShort= s => { if (!s) return ''; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-US', {month:'short',day:'numeric'}); };
const overdue = s => { if (!s) return false; const t = new Date(); t.setHours(0,0,0,0); return new Date(s+'T00:00:00') < t; };
const rel     = ts => {
  const d=Date.now()-ts, m=Math.floor(d/6e4), h=Math.floor(d/36e5), dy=Math.floor(d/864e5);
  if (m < 1) return 'just now'; if (m < 60) return m+'m ago';
  if (h < 24) return h+'h ago'; if (dy < 7) return dy+'d ago';
  return new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric'});
};

/* ── Load / Save ── */
const load = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const save = (k, v)   => localStorage.setItem(k, JSON.stringify(v));

/* ── STATE (declared here, populated in bootApp) ── */
let tasks        = [];
Object.defineProperty(window, 'tasks', { get: () => tasks, configurable: true });
let filter       = 'all';
let selPri       = 'low';
let dragId       = null;
let lastAllDone  = false;
let history      = {};
let streak       = { count: 0, lastDate: '' };
let searchQuery  = '';
let bulkMode     = false;
let bulkSelected = new Set();
let soundOn      = localStorage.getItem('taskr_sound') !== '0';
let undoStack    = [];
let undoTimer    = null;
let calWeekOffset = 0;
let animationsReduced = localStorage.getItem('taskr_reduce_anim') === '1';

/* ── DOM shortcuts ── */
const $ = id => document.getElementById(id);

const tl         = $('task-list');
const inp        = $('task-input');
const addBtn     = $('add-btn');
const ddInp      = $('due-date');
const empState   = $('empty-state');
const pFill      = $('progress-fill');
const pPct       = $('progress-pct');
const sDone      = $('stat-done');
const sTotal     = $('stat-total');
const sDoneTop   = $('stat-done-top');
const sTotalTop  = $('stat-total-top');
const confCanvas = $('confetti-canvas');
const confCtx    = confCanvas.getContext('2d');
const inputBar   = $('input-bar');
const taskTpl    = $('task-tpl');
const searchInput= $('search-input');
const searchClear= $('search-clear');
const toastCont  = $('toast-container');
const autoSaveEl = $('autosave-indicator');
const autoSaveLbl= $('autosave-label');
const cmdOverlay = $('cmd-overlay');
const cmdInput   = $('cmd-input');
const cmdResults = $('cmd-results');
const bulkBar    = $('bulk-bar');
const bulkCount  = $('bulk-count');
const bulkToggle = $('bulk-toggle-btn');
const undoBanner = $('undo-banner');
const undoMsg    = $('undo-msg');
const undoBar    = $('undo-bar');
const ringFill   = $('ring-fill');
const pomoTime   = $('pomo-time');
const pomoLabel  = $('pomo-label');
const pomoStart  = $('pomo-start');
const pomoDots   = $('pomo-dots');
const pomoCount  = $('pomo-count');

/* ═══════════════════════════════════════════
   THEME
═══════════════════════════════════════════ */
const applyTheme = t => {
  document.documentElement.setAttribute('data-theme', t);
  const metaTheme = $('meta-theme');
  if (metaTheme) metaTheme.content = t === 'dark' ? '#0c0e12' : '#f0f2f6';
  save(LS.THEME, t);
  const st = $('settings-theme-toggle');
  if (st) st.classList.toggle('on', t === 'dark');
};
const toggleTheme = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
};
$('theme-toggle').addEventListener('click', toggleTheme);
applyTheme(load('taskr_theme', 'dark')); /* theme loads immediately, pre-auth */

/* ═══════════════════════════════════════════
   SOUND
═══════════════════════════════════════════ */
const updateSoundBtn = () => {
  const sb = $('sound-toggle');
  if (sb) { sb.textContent = soundOn ? '🔊' : '🔇'; sb.title = soundOn ? 'Sound on' : 'Sound off'; }
  const st = $('settings-sound-toggle');
  if (st) st.classList.toggle('on', soundOn);
};
updateSoundBtn();

$('sound-toggle').addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('taskr_sound', soundOn ? '1' : '0');
  updateSoundBtn();
  showToast(soundOn ? 'Sound enabled' : 'Sound muted', 't-info', 2000);
});

const playClick = (freq = 660, dur = 0.12) => {
  if (!soundOn) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ac.createOscillator(); const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.start(); osc.stop(ac.currentTime + dur);
  } catch {}
};

const playBeep = () => {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ac.createOscillator(); const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.type = 'sine'; osc.frequency.value = 880;
    gain.gain.setValueAtTime(.4, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, ac.currentTime + .8);
    osc.start(); osc.stop(ac.currentTime + .8);
  } catch {}
};

/* ═══════════════════════════════════════════
   SIDEBAR NAVIGATION
═══════════════════════════════════════════ */
const sidebar        = $('sidebar');
const sidebarOverlay = $('sidebar-overlay');
const hamburger      = $('hamburger');
const sidebarClose   = $('sidebar-close');

const openSidebar = () => {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('visible');
  hamburger.setAttribute('aria-expanded', 'true');
};
const closeSidebar = () => {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('visible');
  hamburger.setAttribute('aria-expanded', 'false');
};

hamburger.addEventListener('click', () => {
  sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
});
sidebarClose.addEventListener('click', closeSidebar);
/* Overlay: close sidebar only when tapping the dark backdrop area,
   never when the tap originated inside the sidebar itself. */
sidebarOverlay.addEventListener('click', closeSidebar);

/* ═══════════════════════════════════════════
   TAB SWITCHING
═══════════════════════════════════════════ */
const PAGE_TITLES = {
  tasks:'Tasks', analytics:'Analytics', calendar:'Calendar', focus:'Focus', settings:'Settings',
};

const switchTab = name => {
  document.querySelectorAll('.nav-item').forEach(b => {
    const active = b.dataset.tab === name;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = $('tab-' + name);
  if (panel) panel.classList.add('active');
  inputBar.classList.toggle('hidden', name !== 'tasks');
  const tt = $('topbar-title');
  if (tt) tt.textContent = PAGE_TITLES[name] || name;
  /* Close sidebar first on mobile so overlay is gone before render */
  if (window.innerWidth <= 768) closeSidebar();
  if (name === 'analytics') renderDashboardFull();
  if (name === 'focus')     syncPomoTaskList();
  if (name === 'calendar')  renderCalendar();
  if (name === 'settings')  initSettingsPage();
};

document.querySelectorAll('.nav-item').forEach(btn => {
  /* Use both click and touchend so mobile taps register reliably.
     stopPropagation prevents the tap from reaching the overlay. */
  const onNav = e => {
    e.stopPropagation();
    switchTab(btn.dataset.tab);
  };
  btn.addEventListener('click',    onNav);
  btn.addEventListener('touchend', onNav, { passive: true });
});

/* ═══════════════════════════════════════════
   PRIORITY CHIPS
═══════════════════════════════════════════ */
document.querySelectorAll('.p-chip').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.p-chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    selPri = c.dataset.p;
  });
});

/* ═══════════════════════════════════════════
   STREAK
═══════════════════════════════════════════ */
const updateStreak = () => {
  const d = today();
  if (streak.lastDate === d) return;
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  streak.count = (streak.lastDate === yStr || streak.lastDate === '') ? streak.count + 1 : 1;
  streak.lastDate = d;
  save(LS.STREAK, streak);
};

/* ═══════════════════════════════════════════
   AUTOSAVE INDICATOR
═══════════════════════════════════════════ */
let autoSaveTimer = null;
const showAutosave = () => {
  autoSaveEl.classList.add('saving', 'visible');
  autoSaveLbl.textContent = 'Saving…';
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveEl.classList.remove('saving');
    autoSaveLbl.textContent = 'Saved';
    autoSaveTimer = setTimeout(() => autoSaveEl.classList.remove('visible'), 1400);
  }, 600);
};
const saveWithIndicator = (k, v) => { save(k, v); if (k === LS.TASKS) showAutosave(); };

/* ═══════════════════════════════════════════
   TOAST SYSTEM
═══════════════════════════════════════════ */
const showToast = (msg, type = 't-info', duration = 3200) => {
  const icons = { 't-success':'✓', 't-delete':'✕', 't-warning':'⚠', 't-info':'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ'}</span>
    <span class="toast-msg">${msg}</span>
    <button class="toast-close" aria-label="Dismiss">✕</button>
    <div class="toast-progress" style="animation-duration:${duration}ms"></div>`;
  const dismiss = () => {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  el.querySelector('.toast-close').addEventListener('click', dismiss);
  el.addEventListener('click', dismiss);
  toastCont.appendChild(el);
  const t = setTimeout(dismiss, duration);
  el.addEventListener('mouseenter', () => clearTimeout(t));
  el.addEventListener('mouseleave', () => setTimeout(dismiss, 800));
};

/* ═══════════════════════════════════════════
   UNDO SYSTEM
═══════════════════════════════════════════ */
const showUndo = (msg, restoreFn) => {
  clearTimeout(undoTimer);
  undoStack = [restoreFn];
  undoMsg.textContent = msg;
  undoBanner.classList.remove('hidden');
  undoBar.style.animation = 'none';
  void undoBar.offsetWidth;
  undoBar.style.animation = 'undo-timer 5s linear forwards';
  undoTimer = setTimeout(() => undoBanner.classList.add('hidden'), 5000);
};
$('undo-btn').addEventListener('click', () => {
  if (undoStack.length) undoStack.pop()();
  undoBanner.classList.add('hidden');
  clearTimeout(undoTimer);
});

/* ═══════════════════════════════════════════
   VISIBLE FILTER
═══════════════════════════════════════════ */
const visible = () => {
  const todayStr = today();
  if (filter === 'active')  return tasks.filter(t => !t.done);
  if (filter === 'done')    return tasks.filter(t =>  t.done);
  if (filter === 'high')    return tasks.filter(t => t.pri === 'high' || t.pri === 'urgent');
  if (filter === 'today')   return tasks.filter(t => t.due === todayStr && !t.done);
  if (filter === 'overdue') return tasks.filter(t => overdue(t.due) && !t.done);
  return [...tasks];
};

/* ═══════════════════════════════════════════
   BUILD TASK ELEMENT
═══════════════════════════════════════════ */
const buildTaskEl = t => {
  const clone = taskTpl.content.cloneNode(true);
  const li    = clone.querySelector('.task-item');
  li.dataset.id = t.id; li.dataset.p = t.pri;
  if (t.done) li.classList.add('done');
  if (overdue(t.due) && !t.done) li.classList.add('overdue');
  li.querySelector('.task-text').innerHTML = escH(t.text);
  const pm = { high:'● High', medium:'● Med', low:'● Low', urgent:'⚡ Urgent' };
  li.querySelector('.priority-badge').textContent = pm[t.pri] || '';
  const db = li.querySelector('.due-badge');
  if (t.due) db.textContent = `📅 ${fmt(t.due)}${overdue(t.due) && !t.done ? ' ⚠' : ''}`;
  li.querySelector('.created-badge').textContent = rel(t.at);
  const rb = li.querySelector('.recur-badge');
  if (t.recur) rb.textContent = `↻ ${t.recur}`;
  if (t.notes) {
    const ta = document.createElement('textarea');
    ta.className = 'task-notes-textarea'; ta.placeholder = 'Add notes…'; ta.value = t.notes;
    li.querySelector('.task-notes-content').appendChild(ta);
    li.classList.add('notes-open');
    ta.addEventListener('blur', () => { t.notes = ta.value; save(LS.TASKS, tasks); });
  }
  li.querySelector('.notes-btn').addEventListener('click', () => {
    const wrap = li.querySelector('.task-notes-content');
    const isOpen = li.classList.toggle('notes-open');
    if (isOpen && !wrap.querySelector('textarea')) {
      const ta = document.createElement('textarea');
      ta.className = 'task-notes-textarea'; ta.placeholder = 'Add notes…'; ta.value = t.notes || '';
      wrap.appendChild(ta);
      requestAnimationFrame(() => ta.focus());
      ta.addEventListener('blur', () => { t.notes = ta.value; save(LS.TASKS, tasks); });
    }
  });
  const bellBtn = li.querySelector('.reminder-btn');
  if (bellBtn) bellBtn.dataset.taskId = t.id;
  return li;
};
window._nexaRender = () => render(); // expose render for reminders.js

/* ═══════════════════════════════════════════
   RENDER
═══════════════════════════════════════════ */
const render = () => {
  Array.from(tl.children).forEach(c => { if (!c.classList.contains('removing')) c.remove(); });
  let vis = visible();
  if (searchQuery) {
    vis = vis.filter(t =>
      t.text.toLowerCase().includes(searchQuery) ||
      (t.notes && t.notes.toLowerCase().includes(searchQuery))
    );
  }
  vis.forEach(t => tl.appendChild(buildTaskEl(t)));
  const hasTasks = vis.length > 0;
  empState.classList.toggle('hidden', hasTasks || !!searchQuery);
  $('search-empty-state').classList.toggle('hidden', !searchQuery || hasTasks);
  const tot = tasks.length, don = tasks.filter(t => t.done).length;
  const pct = tot ? Math.round(don / tot * 100) : 0;
  if (sDone)    sDone.textContent    = don;
  if (sTotal)   sTotal.textContent   = tot;
  if (sDoneTop)  sDoneTop.textContent  = don;
  if (sTotalTop) sTotalTop.textContent = tot;
  const statStreak = $('stat-streak');
  if (statStreak) statStreak.textContent = streak.count + '🔥';
  if (pFill) pFill.style.width = pct + '%';
  if (pPct)  pPct.textContent  = pct + '%';
  $('fc-all').textContent     = tasks.length;
  $('fc-act').textContent     = tasks.filter(t => !t.done).length;
  $('fc-don').textContent     = tasks.filter(t =>  t.done).length;
  $('fc-hi').textContent      = tasks.filter(t => t.pri === 'high' || t.pri === 'urgent').length;
  $('fc-today').textContent   = tasks.filter(t => t.due === today() && !t.done).length;
  $('fc-overdue').textContent = tasks.filter(t => overdue(t.due) && !t.done).length;
  const navBadgeTasks    = $('nav-badge-tasks');
  const navBadgeCalendar = $('nav-badge-calendar');
  if (navBadgeTasks)    navBadgeTasks.textContent    = tasks.filter(t => !t.done).length || '';
  if (navBadgeCalendar) navBadgeCalendar.textContent = tasks.filter(t => overdue(t.due) && !t.done).length || '';
};

/* ═══════════════════════════════════════════
   CONFETTI
═══════════════════════════════════════════ */
const checkAllDone = () => {
  if (!tasks.length) { lastAllDone = false; return; }
  const allDone = tasks.every(t => t.done);
  if (allDone && !lastAllDone) { lastAllDone = true; launchConfetti(); }
  else if (!allDone) lastAllDone = false;
};

const launchConfetti = () => {
  confCanvas.width = window.innerWidth; confCanvas.height = window.innerHeight;
  const COLS = ['#b8ff00','#ff4d6d','#3dd6f5','#ffb300','#fff','#8fc800'];
  const ps = Array.from({length: 200}, () => ({
    x: Math.random() * confCanvas.width,
    y: Math.random() * confCanvas.height - confCanvas.height,
    w: 5 + Math.random() * 9, h: 3 + Math.random() * 5,
    r: Math.random() * Math.PI * 2, rd: (Math.random() - .5) * .14,
    vx: (Math.random() - .5) * 4, vy: 1.5 + Math.random() * 4,
    col: COLS[Math.floor(Math.random() * COLS.length)],
  }));
  let raf;
  const draw = () => {
    confCtx.clearRect(0, 0, confCanvas.width, confCanvas.height);
    let alive = 0;
    ps.forEach(p => {
      if (p.y > confCanvas.height + 20) return; alive++;
      p.x += p.vx; p.y += p.vy; p.r += p.rd; p.vy += .055;
      confCtx.save(); confCtx.translate(p.x, p.y); confCtx.rotate(p.r);
      confCtx.globalAlpha = Math.max(0, 1 - p.y / (confCanvas.height * 1.1));
      confCtx.fillStyle = p.col; confCtx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      confCtx.restore();
    });
    if (alive > 0) raf = requestAnimationFrame(draw);
    else confCtx.clearRect(0, 0, confCanvas.width, confCanvas.height);
  };
  cancelAnimationFrame(raf); draw();
  setTimeout(() => { cancelAnimationFrame(raf); confCtx.clearRect(0, 0, confCanvas.width, confCanvas.height); }, 4500);
};

/* ═══════════════════════════════════════════
   ADD TASK
═══════════════════════════════════════════ */
const addTask = () => {
  const text  = inp.value.trim();
  const recur = $('recur-select')?.value || '';
  if (!text) {
    inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake');
    inp.addEventListener('animationend', () => inp.classList.remove('shake'), { once: true });
    inp.focus(); playClick(220, 0.15); return;
  }
  const t = { id: uid(), text, done: false, pri: selPri, due: ddInp.value || null, recur: recur || null, notes: '', at: Date.now() };
  tasks.unshift(t);
  saveWithIndicator(LS.TASKS, tasks);
  inp.value = ''; ddInp.value = '';
  if ($('recur-select')) $('recur-select').value = '';
  inp.focus();
  render(); syncPomoTaskList(); checkAllDone();
  playClick(660, 0.1);
};
addBtn.addEventListener('click', addTask);
inp.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });

/* ═══════════════════════════════════════════
   TASK LIST EVENT DELEGATION (FIXED)
═══════════════════════════════════════════ */

tl.addEventListener('click', e => {
  const li = e.target.closest('.task-item');
  if (!li) return;

  // Let reminders.js handle bell clicks — don't interfere
  if (e.target.closest('.reminder-btn')) return;

  const id = li.dataset.id;

  // ✅ CHECKBOX / COMPLETE TASK
  if (e.target.closest('.task-check')) {
    if (isGuest()) {
      requireAuth("complete tasks");
      return;
    }

    const t = tasks.find(x => x.id === id);
    if (!t) return;

    t.done = !t.done;

    if (t.done) {
      const d = today();
      history[d] = (history[d] || 0) + 1;
      save(LS.HISTORY, history);
      updateStreak();
      showToast('Task completed! 🎉', 't-success', 2400);
      playClick(880, 0.18);
    } else {
      playClick(440, 0.1);
    }

    saveWithIndicator(LS.TASKS, tasks);
    render();
    checkAllDone();
  }

  // ❌ DELETE TASK
  if (e.target.closest('.delete-btn')) {
    if (isGuest()) {
      requireAuth("delete tasks");
      return;
    }

    const snapshot = [...tasks];
    const li2 = tl.querySelector(`[data-id="${id}"]`);
    if (!li2) return;

    li2.classList.add('removing');
    playClick(300, 0.12);

    li2.addEventListener('animationend', () => {
      tasks = tasks.filter(x => x.id !== id);

      saveWithIndicator(LS.TASKS, tasks);
      render();
      syncPomoTaskList();

      showToast('Task deleted', 't-delete', 4500);

      showUndo('Task deleted', () => {
        tasks = snapshot;
        saveWithIndicator(LS.TASKS, tasks);
        render();
        syncPomoTaskList();
        showToast('Task restored', 't-success', 2000);
      });
    }, { once: true });
  }

  // ✏️ EDIT BUTTON
  if (e.target.closest('.edit-btn')) {
    if (isGuest()) {
      requireAuth("edit tasks");
      return;
    }

    startEdit(id);
  }
});


/* ═══════════════════════════════════════════
   DOUBLE CLICK EDIT
═══════════════════════════════════════════ */

tl.addEventListener('dblclick', e => {
  const li = e.target.closest('.task-item');
  if (!li) return;

  if (e.target.closest('.task-text')) {
    if (isGuest()) {
      requireAuth("edit tasks");
      return;
    }

    startEdit(li.dataset.id);
  }
});

/* ═══════════════════════════════════════════
   INLINE EDIT
═══════════════════════════════════════════ */
const startEdit = id => {
  const li = tl.querySelector(`[data-id="${id}"]`); if (!li) return;
  const sp = li.querySelector('.task-text'), t = tasks.find(x => x.id === id); if (!t) return;
  sp.contentEditable = 'true'; sp.focus();
  const rng = document.createRange(); rng.selectNodeContents(sp); rng.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
  const done = () => {
    const v = sp.innerText.trim(); sp.contentEditable = 'false';
    if (v) { t.text = v; save(LS.TASKS, tasks); } else sp.innerText = t.text;
    syncPomoTaskList();
  };
  sp.addEventListener('blur', done, { once: true });
  sp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sp.blur(); }
    if (e.key === 'Escape') { sp.innerText = t.text; sp.blur(); }
  });
};

/* ═══════════════════════════════════════════
   DRAG & DROP
═══════════════════════════════════════════ */
tl.addEventListener('dragstart', e => {
  if (!requireAuth("reorder tasks")) return;

  const li = e.target.closest('.task-item'); if (!li) return;
  dragId = li.dataset.id; li.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
});
tl.addEventListener('dragend', () => {
  tl.querySelectorAll('.is-dragging, .drag-over').forEach(el => el.classList.remove('is-dragging','drag-over'));
});
tl.addEventListener('dragover', e => {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  const li = e.target.closest('.task-item'); if (!li || li.dataset.id === dragId) return;
  tl.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
  li.classList.add('drag-over');
});
tl.addEventListener('drop', e => {
  e.preventDefault();
  const tgt = e.target.closest('.task-item');
  if (!tgt || tgt.dataset.id === dragId) return;
  const si = tasks.findIndex(x => x.id === dragId), ti = tasks.findIndex(x => x.id === tgt.dataset.id);
  if (si < 0 || ti < 0) return;
  const [m] = tasks.splice(si, 1); tasks.splice(ti, 0, m);
  save(LS.TASKS, tasks); render();
});

/* ── Touch swipe ── */
let tx0 = 0, tLi = null;

tl.addEventListener('touchstart', e => {
  const li = e.target.closest('.task-item');
  if (!li) return;
  tx0 = e.touches[0].clientX;
  tLi = li;
}, { passive: true });

tl.addEventListener('touchmove', e => {
  if (!tLi) return;
  const dx = e.touches[0].clientX - tx0;
  tLi.style.transform = `translateX(${Math.max(-80, Math.min(80, dx))}px)`;
}, { passive: true });

tl.addEventListener('touchend', e => {
  if (!tLi) return;

  const dx = e.changedTouches[0].clientX - tx0;
  tLi.style.transform = '';

  const id = tLi.dataset.id;

  /* ── SWIPE LEFT → DELETE ── */
  if (dx < -75) {
    if (!requireAuth("delete tasks")) {
      tLi = null;
      return;
    }

    const snapshot = [...tasks];
    tLi.classList.add('removing');

    tLi.addEventListener('animationend', () => {
      tasks = tasks.filter(x => x.id !== id);
      saveWithIndicator(LS.TASKS, tasks);
      render();
      syncPomoTaskList();

      showToast('Task deleted', 't-delete', 4500);

      showUndo('Task deleted', () => {
        tasks = snapshot;
        saveWithIndicator(LS.TASKS, tasks);
        render();
        syncPomoTaskList();
        showToast('Task restored', 't-success', 2000);
      });
    }, { once: true });
  }

  /* ── SWIPE RIGHT → COMPLETE ── */
  else if (dx > 75) {
    if (!requireAuth("complete tasks")) {
      tLi = null;
      return;
    }

    const t = tasks.find(x => x.id === id);
    if (!t) {
      tLi = null;
      return;
    }

    t.done = !t.done;

    if (t.done) {
      const d = today();
      history[d] = (history[d] || 0) + 1;
      save(LS.HISTORY, history);
      updateStreak();
      showToast('Task completed! 🎉', 't-success', 2400);
    }

    saveWithIndicator(LS.TASKS, tasks);
    render();
    checkAllDone();
  }

  tLi = null;
}, { passive: true });

/* ═══════════════════════════════════════════
   FILTERS
═══════════════════════════════════════════ */
document.querySelectorAll('.filter-btn').forEach(b => {
  b.classList.toggle('active', b.dataset.filter === filter);
  b.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); filter = b.dataset.filter; save(LS.FILTER, filter); render();
  });
});

/* ═══════════════════════════════════════════
   SEARCH
═══════════════════════════════════════════ */
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  searchClear.classList.toggle('hidden', !searchQuery); render();
});
searchClear.addEventListener('click', () => {
  searchInput.value = ''; searchQuery = ''; searchClear.classList.add('hidden'); searchInput.focus(); render();
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== searchInput && document.activeElement !== inp) {
    e.preventDefault(); searchInput.focus();
  }
});

/* ═══════════════════════════════════════════
   BULK ACTIONS
═══════════════════════════════════════════ */
const toggleBulkMode = () => {
  bulkMode = !bulkMode;
  document.body.classList.toggle('bulk-mode', bulkMode);
  bulkToggle.classList.toggle('active', bulkMode);
  if (!bulkMode) { bulkSelected.clear(); bulkBar.classList.add('hidden'); render(); }
};
const updateBulkBar = () => {
  const n = bulkSelected.size;
  bulkBar.classList.toggle('hidden', n === 0);
  bulkCount.textContent = `${n} selected`;
};
bulkToggle.addEventListener('click', toggleBulkMode);
$('bulk-cancel').addEventListener('click', () => {
  bulkSelected.clear(); bulkMode = false;
  document.body.classList.remove('bulk-mode'); bulkToggle.classList.remove('active');
  bulkBar.classList.add('hidden'); render();
});
$('bulk-complete').addEventListener('click', () => {
  const ids = [...bulkSelected];
  ids.forEach(id => { const t = tasks.find(x => x.id === id); if (t && !t.done) { t.done = true; const d = today(); history[d] = (history[d] || 0) + 1; } });
  save(LS.HISTORY, history); saveWithIndicator(LS.TASKS, tasks);
  bulkSelected.clear(); updateBulkBar(); render(); checkAllDone();
  showToast(`${ids.length} task${ids.length!==1?'s':''} completed`, 't-success');
});
$('bulk-delete').addEventListener('click', () => {
  const ids = [...bulkSelected]; const snapshot = [...tasks];
  tasks = tasks.filter(t => !ids.includes(t.id)); saveWithIndicator(LS.TASKS, tasks);
  bulkSelected.clear(); updateBulkBar(); render(); syncPomoTaskList();
  showToast(`${ids.length} task${ids.length!==1?'s':''} deleted`, 't-delete');
  showUndo(`${ids.length} deleted`, () => { tasks = snapshot; saveWithIndicator(LS.TASKS, tasks); render(); syncPomoTaskList(); showToast('Restored', 't-success', 2000); });
});
$('bulk-priority-btn').addEventListener('click', () => {
  const pris = ['low','medium','high','urgent'];
  const t = tasks.find(x => bulkSelected.has(x.id));
  const next = pris[(pris.indexOf(t?.pri || 'low') + 1) % pris.length];
  bulkSelected.forEach(id => { const tk = tasks.find(x => x.id === id); if (tk) tk.pri = next; });
  saveWithIndicator(LS.TASKS, tasks); render();
  showToast(`Priority set to ${next}`, 't-info', 2000);
});
tl.addEventListener('change', e => {
  if (!e.target.classList.contains('bulk-checkbox')) return;
  const li = e.target.closest('.task-item'); if (!li) return;
  const id = li.dataset.id;
  if (e.target.checked) { bulkSelected.add(id); li.classList.add('bulk-selected'); }
  else { bulkSelected.delete(id); li.classList.remove('bulk-selected'); }
  updateBulkBar();
});

/* ═══════════════════════════════════════════
   EXPORT / IMPORT
═══════════════════════════════════════════ */
const exportTasks = () => {
  const data = { tasks, history, streak, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `taskr-backup-${today()}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  showToast('Tasks exported!', 't-success', 2500);
};
const importTasks = () => $('import-file').click();

$('export-btn').addEventListener('click', exportTasks);
$('import-btn').addEventListener('click', importTasks);
$('import-file').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (Array.isArray(data.tasks)) {
        const snapshot = [...tasks]; tasks = data.tasks;
        if (data.history) { history = data.history; save(LS.HISTORY, history); }
        if (data.streak)  { streak  = data.streak;  save(LS.STREAK, streak); }
        saveWithIndicator(LS.TASKS, tasks); render(); syncPomoTaskList();
        showToast(`Imported ${tasks.length} tasks`, 't-success');
        showUndo('Import applied', () => { tasks = snapshot; saveWithIndicator(LS.TASKS, tasks); render(); syncPomoTaskList(); showToast('Import undone', 't-info', 2000); });
      } else { showToast('Invalid file format', 't-warning'); }
    } catch { showToast('Could not parse file', 't-warning'); }
  };
  reader.readAsText(file); e.target.value = '';
});

/* ═══════════════════════════════════════════
   DASHBOARD / ANALYTICS
═══════════════════════════════════════════ */
const renderDashboard = () => {
  const tot = tasks.length, don = tasks.filter(t => t.done).length;
  const hi = tasks.filter(t => t.pri === 'high').length;
  const md = tasks.filter(t => t.pri === 'medium').length;
  const lo = tasks.filter(t => t.pri === 'low').length;
  const el = id => $(id);
  if (el('d-total-done')) el('d-total-done').textContent = don;
  if (el('d-streak'))     el('d-streak').innerHTML = streak.count + '<span class="streak-fire">🔥</span>';
  if (el('d-pending'))    el('d-pending').textContent = tasks.filter(t => !t.done).length;
  const weekDays = Array.from({length:7}, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d.toISOString().slice(0,10); });
  const weekTotal = weekDays.reduce((s, d) => s + (history[d] || 0), 0);
  const weekAdded = tasks.filter(t => new Date(t.at) >= new Date(weekDays[0]+'T00:00:00')).length;
  const weekRate  = weekAdded ? Math.round((weekTotal / (weekAdded + weekTotal)) * 100) : (weekTotal ? 100 : 0);
  if (el('d-rate')) el('d-rate').textContent = weekRate + '%';
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const wc = $('weekly-chart'); if (!wc) return;
  wc.innerHTML = '';
  const maxCount = Math.max(1, ...weekDays.map(d => history[d] || 0));
  weekDays.forEach(d => {
    const cnt = history[d] || 0; const pct = Math.round((cnt / maxCount) * 100);
    const isToday = d === today(); const dayObj = new Date(d + 'T00:00:00');
    const col = document.createElement('div'); col.className = 'chart-col';
    col.innerHTML = `<span class="chart-count">${cnt || ''}</span><div class="chart-bar-wrap"><div class="chart-bar" style="height:60px"><div class="chart-bar-fill${isToday?' today':''}" style="height:${pct}%"></div></div></div><span class="chart-day">${dayNames[dayObj.getDay()]}</span>`;
    wc.appendChild(col);
  });
  const dashWeek = $('dash-week');
  if (dashWeek) {
    const start = new Date(weekDays[0]+'T00:00:00'); const end = new Date(weekDays[6]+'T00:00:00');
    dashWeek.textContent = `${start.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${end.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
  }
  const pb = $('priority-breakdown'); if (!pb) return;
  pb.innerHTML = '';
  const max2 = Math.max(1, hi, md, lo);
  [['High','hi',hi],['Med','md',md],['Low','lo',lo]].forEach(([lbl, cls, cnt]) => {
    const row = document.createElement('div'); row.className = 'pbd-row';
    row.innerHTML = `<span class="pbd-label ${cls}">${lbl}</span><div class="pbd-bar-wrap"><div class="pbd-bar ${cls}" style="width:${Math.round(cnt/max2*100)}%"></div></div><span class="pbd-count">${cnt}</span>`;
    pb.appendChild(row);
  });
  const done = tasks.filter(t => t.done).slice(0, 8);
  const rl = $('recent-list'); if (!rl) return;
  rl.innerHTML = '';
  $('empty-recent').classList.toggle('hidden', done.length > 0);
  done.forEach(t => {
    const li = document.createElement('li'); li.className = 'recent-item';
    li.innerHTML = `<span class="ri-check">✔</span><span class="ri-text">${escH(t.text)}</span><span class="ri-time">${rel(t.at)}</span>`;
    rl.appendChild(li);
  });
};

/* ═══════════════════════════════════════════
   HEATMAP
═══════════════════════════════════════════ */
const renderHeatmap = () => {
  const grid = $('heatmap-grid'); if (!grid) return;
  grid.innerHTML = '';
  const WEEKS = 12; const now = new Date();
  const end = new Date(now); end.setHours(23,59,59,999);
  const start = new Date(end); start.setDate(start.getDate() - (WEEKS * 7 - 1));
  const dow = start.getDay(); const offset = (dow === 0) ? 6 : dow - 1;
  start.setDate(start.getDate() - offset);
  const maxVal = Math.max(1, ...Object.values(history));
  let d = new Date(start);
  while (d <= end) {
    const ds = d.toISOString().slice(0,10); const cnt = history[ds] || 0;
    const lvl = cnt === 0 ? 0 : cnt <= maxVal*.25 ? 1 : cnt <= maxVal*.5 ? 2 : cnt <= maxVal*.75 ? 3 : 4;
    const cell = document.createElement('div');
    cell.className = 'hm-cell-item'; cell.setAttribute('data-level', lvl);
    cell.setAttribute('title', `${ds}: ${cnt} task${cnt!==1?'s':''}`);
    const tip = document.createElement('span'); tip.className = 'hm-tooltip';
    tip.textContent = `${cnt} on ${new Date(ds+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
    cell.appendChild(tip); grid.appendChild(cell);
    d.setDate(d.getDate() + 1);
  }
};

const renderDashboardFull = () => {
  renderDashboard(); renderHeatmap();
  const active = tasks.filter(t => !t.done).length;
  const done   = tasks.filter(t =>  t.done).length;
  const total  = tasks.length;
  const overdueCount = tasks.filter(t => overdue(t.due) && !t.done).length;
  const effEl = $('an-efficiency');
  if (effEl) effEl.textContent = total ? Math.round((done / total) * 100) + '%' : '—';
  const ovEl = $('an-overdue-rate');
  if (ovEl)  ovEl.textContent  = active ? Math.round((overdueCount / active) * 100) + '%' : '—';
  const bsEl = $('an-best-streak');
  const best = Math.max(streak.count, parseInt(localStorage.getItem('taskr_best_streak') || '0'));
  if (streak.count >= best) localStorage.setItem('taskr_best_streak', streak.count);
  if (bsEl) bsEl.textContent = Math.max(streak.count, best) + '🏆';
};

/* ═══════════════════════════════════════════
   CALENDAR PAGE
═══════════════════════════════════════════ */
const renderCalendar = () => {
  const now = new Date(); const dayOfWeek = now.getDay();
  const diffToMon = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() + diffToMon + calWeekOffset * 7); weekStart.setHours(0,0,0,0);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const calLabel = $('cal-week-label');
  if (calLabel) calLabel.textContent = `${weekStart.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${weekEnd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
  const grid = $('cal-week-grid'); if (!grid) return;
  grid.innerHTML = '';
  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']; const todayStr = today();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); const ds = d.toISOString().slice(0,10);
    const isToday = ds === todayStr;
    const col = document.createElement('div'); col.className = 'cal-day-col' + (isToday ? ' today' : '');
    const head = document.createElement('div'); head.className = 'cal-day-head';
    head.innerHTML = `<div class="cal-day-name">${dayNames[i]}</div><div class="cal-day-num">${d.getDate()}</div>`;
    col.appendChild(head);
    const dayTasks = tasks.filter(t => t.due === ds); const MAX_VISIBLE = 3;
    dayTasks.slice(0, MAX_VISIBLE).forEach(t => {
      const chip = document.createElement('div'); chip.className = `cal-task-chip pri-${t.pri}${t.done ? ' is-done' : ''}`;
      chip.textContent = t.text; chip.title = t.text; col.appendChild(chip);
    });
    if (dayTasks.length > MAX_VISIBLE) { const more = document.createElement('div'); more.className = 'cal-more'; more.textContent = `+${dayTasks.length - MAX_VISIBLE} more`; col.appendChild(more); }
    grid.appendChild(col);
  }
  const overdueList = $('cal-overdue-list'); const overdueEmpty = $('cal-overdue-empty');
  const overdueItems = tasks.filter(t => overdue(t.due) && !t.done).sort((a,b) => new Date(a.due) - new Date(b.due));
  if (overdueList) { overdueList.innerHTML = ''; overdueEmpty.classList.toggle('hidden', overdueItems.length > 0); overdueItems.forEach(t => overdueList.appendChild(buildCalTaskItem(t, 'var(--hi)'))); }
  const upcomingList = $('cal-upcoming-list'); const upcomingEmpty = $('cal-upcoming-empty');
  const in7 = new Date(); in7.setDate(in7.getDate() + 7);
  const upcomingItems = tasks.filter(t => { if (!t.due || t.done || overdue(t.due)) return false; return new Date(t.due + 'T00:00:00') <= in7; }).sort((a,b) => new Date(a.due) - new Date(b.due));
  if (upcomingList) { upcomingList.innerHTML = ''; upcomingEmpty.classList.toggle('hidden', upcomingItems.length > 0); upcomingItems.forEach(t => upcomingList.appendChild(buildCalTaskItem(t, 'var(--ac)'))); }
  const recurList = $('cal-recur-list'); const recurEmpty = $('cal-recur-empty');
  const recurItems = tasks.filter(t => t.recur && !t.done);
  if (recurList) { recurList.innerHTML = ''; recurEmpty.classList.toggle('hidden', recurItems.length > 0); recurItems.forEach(t => { const colors = { daily:'var(--lo)', weekly:'var(--md)', monthly:'var(--ug)' }; recurList.appendChild(buildCalTaskItem(t, colors[t.recur] || 'var(--tx3)', t.recur)); }); }
};

const buildCalTaskItem = (t, color, extraLabel) => {
  const li = document.createElement('li'); li.className = 'cal-task-item';
  li.innerHTML = `<span class="task-dot" style="background:${color}"></span><span class="task-name">${escH(t.text)}</span>${extraLabel ? `<span class="task-date">${extraLabel}</span>` : ''}${t.due && !extraLabel ? `<span class="task-date">${fmtShort(t.due)}</span>` : ''}`;
  return li;
};

$('cal-prev').addEventListener('click', () => { calWeekOffset--; renderCalendar(); });
$('cal-next').addEventListener('click', () => { calWeekOffset++; renderCalendar(); });
$('cal-today-btn').addEventListener('click', () => { calWeekOffset = 0; renderCalendar(); });

/* ═══════════════════════════════════════════
   SETTINGS PAGE
═══════════════════════════════════════════ */
const initSettingsPage = () => {
  const themeToggle = $('settings-theme-toggle');
  if (themeToggle) { themeToggle.classList.toggle('on', document.documentElement.getAttribute('data-theme') === 'dark'); themeToggle.onclick = toggleTheme; }
  const soundToggle = $('settings-sound-toggle');
  if (soundToggle) {
    soundToggle.classList.toggle('on', soundOn);
    soundToggle.onclick = () => { soundOn = !soundOn; localStorage.setItem('taskr_sound', soundOn ? '1' : '0'); updateSoundBtn(); soundToggle.classList.toggle('on', soundOn); showToast(soundOn ? 'Sound enabled' : 'Sound muted', 't-info', 2000); };
  }
  const animToggle = $('settings-anim-toggle');
  if (animToggle) {
    animToggle.classList.toggle('on', !animationsReduced);
    animToggle.onclick = () => { animationsReduced = !animationsReduced; localStorage.setItem('taskr_reduce_anim', animationsReduced ? '1' : '0'); document.body.classList.toggle('reduce-motion', animationsReduced); animToggle.classList.toggle('on', !animationsReduced); showToast(animationsReduced ? 'Animations reduced' : 'Animations enabled', 't-info', 2000); };
  }
  const exportBtn = $('settings-export'); if (exportBtn) exportBtn.onclick = exportTasks;
  const importBtnS = $('settings-import'); if (importBtnS) importBtnS.onclick = importTasks;
  const clearBtn = $('settings-clear');
  if (clearBtn) {
    clearBtn.onclick = () => {
      if (!confirm('This will permanently delete all tasks and history. Continue?')) return;
      tasks = []; history = {}; streak = { count: 0, lastDate: '' };
      saveWithIndicator(LS.TASKS, tasks); save(LS.HISTORY, history); save(LS.STREAK, streak);
      render(); showToast('All data cleared', 't-warning');
    };
  }
  /* ── Wire sign-out button in settings ── */
  const signoutBtn = $('settings-signout-btn');
  if (signoutBtn) signoutBtn.onclick = handleSignOut;
  /* ── Re-populate profile card with fresh user data ── */
  if (currentUser) populateUserUI(currentUser);
};

/* ═══════════════════════════════════════════
   POMODORO TIMER
═══════════════════════════════════════════ */
const POMO_LABELS  = { work: 'Focus Time', short: 'Short Break', long: 'Long Break' };
const CIRCUMFERENCE = 2 * Math.PI * 96;

let pomoSets    = { work: 25, short: 5, long: 15 }; /* loaded after auth in bootApp */
let pomoMode    = 'work';
let pomoTotal   = pomoSets.work * 60;
let pomoLeft    = pomoTotal;
let pomoRunning = false;
let pomoTick    = null;
let pomoSession = 0;

const fmtTime = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

const setPomoMode = mode => {
  pomoMode = mode; const secs = pomoSets[mode] * 60; pomoTotal = secs; pomoLeft = secs;
  clearInterval(pomoTick); pomoRunning = false; pomoStart.textContent = '▶ Start'; updatePomoUI();
};

const updatePomoUI = () => {
  const timeStr = fmtTime(pomoLeft);
  pomoTime.textContent = timeStr; pomoLabel.textContent = POMO_LABELS[pomoMode];
  const offset = CIRCUMFERENCE - (pomoLeft / pomoTotal) * CIRCUMFERENCE;
  ringFill.style.strokeDashoffset = offset;
  ringFill.style.stroke = pomoMode === 'work' ? 'var(--ac)' : pomoMode === 'short' ? 'var(--lo)' : 'var(--md)';
  pomoDots.innerHTML = '';
  for (let i = 0; i < 4; i++) { const d = document.createElement('div'); d.className = 'pomo-dot' + (i < pomoSession ? ' filled' : i === pomoSession && pomoRunning && pomoMode === 'work' ? ' active' : ''); pomoDots.appendChild(d); }
  pomoCount.textContent = `${pomoSession} / 4`;
  document.title = pomoRunning ? `${timeStr} — NEXA` : 'NEXA — Productivity Platform';
  const fsTime = $('fs-time'); const fsLabel = $('fs-label'); const fsDots = $('fs-dots'); const fsCount = $('fs-count');
  if (fsTime)  fsTime.textContent  = timeStr;
  if (fsLabel) fsLabel.textContent = POMO_LABELS[pomoMode];
  if (fsCount) fsCount.textContent = `${pomoSession} / 4`;
  if (fsDots) { fsDots.innerHTML = ''; for (let i = 0; i < 4; i++) { const d = document.createElement('div'); d.className = 'pomo-dot' + (i < pomoSession ? ' filled' : i === pomoSession && pomoRunning && pomoMode === 'work' ? ' active' : ''); fsDots.appendChild(d); } }
  const fsTask = $('fs-task'); const sel = $('pomo-task-select');
  if (fsTask && sel && sel.value) { const t = tasks.find(x => x.id === sel.value); fsTask.textContent = t ? t.text : ''; } else if (fsTask) { fsTask.textContent = ''; }
};

const tickPomo = () => {
  if (pomoLeft <= 0) {
    clearInterval(pomoTick); pomoRunning = false; pomoStart.textContent = '▶ Start'; playBeep();
    if (pomoMode === 'work') { pomoSession = Math.min(4, pomoSession + 1); if (pomoSession >= 4) { setPomoMode('long'); pomoSession = 0; } else setPomoMode('short'); }
    else { setPomoMode('work'); }
    if (Notification.permission === 'granted') new Notification('NEXA Pomodoro', { body: pomoMode === 'work' ? 'Break time!' : 'Focus time!', icon: 'icons/icon-192.png' });
    showToast(pomoMode === 'work' ? '🎉 Session complete! Time to break.' : '⏱ Break over. Back to focus!', 't-success', 3500);
    return;
  }
  pomoLeft--; updatePomoUI();
};

const startPausePomo = () => {
  if (pomoRunning) { clearInterval(pomoTick); pomoRunning = false; pomoStart.textContent = '▶ Resume'; $('fs-start') && ($('fs-start').textContent = '▶ Resume'); }
  else { pomoRunning = true; pomoStart.textContent = '⏸ Pause'; $('fs-start') && ($('fs-start').textContent = '⏸ Pause'); pomoTick = setInterval(tickPomo, 1000); }
  updatePomoUI();
};
const resetPomo = () => { clearInterval(pomoTick); pomoRunning = false; pomoStart.textContent = '▶ Start'; $('fs-start') && ($('fs-start').textContent = '▶ Start'); pomoLeft = pomoTotal; updatePomoUI(); };
const skipPomo  = () => {
  clearInterval(pomoTick); pomoRunning = false; pomoStart.textContent = '▶ Start'; $('fs-start') && ($('fs-start').textContent = '▶ Start'); pomoLeft = 0;
  if (pomoMode === 'work') { pomoSession = Math.min(4, pomoSession + 1); setPomoMode(pomoSession >= 4 ? 'long' : 'short'); if (pomoSession >= 4) pomoSession = 0; }
  else setPomoMode('work');
};

pomoStart.addEventListener('click', startPausePomo);
$('pomo-reset').addEventListener('click', resetPomo);
$('pomo-skip').addEventListener('click', skipPomo);

document.querySelectorAll('.pomo-mode-btn:not([data-fs])').forEach(b => {
  b.addEventListener('click', () => { document.querySelectorAll('.pomo-mode-btn:not([data-fs])').forEach(x => x.classList.remove('active')); b.classList.add('active'); clearInterval(pomoTick); setPomoMode(b.dataset.mode); });
});

[['set-work','work'],['set-short','short'],['set-long','long']].forEach(([id, key]) => {
  const el = $(id); if (!el) return;
  el.addEventListener('change', () => {
    const v = Math.max(1, Math.min(60, parseInt(el.value) || 1)); el.value = v;
    pomoSets[key] = v; save(LS.POMO, pomoSets);
    if (pomoMode === key && !pomoRunning) setPomoMode(key);
  });
});

const syncPomoTaskList = () => {
  const sel = $('pomo-task-select'); if (!sel) return;
  const cur = sel.value; sel.innerHTML = '<option value="">— Choose a task —</option>';
  tasks.filter(t => !t.done).forEach(t => { const opt = document.createElement('option'); opt.value = t.id; opt.textContent = t.text.slice(0, 50); sel.appendChild(opt); });
  if (cur) sel.value = cur;
};

/* ═══════════════════════════════════════════
   FULLSCREEN FOCUS MODE
═══════════════════════════════════════════ */
const focusFullscreen = $('focus-fullscreen');
const fsStart = $('fs-start'); const fsReset = $('fs-reset');
const fsSkip  = $('fs-skip');  const fsExit  = $('fs-exit');
const fsBtn   = $('fullscreen-btn');

if (fsBtn)   fsBtn.addEventListener('click',  () => { focusFullscreen.classList.remove('hidden'); document.body.style.overflow = 'hidden'; updatePomoUI(); });
if (fsExit)  fsExit.addEventListener('click', () => { focusFullscreen.classList.add('hidden'); document.body.style.overflow = ''; });
if (fsStart) fsStart.addEventListener('click', startPausePomo);
if (fsReset) fsReset.addEventListener('click', resetPomo);
if (fsSkip)  fsSkip.addEventListener('click',  skipPomo);

document.querySelectorAll('.pomo-mode-btn[data-fs]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.pomo-mode-btn[data-fs]').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.pomo-mode-btn:not([data-fs])').forEach(x => x.classList.toggle('active', x.dataset.mode === b.dataset.mode));
    b.classList.add('active'); clearInterval(pomoTick); setPomoMode(b.dataset.mode);
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && focusFullscreen && !focusFullscreen.classList.contains('hidden')) { focusFullscreen.classList.add('hidden'); document.body.style.overflow = ''; }
});

/* ═══════════════════════════════════════════
   COMMAND PALETTE
═══════════════════════════════════════════ */
let cmdIdx = -1;

const CMD_LIST = [
  { icon:'☰', label:'Go to Tasks',       shortcut:'1', action: () => switchTab('tasks') },
  { icon:'◈', label:'Go to Analytics',   shortcut:'2', action: () => switchTab('analytics') },
  { icon:'◫', label:'Go to Calendar',    shortcut:'3', action: () => switchTab('calendar') },
  { icon:'◉', label:'Go to Focus',       shortcut:'4', action: () => switchTab('focus') },
  { icon:'⚙', label:'Go to Settings',   shortcut:'5', action: () => switchTab('settings') },
  { icon:'✓', label:'Mark all done',     shortcut:'',  action: () => { tasks.forEach(t => { if(!t.done){t.done=true;const d=today();history[d]=(history[d]||0)+1;} }); saveWithIndicator(LS.TASKS,tasks); save(LS.HISTORY,history); render(); showToast('All tasks completed!','t-success'); } },
  { icon:'✕', label:'Clear completed',   shortcut:'',  action: () => { const n=tasks.filter(t=>t.done).length; tasks=tasks.filter(t=>!t.done); saveWithIndicator(LS.TASKS,tasks); render(); syncPomoTaskList(); showToast(`Cleared ${n} completed task${n!==1?'s':''}`, 't-delete'); } },
  { icon:'◐', label:'Toggle theme',      shortcut:'T', action: () => { toggleTheme(); showToast('Theme toggled','t-info',2000); } },
  { icon:'⬇', label:'Export tasks',      shortcut:'',  action: () => exportTasks() },
  { icon:'⬆', label:'Import tasks',      shortcut:'',  action: () => importTasks() },
  { icon:'⌕', label:'Focus search',      shortcut:'/', action: () => { switchTab('tasks'); setTimeout(()=>searchInput.focus(),80); } },
  { icon:'⊡', label:'Bulk select mode',  shortcut:'',  action: () => { closePalette(); toggleBulkMode(); } },
  { icon:'⤢', label:'Fullscreen focus',  shortcut:'',  action: () => { switchTab('focus'); setTimeout(() => { focusFullscreen.classList.remove('hidden'); document.body.style.overflow='hidden'; updatePomoUI(); }, 100); } },
  { icon:'⎋', label:'Sign out',          shortcut:'',  action: () => handleSignOut() },
];

const renderCmdResults = (q = '') => {
  const filtered = q ? CMD_LIST.filter(c => c.label.toLowerCase().includes(q.toLowerCase())) : CMD_LIST;
  cmdResults.innerHTML = ''; cmdIdx = -1;
  filtered.forEach((cmd, i) => {
    const li = document.createElement('li'); li.className = 'cmd-result-item'; li.setAttribute('role', 'option');
    li.innerHTML = `<span class="cmd-result-icon">${cmd.icon}</span><span class="cmd-result-label">${cmd.label}</span>${cmd.shortcut ? `<span class="cmd-result-shortcut">${cmd.shortcut}</span>` : ''}`;
    li.addEventListener('click', () => { cmd.action(); closePalette(); });
    li.addEventListener('mouseenter', () => { cmdResults.querySelectorAll('.focused').forEach(x => x.classList.remove('focused')); li.classList.add('focused'); cmdIdx = i; });
    cmdResults.appendChild(li);
  });
};

const openPalette  = () => { cmdOverlay.classList.add('open'); cmdInput.value = ''; renderCmdResults(); requestAnimationFrame(() => cmdInput.focus()); };
const closePalette = () => { cmdOverlay.classList.remove('open'); cmdInput.value = ''; };

$('cmd-trigger').addEventListener('click', openPalette);
const cmdTriggerMobile = $('cmd-trigger-mobile');
if (cmdTriggerMobile) cmdTriggerMobile.addEventListener('click', openPalette);
cmdOverlay.addEventListener('click', e => { if (e.target === cmdOverlay) closePalette(); });
cmdInput.addEventListener('input', () => renderCmdResults(cmdInput.value));
cmdInput.addEventListener('keydown', e => {
  const items = cmdResults.querySelectorAll('.cmd-result-item'); if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); items[cmdIdx]?.classList.remove('focused'); cmdIdx = (cmdIdx + 1) % items.length; items[cmdIdx].classList.add('focused'); items[cmdIdx].scrollIntoView({ block:'nearest' }); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[cmdIdx]?.classList.remove('focused'); cmdIdx = (cmdIdx - 1 + items.length) % items.length; items[cmdIdx].classList.add('focused'); items[cmdIdx].scrollIntoView({ block:'nearest' }); }
  else if (e.key === 'Enter') { e.preventDefault(); const focused = cmdResults.querySelector('.focused'); if (focused) focused.click(); else if (items[0]) items[0].click(); }
  else if (e.key === 'Escape') { closePalette(); }
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openPalette(); }
  if (e.key === 'Escape' && cmdOverlay.classList.contains('open')) closePalette();
});

/* ═══════════════════════════════════════════════════════════
   PWA — Install prompt (fully Lighthouse-compliant)
   ═══════════════════════════════════════════════════════════
   Flow:
     1. beforeinstallprompt fires  → store event, show banner
     2. User clicks Install        → call prompt(), await choice
     3. Accepted / appinstalled    → hide banner, null prompt
     4. Dismissed by user          → hide banner for session only
        (does NOT permanently block; cleared on next page load
         so the browser can re-offer after engagement threshold)
     5. Already running standalone → never show banner at all
   ═══════════════════════════════════════════════════════════ */

let deferredPrompt = null;   /* global — stores the BeforeInstallPromptEvent */
let promptPending  = false;  /* guard against duplicate prompt() calls       */

const pwaBanner  = $('pwa-banner');
const pwaInstall = $('pwa-install');
const pwaDismiss = $('pwa-dismiss');

/* Helper: hide the install banner */
function hidePwaBanner() {
  if (pwaBanner) pwaBanner.classList.add('hidden');
}

/* Helper: show the install banner */
function showPwaBanner() {
  if (pwaBanner) pwaBanner.classList.remove('hidden');
  console.log('[PWA] Install banner shown');
}

/* ── PWA standalone detection ───────────────────────────────
   _pwaInstallPromptFired: set true the instant beforeinstallprompt fires.
   The browser firing that event is a hard guarantee the app is NOT
   currently installed as a standalone PWA, so it overrides everything. */
let _pwaInstallPromptFired = false;
/* Expose on window so reminders.js can read/set it too */
Object.defineProperty(window, '_pwaInstallPromptFired', {
  get: () => _pwaInstallPromptFired,
  set: (v) => { _pwaInstallPromptFired = v; },
  configurable: true,
});

function _pwaIsStandalone() {
  /* iOS Safari — always reliable */
  if (window.navigator.standalone === true) return true;

  /* If beforeinstallprompt fired this session, the browser explicitly
     told us the app is installable = not standalone. Clear stale flag. */
  if (_pwaInstallPromptFired) {
    localStorage.removeItem('nexa_pwa_installed');
    return false;
  }

  /* display-mode: standalone — only trustworthy when install prompt
     has NOT fired (Edge/Chrome can match this in a normal browser tab) */
  const standaloneMode =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches;

  if (!standaloneMode) {
    localStorage.removeItem('nexa_pwa_installed');
    return false;
  }

  /* display-mode matches + install prompt never fired = genuinely standalone */
  return localStorage.getItem('nexa_pwa_installed') === '1';
}

/* ── Settings card helpers ──────────────────────────────────
   Update the Settings > Install App card based on current state */
function _updatePwaSettingsCard() {
  const installSection = document.getElementById('pwa-install-section');
  const settingsBtn    = document.getElementById('pwa-settings-install-btn');
  const btnLabel       = document.getElementById('pwa-settings-btn-label');
  const hint           = document.getElementById('pwa-install-hint');
  if (!installSection) return;

  // Always show install section, never show installed section
  installSection.classList.remove('hidden');

  if (deferredPrompt) {
    if (settingsBtn) settingsBtn.disabled = false;
    if (btnLabel)    btnLabel.textContent = 'Install NEXA';
    if (hint)        hint.textContent = '';
  } else {
    if (settingsBtn) settingsBtn.disabled = true;
    if (btnLabel)    btnLabel.textContent = 'Install NEXA';
    if (hint) {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
      hint.textContent = isIos
        ? 'On iOS: tap the Share button then "Add to Home Screen"'
        : 'Use your browser\'s install option (address bar icon) to install.';
    }
  }
}

const isStandalone = _pwaIsStandalone();

/* ── 1. Detect already-installed (standalone) mode ──────────*/
if (isStandalone) {
  hidePwaBanner();
  console.log('[PWA] Running in standalone mode — install banner suppressed');
}

/* ── 2. Capture beforeinstallprompt ─────────────────────────*/
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;

  /* Browser firing this = app is definitely NOT installed standalone.
     Set flag immediately and clear any stale localStorage flag. */
  _pwaInstallPromptFired = true;
  localStorage.removeItem('nexa_pwa_installed');
  console.log('[PWA] beforeinstallprompt captured — clearing installed flag');

  /* Update settings card right away to hide "NEXA is installed!" */
  _updatePwaSettingsCard();

  if (isStandalone) return;
  if (sessionStorage.getItem('nexa_pwa_dismissed')) return;
  showPwaBanner();
});

/* ── Shared trigger function (used by both banner & settings btn) ── */
async function _triggerPwaInstall(hideFloatingBanner) {
  if (!deferredPrompt || promptPending) return;

  promptPending = true;
  if (hideFloatingBanner) hidePwaBanner();

  try {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] User choice:', outcome);

    if (outcome === 'accepted') {
      console.log('[PWA] App installed');
      localStorage.setItem('nexa_pwa_installed', '1');
      deferredPrompt = null;
    } else {
      sessionStorage.setItem('nexa_pwa_dismissed', '1');
      deferredPrompt = null;
    }
  } catch (err) {
    console.error('[PWA] Install prompt error:', err);
    deferredPrompt = null;
  } finally {
    promptPending = false;
    _updatePwaSettingsCard();
  }
}

/* ── 3. Banner install button click ─────────────────────────*/
if (pwaInstall) {
  pwaInstall.addEventListener('click', () => _triggerPwaInstall(true));
}

/* ── 3b. Settings card install button click ─────────────────*/
document.addEventListener('click', e => {
  if (e.target.closest('#pwa-settings-install-btn')) {
    _triggerPwaInstall(false);
  }
});

/* ── 4. Dismiss button ───────────────────────────────────────*/
if (pwaDismiss) {
  pwaDismiss.addEventListener('click', () => {
    hidePwaBanner();
    sessionStorage.setItem('nexa_pwa_dismissed', '1');
    console.log('[PWA] Banner dismissed for this session');
  });
}

/* ── 5. appinstalled event ───────────────────────────────────*/
window.addEventListener('appinstalled', () => {
  hidePwaBanner();
  deferredPrompt = null;
  promptPending  = false;
  /* Persist install flag so _pwaIsStandalone() is reliable on next launch */
  localStorage.setItem('nexa_pwa_installed', '1');
  console.log('[PWA] App installed — flag saved');
  _updatePwaSettingsCard();
});

/* ── 6. display-mode change ─────────────────────────────────*/
window.matchMedia('(display-mode: standalone)').addEventListener('change', e => {
  if (e.matches) {
    hidePwaBanner();
    deferredPrompt = null;
    console.log('[PWA] Now running standalone — banner hidden');
    _updatePwaSettingsCard();
  }
});

/* Expose so reminders.js and other modules can trigger a card refresh */
window._updatePwaSettingsCard = _updatePwaSettingsCard;

/* ── 7. Initial settings card state (run after DOM is ready) ─
   Also re-run whenever the Settings tab is opened, since the
   card may not have been in the DOM on first run.             */
function _initPwaSettingsCard() {
  _updatePwaSettingsCard();
}
/* Defer slightly so DOM is fully painted */
setTimeout(_initPwaSettingsCard, 200);

/* Re-sync when user opens the Settings tab */
document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab && tab.dataset.tab === 'settings') {
    setTimeout(_updatePwaSettingsCard, 150);
    setTimeout(_updatePwaSettingsCard, 600);
  }
});

/* ═══════════════════════════════════════════════════════════
   SERVICE WORKER — registration
   ═══════════════════════════════════════════════════════════
   • Only registers on HTTPS or localhost (browser requirement)
   • Scope defaults to sw.js location ('/')
   • Logs success/failure for debugging
   ═══════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(reg => {
        console.log('[SW] Registered — scope:', reg.scope);

        /* Detect SW updates and notify user (optional) */
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[SW] New version available');
            }
          });
        });
      })
      .catch(err => console.error('[SW] Registration failed:', err));
  });
}

/* ═══════════════════════════════════════════
   NOTIFICATION PERMISSION
═══════════════════════════════════════════ */
const askNotifPermission = () => {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
};

/* ═══════════════════════════════════════════
   TIMESTAMP REFRESH
═══════════════════════════════════════════ */
setInterval(() => {
  tl.querySelectorAll('.created-badge').forEach(el => {
    const li = el.closest('.task-item'); if (!li) return;
    const t = tasks.find(x => x.id === li.dataset.id); if (t) el.textContent = rel(t.at);
  });
}, 60000);

/* ════════════════════════════════════════════════════════════
   ⑬  bootApp(uid)
       Called by onAuthStateChanged after a successful sign-in.
       Scopes all localStorage keys to the user's UID, then
       loads their data and initialises the full app UI.
   ════════════════════════════════════════════════════════════ */
const bootApp = uid => {
  /* 1. Scope storage keys to this user */
  scopeStorageKeys(uid);

  /* 2. Load user-specific state */
  tasks   = load(LS.TASKS,   []);
  filter  = load(LS.FILTER,  'all');
  history = load(LS.HISTORY, {});
  streak  = load(LS.STREAK,  { count: 0, lastDate: '' });
  pomoSets= load(LS.POMO,    { work: 25, short: 5, long: 15 });

  /* 3. Sync filter buttons to loaded filter */
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));

  /* 4. Sync pomo inputs */
  [['set-work','work'],['set-short','short'],['set-long','long']].forEach(([id, key]) => {
    const el = $(id); if (el) el.value = pomoSets[key];
  });

  /* 5. Boot UI */
  ringFill.style.strokeDasharray  = CIRCUMFERENCE;
  ringFill.style.strokeDashoffset = 0;
  setPomoMode('work');
  render();
  syncPomoTaskList();
  renderHeatmap();
  askNotifPermission();

  /* 6. Restore task input fully for authenticated user */
  inp.readOnly    = false;
  inp.disabled    = false;
  inp.placeholder = 'What needs to be done?';
  inp.focus();

  /* 7. Restore any locked CSS state (remove guest residue) */
  document.body.classList.remove('guest-mode');

  if (animationsReduced) document.body.classList.add('reduce-motion');
  const initThemeToggle = $('settings-theme-toggle');
  if (initThemeToggle) initThemeToggle.classList.toggle('on', load('taskr_theme', 'dark') === 'dark');
  const initAnimToggle = $('settings-anim-toggle');
  if (initAnimToggle) initAnimToggle.classList.toggle('on', !animationsReduced);

  /* 8. Show welcome toast */
  const userName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'back';
  showToast(`Welcome back, ${userName}! 👋`, 't-success', 3000);
};

/* ════════════════════════════════════════════════════════════
   ⑭  bootGuestMode()
       Called when no user is authenticated.
       Shows the full UI with empty data so guests can explore
       all pages. Interactive elements are locked via CSS +
       capture-phase interceptors (see ⑪c above).
   ════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════
   ⑭  bootGuestMode()
       Called when no user is authenticated.
       Shows the full UI with empty data so guests can explore
       all pages without any blur or hidden sections.
       Interactive elements are locked via CSS guest-mode class
       + capture-phase interceptors (see ⑪c above).
   ════════════════════════════════════════════════════════════ */
const bootGuestMode = () => {
  /* Use guest-scoped keys so no user data leaks */
  LS = {
    TASKS:   'taskr_guest_tasks',
    FILTER:  'taskr_guest_filter',
    THEME:   'taskr_theme',
    STREAK:  'taskr_guest_streak',
    HISTORY: 'taskr_guest_history',
    POMO:    'taskr_guest_pomo_sets',
  };

  tasks    = [];
  filter   = 'all';
  history  = {};
  streak   = { count: 0, lastDate: '' };
  pomoSets = { work: 25, short: 5, long: 15 };

  /* Sync filter buttons */
  document.querySelectorAll('.filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === filter)
  );

  /* Sync pomo inputs */
  [['set-work','work'],['set-short','short'],['set-long','long']].forEach(([id, key]) => {
    const el = $(id); if (el) el.value = pomoSets[key];
  });

  /* Boot UI — full render so all sections are populated */
  if (typeof CIRCUMFERENCE !== 'undefined') {
    ringFill.style.strokeDasharray  = CIRCUMFERENCE;
    ringFill.style.strokeDashoffset = 0;
  }
  if (typeof setPomoMode === 'function') setPomoMode('work');
  render();
  if (typeof syncPomoTaskList === 'function') syncPomoTaskList();
  if (typeof renderHeatmap    === 'function') renderHeatmap();

  /* Lock task input — visual only; capture interceptor handles clicks */
  inp.readOnly = true;
  inp.placeholder = 'Sign in to start adding tasks…';

  if (animationsReduced) document.body.classList.add('reduce-motion');

  /* Populate guest labels in sidebar and settings */
  const ava = document.getElementById('suc-avatar');
  if (ava) ava.textContent = '?';
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('suc-name',              'Guest');
  setText('suc-email',             '');
  setText('settings-display-name', 'Guest User');
  setText('settings-email',        'Not signed in');
  setText('settings-provider-tag', '—');
  setText('settings-uid',          '—');
  setText('settings-verified',     '—');
  setText('settings-created',      '—');
  setText('settings-lastlogin',    '—');
};