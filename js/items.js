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
      if (id === Blocks.PLANKS || id === Blocks.LOG || id === Blocks.CRAFTING_TABLE) return 15;
      return 0;
    }
    return byId[id].fuel || 0;
  }

  const creativeItems = [
    STICK, COAL, IRON_INGOT, GOLD_INGOT, DIAMOND,
    tools.wood_pickaxe, tools.wood_axe, tools.wood_shovel, tools.wood_sword, tools.wood_hoe,
    tools.stone_pickaxe, tools.stone_axe, tools.stone_shovel, tools.stone_sword, tools.stone_hoe,
    tools.iron_pickaxe, tools.iron_axe, tools.iron_shovel, tools.iron_sword, tools.iron_hoe,
    tools.gold_pickaxe, tools.gold_axe, tools.gold_shovel, tools.gold_sword, tools.gold_hoe,
    tools.diamond_pickaxe, tools.diamond_axe, tools.diamond_shovel, tools.diamond_sword, tools.diamond_hoe,
    armor.iron_helmet, armor.iron_chestplate, armor.iron_leggings, armor.iron_boots,
    armor.gold_helmet, armor.gold_chestplate, armor.gold_leggings, armor.gold_boots,
    armor.diamond_helmet, armor.diamond_chestplate, armor.diamond_leggings, armor.diamond_boots
  ];

  global.Items = {
    ITEM_BASE, byId, tools, armor,
    STICK, COAL, IRON_INGOT, GOLD_INGOT, DIAMOND,
    PIECE_ORDER, creativeItems,
    isBlock, get, name, tileOf, icon, stackMax, maxDurability, fuelSeconds
  };
})(window);
