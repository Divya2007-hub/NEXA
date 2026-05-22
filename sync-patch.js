/**
 * NEXA — Sync Integration Patch  v3.1  (Production Verified)
 * ═════════════════════════════════════════════════════════════════════
 * Fixes:
 * 1. Aligns engine layouts with core global window.render definitions.
 * 2. Resolves race conditions during real-time multi-document caching.
 * 3. Syncs LocalStorage patterns to prevent layout flashing on refresh.
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
  let _lsKey       = null;       // synced local key matching core storage
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
      LOADING STATE UI LAYERS
     ════════════════════════════════════════════════════════════════ */
  function _showLoading() {
    if (window.tasks && window.tasks.length > 0) return; 
    const tl = document.getElementById('task-list');
    if (!tl || document.getElementById('_nexa_loading')) return;
    const li = document.createElement('li');
    li.id = '_nexa_loading';
    li.setAttribute('aria-live', 'polite');
    li.style.cssText = 'list-style:none;padding:32px 0;text-align:center;'
      + 'color:var(--tx3,#888);font-size:.85rem;letter-spacing:.03em;'
      + 'pointer-events:none;user-select:none;';
    li.innerHTML = '<span style="opacity:.65">⏳&nbsp; Synchronizing task cache…</span>';
    tl.prepend(li);
  }

  function _hideLoading() {
    const el = document.getElementById('_nexa_loading');
    if (el) el.remove();
  }

  /* ════════════════════════════════════════════════════════════════
      AUTH ENGINE INITIALIZATION LINK
     ════════════════════════════════════════════════════════════════ */
  _ready(() => {
    setTimeout(() => {
      function _wire() {
        if (!window.firebase || !window.firebase.auth) {
          setTimeout(_wire, 500);
          return;
        }
        window.firebase.auth().onAuthStateChanged(async user => {
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
        console.error('[SyncPatch] Auth stream linking failed. Re-attempting pipeline...', err);
        setTimeout(_wire, 1000);
      }
    }, 200);
  });

  /* ════════════════════════════════════════════════════════════════
      SIGN-IN LIFECYCLE PIPELINE
     ════════════════════════════════════════════════════════════════ */
  async function _onSignIn(uid) {
    _uid   = uid;
    _db    = window.firebase.firestore();
    // Aligned key layout to prevent cache collisions with core bootApp structures
    _lsKey = 'nexa_tasks';   

    if (window.SyncUI && typeof window.SyncUI.set === 'function') {
      window.SyncUI.set(navigator.onLine ? 'syncing' : 'offline');
    }
    _showLoading();

    try {
      await _db.enablePersistence({ synchronizeTabs: true });
      console.info('[SyncPatch] Multi-tab persistent database offline structures verified.');
    } catch (err) {
      if (err.code === 'failed-precondition') {
        console.warn('[SyncPatch] Parallel database instance tracking detected: standard cache active.');
      } else if (err.code === 'unimplemented') {
        console.warn('[SyncPatch] Platform engine lacks local data isolation capabilities.');
      }
    }

    _colRef    = _db.collection('users').doc(uid).collection('tasks');
    _syncReady = true;
    _firstSnap = true;

    _startListener();
    _hookMutations();
  }

  function _onSignOut() {
    _syncReady = false;
    _firstSnap = true;
    _skipSnaps = 0;
    _seenIds.clear();
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    _colRef = null;
    _uid    = null;
    _db     = null;
    if (window.SyncUI && typeof window.SyncUI.set === 'function') {
      window.SyncUI.set('offline');
    }
    _hideLoading();
  }

  /* ════════════════════════════════════════════════════════════════
      REAL-TIME SNAPSHOT SYNCHRONIZATION STREAM
     ════════════════════════════════════════════════════════════════ */
  function _startListener() {
    if (_unsubscribe) _unsubscribe();

    _unsubscribe = _colRef
      .orderBy('at', 'asc')
      .onSnapshot(
        { includeMetadataChanges: true },
        snap => {
          if (window.SyncUI && typeof window.SyncUI.set === 'function') {
            if (window.ConnMonitor && typeof window.ConnMonitor.isOnline === 'function' && !window.ConnMonitor.isOnline()) {
              window.SyncUI.set('offline');
            } else {
              window.SyncUI.set(snap.metadata.hasPendingWrites ? 'syncing' : 'synced');
            }
          }

          const remoteTasks = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));

          if (_firstSnap) {
            _firstSnap = false;
            _hideLoading();
            _apply(remoteTasks);
            console.info(`[SyncPatch] Database stream established: ${remoteTasks.length} managed records fetched.`);
            return;
          }

          if (_skipSnaps > 0 && !snap.metadata.hasPendingWrites) {
            _skipSnaps--;
            return;
          }

          if (snap.metadata.hasPendingWrites) return;

          clearTimeout(_renderTimer);
          _renderTimer = setTimeout(() => _apply(remoteTasks), 300);
        },
        err => {
          console.error('[SyncPatch] Real-time stream failed:', err);
          if (window.SyncUI && typeof window.SyncUI.set === 'function') window.SyncUI.set('offline');
          _hideLoading();
        }
      );
  }

  /* ════════════════════════════════════════════════════════════════
      MUTATION INJECTOR LAYER
     ════════════════════════════════════════════════════════════════ */
  function _apply(remoteTasks) {
    const live = window.tasks;
    if (!Array.isArray(live)) {
      console.warn('[SyncPatch] Shared memory layout array target unavailable.');
      return;
    }

    const normalised = remoteTasks.map(t => {
      const out = { ...t };
      if (out.createdAt && typeof out.createdAt.toDate === 'function') out.createdAt = out.createdAt.toDate().toISOString();
      if (out.updatedAt && typeof out.updatedAt.toDate === 'function') out.updatedAt = out.updatedAt.toDate().toISOString();
      delete out._synced; 
      return out;
    });

    normalised.sort((a, b) => (typeof b.at === 'number' ? b.at : 0) - (typeof a.at === 'number' ? a.at : 0));

    _seenIds.clear();
    normalised.forEach(t => _seenIds.add(t.id));

    // Mutate live runtime references in-place cleanly without breaking pointers
    live.splice(0, live.length, ...normalised);
    _lsSync();

    // Trigger explicit core application visual render updates
    if (typeof window.render === 'function') {
      window.render();
    }
    if (typeof window.renderHeatmap === 'function') {
      window.renderHeatmap();
    }
  }

  /* ════════════════════════════════════════════════════════════════
      WRITE BACKEND CORE IMPLEMENTATIONS
     ════════════════════════════════════════════════════════════════ */
  async function _fsAdd(task) {
    if (!_colRef) return;
    _skipSnaps++;
    try {
      await _colRef.doc(task.id).set(_clean(task));
      _seenIds.add(task.id);
    } catch (e) {
      _skipSnaps = Math.max(0, _skipSnaps - 1);
      console.error('[SyncPatch] Storage set reject:', e);
    }
  }

  async function _fsUpdate(id, changes) {
    if (!_colRef) return;
    _skipSnaps++;
    try {
      await _colRef.doc(id).update({
        ...changes,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      _skipSnaps = Math.max(0, _skipSnaps - 1);
      console.error('[SyncPatch] Storage field change reject:', e);
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
      console.error('[SyncPatch] Storage document drop reject:', e);
    }
  }

  async function _fsBulkUpdate(ids, changes) {
    if (!_colRef || !ids.length) return;
    _skipSnaps++;
    try {
      const batch = _db.batch();
      const ts    = window.firebase.firestore.FieldValue.serverTimestamp();
      ids.forEach(id => batch.update(_colRef.doc(id), { ...changes, updatedAt: ts }));
      await batch.commit();
    } catch (e) {
      _skipSnaps = Math.max(0, _skipSnaps - 1);
      console.error('[SyncPatch] Batch updates failed:', e);
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
      console.error('[SyncPatch] Batch teardown failed:', e);
    }
  }

  async function _fsOverwriteAll(taskList) {
    if (!_colRef) return;
    _skipSnaps += 3;
    try {
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
      console.error('[SyncPatch] High volume data override failure:', e);
    }
  }

  /* ════════════════════════════════════════════════════════════════
      DOM EVENT CAPTURE INTERCEPTIONS
     ════════════════════════════════════════════════════════════════ */
  let _hooksInstalled = false;

  function _hookMutations() {
    if (_hooksInstalled) return;
    _hooksInstalled = true;

    const tl     = document.getElementById('task-list');
    const addBtn = document.getElementById('add-btn');
    const inp    = document.getElementById('task-input');

    async function _afterAdd() {
      if (!_syncReady) return;
      await _tick();
      const task = window.tasks && window.tasks[0];
      if (!task || _seenIds.has(task.id)) return;
      await _fsAdd(task);
    }

    if (addBtn) addBtn.addEventListener('click', () => setTimeout(_afterAdd, 10));
    if (inp) inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') setTimeout(_afterAdd, 10);
    });

    if (tl) {
      tl.addEventListener('click', e => {
        if (!_syncReady) return;
        const btn = e.target.closest('.delete-btn');
        if (!btn) return;
        const li = btn.closest('.task-item');
        if (!li || !li.dataset.id) return;
        _pollUntilGone(li.dataset.id, () => _fsDelete(li.dataset.id));
      });

      tl.addEventListener('click', async e => {
        if (!_syncReady) return;
        if (!e.target.closest('.task-check')) return;
        const li = e.target.closest('.task-item');
        if (!li || !li.dataset.id) return;
        const id = li.dataset.id;
        await _tick();
        const task = window.tasks && window.tasks.find(t => t.id === id);
        if (!task) return;
        await _fsUpdate(id, { done: task.done, completedAt: task.completedAt || null });
      });

      tl.addEventListener('blur', async e => {
        if (!_syncReady) return;
        if (!e.target.classList.contains('task-text')) return;
        const li = e.target.closest('.task-item');
        if (!li || !li.dataset.id) return;
        const id = li.dataset.id;
        await _tick();
        const task = window.tasks && window.tasks.find(t => t.id === id);
        if (!task) return;
        await _fsUpdate(id, { text: task.text });
      }, true);

      tl.addEventListener('blur', async e => {
        if (!_syncReady) return;
        if (!e.target.classList.contains('task-text-textarea')) return; // Normalized tracker fallback
        const li = e.target.closest('.task-item');
        if (!li || !li.dataset.id) return;
        const id = li.dataset.id;
        await _tick();
        const task = window.tasks && window.tasks.find(t => t.id === id);
        if (!task) return;
        await _fsUpdate(id, { notes: task.notes || '' });
      }, true);

      // Unified touch tracking layers
      let _touchActiveId = null;
      tl.addEventListener('touchstart', e => {
        const li = e.target.closest('.task-item');
        _touchActiveId = li ? li.dataset.id : null;
      }, { passive: true });

      tl.addEventListener('touchend', async () => {
        if (!_syncReady || !_touchActiveId) return;
        const trackingId = _touchActiveId;
        _touchActiveId = null;
        
        await new Promise(r => setTimeout(r, 200));
        const taskInstance = window.tasks && window.tasks.find(t => t.id === trackingId);
        if (!taskInstance) {
          await _fsDelete(trackingId); // Task missing from array -> deleted via swipe
        } else {
          await _fsUpdate(trackingId, { done: taskInstance.done, completedAt: taskInstance.completedAt || null });
        }
      }, { passive: true });
    }

    // Bulk action streams
    const bulkCompleteBtn = document.getElementById('bulk-complete');
    if (bulkCompleteBtn) {
      let _bulkCompleteIds = [];
      bulkCompleteBtn.addEventListener('click', () => { _bulkCompleteIds = _getCheckedIds(); }, true);
      bulkCompleteBtn.addEventListener('click', async () => {
        if (!_syncReady || !_bulkCompleteIds.length) return;
        const ids = [..._bulkCompleteIds];
        _bulkCompleteIds = [];
        await _tick();
        await _fsBulkUpdate(ids, { done: true, completedAt: new Date().toISOString() });
      });
    }

    const bulkDeleteBtn = document.getElementById('bulk-delete');
    if (bulkDeleteBtn) {
      let _bulkDeleteIds = [];
      bulkDeleteBtn.addEventListener('click', () => { _bulkDeleteIds = _getCheckedIds(); }, true);
      bulkDeleteBtn.addEventListener('click', async () => {
        if (!_syncReady || !_bulkDeleteIds.length) return;
        const ids = [..._bulkDeleteIds];
        _bulkDeleteIds = [];
        await _tick();
        await _fsBulkDelete(ids);
      });
    }

    const importFile = document.getElementById('import-file');
    if (importFile) {
      importFile.addEventListener('change', async () => {
        if (!_syncReady) return;
        await new Promise(r => setTimeout(r, 450)); 
        _lsSync();
        await _fsOverwriteAll(window.tasks || []);
      });
    }

    const clearBtn = document.getElementById('settings-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!_syncReady) return;
        await new Promise(r => setTimeout(r, 600)); 
        if (!window.tasks || window.tasks.length === 0) {
          _lsSync();
          await _fsOverwriteAll([]);
        }
      });
    }
  }

  /* ════════════════════════════════════════════════════════════════
      UTILITY SYSTEM UTILITIES
     ════════════════════════════════════════════════════════════════ */
  function _tick() { return new Promise(r => setTimeout(r, 16)); }

  function _getCheckedIds() {
    return Array.from(document.querySelectorAll('.bulk-checkbox:checked'))
      .map(cb => cb.closest('.task-item')?.dataset?.id)
      .filter(Boolean);
  }

  function _pollUntilGone(id, fn) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const gone = !window.tasks || !window.tasks.some(t => t.id === id);
      if (gone) {
        clearInterval(timer);
        fn();
      } else if (attempts > 30) {
        clearInterval(timer);
      }
    }, 100);
  }

  function _lsSync() {
    if (!_lsKey) return;
    try {
      localStorage.setItem(_lsKey, JSON.stringify(window.tasks || []));
    } catch (e) {
      console.warn('[SyncPatch] localStorage mirror pipeline failure:', e);
    }
  }

  function _clean(task) {
    const out = {};
    Object.keys(task).forEach(k => {
      if (task[k] !== undefined && k !== '_synced') out[k] = task[k];
    });
    if (!out.createdAt) out.createdAt = new Date().toISOString();
    return out;
  }

  window._NexaSyncPatch = {
    status: () => ({ syncReady: _syncReady, uid: _uid, skipSnaps: _skipSnaps }),
    forceReload: () => { _firstSnap = true; _startListener(); },
  };

})();