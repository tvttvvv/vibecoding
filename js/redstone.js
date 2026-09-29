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
  // Repeaters pass a full-strength signal on after a delay of 1-4 ticks and
  // let it through one way only; comparators pass on the strength at their
  // back (or read how full a chest behind them is), less what comes in from
  // the side when subtracting; observers give a short pulse when the block in
  // front of them changes; pistons push up to twelve blocks and sticky ones
  // pull one back.
  // Only the host runs it in a room; everyone else sees the blocks change.
  const TICK = 0.1;
  const D6 = [[0, 1, 0], [0, -1, 0], [0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
  const PUSH_LIMIT = 12;
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
    sched: new Map(),        // blocks due to change: key -> { at, id } or a piston move
    compOut: new Map(),      // what each comparator is putting out, 0-15
    timer: 0,
    now: 0,
    _self: false
  };

  function key(x, y, z) { return x + ',' + y + ',' + z; }
  function parse(k) { const p = k.split(','); return [+p[0], +p[1], +p[2]]; }
  function at(w, x, y, z) { return B.byId[w.getBlock(x, y, z)]; }
  function joins(d, dir) {
    if (d.repeater || d.comparator) return d.facing % 2 === dir % 2;
    return !!(d.wire || d.rsTorch || d.lever || d.button || d.plate || d.rsBlock);
  }
  // the cell a repeater, comparator (facing 0-3) or observer (0-5) sends to
  function front4(d, x, y, z) { return [x + H4[d.facing][0], y, z + H4[d.facing][1]]; }
  function back4(d, x, y, z) { return [x - H4[d.facing][0], y, z - H4[d.facing][1]]; }
  function same(a, x, y, z) { return a[0] === x && a[1] === y && a[2] === z; }
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
    this.sched.clear();
    this.compOut.clear();
    this.timer = 0;
    // a button or plate that was down when the world was saved lets go
    if (game && game.editMap) {
      game.editMap.forEach((id, k) => {
        const d = B.byId[id];
        if (!d || !d.on) return;
        if (d.button) this.timers.set(k, this.now);
        if (d.plate) this.plates.set(k, this.now - PLATE_TIME);
        if (d.observer) this.sched.set(k, { at: this.now, id: d.id - 1 });
      });
    }
  };

  // something changed at x, y, z: redstone near it takes another look
  Redstone.touch = function (world, x, y, z) {
    if (Net.active && !Net.isHost) return;
    // an observer looking at this cell blinks, whoever changed it
    for (let f = 0; f < 6; f++) {
      const ox = x - D6[f][0], oy = y - D6[f][1], oz = z - D6[f][2];
      const o = at(world, ox, oy, oz);
      if (!o.observer || o.facing6 !== f) continue;
      const k = key(ox, oy, oz);
      if (!o.on && !this.sched.has(k)) this.sched.set(k, { at: this.now + TICK, id: o.id + 1 });
    }
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
      if (joins(n, d) || (!n.opaque && at(w, x + dx, y - 1, z + dz).wire) || (upOpen && at(w, x + dx, y + 1, z + dz).wire)) m |= 1 << d;
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
  // how strong a signal the block at s sends into its neighbour p (0-15)
  Redstone.strengthInto = function (w, sx, sy, sz, px, py, pz) {
    const d = at(w, sx, sy, sz);
    if ((d.lever || d.button || d.plate) && d.on) return 15;
    if (d.rsBlock) return 15;
    if (d.rsTorch && d.on) {
      const s = this.support(d, sx, sy, sz);
      return same(s, px, py, pz) ? 0 : 15;
    }
    if (d.wire && d.power > 0) return this.wirePoints(w, sx, sy, sz, px - sx, py - sy, pz - sz) ? d.power : 0;
    if (d.repeater && d.on) return same(front4(d, sx, sy, sz), px, py, pz) ? 15 : 0;
    if (d.comparator) return same(front4(d, sx, sy, sz), px, py, pz) ? (this.compOut.get(key(sx, sy, sz)) || 0) : 0;
    if (d.observer && d.on) {
      const o = D6[d.facing6];
      return px === sx - o[0] && py === sy - o[1] && pz === sz - o[2] ? 15 : 0;
    }
    return 0;
  };

  Redstone.emitsInto = function (w, sx, sy, sz, px, py, pz) {
    return this.strengthInto(w, sx, sy, sz, px, py, pz) > 0;
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
    // a repeater, comparator or observer driving into it
    for (const [dx, dy, dz] of DIRS6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const d = at(w, nx, ny, nz);
      if ((d.repeater || d.comparator || d.observer) && this.strengthInto(w, nx, ny, nz, x, y, z) > 0) return true;
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

  // should a lamp, door, TNT or piston at x, y, z be on? (a piston does not
  // listen through its own face: skip is that direction)
  Redstone.powered = function (w, x, y, z, skip) {
    for (const [dx, dy, dz] of DIRS6) {
      if (skip && dx === skip[0] && dy === skip[1] && dz === skip[2]) continue;
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (this.emitsInto(w, nx, ny, nz, x, y, z)) return true;
      const d = at(w, nx, ny, nz);
      if (conductor(d) && (this.strong(w, nx, ny, nz) || this.weak(w, nx, ny, nz))) return true;
    }
    return false;
  };

  // what dust gets from everything that is not dust
  Redstone.wireInput = function (w, x, y, z) {
    let best = 0;
    for (const [dx, dy, dz] of DIRS6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const d = at(w, nx, ny, nz);
      if (d.wire) continue;
      best = Math.max(best, this.strengthInto(w, nx, ny, nz, x, y, z));
      if (best < 15 && conductor(d) && this.strong(w, nx, ny, nz)) best = 15;
      if (best === 15) break;
    }
    return best;
  };

  // what reaches the back of a repeater or comparator
  Redstone.rearStrength = function (w, d, x, y, z, game) {
    const [bx, by, bz] = back4(d, x, y, z);
    const b = at(w, bx, by, bz);
    if (d.comparator && game) {
      const c = this.containerSignal(game, bx, by, bz);
      if (c >= 0) return c;
    }
    if (b.wire) return b.power;
    let s = this.strengthInto(w, bx, by, bz, x, y, z);
    if (s < 15 && conductor(b) && (this.strong(w, bx, by, bz) || this.weak(w, bx, by, bz))) s = 15;
    return s;
  };

  // what a comparator gets from its sides: dust, diodes and redstone blocks only
  Redstone.sideStrength = function (w, d, x, y, z) {
    let best = 0;
    for (const s of [(d.facing + 1) % 4, (d.facing + 3) % 4]) {
      const nx = x + H4[s][0], nz = z + H4[s][1];
      const n = at(w, nx, y, nz);
      if (n.wire) best = Math.max(best, n.power);
      else if (n.rsBlock || n.repeater || n.comparator) best = Math.max(best, this.strengthInto(w, nx, y, nz, x, y, z));
    }
    return best;
  };

  // a chest or furnace read by a comparator: 0 empty, up to 15 full; -1 if not one
  Redstone.containerSignal = function (game, x, y, z) {
    const e = game.blockEntities && game.blockEntities.get(game.entityKey(x, y, z));
    if (!e) return -1;
    const slots = e.type === 'chest' ? e.slots : e.type === 'furnace' ? [e.input[0], e.fuel[0], e.output[0]] : null;
    if (!slots) return -1;
    let fill = 0, any = false;
    for (const st of slots) {
      if (!st) continue;
      any = true;
      fill += st.count / Items.stackMax(st.id);
    }
    return any ? Math.floor(1 + fill / slots.length * 14) : 0;
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

    // repeaters, comparators and observers switching, pistons moving
    if (this.sched.size) {
      const due = [];
      for (const [k, e] of this.sched) if (this.now >= e.at - 1e-6) due.push([k, e]);
      for (const [k, e] of due) {
        this.sched.delete(k);
        const [x, y, z] = parse(k);
        const d = at(w, x, y, z);
        if (e.piston !== undefined) {
          if (d.piston) this.movePiston(game, x, y, z, e.piston);
          continue;
        }
        if (e.lamp) { if (d.lamp && d.on && !this.powered(w, x, y, z)) game.changeBlock(x, y, z, B.LAMP); continue; }
        if (d.family !== B.byId[e.id].family || w.getBlock(x, y, z) === e.id) continue;
        game.changeBlock(x, y, z, e.id);
        // an observer's pulse lasts two ticks
        if (d.observer && !d.on) this.sched.set(k, { at: this.now + 2 * TICK, id: e.id - 1 });
      }
    }

    if (!this.dirty.size) return;
    const seeds = Array.from(this.dirty);
    this.dirty.clear();
    this.recompute(game, seeds);
  };

  // ------------------------------------------------------------ pistons
  Redstone.movable = function (d) {
    if (!d || d.id === B.AIR) return 'air';
    if (d.fluid || d.replaceable) return 'air';
    if (d.needsGround && !d.piston && !d.pistonHead) return 'break';
    if (!isFinite(d.hardness) || d.hardness >= 50 || d.portal) return 'no';
    if (d.interactive === 'chest' || d.interactive === 'furnace' || d.interactive === 'enchant' || d.interactive === 'bed') return 'no';
    if ((d.piston && d.extended) || d.pistonHead) return 'no';
    return 'move';
  };

  Redstone.movePiston = function (game, x, y, z, extend) {
    const w = game.world;
    const d = at(w, x, y, z);
    if (!d.piston || d.extended === extend) return;
    const o = D6[d.facing6];
    const hx = x + o[0], hy = y + o[1], hz = z + o[2];
    const base = d.family + d.facing6 * 2;
    const headId = B.PISTON_HEAD + d.facing6 * 2 + (d.sticky ? 1 : 0);
    if (extend) {
      // what is in the way, up to twelve blocks
      const line = [];
      let cx = hx, cy = hy, cz = hz, end = null;
      for (let i = 0; i <= PUSH_LIMIT; i++) {
        if (cy < 0 || cy >= WorldConst.WORLD_HEIGHT) return;
        const m = this.movable(at(w, cx, cy, cz));
        if (m === 'no') return;
        if (m === 'air' || m === 'break') { end = [cx, cy, cz, m]; break; }
        if (i === PUSH_LIMIT) return;
        line.push([cx, cy, cz, w.getBlock(cx, cy, cz)]);
        cx += o[0]; cy += o[1]; cz += o[2];
      }
      if (!end) return;
      if (end[3] === 'break') game.popBlock(end[0], end[1], end[2], w.getBlock(end[0], end[1], end[2]));
      const cells = [];
      for (let i = line.length - 1; i >= 0; i--) {
        const [lx, ly, lz, id] = line[i];
        cells.push([lx + o[0], ly + o[1], lz + o[2], id]);
      }
      cells.push([hx, hy, hz, headId]);
      cells.push([x, y, z, base + 1]);
      game.setBlocks(cells);
      game.pushEntities(line.map((c) => [c[0] + o[0], c[1] + o[1], c[2] + o[2]]).concat([[hx, hy, hz]]), o);
    } else {
      const cells = [[x, y, z, base]];
      let pulled = B.AIR;
      if (d.sticky) {
        const fx = hx + o[0], fy = hy + o[1], fz = hz + o[2];
        const f = at(w, fx, fy, fz);
        if (this.movable(f) === 'move') { pulled = f.id; cells.push([fx, fy, fz, B.AIR]); }
      }
      const head = at(w, hx, hy, hz);
      if (head.pistonHead) cells.push([hx, hy, hz, pulled]);
      game.setBlocks(cells);
    }
    Sound.piston(game.distTo(x, y, z), extend);
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
            else if (d.lamp || d.door || d.rsTorch || d.tnt || d.repeater || d.comparator || (d.piston && !d.pistonHead)) near.add(key(x + dx, y + dy, z + dz));
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
    this.later = [];
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
              if (d.lamp || d.door || d.rsTorch || d.tnt || d.repeater || d.comparator || d.piston) near.add(key(x + dx, y + dy, z + dz));
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
    for (const k of this.later) this.dirty.add(k);
  };

  Redstone.updateComponent = function (game, x, y, z) {
    const w = game.world;
    const d = at(w, x, y, z);
    if (d.lamp) {
      // a lamp lights at once but takes two ticks to go dark
      const on = this.powered(w, x, y, z);
      const k = key(x, y, z);
      if (on) { this.sched.delete(k); if (!d.on) game.changeBlock(x, y, z, B.LAMP_ON); }
      else if (d.on && !this.sched.has(k)) this.sched.set(k, { at: this.now + 2 * TICK, id: B.LAMP, lamp: true });
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
    } else if (d.repeater) {
      const want = this.rearStrength(w, d, x, y, z) > 0;
      const k = key(x, y, z);
      const id = d.id - (d.on ? 1 : 0) + (want ? 1 : 0);
      const pending = this.sched.get(k);
      if (want === d.on) { if (pending && pending.id !== d.id) this.sched.delete(k); return; }
      if (!pending || pending.id !== id) this.sched.set(k, { at: this.now + (d.delay + 1) * TICK, id });
    } else if (d.comparator) {
      const k = key(x, y, z);
      const rear = this.rearStrength(w, d, x, y, z, game);
      const side = this.sideStrength(w, d, x, y, z);
      const out = d.subtract ? Math.max(0, rear - side) : (rear >= side ? rear : 0);
      if ((this.compOut.get(k) || 0) !== out) {
        this.compOut.set(k, out);
        // what it drives needs another look, next tick
        const f = front4(d, x, y, z);
        this.later.push(key(f[0], f[1], f[2]));
      }
      const want = out > 0;
      if (want !== d.on) this.sched.set(k, { at: this.now + TICK, id: d.id - (d.on ? 1 : 0) + (want ? 1 : 0) });
    } else if (d.piston) {
      const want = this.powered(w, x, y, z, D6[d.facing6]);
      const k = key(x, y, z);
      const pending = this.sched.get(k);
      if (want === d.extended) { if (pending) this.sched.delete(k); return; }
      if (!pending || pending.piston !== want) this.sched.set(k, { at: this.now + TICK, piston: want });
    }
  };

  global.Redstone = Redstone;
})(window);
