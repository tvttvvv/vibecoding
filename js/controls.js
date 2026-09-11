(function (global) {
  'use strict';

  const LOOK_SENS = 0.0042;
  const DRAG_THRESHOLD = 9;
  const HOLD_MS = 180;
  const JOY_RADIUS = 46;

  const state = {
    move: { x: 0, y: 0 },
    jump: false,
    up: false,
    down: false,
    lookDX: 0,
    lookDY: 0,
    mining: false
  };

  let joyTouch = null;
  let lookTouch = null;
  let onTap = null;

  function bindHold(el, setter) {
    if (!el) return;
    const on = (e) => { e.preventDefault(); setter(true); };
    const off = (e) => { e.preventDefault(); setter(false); };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
    el.addEventListener('mousedown', on);
    window.addEventListener('mouseup', () => setter(false));
  }

  function bindTap(el, handler) {
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); handler(e); }, { passive: false });
    el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handler(e); });
  }

  function init(opts) {
    const joyZone = opts.joystick;
    const knob = opts.knob;
    const worldZone = opts.worldZone;
    onTap = opts.onTap;

    function setKnob(dx, dy) {
      const dist = Math.min(JOY_RADIUS, Math.hypot(dx, dy));
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

    joyZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (joyTouch !== null) return;
      const t = e.changedTouches[0];
      joyTouch = t.identifier;
      const r = joyZone.getBoundingClientRect();
      setKnob(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
    }, { passive: false });

    joyZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== joyTouch) continue;
        const r = joyZone.getBoundingClientRect();
        setKnob(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
      }
    }, { passive: false });

    const endJoy = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyTouch) { joyTouch = null; resetKnob(); }
      }
    };
    joyZone.addEventListener('touchend', endJoy, { passive: true });
    joyZone.addEventListener('touchcancel', endJoy, { passive: true });

    worldZone.addEventListener('touchstart', (e) => {
      if (lookTouch !== null) return;
      const t = e.changedTouches[0];
      lookTouch = {
        id: t.identifier,
        x: t.clientX, y: t.clientY,
        startX: t.clientX, startY: t.clientY,
        startTime: performance.now(),
        dragged: false
      };
    }, { passive: true });

    worldZone.addEventListener('touchmove', (e) => {
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
      if (!lookTouch) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== lookTouch.id) continue;
        const held = performance.now() - lookTouch.startTime;
        if (!lookTouch.dragged && held < HOLD_MS && onTap) onTap();
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
      if (lookTouch !== null) return;
      lookTouch = {
        id: 'mouse',
        x: e.clientX, y: e.clientY,
        startX: e.clientX, startY: e.clientY,
        startTime: performance.now(),
        dragged: false
      };
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
      if (!lookTouch.dragged && held < HOLD_MS && onTap) onTap();
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
    }
  }

  function consumeLook() {
    const d = { x: state.lookDX, y: state.lookDY };
    state.lookDX = 0;
    state.lookDY = 0;
    return d;
  }

  global.Controls = { state, init, tickHold, consumeLook, bindTap, bindHold, LOOK_SENS };
})(window);
