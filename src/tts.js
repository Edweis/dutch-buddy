// Azure Speech text-to-speech. Returns MP3 audio bytes for Dutch text.

const KEY = process.env.AZURE_SPEECH_KEY?.trim();
const REGION = process.env.AZURE_SPEECH_REGION?.trim() || 'westeurope';
const VOICE = process.env.AZURE_SPEECH_VOICE?.trim() || 'nl-NL-ColetteNeural';

export const ttsAvailable = Boolean(KEY);

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function ssml(text) {
  const lang = VOICE.slice(0, 5); // e.g. nl-NL
  return `<speak version="1.0" xml:lang="${lang}"><voice name="${VOICE}">${escapeXml(text)}</voice></speak>`;
}

// Exchange the subscription key for a short-lived (10 min) auth token so the
// browser Speech SDK can do recognition without ever seeing the key.
// Cached for 8 min and retried on transient network failures, so a blip reaching
// Azure doesn't surface as "Mic setup failed".
let cachedToken = null;
let cachedAt = 0;

async function fetchAzureToken() {
  const res = await fetch(`https://${REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': KEY, 'Content-Length': '0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Azure token ${res.status}: ${await res.text()}`);
  return res.text();
}

export async function issueToken() {
  if (!KEY) throw new Error('AZURE_SPEECH_KEY not set');
  if (cachedToken && Date.now() - cachedAt < 8 * 60 * 1000) {
    return { token: cachedToken, region: REGION };
  }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      cachedToken = await fetchAzureToken();
      cachedAt = Date.now();
      return { token: cachedToken, region: REGION };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function synthesize(text) {
  if (!KEY) throw new Error('AZURE_SPEECH_KEY not set');
  const url = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': 'application/ssml+xml',
      // Higher-fidelity 48 kHz / 192 kbps audio for a clearer, more natural voice.
      'X-Microsoft-OutputFormat': 'audio-48khz-192kbitrate-mono-mp3',
      'User-Agent': 'dutch-buddy',
    },
    body: ssml(text),
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
