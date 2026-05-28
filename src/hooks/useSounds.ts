import { useCallback } from 'react';

// webkitAudioContext is required on iOS < 14.5
declare global { interface Window { webkitAudioContext?: typeof AudioContext; } }

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    const AC = window.AudioContext ?? window.webkitAudioContext!;
    audioCtx = new AC();
  }
  return audioCtx;
}

// Unlock the AudioContext so iOS/Chrome will let us play sound.
// The silent buffer MUST be started synchronously inside the user-gesture
// call stack — putting it in a .then() breaks iOS Chrome's gesture gate.
export function unlockAudio() {
  try {
    const ctx = getCtx();
    // Always call resume() first — iOS Chrome requires it synchronously
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    // Then immediately start a silent 1-sample buffer (belt-and-suspenders)
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* ignore */ }
}

// Attach listeners at MODULE LOAD so the context is unlocked the moment
// the user first touches the page — even before GameBoard mounts.
if (typeof document !== 'undefined') {
  // visibilitychange is NOT a user gesture on iOS — only resume an existing
  // context here, never create one. Creating outside a gesture can leave the
  // context in a state that iPhone Safari refuses to ever resume.
  const vis = () => {
    if (document.visibilityState === 'visible' && audioCtx) {
      if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
    }
  };
  document.addEventListener('touchstart',       unlockAudio, { passive: true, capture: true });
  document.addEventListener('touchend',         unlockAudio, { passive: true, capture: true });
  document.addEventListener('click',            unlockAudio, { capture: true });
  document.addEventListener('visibilitychange', vis);
}

// ─── Module-level music control ───────────────────────────────────────────────
// Exported so MultiLobbyScreen can call startMusic() from the "Start Game"
// button gesture — the only truly reliable way to unlock audio on iPhone Safari.

let _musicStop: (() => void) | null = null;

export function startMusic() {
  if (_musicStop) return; // already playing — guard against double-start
  try {
    const ctx = getCtx();
    // Start music nodes SYNCHRONOUSLY so oscillators are created within the
    // gesture callstack — iPhone Safari blocks audio nodes started in a
    // .then() callback even if resume() was called in the gesture.
    // ctx.currentTime is frozen while suspended, so all scheduled notes
    // are still in the future and will play correctly once resume() runs.
    _musicStop = playBackgroundMusic(ctx);
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  } catch { /* ignore */ }
}

export function stopMusic() {
  if (_musicStop) {
    _musicStop();
    _musicStop = null;
  }
}

function scheduleNote(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  time: number,
  dur: number,
  type: OscillatorType,
  vol: number
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.connect(g);
  g.connect(dest);
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(vol, time + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, time + Math.max(dur - 0.02, 0.02));
  osc.start(time);
  osc.stop(time + dur);
}

function playBackgroundMusic(ctx: AudioContext): () => void {
  const BPM = 126;
  const B = 60 / BPM; // seconds per beat

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.13, ctx.currentTime + 1.5);
  master.connect(ctx.destination);

  // Note frequencies (C major pentatonic + some passing tones)
  const n = {
    C3: 130.81, F3: 174.61, G3: 195.99, A3: 219.99,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
    G4: 392.00, A4: 440.00, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25,
  };

  // 8-beat melody [freq, beatOffset, beatDuration]
  const melA: [number, number, number][] = [
    [n.C4, 0, 0.5], [n.E4, 0.5, 0.5],
    [n.G4, 1, 0.25], [n.A4, 1.25, 0.25], [n.G4, 1.5, 0.5],
    [n.E4, 2, 0.5], [n.G4, 2.5, 0.5],
    [n.C4, 3, 0.75], [n.D4, 3.75, 0.25],
    [n.E4, 4, 0.5], [n.G4, 4.5, 0.5],
    [n.A4, 5, 0.25], [n.C5, 5.25, 0.25], [n.A4, 5.5, 0.5],
    [n.G4, 6, 0.5], [n.E4, 6.5, 0.25], [n.D4, 6.75, 0.25],
    [n.C4, 7, 1.0],
  ];

  // 8-beat variation (bars 3-4)
  const melB: [number, number, number][] = [
    [n.G4, 0, 0.5], [n.A4, 0.5, 0.5],
    [n.C5, 1, 0.25], [n.D5, 1.25, 0.25], [n.C5, 1.5, 0.5],
    [n.A4, 2, 0.5], [n.G4, 2.5, 0.5],
    [n.E4, 3, 0.75], [n.D4, 3.75, 0.25],
    [n.E4, 4, 0.5], [n.G4, 4.5, 0.5],
    [n.A4, 5, 0.5], [n.G4, 5.5, 0.5],
    [n.E4, 6, 0.5], [n.C4, 6.5, 0.5],
    [n.D4, 7, 0.5], [n.C4, 7.5, 0.5],
  ];

  // 8-beat bass groove [freq, beatOffset, beatDuration]
  const bassLine: [number, number, number][] = [
    [n.C3, 0, 0.8], [n.C3, 1, 0.4], [n.C3, 1.5, 0.4],
    [n.F3, 2, 0.8], [n.F3, 3, 0.8],
    [n.G3, 4, 0.8], [n.G3, 5, 0.4], [n.A3, 5.5, 0.4],
    [n.F3, 6, 0.8], [n.F3, 7, 0.4], [n.C3, 7.5, 0.4],
  ];

  // Chord stabs [freqs[], beatOffset, duration]
  const chordStabs: [number[], number, number][] = [
    [[n.C4, n.E4, n.G4], 0, 0.12],
    [[n.F3, n.A3, n.C4], 2, 0.12],
    [[n.G3, n.B4, n.D5], 4, 0.12],
    [[n.F3, n.A3, n.C4], 6, 0.12],
  ];

  let stopped = false;
  let bar = 0;
  let nextStart = ctx.currentTime + 0.05;
  const LOOP_BEATS = 8;

  function scheduleBar() {
    if (stopped) return;

    const mel = bar % 4 < 2 ? melA : melB;

    for (const [freq, off, dur] of mel) {
      scheduleNote(ctx, master, freq, nextStart + off * B, dur * B * 0.88, 'sine', 0.18);
    }
    for (const [freq, off, dur] of bassLine) {
      scheduleNote(ctx, master, freq, nextStart + off * B, dur * B, 'triangle', 0.28);
    }
    for (const [freqs, off, dur] of chordStabs) {
      for (const freq of freqs) {
        scheduleNote(ctx, master, freq, nextStart + off * B, dur * B, 'sawtooth', 0.04);
      }
    }

    bar++;
    nextStart += LOOP_BEATS * B;

    const msUntilNext = Math.max(0, (nextStart - ctx.currentTime - 0.6) * 1000);
    setTimeout(scheduleBar, msUntilNext);
  }

  scheduleBar();

  return () => {
    stopped = true;
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    } catch { /* ignore */ }
  };
}

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.3) {
  try {
    const ctx = getCtx();
    const doPlay = () => {
      try {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gainNode.gain.setValueAtTime(gain, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch { /* ignore */ }
    };
    if (ctx.state === 'running') {
      doPlay();
    } else {
      ctx.resume().then(doPlay).catch(() => {});
    }
  } catch { /* ignore */ }
}

export function useSounds() {
  // startMusic / stopMusic are module-level — stable references, no hook overhead

  const playCardSlap = useCallback(() => {
    playTone(220, 0.07, 'triangle', 0.35);
  }, []);

  const playDraw = useCallback(() => {
    playTone(380, 0.12, 'sine', 0.18);
    setTimeout(() => playTone(320, 0.08, 'sine', 0.12), 50);
  }, []);

  const playDutch = useCallback(() => {
    try {
      const ctx = getCtx();
      [523, 659, 784, 1047].forEach((freq, i) => {
        scheduleNote(ctx, ctx.destination, freq, ctx.currentTime + i * 0.13, 0.2, 'square', 0.25);
      });
    } catch { /* ignore */ }
  }, []);

  const playError = useCallback(() => {
    playTone(160, 0.1, 'sawtooth', 0.18);
  }, []);

  return { playCardSlap, playDraw, playDutch, playError, startMusic, stopMusic };
}
