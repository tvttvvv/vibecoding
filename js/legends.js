(function (global) {
  'use strict';

  const B = Blocks;

  // Two rare structures of our own, not from Minecraft. Each 384-block cell
  // of the overworld may hold one, chosen from the seed:
  //  - a shrine: a ring of ruined pillars on a grassy rise, with Excalibur
  //    standing in a stone at its heart and a pillar of light above it;
  //  - an ancient laboratory: a white, half-fallen building whose chest
  //    holds Aris's Supernova.
  // Every chunk builds its own part of a structure from the same plan.
  const CELL = 384;
  const REACH = 9;                 // how far a structure spreads from its middle
  const cache = new Map();
  const hash = (x, z, s) => Noise.hash2(x, z, s);

  function planAt(cellX, cellZ, seed) {
    const key = seed + ':' + cellX + ',' + cellZ;
    if (cache.has(key)) return cache.get(key);
    let plan = null;
    const roll = hash(cellX, cellZ, seed + 1201);
    const kind = roll < 0.3 ? 'shrine' : roll < 0.6 ? 'lab' : null;
    if (kind) {
      const x = cellX * CELL + 48 + Math.floor(hash(cellX, cellZ, seed + 1202) * (CELL - 96));
      const z = cellZ * CELL + 48 + Math.floor(hash(cellX, cellZ, seed + 1203) * (CELL - 96));
      plan = makePlan(kind, x, z, seed);
    }
    cache.set(key, plan);
    return plan;
  }

  // only on dry land that is not too steep, and away from villages
  function makePlan(kind, x, z, seed) {
    const H = (a, b) => Math.floor(WorldGen.columnHeight(a, b, seed));
    const g = H(x, z) + 1;
    if (g <= WorldConst.SEA_LEVEL + 2 || g > WorldConst.WORLD_HEIGHT - 30) return null;
    for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6], [0, 0]]) {
      const h = H(x + dx, z + dz);
      if (h < WorldConst.SEA_LEVEL + 1 || Math.abs(h + 1 - g) > 4) return null;
    }
    if (global.Villages && Villages.near(x, z, seed, Villages.RADIUS + 14)) return null;
    return { kind, x, z, g };
  }

  function plansNear(wx, wz, seed, reach) {
    const out = [];
    const r = (reach || REACH) + 2;
    const c0x = Math.floor((wx - r) / CELL), c1x = Math.floor((wx + r) / CELL);
    const c0z = Math.floor((wz - r) / CELL), c1z = Math.floor((wz + r) / CELL);
    for (let a = c0x; a <= c1x; a++) {
      for (let b = c0z; b <= c1z; b++) {
        const p = planAt(a, b, seed);
        if (p && Math.abs(p.x - wx) <= r && Math.abs(p.z - wz) <= r) out.push(p);
      }
    }
    return out;
  }

  const Legends = { CELL, REACH };

  Legends.plansNear = plansNear;

  // is this spot part of a structure? (trees keep out)
  Legends.near = function (wx, wz, seed, dist) {
    return plansNear(wx, wz, seed, dist).length > 0;
  };

  // where the sword stands, for a shrine plan
  Legends.swordAt = function (p) { return { x: p.x, y: p.g + 1, z: p.z }; };
  Legends.chestAt = function (p) { return { x: p.x, y: p.g, z: p.z - 2 }; };

  Legends.stamp = function (chunk, seed) {
    const CS = WorldConst.CHUNK_SIZE;
    const bx = chunk.cx * CS, bz = chunk.cz * CS;
    const plans = plansNear(bx + 8, bz + 8, seed, REACH + 8);
    if (!plans.length) return;
    const inChunk = (x, z) => x >= bx && x < bx + CS && z >= bz && z < bz + CS;
    const idx = (x, y, z) => (y * CS + (z - bz)) * CS + (x - bx);
    const put = (x, y, z, id) => {
      if (!inChunk(x, z) || y < 1 || y >= WorldConst.WORLD_HEIGHT) return;
      chunk.data[idx(x, y, z)] = id;
      if (id !== B.AIR && y > chunk.maxY) chunk.maxY = y;
    };
    const get = (x, y, z) => chunk.data[idx(x, y, z)];
    const h = (x, y, z, k) => Noise.hash3(x, y, z, seed + 1300 + k);
    for (const p of plans) {
      // level the ground: a solid floor at g - 1, open air above
      const R = p.kind === 'shrine' ? 7 : 7;
      for (let x = p.x - R; x <= p.x + R; x++) {
        for (let z = p.z - R; z <= p.z + R; z++) {
          if (!inChunk(x, z)) continue;
          const d = Math.max(Math.abs(x - p.x), Math.abs(z - p.z));
          const round = p.kind === 'shrine' ? Math.hypot(x - p.x, z - p.z) <= R + 0.4 : d <= R;
          if (!round) continue;
          for (let y = p.g; y < p.g + 14; y++) put(x, y, z, B.AIR);
          put(x, p.g - 1, z, B.GRASS);
          for (let y = p.g - 2; y > p.g - 10; y--) {
            const id = get(x, y, z);
            if (id !== B.AIR && !B.byId[id].liquid && B.byId[id].solid) break;
            put(x, y, z, y > p.g - 4 ? B.DIRT : B.STONE);
          }
          if (p.kind === 'shrine' && d >= 4 && h(x, 0, z, 1) < 0.18) put(x, p.g, z, h(x, 1, z, 2) < 0.5 ? B.POPPY : B.TALL_GRASS);
        }
      }
      if (p.kind === 'shrine') this.shrine(p, put, h);
      else this.lab(p, put, h);
    }
  };

  Legends.shrine = function (p, put, h) {
    const { x, z, g } = p;
    const brick = (a, b, c) => (h(a, b, c, 3) < 0.35 ? B.MOSSY_STONE_BRICKS : B.STONE_BRICKS);
    // a worn stone path in a ring
    for (let a = -5; a <= 5; a++) {
      for (let b = -5; b <= 5; b++) {
        const r = Math.hypot(a, b);
        if (r > 3.6 && r < 5.2 && h(x + a, 0, z + b, 4) < 0.7) put(x + a, g - 1, z + b, h(x + a, 1, z + b, 5) < 0.4 ? B.MOSSY_COBBLESTONE : B.STONE_BRICKS);
      }
    }
    // the stepped pedestal, the sword's stone on top
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) put(x + a, g, z + b, brick(x + a, g, z + b));
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) put(x + a, g + 1, z + b, brick(x + a, g + 1, z + b));
    put(x, g + 1, z, B.SWORD_STONE);
    // broken pillars at the corners, a torch on the tall ones
    const pillars = [[-5, -5], [5, -5], [-5, 5], [5, 5], [0, -6], [0, 6], [-6, 0], [6, 0]];
    pillars.forEach(([a, b], i) => {
      const tall = 1 + Math.floor(h(x + a, i, z + b, 6) * 4);
      for (let y = 0; y < tall; y++) put(x + a, g + y, z + b, brick(x + a, g + y, z + b));
      if (tall >= 3) put(x + a, g + tall, z + b, B.TORCH);
    });
  };

  Legends.lab = function (p, put, h) {
    const { x, z, g } = p;
    const R = 5;
    for (let a = -R; a <= R; a++) {
      for (let b = -R; b <= R; b++) {
        const wx = x + a, wz = z + b;
        const edge = Math.abs(a) === R || Math.abs(b) === R;
        put(wx, g - 1, wz, edge ? B.CALCITE : (a + b) % 2 ? B.STONE_BRICKS : B.CALCITE);
        if (edge) {
          // walls of white stone with long windows, broken in places
          const door = b === R && Math.abs(a) <= 0;
          const top = 4 - (h(wx, 7, wz, 7) < 0.3 ? 1 + Math.floor(h(wx, 8, wz, 8) * 3) : 0);
          for (let y = 0; y < top; y++) {
            if (door && y < 2) continue;
            const window = (y === 1 || y === 2) && Math.abs(Math.abs(a) === R ? b : a) % 3 === 1;
            put(wx, g + y, wz, window ? B.GLASS : B.CALCITE);
          }
        } else if (h(wx, 9, wz, 9) > 0.35) {
          // what is left of the roof
          put(wx, g + 4, wz, B.STONE_BRICKS);
        }
      }
    }
    // lights in the ceiling corners, crystals growing in the rubble
    for (const [a, b] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) put(x + a, g + 4, z + b, B.GLOWSTONE);
    for (const [a, b] of [[-4, 2], [4, -1], [-2, 4], [3, 3]]) {
      put(x + a, g, z + b, B.AMETHYST_BLOCK);
      put(x + a, g + 1, z + b, B.AMETHYST_CLUSTER);
    }
    // the bench and the chest with the Supernova
    for (let a = -2; a <= 2; a++) put(x + a, g, z - 3, B.STONE_BRICKS);
    put(x, g, z - 2, B.CHEST);
    put(x - 2, g + 1, z - 3, B.LAMP_ON || B.GLOWSTONE);
    put(x + 2, g + 1, z - 3, B.REDSTONE_BLOCK);
  };

  Legends.isLootChest = function (x, y, z, seed) {
    for (const p of plansNear(x, z, seed)) {
      if (p.kind !== 'lab') continue;
      const c = Legends.chestAt(p);
      if (c.x === x && c.y === y && c.z === z) return true;
    }
    return false;
  };

  Legends.loot = function (x, y, z, seed) {
    const I = Items;
    const r = (k) => Noise.hash3(x, y, z, seed + 1400 + k);
    const out = [{ id: I.SUPERNOVA, count: 1 }];
    const add = (id, min, max, k) => { const n = min + Math.floor(r(k) * (max - min + 1)); if (n > 0) out.push({ id, count: n }); };
    add(I.REDSTONE, 4, 12, 1); add(I.IRON_INGOT, 2, 6, 2); add(I.GOLD_INGOT, 1, 4, 3);
    add(I.DIAMOND, 1, 2, 4); add(I.AMETHYST_SHARD, 2, 6, 5);
    if (r(6) < 0.5) out.push({ id: I.GOLDEN_APPLE, count: 1 });
    return out;
  };

  // the shrines within reach, for drawing their swords and light
  Legends.shrinesNear = function (wx, wz, seed, dist) {
    return plansNear(wx, wz, seed, dist).filter((p) => p.kind === 'shrine');
  };

  global.Legends = Legends;
})(window);
