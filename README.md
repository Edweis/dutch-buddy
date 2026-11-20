# 🧡 Dutch Buddy

A conversational Dutch tutor. **Buddy** holds a real, flowing conversation in simple
Dutch — it speaks (Azure neural voice) while you read along, and you answer out loud
(transcribed by Whisper). Underneath, an Anki-style engine quietly tracks every word:
the ones you actually use get reinforced, and Buddy introduces new words gradually so
you start from zero and build up.

## Stack
- **Express** + **Pug** + **htmx** — server-rendered, minimal JS
- **SQLite** (`better-sqlite3`) — vocabulary + spaced-repetition state
- **LLM brain** — OpenRouter, with automatic fallback to OpenAI (either works)
- **Azure Speech** — the Dutch voice (TTS), with a 🐢 slow mode for new words
- **OpenAI Whisper** — speech-to-text for your spoken replies
- **Docker** — containerized with a volume for the SQLite data

## Run locally
```bash
npm install
cp .env.example .env     # fill in your keys
npm run dev              # http://localhost:3000
```
Use **Chrome** and allow the microphone.

## Run in Docker
```bash
cp .env.example .env     # fill in your keys
docker compose up --build
# http://localhost:3000  (SQLite persists in ./data)
```

## Environment (`.env`)
| Var | Purpose |
|---|---|
| `OPEN_ROUTER_API_KEY` | LLM brain (tried first). `OPEN_ROUTER_MODEL` sets the model. |
| `OPENAI_API_KEY` | Whisper STT, **and** LLM fallback if OpenRouter is down/out of credit. |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | Dutch voice. `AZURE_SPEECH_VOICE` picks the voice (default `nl-NL-ColetteNeural`; Flemish e.g. `nl-BE-ArnaudNeural`). |
| `WHISPER_MODEL` | defaults to `whisper-1`. |

The conversation needs **one** LLM key. Voice needs Azure (speaking) + OpenAI (listening).
Any missing piece is reported on the home page; the rest still runs.

## How it works
- `src/tutor.js` — runs the conversation: short, level-appropriate Dutch turns that
  reuse known words and introduce ≤2 new ones, always ending with a question.
- `src/srs.js` — SM-2-style scheduling. `reinforceFromText()` reinforces every known
  word you actually say; `introduceWord()` adds tutor-introduced words to your deck.
- `src/llm.js` — OpenRouter → OpenAI fallback (JSON mode).
- `src/tts.js` — Azure Speech (SSML, slow mode). `src/stt.js` — OpenAI Whisper.
- `src/app.js` — routes: `/conversation/start`, `/conversation/reply`, `/tts`, `/stt`.
- `public/js/app.js` — plays Buddy's audio, records the mic, runs the turn loop.

## Notes
- `src/words-seed.js` seeds ~190 common words to bootstrap "start from zero"; the deck
  grows automatically as Buddy introduces new words. Upserts on boot, no migrations.
