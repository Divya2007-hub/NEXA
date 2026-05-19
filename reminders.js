/**
 * NEXA — Push Notification + Reminder Engine  v4.1
 * ══════════════════════════════════════════════════════════════════
 * Features (complete):
 *   ✅ Native browser / system notifications (desktop + Android PWA)
 *   ✅ Notification permission with custom pre-prompt UI
 *   ✅ Notification ACTIONS: Open Task · Mark Complete · Snooze 10 min
 *   ✅ Service Worker background notifications (works tab-minimized)
 *   ✅ Reminder options: At time / 5 / 15 / 30 min / 1h / 1d / Custom
 *   ✅ Smart due labels: "Today, 6:00 PM" · "Due Soon" · "Overdue"
 *   ✅ Animated bell icon + reminder glow
 *   ✅ Countdown timer until due (refreshed every minute)
 *   ✅ Deduplication — fires exactly once even after refresh/restart
 *   ✅ Firebase Firestore sync (reminderEnabled, reminderTime, notified)
 *   ✅ LocalStorage offline queue + sync when online returns
 *   ✅ Auto-reschedule on every page load
 *   ✅ Notification sound toggle (Settings)
 *   ✅ Test notification button (Settings)
 *   ✅ Default reminder timing picker (Settings)
 *   ✅ Snooze duration setting (Settings)
 *   ✅ SW action handler: complete / snooze / open
 *   ✅ New SW detection + auto-update prompt
 *   ✅ Fully responsive: mobile / tablet / laptop / desktop
 *
 * Load AFTER script.js, sync.js, sync-patch.js, responsive-patch.js
 * Requires reminders.css to be loaded.
 * ══════════════════════════════════════════════════════════════════
 */

'use strict';

(function () {

  /* ═══════════════════════════════════════════════════
     CONSTANTS & CONFIG
  ═══════════════════════════════════════════════════ */
  const LS_KEY_REMINDERS   = 'nexa_reminders_v4';
  const LS_KEY_FIRED       = 'nexa_reminders_fired_v4';
  const LS_KEY_PERM_ASKED  = 'nexa_notif_perm_asked';
  const LS_KEY_SETTINGS    = 'nexa_reminder_settings_v1';
  const LS_KEY_OFFLINE_Q   = 'nexa_reminder_offline_queue';
  const SW_MSG_SCHEDULE    = 'NEXA_SCHEDULE_REMINDER';
  const SW_PATH            = '/sw.js';

  const OFFSETS = [
    { key: 'at',     label: 'At due time',   minutes: 0    },
    { key: '5m',     label: '5 min before',  minutes: 5    },
    { key: '15m',    label: '15 min before', minutes: 15   },
    { key: '30m',    label: '30 min before', minutes: 30   },
    { key: '1h',     label: '1 hr before',   minutes: 60   },
    { key: '1d',     label: '1 day before',  minutes: 1440 },
    { key: 'custom', label: 'Custom',         minutes: null },
  ];

  /* Active setTimeout handles keyed by "<taskId>:<offsetKey>" */
  const _timers = {};

  /* ═══════════════════════════════════════════════════
     SETTINGS
  ═══════════════════════════════════════════════════ */
  const _defaultSettings = {
    soundEnabled:    true,
    defaultOffset:   '15m',
    snoozeDuration:  10,      // minutes
  };

  function _loadSettings() {
    try {
      return { ..._defaultSettings, ...JSON.parse(localStorage.getItem(LS_KEY_SETTINGS) || '{}') };
    } catch { return { ..._defaultSettings }; }
  }
  function _saveSettings(s) {
    try { localStorage.setItem(LS_KEY_SETTINGS, JSON.stringify(s)); } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════
     PERSISTENCE
  ═══════════════════════════════════════════════════ */
  function _loadReminders() {
    try { return JSON.parse(localStorage.getItem(LS_KEY_REMINDERS) || '{}'); } catch { return {}; }
  }
  function _saveRemindersLocal(data) {
    try { localStorage.setItem(LS_KEY_REMINDERS, JSON.stringify(data)); } catch (_) {}
  }
  function _loadFired() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEY_FIRED) || '[]')); } catch { return new Set(); }
  }
  function _saveFired(set) {
    try { localStorage.setItem(LS_KEY_FIRED, JSON.stringify([...set])); } catch (_) {}
  }

  /* Offline queue */
  function _loadOfflineQueue() {
    try { return JSON.parse(localStorage.getItem(LS_KEY_OFFLINE_Q) || '[]'); } catch { return []; }
  }
  function _saveOfflineQueue(q) {
    try { localStorage.setItem(LS_KEY_OFFLINE_Q, JSON.stringify(q)); } catch (_) {}
  }

  function _queueOfflineSync(taskId, reminder) {
    const q = _loadOfflineQueue();
    const idx = q.findIndex(e => e.taskId === taskId);
    if (idx >= 0) q[idx] = { taskId, reminder, ts: Date.now() };
    else q.push({ taskId, reminder, ts: Date.now() });
    _saveOfflineQueue(q);
  }

  async function _flushOfflineQueue() {
    const q = _loadOfflineQueue();
    if (!q.length) return;
    const remaining = [];
    for (const entry of q) {
      try {
        await _syncReminderToFirebase(entry.taskId, entry.reminder);
      } catch (_) {
        remaining.push(entry);
      }
    }
    _saveOfflineQueue(remaining);
  }

  function _saveReminder(taskId, reminder) {
    const all = _loadReminders();
    all[taskId] = { ...reminder, reminderEnabled: true, notified: false };
    _saveRemindersLocal(all);
    if (navigator.onLine) {
      _syncReminderToFirebase(taskId, all[taskId]);
    } else {
      _queueOfflineSync(taskId, all[taskId]);
    }
  }

  function _deleteReminder(taskId) {
    const all = _loadReminders();
    delete all[taskId];
    _saveRemindersLocal(all);
    _syncReminderToFirebase(taskId, null);
  }

  async function _syncReminderToFirebase(taskId, reminder) {
    try {
      if (window.FireSync && typeof window.FireSync.updateTask === 'function') {
        const changes = reminder
          ? {
              reminderEnabled: true,
              reminderTime:    reminder.dueTime || null,
              reminder:        reminder,
              notified:        false,
            }
          : { reminderEnabled: false, reminder: null };
        await window.FireSync.updateTask(taskId, changes);
      }
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════
     NOTIFICATION PERMISSION
  ═══════════════════════════════════════════════════ */
  const _perm = {
    get status() {
      if (!('Notification' in window)) return 'unsupported';
      return Notification.permission;
    },
    async request() {
      if (!('Notification' in window)) return 'unsupported';
      if (this.status !== 'default') return this.status;
      try {
        localStorage.setItem(LS_KEY_PERM_ASKED, '1');
        const result = await Notification.requestPermission();
        _refreshAllSettingsUI();
        return result;
      } catch (e) {
        return 'denied';
      }
    },
    get alreadyAsked() {
      return localStorage.getItem(LS_KEY_PERM_ASKED) === '1' || this.status !== 'default';
    },
  };

  /* ═══════════════════════════════════════════════════
     NOTIFICATION SOUND
  ═══════════════════════════════════════════════════ */
  function _playReminderSound() {
    const settings = _loadSettings();
    if (!settings.soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════
     SMART TIME-REMAINING LABEL
  ═══════════════════════════════════════════════════ */
  function _timeLabel(task) {
    if (!task || !task.due) return null;
    const reminder = _loadReminders()[task.id];
    const timeStr  = reminder?.dueTime || task.dueTime || '23:59';
    const dueMs    = new Date(`${task.due}T${timeStr}:00`).getTime();
    if (isNaN(dueMs)) return null;

    const diffMs  = dueMs - Date.now();
    const diffMin = Math.round(diffMs / 60000);

    if (diffMin < -1440) {
      const days = Math.round(Math.abs(diffMin) / 1440);
      return `${days}d overdue`;
    }
    if (diffMin < -60) {
      const hrs = Math.round(Math.abs(diffMin) / 60);
      return `${hrs}h overdue`;
    }
    if (diffMin < 0)    return 'overdue';
    if (diffMin === 0)  return 'due now';
    if (diffMin < 60)   return `${diffMin}m left`;
    if (diffMin < 120)  return 'in 1h';
    if (diffMin < 1440) {
      const h = Math.round(diffMin / 60);
      return `in ${h}h`;
    }
    const days = Math.round(diffMin / 1440);
    if (days === 1) return 'tomorrow';
    return `in ${days}d`;
  }

  /* ═══════════════════════════════════════════════════
     FIRE A NOTIFICATION
  ═══════════════════════════════════════════════════ */
  function _notify(taskId, taskText, dueTimeStr, offsetKey, priority) {
    const fired    = _loadFired();
    const firedKey = `${taskId}:${offsetKey}`;
    if (fired.has(firedKey)) return;

    fired.add(firedKey);
    _saveFired(fired);

    /* Mark as notified in local store */
    const all = _loadReminders();
    if (all[taskId]) {
      all[taskId].notified = true;
      _saveRemindersLocal(all);
    }

    _playReminderSound();

    if (_perm.status !== 'granted') return;

    const off  = OFFSETS.find(o => o.key === offsetKey);
    const body = (off && off.minutes && off.minutes > 0)
      ? `${taskText} — ${off.label}`
      : `${taskText} — Due now`;

    const notifData = {
      type:     SW_MSG_SCHEDULE,
      title:    'NEXA Reminder',
      body,
      tag:      firedKey,
      taskId,
      priority: priority || 'low',
      dueTime:  dueTimeStr,
      icon:     '/icons/icon-192.png',
      badge:    '/icons/icon-192.png',
    };

    /* Always prefer SW notification — required for PWA actions + Android Chrome.
       _ensureSwController() waits up to 3 s for the SW to activate if needed. */
    _ensureSwController()
      .then(controller => {
        if (controller) {
          controller.postMessage(notifData);
          _showToast('🔔 Reminder sent successfully');
        } else {
          /* True fallback: SW unavailable (iOS Safari, http://) */
          const n = new Notification('NEXA Reminder', {
            body,
            icon:    '/icons/icon-192.png',
            badge:   '/icons/icon-192.png',
            tag:     firedKey,
            renotify: false,
            vibrate: [200, 100, 200],
            data:    { taskId },
          });
          n.addEventListener('click', () => { window.focus?.(); _focusTask(taskId); });
          _showToast('🔔 Reminder sent successfully');
        }
      })
      .catch(e => {
        console.error('[Reminders] Notification error:', e);
        _showToast('⚠️ Could not send notification — check browser settings', 4000);
      });
  }

  /**
   * Resolve to the active SW controller, waiting briefly if it's registering.
   * Handles the Android Chrome case where the page load races with SW activation.
   */
  function _ensureSwController() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);

    if (navigator.serviceWorker.controller) {
      return Promise.resolve(navigator.serviceWorker.controller);
    }

    /* SW registered but not yet controlling — wait up to 3 s */
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        resolve(navigator.serviceWorker.controller || null);
      }, 3000);

      navigator.serviceWorker.ready.then(reg => {
        clearTimeout(timeout);
        /* After ready, the controller may still not be set on first load.
           Use reg.active as a fallback channel. */
        resolve(navigator.serviceWorker.controller || reg.active || null);
      }).catch(() => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  function _focusTask(taskId) {
    /* Try to navigate to tasks tab */
    window.focus?.();
    const navBtn = document.querySelector('[data-tab="tasks"]');
    if (navBtn) navBtn.click();
    setTimeout(() => {
      const li = document.querySelector(`[data-id="${taskId}"]`);
      if (li) {
        li.scrollIntoView({ behavior: 'smooth', block: 'center' });
        li.classList.add('highlight-pulse');
        setTimeout(() => li.classList.remove('highlight-pulse'), 1800);
      }
    }, 200);
  }

  /* ═══════════════════════════════════════════════════
     SCHEDULING
  ═══════════════════════════════════════════════════ */
  function _scheduleTask(taskId, reminder) {
    _cancelTaskTimers(taskId);

    const { dueDate, dueTime, offsets, taskText, customMinutes } = reminder;
    if (!dueDate || !dueTime || !offsets?.length) return;

    const dueMs = new Date(`${dueDate}T${dueTime}:00`).getTime();
    if (isNaN(dueMs)) return;

    const now   = Date.now();
    const fired = _loadFired();

    /* Find task priority from window.tasks */
    const task     = (window.tasks || []).find(t => t.id === taskId);
    const priority = task?.pri || 'low';

    offsets.forEach(offsetKey => {
      const off = OFFSETS.find(o => o.key === offsetKey);
      if (!off) return;

      const mins     = offsetKey === 'custom' ? (customMinutes || 0) : (off.minutes || 0);
      const fireAt   = dueMs - mins * 60000;
      const delay    = fireAt - now;
      const firedKey = `${taskId}:${offsetKey}`;

      if (fired.has(firedKey)) return;

      if (delay <= 0) {
        /* Fire immediately if missed by < 5 min (reload / restart scenario) */
        if (Math.abs(delay) < 5 * 60000) {
          _notify(taskId, taskText, dueTime, offsetKey, priority);
        }
        return;
      }

      const timerId = setTimeout(() => {
        _notify(taskId, taskText, dueTime, offsetKey, priority);
        delete _timers[firedKey];
      }, Math.min(delay, 2_147_483_647));

      _timers[firedKey] = timerId;
    });
  }

  function _cancelTaskTimers(taskId) {
    Object.keys(_timers).forEach(key => {
      if (key.startsWith(`${taskId}:`)) {
        clearTimeout(_timers[key]);
        delete _timers[key];
      }
    });
  }

  function _removeReminder(taskId) {
    _cancelTaskTimers(taskId);
    _deleteReminder(taskId);
    const fired = _loadFired();
    OFFSETS.forEach(o => fired.delete(`${taskId}:${o.key}`));
    _saveFired(fired);
  }

  function _rehydrateAll() {
    const data = _loadReminders();
    Object.entries(data).forEach(([taskId, reminder]) => {
      _scheduleTask(taskId, reminder);
    });
  }

  /* ═══════════════════════════════════════════════════
     POPOVER UI
  ═══════════════════════════════════════════════════ */
  let _activePopover  = null;
  let _activeTaskId   = null;
  let _outsideHandler = null;

  function _closePopover() {
    if (!_activePopover) return;
    _activePopover.classList.remove('visible');
    const el = _activePopover;
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 230);
    _activePopover = null;
    _activeTaskId  = null;
    if (_outsideHandler) {
      document.removeEventListener('mousedown', _outsideHandler, true);
      document.removeEventListener('touchstart', _outsideHandler, true);
      _outsideHandler = null;
    }
  }

  function _openPopover(bellBtn, taskId) {
    if (_activeTaskId === taskId) { _closePopover(); return; }
    _closePopover();

    const task = (window.tasks || []).find(t => t.id === taskId);
    if (!task) return;

    const hasDue    = !!task.due;
    const data      = _loadReminders();
    const current   = data[taskId];
    const settings  = _loadSettings();
    const savedTime = current?.dueTime  || task.dueTime || '09:00';
    const savedOff  = new Set(current?.offsets || [settings.defaultOffset]);
    const savedCMin = current?.customMinutes || 30;

    const pop = document.createElement('div');
    pop.className = 'reminder-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Set reminder');
    pop.setAttribute('aria-modal', 'true');

    const deniedNotice = _perm.status === 'denied'
      ? `<div class="rp-denied-notice">🚫 Notifications are blocked.
          <a class="rp-denied-link" href="#" tabindex="0">How to unblock ↗</a></div>`
      : '';

    if (!hasDue) {
      pop.innerHTML = `
        <div class="rp-header">
          <span class="rp-title">🔔 Reminder</span>
          <button class="rp-close" aria-label="Close">✕</button>
        </div>
        <div class="rp-task-name" title="${_escH(task.text)}">${_escH(task.text)}</div>
        <div class="rp-no-due">
          <span class="rp-no-due-icon">📅</span>
          <span>Add a due date to this task before setting a reminder.</span>
        </div>`;
    } else {
      pop.innerHTML = `
        <div class="rp-header">
          <span class="rp-title">🔔 Reminder</span>
          <button class="rp-close" aria-label="Close">✕</button>
        </div>
        <div class="rp-task-name" title="${_escH(task.text)}">${_escH(task.text)}</div>

        <div class="rp-due-row">
          <span class="rp-due-label">Time on ${task.due}</span>
          <input type="time" class="rp-time-input" id="rp-time-${taskId}"
                 value="${savedTime}" aria-label="Due time"/>
        </div>

        <div class="rp-offset-label">Notify me</div>
        <div class="rp-chips">
          ${OFFSETS.filter(o => o.key !== 'custom').map(o => `
            <button class="rp-chip${savedOff.has(o.key) ? ' selected' : ''}"
                    data-offset="${o.key}">${o.label}</button>
          `).join('')}
          <button class="rp-chip${savedOff.has('custom') ? ' selected' : ''}"
                  data-offset="custom">Custom</button>
        </div>

        <div class="rp-custom-row${savedOff.has('custom') ? '' : ' hidden'}" id="rp-custom-row-${taskId}">
          <span class="rp-due-label">Minutes before</span>
          <input type="number" class="rp-time-input rp-custom-mins"
                 id="rp-custom-mins-${taskId}" min="1" max="10080"
                 value="${savedCMin}" aria-label="Custom minutes before"/>
        </div>

        ${deniedNotice}

        <div class="rp-actions">
          ${current ? `<button class="rp-btn danger js-rp-remove" aria-label="Remove reminder">Remove</button>` : ''}
          <button class="rp-btn js-rp-cancel">Cancel</button>
          <button class="rp-btn primary js-rp-save">Save</button>
        </div>`;
    }

    document.body.appendChild(pop);
    _activePopover = pop;
    _activeTaskId  = taskId;

    _positionPopover(pop, bellBtn);
    requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.add('visible')));

    /* Events */
    pop.querySelector('.rp-close')?.addEventListener('click', _closePopover);
    pop.querySelector('.js-rp-cancel')?.addEventListener('click', _closePopover);
    pop.querySelector('.rp-denied-link')?.addEventListener('click', e => {
      e.preventDefault();
      _showToast('Open browser Settings → Site Settings → Notifications → Allow', 5000);
    });

    /* Chip toggles */
    pop.querySelectorAll('.rp-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('selected');
        const customRow  = document.getElementById(`rp-custom-row-${taskId}`);
        const customChip = pop.querySelector('[data-offset="custom"]');
        if (customRow) {
          customRow.classList.toggle('hidden', !customChip?.classList.contains('selected'));
        }
        /* Ensure at least one is selected */
        if (!pop.querySelectorAll('.rp-chip.selected').length) {
          chip.classList.add('selected');
        }
      });
    });

    /* Save */
    pop.querySelector('.js-rp-save')?.addEventListener('click', async () => {
      if (_perm.status === 'default') {
        _closePopover();
        _showPrePrompt(taskId);
        return;
      }
      if (_perm.status === 'denied') {
        _showToast('Notifications blocked — check browser settings to allow them', 4500);
        _closePopover();
        return;
      }
      _doSaveReminder(pop, task, taskId);
    });

    /* Remove */
    pop.querySelector('.js-rp-remove')?.addEventListener('click', () => {
      _removeReminder(taskId);
      _closePopover();
      _refreshBellBtn(taskId);
      _refreshTaskBadge(taskId);
      _showToast('Reminder removed');
    });

    /* Outside click dismiss */
    _outsideHandler = (e) => {
      if (!pop.contains(e.target) && e.target !== bellBtn) _closePopover();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', _outsideHandler, true);
      document.addEventListener('touchstart', _outsideHandler, true);
    }, 60);
  }

  function _doSaveReminder(pop, task, taskId) {
    const timeInput   = pop.querySelector(`#rp-time-${taskId}`);
    const customInput = pop.querySelector(`#rp-custom-mins-${taskId}`);
    const dueTime     = timeInput?.value || '09:00';
    const customMins  = parseInt(customInput?.value) || 30;

    const selectedOffsets = [...pop.querySelectorAll('.rp-chip.selected')]
      .map(c => c.dataset.offset);
    if (!selectedOffsets.length) { _closePopover(); return; }

    const reminder = {
      dueDate:        task.due,
      dueTime,
      dueDate2:       task.due,
      offsets:        selectedOffsets,
      taskText:       task.text,
      customMinutes:  customMins,
      reminderEnabled: true,
      notified:       false,
      createdAt:      new Date().toISOString(),
    };

    /* Clear old fired flags so rescheduled reminders can re-fire */
    const fired = _loadFired();
    OFFSETS.forEach(o => fired.delete(`${taskId}:${o.key}`));
    _saveFired(fired);

    _saveReminder(taskId, reminder);
    _scheduleTask(taskId, reminder);

    _closePopover();
    _refreshBellBtn(taskId);
    _refreshTaskBadge(taskId);
    _showToast('🔔 Reminder set! You\'ll be notified before the task is due.');

    /* Request permission banner if needed (now that user explicitly saved) */
    if (_perm.status === 'default') {
      _showPermissionBanner();
    }
  }

  function _positionPopover(pop, anchor) {
    const rect = anchor.getBoundingClientRect();
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;
    const pw   = Math.min(270, vw - 24);
    const ph   = 340;

    let top  = rect.bottom + 8;
    let left = rect.left;

    if (top + ph > vh - 16) top = Math.max(8, rect.top - ph - 8);
    if (left + pw > vw - 12) left = vw - pw - 12;
    if (left < 12) left = 12;

    pop.style.top   = `${top}px`;
    pop.style.left  = `${left}px`;
    pop.style.width = `${pw}px`;
  }

  /* ═══════════════════════════════════════════════════
     PRE-PROMPT (custom permission request UI)
  ═══════════════════════════════════════════════════ */
  function _showPrePrompt(taskId) {
    /* Don't show if already decided */
    if (_perm.status !== 'default') return;

    const existing = document.getElementById('nexa-preprompt');
    if (existing) { existing.remove(); }

    const el = document.createElement('div');
    el.id = 'nexa-preprompt';
    el.className = 'nexa-preprompt';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Enable notifications');
    el.innerHTML = `
      <div class="npp-icon" aria-hidden="true">🔔</div>
      <div class="npp-body">
        <div class="npp-title">Enable Task Reminders</div>
        <div class="npp-sub">Get notified when tasks are due — works even when the tab is minimized or the screen is off.</div>
        <div class="npp-features">
          <span class="npp-feat">✅ Desktop &amp; Android</span>
          <span class="npp-feat">✅ Installed PWA</span>
          <span class="npp-feat">✅ Background alerts</span>
          <span class="npp-feat">✅ Action buttons</span>
        </div>
      </div>
      <div class="npp-actions">
        <button class="npp-btn npp-dismiss" aria-label="Not now">Not now</button>
        <button class="npp-btn npp-allow primary" aria-label="Enable notifications">Enable Notifications</button>
      </div>`;

    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));

    el.querySelector('.npp-dismiss').addEventListener('click', () => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 300);
    });

    el.querySelector('.npp-allow').addEventListener('click', async () => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 300);

      const result = await _perm.request();
      _refreshAllSettingsUI();

      if (result === 'granted') {
        _showToast('🔔 Notifications enabled! Set reminders on any task with a due date.');
        /* Re-open popover for the pending taskId if provided */
        if (taskId) {
          const li  = document.querySelector(`[data-id="${taskId}"]`);
          const btn = li?.querySelector('.reminder-btn');
          if (btn) setTimeout(() => _openPopover(btn, taskId), 300);
        }
      } else if (result === 'denied') {
        _showToast('Notifications blocked — you can change this in browser settings', 4500);
      }
    });

    /* Auto-dismiss after 18s */
    setTimeout(() => {
      if (el.parentNode) {
        el.classList.remove('visible');
        setTimeout(() => el.remove(), 300);
      }
    }, 18000);
  }

  /* ═══════════════════════════════════════════════════
     PERMISSION BANNER (subtle bottom bar)
  ═══════════════════════════════════════════════════ */
  let _bannerEl    = null;
  let _bannerTimer = null;

  function _showPermissionBanner() {
    if (_bannerEl || _perm.alreadyAsked) return;

    const banner = document.createElement('div');
    banner.className = 'reminder-permission-banner';
    banner.innerHTML = `
      <span class="rpb-icon">🔔</span>
      <div class="rpb-text">
        <div class="rpb-title">Enable task reminders</div>
        <div class="rpb-sub">Get notified before tasks are due — even in the background</div>
      </div>
      <div class="rpb-actions">
        <button class="rpb-btn js-rpb-dismiss">Not now</button>
        <button class="rpb-btn allow js-rpb-allow">Allow</button>
      </div>`;

    document.body.appendChild(banner);
    _bannerEl = banner;
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('visible')));

    banner.querySelector('.js-rpb-dismiss').addEventListener('click', _hideBanner);
    banner.querySelector('.js-rpb-allow').addEventListener('click', async () => {
      _hideBanner();
      const result = await _perm.request();
      if (result === 'denied') {
        _showToast('Notifications blocked. Check browser settings.', 4000);
      } else if (result === 'granted') {
        _showToast('🔔 Notifications enabled!');
      }
      _refreshAllSettingsUI();
    });

    _bannerTimer = setTimeout(_hideBanner, 16000);
  }

  function _hideBanner() {
    if (!_bannerEl) return;
    clearTimeout(_bannerTimer);
    _bannerEl.classList.remove('visible');
    const el = _bannerEl;
    setTimeout(() => el?.remove(), 300);
    _bannerEl = null;
  }

  /* ═══════════════════════════════════════════════════
     BELL BUTTON STATE
  ═══════════════════════════════════════════════════ */
  function _injectBellBtn(li, taskId) {
    const btn = li.querySelector('.reminder-btn');
    if (!btn || btn.dataset.wired === '1') return;
    btn.dataset.wired  = '1';
    btn.dataset.taskId = taskId;

    _applyBellState(btn, taskId);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();

      const task   = (window.tasks || []).find(t => t.id === taskId);
      const hasDue = !!(task?.due);

      if (!hasDue) {
        _showToast('📅 Add a due date first to set a reminder', 2800);
        return;
      }

      /* If perm is default and not yet asked, show pre-prompt first */
      if (_perm.status === 'default' && !_perm.alreadyAsked) {
        _openPopover(btn, taskId);
        return;
      }

      _openPopover(btn, taskId);
    }, true);

    _refreshTaskBadge(taskId, li);
  }

  function _applyBellState(btn, taskId) {
    const task        = (window.tasks || []).find(t => t.id === taskId);
    const hasDue      = !!(task?.due);
    const data        = _loadReminders();
    const hasReminder = !!(data[taskId]);

    btn.classList.toggle('has-reminder', hasReminder && hasDue);
    btn.classList.toggle('no-due', !hasDue);

    if (!hasDue) {
      btn.title = 'Add due date first';
      btn.setAttribute('aria-label', 'Add due date first to set reminder');
      btn.style.opacity = '0.38';
      btn.style.cursor  = 'not-allowed';
    } else if (hasReminder) {
      const label = _timeLabel(task);
      btn.title = label ? `Reminder set · ${label}` : 'Edit reminder';
      btn.setAttribute('aria-label', btn.title);
      btn.style.opacity = '';
      btn.style.cursor  = '';
    } else {
      btn.title = 'Set reminder';
      btn.setAttribute('aria-label', 'Set reminder');
      btn.style.opacity = '';
      btn.style.cursor  = '';
    }
  }

  function _refreshBellBtn(taskId) {
    document.querySelectorAll(`.reminder-btn[data-task-id="${taskId}"]`).forEach(btn => {
      _applyBellState(btn, taskId);
    });
  }

  /* ═══════════════════════════════════════════════════
     REMINDER BADGE
  ═══════════════════════════════════════════════════ */
  function _refreshTaskBadge(taskId, li) {
    const el = li || document.querySelector(`[data-id="${taskId}"]`);
    if (!el) return;
    const meta = el.querySelector('.task-meta');
    if (!meta) return;

    let badge    = meta.querySelector('.task-reminder-badge');
    const data   = _loadReminders();
    const reminder = data[taskId];
    const task   = (window.tasks || []).find(t => t.id === taskId);

    if (reminder && task) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'task-reminder-badge';
        meta.appendChild(badge);
      }
      const label = _timeLabel(task);
      badge.innerHTML = `🔔${label ? ` <span class="rbd-time">${_escH(label)}</span>` : ''}`;
    } else {
      badge?.remove();
    }
  }

  /* ═══════════════════════════════════════════════════
     OBSERVE TASK LIST
  ═══════════════════════════════════════════════════ */
  function _observeTaskList() {
    const list = document.getElementById('task-list');
    if (!list) return;
    _wireBells(list);
    const mo = new MutationObserver(() => _wireBells(list));
    mo.observe(list, { childList: true, subtree: false });
  }

  function _wireBells(list) {
    list.querySelectorAll('li[data-id]').forEach(li => {
      _injectBellBtn(li, li.dataset.id);
    });
  }

  /* ═══════════════════════════════════════════════════
     CLEANUP — remove reminder when task is deleted
  ═══════════════════════════════════════════════════ */
  function _hookTaskMutations() {
    const list = document.getElementById('task-list');
    if (!list) return;
    new MutationObserver((mutations) => {
      mutations.forEach(m => {
        m.removedNodes.forEach(node => {
          if (node.nodeType === 1 && node.dataset?.id) {
            const data = _loadReminders();
            if (data[node.dataset.id]) _removeReminder(node.dataset.id);
          }
        });
      });
    }).observe(list, { childList: true });
  }

  /* ═══════════════════════════════════════════════════
     SETTINGS PAGE CARD
  ═══════════════════════════════════════════════════ */
  function _injectSettingsSection() {
    /* Inject into the existing settings tab (id="tab-settings") */
    const settingsGrid = document.querySelector('#tab-settings .settings-grid');
    if (!settingsGrid || settingsGrid.querySelector('#nexa-reminder-settings-card')) return;

    const settings = _loadSettings();

    const card = document.createElement('div');
    card.className = 'settings-card';
    card.id = 'nexa-reminder-settings-card';
    card.innerHTML = `
      <div class="sc-header">
        <span class="sc-icon">🔔</span>
        <h3 class="sc-title">Notifications &amp; Reminders</h3>
      </div>
      <div class="sc-body reminder-settings-card">

        <!-- Permission row -->
        <div class="reminder-settings-row">
          <div>
            <div class="rs-label">Notification permission</div>
            <div class="rs-sub">Required to receive task reminders</div>
          </div>
          <span class="rs-perm-status" id="rs-perm-status">…</span>
        </div>

        <!-- Request / Test row -->
        <div class="reminder-settings-row" id="rs-request-row">
          <div>
            <div class="rs-label">Enable reminders</div>
            <div class="rs-sub">Allow browser notifications for task reminders</div>
          </div>
          <button class="rs-action-btn" id="rs-request-btn">Request permission</button>
        </div>

        <!-- Sound toggle -->
        <div class="reminder-settings-row">
          <div>
            <div class="rs-label">Notification sound</div>
            <div class="rs-sub">Play a tone when a reminder fires</div>
          </div>
          <button class="toggle-btn ${settings.soundEnabled ? 'on' : ''}" id="rs-sound-toggle" aria-label="Toggle notification sound" style="pointer-events:auto">
            <span class="toggle-knob" style="pointer-events:none"></span>
          </button>
        </div>

        <!-- Default offset -->
        <div class="reminder-settings-row">
          <div>
            <div class="rs-label">Default reminder time</div>
            <div class="rs-sub">Applied when creating a new reminder</div>
          </div>
          <select class="recur-select rs-default-offset" id="rs-default-offset" aria-label="Default reminder offset">
            ${OFFSETS.filter(o => o.key !== 'custom').map(o =>
              `<option value="${o.key}" ${settings.defaultOffset === o.key ? 'selected' : ''}>${o.label}</option>`
            ).join('')}
          </select>
        </div>

        <!-- Snooze duration -->
        <div class="reminder-settings-row">
          <div>
            <div class="rs-label">Snooze duration</div>
            <div class="rs-sub">Minutes to delay when you snooze a notification</div>
          </div>
          <input type="number" class="set-input rs-snooze-input" id="rs-snooze"
                 min="1" max="120" value="${settings.snoozeDuration}"
                 aria-label="Snooze duration in minutes" style="width:60px"/>
        </div>

        <!-- Active count -->
        <div class="reminder-settings-row">
          <div>
            <div class="rs-label">Active reminders</div>
            <div class="rs-sub">Tasks currently scheduled for notification</div>
          </div>
          <span class="rs-perm-status default" id="rs-active-count">0</span>
        </div>

        <!-- Test notification (dev only) -->
        <div class="reminder-settings-row" id="rs-test-row" style="display:none">
          <div>
            <div class="rs-label">Test notification</div>
            <div class="rs-sub">Fire a sample reminder right now</div>
          </div>
          <button class="rs-action-btn" id="rs-test-btn">Send test</button>
        </div>

        <!-- Clear all -->
        <div class="reminder-settings-row">
          <div>
            <div class="rs-label">Clear all reminders</div>
            <div class="rs-sub">Remove all stored task reminders</div>
          </div>
          <button class="rs-action-btn" id="rs-clear-btn"
            style="border-color:rgba(248,113,113,.3);color:var(--hi);background:var(--hi-b);">
            Clear all
          </button>
        </div>
      </div>`;

    /* Insert before the first card (top of grid) */
    settingsGrid.insertBefore(card, settingsGrid.firstChild);

    _bindSettingsEvents(card);
    _refreshSettingsPermStatus();
  }

  function _bindSettingsEvents(card) {
    /* Request permission */
    card.querySelector('#rs-request-btn')?.addEventListener('click', async () => {
      if (_perm.status === 'default') {
        _showPrePrompt(null);
      } else if (_perm.status === 'denied') {
        _showToast('Notifications are blocked. Open browser Settings → Site Settings → Notifications.', 5000);
      } else {
        _showToast('Notifications are already enabled ✅');
      }
    });

    /* Sound toggle — scoped to this card, no duplicate listeners */
    card.querySelector('#rs-sound-toggle')?.addEventListener('click', function () {
      const settings = _loadSettings();
      settings.soundEnabled = !settings.soundEnabled;
      _saveSettings(settings);
      this.classList.toggle('on', settings.soundEnabled);
      _showToast(settings.soundEnabled ? '🔊 Notification sound on' : '🔇 Notification sound off');
    });

    /* Default offset */
    card.querySelector('#rs-default-offset')?.addEventListener('change', (e) => {
      const settings = _loadSettings();
      settings.defaultOffset = e.target.value;
      _saveSettings(settings);
    });

    /* Snooze duration */
    card.querySelector('#rs-snooze')?.addEventListener('change', (e) => {
      const settings = _loadSettings();
      settings.snoozeDuration = Math.max(1, Math.min(120, parseInt(e.target.value) || 10));
      _saveSettings(settings);
      e.target.value = settings.snoozeDuration;
    });

    /* Test notification */
    card.querySelector('#rs-test-btn')?.addEventListener('click', async () => {
      if (_perm.status !== 'granted') {
        _showToast('Enable notifications first to test them', 3000);
        return;
      }
      _playReminderSound();
      const testTag  = 'nexa-test-' + Date.now();
      const testData = {
        type:  SW_MSG_SCHEDULE,
        title: 'NEXA Test Reminder',
        body:  'This is a test — reminders are working! 🎉',
        tag:   testTag,
        taskId: null,
        icon:  '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      };
      try {
        const controller = await _ensureSwController();
        if (controller) {
          controller.postMessage(testData);
        } else {
          new Notification(testData.title, {
            body:  testData.body,
            icon:  testData.icon,
            badge: testData.badge,
            tag:   testTag,
          });
        }
        _showToast('🔔 Test notification sent!');
      } catch (e) {
        _showToast('Failed to send test notification: ' + e.message, 4000);
      }
    });

    /* Clear all */
    card.querySelector('#rs-clear-btn')?.addEventListener('click', () => {
      const data = _loadReminders();
      Object.keys(data).forEach(id => _removeReminder(id));
      _refreshAllSettingsUI();
      _refreshAllBadges();
      _showToast('All reminders cleared');
    });
  }

  function _refreshSettingsPermStatus() {
    const statusEl  = document.getElementById('rs-perm-status');
    const reqRow    = document.getElementById('rs-request-row');
    const testRow   = document.getElementById('rs-test-row');
    const countEl   = document.getElementById('rs-active-count');
    const requestBtn = document.getElementById('rs-request-btn');

    const p = _perm.status;

    if (statusEl) {
      if (p === 'granted')     { statusEl.textContent = '✓ Granted';   statusEl.className = 'rs-perm-status granted'; }
      else if (p === 'denied') { statusEl.textContent = '✕ Blocked';   statusEl.className = 'rs-perm-status denied'; }
      else if (p === 'unsupported') { statusEl.textContent = '— N/A';  statusEl.className = 'rs-perm-status default'; }
      else                     { statusEl.textContent = 'Not set';      statusEl.className = 'rs-perm-status default'; }
    }

    if (reqRow) {
      reqRow.style.display = (p === 'granted') ? 'none' : '';
    }

    if (requestBtn) {
      if (p === 'denied') {
        requestBtn.textContent = 'How to unblock ↗';
      } else if (p === 'granted') {
        requestBtn.textContent = 'Granted ✓';
        requestBtn.disabled = true;
      } else {
        requestBtn.textContent = 'Request permission';
        requestBtn.disabled = false;
      }
    }

    /* Show test row only in dev mode and when permission is granted */
    const _isDev = ['localhost', '127.0.0.1'].includes(location.hostname) ||
                   location.port !== '' ||
                   location.protocol === 'file:';

    if (testRow) {
      testRow.style.display = (p === 'granted' && _isDev) ? '' : 'none';
    }

    if (countEl) {
      countEl.textContent = String(Object.keys(_loadReminders()).length);
    }
  }

  function _refreshAllSettingsUI() {
    _refreshSettingsPermStatus();
  }

  function _refreshAllBadges() {
    document.querySelectorAll('[data-id]').forEach(li => {
      const id = li.dataset.id;
      if (id) {
        const btn = li.querySelector('.reminder-btn');
        if (btn) _applyBellState(btn, id);
        _refreshTaskBadge(id, li);
      }
    });
  }

  /* Periodically refresh time labels */
  function _startLabelRefresh() {
    setInterval(() => {
      const data = _loadReminders();
      Object.keys(data).forEach(id => {
        const btn = document.querySelector(`.reminder-btn[data-task-id="${id}"]`);
        if (btn) _applyBellState(btn, id);
        _refreshTaskBadge(id);
      });
    }, 60000);
  }

  /* ═══════════════════════════════════════════════════
     SERVICE WORKER REGISTRATION + UPDATE HANDLING
  ═══════════════════════════════════════════════════ */
  function _initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    /* Register / update the SW.
       updateViaCache:'none' ensures Android Chrome always checks for a new version. */
    navigator.serviceWorker.register(SW_PATH, { scope: '/', updateViaCache: 'none' })
      .then(reg => {
        /* Force-check for SW update on every page load */
        reg.update().catch(() => {});
        console.info('[Reminders] SW registered, scope:', reg.scope);

        /* Check for a new SW version waiting to activate */
        if (reg.waiting) {
          _promptSwUpdate(reg.waiting);
        }
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              _promptSwUpdate(newWorker);
            }
          });
        });
      })
      .catch(err => console.warn('[Reminders] SW registration failed:', err));

    /* Listen for messages from SW */
    navigator.serviceWorker.addEventListener('message', event => {
      const { type, tag, taskId } = event.data || {};

      if (type === 'NEXA_REMINDER_FIRED' && tag) {
        const fired = _loadFired();
        fired.add(tag);
        _saveFired(fired);
      }

      if (type === 'NEXA_NOTIFICATION_CLICK' && taskId) {
        _focusTask(taskId);
      }

      if (type === 'NEXA_ACTION_COMPLETE' && taskId) {
        _handleRemoteComplete(taskId);
      }

      if (type === 'NEXA_ACTION_SNOOZED' && taskId) {
        const settings = _loadSettings();
        /* Re-schedule the notification for snoozeDuration minutes from now */
        const data = _loadReminders();
        const reminder = data[taskId];
        if (reminder) {
          /* Temporarily clear fired state for this task so it can re-fire */
          const fired = _loadFired();
          OFFSETS.forEach(o => fired.delete(`${taskId}:${o.key}`));
          _saveFired(fired);

          /* Compute new due time = now + snoozeDuration */
          const snoozeMs  = settings.snoozeDuration * 60000;
          const snoozeAt  = new Date(Date.now() + snoozeMs);
          const snoozeDate = snoozeAt.toISOString().slice(0, 10);
          const snoozeTime = snoozeAt.toTimeString().slice(0, 5);

          const snoozed = {
            ...reminder,
            dueDate:  snoozeDate,
            dueDate2: snoozeDate,
            dueTime:  snoozeTime,
            offsets:  ['at'],
            notified: false,
          };
          _saveReminder(taskId, snoozed);
          _scheduleTask(taskId, snoozed);
        }
        _showToast(`⏰ Reminder snoozed for ${settings.snoozeDuration} min`);
      }

      if (type === 'NEXA_NOTIFICATION_DISMISSED') {
        /* No action needed; dedup already prevents re-fires */
      }
    });
  }

  function _promptSwUpdate(worker) {
    /* Show a subtle update banner */
    const existing = document.getElementById('nexa-sw-update-banner');
    if (existing) return;

    const banner = document.createElement('div');
    banner.id = 'nexa-sw-update-banner';
    banner.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:9900;
      background:var(--glass,rgba(20,22,30,.9));
      backdrop-filter:blur(16px);
      border:1px solid var(--bd2,rgba(255,255,255,.1));
      border-radius:12px;padding:12px 16px;
      display:flex;align-items:center;gap:12px;
      font-size:.78rem;color:var(--tx,#fff);
      box-shadow:0 8px 32px rgba(0,0,0,.4);
      animation:slideInRight .3s cubic-bezier(.34,1.56,.64,1);
    `;
    banner.innerHTML = `
      <span>✨ NEXA updated!</span>
      <button style="background:var(--ac,#7c6ef7);border:none;border-radius:7px;
        color:#fff;padding:5px 12px;font-size:.72rem;font-weight:600;cursor:pointer;">
        Reload
      </button>`;
    document.body.appendChild(banner);

    banner.querySelector('button').addEventListener('click', () => {
      worker.postMessage({ type: 'NEXA_SKIP_WAITING' });
      window.location.reload();
    });

    setTimeout(() => banner.remove(), 12000);
  }

  /* ═══════════════════════════════════════════════════
     HANDLE REMOTE ACTIONS (from SW notification buttons)
  ═══════════════════════════════════════════════════ */
  function _handleRemoteComplete(taskId) {
    /* Mark the task done via the app's own mechanism if available */
    const task = (window.tasks || []).find(t => t.id === taskId);
    if (!task || task.done) return;

    task.done = true;
    task.completedAt = new Date().toISOString();

    /* Persist */
    if (typeof window.saveWithIndicator === 'function') {
      window.saveWithIndicator('tasks_v2', window.tasks);
    }
    if (window.FireSync?.updateTask) {
      window.FireSync.updateTask(taskId, {
        done: true,
        completedAt: task.completedAt,
      }).catch(() => {});
    }

    /* Re-render */
    if (typeof window._nexaRender === 'function') window._nexaRender();

    _focusTask(taskId);
    _showToast('✅ Task marked complete from notification!');
  }

  /* ═══════════════════════════════════════════════════
     ONLINE/OFFLINE SYNC
  ═══════════════════════════════════════════════════ */
  function _initConnectivityWatch() {
    window.addEventListener('online', () => {
      _flushOfflineQueue().catch(() => {});
    });
  }

  /* ═══════════════════════════════════════════════════
     SETTINGS TAB NAVIGATION HOOK
  ═══════════════════════════════════════════════════ */
  function _hookSettingsNav() {
    document.querySelectorAll('.nav-btn, .nav-item, [data-page], [data-nav], [data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pg = btn.dataset.page || btn.dataset.nav || btn.dataset.tab;
        if (pg === 'settings') {
          setTimeout(() => {
            _injectSettingsSection();
            _refreshAllSettingsUI();
          }, 120);
        }
      });
    });

    /* Also observe the settings tab becoming visible */
    const settingsTab = document.getElementById('tab-settings');
    if (settingsTab) {
      const observer = new MutationObserver(() => {
        if (settingsTab.classList.contains('active')) {
          _injectSettingsSection();
          _refreshAllSettingsUI();
        }
      });
      observer.observe(settingsTab, { attributes: true, attributeFilter: ['class'] });
    }
  }

  /* ═══════════════════════════════════════════════════
     UTILS
  ═══════════════════════════════════════════════════ */
  function _escH(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _showToast(msg, duration = 2800) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, 't-success', duration);
      return;
    }
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    container.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, duration);
  }

  /* ═══════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════ */
  window.NexaReminders = {
    openFor:           _openPopover,
    remove:            _removeReminder,
    requestPermission: () => _perm.request(),
    showPrePrompt:     _showPrePrompt,
    refresh:           _refreshAllBadges,
    focusTask:         _focusTask,
    get permissionStatus() { return _perm.status; },
    get settings()        { return _loadSettings(); },
    saveSettings:         _saveSettings,
  };

  /* ═══════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════ */
  function _init() {
    _rehydrateAll();
    _observeTaskList();
    _hookTaskMutations();
    _initServiceWorker();
    _initConnectivityWatch();
    _injectSettingsSection();
    _hookSettingsNav();
    _startLabelRefresh();

    /* Flush any offline-queued Firestore syncs */
    if (navigator.onLine) _flushOfflineQueue().catch(() => {});

    /* Show permission banner after 5s if there are due tasks and perm not asked */
    setTimeout(() => {
      const tasks = window.tasks || [];
      if (!_perm.alreadyAsked && tasks.some(t => t.due && !t.done)) {
        _showPermissionBanner();
      }
    }, 5000);

    console.info('[NexaReminders] v4.1 ready. Permission:', _perm.status);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_init, 80));
  } else {
    setTimeout(_init, 80);
  }

})();