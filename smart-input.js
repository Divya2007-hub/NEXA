/**
 * NEXA — Smart Natural Language Task Parser  |  smart-input.js  v1.0
 * ─────────────────────────────────────────────────────────────────
 * Parses natural language input into structured task objects.
 * Uses the Anthropic API with a full local fallback parser.
 *
 * Features:
 *   ✅ Natural language date/time parsing ("tomorrow evening", "next Monday")
 *   ✅ Priority detection from keywords
 *   ✅ Category auto-detection
 *   ✅ Live preview card before adding
 *   ✅ Claude AI enhancement (with smart local fallback)
 *   ✅ Works offline
 *
 * Load AFTER: script.js, sync.js, sync-patch.js
 */

'use strict';

(function () {

  /* ═══════════════════════════════════════════════════
     SYSTEM PROMPT
  ═══════════════════════════════════════════════════ */
  const PARSE_PROMPT = `You are a task parser for the NEXA productivity app.
Convert user input into a structured task object.
Today's date is ${new Date().toISOString().slice(0,10)}.
Current time is ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}.

Rules:
- Understand natural language like "tomorrow evening", "next Monday", "after lunch", "in 2 hours", "end of week"
- Extract title (concise, 3-8 words), description (optional detail), dueDate (YYYY-MM-DD), time (HH:MM 24h), priority, category
- Priority: urgent/high/medium/low — infer from urgency words ("asap", "urgent", "important", "critical" = high/urgent)
- Category: study/work/personal/health/other — infer from context
- Time defaults: morning=09:00, lunch=12:00, afternoon=14:00, evening=18:00, night=21:00, midnight=00:00
- If no date mentioned, dueDate = ""
- Return ONLY valid JSON, no other text:
{"title":"","description":"","dueDate":"","time":"","priority":"medium","category":"other"}`;

  /* ═══════════════════════════════════════════════════
     LOCAL NLP PARSER (fallback + instant preview)
  ═══════════════════════════════════════════════════ */

  function _parseLocal(input) {
    const text = input.trim();
    const lower = text.toLowerCase();
    const now = new Date();

    // ── DATE PARSING ──
    let dueDate = '';
    let time = '';

    const datePatterns = [
      // Relative days
      { re: /\btomorrow\b/i,      fn: () => _offsetDate(1) },
      { re: /\byesterday\b/i,     fn: () => _offsetDate(-1) },
      { re: /\btoday\b/i,         fn: () => _offsetDate(0) },
      { re: /\bday after tomorrow\b/i, fn: () => _offsetDate(2) },

      // This/next weekday
      { re: /\b(?:this\s+)?(monday)\b/i,    fn: () => _nextWeekday(1, lower.includes('next')) },
      { re: /\b(?:this\s+)?(tuesday)\b/i,   fn: () => _nextWeekday(2, lower.includes('next')) },
      { re: /\b(?:this\s+)?(wednesday)\b/i, fn: () => _nextWeekday(3, lower.includes('next')) },
      { re: /\b(?:this\s+)?(thursday)\b/i,  fn: () => _nextWeekday(4, lower.includes('next')) },
      { re: /\b(?:this\s+)?(friday)\b/i,    fn: () => _nextWeekday(5, lower.includes('next')) },
      { re: /\b(?:this\s+)?(saturday)\b/i,  fn: () => _nextWeekday(6, lower.includes('next')) },
      { re: /\b(?:this\s+)?(sunday)\b/i,    fn: () => _nextWeekday(0, lower.includes('next')) },

      // "next week", "end of week"
      { re: /\bnext\s+week\b/i,   fn: () => _offsetDate(7) },
      { re: /\bend\s+of\s+(?:the\s+)?week\b/i, fn: () => _nextWeekday(5, false) },
      { re: /\bend\s+of\s+(?:the\s+)?month\b/i, fn: () => _endOfMonth() },

      // "in N days/hours/weeks"
      { re: /\bin\s+(\d+)\s+days?\b/i,   fn: (m) => _offsetDate(parseInt(m[1])) },
      { re: /\bin\s+(\d+)\s+weeks?\b/i,  fn: (m) => _offsetDate(parseInt(m[1]) * 7) },
      { re: /\bin\s+(\d+)\s+hours?\b/i,  fn: (m) => { const d = new Date(now.getTime() + parseInt(m[1]) * 3600000); return _fmt(d); } },

      // Specific date formats: "Jan 15", "15 Jan", "01/15", "2025-01-15"
      { re: /\b(\d{4}-\d{2}-\d{2})\b/,  fn: (m) => m[1] },
      { re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, fn: (m) => {
        const y = m[3] ? (m[3].length === 2 ? '20'+m[3] : m[3]) : now.getFullYear();
        return `${y}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
      }},
      { re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, fn: (m) => {
        const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
        const mo = months[m[1].toLowerCase().slice(0,3)];
        return `${now.getFullYear()}-${String(mo).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
      }},
    ];

    for (const { re, fn } of datePatterns) {
      const match = lower.match(re) || text.match(re);
      if (match) { dueDate = fn(match); break; }
    }

    // ── TIME PARSING ──
    const timePatterns = [
      { re: /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i, fn: (m) => {
        let h = parseInt(m[1]), min = parseInt(m[2] || '0');
        if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
        if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
        return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
      }},
      { re: /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i, fn: (m) => {
        let h = parseInt(m[1]), min = parseInt(m[2]);
        if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
        if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
        return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
      }},
      { re: /\b(\d{1,2})\s*(am|pm)\b/i, fn: (m) => {
        let h = parseInt(m[1]);
        if (m[2].toLowerCase() === 'pm' && h < 12) h += 12;
        if (m[2].toLowerCase() === 'am' && h === 12) h = 0;
        return `${String(h).padStart(2,'0')}:00`;
      }},
      { re: /\bearly\s+morning\b/i, fn: () => '07:00' },
      { re: /\bmorning\b/i,         fn: () => '09:00' },
      { re: /\bbreakfast\b/i,       fn: () => '08:00' },
      { re: /\bafter\s+lunch\b/i,   fn: () => '13:30' },
      { re: /\blunch\b/i,           fn: () => '12:00' },
      { re: /\bafternoon\b/i,       fn: () => '14:00' },
      { re: /\bevening\b/i,         fn: () => '18:00' },
      { re: /\bsunset\b/i,          fn: () => '19:00' },
      { re: /\bnight\b/i,           fn: () => '21:00' },
      { re: /\bbedtime\b/i,         fn: () => '22:00' },
      { re: /\bmidnight\b/i,        fn: () => '00:00' },
      { re: /\bnoon\b/i,            fn: () => '12:00' },
      { re: /\bin\s+(\d+)\s+hours?\b/i, fn: (m) => {
        const d = new Date(now.getTime() + parseInt(m[1]) * 3600000);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      }},
    ];

    for (const { re, fn } of timePatterns) {
      const match = lower.match(re) || text.match(re);
      if (match) { time = fn(match); break; }
    }

    // ── PRIORITY PARSING ──
    let priority = 'medium';
    const urgentWords   = /\b(urgent|asap|immediately|critical|emergency|now|right now|deadline)\b/i;
    const highWords     = /\b(important|high priority|must|need to|crucial|key|significant|don't forget|vital)\b/i;
    const lowWords      = /\b(low priority|whenever|eventually|someday|maybe|if possible|no rush|relaxed|chill)\b/i;

    if (urgentWords.test(lower))   priority = 'urgent';
    else if (highWords.test(lower)) priority = 'high';
    else if (lowWords.test(lower))  priority = 'low';

    // ── CATEGORY PARSING ──
    let category = 'other';
    const categories = {
      work:     /\b(work|meeting|project|client|deadline|office|email|report|presentation|boss|team|standup|sprint|task|jira|slack|deploy|review|pr|pull request|interview|job|career)\b/i,
      study:    /\b(study|homework|assignment|class|lecture|exam|test|quiz|school|college|university|course|learn|read|research|essay|thesis|notes|revision)\b/i,
      health:   /\b(gym|workout|exercise|run|jog|walk|doctor|appointment|medicine|pill|medication|yoga|meditation|diet|eat|meal|health|fitness|dentist|hospital|therapy)\b/i,
      personal: /\b(call|text|message|friend|family|mom|dad|birthday|party|dinner|date|buy|shop|grocery|clean|laundry|home|house|pay|bill|bank|travel|trip|vacation|book|movie|game)\b/i,
    };

    for (const [cat, re] of Object.entries(categories)) {
      if (re.test(lower)) { category = cat; break; }
    }

    // ── TITLE EXTRACTION ──
    // Remove date/time phrases to get clean title
    let title = text
      .replace(/\b(tomorrow|today|yesterday|day after tomorrow)\b/gi, '')
      .replace(/\b(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
      .replace(/\bin\s+\d+\s+(?:days?|hours?|weeks?)\b/gi, '')
      .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, '')
      .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '')
      .replace(/\b(morning|evening|afternoon|night|midnight|noon|lunch|breakfast|after lunch)\b/gi, '')
      .replace(/\b(urgent|asap|important|high priority|low priority|critical)\b/gi, '')
      .replace(/\b(remind me to|remember to|don't forget to|i need to|i have to|i must|i should)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Capitalize first letter, trim to reasonable length
    title = title.charAt(0).toUpperCase() + title.slice(1);
    if (title.length > 80) title = title.slice(0, 77) + '...';
    if (!title) title = text.charAt(0).toUpperCase() + text.slice(1, 60);

    // ── DESCRIPTION ──
    const description = text.length > title.length + 10 ? text : '';

    return { title, description, dueDate, time, priority, category };
  }

  // ── DATE HELPERS ──
  function _fmt(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function _offsetDate(days) {
    const d = new Date(); d.setDate(d.getDate() + days); return _fmt(d);
  }
  function _nextWeekday(targetDay, forceNext = false) {
    const d = new Date();
    const current = d.getDay();
    let diff = targetDay - current;
    if (diff <= 0 || forceNext) diff += 7;
    d.setDate(d.getDate() + diff);
    return _fmt(d);
  }
  function _endOfMonth() {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return _fmt(d);
  }

  /* ═══════════════════════════════════════════════════
     AI-ENHANCED PARSING
  ═══════════════════════════════════════════════════ */
  async function _parseWithAI(input) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: PARSE_PROMPT,
          messages: [{ role: 'user', content: input }]
        })
      });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      const raw = data.content?.map(b => b.text || '').join('').trim();
      const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0];
      if (!jsonStr) throw new Error('No JSON');
      const parsed = JSON.parse(jsonStr);
      // Validate required fields
      if (!parsed.title) throw new Error('No title');
      return parsed;
    } catch {
      return null; // fall back to local
    }
  }

  /* ═══════════════════════════════════════════════════
     PREVIEW CARD UI
  ═══════════════════════════════════════════════════ */
  const PRIORITY_COLORS = {
    urgent: { bg: 'rgba(244,114,182,.12)', border: 'rgba(244,114,182,.3)', color: '#f472b6', label: '⚡ Urgent' },
    high:   { bg: 'rgba(248,113,113,.10)', border: 'rgba(248,113,113,.28)', color: '#f87171', label: '🔥 High' },
    medium: { bg: 'rgba(251,146,60,.08)',  border: 'rgba(251,146,60,.22)',  color: '#fb923c', label: '● Medium' },
    low:    { bg: 'rgba(52,211,153,.08)',  border: 'rgba(52,211,153,.22)',  color: '#34d399', label: '● Low' },
  };

  const CATEGORY_ICONS = {
    work: '💼', study: '📚', personal: '👤', health: '💪', other: '📌'
  };

  let _previewEl = null;
  let _currentParsed = null;
  let _parseTimer = null;
  let _isParsingAI = false;

  function _showPreview(parsed, isAI = false) {
    _currentParsed = parsed;
    const inp = document.getElementById('task-input');
    if (!inp || !inp.value.trim()) { _hidePreview(); return; }

    const p = PRIORITY_COLORS[parsed.priority] || PRIORITY_COLORS.medium;
    const catIcon = CATEGORY_ICONS[parsed.category] || '📌';

    if (!_previewEl) {
      _previewEl = document.createElement('div');
      _previewEl.id = 'smart-input-preview';
      _previewEl.setAttribute('role', 'region');
      _previewEl.setAttribute('aria-label', 'Task preview');
    }

    const dateStr = parsed.dueDate
      ? (() => {
          const d = new Date(parsed.dueDate + 'T12:00:00');
          const today = new Date(); today.setHours(0,0,0,0);
          const diff = Math.round((d - today) / 86400000);
          if (diff === 0) return 'Today';
          if (diff === 1) return 'Tomorrow';
          if (diff === -1) return 'Yesterday';
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        })()
      : '';

    _previewEl.innerHTML = `
      <div class="sip-header">
        <span class="sip-ai-badge">${isAI ? '✦ AI Parsed' : '⚡ Smart Parse'}</span>
        <button class="sip-close" aria-label="Close preview">✕</button>
      </div>
      <div class="sip-card" style="border-color:${p.border};background:${p.bg}">
        <div class="sip-title-row">
          <span class="sip-cat-icon">${catIcon}</span>
          <span class="sip-title">${_escH(parsed.title)}</span>
        </div>
        ${parsed.description && parsed.description !== parsed.title
          ? `<div class="sip-desc">${_escH(parsed.description.slice(0, 100))}</div>` : ''}
        <div class="sip-meta">
          <span class="sip-badge" style="color:${p.color};background:${p.bg};border-color:${p.border}">${p.label}</span>
          <span class="sip-badge sip-cat">${catIcon} ${parsed.category}</span>
          ${dateStr ? `<span class="sip-badge sip-date">📅 ${dateStr}${parsed.time ? ' ' + _fmt12(parsed.time) : ''}</span>` : ''}
          ${!dateStr && parsed.time ? `<span class="sip-badge sip-date">⏰ ${_fmt12(parsed.time)}</span>` : ''}
        </div>
      </div>
      <div class="sip-actions">
        <button class="sip-btn sip-btn-ghost" id="sip-edit">Edit manually</button>
        <button class="sip-btn sip-btn-primary" id="sip-add">✦ Add Task</button>
      </div>`;

    // Insert above input bar
    const inputBar = document.getElementById('input-bar');
    if (inputBar && !inputBar.contains(_previewEl)) {
      inputBar.parentNode.insertBefore(_previewEl, inputBar);
    }

    // Animate in
    _previewEl.classList.remove('sip-hidden');
    requestAnimationFrame(() => _previewEl.classList.add('sip-visible'));

    // Bind actions
    _previewEl.querySelector('.sip-close')?.addEventListener('click', _hidePreview);
    _previewEl.querySelector('#sip-edit')?.addEventListener('click', () => {
      _hidePreview();
      inp.focus();
    });
    _previewEl.querySelector('#sip-add')?.addEventListener('click', () => {
      _addParsedTask(parsed);
    });
  }

  function _hidePreview() {
    if (!_previewEl) return;
    _previewEl.classList.remove('sip-visible');
    _previewEl.classList.add('sip-hidden');
    setTimeout(() => {
      if (_previewEl?.classList.contains('sip-hidden')) {
        _previewEl.remove();
        _previewEl = null;
      }
    }, 220);
    _currentParsed = null;
  }

  function _fmt12(time) {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
  }

  function _escH(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ═══════════════════════════════════════════════════
     ADD PARSED TASK
  ═══════════════════════════════════════════════════ */
  function _addParsedTask(parsed) {
    const tasks = window.tasks;
    if (!Array.isArray(tasks)) return;

    // Map category to notes tag, priority to NEXA priority
    const priMap = { urgent: 'urgent', high: 'high', medium: 'medium', low: 'low' };

    const newTask = {
      id: Math.random().toString(36).slice(2, 9),
      text: parsed.title,
      done: false,
      pri: priMap[parsed.priority] || 'medium',
      due: parsed.dueDate || null,
      dueTime: parsed.time || null,
      notes: [
        parsed.description && parsed.description !== parsed.title ? parsed.description : '',
        parsed.category !== 'other' ? `Category: ${parsed.category}` : '',
      ].filter(Boolean).join('\n') || '',
      recur: null,
      at: Date.now(),
    };

    tasks.unshift(newTask);

    // Persist locally
    try {
      const user = typeof firebase !== 'undefined' ? firebase.auth().currentUser : null;
      const lsKey = user ? `taskr_${user.uid}_tasks` : 'taskr_guest_tasks';
      localStorage.setItem(lsKey, JSON.stringify(tasks));
    } catch (_) {}

    // Firestore sync
    if (window.FireSync?.addTask) {
      window.FireSync.addTask(newTask).catch(() => {});
    }

    // Set due fields in the input bar UI if they exist
    const dueDateInp = document.getElementById('due-date');
    const dueTimeInp = document.getElementById('due-time');
    if (dueDateInp && parsed.dueDate) dueDateInp.value = parsed.dueDate;
    if (dueTimeInp && parsed.time) dueTimeInp.value = parsed.time;

    // Clear input
    const inp = document.getElementById('task-input');
    if (inp) inp.value = '';
    if (dueDateInp) dueDateInp.value = '';
    if (dueTimeInp) dueTimeInp.value = '';

    // Hide preview
    _hidePreview();

    // Re-render
    if (typeof window._nexaRender === 'function') window._nexaRender();

    // Toast
    if (typeof window.showToast === 'function') {
      window.showToast(`✦ Task added: "${parsed.title}"`, 't-success', 2800);
    }

    // Play sound
    if (typeof playClick === 'function') playClick(660, 0.1);
  }

  /* ═══════════════════════════════════════════════════
     HOOK INTO TASK INPUT
  ═══════════════════════════════════════════════════ */
  function _hookInput() {
    const inp = document.getElementById('task-input');
    if (!inp) return;

    // Add the smart parse button indicator to the input
    const inputRow = inp.closest('.input-row');
    if (inputRow && !document.getElementById('sip-trigger-btn')) {
      const btn = document.createElement('button');
      btn.id = 'sip-trigger-btn';
      btn.className = 'sip-trigger-btn';
      btn.title = 'Smart parse (or press Tab)';
      btn.setAttribute('aria-label', 'Smart parse task');
      btn.innerHTML = '✦';
      inputRow.appendChild(btn);

      btn.addEventListener('click', () => _triggerParse(inp.value));
    }

    // Tab key → trigger smart parse
    inp.addEventListener('keydown', e => {
      if (e.key === 'Tab' && inp.value.trim().length > 3) {
        e.preventDefault();
        _triggerParse(inp.value);
        return;
      }
      // Escape → hide preview
      if (e.key === 'Escape') _hidePreview();
    });

    // Live parse after 600ms of inactivity (only for longer inputs)
    inp.addEventListener('input', () => {
      clearTimeout(_parseTimer);
      const val = inp.value.trim();
      if (val.length < 5) { _hidePreview(); return; }
      _parseTimer = setTimeout(() => {
        const local = _parseLocal(val);
        _showPreview(local, false);
        // Background AI enhancement for inputs > 8 chars
        if (val.length > 8 && !_isParsingAI) {
          _isParsingAI = true;
          _parseWithAI(val).then(aiResult => {
            _isParsingAI = false;
            if (aiResult && inp.value.trim() === val) {
              _showPreview(aiResult, true);
            }
          }).catch(() => { _isParsingAI = false; });
        }
      }, 600);
    });

    // Hide preview when input is cleared
    inp.addEventListener('blur', () => {
      // Small delay so "Add Task" click can register first
      setTimeout(() => {
        if (!inp.value.trim()) _hidePreview();
      }, 200);
    });
  }

  async function _triggerParse(val) {
    val = (val || '').trim();
    if (!val) return;

    // Show local parse immediately
    const local = _parseLocal(val);
    _showPreview(local, false);

    // Then try AI in background
    if (!_isParsingAI) {
      _isParsingAI = true;
      const aiResult = await _parseWithAI(val);
      _isParsingAI = false;
      if (aiResult) {
        const inp = document.getElementById('task-input');
        if (inp && inp.value.trim() === val) _showPreview(aiResult, true);
      }
    }
  }

  /* ═══════════════════════════════════════════════════
     INJECT CSS
  ═══════════════════════════════════════════════════ */
  function _injectStyles() {
    if (document.getElementById('smart-input-styles')) return;
    const style = document.createElement('style');
    style.id = 'smart-input-styles';
    style.textContent = `
/* ── Smart Input Preview ── */
#smart-input-preview {
  position: fixed;
  bottom: calc(var(--input-bar-h, 120px) + 8px);
  left: calc(var(--sidebar-w, 232px) + 16px);
  right: 16px;
  max-width: 860px;
  margin: 0 auto;
  z-index: 200;
  background: var(--glass, rgba(16,18,26,.9));
  border: 1px solid var(--glass-bd2, rgba(255,255,255,.1));
  border-radius: var(--rl, 16px);
  backdrop-filter: blur(28px) saturate(1.4);
  -webkit-backdrop-filter: blur(28px) saturate(1.4);
  box-shadow: 0 -4px 32px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.04) inset;
  padding: 12px 14px 10px;
  transform: translateY(12px);
  opacity: 0;
  pointer-events: none;
  transition: transform .24s cubic-bezier(.34,1.56,.64,1), opacity .2s ease;
}
#smart-input-preview.sip-visible {
  transform: translateY(0);
  opacity: 1;
  pointer-events: all;
}
#smart-input-preview.sip-hidden {
  transform: translateY(12px);
  opacity: 0;
  pointer-events: none;
}

.sip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.sip-ai-badge {
  font-size: .62rem;
  font-weight: 600;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--ac, #7c6ef7);
  background: var(--ac-g, rgba(124,110,247,.12));
  border: 1px solid rgba(124,110,247,.22);
  padding: 2px 9px;
  border-radius: 100px;
}
.sip-close {
  width: 22px; height: 22px;
  border-radius: 6px; border: 1px solid var(--bd2);
  background: transparent; color: var(--tx3);
  cursor: pointer; font-size: .7rem;
  display: flex; align-items: center; justify-content: center;
  transition: all var(--tr, .18s);
}
.sip-close:hover { background: var(--sf2); color: var(--tx); }

.sip-card {
  border-radius: var(--rs, 8px);
  border: 1px solid;
  padding: 10px 12px;
  margin-bottom: 10px;
  transition: all var(--tr, .18s);
}
.sip-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}
.sip-cat-icon { font-size: 1rem; flex-shrink: 0; }
.sip-title {
  font-weight: 600;
  font-size: .88rem;
  color: var(--tx, #f0f1f5);
  letter-spacing: -.01em;
  line-height: 1.3;
  flex: 1;
}
.sip-desc {
  font-size: .74rem;
  color: var(--tx2, #8b95a3);
  line-height: 1.5;
  margin-bottom: 6px;
  padding-left: 26px;
}
.sip-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding-left: 26px;
}
.sip-badge {
  font-size: .64rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 100px;
  border: 1px solid;
  letter-spacing: .02em;
  white-space: nowrap;
}
.sip-cat  { color: var(--tx2); background: var(--sf2); border-color: var(--bd2); }
.sip-date { color: var(--ac2, #9b8fff); background: var(--ac-g, rgba(124,110,247,.1)); border-color: rgba(124,110,247,.2); }

.sip-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.sip-btn {
  font-family: var(--fd);
  font-size: .76rem;
  font-weight: 500;
  padding: 7px 16px;
  border-radius: var(--rs, 8px);
  cursor: pointer;
  transition: all var(--tr, .18s);
  letter-spacing: -.01em;
}
.sip-btn-ghost {
  background: transparent;
  border: 1px solid var(--bd2);
  color: var(--tx3);
}
.sip-btn-ghost:hover { background: var(--sf2); color: var(--tx); }
.sip-btn-primary {
  background: var(--ac);
  border: 1px solid transparent;
  color: #fff;
  box-shadow: 0 2px 12px rgba(124,110,247,.3);
}
.sip-btn-primary:hover {
  background: var(--ac2);
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(124,110,247,.4);
}
.sip-btn-primary:active { transform: scale(.97); }

/* ── Trigger button on input row ── */
.sip-trigger-btn {
  width: 38px; height: 42px;
  border-radius: var(--r, 12px);
  border: 1px solid rgba(124,110,247,.3);
  background: var(--ac-g, rgba(124,110,247,.1));
  color: var(--ac, #7c6ef7);
  font-size: .9rem;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all .2s cubic-bezier(.34,1.56,.64,1);
  order: 3;
}
.sip-trigger-btn:hover {
  background: var(--ac);
  color: #fff;
  border-color: transparent;
  transform: scale(1.06);
  box-shadow: 0 2px 12px rgba(124,110,247,.4);
}
.sip-trigger-btn:active { transform: scale(.93); }

/* ── Input hint text ── */
.task-input::placeholder {
  /* Hint shown via JS, not CSS override */
}

/* ── Mobile ── */
@media (max-width: 768px) {
  #smart-input-preview {
    left: 8px;
    right: 8px;
    bottom: calc(var(--input-bar-h, 130px) + 4px);
    border-radius: var(--r, 12px);
  }
  .sip-actions { justify-content: stretch; }
  .sip-btn { flex: 1; text-align: center; }
  .sip-trigger-btn { width: 36px; height: 38px; }
}
    `;
    document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════════════════
     INPUT BAR HEIGHT TRACKING
  ═══════════════════════════════════════════════════ */
  function _trackInputBarHeight() {
    const bar = document.getElementById('input-bar');
    if (!bar) return;
    const update = (entries) => {
      let h;
      if (entries && entries[0] && entries[0].borderBoxSize && entries[0].borderBoxSize[0]) {
        h = entries[0].borderBoxSize[0].blockSize;
      } else if (entries && entries[0] && entries[0].contentRect) {
        h = entries[0].contentRect.height;
      } else {
        h = bar.offsetHeight;
      }
      requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--input-bar-h', h + 'px');
      });
    };
    update();
    new ResizeObserver(update).observe(bar);
  }

  /* ═══════════════════════════════════════════════════
     EXPOSE PUBLIC API
  ═══════════════════════════════════════════════════ */
  window.NexaSmartInput = {
    parse: _parseLocal,
    parseAI: _parseWithAI,
    show: _showPreview,
    hide: _hidePreview,
    addTask: _addParsedTask,
  };

  /* ═══════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════ */
  function _init() {
    _injectStyles();
    _hookInput();
    _trackInputBarHeight();
    console.info('[SmartInput] v1.0 ready — Tab to parse, or type naturally.');
  }

  function _ready(cb) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb);
    } else {
      setTimeout(cb, 0);
    }
  }

  _ready(() => setTimeout(_init, 300));

})();
