(function (global) {
  'use strict';

  const BASE_LOOK_SENS = 0.0042;
  const DRAG_THRESHOLD = 9;

  const state = {
    move: { x: 0, y: 0 },
    jump: false,
    up: false,
    down: false,
    run: false,
    sneak: false,
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
  let hooks = {};

  // Keyboard players get a different scheme entirely: pointer lock, a centre
  // crosshair, mouse buttons for mine and place. It turns itself on the first
  // time a movement key is pressed, so a phone never sees it.
  let keyboardMode = false;
  let pointerLocked = false;
  // the on-screen crouch button toggles, as Bedrock's does; Shift holds
  let sneakToggle = false;
  let sneakKey = false;
  let expectUnlock = false;

  function joyRadius() { return Settings ? Settings.get('joyRadius') : 46; }
  function joyDead() { return Settings ? Settings.get('joyDead') : 7; }
  function holdMs() { return Settings ? Settings.get('holdMs') : 180; }
  function lookSens() { return Settings ? Settings.lookSens() : BASE_LOOK_SENS; }
  function invertY() { return Settings ? Settings.bool('invertY') : false; }
  function cancelMineOnLook() { return Settings ? Settings.bool('cancelMine') : true; }

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
    hooks = opts.hooks || {};

    let joyOrigin = { x: 0, y: 0 };

    function restPosition() {
      return { x: 40 + joyRadius() * 1.4, y: window.innerHeight - 110 - joyRadius() };
    }

    function placeVisual(x, y) {
      joyVisual.style.left = x + 'px';
      joyVisual.style.top = y + 'px';
    }

    function goHome() {
      const p = restPosition();
      placeVisual(p.x, p.y);
      joyOrigin.x = p.x;
      joyOrigin.y = p.y;
    }
    goHome();
    window.addEventListener('resize', () => { if (joyTouch === null) goHome(); });
    if (global.Settings) {
      Settings.onChange = () => { if (joyTouch === null) goHome(); };
    }

    function setKnob(dx, dy) {
      const raw = Math.hypot(dx, dy);
      const R = joyRadius();
      if (raw < joyDead()) {
        knob.style.transform = 'translate(0px,0px)';
        state.move.x = 0;
        state.move.y = 0;
        state.run = false;
        return;
      }
      const dist = Math.min(R, raw);
      const ang = Math.atan2(dy, dx);
      const kx = Math.cos(ang) * dist, ky = Math.sin(ang) * dist;
      knob.style.transform = 'translate(' + kx + 'px,' + ky + 'px)';
      state.move.x = kx / R;
      state.move.y = -ky / R;
      state.run = raw > R * 0.94;
    }

    function resetKnob() {
      knob.style.transform = 'translate(0px,0px)';
      state.move.x = 0;
      state.move.y = 0;
      state.run = false;
    }

    function startJoy(x, y, id) {
      joyTouch = id;
      // a fixed stick always measures from its resting spot
      if (Settings && Settings.bool('joyFixed')) {
        const p = restPosition();
        joyOrigin.x = p.x;
        joyOrigin.y = p.y;
        placeVisual(p.x, p.y);
        joyVisual.classList.add('active');
        resetKnob();
        setKnob(x - p.x, y - p.y);
        return;
      }
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
      if (recentTouch() || joyTouch !== null || keyboardMode) return;
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
          if (!lookTouch.mining) state.mining = false;
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
        if (!lookTouch.dragged && held < holdMs() && onTap) onTap(lookTouch.startX, lookTouch.startY);
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
    initKeyboard(worldZone);
  }

  function initMouseFallback(worldZone) {
    worldZone.addEventListener('mousedown', (e) => {
      if (recentTouch() || lookTouch !== null) return;
      if (keyboardMode) { onLockedMouseDown(e, worldZone); return; }
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
      if (pointerLocked) {
        state.lookDX += e.movementX || 0;
        state.lookDY += e.movementY || 0;
        return;
      }
      if (!lookTouch || lookTouch.id !== 'mouse') return;
      const dx = e.clientX - lookTouch.x, dy = e.clientY - lookTouch.y;
      lookTouch.x = e.clientX;
      lookTouch.y = e.clientY;
      if (Math.hypot(e.clientX - lookTouch.startX, e.clientY - lookTouch.startY) > DRAG_THRESHOLD) {
        lookTouch.dragged = true;
        if (!lookTouch.mining) state.mining = false;
      }
      if (lookTouch.dragged) { state.lookDX += dx; state.lookDY += dy; }
    });
    window.addEventListener('mouseup', (e) => {
      if (pointerLocked) {
        if (e.button === 0) state.mining = false;
        return;
      }
      if (!lookTouch || lookTouch.id !== 'mouse') return;
      const held = performance.now() - lookTouch.startTime;
      if (!lookTouch.dragged && held < holdMs() && onTap) onTap(lookTouch.startX, lookTouch.startY);
      lookTouch = null;
      state.mining = false;
    });
    window.addEventListener('contextmenu', (e) => {
      if (keyboardMode) e.preventDefault();
    });
  }

  function centreAim() {
    state.pointX = window.innerWidth / 2;
    state.pointY = window.innerHeight / 2;
  }

  function onLockedMouseDown(e, worldZone) {
    if (!pointerLocked) {
      requestLock(worldZone);
      return;
    }
    centreAim();
    if (e.button === 0) state.mining = true;
    else if (e.button === 2 && onTap) onTap(state.pointX, state.pointY);
  }

  function requestLock(el) {
    if (!el.requestPointerLock) return;
    try { el.requestPointerLock(); } catch (err) { /* denied: keep drag-look */ }
  }

  function setKeyboardMode(on, worldZone) {
    if (keyboardMode === on) return;
    keyboardMode = on;
    document.body.classList.toggle('keyboardMode', on);
    if (on) {
      centreAim();
      if (hooks.onKeyboardMode) hooks.onKeyboardMode();
    }
  }

  function initKeyboard(worldZone) {
    const keys = {};
    const MOVE_KEYS = ['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

    // typing in the chat box or a menu field must not drive the player
    const typing = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };

    const apply = () => {
      const right = keys.d || keys.arrowright ? 1 : 0;
      const left = keys.a || keys.arrowleft ? 1 : 0;
      const fwd = keys.w || keys.arrowup ? 1 : 0;
      const back = keys.s || keys.arrowdown ? 1 : 0;
      state.move.x = right - left;
      state.move.y = fwd - back;
      state.jump = !!keys[' '];
      state.up = !!keys[' '];
      state.down = !!keys.shift;
      state.run = !!keys.control;
      sneakKey = !!keys.shift;
      state.sneak = sneakKey || sneakToggle;
    };

    document.addEventListener('pointerlockchange', () => {
      pointerLocked = !!document.pointerLockElement;
      if (!pointerLocked) state.mining = false;
      // Esc frees the mouse: unless we freed it ourselves, that means "pause"
      const ours = expectUnlock;
      expectUnlock = false;
      if (hooks.onPointerLock) hooks.onPointerLock(pointerLocked, ours);
    });

    window.addEventListener('keydown', (e) => {
      if (typing(e)) {
        if (e.key === 'Escape' && hooks.onEscape) hooks.onEscape();
        return;
      }
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.indexOf(k) !== -1) setKeyboardMode(true, worldZone);
      keys[k] = true;
      apply();

      if (k >= '1' && k <= '9' && hooks.onHotbar) hooks.onHotbar(+k - 1);
      else if (k === 'e' && hooks.onInventory) hooks.onInventory();
      else if (k === 'q' && hooks.onDrop) hooks.onDrop();
      else if ((k === 't' || k === 'enter') && hooks.onChat) hooks.onChat();
      else if (k === 'f' && hooks.onFly) hooks.onFly();
      else if (k === 'escape' && hooks.onEscape) hooks.onEscape();
      if (MOVE_KEYS.indexOf(k) !== -1 && e.key === ' ') e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      if (typing(e)) return;
      keys[e.key.toLowerCase()] = false;
      apply();
    });

    window.addEventListener('blur', () => {
      for (const k in keys) keys[k] = false;
      apply();
      state.mining = false;
    });

    window.addEventListener('wheel', (e) => {
      if (!keyboardMode || !hooks.onScroll) return;
      hooks.onScroll(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
  }

  function tickHold() {
    if (keyboardMode && pointerLocked) { centreAim(); return; }
    if (!lookTouch || lookTouch.mining) return;
    if (lookTouch.dragged) return;
    if (performance.now() - lookTouch.startTime <= holdMs()) return;
    lookTouch.mining = true;
    state.mining = true;
    state.pointX = lookTouch.startX;
    state.pointY = lookTouch.startY;
  }

  function consumeLook() {
    const d = { x: state.lookDX, y: state.lookDY * (invertY() ? -1 : 1) };
    state.lookDX = 0;
    state.lookDY = 0;
    return d;
  }

  function releaseLock() {
    if (!pointerLocked) return;
    expectUnlock = true;
    if (document.exitPointerLock) {
      try { document.exitPointerLock(); } catch (e) { /* already out */ }
    }
  }

  function toggleSneak(force) {
    sneakToggle = force === undefined ? !sneakToggle : !!force;
    state.sneak = sneakKey || sneakToggle;
    return sneakToggle;
  }

  function debug() {
    return {
      look: lookTouch ? { dragged: !!lookTouch.dragged, mining: !!lookTouch.mining, age: Math.round(performance.now() - lookTouch.startTime) } : null,
      joy: joyTouch !== null,
      mining: state.mining,
      keyboard: keyboardMode,
      locked: pointerLocked
    };
  }

  global.Controls = {
    state, init, tickHold, consumeLook, bindTap, bindHold,
    markTouch, recentTouch, debug, releaseLock, toggleSneak,
    lookSens, cancelMineOnLook,
    isKeyboard: () => keyboardMode,
    isLocked: () => pointerLocked,
    LOOK_SENS: BASE_LOOK_SENS
  };
})(window);
