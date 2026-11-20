import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { WORDS } from './words-seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, 'dutch-buddy.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id        INTEGER PRIMARY KEY,
    nl        TEXT NOT NULL UNIQUE,
    en        TEXT NOT NULL,
    pos       TEXT,
    rank      INTEGER NOT NULL
  );

  -- One SRS row per word, created when the word is first introduced.
  CREATE TABLE IF NOT EXISTS cards (
    word_id       INTEGER PRIMARY KEY REFERENCES words(id),
    status        TEXT NOT NULL DEFAULT 'new',   -- new | learning | known | mature
    ease          REAL NOT NULL DEFAULT 2.5,
    interval_days REAL NOT NULL DEFAULT 0,
    reps          INTEGER NOT NULL DEFAULT 0,
    lapses        INTEGER NOT NULL DEFAULT 0,
    due_at        INTEGER NOT NULL DEFAULT 0,     -- epoch ms
    introduced_at INTEGER NOT NULL DEFAULT 0,
    last_seen_at  INTEGER NOT NULL DEFAULT 0
  );

  -- Append-only log of every review, useful for stats and future FSRS tuning.
  CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id    INTEGER NOT NULL REFERENCES words(id),
    grade      INTEGER NOT NULL,                  -- 0 again, 1 hard, 2 good, 3 easy
    item_type  TEXT,                              -- 'conversation' (words reinforced from the learner's speech)
    heard      TEXT,                              -- transcript of what the learner said
    created_at INTEGER NOT NULL
  );
`);

// Seed / upsert the word list. Safe to run on every boot.
const upsertWord = db.prepare(`
  INSERT INTO words (nl, en, pos, rank) VALUES (@nl, @en, @pos, @rank)
  ON CONFLICT(nl) DO UPDATE SET en = @en, pos = @pos, rank = @rank
`);
const seedWords = db.transaction((words) => {
  for (const w of words) upsertWord.run(w);
});
seedWords(WORDS);

export function wordCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM words').get().n;
}
