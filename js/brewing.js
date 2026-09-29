(function (global) {
  'use strict';

  const I = Items, B = Blocks;

  // The brewing stand, as in Minecraft: up to three bottles below, one
  // ingredient on top, blaze powder for fuel (one powder brews twenty times).
  // Nether wart turns water into an awkward potion, which each of the other
  // ingredients turns into a potion of its own; redstone makes a potion last
  // longer and glowstone makes it stronger.
  const BREW_TIME = 20;
  const FUEL_BREWS = 20;

  const BASE = {};
  function base(ing, effect) { BASE[ing] = effect; }
  base(I.SUGAR, 'speed');
  base(I.BLAZE_POWDER, 'strength');
  base(I.MAGMA_CREAM, 'fire_res');
  base(I.GHAST_TEAR, 'regen');
  base(I.GOLDEN_CARROT, 'night_vision');
  base(I.GLISTERING_MELON, 'healing');
  base(I.SPIDER_EYE, 'poison');

  const Brewing = { BREW_TIME, FUEL_BREWS };

  // what a bottle becomes with this ingredient, or 0
  Brewing.result = function (bottleId, ing) {
    if (!bottleId || !ing) return 0;
    if (bottleId === I.WATER_BOTTLE) return ing === I.NETHER_WART ? I.AWKWARD : 0;
    if (bottleId === I.AWKWARD) return BASE[ing] ? I.POTIONS[BASE[ing] + ':0'] : 0;
    const d = I.get(bottleId);
    if (!d || !d.potion || d.potion.variant !== 0) return 0;
    if (ing === I.REDSTONE) return I.POTIONS[d.potion.effect + ':1'] || 0;
    if (ing === B.GLOWSTONE) return I.POTIONS[d.potion.effect + ':2'] || 0;
    return 0;
  };

  Brewing.isIngredient = function (id) {
    return id === I.NETHER_WART || !!BASE[id] || id === I.REDSTONE || id === B.GLOWSTONE;
  };

  Brewing.isBottle = function (id) {
    const d = I.get(id);
    return !!(d && d.drink);
  };

  Brewing.canBrew = function (st) {
    const ing = st.ingredient[0];
    if (!ing) return false;
    return st.bottles.some((b) => b && Brewing.result(b.id, ing.id));
  };

  // one frame of a stand's work; true when something visible changed
  Brewing.tick = function (st, dt) {
    let changed = false;
    if (st.fuelLeft <= 0 && st.fuel[0] && st.fuel[0].id === I.BLAZE_POWDER && Brewing.canBrew(st)) {
      st.fuel[0].count--;
      if (st.fuel[0].count <= 0) st.fuel[0] = null;
      st.fuelLeft = FUEL_BREWS;
      changed = true;
    }
    if (st.fuelLeft <= 0 || !Brewing.canBrew(st)) {
      if (st.brew > 0) { st.brew = 0; changed = true; }
      st.ingId = 0;
      return changed;
    }
    // swapping the ingredient starts over
    const ing = st.ingredient[0].id;
    if (st.ingId !== ing) { st.ingId = ing; st.brew = 0; }
    st.brew += dt;
    if (st.brew < BREW_TIME) return changed;
    st.brew = 0;
    for (let i = 0; i < 3; i++) {
      const b = st.bottles[i];
      if (!b) continue;
      const r = Brewing.result(b.id, ing);
      if (r) st.bottles[i] = { id: r, count: 1 };
    }
    st.ingredient[0].count--;
    if (st.ingredient[0].count <= 0) st.ingredient[0] = null;
    st.fuelLeft--;
    if (global.Sound) Sound.brew();
    return true;
  };

  global.Brewing = Brewing;
})(window);
