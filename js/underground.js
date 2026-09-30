(function (global) {
  'use strict';

  const B = Blocks;

  // What lies under the ground besides caves, as in Minecraft:
  //  - dungeons: a mossy cobblestone room with a monster spawner and a chest
  //    or two, only where a cave runs into it, so it can be found;
  //  - abandoned mineshafts: long three-wide corridors with fence-post and
  //    plank supports, rails, cobwebs and the odd chest, crossing caves on
  //    plank bridges;
  //  - amethyst geodes: a shell of smooth basalt and calcite around a hollow
  //    lined with amethyst and its glowing clusters.
  // Every chunk works out its own share from the seed. The spawners and
  // loot chests it builds are noted here, so the game knows about them.
  const CS = 16;
  const hash2 = (x, z, s) => Noise.hash2(x, z, s);
  const hash3 = (x, y, z, s) => Noise.hash3(x, y, z, s);

  // (kept per seed: the title screen's background is a world of its own)
  const Underground = { bySeed: new Map() };
  Underground.of = function (seed) {
    let r = this.bySeed.get(seed);
    if (!r) {
      r = {
        spawners: new Map(),     // "x,y,z" -> mob type
        lootChests: new Map()    // "x,y,z" -> 'dungeon' | 'mineshaft'
      };
      this.bySeed.set(seed, r);
    }
    return r;
  };

  // ------------------------------------------------------------ mineshafts
  const SHAFT_CELL = 176;
  const shaftCache = new Map();

  function shaftPlan(cellX, cellZ, seed) {
    const key = seed + ':' + cellX + ',' + cellZ;
    if (shaftCache.has(key)) return shaftCache.get(key);
    let plan = null;
    if (hash2(cellX, cellZ, seed + 901) < 0.45) {
      const cx = cellX * SHAFT_CELL + 40 + Math.floor(hash2(cellX, cellZ, seed + 902) * (SHAFT_CELL - 80));
      const cz = cellZ * SHAFT_CELL + 40 + Math.floor(hash2(cellX, cellZ, seed + 903) * (SHAFT_CELL - 80));
      const y = 11 + Math.floor(hash2(cellX, cellZ, seed + 904) * 9);
      const segs = [];
      let n = 0;
      const rnd = () => hash2(cellX * 31 + n, cellZ * 17 + (n++), seed + 905);
      // corridors branch out from the central room, each a straight run
      const grow = (x, z, dir, depth) => {
        if (depth > 3 || segs.length >= 22) return;
        const len = 12 + Math.floor(rnd() * 18);
        const dx = [0, 1, 0, -1][dir], dz = [-1, 0, 1, 0][dir];
        const ex = x + dx * len, ez = z + dz * len;
        segs.push(dx !== 0
          ? { axis: 'x', a: Math.min(x, ex), b: Math.max(x, ex), c: z }
          : { axis: 'z', a: Math.min(z, ez), b: Math.max(z, ez), c: x });
        const r = rnd();
        if (r < 0.75) grow(ex, ez, (dir + 1) % 4, depth + 1);
        if (r > 0.3) grow(ex, ez, (dir + 3) % 4, depth + 1);
        if (r > 0.6) grow(ex, ez, dir, depth + 1);
      };
      for (let d = 0; d < 4; d++) grow(cx + [0, 5, 0, -5][d], cz + [-5, 0, 5, 0][d], d, 0);
      plan = { cx, cz, y, segs };
    }
    shaftCache.set(key, plan);
    return plan;
  }

  function shaftsNear(bx, bz, seed) {
    const out = [];
    for (let a = Math.floor((bx - 140) / SHAFT_CELL); a <= Math.floor((bx + CS + 140) / SHAFT_CELL); a++) {
      for (let b = Math.floor((bz - 140) / SHAFT_CELL); b <= Math.floor((bz + CS + 140) / SHAFT_CELL); b++) {
        const p = shaftPlan(a, b, seed);
        if (p) out.push(p);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ stamping
  Underground.stamp = function (chunk, seed, columnHeight) {
    const bx = chunk.cx * CS, bz = chunk.cz * CS;
    const idx = (lx, y, lz) => (y * CS + lz) * CS + lx;
    const get = (lx, y, lz) => chunk.data[idx(lx, y, lz)];
    const set = (lx, y, lz, id) => { if (y >= 1 && y < WorldConst.WORLD_HEIGHT) chunk.data[idx(lx, y, lz)] = id; };
    const ground = [];
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) ground[lz * CS + lx] = Math.floor(columnHeight(bx + lx, bz + lz, seed));
    const surf = (lx, lz) => ground[lz * CS + lx];

    const geode = this.geode(chunk, seed, bx, bz, get, set, surf);
    this.mineshafts(chunk, seed, bx, bz, get, set, surf);
    // (a dungeon would cut into the geode)
    if (!geode) this.dungeon(chunk, seed, bx, bz, get, set, surf);
  };

  Underground.geode = function (chunk, seed, bx, bz, get, set, surf) {
    if (hash2(chunk.cx, chunk.cz, seed + 911) > 1 / 22) return false;
    const lx0 = 5 + Math.floor(hash2(chunk.cx, chunk.cz, seed + 912) * 6);
    const lz0 = 5 + Math.floor(hash2(chunk.cx, chunk.cz, seed + 913) * 6);
    const y0 = 9 + Math.floor(hash2(chunk.cx, chunk.cz, seed + 914) * 12);
    if (y0 + 6 > surf(lx0, lz0) - 4) return false;
    const R = 4.6;
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        for (let dy = -5; dy <= 5; dy++) {
          const lx = lx0 + dx, lz = lz0 + dz, y = y0 + dy;
          if (lx < 0 || lx >= CS || lz < 0 || lz >= CS) continue;
          // a little lumpy, not a perfect ball
          const r = Math.hypot(dx, dy * 1.1, dz) + (hash3(bx + lx, y, bz + lz, seed + 915) - 0.5) * 0.5;
          if (r > R) continue;
          let id;
          if (r > R - 0.9) id = B.SMOOTH_BASALT;
          else if (r > R - 1.7) id = B.CALCITE;
          else if (r > R - 2.5) id = B.AMETHYST_BLOCK;
          else id = B.AIR;
          set(lx, y, lz, id);
        }
      }
    }
    // clusters grow on the amethyst floor of the hollow
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const lx = lx0 + dx, lz = lz0 + dz;
        for (let y = y0 - 3; y <= y0 + 2; y++) {
          if (get(lx, y, lz) !== B.AIR || get(lx, y - 1, lz) !== B.AMETHYST_BLOCK) continue;
          if (hash3(bx + lx, y, bz + lz, seed + 916) < 0.45) set(lx, y, lz, B.AMETHYST_CLUSTER);
          break;
        }
      }
    }
    return true;
  };

  Underground.mineshafts = function (chunk, seed, bx, bz, get, set, surf) {
    for (const p of shaftsNear(bx, bz, seed)) {
      const y = p.y;
      // the central room: a dirt-floored chamber the corridors lead out of
      for (let lz = 0; lz < CS; lz++) {
        for (let lx = 0; lx < CS; lx++) {
          const x = bx + lx, z = bz + lz;
          if (Math.abs(x - p.cx) > 5 || Math.abs(z - p.cz) > 5) continue;
          if (surf(lx, lz) < y + 8) continue;
          set(lx, y - 1, lz, B.DIRT);
          for (let yy = y; yy < y + 4; yy++) set(lx, yy, lz, B.AIR);
        }
      }
      p.segs.forEach((s, si) => {
        for (let t = s.a; t <= s.b; t++) {
          for (let w = -1; w <= 1; w++) {
            const x = s.axis === 'x' ? t : s.c + w, z = s.axis === 'x' ? s.c + w : t;
            const lx = x - bx, lz = z - bz;
            if (lx < 0 || lx >= CS || lz < 0 || lz >= CS) continue;
            // keep clear of the sea and of the surface
            if (surf(lx, lz) < y + 7) continue;
            for (let yy = y; yy <= y + 2; yy++) set(lx, yy, lz, B.AIR);
            // a floor of planks where it crosses a cave
            const under = get(lx, y - 1, lz);
            if (under === B.AIR || under === B.WATER || B.byId[under].fluid) set(lx, y - 1, lz, B.PLANKS);
            const support = (t - s.a) % 4 === 2;
            if (support) {
              if (w !== 0) { set(lx, y, lz, B.OAK_FENCE); set(lx, y + 1, lz, B.OAK_FENCE); }
              set(lx, y + 2, lz, B.PLANKS);
            } else if (w === 0) {
              if (hash3(x, y, z, seed + 921) < 0.7) set(lx, y, lz, B.RAIL + (s.axis === 'x' ? 1 : 0));
            } else if (hash3(x, y + 2, z, seed + 922) < 0.05) {
              set(lx, y + 2, lz, B.COBWEB);
            } else if (hash3(x, y, z, seed + 923) < 0.012) {
              set(lx, y, lz, B.COBWEB);
            }
            // now and then a chest against the side
            if (w === 1 && !support && (t - s.a) === 5 + (si % 7) && hash2(si, p.cx, seed + 924) < 0.4) {
              set(lx, y, lz, B.CHEST);
              Underground.of(seed).lootChests.set(x + ',' + y + ',' + z, 'mineshaft');
            }
          }
        }
      });
    }
  };

  const SPAWN_TYPES = ['zombie', 'zombie', 'skeleton', 'spider'];

  Underground.dungeon = function (chunk, seed, bx, bz, get, set, surf) {
    if (hash2(chunk.cx, chunk.cz, seed + 931) > 1 / 6) return;
    const x0 = 1 + Math.floor(hash2(chunk.cx, chunk.cz, seed + 932) * 7);
    const z0 = 1 + Math.floor(hash2(chunk.cx, chunk.cz, seed + 933) * 7);
    const W = 7, H = 5;
    const top = surf(x0 + 3, z0 + 3) - 8;
    // try a few heights and take one where a cave opens into the room
    let best = -1, bestOpen = 0;
    for (let k = 0; k < 5; k++) {
      const y0 = 6 + Math.floor(hash2(chunk.cx * 5 + k, chunk.cz, seed + 934) * Math.max(1, top - 10));
      if (y0 + H > top) continue;
      let open = 0;
      for (let dx = 0; dx < W; dx++) {
        for (let dz = 0; dz < W; dz++) {
          const edge = dx === 0 || dx === W - 1 || dz === 0 || dz === W - 1;
          if (!edge) continue;
          for (let dy = 1; dy < H - 1; dy++) if (get(x0 + dx, y0 + dy, z0 + dz) === B.AIR) open++;
        }
      }
      if (open > bestOpen && open < 40) { bestOpen = open; best = y0; }
    }
    if (best < 0) return;
    const y0 = best;
    for (let dx = 0; dx < W; dx++) {
      for (let dz = 0; dz < W; dz++) {
        const lx = x0 + dx, lz = z0 + dz, x = bx + lx, z = bz + lz;
        const edge = dx === 0 || dx === W - 1 || dz === 0 || dz === W - 1;
        for (let dy = 0; dy < H; dy++) {
          const y = y0 + dy;
          if (dy === 0 || dy === H - 1) {
            set(lx, y, lz, dy === 0 && hash3(x, y, z, seed + 935) < 0.5 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE);
          } else if (edge) {
            // keep the cave openings; wall the rest
            if (get(lx, y, lz) !== B.AIR) set(lx, y, lz, hash3(x, y, z, seed + 936) < 0.3 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE);
          } else {
            set(lx, y, lz, B.AIR);
          }
        }
      }
    }
    const sx = x0 + 3, sz = z0 + 3, sy = y0 + 1;
    set(sx, sy, sz, B.SPAWNER);
    const type = SPAWN_TYPES[Math.floor(hash2(chunk.cx, chunk.cz, seed + 937) * SPAWN_TYPES.length)];
    this.of(seed).spawners.set((bx + sx) + ',' + sy + ',' + (bz + sz), type);
    // one or two chests against the walls
    const spots = [[x0 + 1, z0 + 3], [x0 + 5, z0 + 3], [x0 + 3, z0 + 1], [x0 + 3, z0 + 5]];
    const nChests = hash2(chunk.cx, chunk.cz, seed + 938) < 0.5 ? 1 : 2;
    for (let i = 0; i < nChests; i++) {
      const [cx, cz] = spots[(Math.floor(hash2(chunk.cx + i, chunk.cz, seed + 939) * 4) + i * 2) % 4];
      set(cx, sy, cz, B.CHEST);
      this.of(seed).lootChests.set((bx + cx) + ',' + sy + ',' + (bz + cz), 'dungeon');
    }
  };

  // ------------------------------------------------------------ loot
  Underground.isLootChest = function (x, y, z, seed) {
    return this.of(seed).lootChests.has(x + ',' + y + ',' + z);
  };

  Underground.loot = function (x, y, z, seed) {
    const I = Items;
    const kind = this.of(seed).lootChests.get(x + ',' + y + ',' + z);
    const r = (k) => hash3(x, y, z, seed + 970 + k);
    const out = [];
    const add = (id, min, max, k) => { const n = min + Math.floor(r(k) * (max - min + 1)); if (n > 0) out.push({ id, count: n }); };
    if (kind === 'dungeon') {
      add(I.BREAD, 0, 2, 1); add(I.WHEAT, 0, 4, 2); add(I.IRON_INGOT, 0, 4, 3); add(I.GOLD_INGOT, 0, 3, 4);
      add(I.REDSTONE, 0, 4, 5); add(I.STRING, 0, 4, 6); add(I.GUNPOWDER, 0, 4, 7); add(I.BONE, 0, 4, 8);
      add(I.ROTTEN_FLESH, 0, 4, 9); add(I.DIAMOND, 0, 1, 10);
      if (r(12) < 0.3) out.push({ id: I.GOLDEN_APPLE, count: 1 });
      if (r(11) < 0.3) out.push({ id: I.ENDER_PEARL, count: 1 });
    } else {
      add(I.BREAD, 1, 3, 1); add(I.IRON_INGOT, 1, 5, 2); add(I.GOLD_INGOT, 0, 3, 3); add(I.REDSTONE, 2, 8, 4);
      add(I.LAPIS, 0, 8, 5); add(I.COAL, 2, 8, 6); add(B.RAIL, 4, 12, 7); add(I.DIAMOND, 0, 2, 8);
      add(I.AMETHYST_SHARD, 0, 4, 9);
    }
    return out;
  };

  global.Underground = Underground;
})(window);
