(function (global) {
  'use strict';

  const B = Blocks;

  // Flowing water and lava. Nothing moves until something changes nearby (a
  // block broken, a bucket emptied), then the fluid spreads the way Minecraft's
  // does: straight down first, sideways one level weaker per block, water
  // seven blocks and lava three, and a pool of two sources makes a third.
  // Water meeting lava cools it: a lava source to obsidian, running lava to
  // cobblestone.
  const WATER_TICK = 0.25;
  const LAVA_EVERY = 5;            // lava is five times slower
  const PER_TICK = 400;

  const KIND = { water: 1, lava: 2 };
  const MAX = { water: 7, lava: 6 };
  const STEP = { water: 1, lava: 2 };

  function fluidId(kind, level) {
    if (kind === 'water') return level === 0 ? B.WATER : B.WATER_FLOW + level - 1;
    if (level === 0) return B.LAVA;
    return B.LAVA + ({ 2: 1, 4: 2, 6: 3, 8: 4 })[level];
  }

  // the level another cell gets from this one: falling and still sources
  // count as the start of a new run
  function feedLevel(d) {
    return d.level === 0 || d.level === 8 ? 0 : d.level;
  }

  const Fluids = {
    queue: new Set(),
    lavaQueue: new Set(),
    timer: 0,
    ticks: 0
  };

  Fluids.clear = function () {
    this.queue.clear();
    this.lavaQueue.clear();
  };

  // something changed at x,y,z: the fluid there and around it gets a look
  Fluids.touch = function (world, x, y, z) {
    const cells = [[x, y, z], [x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]];
    for (const [cx, cy, cz] of cells) {
      const d = B.byId[world.getBlock(cx, cy, cz)];
      if (!d || !d.fluid) continue;
      (d.fluid === 'lava' ? this.lavaQueue : this.queue).add(cx + ',' + cy + ',' + cz);
    }
  };

  Fluids.update = function (dt, game) {
    if (Net.active && !Net.isHost) return;
    if (!this.queue.size && !this.lavaQueue.size) return;
    this.timer += dt;
    if (this.timer < WATER_TICK) return;
    this.timer = 0;
    this.ticks++;
    this.run(this.queue, game);
    if (this.ticks % LAVA_EVERY === 0) this.run(this.lavaQueue, game);
  };

  Fluids.run = function (queue, game) {
    if (!queue.size) return;
    const batch = [];
    for (const k of queue) {
      batch.push(k);
      if (batch.length >= PER_TICK) break;
    }
    for (const k of batch) queue.delete(k);
    for (const k of batch) {
      const p = k.split(',');
      this.step(game, +p[0], +p[1], +p[2]);
    }
  };

  function isFree(d) {
    return d.id === B.AIR || (!d.solid && !d.fluid && (d.replaceable || d.needsGround));
  }

  Fluids.set = function (game, x, y, z, id) {
    const w = game.world;
    const here = B.byId[w.getBlock(x, y, z)];
    // plants and torches are washed away and dropped
    if (here.id !== B.AIR && !here.fluid && here.needsGround && game.mode === 'survival') {
      for (const [did, n] of game.dropsFor(here.id, null)) game.spawnDrop(x + 0.5, y + 0.5, z + 0.5, did, n);
    }
    game.changeBlock(x, y, z, id);
  };

  Fluids.step = function (game, x, y, z) {
    const w = game.world;
    const id = w.getBlock(x, y, z);
    const d = B.byId[id];
    if (!d.fluid) return;
    const kind = d.fluid;
    const other = kind === 'water' ? 'lava' : 'water';

    // lava touching water hardens
    if (kind === 'lava') {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) {
        if (B.byId[w.getBlock(x + dx, y + dy, z + dz)].fluid === 'water') {
          game.changeBlock(x, y, z, d.level === 0 ? B.OBSIDIAN : B.COBBLESTONE);
          if (global.Sound) Sound.fizz(game.distTo(x, y, z));
          return;
        }
      }
    }

    // a running cell is only as strong as what feeds it
    if (d.level !== 0) {
      const above = B.byId[w.getBlock(x, y + 1, z)];
      let want;
      if (above.fluid === kind) {
        want = 8;
      } else {
        let best = 99, sources = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = B.byId[w.getBlock(x + dx, y, z + dz)];
          if (n.fluid !== kind) continue;
          if (n.level === 0) sources++;
          // a column still falling through air does not feed sideways; one
          // that has landed spreads out like a source
          if (n.level === 8 && isFree(B.byId[w.getBlock(x + dx, y - 1, z + dz)])) continue;
          best = Math.min(best, feedLevel(n) + STEP[kind]);
        }
        const below = B.byId[w.getBlock(x, y - 1, z)];
        // two water sources side by side over something firm make a third
        if (kind === 'water' && sources >= 2 && (below.solid || (below.fluid === 'water' && below.level === 0))) want = 0;
        else want = best <= MAX[kind] ? best : -1;
      }
      if (want !== d.level) {
        this.set(game, x, y, z, want < 0 ? B.AIR : fluidId(kind, want));
        return;
      }
    }

    // down first
    const belowId = w.getBlock(x, y - 1, z);
    const below = B.byId[belowId];
    if (y > 0 && (isFree(below) || (below.fluid === kind && below.level !== 0 && below.level !== 8))) {
      this.set(game, x, y - 1, z, fluidId(kind, 8));
      return;
    }
    if (y > 0 && below.fluid === other) {
      // water falling onto lava, or lava onto water
      game.changeBlock(x, y - 1, z, kind === 'water' ? (below.level === 0 ? B.OBSIDIAN : B.COBBLESTONE) : B.STONE);
      return;
    }
    if (below.fluid === kind && below.level === 8) return;

    // then sideways, one level weaker
    const next = feedLevel(d) + STEP[kind];
    if (next > MAX[kind]) return;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nid = w.getBlock(x + dx, y, z + dz);
      const n = B.byId[nid];
      if (isFree(n)) {
        this.set(game, x + dx, y, z + dz, fluidId(kind, next));
      } else if (n.fluid === kind && n.level !== 0 && n.level !== 8 && n.level > next) {
        this.set(game, x + dx, y, z + dz, fluidId(kind, next));
      } else if (n.fluid === other && kind === 'water') {
        game.changeBlock(x + dx, y, z + dz, n.level === 0 ? B.OBSIDIAN : B.COBBLESTONE);
      }
    }
  };

  Fluids.fluidId = fluidId;
  global.Fluids = Fluids;
})(window);
