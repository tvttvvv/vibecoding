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

    Controls.bindTap(el('btnSettings'), () => this.openSettings());
    Controls.bindTap(el('btnSettingsClose'), () => this.closeSettings());
    Controls.bindTap(el('btnSettingsReset'), () => {
      Settings.reset();
      this.renderSettings();
      this.toast('조작 설정을 기본값으로 되돌렸어요', 2000);
    });
    for (const btn of document.querySelectorAll('[data-open-settings]')) {
      Controls.bindTap(btn, () => this.openSettings());
    }

    this.initMenu();
    this.initChat();
  };

  // ------------------------------------------------------------- settings
  UI.openSettings = function () {
    this.renderSettings();
    el('settingsScreen').classList.remove('hidden');
    if (this.game.started) this.game.paused = true;
    Controls.releaseLock();
  };

  UI.closeSettings = function () {
    el('settingsScreen').classList.add('hidden');
    const pauseOpen = !el('pauseScreen').classList.contains('hidden');
    if (this.game.started && !this.screen && !pauseOpen) this.game.paused = false;
  };

  UI.renderSettings = function () {
    const box = el('settingsBody');
    box.innerHTML = '';
    for (const d of Settings.DEFS) {
      const row = document.createElement('div');
      row.className = 'setRow';

      const label = document.createElement('label');
      label.textContent = d.label;
      const value = document.createElement('span');
      value.className = 'setValue';
      label.appendChild(value);
      row.appendChild(label);

      if (d.type === 'bool') {
        const btn = document.createElement('button');
        btn.className = 'panelBtn wide';
        const paint = () => {
          const on = Settings.bool(d.key);
          btn.textContent = on ? '켜짐' : '꺼짐';
          btn.classList.toggle('on', on);
          value.textContent = '';
        };
        Controls.bindTap(btn, () => { Settings.set(d.key, Settings.bool(d.key) ? 0 : 1); paint(); });
        paint();
        row.appendChild(btn);
      } else {
        const input = document.createElement('input');
        input.type = 'range';
        input.min = d.min; input.max = d.max; input.step = d.step;
        input.value = Settings.get(d.key);
        value.textContent = Settings.get(d.key) + (d.unit || '');
        input.addEventListener('input', () => {
          Settings.set(d.key, +input.value);
          value.textContent = Settings.get(d.key) + (d.unit || '');
        });
        row.appendChild(input);
      }
      box.appendChild(row);
    }
  };

  UI.showKeyboardHint = function () {
    if (this._kbHinted) return;
    this._kbHinted = true;
    this.toast('키보드 모드: WASD 이동 · Space 점프 · 화면 클릭 후 마우스로 조준 · 좌클릭 캐기 · 우클릭 놓기 · 1~9 단축칸 · E 인벤토리 · Q 버리기 · T 채팅 · Esc 해제', 7000);
  };

  UI.onEscape = function () {
    if (!el('settingsScreen').classList.contains('hidden')) { this.closeSettings(); return; }
    if (!el('chatScreen').classList.contains('hidden')) { this.closeChat(); return; }
    if (this.screen) { this.closeScreen(); return; }
    if (!el('pauseScreen').classList.contains('hidden')) { this.hidePause(); return; }
    if (this.game.started) this.showPause();
  };

  // Only the parts that move: a full re-render would drop a drag in progress.
  UI.refreshFurnace = function () {
    if (!this.screen || this.screen.kind !== 'furnace') return;
    if (this._dragging) return;
    const f = this.screen.entity;
    const flame = document.querySelector('#screenPanel .flame span');
    if (flame) flame.style.height = Math.round((f.burnMax > 0 ? Math.max(0, f.burn / f.burnMax) : 0) * 100) + '%';
    const cook = document.querySelector('#screenPanel .cookBar span');
    if (cook) cook.style.width = Math.round((f.cook / f.cookMax) * 100) + '%';
    this.refreshSlotNode('fin', 0);
    this.refreshSlotNode('ffuel', 0);
    this.refreshSlotNode('fout', 0);
  };

  // ------------------------------------------------------------------- chat
  UI.chatHistory = [];

  UI.initChat = function () {
    Controls.bindTap(el('btnChat'), () => this.openChat());
    Controls.bindTap(el('btnChatClose'), () => this.closeChat());
    Controls.bindTap(el('btnChatSend'), () => this.sendChat());
    el('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.sendChat(); }
    });
  };

  UI.openChat = function () {
    if (!Net.active) return;
    el('chatScreen').classList.remove('hidden');
    this.renderChat();
    setTimeout(() => el('chatInput').focus(), 50);
  };

  UI.closeChat = function () {
    el('chatScreen').classList.add('hidden');
    el('chatInput').blur();
  };

  UI.sendChat = function () {
    const input = el('chatInput');
    const text = input.value.trim();
    input.value = '';
    if (!text) return;
    Net.sendChat(text.slice(0, 120));
    input.focus();
  };

  UI.addChat = function (from, text, system) {
    this.chatHistory.push({ from, text, system: !!system });
    if (this.chatHistory.length > 80) this.chatHistory.shift();
    this.renderChat();
    this.showChatLog();
  };

  UI.chatLine = function (entry) {
    const row = document.createElement('div');
    row.className = 'chatLine' + (entry.system ? ' system' : '');
    if (entry.system) {
      row.textContent = entry.text;
    } else {
      const who = document.createElement('span');
      who.className = 'chatWho';
      who.textContent = '<' + entry.from + '> ';
      row.appendChild(who);
      row.appendChild(document.createTextNode(entry.text));
    }
    return row;
  };

  UI.renderChat = function () {
    const box = el('chatMessages');
    if (!el('chatScreen').classList.contains('hidden')) {
      box.innerHTML = '';
      for (const entry of this.chatHistory) box.appendChild(this.chatLine(entry));
      box.scrollTop = box.scrollHeight;
    }
    const log = el('chatLog');
    log.innerHTML = '';
    for (const entry of this.chatHistory.slice(-5)) log.appendChild(this.chatLine(entry));
  };

  UI.showChatLog = function () {
    const log = el('chatLog');
    log.classList.remove('hidden');
    clearTimeout(this._chatLogTimer);
    this._chatLogTimer = setTimeout(() => log.classList.add('hidden'), 9000);
  };

  UI.resetChat = function () {
    this.chatHistory = [];
    el('chatLog').classList.add('hidden');
    this.closeChat();
  };

  // ------------------------------------------------------------------ menus
  UI.showMenuPage = function (id) {
    for (const page of document.querySelectorAll('.menuPage')) {
      page.classList.toggle('hidden', page.id !== id);
    }
    this.setNetStatus('');
    this.refreshSaveButtons();
  };

  // wiping is only offered when there is something to wipe
  UI.refreshSaveButtons = function () {
    el('btnWipeSolo').classList.toggle('hidden', !Store.ok || !Store.hasKind('s:'));
    el('btnWipeRooms').classList.toggle('hidden', !Store.ok || !Store.hasKind('r:'));
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

    Controls.bindTap(el('btnWipeSolo'), () => {
      if (!confirm('저장된 싱글플레이 세계를 모두 지울까요? 되돌릴 수 없어요.')) return;
      const n = Store.clearKind('s:');
      this.refreshSaveButtons();
      this.toast(n + '개의 세계 기록을 지웠어요', 2600);
    });
    Controls.bindTap(el('btnWipeRooms'), () => {
      if (!confirm('저장된 방 기록(세계와 인벤토리)을 모두 지울까요? 되돌릴 수 없어요.')) return;
      const n = Store.clearKind('r:');
      this.refreshSaveButtons();
      this.toast(n + '개의 방 기록을 지웠어요', 2600);
    });

    for (const btn of document.querySelectorAll('[data-public-mode]')) {
      Controls.bindTap(btn, () => game.enterPublic(btn.dataset.publicMode));
    }

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
      'webrtc': '기기 간 직접 연결에 실패했어요. 같은 와이파이에서 시도해 보세요.',
      'room-full': '방이 가득 찼어요. 잠시 후 다시 시도해 주세요.'
    };
    return map[err] || ('연결에 실패했어요 (' + err + ')');
  };

  UI.renderRoom = function () {
    const on = Net.active;
    el('btnRoom').classList.toggle('hidden', !on);
    el('btnChat').classList.toggle('hidden', !on);
    if (on) el('btnRoom').textContent = Net.playerCount();
    if (!on) {
      el('roomScreen').classList.add('hidden');
      this.closeChat();
      return;
    }

    const pub = this.game.publicRoom(Net.code);
    el('roomCodeBig').textContent = pub ? '공개' : (Net.code || '------');
    el('roomCodeBig').classList.toggle('publicTag', !!pub);
    el('roomHostNote').textContent = pub
      ? pub.label + ' · 코드 없이 누구나 들어올 수 있어요' + (Net.isHost ? ' (내가 방장)' : '')
      : (Net.isHost
        ? '내가 방장입니다. 이 코드를 친구에게 알려주세요.'
        : '방장의 세계에 참여 중입니다.');

    el('roomSaveNote').textContent = Store.ok
      ? (Net.isHost
        ? '이 방의 세계와 내 인벤토리는 내 기기에 저장됩니다. 다음에 내가 방을 열면 그대로 이어집니다.'
        : '내 인벤토리와 지금 보는 세계는 내 기기에 저장됩니다. 방장이 빈 방을 열면 내 기록으로 복원해 줍니다.')
      : '이 브라우저에서는 저장이 꺼져 있어요 (시크릿 모드일 수 있어요).';

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
    node.classList.remove('ench');
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
    node.classList.toggle('ench', !!stack.ench);
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
      if (kind === 'ein' && !(Enchant.canEnchant(inv.held) && inv.held.count === 1 && !(this.screen.entity.item[0]))) return;
      if (kind === 'elapis' && inv.held.id !== Items.LAPIS) return;
      if (kind === 'bbottle' && !Brewing.isBottle(inv.held.id)) return;
      if (kind === 'bing' && !Brewing.isIngredient(inv.held.id)) return;
      if (kind === 'bfuel' && inv.held.id !== Items.BLAZE_POWDER) return;
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
      label.textContent = Items.name(stack.id) + (stack.ench ? ' (' + Enchant.label(stack) + ')' : '');
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
    // the mouse is needed to move items around
    Controls.releaseLock();
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
      const taken = inv.addStack(stack);
      if (taken < stack.count) this.game.spawnDropAtPlayer(stack.id, stack.count - taken, stack);
    }
    if (this.screen && this.screen.kind === 'chest') {
      Sound.chest(false);
      this.game.syncChest(this.screen.entity);
    }
    if (this.screen && this.screen.kind === 'enchant') {
      for (const arr of [this.screen.entity.item, this.screen.entity.lapis]) {
        const st = arr[0];
        arr[0] = null;
        if (st && inv.addStack(st) < st.count) this.game.spawnDropAtPlayer(st.id, st.count, st);
      }
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
    if (kind === 'chest') return this.screen.entity.slots;
    if (kind === 'ein') return this.screen.entity.item;
    if (kind === 'elapis') return this.screen.entity.lapis;
    if (kind === 'bbottle') return this.screen.entity.bottles;
    if (kind === 'bing') return this.screen.entity.ingredient;
    if (kind === 'bfuel') return this.screen.entity.fuel;
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
      if (kind === 'ein' && !(Enchant.canEnchant(inv.held) && inv.held.count === 1 && !(this.screen.entity.item[0]))) return;
      if (kind === 'elapis' && inv.held.id !== Items.LAPIS) return;
      if (kind === 'bbottle' && !Brewing.isBottle(inv.held.id)) return;
      if (kind === 'bing' && !Brewing.isIngredient(inv.held.id)) return;
      if (kind === 'bfuel' && inv.held.id !== Items.BLAZE_POWDER) return;
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
      this.game.smeltXp(out.id, move);
    } else {
      this.game.smeltXp(out.id, out.count);
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

    const titles = { inventory: '인벤토리', crafting: '제작', furnace: '화로', creative: '크리에이티브', chest: '상자', enchant: '마법 부여', trade: '주민 거래', brewing: '양조기' };
    const kind = this.screen.kind;
    el('screenTitle').textContent = titles[kind] || '인벤토리';
    el('btnRecipeBook').classList.toggle('hidden', kind === 'creative' || kind === 'furnace' || kind === 'chest' || kind === 'enchant' || kind === 'trade' || kind === 'brewing');
    el('btnRecipeBook').classList.toggle('active', this.recipeBookOpen);

    if (kind === 'creative') this.renderCreative(body);
    else if (kind === 'furnace') this.renderFurnace(body);
    else if (kind === 'chest') this.renderChest(body);
    else if (kind === 'enchant') this.renderEnchant(body);
    else if (kind === 'trade') this.renderTrade(body);
    else if (kind === 'brewing') this.renderBrewing(body);
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

  // the brewing stand: ingredient on top, blaze powder beside it, three bottles below
  UI.renderBrewing = function (body) {
    const st = this.screen.entity;
    const wrap = document.createElement('div');
    wrap.className = 'brewArea';
    const top = document.createElement('div');
    top.className = 'brewTop';
    top.appendChild(this.makeSlot(st.fuel[0], { kind: 'bfuel', index: 0 }));
    const fuel = document.createElement('div');
    fuel.className = 'brewFuel';
    const fuelFill = document.createElement('span');
    fuelFill.style.width = Math.round(st.fuelLeft / Brewing.FUEL_BREWS * 100) + '%';
    fuel.appendChild(fuelFill);
    top.appendChild(fuel);
    top.appendChild(this.makeSlot(st.ingredient[0], { kind: 'bing', index: 0 }));
    const prog = document.createElement('div');
    prog.className = 'brewProg';
    const progFill = document.createElement('span');
    progFill.style.height = Math.round(st.brew / Brewing.BREW_TIME * 100) + '%';
    prog.appendChild(progFill);
    top.appendChild(prog);
    wrap.appendChild(top);
    const bottles = document.createElement('div');
    bottles.className = 'brewBottles';
    for (let i = 0; i < 3; i++) bottles.appendChild(this.makeSlot(st.bottles[i], { kind: 'bbottle', index: i }));
    wrap.appendChild(bottles);
    body.appendChild(wrap);
    const note = document.createElement('p');
    note.className = 'invNote';
    note.textContent = '아래에 물병, 위에 재료, 왼쪽에 블레이즈 가루(연료). 네더 사마귀로 어색한 물약을 먼저 만드세요. 레드스톤은 시간 연장, 발광석은 강화.';
    body.appendChild(note);
  };

  UI.refreshBrewing = function () {
    if (!this.screen || this.screen.kind !== 'brewing' || this._dragging) return;
    const st = this.screen.entity;
    const prog = document.querySelector('#screenPanel .brewProg span');
    if (prog) prog.style.height = Math.round(st.brew / Brewing.BREW_TIME * 100) + '%';
    const fuel = document.querySelector('#screenPanel .brewFuel span');
    if (fuel) fuel.style.width = Math.round(st.fuelLeft / Brewing.FUEL_BREWS * 100) + '%';
  };

  // the boss's health across the top of the screen
  UI.renderBoss = function (name, frac) {
    const bar = el('bossBar');
    if (!bar) return;
    const show = !!name;
    if (bar.classList.contains('hidden') === show) bar.classList.toggle('hidden', !show);
    if (!show) return;
    if (this._bossName !== name) { this._bossName = name; el('bossName').textContent = name; }
    const w = Math.max(0, Math.min(1, frac)) * 100;
    if (Math.abs((this._bossW || 0) - w) > 0.2) { this._bossW = w; el('bossFill').style.width = w.toFixed(1) + '%'; }
  };

  // what potions are working on you, with the time left
  UI.renderEffects = function (game) {
    const box = el('effects');
    if (!box) return;
    const lines = game.effectText();
    box.classList.toggle('hidden', !lines.length);
    box.textContent = lines.join('  ·  ');
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

  UI.renderEnchant = function (body) {
    const game = this.game, ent = this.screen.entity;
    const wrap = document.createElement('div');
    wrap.className = 'enchantArea';
    const col = document.createElement('div');
    col.className = 'enchantSlots';
    col.appendChild(this.makeSlot(ent.item[0], { kind: 'ein', index: 0 }));
    col.appendChild(this.makeSlot(ent.lapis[0], { kind: 'elapis', index: 0 }));
    wrap.appendChild(col);

    const list = document.createElement('div');
    list.className = 'enchantOffers';
    const offers = game.enchantOffers(ent);
    const level = game.xpInfo(game.player.xp || 0).level;
    const lapis = ent.lapis[0] ? ent.lapis[0].count : 0;
    for (let i = 0; i < 3; i++) {
      const o = offers[i];
      const btn = document.createElement('button');
      btn.className = 'enchantOffer';
      if (!o) {
        btn.disabled = true;
        btn.textContent = ent.item[0] ? '마법을 부여할 수 없는 물건' : '물건을 올려 주세요';
      } else {
        const ok = game.mode !== 'survival' || (level >= o.level && lapis >= o.lapis);
        btn.disabled = !ok;
        btn.innerHTML = '';
        const name = document.createElement('span');
        name.className = 'offerName';
        name.textContent = Enchant.describe(o.ench);
        const cost = document.createElement('span');
        cost.className = 'offerCost';
        cost.textContent = '레벨 ' + o.level + ' · 청금석 ' + o.lapis;
        btn.appendChild(name);
        btn.appendChild(cost);
        Controls.bindTap(btn, () => { if (!btn.disabled) game.applyEnchant(i); });
      }
      list.appendChild(btn);
    }
    wrap.appendChild(list);
    body.appendChild(wrap);
    const note = document.createElement('p');
    note.className = 'invNote';
    note.textContent = '책장 ' + ent.shelves + '개 · 주위에 책장을 놓으면 더 강한 마법이 나와요 (최대 15개)';
    body.appendChild(note);
  };

  UI.renderTrade = function (body) {
    const game = this.game;
    const PROF = { farmer: '농부', librarian: '사서', smith: '대장장이', cleric: '성직자' };
    const head = document.createElement('p');
    head.className = 'invNote';
    head.textContent = (PROF[this.screen.entity.prof] || '주민') + ' · 가진 물건으로 바꿀 수 있는 거래가 밝게 표시돼요';
    body.appendChild(head);
    const list = document.createElement('div');
    list.className = 'tradeList';
    const icon = (id, n) => {
      const d = document.createElement('span');
      d.className = 'tradeItem';
      const img = document.createElement('img');
      img.src = Items.icon(id);
      d.appendChild(img);
      const c = document.createElement('b');
      c.textContent = n > 1 ? n : '';
      d.appendChild(c);
      d.title = Items.name(id);
      return d;
    };
    this.screen.entity.trades.forEach((t, i) => {
      const row = document.createElement('button');
      row.className = 'tradeRow';
      row.disabled = !game.canAfford(t);
      for (const [id, n] of t.cost) row.appendChild(icon(id, n));
      const arrow = document.createElement('span');
      arrow.className = 'tradeArrow';
      arrow.textContent = '→';
      row.appendChild(arrow);
      row.appendChild(icon(t.result[0], t.result[1]));
      const name = document.createElement('span');
      name.className = 'tradeName';
      name.textContent = Items.name(t.result[0]);
      row.appendChild(name);
      Controls.bindTap(row, () => { if (!row.disabled) game.doTrade(i); });
      list.appendChild(row);
    });
    body.appendChild(list);
  };

  UI.renderChest = function (body) {
    const chest = this.screen.entity;
    const grid = document.createElement('div');
    grid.className = 'invGrid chestGrid';
    for (let i = 0; i < 27; i++) grid.appendChild(this.makeSlot(chest.slots[i], { kind: 'chest', index: i }));
    body.appendChild(grid);
    const label = document.createElement('p');
    label.className = 'invNote';
    label.textContent = '인벤토리';
    body.appendChild(label);
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

  // our own splash lines, shown one at a time under the title
  const SPLASHES = [
    '100% 손으로 그린 픽셀!', '크리퍼 조심!', '횃불은 넉넉하게!', '빵은 밀 세 개!',
    '태블릿에서도 된다!', '다이아몬드는 깊은 곳에!', '밤에는 침대로!', '보트 타고 강 건너기!',
    '곡괭이는 돌부터!', '양털 세 개면 침대!', '좀비는 햇빛이 싫어요', '구름이 네모나다!',
    '웅크리면 안 떨어져요', '상자에 잘 보관하세요', '경험치 구슬 뽁뽁!'
  ];

  UI.showMenu = function () {
    const sp = el('splash');
    if (sp) sp.textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
    el('menuScreen').classList.remove('hidden');
    document.body.classList.toggle('onTitle', !this.game.started);
    this.refreshSaveButtons();
  };
  UI.hideMenu = function () {
    el('menuScreen').classList.add('hidden');
    document.body.classList.remove('onTitle');
  };
  UI.showDeath = function (score) {
    // the room's mode is the host's call; switching would also dodge item loss
    el('btnDeathCreative').classList.toggle('hidden', Net.active);
    el('deathScore').textContent = '점수: ' + (score || 0);
    el('deathScreen').classList.remove('hidden');
    Controls.releaseLock();
  };

  // ------------------------------------------------------------ pause menu
  UI.showPause = function () {
    if (!this.game.started || this.game.player.dead) return;
    if (this.screen) this.closeScreen();
    el('pauseScreen').classList.remove('hidden');
    el('pauseRoomNote').textContent = Net.active
      ? '멀티플레이 중에는 세계가 멈추지 않아요'
      : '';
    // a room keeps running for everyone else, so only solo play stops
    if (!Net.active) this.game.paused = true;
    Controls.releaseLock();
  };

  UI.hidePause = function () {
    el('pauseScreen').classList.add('hidden');
    if (!this.screen) this.game.paused = false;
  };

  // ---------------------------------------------------------- xp and crouch
  UI.renderXp = function (p) {
    if (!p) return;
    const game = this.game;
    const show = game.mode === 'survival';
    el('xpBar').classList.toggle('hidden', !show);
    if (!show) return;
    const info = game.xpInfo(p.xp || 0);
    const pct = Math.round(info.progress * 1000) / 10;
    if (this._xpSig === info.level + ':' + pct) return;
    this._xpSig = info.level + ':' + pct;
    el('xpFill').style.width = pct + '%';
    el('xpLevel').textContent = info.level > 0 ? info.level : '';
  };

  UI.setSneak = function (on) {
    el('btnSneak').classList.toggle('active', !!on);
  };
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
    el('btnSneak').classList.toggle('hidden', flying);
    if (flying) { Controls.toggleSneak(false); this.setSneak(false); }
  };

  UI.setOverlay = function (id, alpha) { el(id).style.opacity = alpha; };

  global.UI = UI;
})(window);
