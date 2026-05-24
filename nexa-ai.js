/**
 * NEXA — AI Assistant  |  nexa-ai.js  v3.0  (Fully Offline)
 * ─────────────────────────────────────────────────────────────
 * 100% local — zero API calls, zero keys, zero backend.
 * All intelligence runs in the browser against window.tasks.
 *
 * Capabilities:
 *   • Add / create tasks from natural language
 *   • Plan your day (priority-sorted schedule)
 *   • Focus recommendation (top task)
 *   • Daily summary & completion stats
 *   • Overdue task list
 *   • Streak & productivity tips
 *   • Greeting / casual chitchat
 *   • Graceful out-of-scope deflection
 *
 * Integrations kept:
 *   • window.tasks          — live task array
 *   • window._nexaRender    — re-render task list
 *   • window.FireSync       — Firestore sync
 *   • window.showToast      — app toast system
 *   • localStorage          — offline persistence
 *
 * Load AFTER all other scripts.
 * ─────────────────────────────────────────────────────────────
 */
'use strict';

(function () {

  /* ═══════════════════════════════════════════════════════════
     QUICK-REPLY CHIPS
  ═══════════════════════════════════════════════════════════ */
  const CHIPS = [
    { label: '📅 Plan my day',      msg: 'Plan my day' },
    { label: '➕ Add a task',        msg: 'Add task: ' },
    { label: '🎯 What to focus on',  msg: 'What should I focus on?' },
    { label: '📊 Daily summary',    msg: 'Give me a daily summary' },
  ];

  /* ═══════════════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════════════ */
  let _open    = false;
  let _history = [];   // { role: 'user'|'ai', text: string }

  /* ═══════════════════════════════════════════════════════════
     UI — BUILD
  ═══════════════════════════════════════════════════════════ */
  function _buildUI() {
    /* FAB button */
    const btn = document.createElement('button');
    btn.id = 'nexa-ai-btn';
    btn.title = 'Nexa AI Assistant';
    btn.setAttribute('aria-label', 'Open Nexa AI Assistant');
    btn.innerHTML = '✦<span class="ai-badge"></span>';
    document.body.appendChild(btn);

    /* Chat panel */
    const panel = document.createElement('div');
    panel.id = 'nexa-ai-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Nexa AI Assistant');
    panel.innerHTML = `
      <div class="ai-panel-header">
        <div class="ai-panel-avatar">✦</div>
        <div>
          <div class="ai-panel-name">Nexa AI</div>
          <div class="ai-panel-status">● Ready</div>
        </div>
        <button class="ai-panel-close" id="nexa-ai-close" aria-label="Close">✕</button>
      </div>
      <div class="ai-msgs" id="nexa-ai-msgs"></div>
      <div class="ai-chips" id="nexa-ai-chips"></div>
      <div class="ai-input-row">
        <input class="ai-input" id="nexa-ai-inp" type="text"
               placeholder="Ask me anything about your tasks…" autocomplete="off"/>
        <button class="ai-send-btn" id="nexa-ai-send" aria-label="Send">➤</button>
      </div>`;
    document.body.appendChild(panel);

    /* Chips */
    const chipsEl = document.getElementById('nexa-ai-chips');
    CHIPS.forEach(c => {
      const chip = document.createElement('button');
      chip.className = 'ai-chip';
      chip.textContent = c.label;
      chip.addEventListener('click', () => {
        const inp = document.getElementById('nexa-ai-inp');
        if (c.msg.endsWith(': ')) {
          inp.value = c.msg;
          inp.focus();
        } else {
          _send(c.msg);
        }
      });
      chipsEl.appendChild(chip);
    });

    /* Wire events */
    btn.addEventListener('click', _toggle);
    document.getElementById('nexa-ai-close').addEventListener('click', _close);
    document.getElementById('nexa-ai-send').addEventListener('click', () => {
      _send(document.getElementById('nexa-ai-inp').value);
    });
    document.getElementById('nexa-ai-inp').addEventListener('keydown', e => {
      if (e.key === 'Enter') _send(document.getElementById('nexa-ai-inp').value);
    });

    /* Welcome message */
    _addMsg('ai',
      'Hey! I\'m your Nexa AI assistant ✦<br>' +
      'I work entirely offline — no internet needed.<br><br>' +
      'I can <strong>add tasks</strong>, help you <strong>plan your day</strong>, ' +
      'find what to <strong>focus on</strong>, and give you a <strong>progress summary</strong>.<br><br>' +
      'What would you like to do?'
    );
  }

  /* ═══════════════════════════════════════════════════════════
     UI — TOGGLE / OPEN / CLOSE
  ═══════════════════════════════════════════════════════════ */
  function _toggle() { _open ? _close() : _openPanel(); }

  function _openPanel() {
    _open = true;
    document.getElementById('nexa-ai-panel').classList.add('open');
    setTimeout(() => document.getElementById('nexa-ai-inp').focus(), 300);
  }

  function _close() {
    _open = false;
    document.getElementById('nexa-ai-panel').classList.remove('open');
  }

  /* ═══════════════════════════════════════════════════════════
     UI — MESSAGES
  ═══════════════════════════════════════════════════════════ */
  function _now() {
    return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function _addMsg(role, html) {
    const msgs = document.getElementById('nexa-ai-msgs');
    const wrap = document.createElement('div');
    wrap.className = `ai-msg from-${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    bubble.innerHTML = html;
    const time = document.createElement('div');
    time.className = 'ai-msg-time';
    time.textContent = _now();
    wrap.appendChild(bubble);
    wrap.appendChild(time);
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
    return bubble;
  }

  function _showTyping() {
    const msgs = document.getElementById('nexa-ai-msgs');
    const t = document.createElement('div');
    t.className = 'ai-typing';
    t.id = 'nexa-ai-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(t);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function _hideTyping() {
    const t = document.getElementById('nexa-ai-typing');
    if (t) t.remove();
  }

  /* ═══════════════════════════════════════════════════════════
     UI — TEXT UTILITIES
  ═══════════════════════════════════════════════════════════ */
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** Convert lightweight markdown to HTML for chat bubbles */
  function _md(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  /* ═══════════════════════════════════════════════════════════
     SEND — main entry point (fully offline, ~80 ms simulated delay)
  ═══════════════════════════════════════════════════════════ */
  function _send(raw) {
    const msg = (raw || '').trim();
    if (!msg) return;

    const inp = document.getElementById('nexa-ai-inp');
    inp.value = '';

    _addMsg('user', _esc(msg));
    _history.push({ role: 'user', text: msg });

    _showTyping();

    /* Simulate a brief "thinking" pause so UX feels natural */
    const delay = 280 + Math.random() * 220;
    setTimeout(() => {
      _hideTyping();
      const result = _engine(msg);
      _history.push({ role: 'ai', text: result.reply });

      const bubble = _addMsg('ai', _md(result.reply));

      /* If the engine produced tasks to inject, show an inject button */
      if (result.tasks && result.tasks.length) {
        const btn = document.createElement('button');
        btn.className = 'ai-task-inject';
        btn.innerHTML = `➕ Add ${result.tasks.length} task${result.tasks.length > 1 ? 's' : ''} to NEXA`;
        btn.addEventListener('click', () => {
          _injectTasks(result.tasks);
          btn.textContent = '✓ Added!';
          btn.style.pointerEvents = 'none';
          btn.style.opacity = '0.6';
        });
        /* Insert right after the bubble's time-stamp sibling */
        const timeEl = bubble.nextSibling;
        bubble.parentElement.insertBefore(btn, timeEl ? timeEl.nextSibling : null);
      }
    }, delay);
  }

  /* ═══════════════════════════════════════════════════════════
     ENGINE — local intent detection + response generation
     Returns { reply: string, tasks?: Array }
  ═══════════════════════════════════════════════════════════ */
  function _engine(msg) {
    const lower = msg.toLowerCase();

    /* ── helper snapshots ── */
    const allTasks   = window.tasks || [];
    const active     = allTasks.filter(t => !t.done);
    const done       = allTasks.filter(t =>  t.done);
    const todayISO   = _todayISO();
    const todayTasks = active.filter(t => t.due === todayISO);
    const overdue    = active.filter(t => t.due && t.due < todayISO);

    /* ── 1. GREETINGS ── */
    if (/^(hi|hello|hey|howdy|good\s*(morning|afternoon|evening)|what'?s up|sup)\b/i.test(lower)) {
      const hr = new Date().getHours();
      const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
      const lines = [
        `${greet}! 👋 I'm Nexa AI, your built-in productivity assistant.`,
        active.length
          ? `You have **${active.length}** active task${active.length > 1 ? 's' : ''} right now.`
          : `Your task list is clear — a great time to plan ahead!`,
        `\nHow can I help you today?`,
      ];
      return { reply: lines.join('\n') };
    }

    /* ── 2. ADD / CREATE TASK ── */
    const addRe = /\b(add|create|new|make|set|remind me (to|about)?)\b/i;
    const taskIndicator = /\btask\b|\btodo\b|\bremind\b/i;
    if (addRe.test(lower) || taskIndicator.test(lower)) {
      return _handleAddTask(msg, lower, todayISO);
    }

    /* ── 3. PLAN MY DAY ── */
    if (/\bplan\b.*\b(day|today|morning|schedule)\b|\bschedule\b.*\bday\b|\bwhat('?s| is) on my/i.test(lower)) {
      return _handlePlanDay(active, todayTasks, overdue);
    }

    /* ── 4. FOCUS / PRIORITY ── */
    if (/\b(focus|priorit|most important|what should i|what to do|start with|work on (first|next))\b/i.test(lower)) {
      return _handleFocus(active);
    }

    /* ── 5. DAILY SUMMARY / PROGRESS / STATS ── */
    if (/\b(summary|progress|stats|how am i doing|productivity|report|overview)\b/i.test(lower)) {
      return _handleSummary(allTasks, active, done, todayTasks, overdue);
    }

    /* ── 6. OVERDUE ── */
    if (/\boverdue\b|\blate\b|\bmissed\b|\bpast due\b/i.test(lower)) {
      return _handleOverdue(overdue);
    }

    /* ── 7. COMPLETED / DONE TASKS ── */
    if (/\b(completed|finished|done|accomplished)\b/i.test(lower)) {
      if (!done.length) return { reply: "You haven't completed any tasks yet — but you've got this! 💪" };
      const recent = done.slice(0, 5);
      const list = recent.map((t, i) => `${i + 1}. ${t.text}`).join('\n');
      return { reply: `✅ **${done.length} task${done.length > 1 ? 's' : ''} completed** so far:\n\n${list}${done.length > 5 ? `\n…and ${done.length - 5} more.` : ''}\n\nGreat work! 🎉` };
    }

    /* ── 8. STREAK ── */
    if (/\bstreak\b/i.test(lower)) {
      const streak = _getStreak();
      if (!streak) return { reply: "Complete at least one task today to start your streak! 🔥" };
      return { reply: `🔥 Your current streak is **${streak} day${streak > 1 ? 's' : ''}**!\n\nKeep completing tasks daily to grow it.` };
    }

    /* ── 9. TIPS / HELP ── */
    if (/\b(tip|advice|help|how to|how do i|what can you|feature|capability)\b/i.test(lower)) {
      return {
        reply:
          'Here\'s what I can do for you:\n\n' +
          '➕ **Add tasks** — "Add task: finish report by Friday"\n' +
          '📅 **Plan my day** — get a priority-sorted schedule\n' +
          '🎯 **Focus** — find your single most important task\n' +
          '📊 **Summary** — see completion rate and stats\n' +
          '⚠️ **Overdue** — list tasks past their due date\n' +
          '✅ **Completed** — review what you\'ve done\n\n' +
          'Just type naturally — I\'ll figure out what you need!',
      };
    }

    /* ── 10. MOTIVATION / HOW ARE YOU ── */
    if (/\bhow are you\b|\byou ok\b|\bfeeling\b/i.test(lower)) {
      return { reply: "I'm running perfectly offline — no server needed! 😄\n\nFocused and ready to help you crush your tasks. What are we working on?" };
    }

    /* ── 11. THANK YOU ── */
    if (/\b(thanks|thank you|thx|ty|great|awesome|nice|cool|perfect)\b/i.test(lower)) {
      const picks = [
        "You're welcome! Anything else I can help with? 🙌",
        "Happy to help! Keep that productivity going 🚀",
        "Anytime! Let me know if you need anything else ✦",
      ];
      return { reply: picks[Math.floor(Math.random() * picks.length)] };
    }

    /* ── 12. CLEAR / DELETE / REMOVE ── */
    if (/\b(clear|delete|remove|trash|wipe)\b.*\btask\b/i.test(lower)) {
      return { reply: "To delete tasks, tap the **✕ button** on any task card, or use **Select** mode (⊡) to bulk-delete multiple tasks at once." };
    }

    /* ── 13. REMINDER / NOTIFICATION ── */
    if (/\b(remind|reminder|notification|alert|bell)\b/i.test(lower)) {
      return { reply: "To set a reminder, tap the **🔔 bell icon** on any task that has a due date. You can choose to be notified at the due time or minutes/hours before." };
    }

    /* ── 14. PRODUCTIVITY QUESTION ── */
    if (/\b(productive|efficiency|workflow|time management|pomodoro|focus mode)\b/i.test(lower)) {
      return {
        reply:
          '**Quick productivity tips:**\n\n' +
          '⏱ Use the **Focus tab** for Pomodoro sessions\n' +
          '🔥 Tackle **urgent/high** priority tasks first each morning\n' +
          '📅 Add **due dates** so NEXA can surface overdue items\n' +
          '✅ Completing tasks daily builds your **streak** 🔥\n' +
          '📊 Check **Analytics** to spot your most productive days',
      };
    }

    /* ── 15. OUT-OF-SCOPE fallback ── */
    const hasTaskData = active.length > 0;
    if (hasTaskData) {
      return {
        reply:
          "I\'m designed to help with tasks and productivity inside NEXA. " +
          `I can see you have **${active.length} active task${active.length > 1 ? 's' : ''}** — ` +
          'want me to help you plan your day or find what to focus on?',
      };
    }
    return {
      reply:
        "I\'m designed to help with tasks and productivity inside NEXA.\n\n" +
        'Try: **"Add task: [description]"** or **"Plan my day"** to get started!',
    };
  }

  /* ═══════════════════════════════════════════════════════════
     INTENT HANDLERS
  ═══════════════════════════════════════════════════════════ */

  /** Parse natural language and build a task object */
  function _handleAddTask(msg, lower, todayISO) {
    /* Strip intent words to isolate the task description */
    let text = msg
      .replace(/^(add|create|new|make|set|remind me (to|about)?)\s*/i, '')
      .replace(/\btask[:\s]*/i, '')
      .replace(/\bremind\b/i, '')
      .trim();

    /* Extract time words and clean them from the text */
    let due = null;
    if (/\btomorrow\b/i.test(lower)) {
      due = _offsetISO(1);
      text = text.replace(/\btomorrow\b/gi, '').trim();
    } else if (/\btoday\b/i.test(lower)) {
      due = todayISO;
      text = text.replace(/\btoday\b/gi, '').trim();
    } else if (/\bnext week\b/i.test(lower)) {
      due = _offsetISO(7);
      text = text.replace(/\bnext week\b/gi, '').trim();
    } else {
      /* "on Monday", "by Friday", etc. */
      const dayMatch = lower.match(/\b(on|by|this|next)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
      if (dayMatch) {
        const dayMap = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
        due = _nextWeekday(dayMap[dayMatch[2].toLowerCase()]);
        text = text.replace(dayMatch[0], '').trim();
      }
    }

    /* Due time */
    let dueTime = null;
    const timeMatch = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1]);
      const m = parseInt(timeMatch[2] || '0');
      const ampm = (timeMatch[3] || '').toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      dueTime = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      text = text.replace(timeMatch[0], '').trim();
    }
    /* Time-of-day words */
    if (!dueTime) {
      if (/\bmorning\b/i.test(text))   { dueTime = '09:00'; text = text.replace(/\bmorning\b/gi,'').trim(); }
      else if (/\bnoon\b/i.test(text)) { dueTime = '12:00'; text = text.replace(/\bnoon\b/gi,'').trim(); }
      else if (/\b(afternoon|lunch)\b/i.test(text)) { dueTime = '13:00'; text = text.replace(/\b(afternoon|lunch)\b/gi,'').trim(); }
      else if (/\bevening\b/i.test(text)) { dueTime = '18:00'; text = text.replace(/\bevening\b/gi,'').trim(); }
      else if (/\bnight\b/i.test(text))  { dueTime = '21:00'; text = text.replace(/\bnight\b/gi,'').trim(); }
    }

    /* Priority */
    let pri = 'low';
    if (/\b(urgent|asap|critical|emergency|immediately)\b/i.test(lower)) pri = 'urgent';
    else if (/\b(important|high|must|need to|have to|crucial|vital)\b/i.test(lower)) pri = 'high';
    else if (/\b(medium|moderate|should|normal)\b/i.test(lower)) pri = 'medium';

    /* Clean trailing punctuation and filler */
    text = text
      .replace(/\s+(by|on|at|for|the|a|an)\s*$/i, '')
      .replace(/[,;:]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text || text.length < 2) {
      return { reply: "What's the task? Try: **\"Add task: finish the report by Friday\"**" };
    }

    /* Capitalise first letter */
    text = text.charAt(0).toUpperCase() + text.slice(1);

    const task = {
      id:      _uid(),
      text,
      done:    false,
      pri,
      due:     due || null,
      dueTime: dueTime || null,
      notes:   '',
      recur:   null,
      at:      Date.now(),
    };

    const priLabels = { urgent: '⚡ Urgent', high: '🔥 High', medium: '● Medium', low: '● Low' };
    const dueLabel  = due
      ? (due === todayISO ? ' · due **today**' : due === _offsetISO(1) ? ' · due **tomorrow**' : ` · due **${due}**`)
      : '';
    const timeLabel = dueTime ? ` at **${_fmt12(dueTime)}**` : '';

    return {
      reply: `✅ Task added!\n\n**${_esc(text)}**\nPriority: ${priLabels[pri]}${dueLabel}${timeLabel}`,
      tasks: [task],
    };
  }

  function _handlePlanDay(active, todayTasks, overdue) {
    if (!active.length) {
      return { reply: "🎉 No active tasks — you're all caught up!\n\nWant me to help you add some tasks?" };
    }

    const sorted = [...active].sort((a, b) => {
      const p = { urgent:0, high:1, medium:2, low:3 };
      if (a.due && !b.due) return -1;
      if (!a.due && b.due) return 1;
      const dueDiff = (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0;
      if (dueDiff) return dueDiff;
      return (p[a.pri] || 3) - (p[b.pri] || 3);
    });

    let reply = '📅 **Your plan for today:**\n\n';

    if (overdue.length) reply += `⚠️ **${overdue.length} overdue** — tackle these first!\n`;
    if (todayTasks.length) reply += `📌 **${todayTasks.length} due today**\n`;
    reply += '\n**Suggested order:**\n';

    sorted.slice(0, 6).forEach((t, i) => {
      const badge = t.pri === 'urgent' ? '⚡' : t.pri === 'high' ? '🔥' : t.pri === 'medium' ? '●' : '○';
      const due   = t.due === _todayISO() ? ' _(today)_' : t.due === _offsetISO(1) ? ' _(tomorrow)_' : t.due ? ` _(${t.due})_` : '';
      reply += `${i + 1}. ${badge} ${t.text}${due}\n`;
    });

    if (active.length > 6) reply += `\n…and ${active.length - 6} more tasks.`;

    return { reply };
  }

  function _handleFocus(active) {
    if (!active.length) {
      return { reply: "No active tasks right now — you're free! 🎉\n\nWant to plan something for later?" };
    }

    const today = _todayISO();
    const sorted = [...active].sort((a, b) => {
      const p = { urgent:0, high:1, medium:2, low:3 };
      /* Overdue first */
      const aOver = a.due && a.due < today;
      const bOver = b.due && b.due < today;
      if (aOver && !bOver) return -1;
      if (!aOver && bOver) return 1;
      /* Then by priority */
      const pDiff = (p[a.pri] || 3) - (p[b.pri] || 3);
      if (pDiff) return pDiff;
      /* Then by due date */
      if (a.due && !b.due) return -1;
      if (!a.due && b.due) return 1;
      return (a.due || '') < (b.due || '') ? -1 : 1;
    });

    const top  = sorted[0];
    const next = sorted.slice(1, 4);
    const badge = top.pri === 'urgent' ? '⚡' : top.pri === 'high' ? '🔥' : '🎯';
    const dueLabel = top.due
      ? (top.due < today ? ' _(overdue!)_' : top.due === today ? ' _(due today)_' : ` _(due ${top.due})_`)
      : '';

    let reply = `${badge} **Focus on this first:**\n\n"${top.text}"${dueLabel}\nPriority: **${top.pri.toUpperCase()}**`;

    if (next.length) {
      reply += '\n\n**Up next:**\n' + next.map((t, i) =>
        `${i + 2}. ${t.text}${t.due ? ` _(${t.due})_` : ''}`
      ).join('\n');
    }

    return { reply };
  }

  function _handleSummary(all, active, done, todayTasks, overdue) {
    const total = all.length;
    const rate  = total ? Math.round((done.length / total) * 100) : 0;
    const streak = _getStreak();

    const mood =
      rate >= 80 ? "You're absolutely crushing it today! 🚀" :
      rate >= 60 ? "Great progress — keep the momentum! 💪" :
      rate >= 40 ? "Solid start — there's more to get through! 🎯" :
      rate >= 20 ? "Let's pick up the pace — you've got this! ⚡" :
                   "Time to get started — I believe in you! 🌟";

    return {
      reply:
        '📊 **Daily Summary**\n\n' +
        `✅ Completed:   **${done.length}** tasks\n` +
        `⏳ Active:       **${active.length}** tasks\n` +
        `⚠️ Overdue:     **${overdue.length}** tasks\n` +
        `📅 Due today:   **${todayTasks.length}** tasks\n` +
        `📈 Completion:  **${rate}%**\n` +
        (streak ? `🔥 Streak:       **${streak} day${streak > 1 ? 's' : ''}**\n` : '') +
        `\n${mood}`,
    };
  }

  function _handleOverdue(overdue) {
    if (!overdue.length) {
      return { reply: "✅ No overdue tasks — you're on top of everything! 🎉" };
    }

    const list = overdue.slice(0, 6).map((t, i) =>
      `${i + 1}. ${t.text} _(was due ${t.due})_`
    ).join('\n');

    return {
      reply:
        `⚠️ **${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}:**\n\n${list}` +
        (overdue.length > 6 ? `\n…and ${overdue.length - 6} more.` : '') +
        '\n\nTap the **✎ edit** button on any task to reschedule it.',
    };
  }

  /* ═══════════════════════════════════════════════════════════
     INJECT TASKS INTO APP
  ═══════════════════════════════════════════════════════════ */
  function _injectTasks(taskList) {
    const tasks = window.tasks;
    if (!Array.isArray(tasks)) return;

    /* Insert new tasks at top of array (unshift) */
    const toAdd = [...taskList].reverse();
    toAdd.forEach(t => tasks.unshift(t));

    /* Persist to localStorage */
    try {
      const user   = typeof firebase !== 'undefined' && firebase.auth().currentUser;
      const lsKey  = user ? `taskr_${user.uid}_tasks` : 'taskr_guest_tasks';
      localStorage.setItem(lsKey, JSON.stringify(tasks));
    } catch (_) { /* ignore — offline storage optional */ }

    /* Push to Firestore if available */
    if (window.FireSync && typeof window.FireSync.addTask === 'function') {
      taskList.forEach(t => window.FireSync.addTask(t).catch(() => {}));
    }

    /* Re-render task list */
    if (typeof window._nexaRender === 'function') window._nexaRender();

    /* Toast notification */
    if (typeof window.showToast === 'function') {
      window.showToast(
        `✦ ${taskList.length} task${taskList.length > 1 ? 's' : ''} added by Nexa AI`,
        't-success',
        3000
      );
    }
  }

  /* ═══════════════════════════════════════════════════════════
     TAB VISIBILITY — show FAB only on Tasks tab
  ═══════════════════════════════════════════════════════════ */
  function _syncVisibility() {
    const fab = document.getElementById('nexa-ai-btn');
    if (!fab) return;
    const tasksPanel  = document.getElementById('tab-tasks');
    const onTasksTab  = tasksPanel && tasksPanel.classList.contains('active');
    fab.style.display = onTasksTab ? '' : 'none';
    if (!onTasksTab && _open) _close();
  }

  function _watchTabs() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click',    () => setTimeout(_syncVisibility, 50));
      btn.addEventListener('touchend', () => setTimeout(_syncVisibility, 50));
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
      new MutationObserver(_syncVisibility).observe(panel, {
        attributes: true,
        attributeFilter: ['class'],
      });
    });
    _syncVisibility();
  }

  /* ═══════════════════════════════════════════════════════════
     DATE / TIME UTILITIES
  ═══════════════════════════════════════════════════════════ */
  function _todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${_p2(d.getMonth()+1)}-${_p2(d.getDate())}`;
  }

  function _offsetISO(days) {
    const d = new Date(Date.now() + days * 86400000);
    return `${d.getFullYear()}-${_p2(d.getMonth()+1)}-${_p2(d.getDate())}`;
  }

  function _nextWeekday(target) {
    const d   = new Date();
    const cur = d.getDay();
    let diff  = target - cur;
    if (diff <= 0) diff += 7;
    return _offsetISO(diff);
  }

  function _fmt12(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${_p2(m)} ${ap}`;
  }

  function _p2(n) { return String(n).padStart(2, '0'); }

  function _uid() { return Math.random().toString(36).slice(2, 9); }

  /* Read current streak from localStorage */
  function _getStreak() {
    try {
      const raw = localStorage.getItem('taskr_streak') ||
        (() => {
          /* Try UID-scoped key */
          const user = typeof firebase !== 'undefined' && firebase.auth().currentUser;
          return user ? localStorage.getItem(`taskr_${user.uid}_streak`) : null;
        })();
      if (!raw) return 0;
      const s = JSON.parse(raw);
      return (typeof s.count === 'number') ? s.count : 0;
    } catch (_) { return 0; }
  }

  /* ═══════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════ */
  function _init() {
    _buildUI();
    _watchTabs();
    console.info('[NexaAI] v3.0 ready — fully offline, zero API calls.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_init, 200));
  } else {
    setTimeout(_init, 200);
  }

})();