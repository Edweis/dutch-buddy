// The tutor: runs a flowing Dutch conversation tuned to the learner's level.
// Each turn is short and simple, reuses words the learner knows, and introduces
// at most a couple of new words. Returns structured data so the app can show the
// Dutch + English, speak it, and feed the spaced-repetition engine underneath.

import { chatJSON } from './llm.js';

const SYSTEM = `You are "Buddy", a warm, patient Dutch conversation tutor.
Your student is an English speaker learning Dutch from scratch.

Rules for EVERY reply:
- Speak in Dutch, but keep it VERY short and simple: 1-2 short sentences.
- Reuse words the student already knows (given below). Prefer high-frequency words.
- Introduce AT MOST 2 new Dutch words per turn, and only when natural.
- Always finish with a simple question so the conversation keeps going.
- Be encouraging. If the student made a mistake, gently model the correct version
  in your Dutch reply and explain briefly in the English "note".
- Never switch the conversation to English; English only appears in "en" and "note".

Return ONLY a JSON object:
{
  "nl": "<your Dutch turn>",
  "en": "<natural English translation of nl>",
  "note": "<optional short English coaching tip about the student's last message, or empty>",
  "new_words": [{"nl": "<word>", "en": "<english>"}]   // words you introduced this turn, may be empty
}`;

function knownLine(known) {
  if (!known.length) return 'The student knows almost no Dutch yet. Start from the very beginning.';
  return 'Words the student already knows: ' + known.map((w) => w.nl).join(', ') + '.';
}

function historyLines(history) {
  // Last several turns, oldest first, as plain context.
  return history.slice(-10).map((t) => `${t.role === 'tutor' ? 'Buddy' : 'Student'}: ${t.nl}`).join('\n');
}

export async function openingTurn(known) {
  const messages = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `${knownLine(known)}\n\n` +
        `Start the conversation: greet the student in Dutch and ask one very simple question. ` +
        `Introduce yourself as Buddy if natural.`,
    },
  ];
  return normalize(await chatJSON(messages));
}

export async function nextTurn(history, learnerText, known) {
  const messages = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `${knownLine(known)}\n\n` +
        `Conversation so far:\n${historyLines(history)}\n\n` +
        `The student just said (Dutch, via speech-to-text, may contain errors):\n"${learnerText}"\n\n` +
        `Reply with your next short Dutch turn.`,
    },
  ];
  return normalize(await chatJSON(messages));
}

function normalize(out) {
  return {
    nl: String(out?.nl || '').trim(),
    en: String(out?.en || '').trim(),
    note: String(out?.note || '').trim(),
    new_words: Array.isArray(out?.new_words)
      ? out.new_words
          .filter((w) => w && w.nl)
          .map((w) => ({ nl: String(w.nl).trim().toLowerCase(), en: String(w.en || '').trim() }))
      : [],
  };
}
