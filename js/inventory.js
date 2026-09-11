(function (global) {
  'use strict';

  const HOTBAR_SIZE = 9;
  const TOTAL_SLOTS = 36;
  const STACK_MAX = 64;

  function Inventory() {
    this.slots = new Array(TOTAL_SLOTS).fill(null);
    this.selected = 0;
    this.onChange = null;
  }

  Inventory.prototype.changed = function () {
    if (this.onChange) this.onChange();
  };

  Inventory.prototype.selectedStack = function () {
    return this.slots[this.selected];
  };

  Inventory.prototype.add = function (id, count) {
    if (!id || count <= 0) return 0;
    let left = count;
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < STACK_MAX) {
        const space = STACK_MAX - s.count;
        const put = Math.min(space, left);
        s.count += put;
        left -= put;
      }
    }
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      if (this.slots[i]) continue;
      const put = Math.min(STACK_MAX, left);
      this.slots[i] = { id, count: put };
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

  Inventory.prototype.setSlot = function (index, stack) {
    this.slots[index] = stack;
    this.changed();
  };

  Inventory.prototype.swap = function (a, b) {
    const t = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = t;
    this.changed();
  };

  Inventory.prototype.count = function (id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  };

  Inventory.prototype.clear = function () {
    this.slots.fill(null);
    this.changed();
  };

  Inventory.prototype.giveStarter = function () {
    this.clear();
  };

  global.Inventory = Inventory;
  global.InventoryConst = { HOTBAR_SIZE, TOTAL_SLOTS, STACK_MAX };
})(window);
