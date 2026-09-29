(function (global) {
  'use strict';

  const B = Blocks;

  // Nether fortresses: nether brick halls on stilts, crossing the caverns. Each
  // 144-block cell of the nether may hold one, worked out from the seed so
  // that every chunk it touches can build its own part. A hall runs out from a
  // central chamber in each direction; two more cross the south and north
  // halls; a nether wart garden with a chest closes the east hall, and more
  // chests sit in the halls. Blazes and wither skeletons live inside.
  const CELL = 144;
  const REACH = 50;                // how far a fortress spreads from its middle
  const cache = new Map();
  const hash = (x, z, s) => Noise.hash2(x, z, s);

  function planAt(cellX, cellZ, seed) {
    const key = seed + ':' + cellX + ',' + cellZ;
    if (cache.has(key)) return cache.get(key);
    let plan = null;
    if (hash(cellX, cellZ, seed + 701) < 0.7) {
      const cx = cellX * CELL + 50 + Math.floor(hash(cellX, cellZ, seed + 702) * (CELL - 100));
      const cz = cellZ * CELL + 50 + Math.floor(hash(cellX, cellZ, seed + 703) * (CELL - 100));
      const y = 34 + Math.floor(hash(cellX, cellZ, seed + 704) * 8);
      plan = build(cx, cz, y);
    }
    cache.set(key, plan);
    return plan;
  }

  function build(cx, cz, y) {
    const rooms = [
      { type: 'hall', x0: cx - 6, x1: cx + 6, z0: cz - 6, z1: cz + 6, y, h: 8 },
      { type: 'garden', x0: cx + 44, x1: cx + 54, z0: cz - 5, z1: cz + 5, y, h: 6 }
    ];
    const halls = [
      { axis: 'x', a: cx - 48, b: cx + 44, c: cz, y },
      { axis: 'z', a: cz - 48, b: cz + 48, c: cx, y },
      { axis: 'x', a: cx - 24, b: cx + 24, c: cz + 30, y },
      { axis: 'x', a: cx - 24, b: cx + 24, c: cz - 30, y }
    ];
    const chests = [[cx + 20, y + 1, cz + 1], [cx - 1, y + 1, cz - 20], [cx + 52, y + 1, cz - 4], [cx - 18, y + 1, cz + 31]];
    return { cx, cz, y, rooms, halls, chests };
  }

  function plansNear(wx, wz, seed) {
    const out = [];
    const c0x = Math.floor((wx - REACH - 16) / CELL), c1x = Math.floor((wx + REACH + 16) / CELL);
    const c0z = Math.floor((wz - REACH - 16) / CELL), c1z = Math.floor((wz + REACH + 16) / CELL);
    for (let a = c0x; a <= c1x; a++) {
      for (let b = c0z; b <= c1z; b++) {
        const p = planAt(a, b, seed);
        if (p) out.push(p);
      }
    }
    return out;
  }

  // along a hall: t is the position along it, w across (-2..2)
  function hallCell(h, x, z) {
    const t = h.axis === 'x' ? x : z, w = h.axis === 'x' ? z - h.c : x - h.c;
    if (t < h.a || t > h.b || w < -2 || w > 2) return null;
    return { t, w };
  }

  function inRoom(r, x, z) { return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; }

  const Fortress = { CELL };

  Fortress.near = function (wx, wz, seed, dist) {
    for (const p of plansNear(wx, wz, seed)) {
      if (Math.abs(wx - p.cx) <= dist + REACH && Math.abs(wz - p.cz) <= dist + REACH) return p;
    }
    return null;
  };

  // is this spot inside a hall or room (where its monsters belong)?
  Fortress.inside = function (x, y, z, seed) {
    for (const p of plansNear(x, z, seed)) {
      if (y <= p.y || y > p.y + 7) continue;
      for (const r of p.rooms) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && y < p.y + r.h) return true;
      for (const h of p.halls) { const c = hallCell(h, x, z); if (c && Math.abs(c.w) <= 1 && y <= p.y + 4) return true; }
    }
    return false;
  };

  // a random spot to stand in a fortress, for spawning
  Fortress.randomSpot = function (p, rnd) {
    if (rnd() < 0.35) {
      const r = p.rooms[0];
      return [r.x0 + 1 + Math.floor(rnd() * (r.x1 - r.x0 - 1)), p.y + 1, r.z0 + 1 + Math.floor(rnd() * (r.z1 - r.z0 - 1))];
    }
    const h = p.halls[Math.floor(rnd() * p.halls.length)];
    const t = h.a + Math.floor(rnd() * (h.b - h.a));
    const w = Math.floor(rnd() * 3) - 1;
    return h.axis === 'x' ? [t, p.y + 1, h.c + w] : [h.c + w, p.y + 1, t];
  };

  Fortress.stamp = function (chunk, seed) {
    const CS = WorldConst.CHUNK_SIZE;
    const bx = chunk.cx * CS, bz = chunk.cz * CS;
    const plans = plansNear(bx + 8, bz + 8, seed);
    if (!plans.length) return;
    const idx = (x, y, z) => (y * CS + (z - bz)) * CS + (x - bx);
    const put = (x, y, z, id) => {
      if (y < 1 || y >= WorldConst.WORLD_HEIGHT - 1) return;
      chunk.data[idx(x, y, z)] = id;
    };
    const get = (x, y, z) => chunk.data[idx(x, y, z)];
    const NB = B.NETHER_BRICKS, FEN = B.NETHER_FENCE;

    for (const p of plans) {
      if (p.cx + REACH + 8 < bx || p.cx - REACH - 8 > bx + CS || p.cz + REACH + 8 < bz || p.cz - REACH - 8 > bz + CS) continue;
      for (let z = bz; z < bz + CS; z++) {
        for (let x = bx; x < bx + CS; x++) {
          const y = p.y;
          let solid = false, open = false;
          // the chambers
          for (const r of p.rooms) {
            if (!inRoom(r, x, z)) continue;
            solid = true;
            const edge = x === r.x0 || x === r.x1 || z === r.z0 || z === r.z1;
            put(x, y, z, NB);
            put(x, y + r.h, z, NB);
            for (let yy = y + 1; yy < y + r.h; yy++) {
              if (edge) {
                const corner = (x === r.x0 || x === r.x1) && (z === r.z0 || z === r.z1);
                put(x, yy, z, !corner && (yy === y + 2 || yy === y + 3) && (x + z) % 3 === 0 ? FEN : NB);
              } else {
                put(x, yy, z, B.AIR);
              }
            }
            if (r.type === 'garden' && !edge && (z === r.z0 + 2 || z === r.z1 - 2) && x > r.x0 + 1 && x < r.x1 - 1) {
              put(x, y, z, B.SOUL_SAND);
              put(x, y + 1, z, B.NETHER_WART + 2);
            }
          }
          // the halls
          for (const h of p.halls) {
            const c = hallCell(h, x, z);
            if (!c) continue;
            const inside = p.rooms.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
            put(x, y, z, NB);
            if (Math.abs(c.w) === 2 && !inside) {
              solid = true;
              for (let yy = y + 1; yy <= y + 4; yy++) {
                put(x, yy, z, (yy === y + 2 || yy === y + 3) && c.t % 4 === 0 ? FEN : NB);
              }
              put(x, y + 5, z, NB);
              // stilts down to the rock or the lava
              if (c.t % 8 === 0) {
                for (let yy = y - 1; yy > 1; yy--) {
                  const id = get(x, yy, z);
                  if (id !== B.AIR && id !== B.LAVA) break;
                  put(x, yy, z, NB);
                }
              }
            } else {
              open = true;
              if (!inside) put(x, y + 5, z, NB);
            }
          }
          // hall interiors are carved last, through any wall they meet
          if (open) {
            for (const h of p.halls) {
              const c = hallCell(h, x, z);
              if (!c || Math.abs(c.w) > 1) continue;
              for (let yy = y + 1; yy <= y + 4; yy++) put(x, yy, z, B.AIR);
            }
          }
          if (solid || open) {
            for (const [qx, qy, qz] of p.chests) if (qx === x && qz === z) put(x, qy, z, B.CHEST);
          }
        }
      }
      chunk.maxY = Math.max(chunk.maxY, p.y + 8);
    }
  };

  Fortress.isLootChest = function (x, y, z, seed) {
    for (const p of plansNear(x, z, seed)) {
      for (const [cx, cy, cz] of p.chests) if (cx === x && cy === y && cz === z) return true;
    }
    return false;
  };

  Fortress.loot = function (x, y, z, seed) {
    const I = Items;
    const r = (k) => Noise.hash3(x, y, z, seed + 950 + k);
    const out = [];
    const add = (id, min, max, k) => { const n = min + Math.floor(r(k) * (max - min + 1)); if (n > 0) out.push({ id, count: n }); };
    add(I.GOLD_INGOT, 1, 4, 1); add(I.IRON_INGOT, 1, 4, 2); add(I.NETHER_WART, 2, 6, 3);
    add(I.DIAMOND, 0, 2, 4); add(B.OBSIDIAN, 0, 2, 5); add(I.BLAZE_ROD, 0, 2, 6);
    if (r(7) < 0.35) out.push({ id: I.armor.gold_chestplate, count: 1, dur: I.maxDurability(I.armor.gold_chestplate) });
    if (r(8) < 0.25) out.push({ id: I.tools.gold_sword, count: 1, dur: I.maxDurability(I.tools.gold_sword) });
    return out;
  };

  global.Fortress = Fortress;
})(window);
