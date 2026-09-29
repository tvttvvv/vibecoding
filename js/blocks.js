(function (global) {
  'use strict';

  const T = Textures.TILES;

  const AIR = 0;
  const byId = [];

  function def(id, name, opts) {
    byId[id] = Object.assign({
      id,
      name,
      top: 0, side: 0, bottom: 0,
      opaque: true,
      solid: true,
      liquid: false,
      hardness: 1,
      drop: id,
      tool: null,
      tier: 0,
      interactive: null,
      // 'cross' hangs the tile on two crossed quads (torches); height shortens
      // the block (beds), and light keeps monsters from spawning nearby
      render: 'cube',
      height: 1,
      light: 0
    }, opts);
    return id;
  }

  function simple(id, name, tile, opts) {
    return def(id, name, Object.assign({ top: tile, side: tile, bottom: tile }, opts));
  }

  def(AIR, '공기', { opaque: false, solid: false, hardness: 0, drop: 0 });

  const STONE = simple(1, '돌', T.stone, { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  const GRASS = def(2, '잔디 블록', { top: T.grass_top, side: T.grass_side, bottom: T.dirt, hardness: 0.6, tool: 'shovel' });
  const DIRT = simple(3, '흙', T.dirt, { hardness: 0.5, tool: 'shovel' });
  const COBBLESTONE = simple(4, '조약돌', T.cobblestone, { hardness: 2.0, tool: 'pickaxe', tier: 1 });
  const SAND = simple(5, '모래', T.sand, { hardness: 0.5, tool: 'shovel' });
  const SANDSTONE = def(6, '사암', { top: T.sandstone_top, side: T.sandstone_side, bottom: T.sandstone_top, hardness: 0.8, tool: 'pickaxe', tier: 1 });
  const GRAVEL = simple(7, '자갈', T.gravel, { hardness: 0.6, tool: 'shovel' });
  const LOG = def(8, '참나무 원목', { top: T.log_top, side: T.log_side, bottom: T.log_top, hardness: 2.0, tool: 'axe' });
  const LEAVES = simple(9, '참나무 잎', T.leaves, { hardness: 0.2, opaque: false });
  const PLANKS = simple(10, '참나무 판자', T.planks, { hardness: 2.0, tool: 'axe' });
  const BEDROCK = simple(11, '기반암', T.bedrock, { hardness: Infinity });
  const COAL_ORE = simple(12, '석탄 광석', T.coal_ore, { hardness: 3.0, tool: 'pickaxe', tier: 1 });
  const IRON_ORE = simple(13, '철 광석', T.iron_ore, { hardness: 3.0, tool: 'pickaxe', tier: 2 });
  const GOLD_ORE = simple(14, '금 광석', T.gold_ore, { hardness: 3.0, tool: 'pickaxe', tier: 3 });
  const DIAMOND_ORE = simple(15, '다이아몬드 광석', T.diamond_ore, { hardness: 3.0, tool: 'pickaxe', tier: 3 });
  const WATER = simple(16, '물', T.water, { opaque: false, solid: false, liquid: true, hardness: Infinity, drop: 0 });
  const SNOW = simple(17, '눈 블록', T.snow, { hardness: 0.2, tool: 'shovel' });
  const SNOW_GRASS = def(18, '눈 덮인 잔디', { top: T.snow, side: T.grass_side_snow, bottom: T.dirt, hardness: 0.6, tool: 'shovel', drop: 3 });
  const CACTUS = def(19, '선인장', { top: T.cactus_top, side: T.cactus_side, bottom: T.cactus_top, hardness: 0.4, opaque: false });
  const GLASS = simple(20, '유리', T.glass, { hardness: 0.3, opaque: false, drop: 0 });
  const CRAFTING_TABLE = def(21, '제작대', {
    top: T.crafting_table_top, side: T.crafting_table_front, bottom: T.planks,
    hardness: 2.5, tool: 'axe', interactive: 'craft'
  });
  const FURNACE = def(22, '화로', {
    top: T.furnace_top, side: T.furnace_front, bottom: T.furnace_top,
    hardness: 3.5, tool: 'pickaxe', tier: 1, interactive: 'furnace'
  });

  const FURNACE_LIT = def(23, '화로', {
    top: T.furnace_top, side: T.furnace_front_lit, bottom: T.furnace_top,
    hardness: 3.5, tool: 'pickaxe', tier: 1, interactive: 'furnace', drop: FURNACE
  });

  const TORCH = simple(24, '횃불', T.torch, {
    opaque: false, solid: false, hardness: 0, render: 'cross', light: 14
  });
  const WOOL = simple(25, '양털', T.wool, { hardness: 0.8 });
  const BED = def(26, '침대', {
    top: T.bed_top, side: T.bed_side, bottom: T.planks,
    opaque: false, hardness: 0.2, height: 0.5625, interactive: 'bed'
  });

  // ---- plants: crossed quads that sit on the ground and pop off without it
  const PLANT = { opaque: false, solid: false, hardness: 0, render: 'cross', needsGround: true, replaceable: true };
  const TALL_GRASS = simple(27, '잔디', T.tall_grass, Object.assign({}, PLANT, { drop: 0 }));
  const DANDELION = simple(28, '민들레', T.dandelion, Object.assign({}, PLANT, { replaceable: false }));
  const POPPY = simple(29, '양귀비', T.poppy, Object.assign({}, PLANT, { replaceable: false }));
  const FARMLAND = def(30, '경작지', {
    top: T.farmland_top, side: T.dirt, bottom: T.dirt,
    opaque: false, height: 0.9375, hardness: 0.6, tool: 'shovel', drop: DIRT
  });
  const WHEAT_0 = simple(31, '밀', T.wheat_0, Object.assign({}, PLANT, { replaceable: false, crop: 0, drop: 0 }));
  const WHEAT_1 = simple(32, '밀', T.wheat_1, Object.assign({}, PLANT, { replaceable: false, crop: 1, drop: 0 }));
  const WHEAT_2 = simple(33, '밀', T.wheat_2, Object.assign({}, PLANT, { replaceable: false, crop: 2, drop: 0 }));
  const WHEAT_3 = simple(34, '밀', T.wheat_3, Object.assign({}, PLANT, { replaceable: false, crop: 3, drop: 0 }));
  const CHEST = def(35, '상자', {
    top: T.chest_top, side: T.chest_side, bottom: T.chest_top,
    opaque: false, height: 0.875, hardness: 2.5, tool: 'axe', interactive: 'chest'
  });
  // torches need something to stand on too
  byId[TORCH].needsGround = true;

  // ---- shaped blocks --------------------------------------------------------
  // Not every block is a cube. These carry a list of boxes (0..1 inside the
  // cell) that the mesher draws and that the player collides with. Each state
  // (facing, open, top/bottom) is its own id, since blocks carry no metadata.
  // Facing: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x).
  const T3 = 3 / 16;
  function shaped(id, name, tiles, boxes, opts) {
    def(id, name, Object.assign({
      top: tiles.top, side: tiles.side, bottom: tiles.bottom || tiles.top,
      opaque: false, render: 'boxes', boxes
    }, opts));
    return id;
  }

  const SLAB_FAMILIES = [
    { name: '참나무 반블록', tile: T.planks, full: PLANKS, hardness: 2, tool: 'axe', tier: 0 },
    { name: '조약돌 반블록', tile: T.cobblestone, full: COBBLESTONE, hardness: 2, tool: 'pickaxe', tier: 1 },
    { name: '돌 반블록', tile: T.stone, full: STONE, hardness: 2, tool: 'pickaxe', tier: 1 }
  ];
  const SLABS = [];
  SLAB_FAMILIES.forEach((f, i) => {
    const bottom = 36 + i, top = 39 + i;
    const base = { hardness: f.hardness, tool: f.tool, tier: f.tier, drop: bottom };
    shaped(bottom, f.name, { top: f.tile, side: f.tile }, [[0, 0, 0, 1, 0.5, 1]], Object.assign({ slab: 'bottom', family: bottom, full: f.full }, base));
    shaped(top, f.name, { top: f.tile, side: f.tile }, [[0, 0.5, 0, 1, 1, 1]], Object.assign({ slab: 'top', family: bottom, full: f.full }, base));
    SLABS.push(bottom);
  });

  function stairBoxes(f) {
    const back = [[0, 0.5, 0, 1, 1, 0.5], [0.5, 0.5, 0, 1, 1, 1], [0, 0.5, 0.5, 1, 1, 1], [0, 0.5, 0, 0.5, 1, 1]][f];
    return [[0, 0, 0, 1, 0.5, 1], back];
  }
  const STAIR_FAMILIES = [
    { name: '참나무 계단', tile: T.planks, hardness: 2, tool: 'axe', tier: 0 },
    { name: '조약돌 계단', tile: T.cobblestone, hardness: 2, tool: 'pickaxe', tier: 1 }
  ];
  const STAIRS = [];
  STAIR_FAMILIES.forEach((fam, i) => {
    const first = 42 + i * 4;
    for (let f = 0; f < 4; f++) {
      shaped(first + f, fam.name, { top: fam.tile, side: fam.tile }, stairBoxes(f),
        { hardness: fam.hardness, tool: fam.tool, tier: fam.tier, stairs: f, family: first, drop: first });
    }
    STAIRS.push(first);
  });

  // doors: the closed panel sits on the side nearest whoever placed it, and
  // opening swings it a quarter turn
  function panel(f) {
    return [[0, 0, 1 - T3, 1, 1, 1], [0, 0, 0, T3, 1, 1], [0, 0, 0, 1, 1, T3], [1 - T3, 0, 0, 1, 1, 1]][f];
  }
  const DOOR = 50;
  for (let half = 0; half < 2; half++) {
    for (let f = 0; f < 4; f++) {
      for (let open = 0; open < 2; open++) {
        const id = DOOR + half * 8 + f * 2 + open;
        const box = panel(open ? (f + 1) % 4 : f);
        const tile = half ? T.door_upper : T.door_lower;
        shaped(id, '참나무 문', { top: T.planks, side: tile }, [box], {
          hardness: 3, tool: 'axe', door: { facing: f, open: !!open, upper: !!half },
          interactive: 'door', drop: 0, needsGround: true
        });
      }
    }
  }

  // ladders hang on the wall at their back; you walk through them and climb
  function ladderBox(f) {
    const t = 1 / 16;
    return [[0, 0, 0, 1, 1, t], [1 - t, 0, 0, 1, 1, 1], [0, 0, 1 - t, 1, 1, 1], [0, 0, 0, t, 1, 1]][f];
  }
  const LADDER = 66;
  for (let f = 0; f < 4; f++) {
    shaped(LADDER + f, '사다리', { top: T.ladder, side: T.ladder }, [ladderBox(f)], {
      solid: false, hardness: 0.4, tool: 'axe', climbable: true, ladder: f, family: LADDER, drop: LADDER,
      needsGround: true
    });
  }

  // ---- fluids: a source and its flowing levels ------------------------------
  // Level 1 is next to the source, 7 the thin edge; 8 is water falling straight
  // down. Lava runs shorter: levels 2, 4 and 6 stand in for its steps.
  byId[WATER].fluid = 'water';
  byId[WATER].level = 0;
  const WATER_FLOW = 70;           // 70..76 levels 1-7, 77 falling
  for (let l = 1; l <= 8; l++) {
    simple(WATER_FLOW + l - 1, '물', T.water, {
      opaque: false, solid: false, liquid: true, hardness: Infinity, drop: 0,
      fluid: 'water', level: l, replaceable: true
    });
  }
  byId[WATER].replaceable = true;
  const LAVA = 78;                 // source; 79..81 flowing, 82 falling
  simple(LAVA, '용암', T.lava, {
    opaque: false, solid: false, liquid: true, hardness: Infinity, drop: 0,
    fluid: 'lava', level: 0, light: 15, replaceable: true
  });
  [2, 4, 6, 8].forEach((l, i) => {
    simple(LAVA + 1 + i, '용암', T.lava, {
      opaque: false, solid: false, liquid: true, hardness: Infinity, drop: 0,
      fluid: 'lava', level: l, light: 15, replaceable: true
    });
  });
  const OBSIDIAN = simple(83, '흑요석', T.obsidian, { hardness: 50, tool: 'pickaxe', tier: 4 });

  byId[STONE].drop = COBBLESTONE;
  byId[GRASS].drop = DIRT;
  byId[LEAVES].drop = 0;
  // ores you mine straight into the item, like Minecraft
  byId[COAL_ORE].drop = 101;
  byId[DIAMOND_ORE].drop = 104;

  const FACE_TILE = ['side', 'side', 'top', 'bottom', 'side', 'side'];

  function tileFor(id, face) {
    return byId[id][FACE_TILE[face]];
  }

  function isOpaque(id) { return byId[id].opaque; }
  function isSolid(id) { return byId[id].solid; }
  function isLiquid(id) { return byId[id].liquid; }

  // Minecraft's formula: hardness x 1.5 when the block will drop, x 5 when it
  // will not, divided by the speed of a matching tool.
  function mineTime(blockId, tool) {
    const b = byId[blockId];
    if (!isFinite(b.hardness)) return Infinity;
    const harvest = canHarvest(blockId, tool);
    let speed = 1;
    if (tool && tool.tool && b.tool && tool.tool.type === b.tool) speed = tool.tool.speed;
    return b.hardness * (harvest ? 1.5 : 5) / speed;
  }

  function canHarvest(blockId, tool) {
    const b = byId[blockId];
    if (b.tier === 0) return true;
    if (!tool || !tool.tool) return false;
    if (tool.tool.type !== b.tool) return false;
    return tool.tool.tier >= b.tier;
  }

  function iconFor(id) {
    return Textures.iconURL(byId[id].side, !byId[id].opaque);
  }

  const creativeList = [
    GRASS, DIRT, STONE, COBBLESTONE, SAND, SANDSTONE, GRAVEL,
    LOG, LEAVES, PLANKS, GLASS, SNOW, SNOW_GRASS, CACTUS,
    COAL_ORE, IRON_ORE, GOLD_ORE, DIAMOND_ORE,
    CRAFTING_TABLE, FURNACE, CHEST, TORCH, WOOL, BED, FARMLAND,
    TALL_GRASS, DANDELION, POPPY,
    SLABS[0], SLABS[1], SLABS[2], STAIRS[0], STAIRS[1], LADDER, OBSIDIAN, BEDROCK
  ];

  global.Blocks = {
    AIR, STONE, GRASS, DIRT, COBBLESTONE, SAND, SANDSTONE, GRAVEL,
    LOG, LEAVES, PLANKS, BEDROCK, COAL_ORE, IRON_ORE, GOLD_ORE,
    DIAMOND_ORE, WATER, SNOW, SNOW_GRASS, CACTUS, GLASS,
    CRAFTING_TABLE, FURNACE, FURNACE_LIT, TORCH, WOOL, BED,
    TALL_GRASS, DANDELION, POPPY, FARMLAND, WHEAT_0, WHEAT_1, WHEAT_2, WHEAT_3, CHEST,
    SLABS, STAIRS, DOOR, LADDER, WATER_FLOW, LAVA, OBSIDIAN,
    byId, tileFor, isOpaque, isSolid, isLiquid, mineTime, canHarvest, iconFor, creativeList
  };
})(window);
