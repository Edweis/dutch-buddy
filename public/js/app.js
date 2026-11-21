// Dutch Buddy — conversation client.
// Plays Saar's Dutch via Azure TTS (/tts), recognizes your spoken reply with the
// Azure Speech SDK (token from /speech-token), and posts it back for the next turn.

(function () {
  // ---- Audio playback with a play/stop toggle on each speaker button --------
  const HI = 'class="hi" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" aria-hidden="true"';
  const ICON_SPEAKER = `<svg ${HI}><path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"/></svg>`;
  const ICON_PAUSE = `<svg ${HI}><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5"/></svg>`;

  let currentAudio = null;
  let currentBtn = null; // the speaker button driving currentAudio (null for auto-play)

  function setPlayIcon(btn, playing) {
    if (!btn) return;
    btn.innerHTML = playing ? ICON_PAUSE : ICON_SPEAKER;
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
  function playTTS(text, btn) {
    if (!text) return;
    stopPlayback();
    try {
      const audio = new Audio(`/tts?text=${encodeURIComponent(text)}`);
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
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

  function addLearnerBubble(text) {
    const chat = document.getElementById('chat');
    if (!chat) return;
    chat.insertAdjacentHTML(
      'beforeend',
      `<div class="bubble learner" data-nl="${escAttr(text)}">` +
        '<div class="bubble-head"><span class="who">You</span>' +
          `<button class="icon" type="button" data-speak aria-label="Play">${ICON_SPEAKER}</button>` +
        '</div>' +
        `<p class="nl">${esc(text)}</p>` +
      '</div>'
    );
    scrollChat();
  }

  function speakLatestTutor() {
    const bubbles = document.querySelectorAll('#chat .bubble.tutor');
    const last = bubbles[bubbles.length - 1];
    if (last) playTTS(last.getAttribute('data-nl'), last.querySelector('[data-speak]'));
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
  let finals = [];        // finalized segments on the current line (not yet banked)
  let savedLines = [];    // sentences banked with Space, each shown on its own line
  let pendingText = null; // recognized reply awaiting your confirmation before it's sent

  // Render banked lines stacked, with the current line (finals + live interim) last.
  function renderTranscript(transcriptEl, interim) {
    const current = [finals.join(' '), interim || ''].map((s) => s.trim()).filter(Boolean).join(' ');
    transcriptEl.textContent = [...savedLines, current].filter(Boolean).join('\n');
  }

  // Space: bank the current sentence and start the next one on a new line below.
  function saveProgress(transcriptEl, cancelBtn) {
    if (!recognizing) return;
    const current = finals.join(' ').replace(/\s+/g, ' ').trim();
    if (!current) return; // nothing finalized to bank yet
    savedLines.push(current);
    finals = [];
    renderTranscript(transcriptEl, '');
    if (cancelBtn) cancelBtn.textContent = 'Redo sentence (Esc)';
    transcriptEl.classList.add('saved'); // brief green confirmation
    setTimeout(() => transcriptEl.classList.remove('saved'), 400);
  }

  // Esc / Cancel: with banked lines, drop just the current un-banked attempt and
  // keep listening so you can re-say that sentence. Otherwise cancel the recording.
  function redoOrCancel(btn, transcriptEl, cancelBtn) {
    if (savedLines.length) {
      finals = [];
      renderTranscript(transcriptEl, '');
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
    btn.classList.remove('listening');
    btn.textContent = 'Tap or press Space';
    btn.disabled = false;
    if (cancelBtn) { cancelBtn.classList.add('hidden'); cancelBtn.textContent = 'Cancel (Esc)'; }
    const saveBtn = document.querySelector('[data-save]');
    if (saveBtn) saveBtn.classList.add('hidden');
  }

  // Stop listening and either discard (send=false) or move to the review step
  // (send=true), where you see what was heard before it goes to Saar.
  function stopRecording(send, btn, transcriptEl, cancelBtn) {
    btn.disabled = true;
    const done = () => {
      if (recognizer) { recognizer.close(); recognizer = null; }
      // Read banked + un-banked BEFORE reset (reset clears `savedLines`).
      const text = [...savedLines, finals.join(' ')].join(' ').replace(/\s+/g, ' ').trim();
      resetMicButton(btn, cancelBtn);
      finals = [];
      if (!send) { transcriptEl.textContent = ''; return; }
      if (!text) { transcriptEl.textContent = '(nothing heard — try again)'; return; }
      enterReview(text, btn, transcriptEl, cancelBtn);
    };
    if (recognizer) recognizer.stopContinuousRecognitionAsync(done, done);
    else done();
  }

  // Review step: show the recognized sentence(s) and wait. Enter/tap sends it to
  // Saar (reply shows and plays); Esc/Redo discards it so you can speak again.
  function enterReview(text, btn, transcriptEl, cancelBtn) {
    pendingText = text;
    transcriptEl.textContent = text;
    transcriptEl.classList.add('review');
    btn.classList.add('review');
    btn.textContent = 'Send (Enter)';
    if (cancelBtn) { cancelBtn.classList.remove('hidden'); cancelBtn.textContent = 'Redo (Esc)'; }
  }

  function clearReview(transcriptEl, btn, cancelBtn) {
    pendingText = null;
    transcriptEl.textContent = '';
    transcriptEl.classList.remove('review');
    btn.classList.remove('review');
    btn.textContent = 'Tap or press Space';
    if (cancelBtn) cancelBtn.classList.add('hidden');
  }

  // Confirm the reviewed text: send it, show your bubble, fetch + play Saar's reply.
  function commitReview(btn, transcriptEl, cancelBtn) {
    if (!pendingText) return;
    const text = pendingText;
    clearReview(transcriptEl, btn, cancelBtn);
    addLearnerBubble(text);
    sendReply(text);
  }

  async function toggleRecording(btn, transcriptEl, cancelBtn) {
    if (pendingText) { commitReview(btn, transcriptEl, cancelBtn); return; }
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
    recognizing = true;
    btn.classList.add('listening');
    btn.textContent = 'Listening… — Enter to finish · Space for next line · Esc to redo';
    if (cancelBtn) { cancelBtn.classList.remove('hidden'); cancelBtn.textContent = 'Cancel (Esc)'; }
    const saveBtn = document.querySelector('[data-save]');
    if (saveBtn) saveBtn.classList.remove('hidden');
    transcriptEl.textContent = '';

    const audioCfg = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    recognizer = new SpeechSDK.SpeechRecognizer(cfg, audioCfg);

    // Live interim text while you speak.
    recognizer.recognizing = (_s, e) => {
      renderTranscript(transcriptEl, e.result.text || '');
    };
    // A finalized segment (after each natural pause) — keep going, don't stop.
    recognizer.recognized = (_s, e) => {
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
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      if (pendingText) clearReview(transcriptEl, recordBtn, cancelBtn); // Redo: drop the reviewed text
      else redoOrCancel(recordBtn, transcriptEl, cancelBtn);
    });

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
      if (recognizing) saveProgress(transcriptEl, cancelBtn);     // bank this sentence, start a new line
      else if (!pendingText) toggleRecording(recordBtn, transcriptEl, cancelBtn); // start listening
    } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !typing) {
      if (recognizing) {
        e.preventDefault(); // stop and show the result for review
        stopRecording(true, recordBtn, transcriptEl, cancelBtn);
      } else if (pendingText) {
        e.preventDefault(); // confirm: send it, reply shows and plays
        commitReview(recordBtn, transcriptEl, cancelBtn);
      }
    } else if (e.code === 'Escape' && recognizing) {
      e.preventDefault();
      redoOrCancel(recordBtn, transcriptEl, cancelBtn);
    } else if (e.code === 'Escape' && pendingText) {
      e.preventDefault(); // drop the reviewed text, speak again
      clearReview(transcriptEl, recordBtn, cancelBtn);
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
