(function (global) {
  'use strict';

  const B = Blocks;

  // Redstone, ticking ten times a second the way Minecraft's does. Levers,
  // buttons, pressure plates, redstone torches and blocks of redstone are the
  // power sources; dust carries it fifteen blocks, one weaker per block; lamps,
  // doors and TNT answer to it. A solid block with a source on it (a lever on
  // its side, a torch under it, a plate on top) is strongly powered and feeds
  // dust next to it; dust leading into a block only powers it weakly, which is
  // enough for a lamp or a door beside it but not for more dust. A redstone
  // torch goes out when the block it stands on is powered, one tick later.
  // Only the host runs it in a room; everyone else sees the blocks change.
  const TICK = 0.1;
  const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const H4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];                  // north, east, south, west
  // where a lever or button hangs: 0 on the floor, 1-4 on the wall to the N, E, S, W
  const ATTACH = [[0, -1, 0], [0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
  const BUTTON_TIME = 1.0;
  const PLATE_TIME = 1.0;

  const Redstone = {
    dirty: new Set(),
    timers: new Map(),       // pressed buttons and when they let go
    plates: new Map(),       // pressed plates and when something last stood on them
    torchQueue: new Map(),   // torches that flip next tick
    torchFlips: new Map(),   // recent flips per torch, for burnout
    doorPower: new Map(),
    timer: 0,
    now: 0,
    _self: false
  };

  function key(x, y, z) { return x + ',' + y + ',' + z; }
  function parse(k) { const p = k.split(','); return [+p[0], +p[1], +p[2]]; }
  function at(w, x, y, z) { return B.byId[w.getBlock(x, y, z)]; }
  function joins(d) { return !!(d.wire || d.rsTorch || d.lever || d.button || d.plate || d.rsBlock); }
  function conductor(d) { return d.solid && d.opaque && !d.rsBlock; }

  Redstone.support = function (d, x, y, z) {
    if (d.attach === undefined || d.plate || d.wire) return [x, y - 1, z];
    const o = ATTACH[d.attach || 0];
    return [x + o[0], y + o[1], z + o[2]];
  };

  Redstone.reset = function (game) {
    this.dirty.clear();
    this.timers.clear();
    this.plates.clear();
    this.torchQueue.clear();
    this.torchFlips.clear();
    this.doorPower.clear();
    this.timer = 0;
    // a button or plate that was down when the world was saved lets go
    if (game && game.editMap) {
      game.editMap.forEach((id, k) => {
        const d = B.byId[id];
        if (!d || !d.on) return;
        if (d.button) this.timers.set(k, this.now);
        if (d.plate) this.plates.set(k, this.now - PLATE_TIME);
      });
    }
  };

  // something changed at x, y, z: redstone near it takes another look
  Redstone.touch = function (world, x, y, z) {
    if (this._self) return;
    this.dirty.add(key(x, y, z));
    const d = at(world, x, y, z);
    if (d.button && d.on && !this.timers.has(key(x, y, z))) this.timers.set(key(x, y, z), this.now + BUTTON_TIME);
  };

  Redstone.press = function (x, y, z) {
    this.timers.set(key(x, y, z), this.now + BUTTON_TIME);
  };

  // ------------------------------------------------------------ dust shape
  // which way the dust at x, y, z runs, with the same rule the mesher draws by
  Redstone.wireMask = function (w, x, y, z) {
    let m = 0;
    const upOpen = !at(w, x, y + 1, z).opaque;
    for (let d = 0; d < 4; d++) {
      const dx = H4[d][0], dz = H4[d][1];
      const n = at(w, x + dx, y, z + dz);
      if (joins(n) || (!n.opaque && at(w, x + dx, y - 1, z + dz).wire) || (upOpen && at(w, x + dx, y + 1, z + dz).wire)) m |= 1 << d;
    }
    return m;
  };

  // does the dust at x, y, z point into its neighbour in direction dx, dy, dz?
  Redstone.wirePoints = function (w, x, y, z, dx, dy, dz) {
    if (dy === -1) return true;
    if (dy !== 0) return false;
    const m = this.wireMask(w, x, y, z);
    let dirs = m;
    if (m === 0) dirs = 15;
    else if (m === 1 || m === 4) dirs = 5;
    else if (m === 2 || m === 8) dirs = 10;
    const d = dz === -1 ? 0 : dx === 1 ? 1 : dz === 1 ? 2 : 3;
    return !!(dirs & (1 << d));
  };

  // the dust cells this one passes power to: level, and one up or down a step
  Redstone.wireLinks = function (w, x, y, z) {
    const out = [];
    const upOpen = !at(w, x, y + 1, z).opaque;
    for (const [dx, dz] of H4) {
      const n = at(w, x + dx, y, z + dz);
      if (n.wire) out.push([x + dx, y, z + dz]);
      else if (!n.opaque && at(w, x + dx, y - 1, z + dz).wire) out.push([x + dx, y - 1, z + dz]);
      if (upOpen && at(w, x + dx, y + 1, z + dz).wire) out.push([x + dx, y + 1, z + dz]);
    }
    return out;
  };

  // ------------------------------------------------------------ power
  // does the block at s send power into its neighbour p?
  Redstone.emitsInto = function (w, sx, sy, sz, px, py, pz) {
    const d = at(w, sx, sy, sz);
    if ((d.lever || d.button || d.plate) && d.on) return true;
    if (d.rsBlock) return true;
    if (d.rsTorch && d.on) {
      const s = this.support(d, sx, sy, sz);
      return !(px === s[0] && py === s[1] && pz === s[2]);
    }
    if (d.wire && d.power > 0) return this.wirePoints(w, sx, sy, sz, px - sx, py - sy, pz - sz);
    return false;
  };

  // a source on or against this block drives it hard enough to feed dust
  Redstone.strong = function (w, x, y, z) {
    for (const [dx, dy, dz] of DIRS6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const d = at(w, nx, ny, nz);
      if (!d.on) continue;
      if (d.lever || d.button) {
        const s = this.support(d, nx, ny, nz);
        if (s[0] === x && s[1] === y && s[2] === z) return true;
      }
      if (d.plate && dy === 1) return true;
      if (d.rsTorch && dy === -1) return true;
    }
    return false;
  };

  // dust on top of or leading into this block
  Redstone.weak = function (w, x, y, z) {
    for (const [dx, dy, dz] of DIRS6) {
      const d = at(w, x + dx, y + dy, z + dz);
      if (!d.wire || d.power === 0) continue;
      if (this.wirePoints(w, x + dx, y + dy, z + dz, -dx, -dy, -dz)) return true;
    }
    return false;
  };

  // should a lamp, door or TNT at x, y, z be on?
  Redstone.powered = function (w, x, y, z) {
    for (const [dx, dy, dz] of DIRS6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (this.emitsInto(w, nx, ny, nz, x, y, z)) return true;
      const d = at(w, nx, ny, nz);
      if (conductor(d) && (this.strong(w, nx, ny, nz) || this.weak(w, nx, ny, nz))) return true;
    }
    return false;
  };

  // what dust gets from everything that is not dust
  Redstone.wireInput = function (w, x, y, z) {
    for (const [dx, dy, dz] of DIRS6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const d = at(w, nx, ny, nz);
      if (d.wire) continue;
      if (this.emitsInto(w, nx, ny, nz, x, y, z)) return 15;
      if (conductor(d) && this.strong(w, nx, ny, nz)) return 15;
    }
    return 0;
  };

  Redstone.torchBlocked = function (w, x, y, z) {
    const [sx, sy, sz] = this.support(at(w, x, y, z), x, y, z);
    const s = at(w, sx, sy, sz);
    if (s.rsBlock) return true;
    if (!conductor(s)) return false;
    return this.strong(w, sx, sy, sz) || this.weak(w, sx, sy, sz);
  };

  // ------------------------------------------------------------ ticking
  Redstone.update = function (dt, game) {
    if (Net.active && !Net.isHost) return;
    this.timer += dt;
    // a slow frame runs a few ticks, so buttons and clocks keep real time
    for (let n = 0; this.timer >= TICK && n < 4; n++) {
      this.timer -= TICK;
      this.step(game);
    }
    if (this.timer > TICK) this.timer = 0;
  };

  Redstone.step = function (game) {
    this.now += TICK;
    const w = game.world;

    for (const [k, t] of this.timers) {
      if (this.now < t) continue;
      this.timers.delete(k);
      const [x, y, z] = parse(k);
      const d = at(w, x, y, z);
      if (d.button && d.on) { game.changeBlock(x, y, z, d.id - 1); Sound.click(); }
    }
    this.updatePlates(game);

    if (this.torchQueue.size) {
      const q = Array.from(this.torchQueue);
      this.torchQueue.clear();
      for (const [k, want] of q) {
        const [x, y, z] = parse(k);
        const d = at(w, x, y, z);
        if (!d.rsTorch || d.on === want) continue;
        // a torch flickering on and off too fast burns out for a while
        const flips = (this.torchFlips.get(k) || []).filter((t) => this.now - t < 3);
        if (want && flips.length >= 8) { this.torchQueue.set(k, want); this.torchFlips.set(k, flips); continue; }
        flips.push(this.now);
        this.torchFlips.set(k, flips);
        game.changeBlock(x, y, z, want ? d.litId : d.offId);
        if (!want && flips.length >= 8) Entities.burst(x + 0.5, y + 0.7, z + 0.5, B.GRAVEL, 4, 0.2);
      }
    }

    if (!this.dirty.size) return;
    const seeds = Array.from(this.dirty);
    this.dirty.clear();
    this.recompute(game, seeds);
  };

  Redstone.updatePlates = function (game) {
    const w = game.world;
    const bodies = [];
    const p = game.player;
    if (p && !p.dead) bodies.push([p.pos.x, p.pos.y, p.pos.z]);
    for (const m of Mobs.list) bodies.push([m.x, m.y, m.z]);
    if (Net.active) {
      for (const id in Net.players) {
        const o = Net.players[id];
        if ((o.dim || 'overworld') === game.dimension) bodies.push([o.x, o.y, o.z]);
      }
    }
    for (const [bx, by, bz] of bodies) {
      const x = Math.floor(bx), y = Math.floor(by + 0.05), z = Math.floor(bz);
      const d = at(w, x, y, z);
      if (!d.plate) continue;
      this.plates.set(key(x, y, z), this.now);
      if (!d.on) { game.changeBlock(x, y, z, B.PLATE + 1); Sound.click(); }
    }
    for (const [k, t] of this.plates) {
      if (this.now - t < PLATE_TIME) continue;
      this.plates.delete(k);
      const [x, y, z] = parse(k);
      if (at(w, x, y, z).plate && at(w, x, y, z).on) { game.changeBlock(x, y, z, B.PLATE); Sound.click(); }
    }
  };

  Redstone.recompute = function (game, seeds) {
    const w = game.world;
    // 1. every strand of dust within reach of a change, followed to its ends
    const wires = new Map();
    const stack = [];
    const consider = (x, y, z) => {
      const k = key(x, y, z);
      if (wires.has(k) || !at(w, x, y, z).wire) return;
      wires.set(k, [x, y, z]);
      stack.push([x, y, z]);
    };
    const near = new Set();
    for (const s of seeds) {
      const [x, y, z] = parse(s);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dz = -2; dz <= 2; dz++) {
            const d = at(w, x + dx, y + dy, z + dz);
            if (d.wire) consider(x + dx, y + dy, z + dz);
            else if (d.lamp || d.door || d.rsTorch || d.tnt) near.add(key(x + dx, y + dy, z + dz));
          }
        }
      }
    }
    while (stack.length && wires.size < 4096) {
      const [x, y, z] = stack.pop();
      for (const [nx, ny, nz] of this.wireLinks(w, x, y, z)) consider(nx, ny, nz);
    }

    // 2. power from outside the dust, then one weaker with each step along it
    const power = new Map();
    const buckets = [];
    for (let i = 0; i <= 15; i++) buckets.push([]);
    for (const [k, pos] of wires) {
      const pw = this.wireInput(w, pos[0], pos[1], pos[2]);
      power.set(k, pw);
      if (pw > 0) buckets[pw].push(pos);
    }
    for (let lv = 15; lv > 1; lv--) {
      for (const [x, y, z] of buckets[lv]) {
        if (power.get(key(x, y, z)) !== lv) continue;
        for (const [nx, ny, nz] of this.wireLinks(w, x, y, z)) {
          const nk = key(nx, ny, nz);
          if (!power.has(nk) || power.get(nk) >= lv - 1) continue;
          power.set(nk, lv - 1);
          buckets[lv - 1].push([nx, ny, nz]);
        }
      }
    }

    // 3. write the new levels; what they reach gets a look
    this._self = true;
    try {
      for (const [k, [x, y, z]] of wires) {
        const want = B.WIRE + power.get(k);
        if (w.getBlock(x, y, z) === want) continue;
        game.changeBlock(x, y, z, want);
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
              const d = at(w, x + dx, y + dy, z + dz);
              if (d.lamp || d.door || d.rsTorch || d.tnt) near.add(key(x + dx, y + dy, z + dz));
            }
          }
        }
      }
      // 4. lamps, doors, TNT and torches answer
      for (const k of near) {
        const [x, y, z] = parse(k);
        this.updateComponent(game, x, y, z);
      }
    } finally {
      this._self = false;
    }
  };

  Redstone.updateComponent = function (game, x, y, z) {
    const w = game.world;
    const d = at(w, x, y, z);
    if (d.lamp) {
      const on = this.powered(w, x, y, z);
      if (on !== d.on) game.changeBlock(x, y, z, on ? B.LAMP_ON : B.LAMP);
    } else if (d.tnt) {
      if (this.powered(w, x, y, z)) game.primeTnt(x, y, z, 4);
    } else if (d.door) {
      const lowY = d.door.upper ? y - 1 : y;
      const k = key(x, lowY, z);
      const on = this.powered(w, x, lowY, z) || this.powered(w, x, lowY + 1, z);
      const was = this.doorPower.get(k) || false;
      if (on === was) return;
      this.doorPower.set(k, on);
      const low = at(w, x, lowY, z);
      if (low.door && low.door.open !== on) game.toggleDoor(x, lowY, z);
    } else if (d.rsTorch) {
      const want = !this.torchBlocked(w, x, y, z);
      if (want !== d.on) this.torchQueue.set(key(x, y, z), want);
    }
  };

  global.Redstone = Redstone;
})(window);
