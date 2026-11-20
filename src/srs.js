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

// --- Usage tracking (decoupled from the conversation) ----------------------
// This only powers the Progress page; it never influences what Saar says.
const allWords = db.prepare('SELECT id, nl FROM words');

function strip(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// For every seed word the learner actually said, make sure it has a card and
// reinforce it. The Progress page thus reflects the words you use, not any
// vocabulary fed to the tutor.
export function reinforceFromText(text) {
  const norm = strip(text);
  if (!norm) return [];
  const tokens = new Set(norm.split(' '));
  const reinforced = [];
  for (const w of allWords.all()) {
    const key = strip(w.nl);
    if (!key) continue;
    const hit = key.includes(' ') ? norm.includes(key) : tokens.has(key);
    if (hit) {
      reinforce(w.id, text); // creates the card if missing, then advances it
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
