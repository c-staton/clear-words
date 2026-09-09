require('dotenv').config();
const path = require('path');
const express = require('express');

const PORT = Number(process.env.PORT) || 8787;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_TURNS = 10;
// Normal path needs a few answers; rich pasted drafts can finish earlier once gaps are filled.
const MIN_TURNS_BEFORE_DONE = 4;
const MIN_TURNS_WITH_RICH_SEED = 3;
const ANSWER_MAX = 2000;
const QUESTION_MAX = 200;

if (!OPENROUTER_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY in environment. Add it to .env');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You help fully normal people (kids or adults) who know nothing about software, coding, or tech jargon.
They answer simple questions. You write a strong, detailed final prompt that a careful technical person would write, then paste into ChatGPT, Claude, Grok, or a coding AI like Cursor.

TWO LANES (pick from their answers):
1) Content lane: writing, learning, plans, problems explained in words, fun stories or games that stay in chat.
2) Build lane: website, app, tool, game they want made, or any useful thing that should exist outside a single chat reply.

THE QUESTIONS (this is a guided coach, not a blank form):
- Stay short, plain, and friendly. A kid should get them.
- Never use an em dash or en dash.
- Never use AI or corporate filler.
- Never say system prompt, input, output, I/O, constraints, parameters, tokens, model, temperature, system design, persona, prompt engineering, API, codebase, stack, frontend, backend, repo, or similar tech words in QUESTIONS.
- Default to choice questions with 3 to 5 concrete options. Be opinionated.
- Put your best recommendation FIRST in the options list. Make that option a real strong default for their situation, not a vague "Other".
- In the question text, briefly tip the recommendation in plain words (example: "For this, a clear plan usually works best. What do you want back?").
- Offer good-enough ready-made picks for tone, audience, format, must-haves, first screen, and "done" looks like. Do not ask them to invent those from a blank box.
- Use input "text" only as a last resort (about 1 in 8 questions max), and only when a name, title, or tiny unique detail cannot be a choice. Never use text for tone, audience, format, or deliverable type.
- Never ask open essay questions like "describe what you want" or "what must it include" without choices. Turn those into recommended picks plus one "Something else" option when needed.
- Ask only for missing pieces. Skip anything already answered. Infer and recommend from what they already said.
- Content lane gaps: goal, context, who it is for, what they want back, format, tone, musts or don'ts, what good looks like.
- Build lane gaps: what it should help someone do, who will use it, what happens first, must-haves, what done looks like, and what they want back (whole thing, plan, steps, or paste into a coding AI).
- After about 4 to 7 useful answers, return done when you can write a strong detailed prompt. Build lane may need one more gap than content lane.
- If turnCount is ${MAX_TURNS - 1} or higher, return done.
- Do not return done before turn ${MIN_TURNS_BEFORE_DONE} unless there is a detailed draft and the main gaps are filled.

THE FINAL PROMPT (this is the product):
- Write a fully detailed prompt that sets the AI up for a great result.
- Include clear sections when helpful: Role, Task, Context, About me, What I am giving you, What I need back, Format, Tone, Quality bar, Include, Leave out, How to talk to me, Process.
- Always include an About me / How to talk to me section from the user profile when provided.
- Always tell the AI how to talk to the human: plain words, no jargon unless they asked, define any hard word in one simple line.
- Cover what they have, what they want back, format, tone, quality bar, and include/leave out.
- Fill reasonable missing details from their answers. Do not invent fake personal facts.
- Prefer substance over brevity. Usually at least 150 words when they gave enough material. Build briefs are often longer.
- No em dashes. No corporate filler. No intro like Sure or Here is your prompt.
- The final prompt is for the AI. The QUESTIONS are for the human. Keep that split.

BUILD LANE FINALS:
- Role: expert product + builder helper (not a school essay helper).
- What I need back: a real builder brief. Include product goal, who uses it, main screens or steps in plain words, must-haves, nice-to-haves, look and feel in plain words, and what done looks like.
- Explicitly allow the AI to use technical detail, structure, and code in the deliverable when that helps build the thing.
- Still keep How to talk to me plain for the human reading along.
- If they want something to paste into a coding AI, say so clearly in What I need back.

CONTENT LANE FINALS:
- Keep coding talk out of the deliverable unless they clearly asked for it.

You may receive a profile object with who they are and how they like answers. Inject that into every final prompt.

Respond with ONLY valid JSON matching one of these shapes:
{"type":"question","id":"qN","question":"...","input":"choice","options":["best pick first","...","..."]}
{"type":"question","id":"qN","question":"...","input":"text","placeholder":"..."}
{"type":"done","prompt":"..."}

Almost always use choice. First option = your recommendation.

No markdown fences. No extra keys. No commentary.`;

function isRoughIdeaEntry(item) {
  const q = String(item?.question || '').toLowerCase();
  return /rough idea|paste|already wrote|messy/.test(q);
}

function hasRichSeed(history) {
  const seed = history.find(isRoughIdeaEntry) || history[0];
  if (!seed) return false;
  if (isRoughIdeaEntry(seed) && String(seed.answer || '').trim().length >= 40) return true;
  return String(seed.answer || '').trim().length >= 120;
}

function isBuildLane(history) {
  const blob = (history || [])
    .map((h) => `${h.question || ''} ${h.answer || ''}`)
    .join(' ')
    .toLowerCase();
  return /website|web app|\bapp\b|build|making something|make (a|an|the)|create (a|an|the)|tool|game|coding ai|paste into a coding/i.test(
    blob
  );
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(0, MAX_TURNS)
    .map((item, idx) => ({
      id: String(item?.id || `q${idx + 1}`).slice(0, 40),
      question: String(item?.question || '').slice(0, QUESTION_MAX),
      answer: String(item?.answer || '').slice(0, ANSWER_MAX),
    }))
    .filter((item) => item.question || item.answer);
}

function cleanGeneratedText(value) {
  return String(value || '')
    .replace(new RegExp('[\u2013\u2014]', 'g'), ',')
    .replace(/here[’']s a comprehensive/gi, 'Here is a')
    .replace(/\bdelve\b/gi, 'look into')
    .replace(/\bunlock\b/gi, 'find')
    .replace(/\belevate\b/gi, 'improve')
    .replace(/\bseamless\b/gi, 'smooth')
    .replace(/\btailored\b/gi, 'made for you')
    .replace(/\bleverage\b/gi, 'use')
    .replace(/\brobust\b/gi, 'strong')
    .replace(/\bjourney\b/gi, 'process')
    .replace(/\bcrafted\b/gi, 'made')
    .replace(/\bcertainly\b[,.!]?\s*/gi, '')
    .replace(/\bof course\b[,.!]?\s*/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/,{2,}/g, ',')
    .trim();
}

function validateModelPayload(raw, turnCount) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  if (data.type === 'done') {
    const prompt = cleanGeneratedText(data.prompt);
    if (!prompt || prompt.length < 220) return null;
    return { type: 'done', prompt: prompt.slice(0, 9000) };
  }

  if (data.type === 'question') {
    if (turnCount >= MAX_TURNS) return null;
    const question = cleanGeneratedText(data.question).slice(0, 120);
    if (!question) return null;
    const id = String(data.id || `q${turnCount}`).slice(0, 40);
    const input = data.input === 'text' ? 'text' : 'choice';
    if (input === 'choice') {
      let options = Array.isArray(data.options) ? data.options : [];
      options = options
        .map((o) => cleanGeneratedText(o).slice(0, 40))
        .filter(Boolean)
        .slice(0, 6);
      if (options.length < 2) return null;
      return { type: 'question', id, question, input: 'choice', options };
    }
    const placeholder = cleanGeneratedText(data.placeholder || 'Type a few words').slice(0, 80);
    return { type: 'question', id, question, input: 'text', placeholder };
  }
  return null;
}

function fallbackQuestion(turnCount, history = []) {
  const rich = hasRichSeed(history);
  const build = isBuildLane(history);
  const wantBackBuild = {
    type: 'question',
    id: 'q3',
    question: 'For a build, a clear plan is usually the best first ask. What do you want back?',
    input: 'choice',
    options: [
      'A clear plan',
      'The whole thing written out',
      'Step-by-step help',
      'Paste into a coding AI',
      'A short answer',
    ],
  };
  const wantBackContent = {
    type: 'question',
    id: 'q3',
    question: 'Most people do best with a full draft they can edit. What do you want back?',
    input: 'choice',
    options: ['A full draft', 'A clear plan', 'Step-by-step help', 'A short answer', 'A list'],
  };
  const fallbacks = rich
    ? [
        {
          type: 'question',
          id: 'q2',
          question: 'Who is this for?',
          input: 'choice',
          options: ['Me', 'A friend', 'My class', 'My family', 'Someone else'],
        },
        build ? wantBackBuild : wantBackContent,
        {
          type: 'question',
          id: 'q4',
          question: build
            ? 'For most builds, start with the main job plus one simple screen. What must it include?'
            : 'A clear goal and a simple tone cover most cases. Anything else to lock in?',
          input: 'choice',
          options: build
            ? [
                'Main job + one simple screen',
                'A few screens or steps',
                'Save or remember things',
                'Looks nice and easy',
                'Something else',
              ]
            : [
                'Keep it simple and clear',
                'Make it short',
                'Make it detailed',
                'Keep it fun',
                'Something else',
              ],
        },
      ]
    : build
      ? [
          {
            type: 'question',
            id: 'q1',
            question: 'What are you working on?',
            input: 'choice',
            options: [
              'Writing',
              'Learning',
              'A website or app',
              'A plan',
              'A problem to solve',
              'Something fun',
            ],
          },
          {
            type: 'question',
            id: 'q2',
            question: 'Who will use this?',
            input: 'choice',
            options: ['Just me', 'Friends or family', 'Kids', 'A class', 'Anyone'],
          },
          {
            type: 'question',
            id: 'q3',
            question: 'Most useful builds help someone finish one clear job. What should it help with?',
            input: 'choice',
            options: [
              'Finish one clear job',
              'Learn or practice something',
              'Keep track of things',
              'Have fun or play',
              'Something else',
            ],
          },
          wantBackBuild,
          {
            type: 'question',
            id: 'q5',
            question: 'Start simple: one main screen and the main job. What must it include?',
            input: 'choice',
            options: [
              'One main screen + the main job',
              'A few screens or steps',
              'Accounts or saving progress',
              'Looks polished',
              'Something else',
            ],
          },
        ]
      : [
          {
            type: 'question',
            id: 'q1',
            question: 'What are you working on?',
            input: 'choice',
            options: [
              'Writing',
              'Learning',
              'A website or app',
              'A plan',
              'A problem to solve',
              'Something fun',
            ],
          },
          {
            type: 'question',
            id: 'q2',
            question: 'Who is this for?',
            input: 'choice',
            options: ['Me', 'A friend', 'My class', 'My family', 'Someone else'],
          },
          wantBackContent,
          {
            type: 'question',
            id: 'q4',
            question: 'How should it sound?',
            input: 'choice',
            options: ['Simple and clear', 'Fun and playful', 'Serious', 'Step by step'],
          },
          {
            type: 'question',
            id: 'q5',
            question: 'Best default is simple and clear with no fluff. Want to lock anything else?',
            input: 'choice',
            options: [
              'Keep it simple and clear',
              'Make it short',
              'Make it detailed',
              'Keep it fun',
              'No extra rules',
            ],
          },
        ];
  // First-screen category list allows 6 options (picker), even if later choice questions cap at 5.
  const idx = Math.min(Math.max(turnCount - 1, 0), fallbacks.length - 1);
  return fallbacks[idx];
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const who = cleanGeneratedText(profile.who || '').slice(0, 80);
  const explain = cleanGeneratedText(profile.explain || '').slice(0, 80);
  const about = cleanGeneratedText(profile.about || '').slice(0, 240);
  if (!who && !explain && !about) return null;
  return { who, explain, about };
}

function profileBlock(profile, build = false) {
  const p = normalizeProfile(profile);
  const talk = build
    ? 'How to talk to me: Use plain words when explaining. No unexplained jargon. You may use technical detail and code in the build deliverable. If a hard word is needed while talking to me, explain it in one simple line.'
    : 'How to talk to me: Use plain words. No jargon. No coding talk unless I ask. If a hard word is needed, explain it in one simple line.';
  if (!p) {
    return ['About me: I am a normal non-technical person.', talk];
  }
  const lines = [];
  if (p.who) lines.push(`About me: ${p.who}.`);
  if (p.about) lines.push(`More about me: ${p.about}.`);
  if (!p.who && !p.about) lines.push('About me: I am a normal non-technical person.');
  const explain = p.explain || 'Use plain words';
  if (build) {
    lines.push(
      `How to talk to me: ${explain}. No unexplained jargon. You may use technical detail and code in the build deliverable. If a hard word is needed while talking to me, explain it in one simple line.`
    );
  } else {
    lines.push(
      `How to talk to me: ${explain}. No jargon. No coding or software talk unless I clearly ask for it. If a hard word is needed, explain it in one simple line.`
    );
  }
  return lines;
}

function buildDoneFromHistory(history, profile) {
  const get = (re) => {
    const hit = history.find((h) => re.test(h.question || ''));
    return hit ? cleanGeneratedText(hit.answer) : '';
  };
  const rough = history.find(isRoughIdeaEntry);
  const build = isBuildLane(history);
  const goal = cleanGeneratedText(
    rough?.answer ||
    history[0]?.answer ||
    get(/want|help|trying|goal|do|idea|working on|plan about|help someone do/i) ||
    (build ? 'Help me make this useful thing' : 'Help me get this done well')
  );
  const audience = get(/who|for|audience|age|level|will use/i) || 'me';
  const deliver =
    get(/want back|give you back|look like|format|produce|answer/i) ||
    (build
      ? 'A clear builder brief I can paste into ChatGPT, Claude, or a coding AI'
      : 'A clear, useful result I can use right away');
  const tone = get(/sound|tone|style|length/i) || 'plain and clear';
  const musts = get(/must|don.?t|rules|include|avoid/i);
  const extras = history
    .filter((h) => !isRoughIdeaEntry(h))
    .map((h) => cleanGeneratedText(`${h.question}: ${h.answer}`))
    .filter(Boolean)
    .slice(0, 8);

  const lines = build
    ? [
        'Role: Act as an expert product and builder helper. I am non-technical. Help me get something real made.',
        `Task: ${goal}`,
        `Context: This is for ${audience}. Use the details below. If something important is missing, say what is missing in plain words, then still give your best draft.`,
        ...profileBlock(profile, build),
        `What I am giving you: ${rough ? cleanGeneratedText(rough.answer) : (extras.join(' | ') || 'The answers from our short chat.')}`,
        `What I need back: ${deliver}. Include: product goal, who uses it, what happens first, must-haves, nice-to-haves, look and feel in plain words, and what done looks like.`,
        'Format: Easy to scan. Short sections. Numbered steps when that helps. If code or file structure helps, include it clearly labeled.',
        `Tone: ${tone}. Friendly and direct.`,
        'Quality bar: Be specific. Prefer concrete build detail over vague advice. Do not invent fake personal facts.',
        'Include: Technical detail, structure, and code in the deliverable when that helps build the thing.',
        'Leave out: Filler, talking down to me, and unexplained jargon when you are speaking to me.',
        'How to talk to me: Use plain words when explaining. If a hard word is needed, define it in one simple line.',
        'Process: Restate the goal in one plain sentence. Then deliver the full builder brief. End with a short checklist of what you covered.',
      ]
    : [
        'Role: Act as a careful expert who explains things so a normal non-technical person can use the answer right away.',
        `Task: ${goal}`,
        `Context: This is for ${audience}. Use the details below. If something important is missing, say what is missing in plain words, then still give your best draft.`,
        ...profileBlock(profile, build),
        `What I am giving you: ${rough ? cleanGeneratedText(rough.answer) : (extras.join(' | ') || 'The answers from our short chat.')}`,
        `What I need back: ${deliver}`,
        'Format: Make it easy to scan. Use short sections or numbered steps when that helps. Avoid walls of text.',
        `Tone: ${tone}. Friendly and direct.`,
        'Quality bar: Be specific. Avoid fluff. Prefer concrete details over vague advice. Do not invent fake facts.',
        'Leave out: Jargon, coding talk, software engineering language, and filler. Do not talk down to me.',
        'Process: First restate the goal in one plain sentence. Then deliver the full result. End with a short checklist of what you covered.',
      ];
  if (musts) lines.splice(lines.length - 1, 0, `Include: ${musts}`);
  if (extras.length) {
    lines.push('Extra details from me:');
    extras.forEach((e) => lines.push(`- ${e}`));
  }
  return { type: 'done', prompt: lines.join('\n') };
}

async function callOpenRouter(messages) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:8787',
      'X-Title': 'Clear Words',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.4,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages,
    }),
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err = new Error('openrouter_error');
    err.status = res.status;
    err.code = body?.error?.code || body?.error?.type || `http_${res.status}`;
    throw err;
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) {
    const err = new Error('empty_response');
    err.code = 'empty_response';
    throw err;
  }
  return content;
}

async function nextFromModel(history, forceDone, profile) {
  const turnCount = history.length + 1;
  const rich = hasRichSeed(history);
  const minDone = rich ? MIN_TURNS_WITH_RICH_SEED : MIN_TURNS_BEFORE_DONE;
  const userPayload = {
    turnCount,
    maxTurns: MAX_TURNS,
    forceDone: Boolean(forceDone) || turnCount >= MAX_TURNS,
    minTurnsBeforeDone: minDone,
    hasRichSeed: rich,
    profile: normalizeProfile(profile),
    history,
    instruction: forceDone || turnCount >= MAX_TURNS
      ? 'Return type done with a fully detailed final prompt. Include About me / How to talk to me from the profile. If this is build lane, write a builder brief (website/app/tool) that can go into ChatGPT, Claude, or a coding AI; allow technical detail in the deliverable; keep how you talk to the human plain.'
      : rich
        ? 'They pasted a rough idea. Ask the next guided CHOICE question with a recommended first option, or return done if gaps are filled. Prefer opinionated picks over blank text. If they want a website, app, or tool, use build-lane gaps. Keep questions plain.'
        : 'Ask the next guided CHOICE question with a recommended first option, or return done if you have enough. Be opinionated. Avoid fill-in-the-blank unless a unique name or title is required. If they chose a website or app, use build-lane gaps.',
  };

  const content = await callOpenRouter([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(userPayload) },
  ]);

  let parsed = validateModelPayload(content, turnCount);
  // Guided mode: almost never accept blank fill-ins from the model.
  if (parsed && parsed.type === 'question' && parsed.input === 'text') {
    const textTurns = history.filter((h) => /type |describe |write |say it|in your own|anything that matters/i.test(h.question || '')).length;
    if (textTurns >= 1 || !/name|title|call it|what is it called/i.test(parsed.question || '')) {
      parsed = fallbackQuestion(turnCount, history);
    }
  }
  if (parsed && parsed.type === 'done') {
    // Always ensure profile / non-tech speaking rules are present.
    const ensured = ensureProfileInPrompt(parsed.prompt, profile, isBuildLane(history));
    parsed = { type: 'done', prompt: ensured };
  }
  if (!parsed && (forceDone || turnCount >= MAX_TURNS)) {
    return buildDoneFromHistory(history, profile);
  }
  if (!parsed) {
    parsed = fallbackQuestion(turnCount, history);
  }
  if (
    parsed.type === 'done' &&
    history.length < minDone &&
    !forceDone &&
    turnCount < MAX_TURNS
  ) {
    parsed = fallbackQuestion(turnCount, history);
  }
  if (parsed.type === 'question' && turnCount >= MAX_TURNS) {
    return buildDoneFromHistory(history, profile);
  }
  return parsed;
}

function ensureProfileInPrompt(prompt, profile, build = false) {
  let out = cleanGeneratedText(prompt);
  const block = profileBlock(profile, build).join('\n');
  if (!/about me:/i.test(out) || !/how to talk to me:/i.test(out)) {
    out = out + '\n\n' + block;
  } else if (!/no jargon|plain words|build deliverable/i.test(out)) {
    out +=
      '\n' +
      (build
        ? 'How to talk to me: Use plain words when explaining. Technical detail and code are OK in the build deliverable.'
        : 'How to talk to me: Use plain words. No jargon. No coding talk unless I ask.');
  }
  // collapse accidental duplicate how-to-talk lines
  out = out.replace(/(How to talk to me:[^\n]*\n)(?:How to talk to me:[^\n]*\n?)+/gi, '$1');
  return cleanGeneratedText(out).slice(0, 9000);
}

app.post('/api/session/start', async (_req, res) => {
  try {
    // Fallback only - primary UX uses a local first screen, then /api/session/answer.
    const payload = await nextFromModel([], false);
    res.json(payload);
  } catch (err) {
    console.error('start failed:', err.code || err.message);
    res.json(fallbackQuestion(1, []));
  }
});

app.post('/api/session/answer', async (req, res) => {
  try {
    const history = normalizeHistory(req.body?.history);
    const profile = normalizeProfile(req.body?.profile);
    const latest = req.body?.latest;
    if (latest && (latest.question || latest.answer)) {
      history.push({
        id: String(latest.id || `q${history.length + 1}`).slice(0, 40),
        question: String(latest.question || '').slice(0, QUESTION_MAX),
        answer: String(latest.answer || '').slice(0, ANSWER_MAX),
      });
    }
    if (!history.length) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Add an answer to keep going.',
      });
    }
    const forceDone = history.length >= MAX_TURNS;
    const payload = await nextFromModel(history, forceDone, profile);
    res.json(payload);
  } catch (err) {
    console.error('answer failed:', err.code || err.message);
    res.status(502).json({
      error: 'thinking_failed',
      message: 'That didn’t work. Try again.',
      code: err.code || 'unknown',
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: OPENROUTER_MODEL });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Clear Words listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
