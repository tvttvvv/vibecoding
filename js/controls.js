(function (global) {
  'use strict';

  const LOOK_SENS = 0.0042;
  const DRAG_THRESHOLD = 9;
  const HOLD_MS = 180;
  const JOY_RADIUS = 46;
  const JOY_DEADZONE = 7;

  const state = {
    move: { x: 0, y: 0 },
    jump: false,
    up: false,
    down: false,
    lookDX: 0,
    lookDY: 0,
    mining: false,
    // where on screen the interaction is aimed, Bedrock-style: the block you
    // touch is the block you hit, rather than whatever a centre crosshair sees
    pointX: 0,
    pointY: 0
  };

  let joyTouch = null;
  let lookTouch = null;
  let onTap = null;

  // Touch devices replay every touch as a compatibility mouse/click burst, and
  // a touchstart inside a scroller is not cancelable, so preventDefault cannot
  // suppress it. Every mouse path below is therefore skipped right after a
  // touch, otherwise each gesture runs twice and undoes itself.
  let lastTouchAt = -1e9;
  function markTouch() { lastTouchAt = performance.now(); }
  function recentTouch() { return performance.now() - lastTouchAt < 700; }

  function bindHold(el, setter) {
    if (!el) return;
    const on = (e) => { if (e.cancelable) e.preventDefault(); setter(true); };
    const off = (e) => { if (e.cancelable) e.preventDefault(); setter(false); };
    el.addEventListener('touchstart', (e) => { markTouch(); on(e); }, { passive: false });
    el.addEventListener('touchend', (e) => { markTouch(); off(e); }, { passive: false });
    el.addEventListener('touchcancel', (e) => { markTouch(); off(e); }, { passive: false });
    el.addEventListener('mousedown', (e) => { if (!recentTouch()) on(e); });
    window.addEventListener('mouseup', () => { if (!recentTouch()) setter(false); });
  }

  function bindTap(el, handler) {
    if (!el) return;
    el.addEventListener('touchstart', (e) => {
      markTouch();
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      handler(e);
    }, { passive: false });
    el.addEventListener('click', (e) => {
      if (recentTouch()) return;
      e.preventDefault();
      e.stopPropagation();
      handler(e);
    });
  }

  function init(opts) {
    const joyZone = opts.joystick;
    const joyVisual = opts.joyVisual;
    const knob = opts.knob;
    const worldZone = opts.worldZone;
    onTap = opts.onTap;

    let joyOrigin = { x: 0, y: 0 };

    function restPosition() {
      return { x: 104, y: window.innerHeight - 150 };
    }

    function placeVisual(x, y) {
      joyVisual.style.left = x + 'px';
      joyVisual.style.top = y + 'px';
    }

    function goHome() {
      const p = restPosition();
      placeVisual(p.x, p.y);
    }
    goHome();
    window.addEventListener('resize', () => { if (joyTouch === null) goHome(); });

    function setKnob(dx, dy) {
      const raw = Math.hypot(dx, dy);
      if (raw < JOY_DEADZONE) {
        knob.style.transform = 'translate(0px,0px)';
        state.move.x = 0;
        state.move.y = 0;
        return;
      }
      const dist = Math.min(JOY_RADIUS, raw);
      const ang = Math.atan2(dy, dx);
      const kx = Math.cos(ang) * dist, ky = Math.sin(ang) * dist;
      knob.style.transform = 'translate(' + kx + 'px,' + ky + 'px)';
      state.move.x = kx / JOY_RADIUS;
      state.move.y = -ky / JOY_RADIUS;
    }

    function resetKnob() {
      knob.style.transform = 'translate(0px,0px)';
      state.move.x = 0;
      state.move.y = 0;
    }

    function startJoy(x, y, id) {
      joyTouch = id;
      joyOrigin.x = x;
      joyOrigin.y = y;
      placeVisual(x, y);
      joyVisual.classList.add('active');
      resetKnob();
    }

    function endJoy() {
      joyTouch = null;
      resetKnob();
      joyVisual.classList.remove('active');
      goHome();
    }

    joyZone.addEventListener('touchstart', (e) => {
      markTouch();
      if (e.cancelable) e.preventDefault();
      if (joyTouch !== null) return;
      const t = e.changedTouches[0];
      startJoy(t.clientX, t.clientY, t.identifier);
    }, { passive: false });

    joyZone.addEventListener('touchmove', (e) => {
      markTouch();
      if (e.cancelable) e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== joyTouch) continue;
        setKnob(t.clientX - joyOrigin.x, t.clientY - joyOrigin.y);
      }
    }, { passive: false });

    const onJoyEnd = (e) => {
      markTouch();
      for (const t of e.changedTouches) {
        if (t.identifier === joyTouch) endJoy();
      }
    };
    joyZone.addEventListener('touchend', onJoyEnd, { passive: true });
    joyZone.addEventListener('touchcancel', onJoyEnd, { passive: true });

    joyZone.addEventListener('mousedown', (e) => {
      if (recentTouch() || joyTouch !== null) return;
      startJoy(e.clientX, e.clientY, 'mouse');
    });
    window.addEventListener('mousemove', (e) => {
      if (joyTouch !== 'mouse') return;
      setKnob(e.clientX - joyOrigin.x, e.clientY - joyOrigin.y);
    });
    window.addEventListener('mouseup', () => {
      if (joyTouch === 'mouse') endJoy();
    });

    worldZone.addEventListener('touchstart', (e) => {
      markTouch();
      if (lookTouch !== null) return;
      const t = e.changedTouches[0];
      lookTouch = {
        id: t.identifier,
        x: t.clientX, y: t.clientY,
        startX: t.clientX, startY: t.clientY,
        startTime: performance.now(),
        dragged: false
      };
      state.pointX = t.clientX;
      state.pointY = t.clientY;
    }, { passive: true });

    worldZone.addEventListener('touchmove', (e) => {
      markTouch();
      if (!lookTouch) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== lookTouch.id) continue;
        const dx = t.clientX - lookTouch.x;
        const dy = t.clientY - lookTouch.y;
        lookTouch.x = t.clientX;
        lookTouch.y = t.clientY;
        const total = Math.hypot(t.clientX - lookTouch.startX, t.clientY - lookTouch.startY);
        if (total > DRAG_THRESHOLD) {
          lookTouch.dragged = true;
          state.mining = false;
        }
        if (lookTouch.dragged) {
          state.lookDX += dx;
          state.lookDY += dy;
        }
      }
    }, { passive: true });

    const endLook = (e) => {
      markTouch();
      if (!lookTouch) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== lookTouch.id) continue;
        const held = performance.now() - lookTouch.startTime;
        if (!lookTouch.dragged && held < HOLD_MS && onTap) onTap(lookTouch.startX, lookTouch.startY);
        lookTouch = null;
        state.mining = false;
      }
    };
    worldZone.addEventListener('touchend', endLook, { passive: true });
    worldZone.addEventListener('touchcancel', endLook, { passive: true });

    bindHold(opts.jumpBtn, (v) => { state.jump = v; });
    bindHold(opts.upBtn, (v) => { state.up = v; });
    bindHold(opts.downBtn, (v) => { state.down = v; });

    initMouseFallback(worldZone);
    initKeyboardFallback();
  }

  function initMouseFallback(worldZone) {
    worldZone.addEventListener('mousedown', (e) => {
      if (recentTouch() || lookTouch !== null) return;
      lookTouch = {
        id: 'mouse',
        x: e.clientX, y: e.clientY,
        startX: e.clientX, startY: e.clientY,
        startTime: performance.now(),
        dragged: false
      };
      state.pointX = e.clientX;
      state.pointY = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!lookTouch || lookTouch.id !== 'mouse') return;
      const dx = e.clientX - lookTouch.x, dy = e.clientY - lookTouch.y;
      lookTouch.x = e.clientX;
      lookTouch.y = e.clientY;
      if (Math.hypot(e.clientX - lookTouch.startX, e.clientY - lookTouch.startY) > DRAG_THRESHOLD) {
        lookTouch.dragged = true;
        state.mining = false;
      }
      if (lookTouch.dragged) { state.lookDX += dx; state.lookDY += dy; }
    });
    window.addEventListener('mouseup', () => {
      if (!lookTouch || lookTouch.id !== 'mouse') return;
      const held = performance.now() - lookTouch.startTime;
      if (!lookTouch.dragged && held < HOLD_MS && onTap) onTap(lookTouch.startX, lookTouch.startY);
      lookTouch = null;
      state.mining = false;
    });
  }

  function initKeyboardFallback() {
    const keys = {};
    const apply = () => {
      state.move.x = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0);
      state.move.y = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
      state.jump = !!keys[' '];
      state.up = !!keys[' '];
      state.down = !!keys['shift'];
    };
    window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; apply(); });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; apply(); });
  }

  function tickHold() {
    if (lookTouch && !lookTouch.dragged && performance.now() - lookTouch.startTime > HOLD_MS) {
      state.mining = true;
      state.pointX = lookTouch.startX;
      state.pointY = lookTouch.startY;
    }
  }

  function consumeLook() {
    const d = { x: state.lookDX, y: state.lookDY };
    state.lookDX = 0;
    state.lookDY = 0;
    return d;
  }

  global.Controls = { state, init, tickHold, consumeLook, bindTap, bindHold, markTouch, recentTouch, LOOK_SENS };
})(window);
