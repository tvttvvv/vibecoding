(function (global) {
  'use strict';

  const T = Textures.TILES;
  const ITEM_BASE = 100;
  const byId = {};

  function def(id, name, tile, opts) {
    byId[id] = Object.assign({ id, name, tile, stackMax: 64 }, opts || {});
    return id;
  }

  const STICK = def(100, '막대기', T.item_stick, { fuel: 5 });
  const COAL = def(101, '석탄', T.item_coal, { fuel: 80 });
  const IRON_INGOT = def(102, '철괴', T.item_iron_ingot);
  const GOLD_INGOT = def(103, '금괴', T.item_gold_ingot);
  const DIAMOND = def(104, '다이아몬드', T.item_diamond);

  const TIERS = {
    wood: { label: '나무', tier: 1, speed: 2, durability: 59, damage: 4 },
    stone: { label: '돌', tier: 2, speed: 4, durability: 131, damage: 5 },
    iron: { label: '철', tier: 3, speed: 6, durability: 250, damage: 6 },
    gold: { label: '금', tier: 1, speed: 12, durability: 32, damage: 4 },
    diamond: { label: '다이아몬드', tier: 4, speed: 8, durability: 1561, damage: 7 }
  };
  const KINDS = {
    pickaxe: { label: '곡괭이', damageBonus: -1 },
    axe: { label: '도끼', damageBonus: 1 },
    shovel: { label: '삽', damageBonus: -2 },
    sword: { label: '검', damageBonus: 0 },
    hoe: { label: '괭이', damageBonus: -3 }
  };

  const TOOL_ORDER = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
  const TIER_ORDER = ['wood', 'stone', 'iron', 'gold', 'diamond'];
  const tools = {};
  let nextId = 110;
  for (const tierName of TIER_ORDER) {
    const tier = TIERS[tierName];
    for (const kindName of TOOL_ORDER) {
      const kind = KINDS[kindName];
      const id = nextId++;
      def(id, tier.label + ' ' + kind.label, T['item_' + tierName + '_' + kindName], {
        stackMax: 1,
        durability: tier.durability,
        tool: { type: kindName, tier: tier.tier, speed: tier.speed, material: tierName },
        damage: Math.max(1, tier.damage + kind.damageBonus)
      });
      tools[tierName + '_' + kindName] = id;
    }
  }

  const ARMOR_STATS = {
    iron: { label: '철', points: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 }, durability: { helmet: 165, chestplate: 240, leggings: 225, boots: 195 } },
    gold: { label: '금', points: { helmet: 2, chestplate: 5, leggings: 3, boots: 1 }, durability: { helmet: 77, chestplate: 112, leggings: 105, boots: 91 } },
    diamond: { label: '다이아몬드', points: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 }, durability: { helmet: 363, chestplate: 528, leggings: 495, boots: 429 } }
  };
  const PIECE_LABEL = { helmet: '투구', chestplate: '흉갑', leggings: '레깅스', boots: '부츠' };
  const PIECE_ORDER = ['helmet', 'chestplate', 'leggings', 'boots'];
  const armor = {};
  nextId = 140;
  for (const tierName of ['iron', 'gold', 'diamond']) {
    const stats = ARMOR_STATS[tierName];
    for (const piece of PIECE_ORDER) {
      const id = nextId++;
      def(id, stats.label + ' ' + PIECE_LABEL[piece], T['item_' + tierName + '_' + piece], {
        stackMax: 1,
        durability: stats.durability[piece],
        armor: { slot: piece, points: stats.points[piece], material: tierName }
      });
      armor[tierName + '_' + piece] = id;
    }
  }

  // ---- food and mob drops ---------------------------------------------------
  // food restores hunger, saturation decides how long it holds
  const APPLE = def(160, '사과', T.item_apple, { food: 4, saturation: 2.4 });
  const RAW_BEEF = def(161, '생 소고기', T.item_raw_beef, { food: 3, saturation: 1.8 });
  const COOKED_BEEF = def(162, '스테이크', T.item_cooked_beef, { food: 8, saturation: 12.8 });
  const RAW_PORK = def(163, '생 돼지고기', T.item_raw_pork, { food: 3, saturation: 1.8 });
  const COOKED_PORK = def(164, '익힌 돼지고기', T.item_cooked_pork, { food: 8, saturation: 12.8 });
  const RAW_CHICKEN = def(165, '생 닭고기', T.item_raw_chicken, { food: 2, saturation: 1.2 });
  const COOKED_CHICKEN = def(166, '익힌 닭고기', T.item_cooked_chicken, { food: 6, saturation: 7.2 });
  const RAW_MUTTON = def(167, '생 양고기', T.item_raw_mutton, { food: 2, saturation: 1.2 });
  const COOKED_MUTTON = def(168, '익힌 양고기', T.item_cooked_mutton, { food: 6, saturation: 9.6 });
  const ROTTEN_FLESH = def(169, '썩은 살점', T.item_rotten_flesh, { food: 4, saturation: 0.8 });
  const BONE = def(170, '뼈', T.item_bone);
  const STRING = def(171, '실', T.item_string);
  const GUNPOWDER = def(172, '화약', T.item_gunpowder);
  const SEEDS = def(173, '밀 씨앗', T.item_seeds);
  const WHEAT = def(174, '밀', T.item_wheat);
  const BREAD = def(175, '빵', T.item_bread, { food: 5, saturation: 6 });
  const BOAT = def(176, '보트', T.item_boat, { stackMax: 1 });
  const OAK_DOOR = def(177, '참나무 문', T.item_oak_door, { place: 'door' });
  const BUCKET = def(178, '양동이', T.item_bucket, { stackMax: 16 });
  const WATER_BUCKET = def(179, '물 양동이', T.item_water_bucket, { stackMax: 1 });
  const LAVA_BUCKET = def(180, '용암 양동이', T.item_lava_bucket, { stackMax: 1, fuel: 1000 });
  const BOW = def(181, '활', T.item_bow, { stackMax: 1, durability: 384, bow: true, fuel: 15 });
  const ARROW = def(182, '화살', T.item_arrow);
  const FLINT = def(183, '부싯돌', T.item_flint);
  const FEATHER = def(184, '깃털', T.item_feather);
  const LEATHER = def(185, '가죽', T.item_leather);
  const CARROT = def(186, '당근', T.item_carrot, { food: 3, saturation: 3.6, plant: 'carrot' });
  const LAPIS = def(187, '청금석', T.item_lapis);
  const PAPER = def(188, '종이', T.item_paper);
  const BOOK = def(189, '책', T.item_book);
  const EMERALD = def(190, '에메랄드', T.item_emerald);

  // ---- unified block/item access -------------------------------------------
  function isBlock(id) { return id < ITEM_BASE; }

  function get(id) {
    return isBlock(id) ? Blocks.byId[id] : byId[id];
  }

  function name(id) {
    const d = get(id);
    return d ? d.name : '?';
  }

  function tileOf(id) {
    return isBlock(id) ? Blocks.byId[id].side : byId[id].tile;
  }

  function icon(id) {
    if (isBlock(id)) return Blocks.iconFor(id);
    return Textures.iconURL(byId[id].tile, false);
  }

  function stackMax(id) {
    const d = get(id);
    return d && d.stackMax ? d.stackMax : 64;
  }

  function maxDurability(id) {
    const d = get(id);
    return d && d.durability ? d.durability : 0;
  }

  function fuelSeconds(id) {
    if (isBlock(id)) {
      if (id === Blocks.PLANKS || id === Blocks.LOG || id === Blocks.CRAFTING_TABLE ||
          id === Blocks.CHEST) return 15;
      return 0;
    }
    return byId[id].fuel || 0;
  }

  const creativeItems = [
    STICK, COAL, IRON_INGOT, GOLD_INGOT, DIAMOND,
    APPLE, BREAD, COOKED_BEEF, COOKED_PORK, COOKED_CHICKEN, COOKED_MUTTON, BONE, STRING, GUNPOWDER,
    SEEDS, WHEAT, BOAT, OAK_DOOR, BUCKET, WATER_BUCKET, LAVA_BUCKET,
    BOW, ARROW, FLINT, FEATHER, LEATHER, CARROT, LAPIS, PAPER, BOOK, EMERALD,
    tools.wood_pickaxe, tools.wood_axe, tools.wood_shovel, tools.wood_sword, tools.wood_hoe,
    tools.stone_pickaxe, tools.stone_axe, tools.stone_shovel, tools.stone_sword, tools.stone_hoe,
    tools.iron_pickaxe, tools.iron_axe, tools.iron_shovel, tools.iron_sword, tools.iron_hoe,
    tools.gold_pickaxe, tools.gold_axe, tools.gold_shovel, tools.gold_sword, tools.gold_hoe,
    tools.diamond_pickaxe, tools.diamond_axe, tools.diamond_shovel, tools.diamond_sword, tools.diamond_hoe,
    armor.iron_helmet, armor.iron_chestplate, armor.iron_leggings, armor.iron_boots,
    armor.gold_helmet, armor.gold_chestplate, armor.gold_leggings, armor.gold_boots,
    armor.diamond_helmet, armor.diamond_chestplate, armor.diamond_leggings, armor.diamond_boots
  ];

  function foodOf(id) {
    const d = get(id);
    return d && d.food ? d : null;
  }

  global.Items = {
    ITEM_BASE, byId, tools, armor,
    STICK, COAL, IRON_INGOT, GOLD_INGOT, DIAMOND,
    APPLE, RAW_BEEF, COOKED_BEEF, RAW_PORK, COOKED_PORK,
    RAW_CHICKEN, COOKED_CHICKEN, RAW_MUTTON, COOKED_MUTTON,
    ROTTEN_FLESH, BONE, STRING, GUNPOWDER, SEEDS, WHEAT, BREAD, BOAT,
    OAK_DOOR, BUCKET, WATER_BUCKET, LAVA_BUCKET, BOW, ARROW, FLINT, FEATHER, LEATHER, CARROT,
    LAPIS, PAPER, BOOK, EMERALD,
    PIECE_ORDER, creativeItems,
    isBlock, get, name, tileOf, icon, stackMax, maxDurability, fuelSeconds, foodOf
  };
})(window);
