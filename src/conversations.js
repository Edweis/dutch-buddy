// Persistence for conversations so they can be listed, reopened, and continued.
import { db } from './db.js';

const insertConvo = db.prepare('INSERT INTO conversations (created_at, updated_at) VALUES (?, ?)');
const touchConvo = db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?');
const insertMessage = db.prepare(`
  INSERT INTO messages (conversation_id, role, nl, en, note, gloss, created_at)
  VALUES (@conversation_id, @role, @nl, @en, @note, @gloss, @created_at)
`);
const selectMessages = db.prepare('SELECT role, nl, en, note, gloss FROM messages WHERE conversation_id = ? ORDER BY id ASC');
const convoExists = db.prepare('SELECT 1 FROM conversations WHERE id = ?');

export function createConversation() {
  const now = Date.now();
  return insertConvo.run(now, now).lastInsertRowid;
}

export function conversationExists(id) {
  return Boolean(convoExists.get(id));
}

const updateMsgNote = db.prepare('UPDATE messages SET note = ? WHERE id = ?');

export function addMessage(conversationId, role, { nl, en = '', note = '', gloss = null }) {
  const now = Date.now();
  const id = insertMessage.run({
    conversation_id: conversationId, role, nl, en, note,
    gloss: gloss && gloss.length ? JSON.stringify(gloss) : null,
    created_at: now,
  }).lastInsertRowid;
  touchConvo.run(now, conversationId);
  return id;
}

// Attach a correction to a message (used to put Saar's correction under the learner's line).
export function setMessageNote(id, note) {
  updateMsgNote.run(note, id);
}

function parseCorrection(note) {
  if (!note) return null;
  try {
    const c = JSON.parse(note);
    if (c && (c.mistakes || c.fixed)) return { mistakes: c.mistakes || [], fixed: c.fixed || '' };
  } catch (_) {
    return { mistakes: [note], fixed: '' }; // legacy plain-string correction
  }
  return null;
}

function parseGloss(gloss) {
  if (!gloss) return [];
  try { const a = JSON.parse(gloss); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

export function getMessages(conversationId) {
  return selectMessages.all(conversationId).map((m) => ({
    role: m.role, nl: m.nl, en: m.en,
    correction: parseCorrection(m.note),
    glossary: parseGloss(m.gloss),
  }));
}

// Conversation history in the shape the tutor expects: [{role, nl}].
export function getHistory(conversationId) {
  return getMessages(conversationId).map((m) => ({ role: m.role, nl: m.nl }));
}

const insertCoach = db.prepare(`
  INSERT INTO coach_messages (conversation_id, question, answer, examples, created_at)
  VALUES (@conversation_id, @question, @answer, @examples, @created_at)
`);
const selectCoach = db.prepare('SELECT question, answer, examples FROM coach_messages WHERE conversation_id = ? ORDER BY id ASC');

export function addCoachMessage(conversationId, { question, answer, examples }) {
  insertCoach.run({
    conversation_id: conversationId,
    question,
    answer,
    examples: JSON.stringify(examples || []),
    created_at: Date.now(),
  });
}

export function getCoachMessages(conversationId) {
  return selectCoach.all(conversationId).map((r) => ({
    question: r.question,
    answer: r.answer,
    examples: r.examples ? JSON.parse(r.examples) : [],
  }));
}

// List real conversations (those with at least one learner reply), newest first,
// with a short preview and message count for the list page.
export function listConversations() {
  return db.prepare(`
    SELECT c.id, c.created_at, c.updated_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS turns,
      (SELECT nl FROM messages m WHERE m.conversation_id = c.id AND m.role = 'learner' ORDER BY m.id ASC LIMIT 1) AS preview
    FROM conversations c
    WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'learner')
    ORDER BY c.updated_at DESC
  `).all();
}
