/**
 * NEXA — AI Assistant  |  nexa-ai.js  v2.0 (Patched)
 * Uses the Anthropic API via the artifact proxy (no CORS issues).
 * Integrates with window.tasks, window._nexaRender, window.FireSync.
 * Load AFTER all other scripts.
 */
'use strict';

(function () {

  const SYSTEM_PROMPT = `You are Nexa AI, an intelligent productivity partner inside the NEXA task management application.
Your core goal is to help users plan, organize, and execute their schedules dynamically.

CRITICAL ENGAGEMENT RULE:
- While your interface emphasizes productivity, you are a companion, not a rigid menu.
- If the user greets you, engages in casual chitchat, or requests to be your friend, step out of restrictive 'task-only' parameters. Respond to them conversationally with warmth, empathy, and genuine interest.
- Keep responses concise, direct, and dashboard-friendly (3-6 lines max unless specifically prompted for extensive output).

RULES FOR TASK OUTPUTS:
- When creating/updating tasks return ONLY a JSON block like:
  \`\`\`json{"tasks":[{"text":"...","priority":"urgent|high|medium|low (REQUIRED - infer from context, default low)","due":"YYYY-MM-DD or null","dueTime":"HH:MM or null","notes":"optional"}]}
- NEVER default priority to medium — use low unless the user's words imply urgency
- urgent = "asap/urgent/critical/emergency", high = "important/must/need", medium = "should", low = everything else`;

  const CHIPS = [
    { label: '📅 Plan my day',     msg: 'Help me plan my day with my current tasks' },
    { label: '➕ Add a task',       msg: 'Add task: ' },
    { label: '🎯 What to focus on', msg: 'What should I focus on first right now?' },
    { label: '📊 Daily summary',   msg: 'Give me a quick productivity summary for today' },
  ];

  let _history = [];
  let _open = false;

  // ── BUILD UI ──────────────────────────────────────────────
  function _buildUI() {
    // FAB button
    const btn = document.createElement('button');
    btn.id = 'nexa-ai-btn';
    btn.title = 'Nexa AI Assistant';
    btn.setAttribute('aria-label', 'Open Nexa AI Assistant');
    btn.innerHTML = '✦<span class="ai-badge"></span>';
    document.body.appendChild(btn);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'nexa-ai-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Nexa AI Assistant');
    panel.innerHTML = `
      <div class="ai-panel-header">
        <div class="ai-panel-avatar">✦</div>
        <div>
          <div class="ai-panel-name">Nexa AI</div>
          <div class="ai-panel-status">● Online</div>
        </div>
        <button class="ai-panel-close" id="nexa-ai-close" aria-label="Close">✕</button>
      </div>
      <div class="ai-msgs" id="nexa-ai-msgs"></div>
      <div class="ai-chips" id="nexa-ai-chips"></div>
      <div class="ai-input-row">
        <input class="ai-input" id="nexa-ai-inp" type="text"
               placeholder="Ask anything about your tasks…" autocomplete="off"/>
        <button class="ai-send-btn" id="nexa-ai-send" aria-label="Send">➤</button>
      </div>`;
    document.body.appendChild(panel);

    // Chips
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

    // Events
    btn.addEventListener('click', _toggle);
    document.getElementById('nexa-ai-close').addEventListener('click', _close);
    document.getElementById('nexa-ai-send').addEventListener('click', () => {
      _send(document.getElementById('nexa-ai-inp').value);
    });
    document.getElementById('nexa-ai-inp').addEventListener('keydown', e => {
      if (e.key === 'Enter') _send(document.getElementById('nexa-ai-inp').value);
    });

    // Welcome message
    _addMsg('ai', 'Hey! I\'m your Nexa AI assistant 👋<br>I can help you create tasks, plan your day, optimize priorities, and more.<br><br>What would you like to do?');
  }

  // ── TOGGLE / CLOSE ────────────────────────────────────────
  function _toggle() {
    _open ? _close() : _openPanel();
  }
  function _openPanel() {
    _open = true;
    document.getElementById('nexa-ai-panel').classList.add('open');
    setTimeout(() => document.getElementById('nexa-ai-inp').focus(), 300);
  }
  function _close() {
    _open = false;
    document.getElementById('nexa-ai-panel').classList.remove('open');
  }

  // ── MESSAGES ──────────────────────────────────────────────
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
    t.className = 'ai-typing'; t.id = 'nexa-ai-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(t);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function _hideTyping() {
    const t = document.getElementById('nexa-ai-typing');
    if (t) t.remove();
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _formatReply(text) {
    // Code blocks
    text = text.replace(/```json\n?([\s\S]*?)```/g, (_, c) =>
      `<pre>${_esc(c.trim())}</pre>`);
    text = text.replace(/```\n?([\s\S]*?)```/g, (_, c) =>
      `<pre>${_esc(c.trim())}</pre>`);
    // Bold
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Newlines
    text = text.replace(/\n/g, '<br>');
    return text;
  }

  // ── SEND (Patched to communicate through your server.mjs) ──
  async function _send(msg) {
    msg = (msg || '').trim();
    if (!msg) return;
    const inp = document.getElementById('nexa-ai-inp');
    inp.value = '';

    // Inject task context
    const taskCtx = _buildTaskContext();
    const userContent = taskCtx ? `[Current tasks context: ${taskCtx}]\n\n${msg}` : msg;

    _addMsg('user', _esc(msg));
    _showTyping();

    _history.push({ role: 'user', content: userContent });

    try {
      // 🔗 CHANGED: Pointing to your live Render proxy backend web service instead of Anthropic directly
      const res = await fetch('https://your-render-app-name.onrender.com/api/chat', { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: _history
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error.message || 'API error');
      }

      const reply = data.content?.map(b => b.type === 'text' ? b.text : '').join('') || '';

      if (!reply) throw new Error('Empty response');

      _history.push({ role: 'assistant', content: reply });
      _hideTyping();

      const bubble = _addMsg('ai', _formatReply(reply));

      // Auto-inject tasks if JSON detected
      const jsonMatch = reply.match(/```json\n?([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1].trim());
          if (parsed.tasks && Array.isArray(parsed.tasks) && parsed.tasks.length) {
            const injectBtn = document.createElement('button');
            injectBtn.className = 'ai-task-inject';
            injectBtn.innerHTML = `➕ Add ${parsed.tasks.length} task${parsed.tasks.length > 1 ? 's' : ''} to NEXA`;
            injectBtn.addEventListener('click', () => {
              _injectTasks(parsed.tasks);
              injectBtn.textContent = '✓ Added!';
              injectBtn.style.pointerEvents = 'none';
              injectBtn.style.opacity = '.6';
            });
            bubble.parentElement.insertBefore(injectBtn, bubble.nextSibling.nextSibling);
          }
        } catch (_) {}
      }

    } catch (e) {
      console.error("[Nexa Proxy Connection Failed]", e);
      _hideTyping();
      _history.pop();
      
      // ── Smart local fallback ──
      const fallback = _localFallback(msg);
      _history.push({ role: 'assistant', content: fallback });
      const bubble = _addMsg('ai', _formatReply(fallback));

      // Handle local task creation
      const jsonMatch = fallback.match(/```json\n?([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1].trim());
          if (parsed.tasks && Array.isArray(parsed.tasks) && parsed.tasks.length) {
            const injectBtn = document.createElement('button');
            injectBtn.className = 'ai-task-inject';
            injectBtn.innerHTML = `➕ Add ${parsed.tasks.length} task${parsed.tasks.length > 1 ? 's' : ''} to NEXA`;
            injectBtn.addEventListener('click', () => {
              _injectTasks(parsed.tasks);
              injectBtn.textContent = '✓ Added!';
              injectBtn.style.pointerEvents = 'none';
              injectBtn.style.opacity = '.6';
            });
            bubble.parentElement.insertBefore(injectBtn, bubble.nextSibling.nextSibling);
          }
        } catch (_) {}
      }
    }
  }
  // ── SMART LOCAL FALLBACK ──────────────────────────────────
  function _localFallback(msg) {
    const lower = msg.toLowerCase();
    const tasks = window.tasks || [];
    const active = tasks.filter(t => !t.done);
    const done = tasks.filter(t => t.done);
    const overdue = active.filter(t => t.due && new Date(t.due + 'T00:00:00') < new Date());
    const today = new Date().toISOString().slice(0, 10);
    const todayTasks = active.filter(t => t.due === today);

    // ── ADD TASK ──
    const addMatch = msg.match(/add\s+(?:task[:\s]+)?(.+)/i);
    if (addMatch || lower.includes('create task') || lower.includes('new task')) {
      const taskText = addMatch ? addMatch[1].trim() : msg.replace(/create|new|add|task/gi, '').trim();
      if (taskText.length > 2) {
        const dueGuess = lower.includes('tomorrow')
          ? (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0,10); })()
          : lower.includes('today') ? today : null;
        const priGuess = lower.includes('urgent') ? 'urgent'
          : lower.includes('high') || lower.includes('important') ? 'high'
          : lower.includes('medium') || lower.includes('med') ? 'medium' : 'low';
        return `Got it! I'll add that task for you.\n\`\`\`json\n{"tasks":[{"text":"${taskText.replace(/"/g,"'")}","priority":"${priGuess}","due":${dueGuess ? `"${dueGuess}"` : 'null'},"dueTime":null}]}\n\`\`\``;
      }
    }

    // ── PLAN MY DAY ──
    if (lower.includes('plan') && (lower.includes('day') || lower.includes('today'))) {
      if (!active.length) return "You have no active tasks! It looks like you're all caught up. Want me to help you add some tasks for today? 🎉";
      const urgent = active.filter(t => t.pri === 'urgent' || t.pri === 'high');
      let reply = `Here's your plan for today:\n\n`;
      if (overdue.length) reply += `⚠️ **${overdue.length} overdue** — handle these first!\n`;
      if (todayTasks.length) reply += `📅 **${todayTasks.length} due today** — prioritize these\n`;
      if (urgent.length) reply += `🔥 **${urgent.length} high priority** tasks need attention\n`;
      reply += `\n**Focus order:**\n`;
      const sorted = [...active].sort((a, b) => {
        const p = { urgent: 0, high: 1, medium: 2, low: 3 };
        return (p[a.pri] || 3) - (p[b.pri] || 3);
      }).slice(0, 5);
      sorted.forEach((t, i) => { reply += `${i+1}. ${t.text}\n`; });
      return reply;
    }

    // ── WHAT TO FOCUS ON ──
    if (lower.includes('focus') || lower.includes('what should') || lower.includes('priority')) {
      if (!active.length) return "No active tasks right now — you're free! 🎉 Want to plan something for tomorrow?";
      const top = [...active].sort((a, b) => {
        const p = { urgent: 0, high: 1, medium: 2, low: 3 };
        if (a.due && !b.due) return -1;
        if (!a.due && b.due) return 1;
        return (p[a.pri] || 3) - (p[b.pri] || 3);
      })[0];
      return `🎯 **Focus on this first:**\n\n"${top.text}"\n\nPriority: ${top.pri.toUpperCase()}${top.due ? ` · Due: ${top.due}` : ''}\n\nWant me to set a reminder or break it into smaller steps?`;
    }

    // ── DAILY SUMMARY ──
    if (lower.includes('summary') || lower.includes('progress') || lower.includes('stats')) {
      const rate = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0;
      return `📊 **Your Daily Summary:**\n\n✅ Completed: **${done.length}** tasks\n⏳ Active: **${active.length}** tasks\n⚠️ Overdue: **${overdue.length}** tasks\n📅 Due today: **${todayTasks.length}** tasks\n\n📈 Completion rate: **${rate}%**\n\n${rate >= 70 ? "You're crushing it today! 🚀" : rate >= 40 ? "Good progress — keep going! 💪" : "Let's get some tasks done! You've got this 🎯"}`;
    }

    // ── OVERDUE ──
    if (lower.includes('overdue')) {
      if (!overdue.length) return "No overdue tasks! You're on top of everything. 🎉";
      return `⚠️ You have **${overdue.length} overdue** task${overdue.length > 1 ? 's' : ''}:\n\n${overdue.slice(0, 5).map((t, i) => `${i+1}. ${t.text} (${t.due})`).join('\n')}\n\nWant me to reschedule these to today?`;
    }

    // ── REMINDER / SCHEDULE ──
    if (lower.includes('remind') || lower.includes('schedule') || lower.includes('when')) {
      return `I can help you set reminders! Click the 🔔 bell icon on any task to set a reminder time. You can also add due dates using the Due field when creating tasks.\n\nWant me to create a task with a specific time?`;
    }

    // ── GREETINGS & CASUAL INTERACTION ──
    if (lower.match(/^(hi|hello|hey|good morning|good afternoon|good evening|what's up)/)) {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      return `${greeting}! 👋 I'm Nexa AI, your workspace companion. I'm here to catch up, answer questions, or help structure your task lists. What's on your mind?`;
    }

    if (lower.includes('friend')) {
      return "I would love to be your friend! ✦ Whether you need help organizing engineering metrics or just want to clear some mental space, I am right here on your workspace layout. Let's make today awesome!";
    }

    // ── HELP ──
    if (lower.includes('help') || lower.includes('what can you')) {
      return `Here's what I can do for you:\n\n📅 **Plan my day** — organize your tasks by priority\n🎯 **What to focus on** — find your most important task\n📊 **Daily summary** — see your progress stats\n➕ **Add tasks** — just say "Add task: [description]"\n⚠️ **Overdue tasks** — see what needs attention\n\nJust type naturally and I'll help!`;
    }

    // ── DEFAULT FALLBACK (Conversational-friendly alternative) ──
    return `I'm tuned in! If you are asking for database analytics or a remote request, my live link encountered a temporary network delay, but I can still read your workspace state. Try asking me to "Plan my day" or tell me what you'd like to work on!`;
  }

  // ── TASK CONTEXT ──────────────────────────────────────────
  function _buildTaskContext() {
    const tasks = window.tasks;
    if (!Array.isArray(tasks) || !tasks.length) return null;
    const active = tasks.filter(t => !t.done).slice(0, 12);
    if (!active.length) return 'No active tasks.';
    return active.map(t =>
      `"${t.text}" [${t.pri}${t.due ? ', due ' + t.due : ''}${t.dueTime ? ' ' + t.dueTime : ''}]`
    ).join('; ');
  }

  // ── INJECT TASKS ──────────────────────────────────────────
  function _injectTasks(taskList) {
    const tasks = window.tasks;
    if (!Array.isArray(tasks)) return;

    const uid = () => Math.random().toString(36).slice(2, 9);
    const newTasks = taskList.map(t => ({
      id: uid(),
      text: t.text || 'Untitled task',
      done: false,
      pri: (() => {
      const p = (t.priority || t.pri || 'low').toLowerCase();
      return ['urgent','high','medium','low'].includes(p) ? p : 'low';
      })(),
      due: t.due || null,
      dueTime: t.dueTime || null,
      notes: t.notes || '',
      recur: null,
      at: Date.now()
    }));

    newTasks.reverse().forEach(t => tasks.unshift(t));

    try {
      const user = firebase.auth().currentUser;
      const lsKey = user ? `taskr_${user.uid}_tasks` : 'taskr_guest_tasks';
      localStorage.setItem(lsKey, JSON.stringify(tasks));
    } catch (_) {}

    if (window.FireSync?.addTask) {
      newTasks.forEach(t => window.FireSync.addTask(t).catch(() => {}));
    }

    if (typeof window._nexaRender === 'function') window._nexaRender();

    if (typeof window.showToast === 'function') {
      window.showToast(`✦ ${newTasks.length} task${newTasks.length > 1 ? 's' : ''} added by Nexa AI`, 't-success', 3000);
    }
  }

  // ── TAB VISIBILITY ────────────────────────────────────────
  function _syncVisibility() {
    const btn   = document.getElementById('nexa-ai-btn');
    const panel = document.getElementById('nexa-ai-panel');
    if (!btn) return;
    const tasksPanel = document.getElementById('tab-tasks');
    const onTasksTab = tasksPanel && tasksPanel.classList.contains('active');
    btn.style.display = onTasksTab ? '' : 'none';
    if (!onTasksTab && _open) _close();
  }

  function _watchTabs() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => setTimeout(_syncVisibility, 50));
      btn.addEventListener('touchend', () => setTimeout(_syncVisibility, 50));
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
      new MutationObserver(_syncVisibility).observe(panel, {
        attributes: true, attributeFilter: ['class']
      });
    });
    _syncVisibility();
  }

  // ── INIT ─────────────────────────────────────────────────
  function _init() {
    _buildUI();
    _watchTabs();
    console.info('[NexaAI] v2.0 ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_init, 200));
  } else {
    setTimeout(_init, 200);
  }

})();