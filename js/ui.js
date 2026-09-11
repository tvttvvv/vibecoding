(function (global) {
  'use strict';

  const el = (id) => document.getElementById(id);

  const UI = {
    game: null,
    hotbarSlots: [],
    hearts: [],
    foods: [],
    bubbles: [],
    pickedSlot: null,
    debugOn: false
  };

  UI.init = function (game) {
    this.game = game;
    this.buildHotbar();
    this.buildStatusRows();

    Controls.bindTap(el('btnInventory'), () => this.toggleInventory());
    Controls.bindTap(el('btnFly'), () => game.toggleFly());
    Controls.bindTap(el('btnDebug'), () => {
      this.debugOn = !this.debugOn;
      el('debugPanel').classList.toggle('hidden', !this.debugOn);
    });
    Controls.bindTap(el('invClose'), () => this.closeInventory());
  };

  UI.buildHotbar = function () {
    const bar = el('hotbar');
    bar.innerHTML = '';
    this.hotbarSlots = [];
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = '<img alt=""><span class="count"></span>';
      Controls.bindTap(slot, () => {
        this.game.inventory.selected = i;
        this.renderHotbar();
      });
      bar.appendChild(slot);
      this.hotbarSlots.push(slot);
    }
  };

  UI.buildStatusRows = function () {
    const mk = (row, cls, count) => {
      const parent = el(row);
      parent.innerHTML = '';
      const list = [];
      for (let i = 0; i < count; i++) {
        const node = document.createElement(cls === 'bubble' ? 'div' : 'img');
        node.className = cls;
        parent.appendChild(node);
        list.push(node);
      }
      return list;
    };
    this.hearts = mk('healthRow', 'statIcon', 10);
    this.foods = mk('foodRow', 'statIcon', 10);
    this.bubbles = mk('airRow', 'bubble', 10);
  };

  UI.renderHotbar = function () {
    const inv = this.game.inventory;
    for (let i = 0; i < 9; i++) {
      const slot = this.hotbarSlots[i];
      const stack = inv.slots[i];
      const img = slot.querySelector('img');
      const count = slot.querySelector('.count');
      slot.classList.toggle('selected', i === inv.selected);
      if (stack) {
        img.src = Blocks.iconFor(stack.id);
        img.style.display = '';
        count.textContent = this.game.mode === 'creative' ? '' : (stack.count > 1 ? stack.count : '');
      } else {
        img.removeAttribute('src');
        img.style.display = 'none';
        count.textContent = '';
      }
    }
    const stack = inv.selectedStack();
    const label = el('heldLabel');
    if (stack) {
      label.textContent = Blocks.byId[stack.id].name;
      label.classList.remove('hidden');
      clearTimeout(this._labelTimer);
      this._labelTimer = setTimeout(() => label.classList.add('hidden'), 1400);
    } else {
      label.classList.add('hidden');
    }
  };

  UI.renderStats = function (player) {
    const survival = player.mode === 'survival';
    el('statusBars').classList.toggle('hidden', !survival);
    if (!survival) return;

    const sig = player.health + '|' + player.food + '|' + Math.round(player.air * 4);
    if (sig === this._statSig) return;
    this._statSig = sig;

    const I = Textures.icons;
    for (let i = 0; i < 10; i++) {
      const need = player.health - i * 2;
      this.hearts[i].src = need >= 2 ? I.heartFull : need >= 1 ? I.heartHalf : I.heartEmpty;
      const f = player.food - i * 2;
      this.foods[i].src = f >= 2 ? I.foodFull : f >= 1 ? I.foodHalf : I.foodEmpty;
    }

    const airRatio = player.air / PlayerConst.MAX_AIR;
    const showAir = airRatio < 0.999;
    el('airRow').classList.toggle('hidden', !showAir);
    if (showAir) {
      const filled = Math.ceil(airRatio * 10);
      for (let i = 0; i < 10; i++) this.bubbles[i].classList.toggle('empty', i >= filled);
    }
  };

  UI.toggleInventory = function () {
    const screen = el('inventoryScreen');
    if (screen.classList.contains('hidden')) this.openInventory();
    else this.closeInventory();
  };

  UI.openInventory = function () {
    const screen = el('inventoryScreen');
    screen.classList.remove('hidden');
    this.pickedSlot = null;
    this.renderInventoryScreen();
    this.game.paused = true;
  };

  UI.closeInventory = function () {
    el('inventoryScreen').classList.add('hidden');
    this.game.paused = false;
    this.renderHotbar();
  };

  UI.renderInventoryScreen = function () {
    const body = el('invBody');
    body.innerHTML = '';
    el('invTitle').textContent = this.game.mode === 'creative' ? '크리에이티브 인벤토리' : '인벤토리';

    if (this.game.mode === 'creative') {
      const grid = document.createElement('div');
      grid.className = 'invGrid';
      for (const id of Blocks.creativeList) {
        const slot = this.makeSlotNode(id, 0);
        Controls.bindTap(slot, () => {
          const inv = this.game.inventory;
          inv.setSlot(inv.selected, { id, count: 1 });
          this.renderHotbar();
          this.flash(slot);
        });
        grid.appendChild(slot);
      }
      body.appendChild(grid);
      const note = document.createElement('p');
      note.className = 'invNote';
      note.textContent = '블록을 누르면 선택된 핫바 칸에 들어갑니다. 크리에이티브에서는 무한히 쓸 수 있어요.';
      body.appendChild(note);
      return;
    }

    const inv = this.game.inventory;
    const mainGrid = document.createElement('div');
    mainGrid.className = 'invGrid';
    for (let i = 9; i < 36; i++) mainGrid.appendChild(this.makeInvSlot(i));
    body.appendChild(mainGrid);

    const label = document.createElement('div');
    label.className = 'invSubtitle';
    label.textContent = '핫바';
    body.appendChild(label);

    const hotGrid = document.createElement('div');
    hotGrid.className = 'invGrid hotRow';
    for (let i = 0; i < 9; i++) hotGrid.appendChild(this.makeInvSlot(i));
    body.appendChild(hotGrid);

    const note = document.createElement('p');
    note.className = 'invNote';
    note.textContent = '칸을 누른 뒤 다른 칸을 누르면 아이템이 자리를 바꿉니다.';
    body.appendChild(note);
  };

  UI.makeSlotNode = function (id, count) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    const img = document.createElement('img');
    img.src = Blocks.iconFor(id);
    slot.appendChild(img);
    if (count > 1) {
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = count;
      slot.appendChild(c);
    }
    slot.title = Blocks.byId[id].name;
    return slot;
  };

  UI.makeInvSlot = function (index) {
    const inv = this.game.inventory;
    const stack = inv.slots[index];
    const slot = stack ? this.makeSlotNode(stack.id, stack.count) : (() => {
      const s = document.createElement('div');
      s.className = 'slot';
      return s;
    })();
    if (this.pickedSlot === index) slot.classList.add('picked');
    Controls.bindTap(slot, () => {
      if (this.pickedSlot === null) {
        if (!inv.slots[index]) return;
        this.pickedSlot = index;
      } else if (this.pickedSlot === index) {
        this.pickedSlot = null;
      } else {
        inv.swap(this.pickedSlot, index);
        this.pickedSlot = null;
      }
      this.renderInventoryScreen();
      this.renderHotbar();
    });
    return slot;
  };

  UI.flash = function (node) {
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), 180);
  };

  UI.showMenu = function () {
    el('menuScreen').classList.remove('hidden');
  };

  UI.hideMenu = function () {
    el('menuScreen').classList.add('hidden');
  };

  UI.showDeath = function () {
    el('deathScreen').classList.remove('hidden');
  };

  UI.hideDeath = function () {
    el('deathScreen').classList.add('hidden');
  };

  UI.setLoading = function (visible, text) {
    const s = el('loadingScreen');
    s.classList.toggle('hidden', !visible);
    if (text) el('loadingText').textContent = text;
  };

  UI.toast = function (text, ms) {
    const node = el('hint');
    node.textContent = text;
    node.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => node.classList.add('hidden'), ms || 2600);
  };

  UI.setDebug = function (lines) {
    if (!this.debugOn) return;
    el('debugPanel').textContent = lines.join('\n');
  };

  UI.setFlyButtons = function (mode, flying) {
    el('btnFly').classList.toggle('hidden', mode !== 'creative');
    el('btnFly').classList.toggle('active', flying);
    el('btnFlyUp').classList.toggle('hidden', !flying);
    el('btnFlyDown').classList.toggle('hidden', !flying);
    el('btnJump').classList.toggle('hidden', flying);
  };

  UI.setOverlay = function (id, alpha) {
    el(id).style.opacity = alpha;
  };

  global.UI = UI;
})(window);
