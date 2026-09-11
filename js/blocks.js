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
      climbable: false
    }, opts);
    return id;
  }

  function simple(id, name, tile, opts) {
    return def(id, name, Object.assign({ top: tile, side: tile, bottom: tile }, opts));
  }

  def(AIR, '공기', { opaque: false, solid: false, hardness: 0, drop: 0 });

  const STONE = simple(1, '돌', T.stone, { hardness: 1.5 });
  const GRASS = def(2, '잔디 블록', { top: T.grass_top, side: T.grass_side, bottom: T.dirt, hardness: 0.6 });
  const DIRT = simple(3, '흙', T.dirt, { hardness: 0.5 });
  const COBBLESTONE = simple(4, '조약돌', T.cobblestone, { hardness: 2.0 });
  const SAND = simple(5, '모래', T.sand, { hardness: 0.5 });
  const SANDSTONE = def(6, '사암', { top: T.sandstone_top, side: T.sandstone_side, bottom: T.sandstone_top, hardness: 0.8 });
  const GRAVEL = simple(7, '자갈', T.gravel, { hardness: 0.6 });
  const LOG = def(8, '참나무 원목', { top: T.log_top, side: T.log_side, bottom: T.log_top, hardness: 2.0 });
  const LEAVES = simple(9, '참나무 잎', T.leaves, { hardness: 0.2, opaque: false });
  const PLANKS = simple(10, '참나무 판자', T.planks, { hardness: 2.0 });
  const BEDROCK = simple(11, '기반암', T.bedrock, { hardness: Infinity });
  const COAL_ORE = simple(12, '석탄 광석', T.coal_ore, { hardness: 3.0 });
  const IRON_ORE = simple(13, '철 광석', T.iron_ore, { hardness: 3.0 });
  const GOLD_ORE = simple(14, '금 광석', T.gold_ore, { hardness: 3.0 });
  const DIAMOND_ORE = simple(15, '다이아몬드 광석', T.diamond_ore, { hardness: 3.0 });
  const WATER = simple(16, '물', T.water, { opaque: false, solid: false, liquid: true, hardness: Infinity, drop: 0 });
  const SNOW = simple(17, '눈 블록', T.snow, { hardness: 0.2 });
  const SNOW_GRASS = def(18, '눈 덮인 잔디', { top: T.snow, side: T.grass_side_snow, bottom: T.dirt, hardness: 0.6, drop: 3 });
  const CACTUS = def(19, '선인장', { top: T.cactus_top, side: T.cactus_side, bottom: T.cactus_top, hardness: 0.4, opaque: false });
  const GLASS = simple(20, '유리', T.glass, { hardness: 0.3, opaque: false, drop: 0 });

  byId[STONE].drop = COBBLESTONE;
  byId[GRASS].drop = DIRT;
  byId[LEAVES].drop = 0;

  const FACE_TILE = ['side', 'side', 'top', 'bottom', 'side', 'side'];

  function tileFor(id, face) {
    return byId[id][FACE_TILE[face]];
  }

  function isOpaque(id) { return byId[id].opaque; }
  function isSolid(id) { return byId[id].solid; }
  function isLiquid(id) { return byId[id].liquid; }

  function breakSeconds(id) {
    const h = byId[id].hardness;
    if (!isFinite(h)) return Infinity;
    return h * 1.5;
  }

  function iconFor(id) {
    return Textures.iconURL(byId[id].side);
  }

  const creativeList = [
    GRASS, DIRT, STONE, COBBLESTONE, SAND, SANDSTONE, GRAVEL,
    LOG, LEAVES, PLANKS, GLASS, SNOW, SNOW_GRASS, CACTUS,
    COAL_ORE, IRON_ORE, GOLD_ORE, DIAMOND_ORE, BEDROCK
  ];

  global.Blocks = {
    AIR, STONE, GRASS, DIRT, COBBLESTONE, SAND, SANDSTONE, GRAVEL,
    LOG, LEAVES, PLANKS, BEDROCK, COAL_ORE, IRON_ORE, GOLD_ORE,
    DIAMOND_ORE, WATER, SNOW, SNOW_GRASS, CACTUS, GLASS,
    byId, tileFor, isOpaque, isSolid, isLiquid, breakSeconds, iconFor, creativeList
  };
})(window);
