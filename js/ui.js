(function (global) {
  'use strict';

  const el = (id) => document.getElementById(id);
  const PIECE_LABEL = { helmet: '투구', chestplate: '흉갑', leggings: '레깅스', boots: '부츠' };

  const UI = {
    game: null,
    hotbarSlots: [],
    hearts: [],
    foods: [],
    armorIcons: [],
    bubbles: [],
    screen: null,
    recipeBookOpen: false,
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
    Controls.bindTap(el('screenClose'), () => this.closeScreen());
    this.initSlotGestures();

    Controls.bindTap(el('btnRecipeBook'), () => {
      this.recipeBookOpen = !this.recipeBookOpen;
      this.renderScreen();
    });

    this.initMenu();
  };

  // ------------------------------------------------------------------ menus
  UI.showMenuPage = function (id) {
    for (const page of document.querySelectorAll('.menuPage')) {
      page.classList.toggle('hidden', page.id !== id);
    }
    this.setNetStatus('');
  };

  UI.initMenu = function () {
    const game = this.game;

    Controls.bindTap(el('btnMulti'), () => {
      if (!el('nameInput').value) el('nameInput').value = '플레이어' + (100 + Math.floor(Math.random() * 900));
      this.showMenuPage('menuMulti');
    });
    for (const btn of document.querySelectorAll('[data-menu-back]')) {
      Controls.bindTap(btn, () => this.showMenuPage(btn.dataset.menuBack));
    }
    Controls.bindTap(el('btnGoCreate'), () => {
      el('roomCodeInput').value = Net.randomCode(6);
      this.showMenuPage('menuCreate');
    });
    Controls.bindTap(el('btnGoJoin'), () => this.showMenuPage('menuJoin'));

    for (const btn of document.querySelectorAll('[data-create-mode]')) {
      Controls.bindTap(btn, () => {
        const code = Net.normalizeCode(el('roomCodeInput').value);
        if (code.length < 4) { this.setNetStatus('방 코드는 4자 이상이어야 해요'); return; }
        this.setNetStatus('방을 여는 중...');
        game.hostRoom(btn.dataset.createMode, el('mpSeedInput').value, code, this.playerName());
      });
    }
    Controls.bindTap(el('btnDoJoin'), () => {
      const code = Net.normalizeCode(el('joinCodeInput').value);
      if (code.length < 4) { this.setNetStatus('코드를 확인해 주세요'); return; }
      this.setNetStatus('');
      game.joinRoom(code, this.playerName());
    });

    Controls.bindTap(el('btnRoom'), () => {
      this.renderRoom();
      el('roomScreen').classList.remove('hidden');
    });
    Controls.bindTap(el('btnRoomClose'), () => el('roomScreen').classList.add('hidden'));
    Controls.bindTap(el('btnLeaveRoom'), () => {
      el('roomScreen').classList.add('hidden');
      game.leaveRoom();
    });
  };

  UI.playerName = function () {
    const v = (el('nameInput').value || '').trim();
    return v ? v.slice(0, 12) : '플레이어';
  };

  UI.setNetStatus = function (text) {
    const node = el('netStatus');
    node.textContent = text || '';
    node.classList.toggle('hidden', !text);
  };

  UI.netErrorText = function (err) {
    const map = {
      'unavailable-id': '그 방 코드는 이미 사용 중이에요. 다른 코드로 만들어 보세요.',
      'peer-unavailable': '그 코드의 방을 찾을 수 없어요. 코드를 다시 확인해 주세요.',
      'timeout': '연결 시간이 초과됐어요. 방장이 게임을 켜 두었는지 확인해 주세요.',
      'no-peerjs': '멀티플레이 모듈을 불러오지 못했어요. 새로고침 해 주세요.',
      'network': '네트워크에 연결할 수 없어요.',
      'browser-incompatible': '이 브라우저는 멀티플레이를 지원하지 않아요.',
      'server-error': '접속 서버에 연결할 수 없어요. 인터넷 상태를 확인해 주세요.',
      'socket-error': '접속 서버와 통신이 끊겼어요. 잠시 후 다시 시도해 주세요.',
      'disconnected': '접속 서버와 연결이 끊겼어요. 다시 시도해 주세요.',
      'webrtc': '기기 간 직접 연결에 실패했어요. 같은 와이파이에서 시도해 보세요.'
    };
    return map[err] || ('연결에 실패했어요 (' + err + ')');
  };

  UI.renderRoom = function () {
    const on = Net.active;
    el('btnRoom').classList.toggle('hidden', !on);
    if (on) el('btnRoom').textContent = Net.playerCount();
    if (!on) { el('roomScreen').classList.add('hidden'); return; }

    el('roomCodeBig').textContent = Net.code || '------';
    el('roomHostNote').textContent = Net.isHost
      ? '내가 방장입니다. 이 코드를 친구에게 알려주세요.'
      : '방장의 세계에 참여 중입니다.';

    const list = el('roomPlayers');
    list.innerHTML = '';
    const add = (name, tag) => {
      const row = document.createElement('div');
      row.className = 'roomRow';
      row.textContent = name + (tag ? ' · ' + tag : '');
      list.appendChild(row);
    };
    add(Net.name, Net.isHost ? '방장 (나)' : '나');
    for (const id in Net.players) {
      add(Net.players[id].name, id === 'host' ? '방장' : '');
    }
  };

  UI.buildHotbar = function () {
    const bar = el('hotbar');
    bar.innerHTML = '';
    this.hotbarSlots = [];
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
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
    this.armorIcons = mk('armorRow', 'statIcon', 10);
    this.hearts = mk('healthRow', 'statIcon', 10);
    this.foods = mk('foodRow', 'statIcon', 10);
    this.bubbles = mk('airRow', 'bubble', 10);
  };

  // ------------------------------------------------------------------ slots
  UI.fillSlot = function (node, stack, opts) {
    node.innerHTML = '';
    if (!stack) return node;
    const img = document.createElement('img');
    img.src = Items.icon(stack.id);
    img.alt = Items.name(stack.id);
    node.appendChild(img);
    if (stack.count > 1) {
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = stack.count;
      node.appendChild(c);
    }
    const max = Items.maxDurability(stack.id);
    if (max && stack.dur !== undefined && stack.dur < max) {
      const bar = document.createElement('span');
      bar.className = 'durBar';
      const fill = document.createElement('span');
      const ratio = Math.max(0, stack.dur / max);
      fill.style.width = Math.round(ratio * 100) + '%';
      fill.style.background = ratio > 0.5 ? '#3ddc55' : ratio > 0.25 ? '#e5d33a' : '#e5432a';
      bar.appendChild(fill);
      node.appendChild(bar);
    }
    if (opts && opts.ghost) node.classList.add('ghost');
    return node;
  };

  // `action` is either a tap callback (creative palette, recipe book) or a
  // {kind, index} descriptor handled by the drag/long-press gesture layer
  UI.makeSlot = function (stack, action, extraClass) {
    const node = document.createElement('div');
    node.className = 'slot' + (extraClass ? ' ' + extraClass : '');
    this.fillSlot(node, stack);
    if (stack) node.title = Items.name(stack.id);
    if (typeof action === 'function') Controls.bindTap(node, action);
    else if (action) {
      node.dataset.kind = action.kind;
      node.dataset.index = action.index;
    }
    return node;
  };

  // ---------------------------------------------------------------- gestures
  // tap = move whole stack, long press = split in half / place one,
  // drag across slots = drop one item into each, like Minecraft
  UI.initSlotGestures = function () {
    const panel = el('screenPanel');
    const LONG_MS = 300;
    const MOVE_TOL = 9;
    let active = null;

    const slotAt = (x, y) => {
      const node = document.elementFromPoint(x, y);
      if (!node || !node.closest) return null;
      const slot = node.closest('[data-kind]');
      if (!slot || !panel.contains(slot)) return null;
      return { kind: slot.dataset.kind, index: +slot.dataset.index };
    };

    const begin = (x, y) => {
      const s = slotAt(x, y);
      if (!s) return false;
      active = { slot: s, x0: x, y0: y, moved: false, longFired: false, visited: {} };
      active.timer = setTimeout(() => {
        if (!active || active.moved) return;
        active.longFired = true;
        this.longPressSlot(s.kind, s.index);
      }, LONG_MS);
      return true;
    };

    const move = (x, y) => {
      if (!active) return;
      if (!active.moved && Math.hypot(x - active.x0, y - active.y0) > MOVE_TOL) {
        active.moved = true;
        this._dragging = true;
        clearTimeout(active.timer);
        const k = active.slot.kind + ':' + active.slot.index;
        active.visited[k] = true;
        this.dropOneInto(active.slot.kind, active.slot.index);
      }
      if (!active.moved) return;
      const s = slotAt(x, y);
      if (!s) return;
      const key = s.kind + ':' + s.index;
      if (active.visited[key]) return;
      active.visited[key] = true;
      this.dropOneInto(s.kind, s.index);
    };

    const finish = () => {
      if (!active) return;
      clearTimeout(active.timer);
      const wasDrag = active.moved;
      if (!active.moved && !active.longFired) this.tapSlot(active.slot.kind, active.slot.index);
      active = null;
      this._dragging = false;
      if (wasDrag) this.renderScreen();
    };

    panel.addEventListener('touchstart', (e) => {
      Controls.markTouch();
      if (!begin(e.touches[0].clientX, e.touches[0].clientY)) return;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    panel.addEventListener('touchmove', (e) => {
      Controls.markTouch();
      if (!active) return;
      if (e.cancelable) e.preventDefault();
      move(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    panel.addEventListener('touchend', (e) => {
      Controls.markTouch();
      if (!active) return;
      if (e.cancelable) e.preventDefault();
      finish();
    }, { passive: false });
    // a cancelled touch aborts without acting, but must still settle the panel
    panel.addEventListener('touchcancel', () => {
      if (!active) return;
      clearTimeout(active.timer);
      const wasDrag = active.moved;
      active = null;
      this._dragging = false;
      if (wasDrag) this.renderScreen();
    }, { passive: true });

    // the synthetic mouse burst that follows a touch would replay the gesture
    panel.addEventListener('mousedown', (e) => {
      if (Controls.recentTouch()) return;
      begin(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (Controls.recentTouch() || !active) return;
      move(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => {
      if (Controls.recentTouch()) return;
      finish();
    });
  };

  UI.longPressSlot = function (kind, index) {
    const inv = this.game.inventory;
    if (kind === 'result' || kind === 'fout') { this.tapSlot(kind, index); return; }

    if (inv.held) {
      this.dropOneInto(kind, index);
      return;
    }

    const arr = this.arrayFor(kind);
    const cur = arr[index];
    if (!cur || cur.count < 2) { this.tapSlot(kind, index); return; }

    const take = Math.ceil(cur.count / 2);
    cur.count -= take;
    const split = { id: cur.id, count: take };
    if (cur.dur !== undefined) split.dur = cur.dur;
    if (cur.count <= 0) arr[index] = null;
    inv.held = split;
    inv.changed();
    this.renderScreen();
  };

  UI.dropOneInto = function (kind, index) {
    const inv = this.game.inventory;
    if (!inv.held || kind === 'result' || kind === 'fout') return;

    const arr = this.arrayFor(kind);
    if (!arr) return;
    const cur = arr[index];

    if (kind === 'armor') {
      if (cur || !this.armorFits(index, inv.held)) return;
    }
    if (kind === 'fin' && Recipes.smelting[inv.held.id] === undefined) return;
    if (kind === 'ffuel' && Items.fuelSeconds(inv.held.id) <= 0) return;

    if (!cur) {
      const one = { id: inv.held.id, count: 1 };
      if (inv.held.dur !== undefined) one.dur = inv.held.dur;
      arr[index] = one;
    } else if (cur.id === inv.held.id && !cur.dur && !inv.held.dur &&
               cur.count < Items.stackMax(cur.id)) {
      cur.count += 1;
    } else {
      return;
    }

    inv.held.count -= 1;
    if (inv.held.count <= 0) inv.held = null;
    inv.changed();

    // A full re-render swaps out the DOM node the touch was captured on, which
    // silently kills the rest of the swipe — patch the touched slots instead.
    if (this._dragging) {
      this.refreshSlotNode(kind, index);
      this.refreshSlotNode('result', 0);
      this.renderHeldFloat();
    } else {
      this.renderScreen();
    }
  };

  UI.refreshSlotNode = function (kind, index) {
    const node = document.querySelector(
      '#screenPanel [data-kind="' + kind + '"][data-index="' + index + '"]');
    if (!node) return;
    let stack = null;
    if (kind === 'result') {
      const r = this.craftResult();
      stack = r ? r.stack : null;
    } else {
      const arr = this.arrayFor(kind);
      stack = arr ? arr[index] : null;
    }
    this.fillSlot(node, stack);
  };

  UI.renderHeldFloat = function () {
    const inv = this.game.inventory;
    const float = el('heldFloat');
    if (!inv.held) { float.classList.add('hidden'); return; }
    float.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'heldText';
    label.textContent = '들고 있음';
    float.appendChild(label);
    float.appendChild(this.makeSlot(inv.held, null, 'heldSlot'));
    float.classList.remove('hidden');
  };

  UI.renderHotbar = function () {
    const inv = this.game.inventory;
    for (let i = 0; i < 9; i++) {
      const slot = this.hotbarSlots[i];
      slot.classList.toggle('selected', i === inv.selected);
      this.fillSlot(slot, inv.slots[i]);
    }
    const stack = inv.selectedStack();
    const label = el('heldLabel');
    if (stack) {
      label.textContent = Items.name(stack.id);
      label.classList.remove('hidden');
      clearTimeout(this._labelTimer);
      this._labelTimer = setTimeout(() => label.classList.add('hidden'), 1600);
    } else {
      label.classList.add('hidden');
    }
  };

  UI.renderStats = function (player) {
    const survival = player.mode === 'survival';
    el('statusBars').classList.toggle('hidden', !survival);
    if (!survival) return;

    const armorPts = this.game.inventory ? this.game.inventory.armorPoints() : 0;
    const airRatio = player.air / PlayerConst.MAX_AIR;
    const showAir = airRatio < 0.999;
    // showAir must be part of the signature: the last tick of refilling air
    // rounds to the same bucket as full, and the row would never hide again
    const sig = player.health + '|' + player.food + '|' +
      Math.ceil(airRatio * 10) + '|' + showAir + '|' + armorPts;
    if (sig === this._statSig) return;
    this._statSig = sig;

    const I = Textures.icons;
    for (let i = 0; i < 10; i++) {
      const need = player.health - i * 2;
      this.hearts[i].src = need >= 2 ? I.heartFull : need >= 1 ? I.heartHalf : I.heartEmpty;
      const f = player.food - i * 2;
      this.foods[i].src = f >= 2 ? I.foodFull : f >= 1 ? I.foodHalf : I.foodEmpty;
      const a = armorPts - i * 2;
      this.armorIcons[i].src = a >= 2 ? I.armorFull : a >= 1 ? I.armorHalf : I.armorEmpty;
    }
    el('armorRow').classList.toggle('hidden', armorPts <= 0);

    el('airRow').classList.toggle('hidden', !showAir);
    if (showAir) {
      const filled = Math.ceil(airRatio * 10);
      for (let i = 0; i < 10; i++) this.bubbles[i].classList.toggle('empty', i >= filled);
    }
  };

  // ------------------------------------------------------------------ screens
  UI.toggleInventory = function () {
    if (this.screen) this.closeScreen();
    else this.openScreen(this.game.mode === 'creative' ? 'creative' : 'inventory');
  };

  UI.openScreen = function (kind, entity) {
    const inv = this.game.inventory;
    this.screen = { kind, entity };
    inv.craftWidth = kind === 'crafting' ? 3 : 2;
    el('screen').classList.remove('hidden');
    this.game.paused = true;
    this.renderScreen();
  };

  UI.closeScreen = function () {
    const inv = this.game.inventory;
    const leftovers = inv.clearCraft();
    if (inv.held) { leftovers.push(inv.held); inv.held = null; }
    for (const stack of leftovers) {
      const taken = inv.add(stack.id, stack.count);
      if (taken < stack.count) this.game.spawnDropAtPlayer(stack.id, stack.count - taken);
    }
    this.screen = null;
    el('screen').classList.add('hidden');
    this.game.paused = false;
    this.renderHotbar();
  };

  UI.arrayFor = function (kind) {
    const inv = this.game.inventory;
    if (kind === 'inv') return inv.slots;
    if (kind === 'armor') return inv.armor;
    if (kind === 'craft') return inv.craft;
    if (kind === 'fin') return this.screen.entity.input;
    if (kind === 'ffuel') return this.screen.entity.fuel;
    if (kind === 'fout') return this.screen.entity.output;
    return null;
  };

  UI.tapSlot = function (kind, index) {
    const inv = this.game.inventory;
    if (kind === 'result') { this.takeCraftResult(); return; }
    if (kind === 'fout') { this.takeFurnaceOutput(); return; }

    const arr = this.arrayFor(kind);
    const cur = arr[index];

    if (inv.held) {
      if (kind === 'armor' && !this.armorFits(index, inv.held)) return;
      if (kind === 'fin' && Recipes.smelting[inv.held.id] === undefined) return;
      if (kind === 'ffuel' && Items.fuelSeconds(inv.held.id) <= 0) return;

      if (!cur) {
        arr[index] = inv.held;
        inv.held = null;
      } else if (cur.id === inv.held.id && !cur.dur && !inv.held.dur) {
        const max = Items.stackMax(cur.id);
        const move = Math.min(max - cur.count, inv.held.count);
        cur.count += move;
        inv.held.count -= move;
        if (inv.held.count <= 0) inv.held = null;
      } else {
        arr[index] = inv.held;
        inv.held = cur;
      }
    } else {
      if (!cur) return;
      inv.held = cur;
      arr[index] = null;
    }
    inv.changed();
    this.renderScreen();
  };

  UI.armorFits = function (index, stack) {
    const d = Items.get(stack.id);
    if (!d || !d.armor) return false;
    return Items.PIECE_ORDER[index] === d.armor.slot;
  };

  UI.craftResult = function () {
    const inv = this.game.inventory;
    const cells = inv.craftCells();
    const recipe = Recipes.find(cells, inv.craftWidth);
    if (!recipe) return null;
    return { recipe, stack: { id: recipe.out, count: recipe.count } };
  };

  UI.takeCraftResult = function () {
    const inv = this.game.inventory;
    const result = this.craftResult();
    if (!result) return;
    if (inv.held) {
      if (inv.held.id !== result.recipe.out) return;
      if (inv.held.count + result.recipe.count > Items.stackMax(result.recipe.out)) return;
    }

    const made = inv.makeStack(result.recipe.out, result.recipe.count);
    if (inv.held) inv.held.count += result.recipe.count;
    else inv.held = made;

    for (let i = 0; i < 9; i++) {
      const s = inv.craft[i];
      if (!s) continue;
      s.count -= 1;
      if (s.count <= 0) inv.craft[i] = null;
    }
    inv.changed();
    this.renderScreen();
  };

  UI.takeFurnaceOutput = function () {
    const inv = this.game.inventory;
    const f = this.screen.entity;
    const out = f.output[0];
    if (!out) return;
    if (inv.held) {
      if (inv.held.id !== out.id) return;
      const max = Items.stackMax(out.id);
      const move = Math.min(max - inv.held.count, out.count);
      if (move <= 0) return;
      inv.held.count += move;
      out.count -= move;
      if (out.count <= 0) f.output[0] = null;
    } else {
      inv.held = out;
      f.output[0] = null;
    }
    inv.changed();
    this.renderScreen();
  };

  UI.fillFromRecipe = function (recipe) {
    const inv = this.game.inventory;
    if (!Recipes.fitsGrid(recipe, inv.craftWidth)) {
      this.toast('작업대(3x3)가 필요한 제작법이에요', 1800);
      return;
    }
    for (const stack of inv.clearCraft()) inv.add(stack.id, stack.count);

    const counts = inv.counts();
    if (!Recipes.canCraft(recipe, counts)) {
      this.toast('재료가 부족해요', 1500);
      inv.changed();
      this.renderScreen();
      return;
    }

    if (recipe.ingredients) {
      for (let i = 0; i < recipe.ingredients.length; i++) {
        const id = recipe.ingredients[i];
        if (inv.takeFromSlots(id, 1) > 0) inv.craft[i] = inv.makeStack(id, 1);
      }
    } else {
      for (let y = 0; y < recipe.h; y++) {
        for (let x = 0; x < recipe.w; x++) {
          const id = recipe.cells[y * recipe.w + x];
          if (!id) continue;
          if (inv.takeFromSlots(id, 1) > 0) inv.craft[y * 3 + x] = inv.makeStack(id, 1);
        }
      }
    }
    inv.changed();
    this.renderScreen();
  };

  // ------------------------------------------------------------------ render
  UI.renderScreen = function () {
    if (!this.screen) return;
    const inv = this.game.inventory;
    const body = el('screenBody');
    body.innerHTML = '';

    const titles = { inventory: '인벤토리', crafting: '제작', furnace: '화로', creative: '크리에이티브' };
    el('screenTitle').textContent = titles[this.screen.kind] || '인벤토리';
    el('btnRecipeBook').classList.toggle('hidden', this.screen.kind === 'creative' || this.screen.kind === 'furnace');
    el('btnRecipeBook').classList.toggle('active', this.recipeBookOpen);

    if (this.screen.kind === 'creative') this.renderCreative(body);
    else if (this.screen.kind === 'furnace') this.renderFurnace(body);
    else this.renderCraftingScreen(body);

    if (this.screen.kind !== 'creative') {
      body.appendChild(this.buildMainGrid());
      body.appendChild(this.buildHotRow());
    }

    this.renderHeldFloat();
    this.renderRecipeBook();
  };

  UI.renderCraftingScreen = function (body) {
    const inv = this.game.inventory;
    const top = document.createElement('div');
    top.className = 'invTop';

    if (this.screen.kind === 'inventory') {
      const armorCol = document.createElement('div');
      armorCol.className = 'armorCol';
      for (let i = 0; i < 4; i++) {
        const piece = Items.PIECE_ORDER[i];
        const slot = this.makeSlot(inv.armor[i], { kind: 'armor', index: i }, 'armorSlot');
        if (!inv.armor[i]) slot.dataset.hint = PIECE_LABEL[piece];
        armorCol.appendChild(slot);
      }
      top.appendChild(armorCol);

      const preview = document.createElement('div');
      preview.className = 'previewBox';
      const img = document.createElement('img');
      const equipped = {};
      for (let i = 0; i < 4; i++) {
        const s = inv.armor[i];
        if (s) {
          const d = Items.get(s.id);
          if (d && d.armor) equipped[d.armor.slot] = d.armor.material;
        }
      }
      img.src = Textures.playerPreview(equipped);
      preview.appendChild(img);
      top.appendChild(preview);
    }

    const craftArea = document.createElement('div');
    craftArea.className = 'craftArea';
    const w = inv.craftWidth;
    const grid = document.createElement('div');
    grid.className = 'craftGrid';
    grid.style.gridTemplateColumns = 'repeat(' + w + ', var(--slot))';
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * 3 + x;
        grid.appendChild(this.makeSlot(inv.craft[idx], { kind: 'craft', index: idx }));
      }
    }
    craftArea.appendChild(grid);

    const arrow = document.createElement('div');
    arrow.className = 'arrow';
    arrow.textContent = '➜';
    craftArea.appendChild(arrow);

    const result = this.craftResult();
    craftArea.appendChild(this.makeSlot(result ? result.stack : null, { kind: 'result', index: 0 }, 'resultSlot'));
    top.appendChild(craftArea);

    body.appendChild(top);

    if (this.screen.kind === 'inventory') {
      const note = document.createElement('p');
      note.className = 'invNote';
      note.textContent = '2x2 작업칸입니다. 3x3은 제작대를 설치하고 누르세요. 누르기: 전체 옮기기 · 길게 누르기: 반으로 나누기 / 1개만 놓기 · 꾹 눌러 스와이프: 지나간 칸마다 1개씩';
      body.appendChild(note);
    }
  };

  UI.renderFurnace = function (body) {
    const f = this.screen.entity;
    const wrap = document.createElement('div');
    wrap.className = 'furnaceArea';

    const col = document.createElement('div');
    col.className = 'furnaceCol';
    col.appendChild(this.makeSlot(f.input[0], { kind: 'fin', index: 0 }));

    const flame = document.createElement('div');
    flame.className = 'flame';
    const flameFill = document.createElement('span');
    const ratio = f.burnMax > 0 ? Math.max(0, f.burn / f.burnMax) : 0;
    flameFill.style.height = Math.round(ratio * 100) + '%';
    flame.appendChild(flameFill);
    col.appendChild(flame);

    col.appendChild(this.makeSlot(f.fuel[0], { kind: 'ffuel', index: 0 }));
    wrap.appendChild(col);

    const prog = document.createElement('div');
    prog.className = 'cookBar';
    const progFill = document.createElement('span');
    progFill.style.width = Math.round((f.cook / f.cookMax) * 100) + '%';
    prog.appendChild(progFill);
    wrap.appendChild(prog);

    wrap.appendChild(this.makeSlot(f.output[0], { kind: 'fout', index: 0 }, 'resultSlot'));
    body.appendChild(wrap);

    const note = document.createElement('p');
    note.className = 'invNote';
    note.textContent = '위 칸에 구울 것, 아래 칸에 연료(석탄·판자·막대기)를 넣으세요.';
    body.appendChild(note);
  };

  UI.renderCreative = function (body) {
    const inv = this.game.inventory;
    const all = Blocks.creativeList.concat(Items.creativeItems);
    const grid = document.createElement('div');
    grid.className = 'invGrid creativeGrid';
    for (const id of all) {
      const slot = this.makeSlot({ id, count: 1 }, () => {
        inv.slots[inv.selected] = inv.makeStack(id, Items.stackMax(id) > 1 ? 64 : 1);
        inv.changed();
        this.renderHotbar();
        this.flash(slot);
      });
      grid.appendChild(slot);
    }
    body.appendChild(grid);
    const note = document.createElement('p');
    note.className = 'invNote';
    note.textContent = '누르면 선택된 핫바 칸에 들어갑니다.';
    body.appendChild(note);
  };

  UI.buildMainGrid = function () {
    const inv = this.game.inventory;
    const grid = document.createElement('div');
    grid.className = 'invGrid';
    for (let i = 9; i < 36; i++) {
      grid.appendChild(this.makeSlot(inv.slots[i], { kind: 'inv', index: i }));
    }
    return grid;
  };

  UI.buildHotRow = function () {
    const inv = this.game.inventory;
    const grid = document.createElement('div');
    grid.className = 'invGrid hotRow';
    for (let i = 0; i < 9; i++) {
      grid.appendChild(this.makeSlot(inv.slots[i], { kind: 'inv', index: i }));
    }
    return grid;
  };

  UI.renderRecipeBook = function () {
    const book = el('recipeBook');
    const show = this.recipeBookOpen && this.screen &&
      (this.screen.kind === 'inventory' || this.screen.kind === 'crafting');
    book.classList.toggle('hidden', !show);
    if (!show) return;

    const inv = this.game.inventory;
    const counts = inv.counts();
    book.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'bookTitle';
    title.textContent = '제작법';
    book.appendChild(title);

    const listEl = document.createElement('div');
    listEl.className = 'bookList';

    const sorted = Recipes.list.slice().sort((a, b) => {
      const ca = Recipes.canCraft(a, counts) && Recipes.fitsGrid(a, inv.craftWidth);
      const cb = Recipes.canCraft(b, counts) && Recipes.fitsGrid(b, inv.craftWidth);
      return (cb ? 1 : 0) - (ca ? 1 : 0);
    });

    for (const r of sorted) {
      const ok = Recipes.canCraft(r, counts);
      const fits = Recipes.fitsGrid(r, inv.craftWidth);
      const row = document.createElement('div');
      row.className = 'bookRow' + (ok && fits ? '' : ' locked');

      const out = this.makeSlot({ id: r.out, count: r.count }, null, 'bookOut');
      row.appendChild(out);

      const info = document.createElement('div');
      info.className = 'bookInfo';
      const nm = document.createElement('div');
      nm.className = 'bookName';
      nm.textContent = Items.name(r.out) + (r.count > 1 ? ' x' + r.count : '');
      info.appendChild(nm);

      const need = document.createElement('div');
      need.className = 'bookNeed';
      const parts = [];
      for (const id in r.need) {
        const have = counts[id] || 0;
        parts.push(Items.name(id) + ' ' + have + '/' + r.need[id]);
      }
      need.textContent = parts.join(', ') + (fits ? '' : ' · 작업대 필요');
      info.appendChild(need);
      row.appendChild(info);

      Controls.bindTap(row, () => this.fillFromRecipe(r));
      listEl.appendChild(row);
    }
    book.appendChild(listEl);
  };

  UI.flash = function (node) {
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), 180);
  };

  UI.showMenu = function () { el('menuScreen').classList.remove('hidden'); };
  UI.hideMenu = function () { el('menuScreen').classList.add('hidden'); };
  UI.showDeath = function () { el('deathScreen').classList.remove('hidden'); };
  UI.hideDeath = function () { el('deathScreen').classList.add('hidden'); };

  UI.setLoading = function (visible, text) {
    el('loadingScreen').classList.toggle('hidden', !visible);
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

  UI.setOverlay = function (id, alpha) { el(id).style.opacity = alpha; };

  global.UI = UI;
})(window);
