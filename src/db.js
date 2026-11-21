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

  -- Saved conversations so they can be revisited and continued.
  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    context    TEXT,                             -- optional English setup: scenario + vocab focus
    persona    TEXT                              -- JSON {name, gender, voice, bio} for this chat
  );
  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    role            TEXT NOT NULL,                -- 'tutor' | 'learner'
    nl              TEXT NOT NULL,
    en              TEXT,
    note            TEXT,                          -- learner: JSON correction {mistakes, fixed}
    gloss           TEXT,                          -- tutor: JSON [{nl, en}] of new words this turn
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id, id);

  -- Saved side-coach Q&A, tied to a conversation.
  CREATE TABLE IF NOT EXISTS coach_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL,
    examples        TEXT,                          -- JSON array of {nl, en}
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_coach_convo ON coach_messages(conversation_id, id);
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

// Migration: add messages.gloss for databases created before it existed.
const msgCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
if (!msgCols.includes('gloss')) db.exec('ALTER TABLE messages ADD COLUMN gloss TEXT');

// Migration: add conversations.context / .persona for databases created before they existed.
const convoCols = db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
if (!convoCols.includes('context')) db.exec('ALTER TABLE conversations ADD COLUMN context TEXT');
if (!convoCols.includes('persona')) db.exec('ALTER TABLE conversations ADD COLUMN persona TEXT');
