/**
 * NEXA — Due Date + Time Patch  |  due-datetime-patch.js  v1.0
 * ──────────────────────────────────────────────────────────────
 * Adds full due-date + due-time support without touching script.js.
 *
 * What this file does:
 *  1. Injects a "Time" input next to the existing "Due" date input in
 *     the task creation bar
 *  2. Monkey-patches window.addTask (or the internal addTask via a
 *     DOMContentLoaded shim) so tasks are saved with { due, dueTime }
 *  3. Replaces the due-badge renderer in buildTaskEl with smart labels:
 *       "Today, 6:00 PM"  /  "Tomorrow"  /  "Aug 24, 9:30 AM"
 *       + a status pill:  Upcoming  /  Due Soon  /  Overdue
 *  4. Extends the inline-edit row so clicking ✎ also shows date + time
 *     inputs on the task card
 *  5. Persists dueTime alongside due via the app's own save() / Firebase
 *     (because sync-patch.js already forwards the whole task object)
 *  6. Feeds dueTime into the reminder system automatically — NexaReminders
 *     already reads task.due + task.dueTime from window.tasks
 *
 * Load AFTER: script.js, sync.js, sync-patch.js, reminders.js
 */

'use strict';

(function () {

  /* ═══════════════════════════════════════════════════
     CONSTANTS
  ═══════════════════════════════════════════════════ */
  const DUE_SOON_MS = 24 * 60 * 60 * 1000;   // within 24 h = "Due Soon"

  /* ═══════════════════════════════════════════════════
     WAIT FOR DOM
  ═══════════════════════════════════════════════════ */
  function _ready(cb) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb);
    } else {
      setTimeout(cb, 0);
    }
  }

  _ready(() => setTimeout(_init, 80));   // slight delay so script.js binds first

  /* ═══════════════════════════════════════════════════
     MAIN INIT
  ═══════════════════════════════════════════════════ */
  function _init() {
    _injectTimeInput();
    _patchAddTask();
    _patchBuildTaskEl();
    _observeEdits();
    console.info('[DuePatch] Initialized.');
  }

  /* ═══════════════════════════════════════════════════
     1. INJECT TIME INPUT into the creation bar
  ═══════════════════════════════════════════════════ */
  function _injectTimeInput() {
    const dateWrap = document.querySelector('.date-wrap');
    if (!dateWrap || document.getElementById('due-time')) return;

    // Build time-wrap sibling
    const timeWrap = document.createElement('div');
    timeWrap.className = 'date-wrap due-time-wrap';
    timeWrap.innerHTML = `
      <label for="due-time" class="date-label">Time</label>
      <input type="time" id="due-time" class="date-input due-time-input"
             aria-label="Due time (optional)" title="Due time (optional)"/>`;

    // Insert right after the date-wrap
    dateWrap.parentNode.insertBefore(timeWrap, dateWrap.nextSibling);

    // Clear time when date is cleared
    const dateInp = document.getElementById('due-date');
    const timeInp = document.getElementById('due-time');
    if (dateInp && timeInp) {
      dateInp.addEventListener('change', () => {
        if (!dateInp.value) timeInp.value = '';
      });
    }
  }

  /* ═══════════════════════════════════════════════════
     2. PATCH addTask — save dueTime on the task object
  ═══════════════════════════════════════════════════ */
  function _patchAddTask() {
    // script.js's addTask is not exposed on window, so we hook
    // the add button and Enter key to post-process the latest task.
    const addBtn  = document.getElementById('add-btn');
    const inp     = document.getElementById('task-input');
    const timeInp = document.getElementById('due-time');
    if (!addBtn || !timeInp) return;

    function _afterAdd() {
      // The task was just unshifted into window.tasks by script.js
      const tasks = window.tasks;
      if (!Array.isArray(tasks) || !tasks.length) return;
      const t = tasks[0];  // most recent is at index 0 (unshift)
      if (!t) return;

      const dueTime = timeInp.value || null;
      if (dueTime && t.due) {
        t.dueTime = dueTime;
        // Persist: use the app's own save function
        if (typeof window.saveWithIndicator === 'function') {
          window.saveWithIndicator('tasks_v2', tasks);
        } else {
          try { localStorage.setItem('tasks_v2', JSON.stringify(tasks)); } catch (_) {}
        }
        // Also push to Firestore via FireSync
        if (window.FireSync?.updateTask) {
          window.FireSync.updateTask(t.id, { dueTime }).catch(() => {});
        }
      }

      // Clear time input alongside date (script.js clears date already)
      timeInp.value = '';
    }

    // Hook after script.js fires (capture=false, so we run after its listeners)
    addBtn.addEventListener('click', () => setTimeout(_afterAdd, 0));
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') setTimeout(_afterAdd, 0);
    });
  }

  /* ═══════════════════════════════════════════════════
     3. PATCH buildTaskEl — smart due badge
  ═══════════════════════════════════════════════════ */
  function _patchBuildTaskEl() {
    // We can't override the private buildTaskEl, so instead we patch
    // it by observing new task list items and replacing their due-badge.
    const tl = document.getElementById('task-list');
    if (!tl) return;

    // Process any already-rendered tasks
    _updateAllBadges();

    // Process new items as they're added by render()
    const mo = new MutationObserver(() => _updateAllBadges());
    mo.observe(tl, { childList: true, subtree: false });
  }

  function _updateAllBadges() {
    const tasks = window.tasks;
    if (!Array.isArray(tasks)) return;

    document.querySelectorAll('#task-list li[data-id]').forEach(li => {
      const t = tasks.find(x => x.id === li.dataset.id);
      if (!t) return;

      const db = li.querySelector('.due-badge');
      if (!db) return;

      if (!t.due) {
        db.textContent = '';
        db.className = 'due-badge';
        return;
      }

      const { label, status } = _smartDueLabel(t);
      db.innerHTML =
        `<span class="due-badge-icon">📅</span>` +
        `<span class="due-badge-text">${_escH(label)}</span>` +
        `<span class="due-status-pill due-status-${status}">${_statusLabel(status)}</span>`;
      db.className = `due-badge has-due due-status-color-${status}`;

      // Also stamp data attribute for CSS overdue styling
      li.classList.toggle('overdue', status === 'overdue' && !t.done);
    });
  }

  /* ─── Smart label builder ─── */
  function _smartDueLabel(task) {
    const due  = task.due;
    const time = task.dueTime || null;

    const nowMs      = Date.now();
    const todayStr   = _todayISO();
    const tmrwStr    = _offsetISO(1);

    // Build the datetime ms for precise "due soon" check
    let dueMs;
    if (time) {
      dueMs = new Date(`${due}T${time}:00`).getTime();
    } else {
      // no time: treat as end-of-day for status, midnight for overdue check
      dueMs = new Date(`${due}T23:59:59`).getTime();
    }

    // Determine status
    let status;
    if (task.done) {
      status = 'done';
    } else if (dueMs < nowMs) {
      status = 'overdue';
    } else if (dueMs - nowMs <= DUE_SOON_MS) {
      status = 'soon';
    } else {
      status = 'upcoming';
    }

    // Build human label
    let datePart;
    if (due === todayStr)  datePart = 'Today';
    else if (due === tmrwStr) datePart = 'Tomorrow';
    else {
      const d = new Date(`${due}T00:00:00`);
      datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      // Add year only if not current year
      if (d.getFullYear() !== new Date().getFullYear()) {
        datePart += `, ${d.getFullYear()}`;
      }
    }

    let label = datePart;
    if (time) {
      // Format time nicely: 09:00 → 9:00 AM
      const [h, m] = time.split(':').map(Number);
      const ampm  = h >= 12 ? 'PM' : 'AM';
      const h12   = h % 12 || 12;
      label += `, ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    }

    return { label, status };
  }

  function _statusLabel(status) {
    return { upcoming: 'Upcoming', soon: 'Due Soon', overdue: 'Overdue', done: '' }[status] || '';
  }

  /* ═══════════════════════════════════════════════════
     4. EXTEND INLINE EDIT with date + time fields
  ═══════════════════════════════════════════════════ */
  function _observeEdits() {
    // script.js makes .task-text contentEditable on edit-btn click.
    // We intercept edit-btn clicks to also show date/time fields.
    const tl = document.getElementById('task-list');
    if (!tl) return;

    tl.addEventListener('click', e => {
      const editBtn = e.target.closest('.edit-btn');
      if (!editBtn) return;
      const li = editBtn.closest('.task-item');
      if (!li) return;
      const taskId = li.dataset.id;
      // Slight delay so script.js's startEdit runs first
      setTimeout(() => _injectEditFields(li, taskId), 30);
    }, true);
  }

  function _injectEditFields(li, taskId) {
    if (li.querySelector('.due-edit-row')) return;  // already injected

    const tasks = window.tasks;
    if (!Array.isArray(tasks)) return;
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;

    const taskBody = li.querySelector('.task-body');
    if (!taskBody) return;

    const row = document.createElement('div');
    row.className = 'due-edit-row';
    row.innerHTML = `
      <div class="due-edit-field">
        <label class="due-edit-label">📅 Due date</label>
        <input type="date" class="due-edit-date date-input"
               value="${t.due || ''}" aria-label="Due date"/>
      </div>
      <div class="due-edit-field">
        <label class="due-edit-label">⏰ Time</label>
        <input type="time" class="due-edit-time date-input"
               value="${t.dueTime || ''}" aria-label="Due time"/>
      </div>
      <button class="due-edit-save" type="button" aria-label="Save due date">Save</button>
      <button class="due-edit-clear" type="button" aria-label="Clear due date">Clear</button>`;

    taskBody.appendChild(row);
    row.querySelector('.due-edit-date').focus();

    // Save
    row.querySelector('.due-edit-save').addEventListener('click', () => {
      const dateVal = row.querySelector('.due-edit-date').value || null;
      const timeVal = row.querySelector('.due-edit-time').value || null;
      _saveDueOnTask(t, dateVal, timeVal);
      row.remove();
      _updateAllBadges();
      // Notify reminder system to refresh bell state
      if (window.NexaReminders?.refresh) window.NexaReminders.refresh();
    });

    // Clear
    row.querySelector('.due-edit-clear').addEventListener('click', () => {
      _saveDueOnTask(t, null, null);
      row.remove();
      _updateAllBadges();
      if (window.NexaReminders?.refresh) window.NexaReminders.refresh();
    });

    // Also auto-save on blur away from the row
    row.addEventListener('focusout', e => {
      if (!row.contains(e.relatedTarget)) {
        const dateVal = row.querySelector('.due-edit-date').value || null;
        const timeVal = row.querySelector('.due-edit-time').value || null;
        _saveDueOnTask(t, dateVal, timeVal);
        setTimeout(() => row.remove(), 100);
        _updateAllBadges();
        if (window.NexaReminders?.refresh) window.NexaReminders.refresh();
      }
    });
  }

  function _saveDueOnTask(t, dateVal, timeVal) {
    t.due     = dateVal;
    t.dueTime = timeVal;

    // Persist locally
    const tasks = window.tasks;
    if (typeof window.saveWithIndicator === 'function') {
      window.saveWithIndicator('tasks_v2', tasks);
    } else {
      try { localStorage.setItem('tasks_v2', JSON.stringify(tasks)); } catch (_) {}
    }

    // Firestore
    if (window.FireSync?.updateTask) {
      window.FireSync.updateTask(t.id, { due: dateVal, dueTime: timeVal }).catch(() => {});
    }
  }

  /* ═══════════════════════════════════════════════════
     UTILS
  ═══════════════════════════════════════════════════ */
  function _todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function _offsetISO(days) {
    const d = new Date(Date.now() + days * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function _escH(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

})();