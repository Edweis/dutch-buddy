// Dutch Buddy — conversation client.
// Plays Saar's Dutch via Azure TTS (/tts), recognizes your spoken reply with the
// Azure Speech SDK (token from /speech-token), and posts it back for the next turn.

(function () {
  let currentAudio = null;

  function playTTS(text) {
    if (!text) return;
    try {
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      const audio = new Audio(`/tts?text=${encodeURIComponent(text)}`);
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
      `<div class="bubble learner"><div class="who">You</div><p class="nl">${esc(text)}</p></div>`
    );
    scrollChat();
  }

  function speakLatestTutor() {
    const bubbles = document.querySelectorAll('#chat .bubble.tutor');
    const last = bubbles[bubbles.length - 1];
    if (last) playTTS(last.getAttribute('data-nl'));
  }

  // Send the learner's text, append Saar's reply, speak it.
  async function sendReply(text) {
    const chat = document.getElementById('chat');
    const cid = chat && chat.getAttribute('data-cid');
    if (!cid) return;
    const composer = document.getElementById('composer');
    if (composer) composer.classList.add('busy');
    try {
      const res = await fetch(`/conversation/${cid}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'heard=' + encodeURIComponent(text),
      });
      const html = await res.text();
      chat.insertAdjacentHTML('beforeend', html);
      // The correction fragment (if any) belongs under the learner's own message.
      const carrier = chat.querySelector('.correction-carrier');
      if (carrier) {
        const learners = chat.querySelectorAll('.bubble.learner');
        const lastLearner = learners[learners.length - 1];
        if (lastLearner && !lastLearner.querySelector('.note-tip')) {
          lastLearner.insertAdjacentHTML('beforeend', carrier.innerHTML);
        }
        carrier.remove();
      }
      scrollChat();
      speakLatestTutor();
    } catch (err) {
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
    // Semantic segmentation: end a phrase by MEANING, not a fixed silence timer —
    // so normal-speed sentences finalize cleanly while mid-thought pauses don't
    // break them. Keep a generous silence fallback where Semantic isn't available.
    cfg.setProperty(SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, '2000');
    if (SpeechSDK.PropertyId.Speech_SegmentationStrategy !== undefined) {
      cfg.setProperty(SpeechSDK.PropertyId.Speech_SegmentationStrategy, 'Semantic');
    }
    return cfg;
  }

  function resetMicButton(btn, cancelBtn) {
    recognizing = false;
    btn.classList.remove('listening');
    btn.textContent = 'Tap or press Space';
    btn.disabled = false;
    if (cancelBtn) cancelBtn.classList.add('hidden');
  }

  // Tear down the recognizer. If send=true, submit what was heard; if false,
  // discard it (the Cancel button).
  function stopRecording(send, btn, transcriptEl, cancelBtn) {
    btn.disabled = true;
    const done = () => {
      if (recognizer) { recognizer.close(); recognizer = null; }
      resetMicButton(btn, cancelBtn);
      const text = finals.join(' ').replace(/\s+/g, ' ').trim();
      finals = [];
      if (!send) { transcriptEl.textContent = ''; return; }
      if (!text) { transcriptEl.textContent = '(nothing heard — try again)'; return; }
      transcriptEl.textContent = '';
      addLearnerBubble(text);
      sendReply(text);
    };
    if (recognizer) recognizer.stopContinuousRecognitionAsync(done, done);
    else done();
  }

  async function toggleRecording(btn, transcriptEl, cancelBtn) {
    if (recognizing) { stopRecording(true, btn, transcriptEl, cancelBtn); return; }
    if (!window.SpeechSDK) {
      transcriptEl.textContent = 'Speech SDK not loaded — check your connection.';
      return;
    }
    let cfg;
    try {
      cfg = await getSpeechConfig();
    } catch (err) {
      console.error('[mic] token error:', err);
      transcriptEl.textContent = "Couldn't reach the voice service — tap to try again.";
      return;
    }
    finals = [];
    recognizing = true;
    btn.classList.add('listening');
    btn.textContent = 'Listening… (Space/tap to stop · Esc to cancel)';
    if (cancelBtn) cancelBtn.classList.remove('hidden');
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
      resetMicButton(btn, cancelBtn);
    };

    recognizer.startContinuousRecognitionAsync(undefined, (err) => {
      transcriptEl.textContent = 'Could not start: ' + err;
      resetMicButton(btn, cancelBtn);
    });
  }

  // ---- Wire the composer after the session view loads ---------------------
  function initComposer() {
    const composer = document.getElementById('composer');
    if (!composer || composer.dataset.ready) return;
    composer.dataset.ready = '1';

    const recordBtn = composer.querySelector('[data-record]');
    const cancelBtn = composer.querySelector('[data-cancel]');
    const transcriptEl = composer.querySelector('[data-transcript]');

    if (recordBtn) recordBtn.addEventListener('click', () => toggleRecording(recordBtn, transcriptEl, cancelBtn));
    if (cancelBtn) cancelBtn.addEventListener('click', () => stopRecording(false, recordBtn, transcriptEl, cancelBtn));

    wireCoach();
    speakLatestTutor(); // speak Saar's opening line
    scrollChat();
  }

  // ---- Side coach ---------------------------------------------------------
  function wireCoach() {
    const form = document.querySelector('[data-coach-form]');
    const log = document.querySelector('[data-coach-log]');
    if (!form || !log) return;
    log.scrollTop = log.scrollHeight; // show the latest saved Q&A on load

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input[name="q"]');
      const q = (input.value || '').trim();
      if (!q) return;
      input.value = '';
      const chat = document.getElementById('chat');
      const cid = (chat && chat.getAttribute('data-cid')) || '';
      log.insertAdjacentHTML('beforeend', '<div class="coach-loading" data-loading>Thinking…</div>');
      log.scrollTop = log.scrollHeight;
      try {
        const res = await fetch('/coach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'q=' + encodeURIComponent(q) + '&cid=' + encodeURIComponent(cid),
        });
        const html = await res.text();
        const loading = log.querySelector('[data-loading]');
        if (loading) loading.remove();
        log.insertAdjacentHTML('beforeend', html);
        log.scrollTop = log.scrollHeight;
      } catch (err) {
        const loading = log.querySelector('[data-loading]');
        if (loading) loading.remove();
        log.insertAdjacentHTML('beforeend', '<div class="coach-msg"><div class="coach-a">Error: ' + esc(err.message) + '</div></div>');
      }
    });
  }

  // Keyboard shortcuts: Space starts/stops recording, Escape cancels.
  // Space is ignored while typing (e.g. in the coach box) so it types a space.
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const tag = (el && el.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable);
    const recordBtn = document.querySelector('[data-record]');
    const transcriptEl = document.querySelector('[data-transcript]');
    const cancelBtn = document.querySelector('[data-cancel]');
    if (!recordBtn) return;
    if (e.code === 'Space' && !typing) {
      e.preventDefault(); // also stops a focused button from double-triggering
      toggleRecording(recordBtn, transcriptEl, cancelBtn);
    } else if (e.code === 'Escape' && recognizing) {
      e.preventDefault();
      stopRecording(false, recordBtn, transcriptEl, cancelBtn);
    }
  });

  // Delegate speak buttons on anything carrying data-nl (tutor bubbles, coach examples).
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-speak]')) return;
    const host = e.target.closest('[data-nl]');
    if (host) playTTS(host.getAttribute('data-nl'));
  });

  document.addEventListener('DOMContentLoaded', initComposer);
  document.body.addEventListener('htmx:afterSwap', initComposer);
})();
