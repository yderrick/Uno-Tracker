/* Uno Tracker — confetti, card-slap sounds and the UNO! shout. */
(function () {
  'use strict';

  const COLORS = ['#E8212E', '#FFC400', '#19A54A', '#0A6FD8', '#ffffff'];
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let canvas;
  let ctx;
  let parts = [];
  let raf = 0;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.getElementById('fx');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    addEventListener('resize', size);
  }

  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.y < innerHeight + 40 && p.life-- > 0);
    parts.forEach((p) => {
      p.vy += 0.18;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      // tiny Uno cards
      const w = p.s;
      const h = p.s * 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 2);
      else ctx.rect(-w / 2, -h / 2, w, h);
      ctx.fill();
      if (p.c !== '#ffffff') {
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.3, h * 0.36, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
    if (parts.length) raf = requestAnimationFrame(tick);
    else {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      raf = 0;
    }
  }

  function confetti({ x = innerWidth / 2, y = innerHeight / 3, count = 140, spread = 1 } = {}) {
    if (reduced()) return;
    ensureCanvas();
    if (!ctx) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (4 + Math.random() * 9) * spread;
      parts.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 6,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.4,
        s: 6 + Math.random() * 7,
        c: COLORS[i % COLORS.length],
        life: 260,
      });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }

  /* ----------------------------------------------------------------- sound */
  let ac = null;
  const muteKey = 'uno-tracker:muted';
  let muted = false;
  try {
    muted = localStorage.getItem(muteKey) === '1';
  } catch (e) {}

  function audio() {
    if (muted) return null;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      return ac;
    } catch (e) {
      return null;
    }
  }

  function tone(freq, start, dur, type = 'square', vol = 0.08) {
    const a = audio();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, a.currentTime + start);
    g.gain.setValueAtTime(0.0001, a.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol, a.currentTime + start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
    o.connect(g).connect(a.destination);
    o.start(a.currentTime + start);
    o.stop(a.currentTime + start + dur + 0.02);
  }

  function slap() {
    const a = audio();
    if (!a) return;
    const len = 0.09;
    const buf = a.createBuffer(1, a.sampleRate * len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = a.createBufferSource();
    const f = a.createBiquadFilter();
    const g = a.createGain();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    g.gain.value = 0.5;
    src.buffer = buf;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  }

  const sounds = {
    slap,
    round() {
      slap();
      tone(660, 0.05, 0.12, 'triangle');
      tone(990, 0.14, 0.18, 'triangle');
    },
    uno() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.16, 'square', 0.06));
    },
    fanfare() {
      [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.52], [1047, 0.64]].forEach(([f, t]) => tone(f, t, 0.22, 'sawtooth', 0.05));
    },
    oops() {
      tone(330, 0, 0.18, 'sawtooth', 0.05);
      tone(220, 0.16, 0.3, 'sawtooth', 0.05);
    },
    click() {
      tone(1200, 0, 0.04, 'square', 0.03);
    },
  };

  window.UnoFX = {
    confetti,
    sound: (name) => {
      try {
        sounds[name] && sounds[name]();
      } catch (e) {}
    },
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem(muteKey, muted ? '1' : '0');
      } catch (e) {}
      return muted;
    },
    reduced,
  };
})();
