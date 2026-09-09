(() => {
  const content = document.getElementById('content');
  const welcome = document.getElementById('welcome');
  const progress = document.getElementById('progress'); // may be absent - no wizard chrome
  const dots = document.getElementById('dots');
  const progressLabel = document.getElementById('progressLabel');
  const restartBtn = document.getElementById('restartBtn');
  const buildMeter = document.getElementById('buildMeter');
  const buildMeterFill = document.getElementById('buildMeterFill');

  const THINKING_WORDS = ['One sec...', 'Putting this together...', 'Got it...'];
  const MAX_DOTS = 7;
  const SHORT_TEXT_MAX = 200;
  const PASTE_TEXT_MAX = 2000;

  const START_CHIPS = [
    { label: 'Writing', answer: 'Writing' },
    { label: 'Learning', answer: 'Learning' },
    { label: 'A website or app', answer: 'A website or app' },
    { label: 'A plan', answer: 'A plan' },
    { label: 'A problem to solve', answer: 'A problem to solve' },
    { label: 'Something fun', answer: 'Something fun' },
  ];

  const PROFILE_KEY = 'clearWordsProfile';

  const PROFILE_WHO = [
    { label: 'Kid', value: 'I am a kid' },
    { label: 'Teen', value: 'I am a teen' },
    { label: 'Adult', value: 'I am an adult' },
    { label: 'Helping someone', value: 'I am helping someone else' },
  ];

  const PROFILE_EXPLAIN = [
    { label: 'Super simple', value: 'Explain things in super simple words' },
    { label: 'Normal plain words', value: 'Use normal plain words' },
    { label: 'A bit more detail', value: 'Use plain words with a bit more detail' },
  ];

  function loadProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return null;
      if (!p.who || !p.explain) return null;
      return {
        who: String(p.who).slice(0, 80),
        explain: String(p.explain).slice(0, 80),
        about: String(p.about || '').slice(0, 240),
      };
    } catch {
      return null;
    }
  }

  function saveProfile(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  function clearProfile() {
    localStorage.removeItem(PROFILE_KEY);
  }


  let history = [];
  let current = null;
  let turn = 0;
  let draftBits = [];
  let lastAction = null;

  let pickerKeyHandler = null;

  function clearPickerKeys() {
    if (pickerKeyHandler) {
      window.removeEventListener('keydown', pickerKeyHandler);
      pickerKeyHandler = null;
    }
  }

  /** Sky picker: free-flow list + caret. Keys / swipe / tap. No arrow chrome. */
  function mountPicker(root, options, onSelect) {
    clearPickerKeys();
    let index = 0;
    let locked = false;
    let touchY = null;

    const itemsHtml = options.map((opt, i) => {
      const label = typeof opt === 'string' ? opt : opt.label;
      const value = typeof opt === 'string' ? opt : (opt.value != null ? opt.value : opt.label);
      return `<button type="button" class="picker-item" role="option" data-i="${i}" data-value="${escapeHtml(value)}" style="--i:${i}" aria-selected="${i === 0 ? 'true' : 'false'}">
        <span class="picker-caret" aria-hidden="true"></span>
        <span class="picker-label">${escapeHtml(label)}</span>
      </button>`;
    }).join('');

    root.innerHTML = `
      <div class="picker" id="skyPicker" tabindex="0" role="listbox" aria-label="Pick one">
        <div class="picker-stage" id="pickerStage">
          <div class="picker-list" id="pickerList">${itemsHtml}</div>
        </div>
        <p class="picker-hint">Swipe, use arrow keys, or press Enter.</p>
      </div>`;

    const picker = root.querySelector('#skyPicker');
    const list = root.querySelector('#pickerList');
    const stage = root.querySelector('#pickerStage');
    function paint() {
      const items = [...list.querySelectorAll('.picker-item')];
      items.forEach((el, i) => {
        el.classList.toggle('is-on', i === index);
        el.classList.toggle('is-near', Math.abs(i - index) === 1);
        el.setAttribute('aria-selected', i === index ? 'true' : 'false');
      });
    }

    function move(delta) {
      if (locked) return;
      const next = Math.max(0, Math.min(options.length - 1, index + delta));
      if (next === index) return;
      index = next;
      paint();
    }

    function confirm(i) {
      if (locked) return;
      if (typeof i === 'number') index = i;
      locked = true;
      clearPickerKeys();
      const items = [...list.querySelectorAll('.picker-item')];
      const el = items[index];
      if (el) el.classList.add('is-locked');
      const opt = options[index];
      const value = typeof opt === 'string' ? opt : (opt.value != null ? opt.value : opt.label);
      setTimeout(() => onSelect(value, opt), 180);
    }

    list.querySelectorAll('.picker-item').forEach((el) => {
      el.addEventListener('click', () => {
        if (locked) return;
        confirm(Number(el.dataset.i) || 0);
      });
    });

    // swipe on stage
    const onStart = (y) => { touchY = y; };
    const onEnd = (y) => {
      if (touchY == null || locked) return;
      const dy = y - touchY;
      touchY = null;
      if (Math.abs(dy) < 28) return;
      move(dy > 0 ? -1 : 1);
    };
    stage.addEventListener('touchstart', (e) => {
      if (e.touches[0]) onStart(e.touches[0].clientY);
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (t) onEnd(t.clientY);
    }, { passive: true });
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') onStart(e.clientY);
    });
    stage.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') onEnd(e.clientY);
    });

    pickerKeyHandler = (e) => {
      if (locked) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowUp' || e.key === 'Up') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'ArrowDown' || e.key === 'Down') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener('keydown', pickerKeyHandler);
    paint();
    setTimeout(() => picker.focus(), 40);
  }

  function setPhase(phase) {
    document.body.dataset.phase = phase;
  }


  function pickThinking() {
    return THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)];
  }

  function setProgress(_n, _almost) {
    // Old wizard chrome stays off. Prompt power meter is separate.
    if (progress) progress.hidden = true;
    if (progressLabel) progressLabel.textContent = '';
    if (dots) dots.innerHTML = '';
  }


  function meterPercent(answerCount, done) {
    if (done) return 100;
    // Game-y curve: first answer jumps, then climbs toward ~90 before done.
    const n = Math.max(0, Number(answerCount) || 0);
    if (n <= 0) return 8;
    const pct = Math.min(92, 18 + n * 14 + Math.min(n, 3) * 4);
    return pct;
  }

  function setBuildMeter(answerCount, opts) {
    const done = Boolean(opts && opts.done);
    const hidden = Boolean(opts && opts.hidden);
    if (!buildMeter || !buildMeterFill) return;
    if (hidden) {
      buildMeter.hidden = true;
      buildMeter.classList.remove('is-pulse', 'is-max');
      return;
    }
    const pct = meterPercent(answerCount, done);
    const prev = Number(buildMeter.dataset.pct || 0);
    buildMeter.hidden = false;
    buildMeter.dataset.pct = String(pct);
    buildMeterFill.style.width = pct + '%';
    buildMeter.setAttribute('aria-valuenow', String(pct));
    buildMeter.classList.toggle('is-max', done || pct >= 90);
    if (pct > prev) {
      buildMeter.classList.remove('is-pulse');
      // reflow to retrigger animation
      void buildMeter.offsetWidth;
      buildMeter.classList.add('is-pulse');
      window.clearTimeout(setBuildMeter._pulseTimer);
      setBuildMeter._pulseTimer = window.setTimeout(() => {
        buildMeter.classList.remove('is-pulse');
      }, 700);
    }
  }

  function hideChromeForBeat1() {
    setPhase('gate');
    if (progress) progress.hidden = true;
    if (progressLabel) progressLabel.textContent = '';
    welcome.hidden = true;
    restartBtn.hidden = true;
    setBuildMeter(0, { hidden: true });
  }

  function showThinking() {
    clearPickerKeys();
    setPhase('sky');
    welcome.hidden = true;
    if (history.length) setBuildMeter(history.length, { hidden: false });
    content.innerHTML = `
      <div class="thinking" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <span>${pickThinking()}</span>
      </div>`;
  }

  function showError(retryFn) {
    content.innerHTML = `
      <div class="error-box">
        <p>That didn’t work. Try again.</p>
        <button type="button" class="primary" id="retryBtn">Try again</button>
      </div>`;
    document.getElementById('retryBtn').onclick = () => retryFn();
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || 'request_failed');
      err.code = data.code || data.error || 'request_failed';
      throw err;
    }
    return data;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function updateDraft(question, answer) {
    const q = (question || '').toLowerCase();
    if (/rough idea|paste|already wrote|what do you want/.test(q) && !draftBits.some((l) => l.startsWith('What I need:'))) {
      const short = answer.length > 120 ? answer.slice(0, 117) + '…' : answer;
      draftBits.push(`What I need: ${short}`);
    } else if (/want|help|trying|goal|do|category/.test(q) && !draftBits.some((l) => l.startsWith('What I need:'))) {
      draftBits.push(`What I need: ${answer}`);
    } else if (/who|for|audience|age|level/.test(q) && !draftBits.some((l) => l.startsWith("Who it's for:"))) {
      draftBits.push(`Who it's for: ${answer}`);
    } else if (/give you back|look like|format|produce/.test(q) && !draftBits.some((l) => l.startsWith('What to give me:'))) {
      draftBits.push(`What to give me: ${answer}`);
    } else if (/sound|tone|style|length/.test(q) && !draftBits.some((l) => l.startsWith('Include:'))) {
      draftBits.push(`Include: ${answer}`);
    } else if (draftBits.length < 5) {
      draftBits.push(`${answer}`);
    }
  }

  /** Beat 1 - primary free-text / paste, secondary help starting. */
  function renderStartScreen() {
    clearPickerKeys();
    current = { id: 'start', question: 'What would you like to accomplish with AI?', input: 'start', local: true };
    turn = 0;
    hideChromeForBeat1();

    content.innerHTML = `
      <p class="question">What would you like to accomplish with AI?</p>
      <p class="lead">Let's start your prompt. Say it in your own words. Simple or detailed is fine.</p>
      <div class="paste-box gate-compose">
        <textarea class="text-area gate-input" id="gateAnswer" maxlength="${PASTE_TEXT_MAX}" rows="6"
          placeholder="Type or paste anything. Messy is fine."></textarea>
        <button type="button" class="primary huge" id="sendGate" disabled>Build my prompt</button>
        <button type="button" class="linkish" id="needHelp">I need help starting</button>
        <button type="button" class="ghost" id="editProfile">Edit my info</button>
      </div>`;

    const ta = document.getElementById('gateAnswer');
    const send = document.getElementById('sendGate');
    const sync = () => { send.disabled = !ta.value.trim(); };
    ta.addEventListener('input', sync);
    send.addEventListener('click', () => {
      const v = ta.value.trim();
      if (v) submitStartPaste(v);
    });
    document.getElementById('needHelp').onclick = () => renderCategoryScreen();
    const edit = document.getElementById('editProfile');
    if (edit) edit.onclick = () => {
      const existing = loadProfile() || { who: '', explain: '', about: '' };
      renderProfileSetup({
        who: existing.who || '',
        explain: existing.explain || '',
        about: existing.about || '',
        step: 'who',
        editing: true,
      });
    };
    setTimeout(() => ta && ta.focus(), 50);
  }

  /** Kept for compatibility; gate now owns paste. */
  function renderPasteScreen() {
    renderStartScreen();
  }

  /** Beat 2b - category picker only (no paste). */
  function renderCategoryScreen() {
    clearPickerKeys();
    setPhase('sky');
    current = { id: 'q1', question: 'What are you working on?', input: 'choice', local: true };
    turn = 1;
    setProgress(1, false);
    setBuildMeter(0, { hidden: false });
    restartBtn.hidden = false;
    welcome.hidden = true;

    content.innerHTML = `<p class="question">What are you working on?</p><div id="pickerMount"></div>`;
    mountPicker(
      content.querySelector('#pickerMount'),
      START_CHIPS.map((c) => ({ label: c.label, value: c.answer })),
      (value) => submitStartChip(value)
    );
  }

  function submitStartChip(answer) {
    const latest = {
      id: 'q1',
      question: 'What are you working on?',
      answer,
    };
    updateDraft(latest.question, answer);
    const nextHistory = [latest];
    lastAction = () => answerWith(nextHistory, latest);
    answerWith(nextHistory, latest);
  }

  function submitStartPaste(answer) {
    const latest = {
      id: 'q1',
      question: 'What would you like to accomplish with AI?',
      answer: answer.slice(0, PASTE_TEXT_MAX),
    };
    updateDraft(latest.question, latest.answer);
    const nextHistory = [latest];
    lastAction = () => answerWith(nextHistory, latest);
    answerWith(nextHistory, latest);
  }

  function renderQuestion(q) {
    setPhase('sky');
    current = q;
    turn = history.length + 1;
    setProgress(Math.min(turn, MAX_DOTS), turn >= 5);
    setBuildMeter(history.length, { hidden: false });
    restartBtn.hidden = false;
    welcome.hidden = true;

    let html = `<p class="question">${escapeHtml(q.question)}</p>`;

    if (q.input === 'choice' && Array.isArray(q.options)) {
      html += `<div id="pickerMount"></div>`;
    } else {
      html += `
        <div class="text-row">
          <input class="text-input" id="textAnswer" maxlength="${SHORT_TEXT_MAX}"
            placeholder="${escapeHtml(q.placeholder || 'Type a few words')}" autocomplete="off" />
          <button type="button" class="primary" id="sendText" disabled>Next</button>
        </div>`;
    }

    content.innerHTML = html;

    if (q.input === 'choice' && Array.isArray(q.options)) {
      mountPicker(
        content.querySelector('#pickerMount'),
        q.options.map((opt) => ({ label: opt, value: opt })),
        (value) => submitAnswer(value)
      );
    } else {
      const input = document.getElementById('textAnswer');
      const send = document.getElementById('sendText');
      const sync = () => { send.disabled = !input.value.trim(); };
      input.addEventListener('input', sync);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          e.preventDefault();
          submitAnswer(input.value.trim());
        }
      });
      send.addEventListener('click', () => {
        if (input.value.trim()) submitAnswer(input.value.trim());
      });
      setTimeout(() => input.focus(), 50);
    }
  }

  async function copyPlainText(text) {
    const plain = String(text || '');
    // Notes and other apps linkify rich HTML paste. Force text/plain only.
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        const item = new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
        return true;
      } catch (_) {
        /* fall through */
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(plain);
        return true;
      } catch (_) {
        /* fall through */
      }
    }
    const ta = document.createElement('textarea');
    ta.value = plain;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, plain.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  function renderDone(prompt) {
    clearPickerKeys();
    setPhase('sky');
    current = null;
    setProgress(MAX_DOTS, true);
    setBuildMeter(history.length, { done: true, hidden: false });
    restartBtn.hidden = false;
    welcome.hidden = true;
    content.innerHTML = `
      <p class="done-title">Here is what to paste</p>
      <textarea class="prompt-box" id="promptText" readonly rows="12" spellcheck="false"></textarea>
      <button type="button" class="primary huge" id="copyBtn">Copy these words</button>
      <p class="copied" id="copiedMsg"></p>`;

    const box = document.getElementById('promptText');
    box.value = prompt;

    document.getElementById('copyBtn').addEventListener('click', async () => {
      const ok = await copyPlainText(prompt);
      document.getElementById('copiedMsg').textContent = ok
        ? 'Copied as plain text. Paste it where you need it.'
        : 'Could not copy. Select the words above and copy.';
    });
  }

  function startSession() {
    lastAction = () => startSession();
    history = [];
    draftBits = [];
    turn = 0;
    current = null;
    if (progress) progress.hidden = true;
    if (progressLabel) progressLabel.textContent = '';
    restartBtn.hidden = true;
    welcome.hidden = true;
    const profile = loadProfile();
    if (!profile) renderProfileSetup();
    else renderStartScreen();
  }

  function renderProfileSetup(draft) {
    clearPickerKeys();
    const state = Object.assign({ who: '', explain: '', about: '', step: 'who', editing: false }, draft || {});
    const existing = loadProfile();
    hideChromeForBeat1();
    setPhase('profile');
    restartBtn.hidden = false;

    const sectionLabel = state.editing ? 'Edit my info' : 'Your info';
    const sectionTag = `<p class="section-tag" aria-current="page">${sectionLabel}</p>`;

    const goBack = () => {
      if (state.editing && existing) {
        renderStartScreen();
        return;
      }
      if (state.step === 'explain') {
        renderProfileSetup(Object.assign({}, state, { step: 'who' }));
        return;
      }
      if (state.step === 'about') {
        renderProfileSetup(Object.assign({}, state, { step: 'explain' }));
        return;
      }
      // first-time setup, first step: nowhere to go except stay
      renderStartScreen();
    };

    const backBtn = state.editing || state.step !== 'who'
      ? `<button type="button" class="ghost" id="profileBack" style="align-self:flex-start">Back</button>`
      : '';

    if (state.step === 'who' || (!state.who && state.step !== 'explain' && state.step !== 'about')) {
      state.step = 'who';
      content.innerHTML = `${backBtn}${sectionTag}<p class="question">Who is this for?</p><div id="pickerMount"></div>
        <p class="picker-hint">Saved on this device. Separate from your words.</p>`;
      if (document.getElementById('profileBack')) document.getElementById('profileBack').onclick = goBack;
      mountPicker(content.querySelector('#pickerMount'), PROFILE_WHO, (value) => {
        renderProfileSetup(Object.assign({}, state, { who: value, step: 'explain' }));
      });
      return;
    }

    if (state.step === 'explain' || (!state.explain && state.step !== 'about')) {
      state.step = 'explain';
      content.innerHTML = `${backBtn}${sectionTag}<p class="question">How should answers sound?</p><div id="pickerMount"></div>`;
      if (document.getElementById('profileBack')) document.getElementById('profileBack').onclick = goBack;
      mountPicker(content.querySelector('#pickerMount'), PROFILE_EXPLAIN, (value) => {
        renderProfileSetup(Object.assign({}, state, { explain: value, step: 'about' }));
      });
      return;
    }

    state.step = 'about';
    content.innerHTML = `
      ${backBtn}
      ${sectionTag}
      <p class="question">Anything else to know about you?</p>
      <div class="paste-box">
        <textarea class="text-area" id="aboutAnswer" maxlength="240" rows="4"
          placeholder="School, work, hobbies, or skip">${escapeHtml(state.about || '')}</textarea>
        <button type="button" class="primary" id="saveProfile">Save and continue</button>
        <button type="button" class="ghost" id="skipAbout" style="margin-top:10px">Skip</button>
      </div>`;
    if (document.getElementById('profileBack')) document.getElementById('profileBack').onclick = goBack;

    const finish = (about) => {
      saveProfile({ who: state.who, explain: state.explain, about: about || '' });
      renderStartScreen();
    };
    const ta = document.getElementById('aboutAnswer');
    document.getElementById('saveProfile').onclick = () => finish(ta.value.trim());
    document.getElementById('skipAbout').onclick = () => finish(state.about || '');
    setTimeout(() => ta && ta.focus(), 50);
  }


  async function submitAnswer(answer) {
    if (!current || !answer) return;
    const latest = {
      id: current.id,
      question: current.question,
      answer: String(answer).slice(0, SHORT_TEXT_MAX),
    };
    updateDraft(current.question, latest.answer);
    const nextHistory = history.concat(latest);
    lastAction = () => answerWith(nextHistory, latest);
    await answerWith(nextHistory, latest);
  }

  async function answerWith(nextHistory, latest) {
    showThinking();
    setProgress(Math.min(nextHistory.length + 1, MAX_DOTS), nextHistory.length >= 4);
    try {
      const data = await api('/api/session/answer', {
        history: nextHistory,
        latest,
        profile: loadProfile(),
      });
      history = nextHistory;
      setBuildMeter(history.length, { done: data.type === 'done', hidden: false });
      if (data.type === 'done') renderDone(data.prompt);
      else renderQuestion(data);
    } catch {
      showError(() => answerWith(nextHistory, latest));
    }
  }

  restartBtn.addEventListener('click', () => startSession());
  startSession();
})();
