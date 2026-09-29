(function (global) {
  'use strict';

  const B = Blocks;
  const I = Items;

  const GRAVITY = 26;
  const MAX_FALL = 50;
  const DESPAWN_DIST = 52;
  const SPAWN_MIN = 22;
  const SPAWN_MAX = 40;
  const HOSTILE_CAP = 8;
  const PASSIVE_CAP = 8;
  const TORCH_RADIUS = 8;

  // Every mob is a handful of boxes, the same way the other players are drawn:
  // [width, height, depth, colour, x, y, z, 'head' when it should follow the gaze]
  const TYPES = {
    pig: {
      name: '돼지', hp: 10, hw: 0.45, h: 0.9, speed: 1.5, hostile: false,
      drops: [[I.RAW_PORK, 1, 3]], breedWith: I.CARROT,
      parts: [
        [0.9, 0.6, 1.3, 0xf0a8a0, 0, 0.5, 0],
        [0.2, 0.4, 0.2, 0xe08e86, -0.28, 0.2, -0.45],
        [0.2, 0.4, 0.2, 0xe08e86, 0.28, 0.2, -0.45],
        [0.2, 0.4, 0.2, 0xe08e86, -0.28, 0.2, 0.45],
        [0.2, 0.4, 0.2, 0xe08e86, 0.28, 0.2, 0.45],
        [0.6, 0.6, 0.5, 0xf0a8a0, 0, 0.62, -0.85, 'head'],
        [0.25, 0.2, 0.1, 0xd98d84, 0, 0.56, -1.12, 'head']
      ]
    },
    cow: {
      name: '소', hp: 10, hw: 0.45, h: 1.3, speed: 1.4, hostile: false,
      drops: [[I.RAW_BEEF, 1, 3], [I.LEATHER, 0, 2]], breedWith: I.WHEAT,
      parts: [
        [0.9, 0.8, 1.4, 0x4a3322, 0, 0.85, 0],
        [0.24, 0.5, 0.24, 0x3b2a1c, -0.28, 0.25, -0.45],
        [0.24, 0.5, 0.24, 0x3b2a1c, 0.28, 0.25, -0.45],
        [0.24, 0.5, 0.24, 0x3b2a1c, -0.28, 0.25, 0.45],
        [0.24, 0.5, 0.24, 0x3b2a1c, 0.28, 0.25, 0.45],
        [0.55, 0.55, 0.55, 0xe8e2d8, 0, 1.05, -0.92, 'head'],
        [0.12, 0.12, 0.12, 0xdad4c8, -0.34, 1.28, -0.92, 'head'],
        [0.12, 0.12, 0.12, 0xdad4c8, 0.34, 1.28, -0.92, 'head']
      ]
    },
    chicken: {
      name: '닭', hp: 4, hw: 0.22, h: 0.7, speed: 1.4, hostile: false,
      drops: [[I.RAW_CHICKEN, 1, 1], [I.FEATHER, 0, 2]], breedWith: I.SEEDS,
      parts: [
        [0.4, 0.45, 0.5, 0xf2f2f2, 0, 0.4, 0],
        [0.1, 0.25, 0.1, 0xf0c635, -0.1, 0.13, 0],
        [0.1, 0.25, 0.1, 0xf0c635, 0.1, 0.13, 0],
        [0.3, 0.3, 0.3, 0xf2f2f2, 0, 0.72, -0.2, 'head'],
        [0.12, 0.1, 0.16, 0xf0c635, 0, 0.7, -0.4, 'head'],
        [0.1, 0.14, 0.06, 0xd5322b, 0, 0.86, -0.28, 'head']
      ]
    },
    sheep: {
      name: '양', hp: 8, hw: 0.45, h: 1.2, speed: 1.4, hostile: false,
      drops: [[B.WOOL, 1, 1], [I.RAW_MUTTON, 1, 2]], breedWith: I.WHEAT,
      parts: [
        [1.0, 0.85, 1.3, 0xe9ecec, 0, 0.8, 0],
        [0.2, 0.45, 0.2, 0xd8d2c8, -0.3, 0.22, -0.4],
        [0.2, 0.45, 0.2, 0xd8d2c8, 0.3, 0.22, -0.4],
        [0.2, 0.45, 0.2, 0xd8d2c8, -0.3, 0.22, 0.4],
        [0.2, 0.45, 0.2, 0xd8d2c8, 0.3, 0.22, 0.4],
        [0.45, 0.45, 0.5, 0xe0dcd4, 0, 0.95, -0.8, 'head']
      ]
    },
    zombie: {
      name: '좀비', hp: 20, hw: 0.3, h: 1.9, speed: 2.1, hostile: true,
      damage: 3, reach: 1.7, burns: true, drops: [[I.ROTTEN_FLESH, 0, 2]], rare: [[I.CARROT, 0.05], [I.IRON_INGOT, 0.025]],
      parts: [
        [0.5, 0.75, 0.28, 0x2f6b3f, 0, 1.05, 0],
        [0.22, 0.72, 0.22, 0x33437a, -0.13, 0.36, 0],
        [0.22, 0.72, 0.22, 0x33437a, 0.13, 0.36, 0],
        [0.18, 0.6, 0.18, 0x4a8c5a, -0.34, 1.2, -0.2],
        [0.18, 0.6, 0.18, 0x4a8c5a, 0.34, 1.2, -0.2],
        [0.46, 0.46, 0.46, 0x4a8c5a, 0, 1.66, 0, 'head'],
        [0.09, 0.07, 0.03, 0x14301c, -0.11, 1.7, -0.24, 'head'],
        [0.09, 0.07, 0.03, 0x14301c, 0.11, 1.7, -0.24, 'head']
      ]
    },
    skeleton: {
      name: '스켈레톤', hp: 20, hw: 0.3, h: 1.9, speed: 2.0, hostile: true,
      damage: 2, reach: 1.7, ranged: true, burns: true, drops: [[I.BONE, 0, 2]],
      parts: [
        [0.4, 0.75, 0.22, 0xd8d6cc, 0, 1.05, 0],
        [0.16, 0.72, 0.16, 0xc8c6bc, -0.11, 0.36, 0],
        [0.16, 0.72, 0.16, 0xc8c6bc, 0.11, 0.36, 0],
        [0.14, 0.6, 0.14, 0xd8d6cc, -0.3, 1.2, -0.1],
        [0.14, 0.6, 0.14, 0xd8d6cc, 0.3, 1.2, -0.1],
        [0.44, 0.44, 0.44, 0xe4e2d8, 0, 1.66, 0, 'head'],
        [0.09, 0.08, 0.03, 0x1a1a1a, -0.1, 1.7, -0.23, 'head'],
        [0.09, 0.08, 0.03, 0x1a1a1a, 0.1, 1.7, -0.23, 'head']
      ]
    },
    creeper: {
      name: '크리퍼', hp: 20, hw: 0.3, h: 1.7, speed: 2.0, hostile: true,
      explodes: true, drops: [[I.GUNPOWDER, 0, 2]],
      parts: [
        [0.5, 0.85, 0.3, 0x5cab4a, 0, 0.92, 0],
        [0.22, 0.4, 0.3, 0x4f9440, -0.13, 0.2, -0.2],
        [0.22, 0.4, 0.3, 0x4f9440, 0.13, 0.2, -0.2],
        [0.22, 0.4, 0.3, 0x4f9440, -0.13, 0.2, 0.2],
        [0.22, 0.4, 0.3, 0x4f9440, 0.13, 0.2, 0.2],
        [0.46, 0.46, 0.46, 0x66b854, 0, 1.55, 0, 'head'],
        [0.12, 0.12, 0.03, 0x14260f, -0.11, 1.6, -0.24, 'head'],
        [0.12, 0.12, 0.03, 0x14260f, 0.11, 1.6, -0.24, 'head'],
        [0.16, 0.2, 0.03, 0x14260f, 0, 1.44, -0.24, 'head']
      ]
    },
    spider: {
      name: '거미', hp: 16, hw: 0.6, h: 0.85, speed: 2.7, hostile: true,
      damage: 2, reach: 1.9, drops: [[I.STRING, 0, 2]], rare: [[I.SPIDER_EYE, 0.33]],
      parts: [
        [0.8, 0.5, 0.8, 0x2b2b2b, 0, 0.5, 0.2],
        [0.5, 0.4, 0.5, 0x333333, 0, 0.5, -0.4, 'head'],
        [0.1, 0.1, 0.04, 0xd5322b, -0.14, 0.6, -0.62, 'head'],
        [0.1, 0.1, 0.04, 0xd5322b, 0.14, 0.6, -0.62, 'head'],
        [1.5, 0.1, 0.1, 0x1f1f1f, 0, 0.42, -0.1],
        [1.5, 0.1, 0.1, 0x1f1f1f, 0, 0.42, 0.25],
        [1.5, 0.1, 0.1, 0x1f1f1f, 0, 0.42, 0.6]
      ]
    }
  };

  // ---- the nether's own
  TYPES.zpiglin = {
    name: '좀비 피글린', hp: 20, hw: 0.3, h: 1.9, speed: 2.3, hostile: false, neutral: true, nether: true,
    damage: 5, reach: 1.7, drops: [[I.ROTTEN_FLESH, 0, 1]], rare: [[I.GOLD_INGOT, 0.1]], noSpawn: true,
    parts: [
      [0.5, 0.75, 0.28, 0x6b8a4a, 0, 1.05, 0],
      [0.22, 0.72, 0.22, 0x8a6a4a, -0.13, 0.36, 0],
      [0.22, 0.72, 0.22, 0xe0a090, 0.13, 0.36, 0],
      [0.18, 0.6, 0.18, 0xe0a090, -0.34, 1.2, -0.1],
      [0.18, 0.6, 0.18, 0x7aa05a, 0.34, 1.2, -0.2],
      [0.06, 0.7, 0.1, 0xf0c635, 0.34, 1.1, -0.55],
      [0.52, 0.46, 0.46, 0xe0a090, 0, 1.66, 0, 'head'],
      [0.24, 0.16, 0.08, 0xd08a7a, 0, 1.58, -0.26, 'head'],
      [0.2, 0.12, 0.3, 0x5a8a3a, 0.18, 1.82, 0.05, 'head'],
      [0.07, 0.07, 0.03, 0x1a1a1a, -0.13, 1.72, -0.24, 'head'],
      [0.07, 0.07, 0.03, 0x1a1a1a, 0.13, 1.72, -0.24, 'head']
    ]
  };
  TYPES.ghast = {
    name: '가스트', hp: 10, hw: 2, h: 4.2, speed: 1.4, hostile: true, nether: true, flying: true,
    ranged: 'fireball', drops: [[I.GUNPOWDER, 0, 2]], rare: [[I.GHAST_TEAR, 0.5]], noSpawn: true,
    parts: [
      [4, 4, 4, 0xf2f2f2, 0, 2.5, 0],
      [0.3, 1.4, 0.3, 0xe4e4e4, -1.3, 0.1, -1.3], [0.3, 1.8, 0.3, 0xe4e4e4, 0, -0.1, -1.3], [0.3, 1.2, 0.3, 0xe4e4e4, 1.3, 0.2, -1.3],
      [0.3, 1.6, 0.3, 0xe4e4e4, -1.3, 0, 0], [0.3, 1.3, 0.3, 0xe4e4e4, 0, 0.15, 0], [0.3, 1.9, 0.3, 0xe4e4e4, 1.3, -0.15, 0],
      [0.3, 1.5, 0.3, 0xe4e4e4, -1.3, 0.05, 1.3], [0.3, 1.2, 0.3, 0xe4e4e4, 0, 0.2, 1.3], [0.3, 1.7, 0.3, 0xe4e4e4, 1.3, -0.05, 1.3],
      [0.6, 0.25, 0.05, 0x505050, -0.8, 3.1, -2.02, 'head'], [0.6, 0.25, 0.05, 0x505050, 0.8, 3.1, -2.02, 'head'],
      [0.9, 0.5, 0.05, 0x505050, 0, 2.1, -2.02, 'head']
    ]
  };

  // ---- fortress dwellers, and the piglins of the wastes
  TYPES.blaze = {
    name: '블레이즈', hp: 20, hw: 0.3, h: 1.8, speed: 2.0, hostile: true, nether: true, flying: true, lowFly: true,
    ranged: 'blaze', fireImmune: true, drops: [[I.BLAZE_ROD, 0, 1]], noSpawn: true,
    parts: [
      [0.5, 0.5, 0.5, 0xf2c030, 0, 1.45, 0, 'head'],
      [0.1, 0.1, 0.03, 0x3a2a0a, -0.12, 1.5, -0.26, 'head'], [0.1, 0.1, 0.03, 0x3a2a0a, 0.12, 1.5, -0.26, 'head'],
      [0.12, 0.6, 0.12, 0xe8a020, -0.45, 1.0, 0], [0.12, 0.6, 0.12, 0xe8a020, 0.45, 1.0, 0],
      [0.12, 0.6, 0.12, 0xe8a020, 0, 1.0, -0.45], [0.12, 0.6, 0.12, 0xe8a020, 0, 1.0, 0.45],
      [0.12, 0.6, 0.12, 0xd88a10, -0.3, 0.45, -0.3], [0.12, 0.6, 0.12, 0xd88a10, 0.3, 0.45, 0.3],
      [0.12, 0.6, 0.12, 0xd88a10, 0.3, 0.45, -0.3], [0.12, 0.6, 0.12, 0xd88a10, -0.3, 0.45, 0.3],
      [0.3, 0.3, 0.3, 0x5a3a10, 0, 0.9, 0]
    ]
  };
  TYPES.wskeleton = {
    name: '위더 스켈레톤', hp: 20, hw: 0.35, h: 2.4, speed: 2.3, hostile: true, nether: true, fireImmune: true,
    damage: 8, reach: 1.9, drops: [[I.COAL, 0, 1], [I.BONE, 0, 2]], noSpawn: true,
    parts: [
      [0.5, 0.85, 0.26, 0x2a2a2a, 0, 1.35, 0],
      [0.14, 0.95, 0.14, 0x1f1f1f, -0.13, 0.47, 0], [0.14, 0.95, 0.14, 0x1f1f1f, 0.13, 0.47, 0],
      [0.13, 0.85, 0.13, 0x1f1f1f, -0.34, 1.45, -0.1], [0.13, 0.85, 0.13, 0x1f1f1f, 0.34, 1.45, -0.25],
      [0.07, 0.9, 0.12, 0x8a8a8a, 0.34, 1.3, -0.72],
      [0.55, 0.55, 0.55, 0x2f2f2f, 0, 2.05, 0, 'head'],
      [0.1, 0.1, 0.03, 0x0a0a0a, -0.12, 2.1, -0.28, 'head'], [0.1, 0.1, 0.03, 0x0a0a0a, 0.12, 2.1, -0.28, 'head']
    ]
  };
  TYPES.piglin = {
    name: '피글린', hp: 16, hw: 0.3, h: 1.9, speed: 2.3, hostile: false, piglin: true, nether: true,
    damage: 5, reach: 1.7, drops: [[I.GOLD_NUGGET, 0, 3]], noSpawn: true,
    parts: [
      [0.5, 0.75, 0.28, 0x6b4a2a, 0, 1.05, 0],
      [0.22, 0.72, 0.22, 0x4a3a2a, -0.13, 0.36, 0], [0.22, 0.72, 0.22, 0x4a3a2a, 0.13, 0.36, 0],
      [0.18, 0.66, 0.18, 0xe0a090, -0.34, 1.12, 0], [0.18, 0.66, 0.18, 0xe0a090, 0.34, 1.12, -0.1],
      [0.07, 0.75, 0.1, 0xf0c635, 0.34, 1.0, -0.5],
      [0.56, 0.48, 0.48, 0xe8a898, 0, 1.68, 0, 'head'],
      [0.26, 0.18, 0.1, 0xd88a7a, 0, 1.6, -0.28, 'head'],
      [0.08, 0.08, 0.03, 0x1a1a1a, -0.14, 1.75, -0.25, 'head'], [0.08, 0.08, 0.03, 0x1a1a1a, 0.14, 1.75, -0.25, 'head'],
      [0.12, 0.2, 0.06, 0xf0c635, -0.3, 1.9, 0, 'head'], [0.12, 0.2, 0.06, 0xf0c635, 0.3, 1.9, 0, 'head']
    ]
  };

  // ---- the End
  TYPES.enderman = {
    name: '엔더맨', hp: 40, hw: 0.3, h: 2.9, speed: 3.0, hostile: false, enderman: true,
    damage: 7, reach: 2.0, drops: [[I.ENDER_PEARL, 0, 1]], noSpawn: true,
    parts: [
      [0.5, 0.75, 0.26, 0x141414, 0, 1.95, 0],
      [0.12, 1.55, 0.12, 0x101010, -0.14, 0.78, 0], [0.12, 1.55, 0.12, 0x101010, 0.14, 0.78, 0],
      [0.12, 1.5, 0.12, 0x101010, -0.33, 1.6, 0], [0.12, 1.5, 0.12, 0x101010, 0.33, 1.6, 0],
      [0.5, 0.5, 0.5, 0x161616, 0, 2.6, 0, 'head'],
      [0.16, 0.05, 0.03, 0xd070f0, -0.12, 2.58, -0.26, 'head'], [0.16, 0.05, 0.03, 0xd070f0, 0.12, 2.58, -0.26, 'head']
    ]
  };
  TYPES.crystal = {
    name: '엔드 수정', hp: 1, hw: 0.5, h: 1.6, speed: 0, hostile: false, crystal: true, still: true, noSpawn: true,
    drops: [],
    parts: [
      [0.9, 0.9, 0.9, 0xf0b8f0, 0, 0.9, 0, 'head'],
      [0.5, 0.5, 0.5, 0xd040d0, 0, 0.9, 0, 'head'],
      [1.0, 0.25, 1.0, 0x2a2a2a, 0, 0.12, 0]
    ]
  };
  TYPES.dragon = {
    name: '엔더 드래곤', hp: 200, hw: 2.5, h: 2.6, speed: 13, hostile: true, dragon: true, boss: true,
    fireImmune: true, still: true, noSpawn: true, drops: [],
    parts: [
      [2.2, 1.9, 7.0, 0x1a1a1a, 0, 1.5, 0],
      [0.9, 0.9, 3.0, 0x161616, 0, 2.0, -4.6],
      [1.5, 1.2, 2.0, 0x1c1c1c, 0, 2.2, -6.9, 'head'],
      [1.3, 0.5, 1.2, 0x121212, 0, 1.7, -8.2, 'head'],
      [0.3, 0.15, 0.05, 0xc050e0, -0.45, 2.45, -7.92, 'head'], [0.3, 0.15, 0.05, 0xc050e0, 0.45, 2.45, -7.92, 'head'],
      [0.25, 0.5, 0.25, 0x2a2a2a, -0.4, 3.0, -6.6, 'head'], [0.25, 0.5, 0.25, 0x2a2a2a, 0.4, 3.0, -6.6, 'head'],
      [7.0, 0.2, 4.0, 0x242424, -4.5, 2.6, -0.8], [7.0, 0.2, 4.0, 0x242424, 4.5, 2.6, -0.8],
      [0.3, 0.3, 4.2, 0x3a3a3a, -4.5, 2.8, -0.8], [0.3, 0.3, 4.2, 0x3a3a3a, 4.5, 2.8, -0.8],
      [0.7, 0.7, 5.0, 0x161616, 0, 1.4, 5.8],
      [0.35, 0.35, 3.0, 0x141414, 0, 1.3, 9.3],
      [0.5, 1.4, 0.5, 0x141414, -0.8, 0.2, -2.0], [0.5, 1.4, 0.5, 0x141414, 0.8, 0.2, -2.0],
      [0.6, 1.6, 0.6, 0x141414, -0.8, 0.1, 2.2], [0.6, 1.6, 0.6, 0x141414, 0.8, 0.1, 2.2],
      [0.3, 0.4, 0.3, 0x2a2a2a, 0, 2.6, -2.0], [0.3, 0.4, 0.3, 0x2a2a2a, 0, 2.6, 0.5], [0.3, 0.4, 0.3, 0x2a2a2a, 0, 2.6, 3.0]
    ]
  };

  // slimes bounce about in the dark underground
  TYPES.slime = {
    name: '슬라임', hp: 8, hw: 0.5, h: 1.0, speed: 2.4, hostile: true, hops: true, underground: true,
    damage: 2, reach: 1.4, drops: [[I.SLIME_BALL, 0, 2]],
    parts: [
      [0.98, 0.98, 0.98, 0x6fbf4a, 0, 0.49, 0],
      [0.5, 0.5, 0.5, 0x4f9a30, 0, 0.45, 0],
      [0.18, 0.18, 0.03, 0x1f3a14, -0.22, 0.62, -0.5, 'head'],
      [0.18, 0.18, 0.03, 0x1f3a14, 0.22, 0.62, -0.5, 'head'],
      [0.12, 0.08, 0.03, 0x1f3a14, 0.12, 0.32, -0.5, 'head']
    ]
  };

  // villagers, dressed by trade; they never spawn on their own
  const ROBES = { farmer: [0x8b6a3f, 0xc9a43a], librarian: [0xe8e2d8, 0x8b3a2b], smith: [0x3a3a3a, 0x6a6a6a], cleric: [0x6b3a8c, 0xc9a43a] };
  for (const prof of Object.keys(ROBES)) {
    const [robe, trim] = ROBES[prof];
    TYPES['villager_' + prof] = {
      name: '주민', hp: 20, hw: 0.3, h: 1.9, speed: 1.1, hostile: false,
      drops: [], villager: true, prof, noSpawn: true,
      parts: [
        [0.5, 0.95, 0.3, robe, 0, 0.95, 0],
        [0.52, 0.08, 0.32, trim, 0, 0.55, 0],
        [0.5, 0.2, 0.3, robe, 0, 0.12, 0],
        [0.56, 0.18, 0.34, trim, 0, 1.12, -0.12],
        [0.46, 0.52, 0.46, 0xc99b7c, 0, 1.68, 0, 'head'],
        [0.1, 0.2, 0.1, 0xb07e60, 0, 1.58, -0.27, 'head'],
        [0.08, 0.05, 0.02, 0x2f6b3f, -0.11, 1.76, -0.235, 'head'],
        [0.08, 0.05, 0.02, 0x2f6b3f, 0.11, 1.76, -0.235, 'head'],
        [0.48, 0.1, 0.48, 0x3b2a1c, 0, 1.97, 0, 'head']
      ]
    };
  }

  const TYPE_NAMES = Object.keys(TYPES);
  const PASSIVE = TYPE_NAMES.filter((t) => !TYPES[t].hostile && !TYPES[t].noSpawn);
  const HOSTILE = TYPE_NAMES.filter((t) => TYPES[t].hostile && !TYPES[t].noSpawn);

  let nextId = 1;

  function solidAt(world, x, y, z) {
    const id = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return id !== B.AIR && B.byId[id].solid;
  }

  // ------------------------------------------------------------------- mob
  function Mob(type, x, y, z) {
    const def = TYPES[type];
    this.id = nextId++;
    this.type = type;
    this.def = def;
    this.x = x; this.y = y; this.z = z;
    this.vy = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.hp = def.hp;
    this.onGround = false;
    this.wander = 0;
    this.wanderYaw = this.yaw;
    this.attackCooldown = 0;
    this.fuse = 0;
    this.hurtFlash = 0;
    this.age = 0;
    this.dead = false;
    this.group = null;
    // breeding: love mode after being fed, a rest afterwards, babies grow up
    this.size = 1;
    this.love = 0;
    this.breedCooldown = 0;
    this.growUp = 0;
  }

  Mob.prototype.moveAxis = function (world, axis, amount) {
    if (!amount) return false;
    const hw = this.def.hw * this.size, h = this.def.h * this.size;
    if (axis === 'x') this.x += amount; else if (axis === 'z') this.z += amount; else this.y += amount;
    const limit = world.collideLimit(this.x - hw, this.y, this.z - hw, this.x + hw, this.y + h, this.z + hw, axis, amount);
    if (limit === null) return false;
    const ext = axis === 'y' ? h : hw;
    const v = amount > 0 ? limit - ext - 0.001 : limit + (axis === 'y' ? 0 : hw) + 0.001;
    if (axis === 'x') this.x = v; else if (axis === 'z') this.z = v; else this.y = v;
    if (axis === 'y') {
      if (amount < 0) this.onGround = true;
      this.vy = 0;
    }
    return true;
  };

  Mob.prototype.hurt = function (amount, quiet) {
    this.hp -= amount;
    // burning in daylight ticks every frame, so it must not pin the red flash on
    if (!quiet) this.hurtFlash = 0.3;
    if (this.hp <= 0) this.dead = true;
  };

  // ------------------------------------------------------------------ store
  const Mobs = {
    list: [],
    arrows: [],
    enabled: true,
    _spawnTimer: 0,
    _scene: null,
    _group: null,
    TYPES,
    TYPE_NAMES
  };

  Mobs.attach = function (scene) {
    if (this._group) scene.remove(this._group);
    this._scene = scene;
    this._group = new THREE.Group();
    scene.add(this._group);
    this.list.length = 0;
    this.arrows.length = 0;
  };

  Mobs.clear = function () {
    for (const m of this.list) if (m.group) this._group.remove(m.group);
    for (const a of this.arrows) this._group.remove(a.mesh);
    this.list.length = 0;
    this.arrows.length = 0;
  };

  Mobs.count = function (hostile) {
    let n = 0;
    for (const m of this.list) if (TYPES[m.type].hostile === hostile) n++;
    return n;
  };

  // Every mob would otherwise cost one draw call per box. The boxes of a type
  // are merged once into a body and a head, and every mob of that type shares
  // the two geometries; only the material is its own, for the hurt flash.
  const geoCache = {};

  function mergeParts(parts) {
    if (!parts.length) return null;
    const positions = [], colors = [], indices = [];
    let base = 0;
    for (const p of parts) {
      const g = new THREE.BoxGeometry(p[0], p[1], p[2]);
      g.translate(p[4], p[5], p[6]);
      const pos = g.attributes.position.array;
      const idx = g.index.array;
      const c = new THREE.Color(p[3]);
      for (let i = 0; i < pos.length; i += 3) {
        positions.push(pos[i], pos[i + 1], pos[i + 2]);
        colors.push(c.r, c.g, c.b);
      }
      for (let i = 0; i < idx.length; i++) indices.push(idx[i] + base);
      base += pos.length / 3;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return geo;
  }

  function geometryFor(type) {
    if (geoCache[type]) return geoCache[type];
    const parts = TYPES[type].parts;
    geoCache[type] = {
      body: mergeParts(parts.filter((p) => p[7] !== 'head')),
      head: mergeParts(parts.filter((p) => p[7] === 'head'))
    };
    return geoCache[type];
  }

  Mobs.buildModel = function (mob) {
    const geo = geometryFor(mob.type);
    const g = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    if (geo.body) g.add(new THREE.Mesh(geo.body, material));
    let head = null;
    if (geo.head) {
      head = new THREE.Group();
      head.add(new THREE.Mesh(geo.head, material));
      g.add(head);
    }
    g.userData.head = head;
    g.userData.mobId = mob.id;
    g.userData.material = material;
    return g;
  };

  Mobs.spawn = function (type, x, y, z, opts) {
    const mob = new Mob(type, x, y, z);
    if (opts && opts.baby) { mob.size = 0.5; mob.growUp = 300; mob.hp = Math.ceil(mob.hp / 2); }
    mob.group = this.buildModel(mob);
    mob.group.position.set(x, y, z);
    mob.group.scale.setScalar(mob.size);
    this._group.add(mob.group);
    this.list.push(mob);
    return mob;
  };

  // two animals of a kind, both in love and near each other, make a baby
  Mobs.findMate = function (m) {
    let best = null, bd = 64;
    for (const o of this.list) {
      if (o === m || o.type !== m.type || o.love <= 0 || o.size < 1) continue;
      const d = (o.x - m.x) * (o.x - m.x) + (o.z - m.z) * (o.z - m.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };

  Mobs.breed = function (a, b, game) {
    a.love = b.love = 0;
    a.breedCooldown = b.breedCooldown = 120;
    const baby = this.spawn(a.type, (a.x + b.x) / 2, Math.max(a.y, b.y) + 0.2, (a.z + b.z) / 2, { baby: true });
    if (global.Entities) Entities.hearts(baby.x, baby.y + 0.6, baby.z, 6);
    if (game && game.onBred) game.onBred(baby);
    return baby;
  };

  // food held out to an animal: it falls in love, or a baby grows faster
  // a piglin takes a gold ingot, looks it over, and hands something back
  Mobs.barter = function (m, byId) {
    if (!m.def.piglin || m.barterT > 0) return false;
    m.barterT = 5;
    m.barterBy = byId || null;
    m.angry = 0;
    return true;
  };

  const BARTER = [
    [() => ({ id: I.ENDER_PEARL, count: 1 + Math.floor(Math.random() * 2) }), 5],
    [() => ({ id: I.STRING, count: 3 + Math.floor(Math.random() * 7) }), 10],
    [() => ({ id: I.QUARTZ, count: 5 + Math.floor(Math.random() * 8) }), 10],
    [() => ({ id: B.OBSIDIAN, count: 1 }), 8],
    [() => ({ id: B.GRAVEL, count: 8 + Math.floor(Math.random() * 9) }), 10],
    [() => ({ id: I.LEATHER, count: 2 + Math.floor(Math.random() * 3) }), 10],
    [() => ({ id: B.SOUL_SAND, count: 2 + Math.floor(Math.random() * 7) }), 10],
    [() => ({ id: I.NETHER_BRICK, count: 2 + Math.floor(Math.random() * 7) }), 10],
    [() => ({ id: I.ARROW, count: 6 + Math.floor(Math.random() * 7) }), 8],
    [() => ({ id: I.IRON_INGOT, count: 1 + Math.floor(Math.random() * 2) }), 8],
    [() => ({ id: I.POTIONS['fire_res:0'], count: 1 }), 3],
    [() => ({ id: I.MAGMA_CREAM, count: 1 + Math.floor(Math.random() * 3) }), 8]
  ];
  Mobs.barterItem = function () {
    let total = 0;
    for (const [, w] of BARTER) total += w;
    let r = Math.random() * total;
    for (const [make, w] of BARTER) { if ((r -= w) < 0) return make(); }
    return BARTER[0][0]();
  };

  Mobs.feed = function (m, byId) {
    if (m.def.piglin) return this.barter(m, byId);
    if (!m.def.breedWith) return false;
    if (m.size < 1) { m.growUp = Math.max(0, m.growUp * 0.9); return true; }
    if (m.love > 0 || m.breedCooldown > 0) return false;
    m.love = 30;
    return true;
  };

  Mobs.remove = function (mob) {
    const i = this.list.indexOf(mob);
    if (i >= 0) this.list.splice(i, 1);
    if (mob.group) this._group.remove(mob.group);
  };

  Mobs.nearest = function (x, y, z, maxDist) {
    let best = null, bestD = maxDist * maxDist;
    for (const m of this.list) {
      const d = (m.x - x) * (m.x - x) + (m.y - y) * (m.y - y) + (m.z - z) * (m.z - z);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  };

  Mobs.byId = function (id) {
    for (const m of this.list) if (m.id === id) return m;
    return null;
  };

  // --------------------------------------------------------------- spawning
  function skyOpen(world, x, y, z) {
    for (let yy = y + 1; yy < WorldConst.WORLD_HEIGHT; yy++) {
      const id = world.getBlock(x, yy, z);
      if (id !== B.AIR && B.byId[id].opaque) return false;
    }
    return true;
  }

  function isNight(dayTime) {
    return dayTime < 0.23 || dayTime > 0.77;
  }

  Mobs.litNearby = function (game, x, y, z) {
    if (!game.lightSources) return false;
    for (const key of game.lightSources) {
      const p = key.split(',');
      const dx = +p[0] + 0.5 - x, dy = +p[1] + 0.5 - y, dz = +p[2] + 0.5 - z;
      if (dx * dx + dy * dy + dz * dz < TORCH_RADIUS * TORCH_RADIUS) return true;
    }
    return false;
  };

  // An enderman hit (or standing in water) blinks somewhere else nearby
  Mobs.teleport = function (m, world) {
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(m.x + (Math.random() - 0.5) * 32), z = Math.floor(m.z + (Math.random() - 0.5) * 32);
      for (let y = Math.floor(m.y) + 8; y > Math.floor(m.y) - 8; y--) {
        const below = B.byId[world.getBlock(x, y - 1, z)];
        if (!below.solid || below.fluid) continue;
        if (world.getBlock(x, y, z) !== B.AIR || world.getBlock(x, y + 1, z) !== B.AIR || world.getBlock(x, y + 2, z) !== B.AIR) continue;
        if (global.Entities) Entities.burst(m.x, m.y + 1.4, m.z, B.OBSIDIAN, 10, 0.6);
        m.x = x + 0.5; m.y = y; m.z = z + 0.5;
        if (global.Sound) Sound.portal();
        return true;
      }
    }
    return false;
  };

  // ------------------------------------------------------------- the dragon
  // It circles the pillars, now and then dives at the nearest player, and
  // spits fireballs from the circle. Crystals on the pillars heal it.
  Mobs.dragonThink = function (m, dt, world, targets, game) {
    m.age += dt;
    if (!m.phase) { m.phase = 'circle'; m.angle = 0; m.phaseT = 10; m.fireT = 6; }
    let tx, ty, tz;
    let target = null, td = Infinity;
    for (const t of targets) {
      if (t.dead) continue;
      const d = Math.hypot(t.pos.x - m.x, t.pos.z - m.z);
      if (d < td) { td = d; target = t; }
    }
    const canFight = game.mode === 'survival' && target && td < 160;
    m.phaseT -= dt;
    if (m.phase === 'circle') {
      m.angle += dt * 0.32;
      tx = Math.cos(m.angle) * 42; tz = Math.sin(m.angle) * 42; ty = 58 + Math.sin(m.age * 0.5) * 5;
      m.fireT -= dt;
      if (canFight && m.fireT <= 0) {
        m.fireT = 7 + Math.random() * 4;
        if (this.canSee(world, m, target)) this.shoot(m, target, true);
      }
      if (canFight && m.phaseT <= 0) { m.phase = 'charge'; m.phaseT = 7; }
    } else {
      // diving at its prey
      if (!target) { m.phase = 'circle'; m.phaseT = 10; return; }
      tx = target.pos.x; ty = target.pos.y + 1; tz = target.pos.z;
      const d = Math.hypot(tx - m.x, ty - (m.y + 1.5), tz - m.z);
      if (d < 3.5) {
        const len = Math.hypot(tx - m.x, tz - m.z) || 1;
        game.mobAttack(m, 10, (tx - m.x) / len * 2, (tz - m.z) / len * 2, target, true);
        m.phase = 'circle'; m.phaseT = 12 + Math.random() * 6;
      } else if (m.phaseT <= 0) {
        m.phase = 'circle'; m.phaseT = 10;
      }
    }
    const dx = tx - m.x, dy = ty - m.y, dz = tz - m.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const sp = (m.phase === 'charge' ? 16 : 13) * dt;
    const step = Math.min(sp, len);
    m.x += dx / len * step; m.y += dy / len * step; m.z += dz / len * step;
    // turn toward where it is going
    const want = Math.atan2(dx, dz);
    let dyaw = want - m.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    m.yaw += dyaw * Math.min(1, dt * 3);
    // the crystals keep it topped up
    m.healT = (m.healT || 0) + dt;
    let healer = null, hd = 48;
    for (const c of this.list) {
      if (!c.def.crystal || c.dead) continue;
      const d = Math.hypot(c.x - m.x, c.y - m.y, c.z - m.z);
      if (d < hd) { hd = d; healer = c; }
    }
    m.healer = healer;
    if (healer && m.healT >= 1) { m.healT = 0; m.hp = Math.min(m.def.hp, m.hp + 1); }
    this.drawBeam(m, healer);
    if (Math.random() < dt / 6 && global.Sound) Sound.mob('dragon', 'idle', Math.hypot(game.player.pos.x - m.x, game.player.pos.z - m.z));
  };

  Mobs.drawBeam = function (m, crystal) {
    if (!this._beam) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      this._beam = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf080f0, fog: false }));
      this._beam.frustumCulled = false;
    }
    const beam = this._beam;
    if (beam.parent !== this._group) this._group.add(beam);
    beam.visible = !!crystal;
    if (!crystal) return;
    const a = beam.geometry.attributes.position.array;
    a[0] = crystal.x; a[1] = crystal.y + 0.9; a[2] = crystal.z;
    a[3] = m.x; a[4] = m.y + 1.5; a[5] = m.z;
    beam.geometry.attributes.position.needsUpdate = true;
  };

  // the End: endermen wander the island
  Mobs.trySpawnEnd = function (world, player) {
    if (this.list.filter((m) => m.def.enderman).length >= 8) return;
    const ang = Math.random() * Math.PI * 2;
    const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const x = Math.floor(player.pos.x + Math.cos(ang) * dist);
    const z = Math.floor(player.pos.z + Math.sin(ang) * dist);
    const y = world.groundY(x, z);
    if (y <= 0 || world.getBlock(x, y, z) !== B.END_STONE) return;
    if (world.getBlock(x, y + 1, z) !== B.AIR || world.getBlock(x, y + 2, z) !== B.AIR || world.getBlock(x, y + 3, z) !== B.AIR) return;
    this.spawn('enderman', x + 0.5, y + 1, z + 0.5);
  };

  // the nether spawns its own: packs of zombified piglins on the rock, and
  // now and then a ghast out over the open caverns
  Mobs.trySpawnNether = function (world, player, game) {
    if (this.count(true) + this.list.filter((m) => m.type === 'zpiglin' || m.type === 'piglin').length >= HOSTILE_CAP + 4) return;
    // a fortress nearby breeds blazes and wither skeletons in its halls
    const fort = global.Fortress && game ? Fortress.near(player.pos.x, player.pos.z, game.seed, 40) : null;
    if (fort && Math.random() < 0.6) {
      const inFort = this.list.filter((m) => m.type === 'blaze' || m.type === 'wskeleton').length;
      if (inFort < 6) {
        const [x, y, z] = Fortress.randomSpot(fort, Math.random);
        const d = Math.hypot(x - player.pos.x, z - player.pos.z);
        if (d > 10 && d < 48 && world.getBlock(x, y, z) === B.AIR && world.getBlock(x, y + 1, z) === B.AIR &&
            B.byId[world.getBlock(x, y - 1, z)].solid) {
          this.spawn(Math.random() < 0.5 ? 'blaze' : 'wskeleton', x + 0.5, y, z + 0.5);
        }
      }
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const x = Math.floor(player.pos.x + Math.cos(ang) * dist);
      const z = Math.floor(player.pos.z + Math.sin(ang) * dist);
      if (Math.random() < 0.25) {
        if (this.list.filter((m) => m.type === 'ghast').length >= 2) continue;
        const y = 36 + Math.floor(Math.random() * 20);
        let open = true;
        for (let dx = -2; dx <= 2 && open; dx += 2) for (let dy = 0; dy <= 4 && open; dy += 2) for (let dz = -2; dz <= 2 && open; dz += 2) {
          if (world.getBlock(x + dx, y + dy, z + dz) !== B.AIR) open = false;
        }
        if (open) this.spawn('ghast', x + 0.5, y, z + 0.5);
        continue;
      }
      for (let y = 26; y < 70; y++) {
        const below = B.byId[world.getBlock(x, y - 1, z)];
        if (!below.solid || world.getBlock(x, y, z) !== B.AIR || world.getBlock(x, y + 1, z) !== B.AIR) continue;
        const piglins = Math.random() < 0.35;
        const n = piglins ? 1 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) this.spawn(piglins ? 'piglin' : 'zpiglin', x + 0.5 + (Math.random() - 0.5) * 2, y, z + 0.5 + (Math.random() - 0.5) * 2);
        break;
      }
    }
  };

  Mobs.trySpawn = function (world, player, game) {
    if (game.dimension === 'nether') { this.trySpawnNether(world, player, game); return; }
    if (game.dimension === 'end') { this.trySpawnEnd(world, player); return; }
    const night = isNight(game.dayTime);
    for (let attempt = 0; attempt < 6; attempt++) {
      const hostile = attempt < 3;
      if (hostile && this.count(true) >= HOSTILE_CAP) continue;
      if (!hostile && this.count(false) >= PASSIVE_CAP) continue;

      const ang = Math.random() * Math.PI * 2;
      const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const x = Math.floor(player.pos.x + Math.cos(ang) * dist);
      const z = Math.floor(player.pos.z + Math.sin(ang) * dist);
      let y = world.groundY(x, z);
      // monsters also come up out of the caves: a floor somewhere below
      if (hostile && Math.random() < 0.5) {
        const start = 2 + Math.floor(Math.random() * Math.max(1, y - 4));
        for (let yy = start; yy > 1; yy--) {
          if (B.byId[world.getBlock(x, yy, z)].solid && world.getBlock(x, yy + 1, z) === B.AIR && world.getBlock(x, yy + 2, z) === B.AIR) { y = yy; break; }
        }
      }
      if (y <= 0 || y >= WorldConst.WORLD_HEIGHT - 4) continue;
      const a1 = world.getBlock(x, y + 1, z), a2 = world.getBlock(x, y + 2, z);
      if (B.byId[a1].solid || B.byId[a1].liquid || B.byId[a2].solid || B.byId[a2].liquid) continue;

      const surface = world.getBlock(x, y, z);
      const open = skyOpen(world, x, y, z);

      if (hostile) {
        // monsters need darkness, as in Minecraft: no torchlight at all, and
        // not much sky (night, or under a roof)
        const l = world.lightAt(x, y + 1, z);
        const day = World.lightUniforms.uDaylight.value;
        if (l.blk > 0 || l.sky * day > 7) continue;
        if (open && !night) continue;
        // (away from the host the light may not be worked out yet: torches still count)
        if (this.litNearby(game, x, y + 1, z)) continue;
        const type = HOSTILE[Math.floor(Math.random() * HOSTILE.length)];
        if (TYPES[type].underground && (y > 40 || open)) continue;
        // now and then an enderman instead
        this.spawn(Math.random() < 0.08 ? 'enderman' : type, x + 0.5, y + 1, z + 0.5);
      } else {
        if (!open) continue;
        if (surface !== B.GRASS && surface !== B.SNOW_GRASS) continue;
        const type = PASSIVE[Math.floor(Math.random() * PASSIVE.length)];
        const herd = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < herd; i++) {
          this.spawn(type, x + 0.5 + (Math.random() - 0.5) * 3, y + 1, z + 0.5 + (Math.random() - 0.5) * 3);
        }
      }
    }
  };

  // -------------------------------------------------------------- simulation
  Mobs.update = function (dt, world, player, game) {
    if (!this.enabled || !this._group) return;

    // in a room only the host runs the monsters; everyone else is shown the result
    if (Net.active && !Net.isHost) { this.renderOnly(dt); return; }

    // everyone the monsters can go after: me, and in a room the others in my dimension
    const targets = game.mobTargets ? game.mobTargets() : [{ id: null, local: true, pos: player.pos, dead: player.dead }];

    this._spawnTimer += dt;
    if (this._spawnTimer >= 2) {
      this._spawnTimer = 0;
      if (game.mode === 'survival') this.trySpawn(world, targets[Math.floor(Math.random() * targets.length)], game);
    }

    const day = !isNight(game.dayTime);

    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.age += dt;
      if (m.hurtFlash > 0) m.hurtFlash = Math.max(0, m.hurtFlash - dt);
      if (m.love > 0) {
        m.love -= dt;
        if (global.Entities && Math.random() < dt * 2) Entities.hearts(m.x, m.y + m.def.h * m.size + 0.2, m.z, 1);
      }
      if (m.breedCooldown > 0) m.breedCooldown -= dt;
      if (m.size < 1) {
        m.growUp -= dt;
        if (m.growUp <= 0) { m.size = 1; m.hp = m.def.hp; }
      }

      let target = targets[0], distSq = Infinity;
      for (const t of targets) {
        const dx = t.pos.x - m.x, dy = t.pos.y - m.y, dz = t.pos.z - m.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < distSq && !(t.dead && d > 4)) { distSq = d; target = t; }
      }
      if (distSq === Infinity) {
        const t = targets[0];
        distSq = (t.pos.x - m.x) ** 2 + (t.pos.y - m.y) ** 2 + (t.pos.z - m.z) ** 2;
      }

      if ((distSq > DESPAWN_DIST * DESPAWN_DIST && !m.def.still) || m.y < -6) {
        this.remove(m);
        continue;
      }

      // lava burns anything that wanders into it
      if (!m.def.fireImmune && B.byId[world.getBlock(Math.floor(m.x), Math.floor(m.y + 0.1), Math.floor(m.z))].fluid === 'lava') m.hurt(dt * 8);

      // daylight is fatal to the undead unless they found shade
      if (m.def.burns && day && skyOpen(world, Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))) {
        m.hurt(dt * 3, true);
        m.burning = true;
      }

      if (m.dead) {
        this.dropLoot(m, game);
        this.remove(m);
        continue;
      }

      if (m.def.dragon) { this.dragonThink(m, dt, world, targets, game); this.sync(m); continue; }
      if (m.def.crystal) { if (m.group && m.group.userData.head) m.group.userData.head.rotation.y += dt * 2; this.sync(m); continue; }
      // endermen take offence at being stared at
      if (m.def.enderman && !(m.angry > 0) && game.staredAt && game.staredAt(m)) {
        m.angry = 30;
        if (global.Sound) Sound.mob('enderman', 'angry', Math.sqrt(distSq));
      }
      this.think(m, dt, world, target, game, distSq);
      // every so often a mob makes its noise
      if (Math.random() < dt / 9 && global.Sound) {
        Sound.mob(m.def.villager ? 'villager' : m.type, 'idle', Math.hypot(player.pos.x - m.x, player.pos.y - m.y, player.pos.z - m.z));
      }
      this.physics(m, dt, world);
      this.sync(m);
    }

    this.updateArrows(dt, world, targets, game);
  };

  Mobs.think = function (m, dt, world, player, game, distSq) {
    const def = m.def;
    const canSee = game.mode === 'survival' && !player.dead;
    let wantX = 0, wantZ = 0;

    if (m.angry > 0) m.angry -= dt;
    // a piglin looking over its gold is busy; done, it hands over the trade
    if (m.barterT > 0) {
      m.barterT -= dt;
      m.wantX = m.wantZ = 0;
      if (m.barterT <= 0) {
        const st = this.barterItem();
        game.lootDrop(m.x, m.y + 1, m.z, st.id, st.count, null, m.barterBy);
      }
      return;
    }
    // piglins go for anyone not wearing gold
    const aggressive = def.hostile || ((def.neutral || def.enderman) && m.angry > 0) ||
      (def.piglin && (m.angry > 0 || !(game.wearsGold && game.wearsGold(player))));
    const reachY = def.flying ? 40 : 8;
    const range = def.flying ? 40 : 18;
    if (aggressive && canSee && distSq < range * range && Math.abs(player.pos.y - m.y) < reachY) {
      const dx = player.pos.x - m.x, dz = player.pos.z - m.z;
      const len = Math.hypot(dx, dz) || 1;
      const dist = Math.sqrt(distSq);

      if (def.ranged === 'blaze') {
        // a blaze keeps above you and throws three small fireballs at a time
        m.hoverY = player.pos.y + 2.5;
        if (dist < 6) { wantX = -dx / len; wantZ = -dz / len; }
        else if (dist > 12) { wantX = dx / len; wantZ = dz / len; }
        m.attackCooldown -= dt;
        if (m.attackCooldown <= 0 && dist < 24 && this.canSee(world, m, player)) {
          m.shots = 3; m.attackCooldown = 4; m.shotT = 0;
        }
        if (m.shots > 0) {
          m.shotT -= dt;
          if (m.shotT <= 0) {
            m.shots--; m.shotT = 0.3;
            this.shoot(m, player, 'small');
            if (global.Sound) Sound.mob('blaze', 'shoot', dist);
          }
        }
      } else if (def.ranged === 'fireball') {
        // a ghast hangs back and lobs fireballs when it can see you
        if (dist < 12) { wantX = -dx / len; wantZ = -dz / len; }
        m.attackCooldown -= dt;
        if (m.attackCooldown <= 0 && dist < 36 && this.canSee(world, m, player)) {
          m.attackCooldown = 3.2;
          this.shoot(m, player, true);
          if (global.Sound) Sound.mob('ghast', 'shoot', dist);
        }
      } else if (def.ranged) {
        // skeletons keep their distance and shoot
        if (dist < 5) { wantX = -dx / len; wantZ = -dz / len; }
        else if (dist > 8) { wantX = dx / len; wantZ = dz / len; }
        m.attackCooldown -= dt;
        if (m.attackCooldown <= 0 && dist < 14) {
          m.attackCooldown = 2.2;
          this.shoot(m, player);
          if (global.Sound) Sound.bow(dist);
        }
      } else if (def.explodes) {
        if (dist > 1.9) { wantX = dx / len; wantZ = dz / len; }
        if (dist < 3.2) {
          if (m.fuse === 0 && global.Sound) Sound.fuse(dist);
          m.fuse += dt;
          if (m.fuse > 1.5) { this.explode(m, world, game.player, game); return; }
        } else {
          m.fuse = Math.max(0, m.fuse - dt);
        }
      } else {
        wantX = dx / len; wantZ = dz / len;
        m.attackCooldown -= dt;
        if (dist < (def.reach || 1.7) && m.attackCooldown <= 0) {
          m.attackCooldown = 1.0;
          game.mobAttack(m, def.damage || 2, dx / len, dz / len, player);
        }
      }
      m.yaw = Math.atan2(dx, dz);
    } else {
      // idle drifting: pick a direction, hold it for a few seconds, then stop
      m.wander -= dt;
      if (m.wander <= 0) {
        m.wander = 2 + Math.random() * 4;
        m.moving = Math.random() < 0.6;
        m.wanderYaw = Math.random() * Math.PI * 2;
      }
      // villagers keep to their village
      if (m.home && Math.hypot(m.x - m.home.x, m.z - m.home.z) > 14) {
        m.moving = true; m.wanderYaw = Math.atan2(m.home.x - m.x, m.home.z - m.z); m.wander = 1.5;
      }
      // in love: head for a partner, and breed once close enough
      if (m.love > 0 && !(m.panic > 0)) {
        const mate = this.findMate(m);
        if (mate) {
          const mx = mate.x - m.x, mz = mate.z - m.z;
          const md = Math.hypot(mx, mz) || 1;
          if (md < 1.4) { this.breed(m, mate, game); }
          else { m.moving = true; m.wanderYaw = Math.atan2(mx, mz); m.wander = 1; }
        }
      }
      // a hurt animal runs, zig-zagging, for a few seconds
      if (m.panic > 0) {
        m.panic -= dt;
        m.moving = true;
        if (Math.random() < dt * 1.5) m.wanderYaw += (Math.random() - 0.5) * 1.6;
      }
      if (m.moving) {
        const k = m.panic > 0 ? 2 : 1;
        wantX = Math.sin(m.wanderYaw) * k;
        wantZ = Math.cos(m.wanderYaw) * k;
        m.yaw = m.wanderYaw;
      }
    }

    m.wantX = wantX;
    m.wantZ = wantZ;
  };

  Mobs.physics = function (m, dt, world) {
    const speed = m.def.speed;
    m.onGround = false;
    if (m.def.flying) {
      // drift toward a height of its own choosing
      if (m.def.lowFly) { if (m.hoverY === undefined) m.hoverY = m.y + 1; }
      else if (m.hoverY === undefined || Math.random() < dt * 0.2) m.hoverY = 34 + Math.random() * 24;
      m.vy += ((m.hoverY - m.y) * 0.4 - m.vy) * Math.min(1, dt * 2);
      const bx = m.wantX ? m.moveAxis(world, 'x', m.wantX * speed * dt) : false;
      const bz = m.wantZ ? m.moveAxis(world, 'z', m.wantZ * speed * dt) : false;
      if (m.moveAxis(world, 'y', m.vy * dt)) m.hoverY = m.y + (Math.random() - 0.5) * 10;
      if (bx || bz) { m.wanderYaw += Math.PI * (0.5 + Math.random()); m.wander = 3; }
      return;
    }
    m.vy -= GRAVITY * dt;
    if (m.vy < -MAX_FALL) m.vy = -MAX_FALL;

    // a slime only gets anywhere by jumping
    if (m.def.hops) {
      m.hopT = (m.hopT || 0) - dt;
      if (!m.grounded) {
        if (m.wantX) m.moveAxis(world, 'x', m.wantX * speed * dt);
        if (m.wantZ) m.moveAxis(world, 'z', m.wantZ * speed * dt);
      }
      m.moveAxis(world, 'y', m.vy * dt);
      m.grounded = m.onGround;
      if (m.onGround && (m.wantX || m.wantZ) && m.hopT <= 0) {
        m.vy = 6.2;
        m.hopT = 0.8 + Math.random() * 0.9;
        m.grounded = false;
      }
      return;
    }

    const blockedX = m.wantX ? m.moveAxis(world, 'x', m.wantX * speed * dt) : false;
    const blockedZ = m.wantZ ? m.moveAxis(world, 'z', m.wantZ * speed * dt) : false;
    m.moveAxis(world, 'y', m.vy * dt);

    // a wall in the way is a step to hop over
    if ((blockedX || blockedZ) && m.onGround) m.vy = 7.6;
  };

  Mobs.sync = function (m) {
    if (!m.group) return;
    m.group.position.set(m.x, m.y, m.z);
    m.group.rotation.y = m.yaw + Math.PI;   // models are built facing -z, they walk along +z
    // lit like the world around it, and flushed red for a moment when hurt
    const flash = m.hurtFlash > 0;
    const light = this.lightFn ? this.lightFn(m.x, m.y + m.def.h * 0.6, m.z) : 1;
    const mat = m.group.userData.material;
    if (mat) mat.color.setRGB(light, light * (flash ? 0.35 : 1), light * (flash ? 0.35 : 1));
    let s = m.size;
    if (m.def.explodes && m.fuse > 0) s *= 1 + Math.sin(m.fuse * 30) * 0.08 * Math.min(1, m.fuse);
    m.group.scale.set(s, s, s);
  };

  Mobs.renderOnly = function (dt) {
    for (const m of this.list) {
      if (m.hurtFlash > 0) m.hurtFlash = Math.max(0, m.hurtFlash - dt);
      if (m.group) {
        const light = this.lightFn ? this.lightFn(m.x, m.y + m.def.h * 0.6, m.z) : 1;
        const mat = m.group.userData.material;
        if (mat) mat.color.setRGB(light, light * (m.hurtFlash > 0 ? 0.35 : 1), light * (m.hurtFlash > 0 ? 0.35 : 1));
        const k = Math.min(1, dt * 12);
        m.group.position.x += (m.x - m.group.position.x) * k;
        m.group.position.y += (m.y - m.group.position.y) * k;
        m.group.position.z += (m.z - m.group.position.z) * k;
        m.group.rotation.y = m.yaw + Math.PI;   // models are built facing -z, they walk along +z
      }
    }
    // arrows and fireballs the host shot: shown flying, the host decides what they hit
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.age += dt;
      if (!a.fire && !a.small) a.vy -= 9 * dt;
      a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
      if (a.age > 5 || (global.Game && Game.world && solidAt(Game.world, a.x, a.y, a.z))) {
        this._group.remove(a.mesh);
        this.arrows.splice(i, 1);
      }
    }
    this.updateArrowMeshes();
  };

  // --------------------------------------------------------------- weapons
  Mobs.shoot = function (m, player, fire) {
    const ex = player.pos.x, ey = player.pos.y + 1.2, ez = player.pos.z;
    const sx = m.x, sy = m.y + m.def.h * (fire ? 0.5 : 0.85), sz = m.z;
    const dx = ex - sx, dy = ey - sy, dz = ez - sz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const speed = fire === 'small' ? 14 : fire ? 11 : 22;
    const off = fire === 'small' ? 0.6 : fire ? 2.4 : 0;
    const a = this.addArrow(sx + dx / len * off, sy + dy / len * off, sz + dz / len * off,
      dx / len * speed, dy / len * speed + (fire ? 0 : 1.6), dz / len * speed, fire);
    if (Net.active && Net.isHost) {
      Net.sendFx({ kind: 'marrow', x: +a.x.toFixed(2), y: +a.y.toFixed(2), z: +a.z.toFixed(2),
        vx: +a.vx.toFixed(2), vy: +a.vy.toFixed(2), vz: +a.vz.toFixed(2), fire: fire === 'small' ? 2 : fire ? 1 : 0 });
    }
  };

  Mobs.addArrow = function (x, y, z, vx, vy, vz, fire) {
    const small = fire === 'small' || fire === 2;
    const mesh = new THREE.Mesh(
      small ? new THREE.BoxGeometry(0.3, 0.3, 0.3) : fire ? new THREE.BoxGeometry(0.6, 0.6, 0.6) : new THREE.BoxGeometry(0.08, 0.08, 0.7),
      new THREE.MeshBasicMaterial({ color: fire ? (small ? 0xffb030 : 0xff7a1a) : 0xbfae8e, fog: !fire })
    );
    mesh.position.set(x, y, z);
    this._group.add(mesh);
    const a = { mesh, x, y, z, vx, vy, vz, age: 0, fire: !!fire && !small, small };
    this.arrows.push(a);
    return a;
  };

  // a clear line from the mob's eyes to the player's
  Mobs.canSee = function (world, m, player) {
    const sx = m.x, sy = m.y + m.def.h * 0.6, sz = m.z;
    const ex = player.pos.x, ey = player.pos.y + 1.5, ez = player.pos.z;
    const d = Math.hypot(ex - sx, ey - sy, ez - sz);
    const n = Math.ceil(d * 2);
    for (let i = 2; i < n; i++) {
      const t = i / n;
      if (solidAt(world, sx + (ex - sx) * t, sy + (ey - sy) * t, sz + (ez - sz) * t)) return false;
    }
    return true;
  };

  Mobs.updateArrows = function (dt, world, targets, game) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.age += dt;
      if (!a.fire && !a.small) a.vy -= 9 * dt;
      a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;

      const hitBlock = solidAt(world, a.x, a.y, a.z);
      const r = a.fire ? 1.1 : 0.7;
      let hitPlayer = null;
      for (const t of targets) {
        if (t.dead) continue;
        const dx = a.x - t.pos.x, dy = a.y - (t.pos.y + 0.9), dz = a.z - t.pos.z;
        if (dx * dx + dy * dy + dz * dz < r * r) { hitPlayer = t; break; }
      }

      // a fireball bursts on whatever it touches
      if (a.fire && (hitBlock || hitPlayer)) {
        this.explode({ x: a.x, y: a.y - 0.5, z: a.z, def: { drops: [] }, size: 1 }, world, game.player, game, 1.6);
        this._group.remove(a.mesh);
        this.arrows.splice(i, 1);
        continue;
      }
      if (a.fire) a.mesh.rotation.x += dt * 4;

      if (hitPlayer) {
        const len = Math.hypot(a.vx, a.vz) || 1;
        if (a.small) game.mobFireHit(5, a.vx / len, a.vz / len, hitPlayer);
        else game.mobArrowHit(2, a.vx / len, a.vz / len, hitPlayer);
      }
      if (hitBlock || hitPlayer || a.age > 5) {
        this._group.remove(a.mesh);
        this.arrows.splice(i, 1);
        continue;
      }
      a.mesh.position.set(a.x, a.y, a.z);
      a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
    }
  };

  Mobs.updateArrowMeshes = function () {
    for (const a of this.arrows) a.mesh.position.set(a.x, a.y, a.z);
  };

  // An explosion, run by whoever set it off, which breaks the blocks; the
  // others get a 'blast' and replay it (visual) so each one takes their own
  // damage. Monsters are only hurt where they live: on the host.
  Mobs.explode = function (m, world, player, game, radius, visual) {
    const R = radius || 3;
    player = game.player || player;
    if (!visual && Net.active) Net.sendFx({ kind: 'blast', x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2), r: R });
    if (global.Sound) Sound.explode(Math.hypot(player.pos.x - m.x, player.pos.z - m.z));
    if (global.Entities) {
      Entities.burst(m.x, m.y + 1, m.z, B.SNOW, 24, 1.6);
      Entities.burst(m.x, m.y + 1, m.z, B.GRAVEL, 16, 1.4);
    }
    const cx = Math.floor(m.x), cy = Math.floor(m.y + 0.5), cz = Math.floor(m.z);
    const Ri = visual ? -1 : Math.ceil(R);
    for (let x = -Ri; x <= Ri; x++) {
      for (let y = -Ri; y <= Ri; y++) {
        for (let z = -Ri; z <= Ri; z++) {
          if (x * x + y * y + z * z > R * R) continue;
          const id = world.getBlock(cx + x, cy + y, cz + z);
          if (id === B.AIR || !isFinite(B.byId[id].hardness) || B.byId[id].hardness >= 50) continue;
          // TNT caught in a blast is set off on a short fuse
          if (id === B.TNT && game.primeTnt) { game.primeTnt(cx + x, cy + y, cz + z, 0.5 + Math.random()); continue; }
          game.changeBlock(cx + x, cy + y, cz + z, B.AIR);
        }
      }
    }
    const dx = player.pos.x - m.x, dy = player.pos.y - m.y, dz = player.pos.z - m.z;
    const dist = Math.hypot(dx, dy, dz);
    const reach = R * 2.3;
    if (dist < reach) {
      const dmg = Math.max(1, Math.round((1 - dist / reach) * 22 * R / 3));
      const len = Math.hypot(dx, dz) || 1;
      game.mobAttack(m, dmg, dx / len, dz / len, null, true);
    }
    // and anything else standing too close
    // (monsters live on the host, so only the host hurts them)
    for (const o of (Net.active && !Net.isHost) ? [] : this.list.slice()) {
      if (o === m || o.dead) continue;
      const ox = o.x - m.x, oy = o.y - m.y, oz = o.z - m.z;
      const od = Math.hypot(ox, oy, oz);
      if (od >= reach) continue;
      const ol = Math.hypot(ox, oz) || 1;
      if (game.damageMob) game.damageMob(o, Math.max(1, Math.round((1 - od / reach) * 22 * R / 3)), ox / ol, oz / ol, true);
    }
    if (!visual) this.dropLoot(m, game);
    this.remove(m);
  };

  Mobs.dropLoot = function (m, game) {
    if (game.mode !== 'survival' || m.size < 1) return;     // babies drop nothing
    const to = m.lastHitBy || null;
    for (const [id, min, max] of m.def.drops) {
      const n = min + Math.floor(Math.random() * (max - min + 1));
      if (n > 0) game.lootDrop(m.x, m.y + 0.4, m.z, id, n, null, to);
    }
    for (const [id, chance] of (m.def.rare || [])) {
      if (Math.random() < chance) game.lootDrop(m.x, m.y + 0.4, m.z, id, 1, null, to);
    }
  };

  // ---------------------------------------------------------- network state
  Mobs.snapshot = function () {
    const out = [];
    for (const m of this.list) {
      out.push([m.id, TYPE_NAMES.indexOf(m.type),
        +m.x.toFixed(2), +m.y.toFixed(2), +m.z.toFixed(2), +m.yaw.toFixed(2),
        m.size < 1 ? 1 : 0, m.love > 0 ? 1 : 0, m.def.boss ? Math.ceil(m.hp) : 0]);
    }
    return out;
  };

  Mobs.applyRemote = function (rows) {
    const seen = {};
    for (const r of rows) {
      const id = r[0];
      seen[id] = true;
      let m = this.byId(id);
      if (!m) {
        const type = TYPE_NAMES[r[1]];
        if (!type) continue;
        m = new Mob(type, r[2], r[3], r[4]);
        m.id = id;
        m.group = this.buildModel(m);
        m.group.position.set(r[2], r[3], r[4]);
        this._group.add(m.group);
        this.list.push(m);
      }
      m.x = r[2]; m.y = r[3]; m.z = r[4]; m.yaw = r[5];
      m.size = r[6] ? 0.5 : 1;
      if (m.def.boss) m.hp = r[8];
      m.group.scale.setScalar(m.size);
      if (r[7] && global.Entities && Math.random() < 0.08) Entities.hearts(m.x, m.y + m.def.h * m.size + 0.2, m.z, 1);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!seen[this.list[i].id]) this.remove(this.list[i]);
    }
  };

  global.Mobs = Mobs;
})(window);
