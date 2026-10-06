(function (global) {
  'use strict';

  // Every sound is synthesised on the spot with WebAudio: no recordings are
  // shipped. Each material gets its own colour of noise so stone clicks, dirt
  // thuds, wood knocks, sand hisses and glass rings.
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  const MATERIAL = {
    stone: { freq: 2600, q: 0.9, dur: 0.11, gain: 0.5 },
    dirt: { freq: 700, q: 0.7, dur: 0.12, gain: 0.55 },
    grass: { freq: 1100, q: 0.6, dur: 0.13, gain: 0.45 },
    wood: { freq: 520, q: 3.5, dur: 0.1, gain: 0.7 },
    sand: { freq: 3800, q: 0.5, dur: 0.16, gain: 0.3 },
    glass: { freq: 5200, q: 6, dur: 0.22, gain: 0.35 },
    wool: { freq: 380, q: 0.5, dur: 0.12, gain: 0.35 },
    snow: { freq: 2200, q: 0.4, dur: 0.14, gain: 0.3 }
  };

  function materialOf(id) {
    const B = Blocks;
    const d = B.byId[id];
    if (d && d.leaves) return 'grass';
    if (d && (d.log || d.planks)) return 'wood';
    if (id === B.GRASS || id === B.LEAVES || id === B.SNOW_GRASS || id === B.TALL_GRASS ||
        id === B.DANDELION || id === B.POPPY || id >= B.WHEAT_0 && id <= B.WHEAT_3) return 'grass';
    if (id === B.DIRT || id === B.GRAVEL || id === B.FARMLAND) return 'dirt';
    if (id === B.SAND) return 'sand';
    if (id === B.SNOW) return 'snow';
    if (id === B.GLASS) return 'glass';
    if (id === B.WOOL || id === B.BED) return 'wool';
    if (id === B.LOG || id === B.PLANKS || id === B.CRAFTING_TABLE || id === B.CHEST ||
        id === B.TORCH) return 'wood';
    return 'stone';
  }

  const Sound = { enabled: true, volume: 0.7 };

  // browsers only allow audio after the player has touched something
  Sound.unlock = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      this.enabled = false;
    }
  };

  Sound.setVolume = function (v) {
    this.volume = v;
    if (master) master.gain.value = v;
  };

  function ready() {
    return Sound.enabled && ctx && ctx.state === 'running' && Sound.volume > 0;
  }

  // distance fall-off from the listener, for things happening out in the world
  function att(dist) {
    if (dist === undefined) return 1;
    return Math.max(0, 1 - dist / 22);
  }

  function noise(opts) {
    if (!ready()) return;
    const t = ctx.currentTime + (opts.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = opts.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.type || 'bandpass';
    f.frequency.value = opts.freq * (0.9 + Math.random() * 0.2);
    f.Q.value = opts.q || 1;
    const g = ctx.createGain();
    const peak = opts.gain * att(opts.dist);
    if (peak <= 0.001) return;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5, opts.dur + 0.05);
  }

  function tone(opts) {
    if (!ready()) return;
    const t = ctx.currentTime + (opts.delay || 0);
    const o = ctx.createOscillator();
    o.type = opts.wave || 'sine';
    o.frequency.setValueAtTime(opts.from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + opts.dur);
    const g = ctx.createGain();
    const peak = opts.gain * att(opts.dist);
    if (peak <= 0.001) return;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    o.connect(g); g.connect(master);
    o.start(t);
    o.stop(t + opts.dur + 0.05);
  }

  Sound.dig = function (id, dist) {
    const m = MATERIAL[materialOf(id)];
    noise({ freq: m.freq, q: m.q, dur: m.dur * 0.8, gain: m.gain * 0.45, dist });
  };

  Sound.breakBlock = function (id, dist) {
    const m = MATERIAL[materialOf(id)];
    noise({ freq: m.freq, q: m.q, dur: m.dur * 1.8, gain: m.gain, dist });
    noise({ freq: m.freq * 0.6, q: m.q, dur: m.dur * 1.4, gain: m.gain * 0.6, delay: 0.03, dist });
    if (materialOf(id) === 'glass') {
      for (let i = 0; i < 3; i++) tone({ from: 2400 + i * 700, to: 1800, dur: 0.18, gain: 0.08, delay: i * 0.03, dist });
    }
  };

  Sound.place = function (id, dist) {
    const m = MATERIAL[materialOf(id)];
    noise({ freq: m.freq * 0.8, q: m.q, dur: m.dur * 1.2, gain: m.gain * 0.8, dist });
  };

  Sound.step = function (id) {
    const m = MATERIAL[materialOf(id)];
    noise({ freq: m.freq, q: m.q, dur: m.dur * 0.7, gain: m.gain * 0.22 });
  };

  Sound.pop = function () {
    tone({ from: 700 + Math.random() * 400, to: 1500, dur: 0.07, gain: 0.18, wave: 'sine' });
  };

  Sound.xp = function () {
    tone({ from: 1400 + Math.random() * 500, to: 1900, dur: 0.1, gain: 0.1, wave: 'triangle' });
    tone({ from: 2100, to: 2600, dur: 0.08, gain: 0.06, wave: 'sine', delay: 0.04 });
  };

  Sound.levelUp = function () {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone({ from: f, to: f * 1.01, dur: 0.22, gain: 0.12, wave: 'triangle', delay: i * 0.07 }));
  };

  Sound.hurt = function () {
    tone({ from: 320, to: 150, dur: 0.18, gain: 0.35, wave: 'square' });
    noise({ freq: 900, q: 0.8, dur: 0.12, gain: 0.25 });
  };

  Sound.eat = function () {
    for (let i = 0; i < 3; i++) {
      noise({ freq: 1800 + Math.random() * 800, q: 1.5, dur: 0.07, gain: 0.35, delay: i * 0.14 });
    }
  };

  Sound.burp = function () {
    tone({ from: 140, to: 90, dur: 0.3, gain: 0.3, wave: 'sawtooth', delay: 0.45 });
  };

  Sound.swing = function () {
    noise({ freq: 1400, q: 0.4, dur: 0.12, gain: 0.08, type: 'highpass' });
  };

  Sound.hit = function (dist) {
    noise({ freq: 600, q: 1, dur: 0.1, gain: 0.5, dist });
    tone({ from: 180, to: 90, dur: 0.1, gain: 0.25, wave: 'square', dist });
  };

  Sound.crit = function (dist) {
    noise({ freq: 3200, q: 2, dur: 0.14, gain: 0.35, dist });
  };

  Sound.explode = function (dist) {
    const d = dist === undefined ? 0 : dist * 0.4;
    noise({ freq: 180, q: 0.4, dur: 1.4, gain: 1.0, type: 'lowpass', dist: d, rate: 0.5 });
    noise({ freq: 900, q: 0.5, dur: 0.5, gain: 0.6, dist: d });
    tone({ from: 90, to: 30, dur: 0.9, gain: 0.6, wave: 'sine', dist: d });
  };

  Sound.fuse = function (dist) {
    noise({ freq: 4200, q: 0.6, dur: 0.9, gain: 0.25, type: 'highpass', dist });
  };

  Sound.bow = function (dist) {
    noise({ freq: 2400, q: 0.8, dur: 0.18, gain: 0.25, dist });
  };

  Sound.splash = function () {
    noise({ freq: 900, q: 0.4, dur: 0.5, gain: 0.45, type: 'lowpass' });
    noise({ freq: 3000, q: 0.5, dur: 0.35, gain: 0.2, delay: 0.05 });
  };

  Sound.portal = function () {
    tone({ from: 110, to: 330, dur: 1.4, gain: 0.25, wave: 'sine' });
    tone({ from: 160, to: 120, dur: 1.6, gain: 0.18, wave: 'triangle', delay: 0.1 });
    noise({ freq: 700, q: 0.4, dur: 1.2, gain: 0.15, type: 'lowpass' });
  };

  // the legendary weapons
  Sound.legend = function () {
    [392, 523, 659, 784, 1046].forEach((f, i) =>
      tone({ from: f, to: f * 1.005, dur: 0.5, gain: 0.12, wave: 'triangle', delay: i * 0.09 }));
    tone({ from: 1568, to: 2093, dur: 0.9, gain: 0.06, wave: 'sine', delay: 0.45 });
  };

  Sound.wave = function (dist) {
    noise({ freq: 2400, q: 0.7, dur: 0.28, gain: 0.22, type: 'highpass', dist });
    tone({ from: 880, to: 1760, dur: 0.22, gain: 0.08, wave: 'sine', dist });
  };

  Sound.charge = function () {
    tone({ from: 180, to: 1400, dur: 1.0, gain: 0.08, wave: 'sawtooth' });
    tone({ from: 360, to: 2200, dur: 1.0, gain: 0.04, wave: 'sine' });
  };

  Sound.beam = function (dist) {
    tone({ from: 1800, to: 120, dur: 0.6, gain: 0.22, wave: 'sawtooth', dist });
    tone({ from: 2600, to: 400, dur: 0.45, gain: 0.12, wave: 'square', dist });
    noise({ freq: 900, q: 0.5, dur: 0.5, gain: 0.25, type: 'lowpass', dist });
  };

  Sound.fizz = function (dist) {
    noise({ freq: 5200, q: 0.4, dur: 0.6, gain: 0.35, type: 'highpass', dist });
  };

  Sound.bucket = function (lava) {
    noise({ freq: lava ? 500 : 1200, q: 0.6, dur: 0.35, gain: 0.35, type: 'lowpass' });
  };

  Sound.door = function () {
    noise({ freq: 380, q: 4, dur: 0.18, gain: 0.5 });
  };

  Sound.chest = function (open) {
    tone({ from: open ? 180 : 240, to: open ? 260 : 150, dur: 0.25, gain: 0.25, wave: 'sawtooth' });
    noise({ freq: 500, q: 2, dur: 0.2, gain: 0.3 });
  };

  Sound.brew = function () {
    tone({ from: 600, to: 900, dur: 0.15, gain: 0.12, wave: 'sine' });
    tone({ from: 900, to: 1200, dur: 0.15, gain: 0.1, wave: 'sine', delay: 0.12 });
  };

  Sound.piston = function (dist, out) {
    tone({ from: out ? 220 : 180, to: out ? 160 : 240, dur: 0.12, gain: 0.25, wave: 'square', dist });
    tone({ from: 90, to: 70, dur: 0.1, gain: 0.25, wave: 'sawtooth', delay: 0.02, dist });
  };

  Sound.click = function () {
    tone({ from: 900, to: 700, dur: 0.05, gain: 0.12, wave: 'square' });
  };

  // the mobs, each with a voice of its own
  Sound.mob = function (type, kind, dist) {
    const d = dist;
    switch (type) {
      case 'zombie':
        tone({ from: kind === 'hurt' ? 170 : 110, to: 70, dur: 0.7, gain: 0.3, wave: 'sawtooth', dist: d });
        tone({ from: 116, to: 76, dur: 0.7, gain: 0.2, wave: 'sawtooth', dist: d });
        break;
      case 'skeleton':
        for (let i = 0; i < 4; i++) noise({ freq: 2600, q: 5, dur: 0.05, gain: 0.3, delay: i * 0.06, dist: d });
        break;
      case 'creeper':
        if (kind === 'hurt') tone({ from: 400, to: 200, dur: 0.2, gain: 0.25, wave: 'square', dist: d });
        break;
      case 'spider':
        noise({ freq: 1800, q: 3, dur: 0.35, gain: 0.25, dist: d });
        tone({ from: 90, to: 60, dur: 0.3, gain: 0.15, wave: 'sawtooth', dist: d });
        break;
      case 'pig':
        tone({ from: 320, to: 250, dur: 0.18, gain: 0.25, wave: 'sawtooth', dist: d });
        tone({ from: 300, to: 230, dur: 0.14, gain: 0.2, wave: 'sawtooth', delay: 0.2, dist: d });
        break;
      case 'cow':
        tone({ from: 150, to: 110, dur: 0.9, gain: 0.3, wave: 'sawtooth', dist: d });
        break;
      case 'sheep':
        for (let i = 0; i < 5; i++) tone({ from: 480, to: 440, dur: 0.08, gain: 0.18, wave: 'sawtooth', delay: i * 0.08, dist: d });
        break;
      case 'villager':
        tone({ from: 260, to: 200, dur: 0.18, gain: 0.25, wave: 'sawtooth', dist: d });
        tone({ from: 230, to: 300, dur: 0.16, gain: 0.2, wave: 'sawtooth', delay: 0.17, dist: d });
        break;
      case 'ghast':
        tone({ from: kind === 'shoot' ? 700 : 520, to: kind === 'shoot' ? 300 : 460, dur: 0.9, gain: 0.3, wave: 'sine', dist: d * 0.5 });
        tone({ from: 780, to: 700, dur: 0.8, gain: 0.12, wave: 'triangle', delay: 0.05, dist: d * 0.5 });
        break;
      case 'enderman':
        tone({ from: kind === 'angry' ? 500 : 300, to: kind === 'angry' ? 120 : 260, dur: kind === 'angry' ? 0.8 : 0.4, gain: 0.25, wave: 'sawtooth', dist: d });
        tone({ from: 90, to: 60, dur: 0.5, gain: 0.2, wave: 'sine', delay: 0.1, dist: d });
        break;
      case 'dragon':
        tone({ from: 110, to: 60, dur: 1.4, gain: 0.35, wave: 'sawtooth', dist: d * 0.3 });
        tone({ from: 160, to: 90, dur: 1.2, gain: 0.2, wave: 'square', delay: 0.2, dist: d * 0.3 });
        break;
      case 'blaze':
        tone({ from: kind === 'shoot' ? 260 : 180, to: kind === 'shoot' ? 120 : 160, dur: 0.35, gain: 0.25, wave: 'sawtooth', dist: d });
        tone({ from: 90, to: 70, dur: 0.4, gain: 0.2, wave: 'triangle', delay: 0.05, dist: d });
        break;
      case 'wskeleton':
        tone({ from: 300, to: 200, dur: 0.12, gain: 0.25, wave: 'square', dist: d });
        tone({ from: 220, to: 150, dur: 0.12, gain: 0.2, wave: 'square', delay: 0.1, dist: d });
        break;
      case 'piglin':
        tone({ from: 240, to: 180, dur: 0.18, gain: 0.3, wave: 'sawtooth', dist: d });
        tone({ from: 200, to: 260, dur: 0.14, gain: 0.2, wave: 'square', delay: 0.16, dist: d });
        break;
      case 'slime':
        tone({ from: 140, to: 90, dur: 0.12, gain: 0.3, wave: 'sine', dist: d });
        break;
      case 'zpiglin':
        tone({ from: 180, to: 120, dur: 0.3, gain: 0.3, wave: 'sawtooth', dist: d });
        tone({ from: 150, to: 90, dur: 0.25, gain: 0.2, wave: 'square', delay: 0.2, dist: d });
        break;
      case 'chicken':
        tone({ from: 1400, to: 900, dur: 0.08, gain: 0.18, wave: 'square', dist: d });
        tone({ from: 1300, to: 800, dur: 0.1, gain: 0.15, wave: 'square', delay: 0.12, dist: d });
        break;
    }
  };

  global.Sound = Sound;
})(window);
