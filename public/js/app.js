// Dutch Buddy — conversation client.
// Plays Buddy's Dutch via Azure TTS (/tts), recognizes your spoken reply with the
// Azure Speech SDK (token from /speech-token), and posts it back for the next turn.

(function () {
  let currentAudio = null;

  function playTTS(text, rate) {
    if (!text) return;
    try {
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      const url = `/tts?text=${encodeURIComponent(text)}&rate=${rate || 'default'}`;
      const audio = new Audio(url);
      currentAudio = audio;
      audio.play().catch(() => {}); // autoplay may be blocked until first interaction
    } catch (_) {}
  }

  function scrollChat() {
    const chat = document.getElementById('chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function addLearnerBubble(text) {
    const chat = document.getElementById('chat');
    if (!chat) return;
    chat.insertAdjacentHTML(
      'beforeend',
      `<div class="bubble learner"><div class="who">🙋 You</div><p class="nl">${esc(text)}</p></div>`
    );
    scrollChat();
  }

  function speakLatestTutor() {
    const bubbles = document.querySelectorAll('#chat .bubble.tutor');
    const last = bubbles[bubbles.length - 1];
    if (last) playTTS(last.getAttribute('data-nl'));
  }

  // Send the learner's text, append Buddy's reply, speak it.
  async function sendReply(text) {
    const composer = document.getElementById('composer');
    if (composer) composer.classList.add('busy');
    try {
      const res = await fetch('/conversation/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'heard=' + encodeURIComponent(text),
      });
      const html = await res.text();
      const chat = document.getElementById('chat');
      chat.insertAdjacentHTML('beforeend', html);
      scrollChat();
      speakLatestTutor();
    } catch (err) {
      const chat = document.getElementById('chat');
      chat.insertAdjacentHTML('beforeend', `<div class="bubble error"><p class="err">${esc(err.message)}</p></div>`);
    } finally {
      if (composer) composer.classList.remove('busy');
    }
  }

  // ---- Speech recognition via the Azure Speech SDK ------------------------
  // Continuous recognition: you start it, keep talking as long as you like, and
  // it only stops when you tap again. Final segments accumulate in `finals`.
  let recognizer = null;
  let recognizing = false;
  let finals = [];

  async function getSpeechConfig() {
    const res = await fetch('/speech-token');
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'token failed');
    const cfg = SpeechSDK.SpeechConfig.fromAuthorizationToken(data.token, data.region);
    cfg.speechRecognitionLanguage = 'nl-NL';
    return cfg;
  }

  function resetMicButton(btn) {
    recognizing = false;
    btn.classList.remove('listening');
    btn.textContent = '🎙️ Tap to speak';
    btn.disabled = false;
  }

  // Called when the user taps "stop": tear down the recognizer and send what
  // was heard. Does nothing with the audio after this point.
  function finishRecording(btn, transcriptEl) {
    btn.disabled = true;
    const done = () => {
      if (recognizer) { recognizer.close(); recognizer = null; }
      resetMicButton(btn);
      const text = finals.join(' ').replace(/\s+/g, ' ').trim();
      if (!text) { transcriptEl.textContent = '(nothing heard — try again)'; return; }
      transcriptEl.textContent = '';
      addLearnerBubble(text);
      sendReply(text);
    };
    if (recognizer) recognizer.stopContinuousRecognitionAsync(done, done);
    else done();
  }

  async function toggleRecording(btn, transcriptEl) {
    if (recognizing) { finishRecording(btn, transcriptEl); return; }
    if (!window.SpeechSDK) {
      transcriptEl.textContent = 'Speech SDK not loaded — check your connection.';
      return;
    }
    let cfg;
    try {
      cfg = await getSpeechConfig();
    } catch (err) {
      transcriptEl.textContent = 'Mic setup failed: ' + err.message;
      return;
    }
    finals = [];
    recognizing = true;
    btn.classList.add('listening');
    btn.textContent = '● Listening… (tap when you\'re done)';
    transcriptEl.textContent = '';

    const audioCfg = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    recognizer = new SpeechSDK.SpeechRecognizer(cfg, audioCfg);

    // Live interim text while you speak.
    recognizer.recognizing = (_s, e) => {
      transcriptEl.textContent = (finals.join(' ') + ' ' + (e.result.text || '')).trim();
    };
    // A finalized segment (after each natural pause) — keep going, don't stop.
    recognizer.recognized = (_s, e) => {
      if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text) {
        finals.push(e.result.text);
        transcriptEl.textContent = finals.join(' ');
      }
    };
    recognizer.canceled = (_s, e) => {
      transcriptEl.textContent = 'Recognition canceled: ' + (e.errorDetails || e.reason);
      if (recognizer) { recognizer.close(); recognizer = null; }
      resetMicButton(btn);
    };

    recognizer.startContinuousRecognitionAsync(undefined, (err) => {
      transcriptEl.textContent = 'Could not start: ' + err;
      resetMicButton(btn);
    });
  }

  // ---- Wire the composer after the session view loads ---------------------
  function initComposer() {
    const composer = document.getElementById('composer');
    if (!composer || composer.dataset.ready) return;
    composer.dataset.ready = '1';

    const recordBtn = composer.querySelector('[data-record]');
    const transcriptEl = composer.querySelector('[data-transcript]');
    const typeToggle = composer.querySelector('[data-send-text]');
    const typeForm = composer.querySelector('[data-type-form]');

    if (recordBtn) recordBtn.addEventListener('click', () => toggleRecording(recordBtn, transcriptEl));
    if (typeToggle && typeForm) {
      typeToggle.addEventListener('click', () => typeForm.classList.toggle('hidden'));
    }
    if (typeForm) {
      typeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = typeForm.querySelector('input[name="typed"]');
        const text = (input.value || '').trim();
        if (!text) return;
        input.value = '';
        addLearnerBubble(text);
        sendReply(text);
      });
    }
    speakLatestTutor(); // speak Buddy's opening line
    scrollChat();
  }

  // Delegate speak buttons on tutor bubbles.
  document.addEventListener('click', (e) => {
    const normal = e.target.closest('[data-speak]');
    const slow = e.target.closest('[data-speak-slow]');
    if (!normal && !slow) return;
    const bubble = e.target.closest('.bubble.tutor');
    if (!bubble) return;
    playTTS(bubble.getAttribute('data-nl'), slow ? 'slow' : 'default');
  });

  document.addEventListener('DOMContentLoaded', initComposer);
  document.body.addEventListener('htmx:afterSwap', initComposer);
})();
