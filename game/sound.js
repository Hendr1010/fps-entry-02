// sound.js — every sound is synthesized with WebAudio: no audio files.
// One job: short, punchy effects for shots, hits, reloads, explosions,
// planting and round results. Silent until the first user gesture unlocks
// the audio context.

export function createSound() {
  return { ctx: null, master: null, unlocked: false };
}

function ensure(s) {
  if (s.ctx) return s.ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    s.ctx = new AC();
    s.master = s.ctx.createGain();
    s.master.gain.value = 0.35;
    s.master.connect(s.ctx.destination);
    s.unlocked = true;
  } catch (e) {
    s.ctx = null;
  }
  return s.ctx;
}

export function unlockSound(s) {
  const ctx = ensure(s);
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function noiseBuffer(ctx, seconds) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function burst(s, { dur, freq, type = 'lowpass', gain = 0.5, slide = 0 }) {
  const ctx = ensure(s);
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (slide) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(s.master);
  src.start(t);
  src.stop(t + dur);
}

function tone(s, { freq, dur, type = 'sine', gain = 0.3, slide = 0 }) {
  const ctx = ensure(s);
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(s.master);
  o.start(t);
  o.stop(t + dur);
}

export function playSound(s, name, opt = {}) {
  if (!s.unlocked && name !== 'unlock') ensure(s);
  switch (name) {
    case 'shot':
      burst(s, { dur: 0.12, freq: opt.low ? 900 : 2200, gain: 0.55, slide: -1600 });
      tone(s, { freq: 160, dur: 0.09, type: 'square', gain: 0.18, slide: -80 });
      break;
    case 'shotgun':
      burst(s, { dur: 0.22, freq: 1400, gain: 0.7, slide: -1100 });
      break;
    case 'sniper':
      burst(s, { dur: 0.3, freq: 3200, gain: 0.6, slide: -2600 });
      break;
    case 'dry':
      tone(s, { freq: 1400, dur: 0.03, type: 'square', gain: 0.15 });
      break;
    case 'reload':
      tone(s, { freq: 700, dur: 0.05, type: 'square', gain: 0.14 });
      setTimeout(() => tone(s, { freq: 950, dur: 0.05, type: 'square', gain: 0.14 }), 180);
      break;
    case 'hit':
      tone(s, { freq: 1900, dur: 0.05, type: 'sine', gain: 0.25 });
      break;
    case 'kill':
      tone(s, { freq: 880, dur: 0.09, type: 'sine', gain: 0.28 });
      setTimeout(() => tone(s, { freq: 1320, dur: 0.12, type: 'sine', gain: 0.24 }), 90);
      break;
    case 'hurt':
      burst(s, { dur: 0.15, freq: 500, gain: 0.4, slide: -300 });
      break;
    case 'explosion':
      burst(s, { dur: 0.9, freq: 900, gain: 0.9, slide: -800 });
      tone(s, { freq: 70, dur: 0.8, type: 'sine', gain: 0.5, slide: -40 });
      break;
    case 'plant':
      tone(s, { freq: 1200, dur: 0.07, type: 'square', gain: 0.2 });
      break;
    case 'beep':
      tone(s, { freq: 1500, dur: 0.06, type: 'square', gain: 0.16 });
      break;
    case 'win':
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone(s, { freq: f, dur: 0.16, gain: 0.22 }), i * 130));
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone(s, { freq: f, dur: 0.18, gain: 0.2 }), i * 140));
      break;
    case 'buy':
      tone(s, { freq: 1000, dur: 0.06, type: 'sine', gain: 0.2 });
      setTimeout(() => tone(s, { freq: 1400, dur: 0.08, type: 'sine', gain: 0.18 }), 70);
      break;
    case 'step':
      burst(s, { dur: 0.05, freq: 300, gain: 0.08 });
      break;
    default:
      break;
  }
}
