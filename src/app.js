import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { db } from './db.js';
import { reinforceFromText, stats } from './srs.js';
import { openingTurn, nextTurn } from './tutor.js';
import { coachAnswer } from './coach.js';
import {
  createConversation, conversationExists, addMessage, getMessages, getHistory, listConversations,
  setMessageNote, addCoachMessage, getCoachMessages, getConversationContext, getConversationPersona,
} from './conversations.js';
import { pickPersona } from './personas.js';
import { llmAvailable, llmStatus } from './llm.js';
import { synthesize, issueToken, ttsAvailable } from './tts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('view engine', 'pug');
app.set('views', join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, '..', 'public')));

function fmtDate(ms) {
  return new Date(ms).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

app.get('/', (req, res) => {
  res.render('index', {
    stats: stats(),
    status: { llm: llmAvailable, voice: ttsAvailable },
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

// --- Conversations ---------------------------------------------------------
app.get('/conversations', (req, res) => {
  const convos = listConversations().map((c) => ({ ...c, when: fmtDate(c.updated_at) }));
  res.render('conversations', { convos });
});

// Reopen a saved conversation to read and continue it.
app.get('/conversation/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!conversationExists(id)) return res.redirect('/conversations');
  res.render('session', {
    cid: id,
    messages: getMessages(id),
    coachMessages: getCoachMessages(id),
    context: getConversationContext(id),
    persona: getConversationPersona(id),
    bodyClass: 'wide',
  });
});

app.post('/conversation/start', async (req, res) => {
  const context = (req.body.context || '').toString().trim().slice(0, 1000);
  const persona = pickPersona();
  const cid = createConversation(context, persona);
  try {
    const turn = await openingTurn(persona, context);
    addMessage(cid, 'tutor', { nl: turn.nl, en: turn.en, gloss: turn.glossary });
  } catch (err) {
    console.error('[start]', err.message); // land on the page anyway; it'll surface on first reply
  }
  // Redirect the browser to the conversation's own URL.
  res.set('HX-Redirect', `/conversation/${cid}`);
  res.end();
});

app.post('/conversation/:id/reply', async (req, res) => {
  const cid = Number(req.params.id);
  if (!conversationExists(cid)) return res.status(404).render('partials/bubble-error', { message: 'Conversation not found.' });
  const learner = (req.body.heard || '').trim();
  let learnerMsgId = null;
  if (learner) {
    learnerMsgId = addMessage(cid, 'learner', { nl: learner });
    reinforceFromText(learner);
  }
  const persona = getConversationPersona(cid);
  try {
    const turn = await nextTurn(getHistory(cid), learner, persona, getConversationContext(cid));
    // The correction is about what the learner said -> store it on their message.
    if (learnerMsgId && (turn.mistakes.length || turn.fixed)) {
      setMessageNote(learnerMsgId, JSON.stringify({ mistakes: turn.mistakes, fixed: turn.fixed }));
    }
    addMessage(cid, 'tutor', { nl: turn.nl, en: turn.en, gloss: turn.glossary });
    res.render('partials/bubble-tutor', { turn, tutorName: persona.name });
  } catch (err) {
    res.status(200).render('partials/bubble-error', { message: err.message });
  }
});

// Side coach: answer an English help question, with the conversation as context.
app.post('/coach', async (req, res) => {
  const question = (req.body.q || '').trim();
  const cid = Number(req.body.cid) || null;
  if (!question) return res.status(400).end();
  const valid = cid && conversationExists(cid);
  const history = valid ? getHistory(cid) : [];
  const tutorName = valid ? getConversationPersona(cid).name : 'the tutor';
  try {
    const out = await coachAnswer(question, history, tutorName);
    if (valid) addCoachMessage(cid, { question, answer: out.answer, examples: out.examples });
    res.render('partials/coach-answer', { question, ...out });
  } catch (err) {
    res.render('partials/coach-answer', { question, answer: 'Helper error: ' + err.message, examples: [] });
  }
});

// --- Voice -----------------------------------------------------------------
app.get('/tts', async (req, res) => {
  const text = (req.query.text || '').toString().slice(0, 500);
  if (!text) return res.status(400).send('missing text');
  const voice = (req.query.voice || '').toString();
  try {
    const mp3 = await synthesize(text, voice);
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
  console.log(`Praatmaatje on http://localhost:${PORT}`);
  console.log(`  LLM:  ${llmStatus()}`);
  console.log(`  Voice: ${ttsAvailable ? 'Azure Speech (TTS + STT)' : 'NOT configured'}`);
});
