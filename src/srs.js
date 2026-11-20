import { db } from './db.js';

const DAY = 24 * 60 * 60 * 1000;

const getCard = db.prepare('SELECT * FROM cards WHERE word_id = ?');
const insertCard = db.prepare(`
  INSERT INTO cards (word_id, status, introduced_at, due_at, last_seen_at)
  VALUES (?, 'new', ?, ?, ?)
`);
const updateCard = db.prepare(`
  UPDATE cards SET status=@status, ease=@ease, interval_days=@interval_days,
    reps=@reps, lapses=@lapses, due_at=@due_at, last_seen_at=@last_seen_at
  WHERE word_id=@word_id
`);
const logReview = db.prepare(`
  INSERT INTO reviews (word_id, grade, item_type, heard, created_at)
  VALUES (@word_id, @grade, @item_type, @heard, @created_at)
`);

// Record one successful recall ("good") and push the word's next due date out.
// A compact SM-2 "good" progression: a couple of short steps, then interval * ease.
function reinforce(wordId, heard) {
  const now = Date.now();
  let card = getCard.get(wordId);
  if (!card) {
    insertCard.run(wordId, now, now, now);
    card = getCard.get(wordId);
  }
  let { ease, interval_days, reps, lapses, status } = card;
  reps += 1;
  if (reps === 1) { interval_days = 10 / (24 * 60); status = 'learning'; } // ~10 min
  else if (reps === 2) { interval_days = 3; status = 'known'; }
  else {
    interval_days = Math.max(1, interval_days) * ease;
    status = interval_days >= 21 ? 'mature' : 'known';
  }
  updateCard.run({
    word_id: wordId, ease, interval_days, reps, lapses,
    status, due_at: now + interval_days * DAY, last_seen_at: now,
  });
  logReview.run({ word_id: wordId, grade: 2, item_type: 'conversation', heard: heard ?? null, created_at: now });
}

// Everything the learner has been introduced to, for building sentences.
export function knownWords() {
  return db.prepare(`
    SELECT w.nl, w.en, w.pos, c.status
    FROM cards c JOIN words w ON w.id = c.word_id
    ORDER BY w.rank ASC
  `).all();
}

// --- Conversation-driven vocabulary ----------------------------------------
const findWordByNl = db.prepare('SELECT * FROM words WHERE nl = ?');
const maxRank = db.prepare('SELECT COALESCE(MAX(rank), 0) AS m FROM words');
const insertWordStmt = db.prepare('INSERT INTO words (nl, en, pos, rank) VALUES (?, ?, ?, ?)');

function strip(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Insert a word the tutor introduced if we don't have it yet (grows vocab
// beyond the seed list), then make sure it has a card.
export function introduceWord(nl, en) {
  const clean = (nl || '').trim();
  if (!clean) return null;
  let w = findWordByNl.get(clean);
  if (!w) {
    insertWordStmt.run(clean, en || '', 'tutor', maxRank.get().m + 1);
    w = findWordByNl.get(clean);
  }
  const hasCard = db.prepare('SELECT 1 FROM cards WHERE word_id = ?').get(w.id);
  if (!hasCard) {
    const now = Date.now();
    insertCard.run(w.id, now, now, now);
  }
  return w;
}

// Reinforce every already-introduced word the learner actually produced.
// This is what makes the conversation drive spaced repetition.
export function reinforceFromText(text) {
  const norm = strip(text);
  if (!norm) return [];
  const tokens = new Set(norm.split(' '));
  const introduced = db.prepare(
    'SELECT w.id, w.nl FROM cards c JOIN words w ON w.id = c.word_id'
  ).all();
  const reinforced = [];
  for (const w of introduced) {
    const key = strip(w.nl);
    if (!key) continue;
    const hit = key.includes(' ') ? norm.includes(key) : tokens.has(key);
    if (hit) {
      reinforce(w.id, text);
      reinforced.push(w.nl);
    }
  }
  return reinforced;
}

export function stats() {
  return db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM cards) AS introduced,
      (SELECT COUNT(*) FROM cards WHERE status IN ('known','mature')) AS known,
      (SELECT COUNT(*) FROM cards WHERE status = 'mature') AS mature,
      (SELECT COUNT(*) FROM cards WHERE due_at <= ?) AS due
  `).get(Date.now());
}
