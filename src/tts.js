// Azure Speech text-to-speech. Returns MP3 audio bytes for Dutch text.
// Supports a "slow" rate so new words can be spoken clearly for learners.

const KEY = process.env.AZURE_SPEECH_KEY?.trim();
const REGION = process.env.AZURE_SPEECH_REGION?.trim() || 'westeurope';
const VOICE = process.env.AZURE_SPEECH_VOICE?.trim() || 'nl-NL-ColetteNeural';

export const ttsAvailable = Boolean(KEY);

// The native Dutch neural voices Azure offers (Netherlands + Flemish Belgium).
export const DUTCH_VOICES = [
  { id: 'nl-NL-ColetteNeural', name: 'Colette', gender: 'Female', locale: 'Netherlands' },
  { id: 'nl-NL-FennaNeural', name: 'Fenna', gender: 'Female', locale: 'Netherlands' },
  { id: 'nl-NL-MaartenNeural', name: 'Maarten', gender: 'Male', locale: 'Netherlands' },
  { id: 'nl-BE-DenaNeural', name: 'Dena', gender: 'Female', locale: 'Belgium (Flemish)' },
  { id: 'nl-BE-ArnaudNeural', name: 'Arnaud', gender: 'Male', locale: 'Belgium (Flemish)' },
];
const VOICE_IDS = new Set(DUTCH_VOICES.map((v) => v.id));
export const defaultVoice = VOICE_IDS.has(VOICE) ? VOICE : 'nl-NL-ColetteNeural';

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function ssml(text, rate, voice) {
  const lang = voice.slice(0, 5); // e.g. nl-NL
  const prosody = rate && rate !== 'default'
    ? `<prosody rate="${rate === 'slow' ? '-25%' : escapeXml(rate)}">${escapeXml(text)}</prosody>`
    : escapeXml(text);
  return `<speak version="1.0" xml:lang="${lang}"><voice name="${voice}">${prosody}</voice></speak>`;
}

// Exchange the subscription key for a short-lived (10 min) auth token so the
// browser Speech SDK can do recognition without ever seeing the key.
export async function issueToken() {
  if (!KEY) throw new Error('AZURE_SPEECH_KEY not set');
  const res = await fetch(`https://${REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': KEY, 'Content-Length': '0' },
  });
  if (!res.ok) throw new Error(`Azure token ${res.status}: ${await res.text()}`);
  return { token: await res.text(), region: REGION };
}

export async function synthesize(text, { rate = 'default', voice } = {}) {
  if (!KEY) throw new Error('AZURE_SPEECH_KEY not set');
  const chosen = VOICE_IDS.has(voice) ? voice : defaultVoice;
  const url = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'dutch-buddy',
    },
    body: ssml(text, rate, chosen),
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
