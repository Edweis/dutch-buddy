// Dutch Buddy — conversation client.
// Plays Saar's Dutch via Azure TTS (/tts), recognizes your spoken reply with the
// Azure Speech SDK (token from /speech-token), and posts it back for the next turn.

(function () {
  // ---- Audio playback with a play/stop toggle on each speaker button --------
  // Each speak button carries both icons (from the Pug mixin); the `playing`
  // class decides which one CSS shows, so the client never rebuilds icon markup.
  let currentAudio = null;
  let currentBtn = null; // the speaker button driving currentAudio (null for auto-play)

  function setPlayIcon(btn, playing) {
    if (!btn) return;
    btn.classList.toggle('playing', playing);
    btn.setAttribute('aria-label', playing ? 'Stop' : 'Play');
  }

  // Stop whatever is playing and restore its button to the speaker icon.
  function stopPlayback() {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (currentBtn) { setPlayIcon(currentBtn, false); currentBtn = null; }
  }

  // Play Dutch text. Always starts from the beginning; `btn` (if given) shows a
  // pause icon while playing and reverts when it ends or is stopped.
  // Speak in this conversation's assigned voice (data-voice on #chat), if any.
  function ttsUrl(text) {
    const chat = document.getElementById('chat');
    const voice = chat && chat.getAttribute('data-voice');
    return `/tts?text=${encodeURIComponent(text)}` + (voice ? `&voice=${encodeURIComponent(voice)}` : '');
  }

  function playTTS(text, btn) {
    if (!text) return;
    stopPlayback();
    try {
      const audio = new Audio(ttsUrl(text));
      currentAudio = audio;
      currentBtn = btn || null;
      setPlayIcon(currentBtn, true);
      const reset = () => { if (currentAudio === audio) stopPlayback(); };
      audio.addEventListener('ended', reset);
      audio.addEventListener('error', reset);
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

  // Show the learner's own line instantly by cloning the server-rendered template
  // (#tmpl-learner), so its markup stays identical to reloaded bubbles.
  function addLearnerBubble(text) {
    const chat = document.getElementById('chat');
    const tmpl = document.getElementById('tmpl-learner');
    if (!chat || !tmpl) return;
    const bubble = tmpl.content.firstElementChild.cloneNode(true);
    bubble.querySelector('.nl').textContent = text;
    chat.appendChild(bubble);
    scrollChat();
  }

  function speakLatestTutor() {
    const bubbles = document.querySelectorAll('#chat .bubble.tutor');
    const last = bubbles[bubbles.length - 1];
    if (last) playTTS(last.getAttribute('data-nl'), last.querySelector('[data-speak]'));
  }

  // Send the learner's text and append Saar's reply (not played automatically —
  // tap the reply's speaker button to hear it).
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
  let finals = [];        // finalized segments on the current line (not yet banked)
  let savedLines = [];    // sentences banked with Space, each shown on its own line
  let hasInterim = false; // an utterance is mid-flight (live text shown, not yet finalized)
  let interimText = '';   // the latest live (not-yet-finalized) words, so Space can bank them
  let abortUtterance = false; // swallow the next final result (its utterance was cancelled)

  // Render banked lines stacked, with the current line (finals + live interim) last.
  function renderTranscript(transcriptEl, interim) {
    const current = [finals.join(' '), interim || ''].map((s) => s.trim()).filter(Boolean).join(' ');
    transcriptEl.textContent = [...savedLines, current].filter(Boolean).join('\n');
  }

  // Space: bank the current sentence and start the next one on a new line below.
  // Works even mid-utterance (while the live interim text is still showing) — we bank
  // what's on screen and swallow the pending final so it can't re-add the same words.
  function saveProgress(transcriptEl, cancelBtn) {
    if (!recognizing) return;
    const current = [finals.join(' '), interimText].join(' ').replace(/\s+/g, ' ').trim();
    if (!current) return; // nothing heard yet to bank
    savedLines.push(current);
    finals = [];
    if (hasInterim) abortUtterance = true; // the in-flight final was just banked — drop it
    interimText = '';
    hasInterim = false;
    renderTranscript(transcriptEl, '');
    if (cancelBtn) cancelBtn.textContent = 'Redo sentence';
    transcriptEl.classList.add('saved'); // brief green confirmation
    setTimeout(() => transcriptEl.classList.remove('saved'), 400);
  }

  // Esc / Cancel, step by step:
  //  1. if a sentence is in progress (un-banked, incl. one still being recognized),
  //     drop that attempt — and swallow its pending final so it can't re-appear;
  //  2. else if there are banked lines, undo the last one so you can redo it;
  //  3. else cancel the recording entirely.
  function redoOrCancel(btn, transcriptEl, cancelBtn) {
    if (finals.length || hasInterim) {
      if (hasInterim) abortUtterance = true; // the in-flight final belongs to a cancelled sentence
      finals = [];
      interimText = '';
      renderTranscript(transcriptEl, '');
    } else if (savedLines.length) {
      savedLines.pop();
      renderTranscript(transcriptEl, '');
      if (!savedLines.length && cancelBtn) cancelBtn.textContent = 'Cancel';
    } else {
      stopRecording(false, btn, transcriptEl, cancelBtn);
    }
  }

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
    savedLines = [];
    hasInterim = false;
    interimText = '';
    abortUtterance = false;
    btn.classList.remove('listening');
    btn.textContent = 'Tap to speak';
    btn.disabled = false;
    if (cancelBtn) { cancelBtn.classList.add('hidden'); cancelBtn.textContent = 'Cancel'; }
    const saveBtn = document.querySelector('[data-save]');
    if (saveBtn) saveBtn.classList.add('hidden');
  }

  // Stop listening. If send=true, submit what was heard straight away; if false,
  // discard it.
  function stopRecording(send, btn, transcriptEl, cancelBtn) {
    btn.disabled = true;
    const done = () => {
      if (recognizer) { recognizer.close(); recognizer = null; }
      // Read banked + un-banked (incl. live interim) BEFORE reset (reset clears `savedLines`).
      const text = [...savedLines, finals.join(' '), interimText].join(' ').replace(/\s+/g, ' ').trim();
      resetMicButton(btn, cancelBtn);
      finals = [];
      transcriptEl.textContent = '';
      if (!send) return;
      if (!text) { transcriptEl.textContent = '(nothing heard — try again)'; return; }
      addLearnerBubble(text);
      sendReply(text);
    };
    if (recognizer) recognizer.stopContinuousRecognitionAsync(done, done);
    else done();
  }

  async function toggleRecording(btn, transcriptEl, cancelBtn) {
    if (recognizing) { stopRecording(true, btn, transcriptEl, cancelBtn); return; }
    stopPlayback(); // starting to record — silence any Saar audio first
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
    savedLines = [];
    hasInterim = false;
    interimText = '';
    abortUtterance = false;
    recognizing = true;
    btn.classList.add('listening');
    btn.textContent = 'Listening…';
    if (cancelBtn) { cancelBtn.classList.remove('hidden'); cancelBtn.textContent = 'Cancel'; }
    const saveBtn = document.querySelector('[data-save]');
    if (saveBtn) saveBtn.classList.remove('hidden');
    transcriptEl.textContent = '';

    const audioCfg = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    recognizer = new SpeechSDK.SpeechRecognizer(cfg, audioCfg);

    // Bias recognition toward very common Dutch words and chunks so it splits them
    // faithfully (e.g. "je eten" instead of "jeeten") instead of inventing a merged word.
    try {
      const phrases = SpeechSDK.PhraseListGrammar.fromRecognizer(recognizer);
      [
        'ik', 'je', 'jij', 'u', 'het', 'de', 'een', 'niet', 'ook', 'wel', 'maar', 'want',
        'wil', 'wat', 'waar', 'wanneer', 'hoe', 'waarom', 'heb', 'ben', 'is', 'gaan', 'doen',
        'eten', 'drinken', 'werken', 'wonen', 'graag', 'vandaag', 'morgen', 'goed', 'leuk',
        'ik wil', 'wil je', 'je eten', 'zullen we', 'hoe gaat het', 'ik vind', 'mag ik',
      ].forEach((p) => phrases.addPhrase(p));
    } catch (_) { /* phrase lists unsupported — fine */ }

    // Live interim text while you speak.
    recognizer.recognizing = (_s, e) => {
      if (abortUtterance) return; // ignore the tail of a cancelled/banked utterance
      interimText = e.result.text || '';
      hasInterim = !!(e.result.text && e.result.text.trim());
      renderTranscript(transcriptEl, interimText);
    };
    // A finalized segment (after each natural pause) — keep going, don't stop.
    recognizer.recognized = (_s, e) => {
      // If this utterance was cancelled (Esc) or already banked (Space) between interim
      // and final, swallow its final so the sentence doesn't re-appear, then resume.
      if (abortUtterance) { abortUtterance = false; hasInterim = false; interimText = ''; renderTranscript(transcriptEl, ''); return; }
      hasInterim = false;
      interimText = '';
      if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text) {
        finals.push(e.result.text);
        renderTranscript(transcriptEl, '');
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
    const saveBtn = composer.querySelector('[data-save]');
    const transcriptEl = composer.querySelector('[data-transcript]');

    if (recordBtn) recordBtn.addEventListener('click', () => toggleRecording(recordBtn, transcriptEl, cancelBtn));
    if (saveBtn) saveBtn.addEventListener('click', () => saveProgress(transcriptEl, cancelBtn));
    if (cancelBtn) cancelBtn.addEventListener('click', () => redoOrCancel(recordBtn, transcriptEl, cancelBtn));

    wireCoach();
    // Auto-play only the opening line of a brand-new chat (the single bubble on the
    // page). On reloading an existing conversation, stay silent — don't replay the
    // last reply; the user can tap a speaker button if they want to hear it.
    if (document.querySelectorAll('#chat .bubble').length === 1) speakLatestTutor();
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
      if (recognizing) saveProgress(transcriptEl, cancelBtn); // bank this sentence, start a new line
      else toggleRecording(recordBtn, transcriptEl, cancelBtn); // start listening
    } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && recognizing && !typing) {
      e.preventDefault(); // finish and send straight away
      stopRecording(true, recordBtn, transcriptEl, cancelBtn);
    } else if (e.code === 'Escape' && recognizing) {
      e.preventDefault();
      redoOrCancel(recordBtn, transcriptEl, cancelBtn);
    }
  });

  // Delegate speak buttons on anything carrying data-nl (tutor bubbles, coach examples).
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-speak]');
    if (!btn) return;
    const host = e.target.closest('[data-nl]');
    if (!host) return;
    if (currentBtn === btn) { stopPlayback(); return; } // clicking the playing button stops it
    playTTS(host.getAttribute('data-nl'), btn);           // otherwise (re)play from the start
  });

  document.addEventListener('DOMContentLoaded', initComposer);
  document.body.addEventListener('htmx:afterSwap', initComposer);
})();
