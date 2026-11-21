// A small cast of Dutch conversation partners, so each new chat feels like a
// different person. For now a persona is just a NAME, a voice (so male/female
// chats sound right), and a very brief manner of speech — deliberately NO
// backstory or hobbies, so it never conflicts with the scenario. WHO they are in
// a conversation (their role) comes from the learner's setup. One is picked at
// random when a conversation starts and kept for its whole life.

export const PERSONAS = [
  { name: 'Saar',  gender: 'woman', voice: 'nl-NL-FennaNeural',   manner: 'warm and chatty' },
  { name: 'Lotte', gender: 'woman', voice: 'nl-NL-ColetteNeural', manner: 'relaxed and easy-going' },
  { name: 'Femke', gender: 'woman', voice: 'nl-NL-FennaNeural',   manner: 'curious and upbeat' },
  { name: 'Anouk', gender: 'woman', voice: 'nl-NL-ColetteNeural', manner: 'friendly and direct' },
  { name: 'Daan',  gender: 'man',   voice: 'nl-NL-MaartenNeural', manner: 'laid-back and cheerful' },
  { name: 'Bram',  gender: 'man',   voice: 'nl-NL-MaartenNeural', manner: 'calm and friendly' },
  { name: 'Joris', gender: 'man',   voice: 'nl-NL-MaartenNeural', manner: 'gentle and thoughtful' },
  { name: 'Sven',  gender: 'man',   voice: 'nl-NL-MaartenNeural', manner: 'easy-going and to the point' },
];

// Saar stays the default/fallback (e.g. for conversations created before personas existed).
export const DEFAULT_PERSONA = PERSONAS[0];

// Every voice the app is allowed to ask Azure for (used to validate the /tts voice param).
export const VOICES = new Set(PERSONAS.map((p) => p.voice));

export function pickPersona() {
  return PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
}
