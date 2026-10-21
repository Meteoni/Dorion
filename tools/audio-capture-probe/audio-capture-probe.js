// Dorion plugin: test WebView2 display audio locally, without starting a Discord stream.
(() => {
  if (window.self !== window.top || document.getElementById('dorion-audio-probe')) return;
  const devices = navigator.mediaDevices;
  if (!devices?.getDisplayMedia) return;
  // Vencord replaces the instance method and rewrites capture options. Use the
  // browser's prototype method so this probe tests the requested options directly.
  const nativeGetDisplayMedia = Object.getPrototypeOf(devices).getDisplayMedia;
  const nativeCaptureAvailable = typeof nativeGetDisplayMedia === 'function'
    && Function.prototype.toString.call(nativeGetDisplayMedia).includes('[native code]');

  const host = document.createElement('div');
  host.id = 'dorion-audio-probe';
  host.style.cssText = 'position:fixed;right:16px;top:48px;z-index:2147483647;width:min(540px,90vw)';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    section { background:#202126;color:#eee;border:1px solid #666;border-radius:8px;padding:14px;font:13px/1.5 system-ui;box-shadow:0 8px 32px #0008 }
    button { margin:4px 5px 4px 0;padding:6px 10px;cursor:pointer }
    pre { white-space:pre-wrap;max-height:240px;overflow:auto;user-select:text;font:12px/1.4 monospace }
    h3,p { margin:0 0 8px }
  </style><section>
    <h3>Dorion audio capture probe v2</h3>
    <p>Local analysis only. Choose a capture mode, then measure. The test plays a short 997 Hz tone inside Dorion. Nothing is sent to your call.</p>
    <button data-mode="baseline">1. Screen baseline</button>
    <button data-mode="exclude">2. Screen excluding self</button>
    <button data-mode="window">3. Application window</button>
    <button id="measure">Measure tones</button><button id="stop">Stop capture</button><button id="close">Close</button>
    <pre id="report"></pre>
  </section>`;

  const output = root.getElementById('report');
  let session = null;
  let busy = false;
  let disposed = false;
  const results = [];

  function report(message, detail) {
    const entry = detail === undefined ? message : `${message}\n${JSON.stringify(detail, null, 2)}`;
    results.push(entry);
    output.textContent = results.join('\n\n');
    output.scrollTop = output.scrollHeight;
  }

  // Release capture and analysis resources on stop, timeout, or page exit.
  function stop() {
    if (!session) return;
    const previous = session;
    session = null;
    clearTimeout(previous.timer);
    previous.gain?.gain.setValueAtTime(0, previous.context.currentTime);
    previous.oscillator?.stop();
    previous.stream.getTracks().forEach(track => track.stop());
    previous.context.close().catch(() => {});
  }

  // A real picker selection is required; optional hints may be ignored by WebView2.
  async function capture(mode) {
    if (busy || disposed) return;
    if (!nativeCaptureAvailable) {
      report('Native prototype method is unavailable or patched. Disable the capture-modifying client plugin and reload; this probe will not silently use the page wrapper.');
      return;
    }
    busy = true;
    stop();
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (mode === 'exclude') audio.restrictOwnAudio = true;
    else audio.restrictOwnAudio = false;
    const options = {
      video: { displaySurface: mode === 'window' ? 'window' : 'monitor', frameRate: 5 },
      audio,
      systemAudio: 'include',
      windowAudio: mode === 'window' ? 'window' : 'system'
    };
    const context = new AudioContext();
    let stream;
    try {
      const resumed = context.resume();
      const pending = Reflect.apply(nativeGetDisplayMedia, devices, [options]);
      [, stream] = await Promise.all([resumed, pending]);
      if (disposed) { stream.getTracks().forEach(track => track.stop()); await context.close(); return; }
      const tracks = stream.getAudioTracks();
      const settings = tracks.map(track => {
        const { deviceId, groupId, ...safe } = track.getSettings();
        return safe;
      });
      report(`${mode}: returned ${tracks.length} audio track(s)`, {
        requested: options,
        captureImplementation: 'native prototype method',
        surface: stream.getVideoTracks()[0]?.getSettings().displaySurface,
        audioSettings: settings
      });
      if (!tracks.length) {
        report('NO AUDIO TRACK. This picker selection did not provide audio.');
        stream.getTracks().forEach(track => track.stop());
        await context.close();
        return;
      }
      const analyser = context.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0;
      const source = context.createMediaStreamSource(new MediaStream(tracks));
      source.connect(analyser); // Deliberately never connected to speakers.
      const oscillator = context.createOscillator();
      oscillator.frequency.value = 997;
      const gain = context.createGain();
      gain.gain.value = 0;
      const generatedAnalyser = context.createAnalyser();
      generatedAnalyser.fftSize = 8192;
      generatedAnalyser.smoothingTimeConstant = 0;
      oscillator.connect(gain).connect(generatedAnalyser).connect(context.destination);
      oscillator.start();
      session = { stream, context, analyser, generatedAnalyser, source, oscillator, gain, mode };
      session.timer = setTimeout(() => { stop(); report('Capture stopped after 180 seconds.'); }, 180000);
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (session?.stream === stream) { stop(); report('Capture ended.'); }
      });
      report('Ready. Keep the external 1511 Hz reference playing, then click Measure tones.');
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      await context.close().catch(() => {});
      report(`${mode}: ${error.name}: ${error.message}`);
    } finally {
      busy = false;
    }
  }

  // Compare captured energy before and during a known tone generated inside Dorion.
  async function measure() {
    if (busy || !session) return;
    busy = true;
    const current = session;
    const bins = new Float32Array(current.analyser.frequencyBinCount);
    const generatedBins = new Float32Array(current.generatedAnalyser.frequencyBinCount);
    const readings = [];
    try {
      await current.context.resume();
      for (const amplitude of [0, 0.04]) {
        current.gain.gain.setTargetAtTime(amplitude, current.context.currentTime, 0.02);
        await new Promise(resolve => setTimeout(resolve, 500));
        const samples = [[], [], []];
        for (let i = 0; i < 15; i++) {
          if (session !== current) throw new Error('Capture was stopped.');
          current.analyser.getFloatFrequencyData(bins);
          [997, 1511].forEach((frequency, index) => {
            const center = Math.round(frequency * current.analyser.fftSize / current.context.sampleRate);
            samples[index].push(Math.max(-160, ...bins.slice(center - 2, center + 3)));
          });
          current.generatedAnalyser.getFloatFrequencyData(generatedBins);
          const ownBin = Math.round(997 * current.generatedAnalyser.fftSize / current.context.sampleRate);
          samples[2].push(Math.max(-160, ...generatedBins.slice(ownBin - 2, ownBin + 3)));
          await new Promise(resolve => setTimeout(resolve, 80));
        }
        readings.push(samples.map(values => Number(values.sort((a, b) => a - b)[7].toFixed(1))));
      }
      report(`${current.mode}: measured levels (dB; more negative = quieter)`, {
        ownTone997Hz: { off: readings[0][0], on: readings[1][0] },
        externalTone1511Hz: { off: readings[0][1], on: readings[1][1] },
        generatedTone997Hz: { off: readings[0][2], on: readings[1][2] },
        contextState: current.context.state,
        trackStates: current.stream.getAudioTracks().map(track => ({ enabled: track.enabled, muted: track.muted, readyState: track.readyState }))
      });
      report('Compare the baseline and excluding-self results. Self exclusion works only if the 997 Hz tone disappears while the external 1511 Hz tone remains. For window capture, repeat with a different window to check isolation.');
    } catch (error) {
      report(`Measurement interrupted: ${error.message}`);
    } finally {
      if (session === current) current.gain.gain.setValueAtTime(0, current.context.currentTime);
      busy = false;
    }
  }

  root.querySelectorAll('[data-mode]').forEach(button => {
    button.onclick = () => capture(button.dataset.mode);
  });
  root.getElementById('measure').onclick = measure;
  root.getElementById('stop').onclick = () => { stop(); report('Stopped.'); };
  root.getElementById('close').onclick = () => { disposed = true; stop(); host.remove(); };
  window.addEventListener('pagehide', stop, { once: true });
  report('Runtime', {
    probeVersion: 2,
    userAgent: navigator.userAgent,
    restrictOwnAudioAdvertised: devices.getSupportedConstraints().restrictOwnAudio ?? false,
    pageCaptureOverridden: devices.getDisplayMedia !== nativeGetDisplayMedia,
    nativeCaptureAvailable
  });
  (document.body || document.documentElement).appendChild(host);
})();
