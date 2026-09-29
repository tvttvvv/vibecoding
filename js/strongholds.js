(function (global) {
  'use strict';

  const B = Blocks;

  // Strongholds lie deep underground, one in every 384-block cell. At the
  // heart of each is the portal room: twelve end portal frames around a pool
  // of lava, a few already holding an eye. Stone brick corridors run out from
  // it to small rooms with chests. An eye of ender thrown into the air flies
  // toward the nearest portal room.
  const CELL = 384;
  const REACH = 36;
  const cache = new Map();
  const hash = (x, z, s) => Noise.hash2(x, z, s);

  function planAt(cellX, cellZ, seed) {
    const key = seed + ':' + cellX + ',' + cellZ;
    if (cache.has(key)) return cache.get(key);
    const cx = cellX * CELL + 60 + Math.floor(hash(cellX, cellZ, seed + 801) * (CELL - 120));
    const cz = cellZ * CELL + 60 + Math.floor(hash(cellX, cellZ, seed + 802) * (CELL - 120));
    const y = 8 + Math.floor(hash(cellX, cellZ, seed + 803) * 6);
    const eyes = [];
    for (let i = 0; i < 12; i++) eyes.push(hash(cellX * 13 + i, cellZ * 7, seed + 804) < 0.1);
    const plan = {
      cx, cz, y, eyes,
      room: { x0: cx - 5, x1: cx + 5, z0: cz - 7, z1: cz + 7, h: 7 },
      halls: [
        { axis: 'x', a: cx - REACH, b: cx - 5, c: cz }, { axis: 'x', a: cx + 5, b: cx + REACH, c: cz },
        { axis: 'z', a: cz - REACH, b: cz - 7, c: cx }, { axis: 'z', a: cz + 7, b: cz + REACH, c: cx }
      ],
      ends: [[cx - REACH, cz], [cx + REACH, cz], [cx, cz - REACH], [cx, cz + REACH]]
    };
    cache.set(key, plan);
    return plan;
  }

  function plansNear(wx, wz, seed) {
    const out = [];
    const c0x = Math.floor((wx - REACH - 20) / CELL), c1x = Math.floor((wx + REACH + 20) / CELL);
    const c0z = Math.floor((wz - REACH - 20) / CELL), c1z = Math.floor((wz + REACH + 20) / CELL);
    for (let a = c0x; a <= c1x; a++) for (let b = c0z; b <= c1z; b++) out.push(planAt(a, b, seed));
    return out;
  }

  // the twelve frames around the 3x3 portal, with the way each one faces in
  function frames(p) {
    const out = [];
    for (let i = -1; i <= 1; i++) {
      out.push([p.cx + i, p.cz - 2]); out.push([p.cx + i, p.cz + 2]);
      out.push([p.cx - 2, p.cz + i]); out.push([p.cx + 2, p.cz + i]);
    }
    return out;
  }

  const Strongholds = { CELL };

  // the portal room nearest to a spot, as seen by a thrown eye
  Strongholds.nearest = function (x, z, seed) {
    const ax = Math.floor(x / CELL), az = Math.floor(z / CELL);
    let best = null, bd = Infinity;
    for (let a = ax - 1; a <= ax + 1; a++) {
      for (let b = az - 1; b <= az + 1; b++) {
        const p = planAt(a, b, seed);
        const d = Math.hypot(p.cx - x, p.cz - z);
        if (d < bd) { bd = d; best = p; }
      }
    }
    return best;
  };

  Strongholds.stamp = function (chunk, seed) {
    const CS = WorldConst.CHUNK_SIZE;
    const bx = chunk.cx * CS, bz = chunk.cz * CS;
    const idx = (x, y, z) => (y * CS + (z - bz)) * CS + (x - bx);
    const put = (x, y, z, id) => { if (y >= 1 && y < WorldConst.WORLD_HEIGHT) chunk.data[idx(x, y, z)] = id; };
    const brick = (x, y, z) => B.MOSSY_STONE_BRICKS * (Noise.hash3(x, y, z, seed + 810) < 0.18 ? 1 : 0) ||
      B.STONE_BRICKS;
    for (const p of plansNear(bx + 8, bz + 8, seed)) {
      if (p.cx + REACH + 6 < bx || p.cx - REACH - 6 > bx + CS || p.cz + REACH + 6 < bz || p.cz - REACH - 6 > bz + CS) continue;
      const y = p.y, r = p.room;
      const frameAt = new Map(frames(p).map(([x, z], i) => [x + ',' + z, i]));
      for (let z = bz; z < bz + CS; z++) {
        for (let x = bx; x < bx + CS; x++) {
          // the portal room
          if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
            const edge = x === r.x0 || x === r.x1 || z === r.z0 || z === r.z1;
            for (let yy = y - 1; yy <= y + r.h; yy++) {
              let id = B.AIR;
              if (edge || yy === y - 1 || yy === y + r.h) id = brick(x, yy, z);
              put(x, yy, z, id);
            }
            const dx = x - p.cx, dz = z - p.cz;
            if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2) {
              put(x, y, z, B.STONE_BRICKS);
              const f = frameAt.get(x + ',' + z);
              if (f !== undefined) put(x, y + 1, z, p.eyes[f] ? B.END_FRAME_EYE : B.END_FRAME);
              if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) put(x, y, z, B.LAVA);
            }
            // torches on the walls, and steps up at the south end
            if (!edge && (z === r.z0 + 1 || z === r.z1 - 1) && (x === r.x0 + 1 || x === r.x1 - 1)) put(x, y, z, B.TORCH);
            continue;
          }
          // corridors, three wide inside, carved through the rock
          for (const h of p.halls) {
            const t = h.axis === 'x' ? x : z, w = h.axis === 'x' ? z - h.c : x - h.c;
            if (t < h.a || t > h.b || Math.abs(w) > 2) continue;
            for (let yy = y - 1; yy <= y + 4; yy++) {
              const wall = Math.abs(w) === 2 || yy === y - 1 || yy === y + 4;
              put(x, yy, z, wall ? brick(x, yy, z) : B.AIR);
            }
            if (Math.abs(w) === 1 && t % 10 === 0) put(x, y + 2, z, B.TORCH);
          }
          // a little room at each far end, with a chest
          for (const [ex, ez] of p.ends) {
            if (Math.abs(x - ex) > 3 || Math.abs(z - ez) > 3) continue;
            const edge = Math.abs(x - ex) === 3 || Math.abs(z - ez) === 3;
            for (let yy = y - 1; yy <= y + 4; yy++) put(x, yy, z, edge || yy === y - 1 || yy === y + 4 ? brick(x, yy, z) : B.AIR);
            if (x === ex + 2 && z === ez + 2) put(x, y, z, B.CHEST);
            if (x === ex - 2 && z === ez - 2) put(x, y, z, B.BOOKSHELF);
          }
        }
      }
      // the doorways where corridors meet the rooms
      for (const h of p.halls) {
        for (const t of [h.a, h.b]) {
          for (let w = -1; w <= 1; w++) {
            const x = h.axis === 'x' ? t : h.c + w, z = h.axis === 'x' ? h.c + w : t;
            if (x < bx || x >= bx + CS || z < bz || z >= bz + CS) continue;
            for (let yy = y; yy <= y + 3; yy++) put(x, yy, z, B.AIR);
          }
        }
      }
    }
  };

  Strongholds.isLootChest = function (x, y, z, seed) {
    for (const p of plansNear(x, z, seed)) {
      for (const [ex, ez] of p.ends) if (x === ex + 2 && z === ez + 2 && y === p.y) return true;
    }
    return false;
  };

  Strongholds.loot = function (x, y, z, seed) {
    const I = Items;
    const r = (k) => Noise.hash3(x, y, z, seed + 960 + k);
    const out = [];
    const add = (id, min, max, k) => { const n = min + Math.floor(r(k) * (max - min + 1)); if (n > 0) out.push({ id, count: n }); };
    add(I.ENDER_PEARL, 0, 2, 1); add(I.IRON_INGOT, 1, 5, 2); add(I.BREAD, 1, 3, 3);
    add(I.REDSTONE, 2, 8, 4); add(I.GOLD_INGOT, 0, 3, 5); add(I.DIAMOND, 0, 1, 6); add(I.BOOK, 0, 3, 7);
    return out;
  };

  global.Strongholds = Strongholds;
})(window);
