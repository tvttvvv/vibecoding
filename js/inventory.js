(function (global) {
  'use strict';

  const HOTBAR_SIZE = 9;
  const TOTAL_SLOTS = 36;

  function Inventory() {
    this.slots = new Array(TOTAL_SLOTS).fill(null);
    this.armor = new Array(4).fill(null);
    this.craft = new Array(9).fill(null);
    this.craftWidth = 2;
    this.held = null;
    this.selected = 0;
    this.onChange = null;
  }

  Inventory.prototype.changed = function () {
    if (this.onChange) this.onChange();
  };

  Inventory.prototype.selectedStack = function () {
    return this.slots[this.selected];
  };

  Inventory.prototype.makeStack = function (id, count) {
    const stack = { id, count };
    const dur = Items.maxDurability(id);
    if (dur) stack.dur = dur;
    return stack;
  };

  Inventory.prototype.add = function (id, count) {
    if (!id || count <= 0) return 0;
    const max = Items.stackMax(id);
    let left = count;
    if (max > 1) {
      for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.count < max) {
          const put = Math.min(max - s.count, left);
          s.count += put;
          left -= put;
        }
      }
    }
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      if (this.slots[i]) continue;
      const put = Math.min(max, left);
      this.slots[i] = this.makeStack(id, put);
      left -= put;
    }
    this.changed();
    return count - left;
  };

  Inventory.prototype.consumeSelected = function () {
    const s = this.slots[this.selected];
    if (!s) return false;
    s.count -= 1;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
    return true;
  };

  // returns true when the tool broke
  Inventory.prototype.damageSelected = function (amount) {
    const s = this.slots[this.selected];
    if (!s || !s.dur) return false;
    s.dur -= amount;
    if (s.dur <= 0) {
      this.slots[this.selected] = null;
      this.changed();
      return true;
    }
    this.changed();
    return false;
  };

  Inventory.prototype.damageArmor = function (amount) {
    let broke = false;
    for (let i = 0; i < 4; i++) {
      const s = this.armor[i];
      if (!s || !s.dur) continue;
      s.dur -= amount;
      if (s.dur <= 0) { this.armor[i] = null; broke = true; }
    }
    if (broke) this.changed();
    return broke;
  };

  Inventory.prototype.armorPoints = function () {
    let total = 0;
    for (const s of this.armor) {
      if (!s) continue;
      const d = Items.get(s.id);
      if (d && d.armor) total += d.armor.points;
    }
    return total;
  };

  Inventory.prototype.counts = function () {
    const out = {};
    for (const s of this.slots) if (s) out[s.id] = (out[s.id] || 0) + s.count;
    return out;
  };

  Inventory.prototype.count = function (id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  };

  Inventory.prototype.takeFromSlots = function (id, count) {
    let left = count;
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count <= 0) this.slots[i] = null;
    }
    return count - left;
  };

  Inventory.prototype.clear = function () {
    this.slots.fill(null);
    this.armor.fill(null);
    this.craft.fill(null);
    this.held = null;
    this.changed();
  };

  Inventory.prototype.craftCells = function () {
    const w = this.craftWidth;
    const out = [];
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) out.push(this.craft[y * 3 + x]);
    }
    return out;
  };

  Inventory.prototype.setCraftCell = function (x, y, stack) {
    this.craft[y * 3 + x] = stack;
    this.changed();
  };

  Inventory.prototype.clearCraft = function () {
    const dropped = [];
    for (let i = 0; i < 9; i++) {
      if (this.craft[i]) { dropped.push(this.craft[i]); this.craft[i] = null; }
    }
    return dropped;
  };

  global.Inventory = Inventory;
  global.InventoryConst = { HOTBAR_SIZE, TOTAL_SLOTS };
})(window);
