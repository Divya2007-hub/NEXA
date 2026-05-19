/**
 * NEXA — Sync Integration Patch  v3.0  (persistence fix)
 * ═════════════════════════════════════════════════════════════════════
 *
 * WHY TASKS DISAPPEARED AFTER REFRESH — root cause analysis
 * ──────────────────────────────────────────────────────────
 * script.js bootApp() runs this line:
 *
 *     tasks = load(LS.TASKS, [])    ← localStorage ONLY
 *
 * On a fresh browser / new device / cleared storage this returns [].
 * The previous sync-patch.js only hooked mutation operations (add /
 * edit / delete) but NEVER fetched tasks from Firestore on startup.
 * So tasks were written to Firestore correctly but never read back.
 *
 * WHAT THIS FILE DOES
 * ───────────────────
 *  1. Registers a second onAuthStateChanged listener (script.js has
 *     the first).  Ours runs after bootApp() finishes its localStorage
 *     load so the UI shell is already ready.
 *
 *  2. Enables Firestore IndexedDB offline persistence so the cached
 *     data survives browser restart, laptop restart, PWA reopen, and
 *     offline use — even if the server is unreachable.
 *
 *  3. Starts a real-time onSnapshot() listener on
 *         users/{uid}/tasks
 *     Every document in that collection is one task with a unique id.
 *
 *  4. On the FIRST snapshot (startup / login):
 *     • Mutates the live `tasks` array in-place (splice) — required
 *       because window.tasks is a read-only getter backed by a local
 *       `let tasks` variable inside script.js.
 *     • Re-renders via window._nexaRender().
 *     • Writes the result back to localStorage (same key as script.js:
 *       `taskr_${uid}_tasks`) so the next refresh has a fast first paint.
 *
 *  5. Shows "Loading tasks…" while the first snapshot is in flight.
 *     Removed automatically when data arrives.
 *
 *  6. Hooks every write path (add / complete / edit / delete / bulk /
 *     import / clear-all) via DOM event listeners so each mutation is
 *     persisted to Firestore using a unique document per task.
 *
 *  7. Suppresses echo snapshots from our own writes to prevent the
 *     "only one task survives" overwrite race condition.
 *
 * Load order in index.html:
 *     script.js  →  sync.js  →  sync-patch.js
 * ═════════════════════════════════════════════════════════════════════
 */

'use strict';

(function () {

  /* ════════════════════════════════════════════════════════════════
     INTERNAL STATE
  ════════════════════════════════════════════════════════════════ */
  let _db          = null;
  let _uid         = null;
  let _colRef      = null;       // users/{uid}/tasks collection ref
  let _unsubscribe = null;       // Firestore onSnapshot cleanup fn
  let _syncReady   = false;      // true once listener is live
  let _firstSnap   = true;       // true until first snapshot arrives
  let _skipSnaps   = 0;          // counter: suppress N echo snapshots
  let _renderTimer = null;       // debounce handle for subsequent snaps
  let _lsKey       = null;       // localStorage key = `taskr_${uid}_tasks`
  let _seenIds     = new Set();  // task ids already written to Firestore

  /* ════════════════════════════════════════════════════════════════
     WAIT FOR DOM
  ════════════════════════════════════════════════════════════════ */
  function _ready(cb) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb);
    } else {
      setTimeout(cb, 0);
    }
  }

  /* ════════════════════════════════════════════════════════════════
     LOADING STATE
     Shown in the task list while the first Firestore snapshot is
     in-flight.  Only appears when localStorage had nothing to show.
  ════════════════════════════════════════════════════════════════ */
  function _showLoading() {
    if (!window.tasks || window.tasks.length > 0) return; // already have data
    const tl = document.getElementById('task-list');
    if (!tl || document.getElementById('_nexa_loading')) return;
    const li = document.createElement('li');
    li.id = '_nexa_loading';
    li.setAttribute('aria-live', 'polite');
    li.style.cssText = 'list-style:none;padding:32px 0;text-align:center;'
      + 'color:var(--tx3,#888);font-size:.85rem;letter-spacing:.03em;'
      + 'pointer-events:none;user-select:none;';
    li.innerHTML = '<span style="opacity:.65">⏳&nbsp; Loading tasks…</span>';
    tl.prepend(li);
  }

  function _hideLoading() {
    const el = document.getElementById('_nexa_loading');
    if (el) el.remove();
  }

  /* ════════════════════════════════════════════════════════════════
     AUTH HOOK
     We register a SECOND onAuthStateChanged listener.  Firebase
     calls all registered listeners, so script.js's bootApp() AND
     our handler both run.  script.js runs first (registered first)
     so the UI shell is ready by the time our async init runs.
  ════════════════════════════════════════════════════════════════ */
  _ready(() => {
    setTimeout(() => {
      function _wire() {
        firebase.auth().onAuthStateChanged(async user => {
          if (user) {
            await _onSignIn(user.uid);
          } else {
            _onSignOut();
          }
        });
      }
      try {
        _wire();
      } catch (err) {
        console.error('[SyncPatch] Auth hook failed, retrying in 1 s:', err);
        setTimeout(_wire, 1000);
      }
    }, 200);
  });

  /* ════════════════════════════════════════════════════════════════
     SIGN-IN
  ════════════════════════════════════════════════════════════════ */
  async function _onSignIn(uid) {
    _uid   = uid;
    _db    = firebase.firestore();
    _lsKey = `taskr_${uid}_tasks`;   // same key pattern as script.js

    SyncUI.set(navigator.onLine ? 'syncing' : 'offline');
    _showLoading();

    /* Enable IndexedDB offline persistence.
       Must be called before any other Firestore operation.
       Errors are non-fatal; the app degrades to memory-only cache. */
    try {
      await _db.enablePersistence({ synchronizeTabs: true });
      console.info('[SyncPatch] IndexedDB offline persistence enabled.');
    } catch (err) {
      if (err.code === 'failed-precondition') {
        console.warn('[SyncPatch] Persistence: multi-tab conflict — cache-only mode.');
      } else if (err.code === 'unimplemented') {
        console.warn('[SyncPatch] Persistence: browser lacks IndexedDB support.');
      } else {
        console.error('[SyncPatch] enablePersistence error:', err);
      }
    }

    _colRef    = _db.collection(`users/${uid}/tasks`);
    _syncReady = true;
    _firstSnap = true;

    _startListener();
    _hookMutations();
  }

  /* ════════════════════════════════════════════════════════════════
     SIGN-OUT
  ════════════════════════════════════════════════════════════════ */
  function _onSignOut() {
    _syncReady = false;
    _firstSnap = true;
    _skipSnaps = 0;
    _seenIds.clear();
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    _colRef = null;
    _uid    = null;
    _db     = null;
    SyncUI.set('offline');
  }

  /* ════════════════════════════════════════════════════════════════
     REAL-TIME LISTENER
     One listener per session on users/{uid}/tasks.
     Sorted by 'at' (numeric ms timestamp) descending so newest-first
     matches the order script.js produces with unshift().
  ════════════════════════════════════════════════════════════════ */
  function _startListener() {
    if (_unsubscribe) _unsubscribe();

    _unsubscribe = _colRef
      .orderBy('at', 'asc')             // sort ascending; we flip in _apply
      .onSnapshot(
        { includeMetadataChanges: true },
        snap => {
          /* Update sync indicator */
          if (!ConnMonitor.isOnline()) {
            SyncUI.set('offline');
          } else {
            SyncUI.set(snap.metadata.hasPendingWrites ? 'syncing' : 'synced');
          }

          const remoteTasks = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));

          if (_firstSnap) {
            /* FIRST SNAPSHOT — authoritative load from Firestore (or cache).
               Apply immediately so the user sees their tasks ASAP. */
            _firstSnap = false;
            _hideLoading();
            _apply(remoteTasks);
            console.info(`[SyncPatch] Initial load: ${remoteTasks.length} task(s) from Firestore.`);
            return;
          }

          /* SUBSEQUENT SNAPSHOTS */

          /* Suppress echo snapshots caused by our own writes */
          if (_skipSnaps > 0 && !snap.metadata.hasPendingWrites) {
            _skipSnaps--;
            console.debug('[SyncPatch] Echo snapshot suppressed (' + _skipSnaps + ' left).');
            return;
          }

          /* Skip while writes are still in-flight to avoid fighting optimistic UI */
          if (snap.metadata.hasPendingWrites) return;

          /* Debounce 300 ms so local renders finish first */
          clearTimeout(_renderTimer);
          _renderTimer = setTimeout(() => _apply(remoteTasks), 300);
        },
        err => {
          console.error('[SyncPatch] Firestore snapshot error:', err);
          SyncUI.set('offline');
          _hideLoading();
        }
      );
  }

  /* ════════════════════════════════════════════════════════════════
     APPLY REMOTE TASKS
     Mutates the live `tasks` array in-place.  We MUST use splice()
     because window.tasks is a read-only getter backed by a local
     `let tasks` variable inside script.js — we can't reassign it.
  ════════════════════════════════════════════════════════════════ */
  function _apply(remoteTasks) {
    const live = window.tasks;
    if (!Array.isArray(live)) {
      console.error('[SyncPatch] window.tasks is not an array.');
      return;
    }

    /* Normalise Firestore Timestamps → plain JS values */
    const normalised = remoteTasks.map(t => {
      const out = { ...t };
      if (out.createdAt && typeof out.createdAt.toDate === 'function') {
        out.createdAt = out.createdAt.toDate().toISOString();
      }
      if (out.updatedAt && typeof out.updatedAt.toDate === 'function') {
        out.updatedAt = out.updatedAt.toDate().toISOString();
      }
      delete out._synced; // remove internal flag if present
      return out;
    });

    /* Sort newest-first to match script.js unshift() insertion order */
    normalised.sort((a, b) => {
      const ta = typeof a.at === 'number' ? a.at : 0;
      const tb = typeof b.at === 'number' ? b.at : 0;
      return tb - ta;
    });

    /* Update seen-ids registry */
    _seenIds.clear();
    normalised.forEach(t => _seenIds.add(t.id));

    /* Mutate in-place — preserves the array reference the getter returns */
    live.splice(0, live.length, ...normalised);

    /* Mirror to localStorage using script.js's key so next refresh has
       an instant first paint from cache before Firestore responds. */
    if (_lsKey) {
      try {
        localStorage.setItem(_lsKey, JSON.stringify(live));
      } catch (e) {
        console.warn('[SyncPatch] localStorage write failed:', e);
      }
    }

    /* Re-render via the app's own function */
    if (typeof window._nexaRender === 'function') {
      window._nexaRender();
    }
  }

  /* ════════════════════════════════════════════════════════════════
     WRITE HELPERS  —  unique document per task
     Path: users/{uid}/tasks/{taskId}
     Never uses a shared "task" / "main" / "default" document.
  ════════════════════════════════════════════════════════════════ */

  async function _fsAdd(task) {
    if (!_colRef) return;
    _skipSnaps++;
    try {
      await _colRef.doc(task.id).set(_clean(task));
      _seenIds.add(task.id);
    } catch (e) {
      _skipSnaps = Math.max(0, _skipSnaps - 1);
      console.error('[SyncPatch] Firestore write failed for task', task.id, ':', e);
    }
  }

  async function _fsUpdate(id, changes) {
    if (!_colRef) return;
    _skipSnaps++;
    try {
      await _colRef.doc(id).update({
        ...changes,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      _skipSnaps = Math.max(0, _skipSnaps - 1);
      console.error('[SyncPatch] Firestore update failed for task', id, ':', e);
    }
  }

  async function _fsDelete(id) {
    if (!_colRef) return;
    _skipSnaps++;
    try {
      await _colRef.doc(id).delete();
      _seenIds.delete(id);
    } catch (e) {
      _skipSnaps = Math.max(0, _skipSnaps - 1);
      console.error('[SyncPatch] Firestore delete failed for task', id, ':', e);
    }
  }

  async function _fsBulkUpdate(ids, changes) {
    if (!_colRef || !ids.length) return;
    _skipSnaps++;
    try {
      const batch = _db.batch();
      const ts    = firebase.firestore.FieldValue.serverTimestamp();
      ids.forEach(id => batch.update(_colRef.doc(id), { ...changes, updatedAt: ts }));
      await batch.commit();
    } catch (e) {
      _skipSnaps = Math.max(0, _skipSnaps - 1);
      console.error('[SyncPatch] Firestore bulk-update failed:', e);
    }
  }

  async function _fsBulkDelete(ids) {
    if (!_colRef || !ids.length) return;
    _skipSnaps++;
    try {
      const batch = _db.batch();
      ids.forEach(id => { batch.delete(_colRef.doc(id)); _seenIds.delete(id); });
      await batch.commit();
    } catch (e) {
      _skipSnaps = Math.max(0, _skipSnaps - 1);
      console.error('[SyncPatch] Firestore bulk-delete failed:', e);
    }
  }

  async function _fsOverwriteAll(taskList) {
    if (!_colRef) return;
    _skipSnaps += 3;
    try {
      /* Delete all existing docs (in batches of 500) */
      const snap = await _colRef.get();
      let delBatch = _db.batch(), delCount = 0;
      const delCommits = [];
      snap.docs.forEach(doc => {
        delBatch.delete(doc.ref);
        if (++delCount === 500) {
          delCommits.push(delBatch.commit());
          delBatch = _db.batch(); delCount = 0;
        }
      });
      if (delCount) delCommits.push(delBatch.commit());
      await Promise.all(delCommits);

      /* Write new tasks (in batches of 500) */
      _seenIds.clear();
      let writeBatch = _db.batch(), writeCount = 0;
      const writeCommits = [];
      taskList.forEach(task => {
        writeBatch.set(_colRef.doc(task.id), _clean(task));
        _seenIds.add(task.id);
        if (++writeCount === 500) {
          writeCommits.push(writeBatch.commit());
          writeBatch = _db.batch(); writeCount = 0;
        }
      });
      if (writeCount) writeCommits.push(writeBatch.commit());
      await Promise.all(writeCommits);
    } catch (e) {
      _skipSnaps = Math.max(0, _skipSnaps - 3);
      console.error('[SyncPatch] Firestore overwrite-all failed:', e);
    }
  }

  /* ════════════════════════════════════════════════════════════════
     HOOK MUTATIONS
     Intercepts every task-write event in the DOM.  We use event
     listeners because script.js's functions are module-private
     `const` declarations — they're not on window.
  ════════════════════════════════════════════════════════════════ */
  let _hooksInstalled = false;

  function _hookMutations() {
    if (_hooksInstalled) return;
    _hooksInstalled = true;

    const tl     = document.getElementById('task-list');
    const addBtn = document.getElementById('add-btn');
    const inp    = document.getElementById('task-input');

    /* ── 1. ADD TASK ────────────────────────────────────────────
       script.js: addTask() → unshift(t) → render()
       New task is at tasks[0] (unshift = prepend).
       We wait one tick so render() completes, then sync tasks[0].
    ── */
    async function _afterAdd() {
      if (!_syncReady) return;
      await _tick();
      const task = window.tasks && window.tasks[0];
      if (!task || _seenIds.has(task.id)) return;  // already synced
      await _fsAdd(task);
    }

    if (addBtn) addBtn.addEventListener('click', () => setTimeout(_afterAdd, 0));
    if (inp)    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') setTimeout(_afterAdd, 0);
    });

    /* ── 2. DELETE (button click) ───────────────────────────────
       Capture the task id BEFORE the animationend callback removes
       it, then poll until it's gone from the array before deleting
       from Firestore (so undo can work by re-adding locally first).
    ── */
    if (tl) {
      tl.addEventListener('click', e => {
        if (!_syncReady) return;
        const btn = e.target.closest('.delete-btn');
        if (!btn) return;
        const li = btn.closest('.task-item');
        if (!li) return;
        const id = li.dataset.id;
        if (!id) return;
        _pollUntilGone(id, () => _fsDelete(id));
      });
    }

    /* ── 3. COMPLETE / TOGGLE (checkbox) ────────────────────────
       After script.js flips t.done, sync the new state.
    ── */
    if (tl) {
      tl.addEventListener('click', async e => {
        if (!_syncReady) return;
        if (!e.target.closest('.task-check')) return;
        const li = e.target.closest('.task-item');
        if (!li) return;
        const id = li.dataset.id;
        await _tick();
        const task = window.tasks && window.tasks.find(t => t.id === id);
        if (!task) return;
        await _fsUpdate(id, {
          done: task.done,
          completedAt: task.completedAt || null,
        });
      });
    }

    /* ── 4. INLINE TEXT EDIT (blur) ─────────────────────────────
       script.js: startEdit() sets contentEditable; on blur saves
       to t.text.  We catch the blur at capture phase.
    ── */
    if (tl) {
      tl.addEventListener('blur', async e => {
        if (!_syncReady) return;
        if (!e.target.classList.contains('task-text')) return;
        const li = e.target.closest('.task-item');
        if (!li) return;
        const id = li.dataset.id;
        await _tick();
        const task = window.tasks && window.tasks.find(t => t.id === id);
        if (!task) return;
        await _fsUpdate(id, { text: task.text });
      }, true);
    }

    /* ── 5. NOTES BLUR ──────────────────────────────────────────
       script.js: notes textarea blur saves t.notes.
    ── */
    if (tl) {
      tl.addEventListener('blur', async e => {
        if (!_syncReady) return;
        if (!e.target.classList.contains('task-notes-textarea')) return;
        const li = e.target.closest('.task-item');
        if (!li) return;
        const id = li.dataset.id;
        await _tick();
        const task = window.tasks && window.tasks.find(t => t.id === id);
        if (!task) return;
        await _fsUpdate(id, { notes: task.notes || '' });
      }, true);
    }

    /* ── 6. SWIPE-LEFT DELETE (touch) ───────────────────────────
       Same polling approach as button delete.
    ── */
    if (tl) {
      let _swipeId = null;
      tl.addEventListener('touchstart', e => {
        const li = e.target.closest('.task-item');
        _swipeId = li ? li.dataset.id : null;
      }, { passive: true });

      tl.addEventListener('touchend', () => {
        if (!_syncReady || !_swipeId) return;
        const id = _swipeId;
        _swipeId = null;
        // Delay slightly, then check if the task was deleted by the swipe
        setTimeout(() => {
          if (window.tasks && !window.tasks.some(t => t.id === id)) {
            _fsDelete(id);
          }
        }, 500);
      }, { passive: true });
    }

    /* ── 7. SWIPE-RIGHT COMPLETE (touch) ────────────────────────
       Same as checkbox toggle but triggered by touch.
    ── */
    if (tl) {
      let _swipeCompleteId = null;
      tl.addEventListener('touchstart', e => {
        const li = e.target.closest('.task-item');
        _swipeCompleteId = li ? li.dataset.id : null;
      }, { passive: true });

      tl.addEventListener('touchend', async () => {
        if (!_syncReady || !_swipeCompleteId) return;
        const id = _swipeCompleteId;
        _swipeCompleteId = null;
        await new Promise(r => setTimeout(r, 150));
        const task = window.tasks && window.tasks.find(t => t.id === id);
        if (task) {
          await _fsUpdate(id, { done: task.done, completedAt: task.completedAt || null });
        }
      }, { passive: true });
    }

    /* ── 8. BULK COMPLETE ───────────────────────────────────────
       Capture selected ids BEFORE the button click changes them.
    ── */
    const bulkCompleteBtn = document.getElementById('bulk-complete');
    if (bulkCompleteBtn) {
      let _bulkCompleteIds = [];
      bulkCompleteBtn.addEventListener('click', () => {
        // Capture before script.js handler clears the selection
        _bulkCompleteIds = _getCheckedIds();
      }, true); // capture phase

      bulkCompleteBtn.addEventListener('click', async () => {
        if (!_syncReady || !_bulkCompleteIds.length) return;
        const ids = [..._bulkCompleteIds];
        _bulkCompleteIds = [];
        await _tick();
        await _fsBulkUpdate(ids, {
          done: true,
          completedAt: new Date().toISOString(),
        });
      });
    }

    /* ── 9. BULK DELETE ─────────────────────────────────────────
       Capture ids before script.js removes the tasks.
    ── */
    const bulkDeleteBtn = document.getElementById('bulk-delete');
    if (bulkDeleteBtn) {
      let _bulkDeleteIds = [];
      bulkDeleteBtn.addEventListener('click', () => {
        _bulkDeleteIds = _getCheckedIds();
      }, true); // capture phase

      bulkDeleteBtn.addEventListener('click', async () => {
        if (!_syncReady || !_bulkDeleteIds.length) return;
        const ids = [..._bulkDeleteIds];
        _bulkDeleteIds = [];
        await _tick();
        await _fsBulkDelete(ids);
      });
    }

    /* ── 10. BULK PRIORITY ──────────────────────────────────────
       Priority change: sync after script.js updates the tasks.
    ── */
    const bulkPriBtn = document.getElementById('bulk-priority-btn');
    if (bulkPriBtn) {
      let _bulkPriIds = [];
      bulkPriBtn.addEventListener('click', () => {
        _bulkPriIds = _getCheckedIds();
      }, true);

      bulkPriBtn.addEventListener('click', async () => {
        if (!_syncReady || !_bulkPriIds.length) return;
        const ids = [..._bulkPriIds];
        _bulkPriIds = [];
        await _tick();
        for (const id of ids) {
          const task = window.tasks && window.tasks.find(t => t.id === id);
          if (task) await _fsUpdate(id, { pri: task.pri });
        }
      });
    }

    /* ── 11. IMPORT (file input) ────────────────────────────────
       script.js parses the file and replaces the tasks array.
       We wait briefly for it to finish, then overwrite Firestore.
    ── */
    const importFile = document.getElementById('import-file');
    if (importFile) {
      importFile.addEventListener('change', async () => {
        if (!_syncReady) return;
        await new Promise(r => setTimeout(r, 400)); // let FileReader finish
        _lsSync();
        await _fsOverwriteAll(window.tasks || []);
      });
    }

    /* ── 12. CLEAR ALL ──────────────────────────────────────────
       Intercept the settings clear button (confirm dialog is inside
       script.js's handler; we run after it).
    ── */
    const clearBtn = document.getElementById('settings-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!_syncReady) return;
        await new Promise(r => setTimeout(r, 600)); // wait for confirm + local clear
        if (!window.tasks || window.tasks.length === 0) {
          _lsSync();
          await _fsOverwriteAll([]);
        }
      });
    }

    /* ── 13. DRAG-DROP REORDER ──────────────────────────────────
       Mirror the new order to localStorage so next refresh is fast.
       (Full Firestore sort-order sync is a future enhancement.)
    ── */
    const taskListEl = document.getElementById('task-list');
    if (taskListEl) {
      taskListEl.addEventListener('drop', async () => {
        if (!_syncReady) return;
        await _tick();
        _lsSync();
      });
    }

    console.info('[SyncPatch] Mutation hooks installed for uid:', _uid);
  }

  /* ════════════════════════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════════════════════════ */

  /** Yield one tick to let synchronous UI updates complete */
  function _tick() {
    return new Promise(r => setTimeout(r, 0));
  }

  /** Get ids of all currently checked bulk-checkboxes */
  function _getCheckedIds() {
    return Array.from(document.querySelectorAll('.bulk-checkbox:checked'))
      .map(cb => cb.closest('.task-item')?.dataset?.id)
      .filter(Boolean);
  }

  /** Poll until a task id is absent from window.tasks, then call fn */
  function _pollUntilGone(id, fn) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const gone = !window.tasks || !window.tasks.some(t => t.id === id);
      if (gone) {
        clearInterval(timer);
        fn();
      } else if (attempts > 25) {
        clearInterval(timer); // give up after ~2.5 s
      }
    }, 100);
  }

  /** Mirror the current tasks array to localStorage */
  function _lsSync() {
    if (!_lsKey) return;
    try {
      localStorage.setItem(_lsKey, JSON.stringify(window.tasks || []));
    } catch (e) {
      console.warn('[SyncPatch] localStorage sync failed:', e);
    }
  }

  /** Strip undefined values and internal flags (Firestore rejects undefined) */
  function _clean(task) {
    const out = {};
    Object.keys(task).forEach(k => {
      if (task[k] !== undefined && k !== '_synced') out[k] = task[k];
    });
    if (!out.createdAt) out.createdAt = new Date().toISOString();
    return out;
  }

  /* ════════════════════════════════════════════════════════════════
     EXPOSE DEBUG HANDLE
  ════════════════════════════════════════════════════════════════ */
  window._NexaSyncPatch = {
    status:      () => ({ syncReady: _syncReady, uid: _uid, skipSnaps: _skipSnaps }),
    forceReload: () => { _firstSnap = true; _startListener(); },
  };

})();