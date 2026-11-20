import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { db } from './db.js';
import { knownWords, introduceWord, reinforceFromText, stats } from './srs.js';
import { openingTurn, nextTurn } from './tutor.js';
import { llmAvailable, llmStatus } from './llm.js';
import { synthesize, issueToken, ttsAvailable, DUTCH_VOICES, defaultVoice } from './tts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('view engine', 'pug');
app.set('views', join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, '..', 'public')));

// Single-user local app: one in-memory conversation is enough.
let convo = null; // { history: [{role:'tutor'|'learner', nl}] }

function applyNewWords(turn) {
  for (const w of turn.new_words || []) introduceWord(w.nl, w.en);
}

app.get('/', (req, res) => {
  res.render('index', {
    stats: stats(),
    status: { llm: llmAvailable, voice: ttsAvailable },
  });
});

app.get('/voices', (req, res) => {
  res.render('voices', {
    voices: DUTCH_VOICES,
    defaultVoice,
    available: ttsAvailable,
    sample: 'Hallo! Ik ben Buddy, jouw Nederlandse taalmaatje. Zullen we samen beginnen?',
  });
});

app.get('/progress', (req, res) => {
  const words = db.prepare(`
    SELECT w.nl, w.en, w.rank, c.status, c.reps, c.lapses
    FROM cards c JOIN words w ON w.id = c.word_id
    ORDER BY c.last_seen_at DESC
  `).all();
  res.render('progress', { stats: stats(), words });
});

// --- Conversation ----------------------------------------------------------
app.post('/conversation/start', async (req, res) => {
  convo = { history: [] };
  try {
    const turn = await openingTurn(knownWords());
    applyNewWords(turn);
    convo.history.push({ role: 'tutor', nl: turn.nl });
    res.render('session', { turn });
  } catch (err) {
    res.render('session', { error: err.message });
  }
});

app.post('/conversation/reply', async (req, res) => {
  if (!convo) convo = { history: [] };
  const learner = (req.body.heard || '').trim();
  if (learner) {
    convo.history.push({ role: 'learner', nl: learner });
    reinforceFromText(learner);
  }
  try {
    const turn = await nextTurn(convo.history, learner, knownWords());
    applyNewWords(turn);
    convo.history.push({ role: 'tutor', nl: turn.nl });
    res.render('partials/bubble-tutor', { turn });
  } catch (err) {
    res.status(200).render('partials/bubble-error', { message: err.message });
  }
});

// --- Voice -----------------------------------------------------------------
app.get('/tts', async (req, res) => {
  const text = (req.query.text || '').toString().slice(0, 500);
  const rate = (req.query.rate || 'default').toString();
  const voice = (req.query.voice || '').toString();
  if (!text) return res.status(400).send('missing text');
  try {
    const mp3 = await synthesize(text, { rate, voice });
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(mp3);
  } catch (err) {
    console.error('[tts]', err.message);
    res.status(502).send('tts failed');
  }
});

// Short-lived token so the browser Speech SDK can recognize speech directly.
app.get('/speech-token', async (req, res) => {
  try {
    res.json(await issueToken());
  } catch (err) {
    console.error('[stt]', err.message);
    res.status(502).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dutch Buddy on http://localhost:${PORT}`);
  console.log(`  LLM:  ${llmStatus()}`);
  console.log(`  Voice: ${ttsAvailable ? 'Azure Speech (TTS + STT)' : 'NOT configured'}`);
});
