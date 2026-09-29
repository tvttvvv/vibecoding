(function (global) {
  'use strict';

  const B = Blocks;

  // Villages sit on a coarse grid: each 128-block cell may hold one, placed on
  // flat plains. The whole plan is worked out from the seed, so every chunk a
  // village touches can build its own part of it without the others.
  const CELL = 128;
  const RADIUS = 22;
  const cache = new Map();

  function hash(x, z, s) { return Noise.hash2(x, z, s); }

  function planAt(cellX, cellZ, seed) {
    const key = seed + ':' + cellX + ',' + cellZ;
    if (cache.has(key)) return cache.get(key);
    let plan = null;
    if (hash(cellX, cellZ, seed + 501) < 0.5) {
      const cx = cellX * CELL + 30 + Math.floor(hash(cellX, cellZ, seed + 502) * (CELL - 60));
      const cz = cellZ * CELL + 30 + Math.floor(hash(cellX, cellZ, seed + 503) * (CELL - 60));
      const H = WorldGen.columnHeight;
      const baseY = Math.floor(H(cx, cz, seed));
      let flat = WorldGen.biomeAt(cx, cz, seed) === 'plains' && baseY > WorldConst.SEA_LEVEL + 1 &&
        baseY < WorldConst.WORLD_HEIGHT - 16;
      for (const [dx, dz] of [[14, 0], [-14, 0], [0, 14], [0, -14], [10, 10], [-10, -10]]) {
        if (!flat) break;
        const h = Math.floor(H(cx + dx, cz + dz, seed));
        if (Math.abs(h - baseY) > 4 || h <= WorldConst.SEA_LEVEL) flat = false;
      }
      if (flat) plan = build(cx, cz, baseY, cellX, cellZ, seed);
    }
    cache.set(key, plan);
    return plan;
  }

  // houses along the four paths out of the well, doors facing the path
  function build(cx, cz, baseY, cellX, cellZ, seed) {
    const pieces = [{ type: 'well', x: cx - 1, z: cz - 1, y: baseY }];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let n = 0;
    dirs.forEach(([dx, dz], d) => {
      pieces.push({ type: 'path', x: cx, z: cz, dx, dz, len: 18 });
      for (const t of [9, 16]) {
        const r = hash(cellX * 7 + d, cellZ * 13 + t, seed + 511);
        if (r < 0.2) continue;
        const side = r < 0.6 ? 1 : -1;
        // (x, z) is the middle of the house, four blocks off the path, so its
        // doorstep touches the path; `facing` is the way its front wall faces
        const px = cx + dx * t, pz = cz + dz * t;
        const ox = px + (dz !== 0 ? side * 4 : 0), oz = pz + (dx !== 0 ? side * 4 : 0);
        const facing = dx !== 0 ? (side > 0 ? 0 : 2) : (side > 0 ? 3 : 1);
        const farm = r > 0.85;
        pieces.push({ type: farm ? 'farm' : 'house', x: ox, z: oz, y: baseY, facing, idx: n++, seed: Math.floor(r * 1e6) });
      }
    });
    return { cx, cz, baseY, pieces, key: cellX + ',' + cellZ };
  }

  // the plans that could reach a chunk
  function plansNear(wx, wz, seed) {
    const out = [];
    const c0x = Math.floor((wx - 40) / CELL), c1x = Math.floor((wx + 40) / CELL);
    const c0z = Math.floor((wz - 40) / CELL), c1z = Math.floor((wz + 40) / CELL);
    for (let a = c0x; a <= c1x; a++) {
      for (let b = c0z; b <= c1z; b++) {
        const p = planAt(a, b, seed);
        if (p) out.push(p);
      }
    }
    return out;
  }

  const Villages = { CELL, RADIUS };

  Villages.near = function (wx, wz, seed, dist) {
    for (const p of plansNear(wx, wz, seed)) {
      if (Math.abs(wx - p.cx) <= dist && Math.abs(wz - p.cz) <= dist) return p;
    }
    return null;
  };

  // trees and flowers stay out of the village
  Villages.inside = function (wx, wz, seed) {
    return !!this.near(wx, wz, seed, RADIUS);
  };

  // --------------------------------------------------------------- stamping
  Villages.stamp = function (chunk, seed, H) {
    const CS = WorldConst.CHUNK_SIZE;
    const bx = chunk.cx * CS, bz = chunk.cz * CS;
    const plans = plansNear(bx + 8, bz + 8, seed);
    if (!plans.length) return;
    const inChunk = (x, z) => x >= bx && x < bx + CS && z >= bz && z < bz + CS;
    const put = (x, y, z, id) => {
      if (!inChunk(x, z) || y < 1 || y >= WorldConst.WORLD_HEIGHT) return;
      chunk.data[(y * CS + (z - bz)) * CS + (x - bx)] = id;
      if (id !== B.AIR && y > chunk.maxY) chunk.maxY = y;
    };
    const get = (x, y, z) => chunk.data[(y * CS + (z - bz)) * CS + (x - bx)];
    const ground = (x, z) => Math.floor(H(x, z, seed));

    for (const plan of plans) {
      for (const pc of plan.pieces) {
        if (pc.type === 'path') {
          for (let i = 2; i <= pc.len; i++) {
            const x = pc.x + pc.dx * i, z = pc.z + pc.dz * i;
            if (!inChunk(x, z)) continue;
            const g = ground(x, z);
            if (g <= WorldConst.SEA_LEVEL) continue;
            put(x, g, z, B.GRAVEL);
            if (get(x, g + 1, z) === B.TALL_GRASS || get(x, g + 1, z) === B.DANDELION || get(x, g + 1, z) === B.POPPY) put(x, g + 1, z, B.AIR);
          }
        } else if (pc.type === 'well') {
          this.well(pc, put, ground);
        } else if (pc.type === 'house') {
          this.house(pc, put, ground);
        } else if (pc.type === 'farm') {
          this.farm(pc, put, ground);
        }
      }
    }
  };

  // Local house coordinates: 0..4 across, lz = 0 the front wall. Turned so
  // the front faces pc.facing (0 north -z, 1 east +x, 2 south +z, 3 west -x).
  function rot(pc, lx, lz) {
    const u = lx - 2, v = lz - 2;
    switch (pc.facing) {
      case 0: return [pc.x + u, pc.z + v];
      case 2: return [pc.x - u, pc.z - v];
      case 1: return [pc.x - v, pc.z + u];
      default: return [pc.x + v, pc.z - u];
    }
  }

  Villages.well = function (pc, put, ground) {
    const y = pc.y;
    for (let x = 0; x < 4; x++) {
      for (let z = 0; z < 4; z++) {
        const wx = pc.x + x - 1, wz = pc.z + z - 1;
        const g = ground(wx, wz);
        for (let yy = g; yy < y; yy++) put(wx, yy, wz, B.COBBLESTONE);
        const rim = x === 0 || x === 3 || z === 0 || z === 3;
        put(wx, y, wz, rim ? B.COBBLESTONE : B.WATER);
        put(wx, y - 1, wz, rim ? B.COBBLESTONE : B.WATER);
        put(wx, y - 2, wz, B.COBBLESTONE);
        put(wx, y + 1, wz, rim && (x === 0 || x === 3) && (z === 0 || z === 3) ? B.COBBLESTONE : B.AIR);
        for (let yy = y + 2; yy < y + 4; yy++) put(wx, yy, wz, rim && (x === 0 || x === 3) && (z === 0 || z === 3) ? B.PLANKS : B.AIR);
        put(wx, y + 4, wz, B.SLABS[0]);
      }
    }
  };

  Villages.house = function (pc, put, ground) {
    const y = pc.y;
    for (let lx = 0; lx < 5; lx++) {
      for (let lz = 0; lz < 5; lz++) {
        const [wx, wz] = rot(pc, lx, lz);
        const g = ground(wx, wz);
        for (let yy = Math.min(g, y); yy < y; yy++) put(wx, yy, wz, B.COBBLESTONE);
        put(wx, y, wz, B.COBBLESTONE);
        const edge = lx === 0 || lx === 4 || lz === 0 || lz === 4;
        const corner = (lx === 0 || lx === 4) && (lz === 0 || lz === 4);
        for (let yy = y + 1; yy <= y + 3; yy++) {
          let id = B.AIR;
          if (corner) id = B.LOG;
          else if (edge) id = B.PLANKS;
          put(wx, yy, wz, id);
        }
        put(wx, y + 4, wz, B.PLANKS);
        put(wx, y + 5, wz, lx > 0 && lx < 4 && lz > 0 && lz < 4 ? B.SLABS[0] : B.AIR);
        for (let yy = y + 6; yy < y + 9; yy++) put(wx, yy, wz, B.AIR);
      }
    }
    // windows on three sides
    for (const [lx, lz] of [[0, 2], [4, 2], [2, 4]]) {
      const [wx, wz] = rot(pc, lx, lz);
      put(wx, y + 2, wz, B.GLASS);
    }
    // the door, at the middle of the front wall, opening inward
    const [dx, dz] = rot(pc, 2, 0);
    const doorFacing = (pc.facing + 2) % 4;
    put(dx, y + 1, dz, B.DOOR + doorFacing * 2);
    put(dx, y + 2, dz, B.DOOR + 8 + doorFacing * 2);
    // a step down to the path in front of it
    const [sx, sz] = rot(pc, 2, -1);
    put(sx, y, sz, B.GRAVEL);
    put(sx, y + 1, sz, B.AIR);
    put(sx, y + 2, sz, B.AIR);
    // furniture
    const [bx, bz] = rot(pc, 1, 3);
    put(bx, y + 1, bz, B.BED);
    const [tx, tz] = rot(pc, 3, 3);
    put(tx, y + 1, tz, pc.idx === 0 ? B.CHEST : B.CRAFTING_TABLE);
    const [lx2, lz2] = rot(pc, 3, 1);
    put(lx2, y + 1, lz2, B.TORCH);
  };

  Villages.farm = function (pc, put, ground) {
    const y = pc.y;
    const crop = pc.seed % 2 ? B.CARROTS : B.WHEAT_0;
    for (let lx = 0; lx < 5; lx++) {
      for (let lz = 0; lz < 5; lz++) {
        const [wx, wz] = rot(pc, lx, lz);
        const g = ground(wx, wz);
        for (let yy = Math.min(g, y); yy < y; yy++) put(wx, yy, wz, B.DIRT);
        const edge = lx === 0 || lx === 4 || lz === 0 || lz === 4;
        for (let yy = y + 1; yy < y + 5; yy++) put(wx, yy, wz, B.AIR);
        if (edge) { put(wx, y, wz, B.LOG); continue; }
        if (lx === 2) { put(wx, y, wz, B.WATER); continue; }
        put(wx, y, wz, B.FARMLAND);
        put(wx, y + 1, wz, crop + ((pc.seed >> (lz * 2)) % 4));
      }
    }
  };

  // where each village's house chest is, for its first-open loot
  Villages.chestPositions = function (plan) {
    const out = [];
    for (const pc of plan.pieces) {
      if (pc.type !== 'house' || pc.idx !== 0) continue;
      const [x, z] = rot(pc, 3, 3);
      out.push([x, pc.y + 1, z]);
    }
    return out;
  };

  Villages.isLootChest = function (x, y, z, seed) {
    for (const plan of plansNear(x, z, seed)) {
      for (const [cx, cy, cz] of this.chestPositions(plan)) if (cx === x && cy === y && cz === z) return true;
    }
    return false;
  };

  // the same loot for everyone who opens it first, from the chest's position
  Villages.loot = function (x, y, z, seed) {
    const I = Items;
    const r = (k) => Noise.hash3(x, y, z, seed + 900 + k);
    const out = [];
    const add = (id, min, max, k) => { const n = min + Math.floor(r(k) * (max - min + 1)); if (n > 0) out.push({ id, count: n }); };
    add(I.BREAD, 1, 4, 1); add(I.WHEAT, 2, 8, 2); add(I.APPLE, 0, 3, 3); add(I.SEEDS, 0, 6, 4);
    add(I.IRON_INGOT, 0, 3, 5); add(I.EMERALD, 1, 3, 6);
    if (r(7) < 0.3) out.push({ id: I.tools.iron_sword, count: 1, dur: 250 });
    return out;
  };

  // --------------------------------------------------------------- villagers
  const PROFESSIONS = ['farmer', 'librarian', 'smith', 'cleric'];
  Villages.PROFESSIONS = PROFESSIONS;

  Villages.trades = function (prof) {
    const I = Items;
    const t = (cost, result) => ({ cost, result });
    switch (prof) {
      case 'farmer': return [
        t([[I.WHEAT, 20]], [I.EMERALD, 1]), t([[I.CARROT, 22]], [I.EMERALD, 1]),
        t([[I.EMERALD, 1]], [I.BREAD, 6]), t([[I.EMERALD, 1]], [I.APPLE, 4]),
        t([[I.EMERALD, 1]], [I.COOKED_PORK, 5])];
      case 'librarian': return [
        t([[I.PAPER, 24]], [I.EMERALD, 1]), t([[I.BOOK, 4]], [I.EMERALD, 1]),
        t([[I.EMERALD, 6]], [B.BOOKSHELF, 1]), t([[I.EMERALD, 1]], [B.GLASS, 4])];
      case 'smith': return [
        t([[I.COAL, 15]], [I.EMERALD, 1]), t([[I.IRON_INGOT, 4]], [I.EMERALD, 1]),
        t([[I.EMERALD, 3]], [I.tools.iron_pickaxe, 1]), t([[I.EMERALD, 7]], [I.armor.iron_chestplate, 1]),
        t([[I.EMERALD, 18]], [I.tools.diamond_pickaxe, 1])];
      default: return [
        t([[I.ROTTEN_FLESH, 32]], [I.EMERALD, 1]), t([[I.EMERALD, 1]], [I.LAPIS, 2]),
        t([[I.GUNPOWDER, 6]], [I.EMERALD, 1]), t([[I.EMERALD, 2]], [I.GOLD_INGOT, 3])];
    }
  };

  global.Villages = Villages;
})(window);
