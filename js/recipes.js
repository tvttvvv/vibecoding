(function (global) {
  'use strict';

  const B = Blocks;
  const I = Items;
  const list = [];

  function shaped(out, count, pattern, key) {
    list.push(build({ out, count, pattern, key }));
  }

  function shapeless(out, count, ingredients) {
    list.push(build({ out, count, ingredients }));
  }

  function trim(cells, w, h) {
    let minX = w, maxX = -1, minY = h, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!cells[y * w + x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return { cells: [], w: 0, h: 0 };
    const nw = maxX - minX + 1, nh = maxY - minY + 1;
    const out = [];
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) out.push(cells[(y + minY) * w + (x + minX)]);
    }
    return { cells: out, w: nw, h: nh };
  }

  function build(r) {
    const need = {};
    if (r.pattern) {
      const h = r.pattern.length;
      const w = Math.max.apply(null, r.pattern.map((s) => s.length));
      const raw = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ch = r.pattern[y][x] || ' ';
          raw.push(ch === ' ' ? 0 : r.key[ch]);
        }
      }
      const t = trim(raw, w, h);
      r.cells = t.cells;
      r.w = t.w;
      r.h = t.h;
      for (const id of t.cells) if (id) need[id] = (need[id] || 0) + 1;
    } else {
      r.w = r.ingredients.length > 2 ? 2 : 1;
      r.h = 1;
      for (const id of r.ingredients) need[id] = (need[id] || 0) + 1;
    }
    r.need = need;
    return r;
  }

  const PLANK_LIKE = [
    ['#', B.PLANKS, 'wood'],
    ['#', B.COBBLESTONE, 'stone'],
    ['#', I.IRON_INGOT, 'iron'],
    ['#', I.GOLD_INGOT, 'gold'],
    ['#', I.DIAMOND, 'diamond']
  ];

  shapeless(B.PLANKS, 4, [B.LOG]);
  shaped(I.STICK, 4, ['#', '#'], { '#': B.PLANKS });
  shaped(B.CRAFTING_TABLE, 1, ['##', '##'], { '#': B.PLANKS });
  shaped(B.FURNACE, 1, ['###', '# #', '###'], { '#': B.COBBLESTONE });
  shaped(B.TORCH, 4, ['#', '|'], { '#': I.COAL, '|': I.STICK });
  shaped(B.WOOL, 1, ['##', '##'], { '#': I.STRING });
  shaped(B.BED, 1, ['WWW', 'PPP'], { W: B.WOOL, P: B.PLANKS });
  shaped(B.CHEST, 1, ['###', '# #', '###'], { '#': B.PLANKS });
  shaped(I.BREAD, 1, ['###'], { '#': I.WHEAT });
  shaped(I.BOAT, 1, ['# #', '###'], { '#': B.PLANKS });
  // building
  shaped(B.SLABS[0], 6, ['###'], { '#': B.PLANKS });
  shaped(B.SLABS[1], 6, ['###'], { '#': B.COBBLESTONE });
  shaped(B.SLABS[2], 6, ['###'], { '#': B.STONE });
  shaped(B.STAIRS[0], 4, ['#  ', '## ', '###'], { '#': B.PLANKS });
  shaped(B.STAIRS[1], 4, ['#  ', '## ', '###'], { '#': B.COBBLESTONE });
  shaped(I.OAK_DOOR, 3, ['##', '##', '##'], { '#': B.PLANKS });
  shaped(B.LADDER, 3, ['| |', '|||', '| |'], { '|': I.STICK });
  shaped(I.BUCKET, 1, ['# #', ' # '], { '#': I.IRON_INGOT });
  shaped(I.BOW, 1, [' #|', '# |', ' #|'], { '#': I.STICK, '|': I.STRING });
  shaped(I.ARROW, 4, ['F', '|', 'E'], { F: I.FLINT, '|': I.STICK, E: I.FEATHER });
  shaped(I.PAPER, 3, ['###'], { '#': B.SUGAR_CANE });
  shapeless(I.FLINT_AND_STEEL, 1, [I.IRON_INGOT, I.FLINT]);
  shapeless(I.BOOK, 1, [I.PAPER, I.PAPER, I.PAPER, I.LEATHER]);
  shaped(B.BOOKSHELF, 1, ['###', 'BBB', '###'], { '#': B.PLANKS, B: I.BOOK });
  // redstone
  shaped(B.RS_TORCH, 1, ['R', '|'], { R: I.REDSTONE, '|': I.STICK });
  shaped(B.LEVER, 1, ['|', '#'], { '|': I.STICK, '#': B.COBBLESTONE });
  shapeless(B.BUTTON, 1, [B.STONE]);
  shaped(B.PLATE, 1, ['##'], { '#': B.STONE });
  shaped(B.LAMP, 1, [' R ', 'RGR', ' R '], { R: I.REDSTONE, G: B.GLOWSTONE });
  shaped(B.REDSTONE_BLOCK, 1, ['RRR', 'RRR', 'RRR'], { R: I.REDSTONE });
  shapeless(I.REDSTONE, 9, [B.REDSTONE_BLOCK]);
  shaped(B.TNT, 1, ['GSG', 'SGS', 'GSG'], { G: I.GUNPOWDER, S: B.SAND });
  shaped(B.PISTON, 1, ['PPP', 'CIC', 'CRC'], { P: B.PLANKS, C: B.COBBLESTONE, I: I.IRON_INGOT, R: I.REDSTONE });
  shapeless(B.STICKY_PISTON, 1, [I.SLIME_BALL, B.PISTON]);
  shaped(B.REPEATER, 1, ['TRT', 'SSS'], { T: B.RS_TORCH, R: I.REDSTONE, S: B.STONE });
  shaped(B.COMPARATOR, 1, [' T ', 'TQT', 'SSS'], { T: B.RS_TORCH, Q: I.QUARTZ, S: B.STONE });
  shaped(B.OBSERVER, 1, ['CCC', 'RRQ', 'CCC'], { C: B.COBBLESTONE, R: I.REDSTONE, Q: I.QUARTZ });
  shaped(B.ENCHANTING_TABLE, 1, [' B ', 'D#D', '###'], { B: I.BOOK, D: I.DIAMOND, '#': B.OBSIDIAN });

  for (const [, mat, tier] of PLANK_LIKE) {
    const key = { '#': mat, '|': I.STICK };
    shaped(I.tools[tier + '_pickaxe'], 1, ['###', ' | ', ' | '], key);
    shaped(I.tools[tier + '_axe'], 1, ['##', '#|', ' |'], key);
    shaped(I.tools[tier + '_shovel'], 1, ['#', '|', '|'], key);
    shaped(I.tools[tier + '_sword'], 1, ['#', '#', '|'], key);
    shaped(I.tools[tier + '_hoe'], 1, ['##', ' |', ' |'], key);
  }

  for (const [tier, mat] of [['iron', I.IRON_INGOT], ['gold', I.GOLD_INGOT], ['diamond', I.DIAMOND]]) {
    const key = { '#': mat };
    shaped(I.armor[tier + '_helmet'], 1, ['###', '# #'], key);
    shaped(I.armor[tier + '_chestplate'], 1, ['# #', '###', '###'], key);
    shaped(I.armor[tier + '_leggings'], 1, ['###', '# #', '# #'], key);
    shaped(I.armor[tier + '_boots'], 1, ['# #', '# #'], key);
  }

  const smelting = {};
  smelting[B.IRON_ORE] = I.IRON_INGOT;
  smelting[B.GOLD_ORE] = I.GOLD_INGOT;
  smelting[B.SAND] = B.GLASS;
  smelting[B.COBBLESTONE] = B.STONE;
  smelting[B.LOG] = I.COAL;
  smelting[I.RAW_BEEF] = I.COOKED_BEEF;
  smelting[I.RAW_PORK] = I.COOKED_PORK;
  smelting[I.RAW_CHICKEN] = I.COOKED_CHICKEN;
  smelting[I.RAW_MUTTON] = I.COOKED_MUTTON;

  function gridIds(grid, w) {
    const h = grid.length / w;
    const cells = grid.map((s) => (s ? s.id : 0));
    return trim(cells, w, h);
  }

  function matches(recipe, grid, w) {
    if (recipe.ingredients) {
      const have = grid.filter(Boolean).map((s) => s.id).sort();
      const want = recipe.ingredients.slice().sort();
      if (have.length !== want.length) return false;
      for (let i = 0; i < have.length; i++) if (have[i] !== want[i]) return false;
      return true;
    }
    if (recipe.w > w) return false;
    const t = gridIds(grid, w);
    if (t.w !== recipe.w || t.h !== recipe.h) return false;
    for (let i = 0; i < t.cells.length; i++) if (t.cells[i] !== recipe.cells[i]) return false;
    return true;
  }

  function find(grid, w) {
    for (const r of list) {
      if (matches(r, grid, w)) return r;
    }
    return null;
  }

  function fitsGrid(recipe, w) {
    if (recipe.ingredients) return recipe.ingredients.length <= w * w;
    return recipe.w <= w && recipe.h <= w;
  }

  function canCraft(recipe, counts) {
    for (const id in recipe.need) {
      if ((counts[id] || 0) < recipe.need[id]) return false;
    }
    return true;
  }

  global.Recipes = { list, find, matches, canCraft, fitsGrid, smelting, gridIds };
})(window);
