/**
 * NEXA — Firestore Offline Sync Module
 * ─────────────────────────────────────
 * Provides full offline-first task persistence using Firestore's
 * multi-tab / IndexedDB offline cache. All CRUD operations are
 * written through Firestore which handles the queue-and-flush
 * behaviour automatically when connectivity is restored.
 *
 * Sync states
 *   🟢 synced   — all writes acknowledged by server
 *   🟡 syncing  — write(s) in-flight or offline queue being flushed
 *   🔴 offline  — device has no internet connection
 */

'use strict';

/* ─────────────────────────────────────────────────
   1.  SYNC STATUS UI
───────────────────────────────────────────────── */
const SyncUI = (() => {
  const STATES = {
    synced:  { emoji: '🟢', label: 'Synced',      cls: 'sync-synced'  },
    syncing: { emoji: '🟡', label: 'Syncing…',    cls: 'sync-syncing' },
    offline: { emoji: '🔴', label: 'Offline Mode', cls: 'sync-offline' },
  };

  let _current = 'synced';
  let _pendingCount = 0;

  function _render() {
    const el      = document.getElementById('autosave-indicator');
    const dotEl   = document.getElementById('sync-dot');
    const labelEl = document.getElementById('autosave-label');
    if (!el) return;

    const s = STATES[_current] || STATES.synced;
    // swap state classes
    el.classList.remove('sync-synced', 'sync-syncing', 'sync-offline');
    el.classList.add(s.cls);
    if (dotEl)   dotEl.className = `autosave-dot sync-dot ${s.cls}`;
    if (labelEl) labelEl.textContent = s.label;

    // tooltip with pending count when syncing
    if (_current === 'syncing' && _pendingCount > 0) {
      el.title = `Syncing ${_pendingCount} change${_pendingCount > 1 ? 's' : ''}…`;
    } else {
      el.title = s.label;
    }
  }

  function set(state, pendingCount = 0) {
    _current      = state;
    _pendingCount = pendingCount;
    _render();
  }

  return { set };
})();


/* ─────────────────────────────────────────────────
   2.  CONNECTIVITY MONITOR
───────────────────────────────────────────────── */
const ConnMonitor = (() => {
  let _isOnline = navigator.onLine;
  const _listeners = [];

  function _fire(online) {
    _isOnline = online;
    _listeners.forEach(fn => fn(online));
    SyncUI.set(online ? 'syncing' : 'offline');
  }

  window.addEventListener('online',  () => _fire(true));
  window.addEventListener('offline', () => _fire(false));

  // set initial state
  SyncUI.set(_isOnline ? 'synced' : 'offline');

  return {
    isOnline: () => _isOnline,
    onChanged: (fn) => _listeners.push(fn),
  };
})();


/* ─────────────────────────────────────────────────
   3.  FIRESTORE OFFLINE SYNC ENGINE
───────────────────────────────────────────────── */
const FireSync = (() => {
  let _db       = null;
  let _uid      = null;
  let _colRef   = null;
  let _unsubscribe = null;

  // pending write counter (optimistic)
  let _pendingWrites = 0;

  function _setPending(delta) {
    _pendingWrites = Math.max(0, _pendingWrites + delta);
    if (!ConnMonitor.isOnline()) return; // keep 🔴
    SyncUI.set(_pendingWrites > 0 ? 'syncing' : 'synced', _pendingWrites);
  }

  /**
   * Initialise persistence + connect to the user's tasks collection.
   * @param {firebase.firestore.Firestore} db
   * @param {string} uid
   * @param {function(Array)} onSnapshot  called with full tasks array whenever data changes
   */
  async function init(db, uid, onSnapshot) {
    if (_unsubscribe) _unsubscribe();   // detach old listener
    _db  = db;
    _uid = uid;

    // ── Enable offline persistence (IndexedDB-backed) ──────────────────
    // enablePersistence must be called before any other Firestore use.
    // If already enabled (multi-tab) we swallow the error gracefully.
    try {
      await db.enablePersistence({ synchronizeTabs: true });
      console.info('[FireSync] IndexedDB persistence enabled.');
    } catch (err) {
      if (err.code === 'failed-precondition') {
        // Another tab has persistence; still works, just uses memory cache.
        console.warn('[FireSync] Multi-tab persistence conflict — using cache-only.');
      } else if (err.code === 'unimplemented') {
        console.warn('[FireSync] Browser does not support IndexedDB persistence.');
      } else {
        console.error('[FireSync] enablePersistence error:', err);
      }
    }

    _colRef = db.collection(`users/${uid}/tasks`);

    // ── Real-time listener (works offline via cache) ───────────────────
    _unsubscribe = _colRef
      .orderBy('createdAt', 'asc')
      .onSnapshot(
        { includeMetadataChanges: true },
        (snap) => {
          // Detect in-flight writes
          const hasPending = snap.metadata.hasPendingWrites;
          if (!ConnMonitor.isOnline()) {
            SyncUI.set('offline');
          } else {
            SyncUI.set(hasPending ? 'syncing' : 'synced');
          }

          const tasks = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          onSnapshot(tasks);
        },
        (err) => {
          console.error('[FireSync] snapshot error:', err);
          SyncUI.set('offline');
        }
      );

    // Update status when connectivity changes
    ConnMonitor.onChanged((online) => {
      if (!online) SyncUI.set('offline');
      // When back online Firestore will auto-flush; snapshot will update status.
    });
  }

  /** Stop listening (on sign-out). */
  function detach() {
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    _colRef = null;
    _uid    = null;
    SyncUI.set('offline');
  }

  /* ── CRUD ── */

  async function addTask(task) {
    if (!_colRef) throw new Error('[FireSync] Not initialised');
    _setPending(+1);
    try {
      // Use set() with a client-generated id so optimistic UI is immediate
      const docRef = _colRef.doc(task.id);
      await docRef.set(task);
    } finally {
      _setPending(-1);
    }
  }

  async function updateTask(id, changes) {
    if (!_colRef) throw new Error('[FireSync] Not initialised');
    _setPending(+1);
    try {
      await _colRef.doc(id).update({
        ...changes,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } finally {
      _setPending(-1);
    }
  }

  async function deleteTask(id) {
    if (!_colRef) throw new Error('[FireSync] Not initialised');
    _setPending(+1);
    try {
      await _colRef.doc(id).delete();
    } finally {
      _setPending(-1);
    }
  }

  async function bulkDelete(ids) {
    if (!_colRef) throw new Error('[FireSync] Not initialised');
    _setPending(+1);
    try {
      const batch = _db.batch();
      ids.forEach(id => batch.delete(_colRef.doc(id)));
      await batch.commit();
    } finally {
      _setPending(-1);
    }
  }

  async function bulkUpdate(ids, changes) {
    if (!_colRef) throw new Error('[FireSync] Not initialised');
    _setPending(+1);
    try {
      const batch = _db.batch();
      const ts    = firebase.firestore.FieldValue.serverTimestamp();
      ids.forEach(id => batch.update(_colRef.doc(id), { ...changes, updatedAt: ts }));
      await batch.commit();
    } finally {
      _setPending(-1);
    }
  }

  /**
   * One-shot write of entire tasks array (used for JSON import & clear-all).
   */
  async function overwriteAll(tasks) {
    if (!_colRef) throw new Error('[FireSync] Not initialised');
    _setPending(+1);
    try {
      // Delete all existing docs in batches of 500
      const snap = await _colRef.get();
      const deleteBatches = [];
      let b = _db.batch();
      let c = 0;
      snap.docs.forEach(doc => {
        b.delete(doc.ref);
        if (++c === 500) { deleteBatches.push(b.commit()); b = _db.batch(); c = 0; }
      });
      if (c) deleteBatches.push(b.commit());
      await Promise.all(deleteBatches);

      // Write new tasks in batches of 500
      const writeBatches = [];
      let wb = _db.batch(); let wc = 0;
      tasks.forEach(task => {
        wb.set(_colRef.doc(task.id), task);
        if (++wc === 500) { writeBatches.push(wb.commit()); wb = _db.batch(); wc = 0; }
      });
      if (wc) writeBatches.push(wb.commit());
      await Promise.all(writeBatches);
    } finally {
      _setPending(-1);
    }
  }

  return { init, detach, addTask, updateTask, deleteTask, bulkDelete, bulkUpdate, overwriteAll };
})();

// Expose globally so script.js can access
window.FireSync  = FireSync;
window.SyncUI    = SyncUI;
window.ConnMonitor = ConnMonitor;