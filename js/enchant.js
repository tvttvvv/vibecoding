(function (global) {
  'use strict';

  // Enchantments live on the item stack as { key: level }. The table offers
  // three at once, strongest last; bookshelves around it raise the levels,
  // as in Minecraft (up to 30 with fifteen shelves).
  const ENCH = {
    eff: { name: '효율', max: 5, for: (d) => d.tool && d.tool.type !== 'sword' },
    sharp: { name: '날카로움', max: 5, for: (d) => d.tool && (d.tool.type === 'sword' || d.tool.type === 'axe') },
    unb: { name: '내구성', max: 3, for: (d) => !!d.durability },
    prot: { name: '보호', max: 4, for: (d) => !!d.armor },
    power: { name: '힘', max: 5, for: (d) => !!d.bow }
  };
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  const Enchant = { ENCH };

  Enchant.canEnchant = function (stack) {
    if (!stack || stack.ench) return false;
    const d = Items.get(stack.id);
    if (!d) return false;
    return Object.keys(ENCH).some((k) => ENCH[k].for(d));
  };

  Enchant.level = function (stack, key) {
    return stack && stack.ench && stack.ench[key] ? stack.ench[key] : 0;
  };

  Enchant.label = function (stack) {
    if (!stack || !stack.ench) return '';
    return Object.keys(stack.ench).map((k) => ENCH[k].name + ' ' + ROMAN[stack.ench[k]]).join(', ');
  };

  // the three offers for this item, fixed until the player enchants something
  Enchant.offers = function (stack, shelves, seed) {
    if (!Enchant.canEnchant(stack)) return [];
    const d = Items.get(stack.id);
    const r = rng(seed ^ Math.imul(stack.id, 2654435761));
    const n = Math.min(15, shelves);
    const base = 1 + Math.floor(r() * 8) + Math.floor(n / 2) + Math.floor(r() * (n + 1));
    const levels = [Math.max(1, Math.floor(base / 3)), Math.floor(base * 2 / 3) + 1, Math.max(base, n * 2)];
    const keys = Object.keys(ENCH).filter((k) => ENCH[k].for(d));
    return levels.map((lv, i) => {
      const ench = {};
      const first = keys[Math.floor(r() * keys.length)];
      ench[first] = Math.max(1, Math.min(ENCH[first].max, Math.ceil(lv / 30 * ENCH[first].max * 1.25)));
      // strong offers sometimes carry a second enchantment
      if (keys.length > 1 && lv >= 15 && r() < 0.4) {
        const others = keys.filter((k) => k !== first);
        const second = others[Math.floor(r() * others.length)];
        ench[second] = Math.max(1, Math.min(ENCH[second].max, Math.ceil(lv / 30 * ENCH[second].max)));
      }
      return { level: lv, lapis: i + 1, cost: i + 1, ench };
    });
  };

  Enchant.describe = function (ench) {
    return Object.keys(ench).map((k) => ENCH[k].name + ' ' + ROMAN[ench[k]]).join(', ');
  };

  // Unbreaking: each use only wears the item one time in (level + 1)
  Enchant.wears = function (stack) {
    const l = Enchant.level(stack, 'unb');
    return l === 0 || Math.random() < 1 / (l + 1);
  };

  global.Enchant = Enchant;
})(window);
