(function (global) {
  'use strict';

  const B = Blocks;
  const el = (id) => document.getElementById(id);
  const DAY_LENGTH = 1200;
  const REACH = 5.2;
  const ATTACK_REACH = 4.0;
  const PICKUP_PULL = 1.8;
  const PICKUP_RANGE = 1.0;

  // Anyone can walk into these without a code. There is no directory service on
  // static hosting, so the address is simply agreed in advance: whoever arrives
  // first opens the room and everyone after that joins it. The seed is fixed so
  // the world is the same world every time it is reopened.
  const PUBLIC_ROOMS = {
    survival: { code: 'VXOPEN1', seed: 1120480013, label: '공개 서버 · 서바이벌' },
    creative: { code: 'VXOPEN2', seed: 1734905287, label: '공개 서버 · 크리에이티브' }
  };

  const SKY_DAY = new THREE.Color(0x88c6ff);
  const SKY_NIGHT = new THREE.Color(0x070b1c);
  const SKY_DUSK = new THREE.Color(0xf2a45c);

  const Game = {
    mode: 'survival',
    paused: false,
    started: false,
    inventory: null,
    player: null,
    world: null,
    drops: [],
    dayTime: 0.25,
    _geoCache: {}
  };

  Game.initRenderer = function () {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 400);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    el('app').insertBefore(this.renderer.domElement, el('app').firstChild);

    this.fog = new THREE.Fog(0x88c6ff, 28, 62);
    this.scene.fog = this.fog;

    const boxGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.selectionBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 })
    );
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    this.crackMaterial = new THREE.MeshBasicMaterial({
      map: Textures.crackTextures[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1
    });
    this.crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), this.crackMaterial);
    this.crackMesh.visible = false;
    this.scene.add(this.crackMesh);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  };

  Game.blockGeometry = function (id, size) {
    const key = id + ':' + size;
    if (this._geoCache[key]) return this._geoCache[key];
    const isBlock = Items.isBlock(id);
    const geo = isBlock
      ? new THREE.BoxGeometry(size, size, size)
      : new THREE.BoxGeometry(size, size, size * 0.14);
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const t = Textures.tileUV(isBlock ? B.tileFor(id, f) : Items.byId[id].tile);
      const o = f * 4;
      uv.setXY(o + 0, t.u0, t.v1);
      uv.setXY(o + 1, t.u1, t.v1);
      uv.setXY(o + 2, t.u0, t.v0);
      uv.setXY(o + 3, t.u1, t.v0);
    }
    uv.needsUpdate = true;
    this._geoCache[key] = geo;
    return geo;
  };

  Game.start = function (mode, seedText, opts) {
    this.mode = mode;
    UI.hideMenu();
    UI.hideDeath();
    UI.setLoading(true, '세계를 만드는 중...');

    const seed = (opts && opts.seed !== undefined) ? opts.seed : this.hashSeed(seedText);
    this.seed = seed;

    if (this.world) {
      this.scene.remove(this.world.group);
      for (const c of this.world.chunks.values()) {
        if (c.solidMesh) c.solidMesh.geometry.dispose();
        if (c.liquidMesh) c.liquidMesh.geometry.dispose();
      }
    }
    this.clearDrops();
    this.blockEntities = new Map();
    this.editsByChunk = {};
    this.editMap = new Map();
    this.lightSources = new Set();
    // one save slot per world: a room is shared by code, a solo world by seed
    this.roomCode = (opts && opts.room) || null;
    this.worldKey = this.roomCode ? 'r:' + this.roomCode : 's:' + seed;
    this.worldSavedAt = (opts && opts.savedAt) || 0;
    this._worldDirty = false;
    this._saveTimer = 0;
    this._worldTimer = 0;
    if (opts && opts.edits) this.loadEdits(opts.edits);
    this._pendingEntities = (opts && opts.entities) || null;

    this.world = new World(seed);
    this.world.onChunkReady = (chunk) => this.applyChunkEdits(chunk);
    this.scene.add(this.world.group);
    Mobs.attach(this.scene);

    this.inventory = new Inventory();
    this.inventory.onChange = () => UI.renderHotbar();

    this.player = new Player(mode);
    this.player.armorProvider = this.inventory;
    this.itemMaterial = this.itemMaterial ||
      new THREE.MeshBasicMaterial({ map: Textures.texture, alphaTest: 0.5 });

    if (mode === 'creative') {
      const list = B.creativeList;
      for (let i = 0; i < 9 && i < list.length; i++) this.inventory.slots[i] = { id: list[i], count: 64 };
    }

    if (this._pendingEntities) {
      this.loadEntities(this._pendingEntities);
      this._pendingEntities = null;
    }
    this.spawnPlayer();
    this.restoreMe();
    UI.setFlyButtons(mode, this.player.flying);
    UI.renderHotbar();
    UI.renderStats(this.player);

    this.loading = true;
    this.started = true;
    this.paused = false;
    this.dayTime = (opts && opts.dayTime !== undefined) ? opts.dayTime : 0.42;
    this.mining = { target: null, progress: 0 };
    this._deathHandled = false;
    this.avatars = this.avatars || {};
    this.clearAvatars();
    this._eatCooldown = 0;
    this._sleepCooldown = 0;
  };

  // Single player: an empty seed box means "carry on with the world I was in",
  // and typing a seed always opens that seed's world (saved or brand new).
  Game.startSolo = function (mode, seedText) {
    const typed = seedText && String(seedText).trim();
    let seed, saved;
    if (typed) {
      seed = this.hashSeed(typed);
      saved = this.savedWorldFor('s:' + seed, seed);
    } else {
      saved = Store.ok ? Store.lastSolo() : null;
      seed = saved ? saved.seed : this.hashSeed('');
    }
    this.start(mode, '', {
      seed,
      edits: saved ? saved.edits : null,
      entities: saved ? saved.entities : null,
      savedAt: saved ? saved.savedAt : 0
    });
    if (saved) UI.toast('저장된 세계를 이어서 불러왔어요', 3000);
  };

  Game.hashSeed = function (text) {
    if (!text || !String(text).trim()) return (Math.random() * 2147483647) | 0;
    let seed = 0;
    const str = String(text);
    for (let i = 0; i < str.length; i++) seed = (Math.imul(seed, 31) + str.charCodeAt(i)) | 0;
    return seed;
  };

  // ------------------------------------------------------------ world edits
  // One entry per coordinate rather than one per swing, so a long session and a
  // freshly restored one cost the same to store and to send to a joining player.
  Game.registerEdit = function (x, y, z, id) {
    const key = x + ',' + y + ',' + z;
    // monsters keep away from torchlight, so the lit spots are worth tracking
    if (!this.lightSources) this.lightSources = new Set();
    if (B.byId[id] && B.byId[id].light) this.lightSources.add(key);
    else this.lightSources.delete(key);
    if (!this.editMap.has(key)) {
      const ck = Math.floor(x / WorldConst.CHUNK_SIZE) + ',' + Math.floor(z / WorldConst.CHUNK_SIZE);
      const list = this.editsByChunk[ck] || (this.editsByChunk[ck] = []);
      list.push(key);
    }
    this.editMap.set(key, id);
    this._worldDirty = true;
  };

  Game.applyChunkEdits = function (chunk) {
    const list = this.editsByChunk[chunk.cx + ',' + chunk.cz];
    if (!list) return;
    const CS = WorldConst.CHUNK_SIZE;
    for (const key of list) {
      const parts = key.split(',');
      const y = +parts[1];
      if (y < 0 || y >= WorldConst.WORLD_HEIGHT) continue;
      const id = this.editMap.get(key);
      const lx = +parts[0] - chunk.cx * CS, lz = +parts[2] - chunk.cz * CS;
      chunk.data[(y * CS + lz) * CS + lx] = id;
      if (id !== B.AIR && y > chunk.maxY) chunk.maxY = y;
    }
  };

  // flat [x, y, z, id, ...] — compact enough for both localStorage and the wire
  Game.editList = function () {
    const out = [];
    this.editMap.forEach((id, key) => {
      const p = key.split(',');
      out.push(+p[0], +p[1], +p[2], id);
    });
    return out;
  };

  Game.loadEdits = function (flat) {
    if (!flat || !flat.length) return;
    for (let i = 0; i + 3 < flat.length; i += 4) {
      this.registerEdit(flat[i], flat[i + 1], flat[i + 2], flat[i + 3]);
    }
    this._worldDirty = false;
  };

  // a whole world arriving while we are already playing: chunks not loaded yet
  // pick their edits up from editsByChunk when they generate
  Game.applyEditBatch = function (flat) {
    if (!flat || !flat.length) return;
    for (let i = 0; i + 3 < flat.length; i += 4) {
      const x = flat[i], y = flat[i + 1], z = flat[i + 2], id = flat[i + 3];
      this.registerEdit(x, y, z, id);
      this.world.setBlock(x, y, z, id);
      if (id === B.FURNACE) this.furnaceAt(x, y, z);
    }
  };

  // every local change is recorded and, in a room, sent to the other players
  Game.changeBlock = function (x, y, z, id) {
    if (!this.world.setBlock(x, y, z, id)) return false;
    this.registerEdit(x, y, z, id);
    Net.sendEdit(x, y, z, id);
    return true;
  };

  Game.applyRemoteEdit = function (msg) {
    this.registerEdit(msg.x, msg.y, msg.z, msg.id);
    this.world.setBlock(msg.x, msg.y, msg.z, msg.id);
    const key = this.entityKey(msg.x, msg.y, msg.z);
    if (msg.id === B.AIR && this.blockEntities.has(key)) this.blockEntities.delete(key);
    if (msg.id === B.FURNACE) this.furnaceAt(msg.x, msg.y, msg.z);
  };


  // ------------------------------------------------------------------ saving
  // There is no always-on server, so every player keeps the world and their own
  // inventory in their own browser. Rejoining restores your items; hosting a
  // room again restores the buildings you last saw in it.
  const ME_INTERVAL = 6;
  // the whole edit list is rewritten each time, so it goes out less often
  const WORLD_INTERVAL = 15;

  Game.saveTick = function (dt) {
    this._saveTimer = (this._saveTimer || 0) + dt;
    this._worldTimer = (this._worldTimer || 0) + dt;
    if (this._saveTimer >= ME_INTERVAL) {
      this._saveTimer = 0;
      this.saveMe();
    }
    if (this._worldTimer >= WORLD_INTERVAL) {
      this._worldTimer = 0;
      this.saveWorld();
    }
  };

  Game.meState = function () {
    const p = this.player;
    const inv = this.inventory;
    return {
      mode: this.mode,
      slots: inv.serialize(inv.slots),
      armor: inv.serialize(inv.armor),
      selected: inv.selected,
      health: p.health,
      food: p.food,
      air: p.air,
      x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2),
      yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2)
    };
  };

  Game.saveMe = function () {
    if (!this.started || !Store.ok || this.loading) return;
    Store.savePlayer(this.worldKey, this.meState());
  };

  Game.saveWorld = function (force) {
    if (!this.started || !Store.ok || this.loading) return;
    if (!this._worldDirty && !force) return;
    this._worldDirty = false;
    if (Store.saveWorld(this.worldKey, this.seed, this.editList(), this.entityList())) {
      this.worldSavedAt = Date.now();
    } else if (!this._saveWarned) {
      this._saveWarned = true;
      UI.toast('저장 공간이 부족해서 세계를 저장하지 못했어요', 4200);
    }
  };

  Game.saveNow = function (force) {
    this.saveWorld(force);
    this.saveMe();
  };

  // furnaces keep what is inside them, so leaving mid-smelt is not a loss
  Game.entityList = function () {
    const out = [];
    if (!this.blockEntities) return out;
    const pack = (s) => (s ? (s.dur ? [s.id, s.count, s.dur] : [s.id, s.count]) : 0);
    for (const f of this.blockEntities.values()) {
      if (f.type !== 'furnace') continue;
      if (!f.input[0] && !f.fuel[0] && !f.output[0] && f.burn <= 0) continue;
      out.push([f.x, f.y, f.z, pack(f.input[0]), pack(f.fuel[0]), pack(f.output[0]),
        +f.burn.toFixed(1), +f.burnMax.toFixed(1), +f.cook.toFixed(1)]);
    }
    return out;
  };

  Game.loadEntities = function (rows) {
    if (!rows || !rows.length) return;
    const unpack = (e) => {
      if (!Array.isArray(e) || !e[0] || !Items.get(e[0])) return null;
      const s = { id: e[0], count: Math.max(1, e[1] | 0) };
      if (e[2]) s.dur = e[2];
      return s;
    };
    for (const r of rows) {
      const f = this.furnaceAt(r[0], r[1], r[2]);
      f.input[0] = unpack(r[3]);
      f.fuel[0] = unpack(r[4]);
      f.output[0] = unpack(r[5]);
      f.burn = r[6] || 0;
      f.burnMax = r[7] || 0;
      f.cook = r[8] || 0;
    }
  };

  Game.restoreMe = function () {
    this._restoredPos = false;
    const saved = Store.ok ? Store.loadPlayer(this.worldKey) : null;
    if (!saved) return;

    const inv = this.inventory;
    inv.deserialize(inv.slots, saved.slots);
    inv.deserialize(inv.armor, saved.armor);
    inv.selected = Math.max(0, Math.min(InventoryConst.HOTBAR_SIZE - 1, saved.selected | 0));

    const p = this.player;
    if (saved.health > 0) p.health = Math.min(p.maxHealth, saved.health);
    if (typeof saved.food === 'number') p.food = saved.food;
    if (typeof saved.air === 'number') p.air = saved.air;
    if (typeof saved.x === 'number' && typeof saved.y === 'number') {
      p.pos.x = saved.x;
      p.pos.y = saved.y;
      p.pos.z = saved.z;
      p.yaw = saved.yaw || 0;
      p.pitch = saved.pitch || 0;
      p.fallStartY = p.pos.y;
      this._restoredPos = true;
    }
    inv.changed();
    this._restored = true;
  };

  Game.savedWorldFor = function (key, seed) {
    if (!Store.ok) return null;
    const saved = Store.loadWorld(key);
    if (!saved || !saved.edits.length) return null;
    if (seed !== undefined && saved.seed !== seed) return null;
    return saved;
  };

  Game.blockedAt = function (pos) {
    const x = Math.floor(pos.x), z = Math.floor(pos.z), y = Math.floor(pos.y);
    if (y < 0 || y >= WorldConst.WORLD_HEIGHT - 2) return true;
    for (let i = 0; i < 2; i++) {
      const id = this.world.getBlock(x, y + i, z);
      if (id !== B.AIR && B.byId[id].solid) return true;
    }
    return false;
  };

  // I remember this room's world and the host opened it empty, so offer mine
  Game.offerRestore = function (hostEdits, hostSavedAt) {
    const saved = this.savedWorldFor(this.worldKey, this.seed);
    if (!saved) return;
    if (hostEdits > 0) return;
    if ((saved.savedAt || 0) <= (hostSavedAt || 0)) return;
    Net.sendRestore(saved.savedAt, saved.edits);
  };

  Game.onRestore = function (fromId, msg) {
    if (!Net.isHost || this.editMap.size > 0) return;
    if (!msg.edits || !msg.edits.length) return;
    if ((msg.savedAt || 0) <= (this.worldSavedAt || 0)) return;
    const who = Net.players[fromId] ? Net.players[fromId].name : '누군가';
    this.worldSavedAt = msg.savedAt;
    this.applyEditBatch(msg.edits);
    this._worldDirty = true;
    Net.broadcastBulk(msg.edits, who);
    Net.sendSystem(who + ' 님의 기록으로 이전 세계를 복원했어요');
  };

  Game.onBulk = function (edits, by) {
    if (!edits || !edits.length) return;
    this.applyEditBatch(edits);
    this._worldDirty = true;
    if (by) UI.toast(by + ' 님의 기록으로 세계가 복원됐어요', 3200);
  };

  // ------------------------------------------------------------ other players
  Game.nameTag = function (text) {
    const pad = 8;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = 'bold 28px sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    c.width = Math.max(48, w);
    c.height = 44;
    const g = c.getContext('2d');
    g.font = 'bold 28px sans-serif';
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.fillText(text, pad, c.height / 2 + 1);
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(c.width / 44 * 0.45, 0.45, 1);
    sprite.position.y = 2.15;
    sprite.renderOrder = 10;
    return sprite;
  };

  Game.makeAvatar = function (name) {
    const group = new THREE.Group();
    const box = (w, h, d, color, x, y, z, parent) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshBasicMaterial({ color })
      );
      mesh.position.set(x, y, z);
      (parent || group).add(mesh);
      return mesh;
    };

    box(0.22, 0.7, 0.22, 0x3b4396, -0.12, 0.35, 0);
    box(0.22, 0.7, 0.22, 0x3b4396, 0.12, 0.35, 0);
    box(0.5, 0.7, 0.26, 0x2f9fa8, 0, 1.05, 0);
    box(0.18, 0.66, 0.2, 0x2f9fa8, -0.34, 1.05, 0);
    box(0.18, 0.66, 0.2, 0x2f9fa8, 0.34, 1.05, 0);

    const head = new THREE.Group();
    head.position.y = 1.62;
    group.add(head);
    box(0.46, 0.46, 0.46, 0xc99b7c, 0, 0, 0, head);
    box(0.47, 0.16, 0.47, 0x3b2a1c, 0, 0.17, 0, head);
    box(0.08, 0.08, 0.02, 0xffffff, -0.11, 0.02, -0.24, head);
    box(0.08, 0.08, 0.02, 0xffffff, 0.11, 0.02, -0.24, head);

    group.add(this.nameTag(name));
    group.userData.head = head;
    return group;
  };

  Game.clearAvatars = function () {
    for (const id in this.avatars) this.scene.remove(this.avatars[id].group);
    this.avatars = {};
  };

  Game.updateAvatars = function (dt) {
    if (!Net.active) {
      if (Object.keys(this.avatars).length) this.clearAvatars();
      return;
    }

    for (const id in Net.players) {
      const p = Net.players[id];
      let a = this.avatars[id];
      if (!a || a.name !== p.name) {
        if (a) this.scene.remove(a.group);
        const group = this.makeAvatar(p.name);
        group.userData.playerId = id;
        group.position.set(p.x, p.y, p.z);
        this.scene.add(group);
        a = this.avatars[id] = { group, name: p.name };
      }
      // smooth over the ~12 updates a second that arrive from the network
      const k = Math.min(1, dt * 12);
      a.group.position.x += (p.x - a.group.position.x) * k;
      a.group.position.y += (p.y - a.group.position.y) * k;
      a.group.position.z += (p.z - a.group.position.z) * k;
      a.group.rotation.y = p.yaw;
      a.group.userData.head.rotation.x = Math.max(-1.2, Math.min(1.2, -p.pitch));
    }

    for (const id in this.avatars) {
      if (Net.players[id]) continue;
      this.scene.remove(this.avatars[id].group);
      delete this.avatars[id];
    }
  };

  // ------------------------------------------------------------ multiplayer
  Game.netHandlers = function () {
    return {
      getDayTime: () => this.dayTime,
      getSpawn: () => this.spawnPoint,
      getEdits: () => this.editList(),
      getSavedAt: () => this.worldSavedAt || 0,
      onRestore: (id, msg) => this.onRestore(id, msg),
      onBulk: (edits, by) => this.onBulk(edits, by),
      onEdit: (msg) => this.applyRemoteEdit(msg),
      onRoster: () => UI.renderRoom(),
      onChat: (from, text, sys) => UI.addChat(from, text, sys),
      onHit: (msg) => this.takeHit(msg),
      onMobHit: (msg) => this.onMobHit(msg),
      onMobs: (rows) => Mobs.applyRemote(rows),
      onTime: (t) => { this.dayTime = t; },
      onSleep: (id) => {
        if (!Net.isHost) return;
        if (this.dayTime > 0.22 && this.dayTime < 0.78) return;
        this.setDayTime(0.24);
        const who = Net.players[id] ? Net.players[id].name : '누군가';
        Net.sendSystem(who + ' 님이 잠을 자 아침이 되었습니다');
      },
      onPlayerJoin: (id, p) => { UI.addChat(null, p.name + ' 님이 참여했어요', true); UI.renderRoom(); },
      onPlayerLeave: (id, p) => { UI.addChat(null, (p ? p.name : '플레이어') + ' 님이 나갔어요', true); UI.renderRoom(); },
      onDisconnect: () => { UI.toast('방 연결이 끊어졌어요', 4000); this.clearAvatars(); UI.renderRoom(); },
      onHostClosed: () => { UI.toast('방장이 방을 닫았어요', 4000); this.clearAvatars(); UI.renderRoom(); }
    };
  };

  Game.hostRoom = function (mode, seedText, code, name) {
    const typed = seedText && String(seedText).trim();
    const key = 'r:' + code;
    // no seed typed means "open the room I had before", if this browser kept it
    const saved = typed ? this.savedWorldFor(key, this.hashSeed(typed)) : this.savedWorldFor(key);
    const seed = saved ? saved.seed : this.hashSeed(seedText);
    const handlers = this.netHandlers();
    handlers.onReady = () => {
      UI.setNetStatus('');
      UI.toast('방이 열렸어요. 코드: ' + code, 5000);
      UI.renderRoom();
    };
    handlers.onError = (err) => {
      Net.reset();
      UI.setNetStatus(UI.netErrorText(err));
      UI.renderRoom();
    };
    Net.createRoom(code, name, { seed, mode }, handlers);
    this.start(mode, seedText, {
      seed, room: code,
      edits: saved ? saved.edits : null,
      entities: saved ? saved.entities : null,
      savedAt: saved ? saved.savedAt : 0
    });
    if (saved) UI.toast('저장해 둔 이 방의 세계를 불러왔어요', 3000);
  };

  Game.publicRoom = function (code) {
    for (const mode in PUBLIC_ROOMS) {
      if (PUBLIC_ROOMS[mode].code === code) return PUBLIC_ROOMS[mode];
    }
    return null;
  };

  Game.enterPublic = function (mode) {
    const room = PUBLIC_ROOMS[mode];
    if (!room) return;
    UI.hideMenu();
    UI.setLoading(true, '공개 서버를 찾는 중...');
    this._publicTries = 0;
    this._joinPublic(room, mode);
  };

  Game._joinPublic = function (room, mode) {
    this._publicTries++;
    const name = UI.playerName();
    const handlers = this.netHandlers();
    handlers.onWelcome = (msg) => this.onWelcome(msg, room.code);
    handlers.onError = (err) => {
      const nobodyHome = err === 'peer-unavailable' || err === 'timeout';
      if (nobodyHome && this._publicTries <= 3) {
        UI.setLoading(true, '아무도 없어서 내가 방을 엽니다...');
        this._hostPublic(room, mode);
        return;
      }
      this._publicFailed(err);
    };
    Net.joinRoom(room.code, name, handlers);
  };

  Game._hostPublic = function (room, mode) {
    this._publicTries++;
    const name = UI.playerName();
    const handlers = this.netHandlers();
    handlers.onReady = () => {
      UI.setNetStatus('');
      const saved = this.savedWorldFor('r:' + room.code, room.seed);
      this.start(mode, '', {
        seed: room.seed, room: room.code,
        edits: saved ? saved.edits : null,
        entities: saved ? saved.entities : null,
        savedAt: saved ? saved.savedAt : 0
      });
      UI.toast(saved
        ? '공개 서버를 열었습니다. 저장해 둔 세계를 불러왔어요.'
        : '공개 서버를 열었습니다. 누구나 들어올 수 있어요.', 4000);
      UI.renderRoom();
    };
    handlers.onError = (err) => {
      // someone opened it a moment before us, so join theirs instead
      if (err === 'unavailable-id' && this._publicTries <= 3) {
        UI.setLoading(true, '공개 서버에 접속하는 중...');
        this._joinPublic(room, mode);
        return;
      }
      this._publicFailed(err);
    };
    Net.createRoom(room.code, name, { seed: room.seed, mode }, handlers);
  };

  Game._publicFailed = function (err) {
    Net.reset();
    UI.setLoading(false);
    UI.showMenu();
    UI.setNetStatus(UI.netErrorText(err));
  };

  Game.onWelcome = function (msg, code) {
    this.start(msg.mode, '', {
      seed: msg.seed, edits: msg.edits, dayTime: msg.dayTime,
      room: code, savedAt: msg.savedAt
    });
    if (msg.spawn) {
      this.spawnPoint = msg.spawn;
      // where I logged out beats the room's spawn point
      if (!this._restoredPos) {
        this.player.pos.x = msg.spawn.x;
        this.player.pos.y = msg.spawn.y + 1;
        this.player.pos.z = msg.spawn.z;
      }
    }
    this.offerRestore((msg.edits ? msg.edits.length : 0) / 4, msg.savedAt || 0);
    const room = this.publicRoom(code);
    UI.toast(room ? room.label + ' 에 접속했어요' : '방 ' + code + ' 에 참여했어요', 3000);
    UI.renderRoom();
  };

  Game.joinRoom = function (code, name) {
    UI.hideMenu();
    UI.setLoading(true, '방에 접속하는 중...');
    const handlers = this.netHandlers();
    handlers.onWelcome = (msg) => this.onWelcome(msg, code);
    handlers.onError = (err) => {
      Net.reset();
      UI.setLoading(false);
      UI.showMenu();
      UI.setNetStatus(UI.netErrorText(err));
    };
    Net.joinRoom(code, name, handlers);
  };

  Game.leaveRoom = function () {
    this.saveNow(true);
    Net.leave();
    this.clearAvatars();
    UI.resetChat();
    UI.renderRoom();
    UI.toast('방에서 나왔어요', 2200);
  };

  Game.spawnPlayer = function () {
    const w = this.world;
    let sx = 0, sz = 0, sy = WorldConst.SEA_LEVEL + 1;
    let found = false;
    // spiral outwards until dry land turns up: a wide ocean around the origin
    // used to drop the player on the sea floor
    for (let r = 0; r < 26 && !found; r++) {
      const steps = r === 0 ? 1 : Math.min(24, 4 + r * 2);
      for (let a = 0; a < steps && !found; a++) {
        const ang = (a / steps) * Math.PI * 2 + r * 0.7;
        const x = Math.round(Math.cos(ang) * r * 8);
        const z = Math.round(Math.sin(ang) * r * 8);
        const y = w.groundY(x, z);
        if (y > WorldConst.SEA_LEVEL &&
            w.getBlock(x, y + 1, z) === B.AIR &&
            w.getBlock(x, y + 2, z) === B.AIR) {
          sx = x; sz = z; sy = y; found = true;
        }
      }
    }
    this.player.pos.x = sx + 0.5;
    this.player.pos.y = sy + 1.2;
    this.player.pos.z = sz + 0.5;
    this.player.vel.x = this.player.vel.y = this.player.vel.z = 0;
    this.player.fallStartY = this.player.pos.y;
    this.spawnPoint = { x: sx + 0.5, y: sy + 1.2, z: sz + 0.5 };
  };

  Game.toggleFly = function () {
    if (this.mode !== 'creative') return;
    this.player.flying = !this.player.flying;
    this.player.vel.y = 0;
    UI.setFlyButtons(this.mode, this.player.flying);
    UI.toast(this.player.flying ? '비행 모드 켜짐' : '비행 모드 꺼짐', 1400);
  };

  // ------------------------------------------------------------ interaction
  // Bedrock aims wherever the finger is, so every interaction casts through the
  // touch point rather than a fixed crosshair at the centre of the screen.
  Game.targetAt = function (screenX, screenY) {
    this._ndc = this._ndc || new THREE.Vector2();
    this._caster = this._caster || new THREE.Raycaster();
    this._ndc.set(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1
    );
    this._caster.setFromCamera(this._ndc, this.camera);
    return this.world.raycast(this._caster.ray.origin, this._caster.ray.direction, REACH);
  };

  Game.currentTarget = function () {
    return this.targetAt(Controls.state.pointX, Controls.state.pointY);
  };

  Game.tryPlace = function (screenX, screenY) {
    if (this.paused || !this.started || this.player.dead) return;
    if (screenX !== undefined && this.tryAttack(screenX, screenY)) return;
    const hit = screenX === undefined ? this.currentTarget() : this.targetAt(screenX, screenY);
    if (!hit) return;

    const targetDef = B.byId[hit.id];
    if (targetDef.interactive === 'craft') {
      UI.openScreen('crafting');
      return;
    }
    if (targetDef.interactive === 'furnace') {
      UI.openScreen('furnace', this.furnaceAt(hit.x, hit.y, hit.z));
      return;
    }
    if (targetDef.interactive === 'bed') {
      this.useBed(hit.x, hit.y, hit.z);
      return;
    }

    const stack = this.inventory.selectedStack();
    if (!stack) { UI.toast('손에 든 블록이 없어요', 1200); return; }
    if (this.tryEat(stack)) return;
    if (!Items.isBlock(stack.id)) { UI.toast(Items.name(stack.id) + '은(는) 설치할 수 없어요', 1400); return; }

    const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    const existing = this.world.getBlock(x, y, z);
    if (existing !== B.AIR && !B.byId[existing].liquid) return;
    if (this.intersectsPlayer(x, y, z)) return;

    if (this.changeBlock(x, y, z, stack.id)) {
      if (stack.id === B.FURNACE) this.furnaceAt(x, y, z);
      if (this.mode === 'survival') this.inventory.consumeSelected();
      else UI.renderHotbar();
    }
  };

  // ------------------------------------------------------------------ combat
  // the same ray answers "did I hit a monster" and "did I hit another player"
  Game.mobAt = function (screenX, screenY) {
    const groups = [];
    for (const m of Mobs.list) if (m.group) groups.push(m.group);
    if (!groups.length) return null;
    this._ndc = this._ndc || new THREE.Vector2();
    this._caster = this._caster || new THREE.Raycaster();
    this._ndc.set(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1
    );
    this._caster.setFromCamera(this._ndc, this.camera);
    this._caster.far = ATTACK_REACH;
    const hits = this._caster.intersectObjects(groups, true);
    this._caster.far = Infinity;
    if (!hits.length) return null;
    let node = hits[0].object;
    while (node && !node.userData.mobId) node = node.parent;
    if (!node) return null;
    return { mob: Mobs.byId(node.userData.mobId), distance: hits[0].distance };
  };

  Game.avatarAt = function (screenX, screenY) {
    const groups = [];
    for (const id in this.avatars) groups.push(this.avatars[id].group);
    if (!groups.length) return null;

    this._ndc = this._ndc || new THREE.Vector2();
    this._caster = this._caster || new THREE.Raycaster();
    this._ndc.set(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1
    );
    this._caster.setFromCamera(this._ndc, this.camera);
    this._caster.far = ATTACK_REACH;
    const hits = this._caster.intersectObjects(groups, true);
    this._caster.far = Infinity;
    if (!hits.length) return null;

    let node = hits[0].object;
    while (node && !node.userData.playerId) node = node.parent;
    if (!node) return null;
    return { id: node.userData.playerId, distance: hits[0].distance };
  };

  Game.tryAttack = function (screenX, screenY) {
    const now = performance.now();
    if (now - (this._lastAttack || 0) < 450) return false;
    if (this.attackMob(screenX, screenY, now)) return true;
    if (!Net.active) return false;

    const target = this.avatarAt(screenX, screenY);
    if (!target) return false;

    // a wall between us blocks the swing
    const block = this.targetAt(screenX, screenY);
    if (block && block.dist < target.distance) return false;

    const victim = Net.players[target.id];
    if (!victim) return false;
    this._lastAttack = now;

    const stack = this.inventory.selectedStack();
    const def = stack ? Items.get(stack.id) : null;
    const damage = def && def.damage ? def.damage : 1;

    const p = this.player;
    let kx = victim.x - p.pos.x, kz = victim.z - p.pos.z;
    const len = Math.hypot(kx, kz) || 1;
    kx /= len; kz /= len;

    Net.sendHit(target.id, damage, kx, kz);
    if (def && def.tool && this.mode === 'survival') this.inventory.damageSelected(1);
    UI.toast(victim.name + ' 을(를) 공격! (' + damage + ')', 900);
    return true;
  };

  Game.attackMob = function (screenX, screenY, now) {
    const target = this.mobAt(screenX, screenY);
    if (!target || !target.mob) return false;

    // a wall between us blocks the swing
    const block = this.targetAt(screenX, screenY);
    if (block && block.dist < target.distance) return false;

    this._lastAttack = now;
    const mob = target.mob;
    const stack = this.inventory.selectedStack();
    const def = stack ? Items.get(stack.id) : null;
    const damage = def && def.damage ? def.damage : 1;

    const kx = mob.x - this.player.pos.x, kz = mob.z - this.player.pos.z;
    const len = Math.hypot(kx, kz) || 1;

    if (Net.active && !Net.isHost) {
      Net.sendMobHit(mob.id, damage, kx / len, kz / len);
      mob.hurtFlash = 0.3;
    } else {
      this.damageMob(mob, damage, kx / len, kz / len);
    }
    if (def && def.tool && this.mode === 'survival') this.inventory.damageSelected(1);
    return true;
  };

  Game.damageMob = function (mob, damage, kx, kz) {
    if (!mob || mob.dead) return;
    mob.hurt(damage);
    mob.x += kx * 0.45;
    mob.z += kz * 0.45;
    if (mob.onGround) mob.vy = 5.2;
    if (mob.dead) {
      Mobs.dropLoot(mob, this);
      Mobs.remove(mob);
    }
  };

  Game.onMobHit = function (msg) {
    if (!Net.isHost) return;
    this.damageMob(Mobs.byId(msg.mobId), msg.dmg || 1, msg.kx || 0, msg.kz || 0);
  };

  // a monster reaching a player: the host resolves it and tells the victim
  Game.mobAttack = function (mob, damage, kx, kz) {
    if (this.mode !== 'survival') return;
    const p = this.player;
    const near = Math.hypot(p.pos.x - mob.x, p.pos.z - mob.z) < (mob.def.reach || 3) + 1.4 ||
      mob.def.explodes;
    if (!near) return;
    p.hurt(damage);
    p.knockX = kx * 4;
    p.knockZ = kz * 4;
    if (p.onGround) p.vel.y = 4.6;
    this._lastAttacker = { name: mob.def.name, at: performance.now() };
  };

  Game.mobArrowHit = function (damage, kx, kz) {
    if (this.mode !== 'survival') return;
    const p = this.player;
    p.hurt(damage);
    p.knockX = kx * 2.4;
    p.knockZ = kz * 2.4;
    this._lastAttacker = { name: '스켈레톤', at: performance.now() };
  };

  Game.takeHit = function (msg) {
    const p = this.player;
    if (p.dead || this.mode !== 'survival') return;
    p.hurt(msg.dmg || 1);
    p.knockX = (msg.kx || 0) * 4;
    p.knockZ = (msg.kz || 0) * 4;
    if (p.onGround) p.vel.y = 4.6;
    this._lastAttacker = { name: msg.from, at: performance.now() };
  };

  Game.tryEat = function (stack) {
    const food = Items.foodOf(stack.id);
    if (!food) return false;
    if (performance.now() - (this._eatCooldown || 0) < 700) return true;
    if (this.mode === 'survival' && this.player.food >= 20) {
      UI.toast('배가 부릅니다', 1200);
      return true;
    }
    this._eatCooldown = performance.now();
    this.player.eat(food.food, food.saturation || 0);
    if (this.mode === 'survival') this.inventory.consumeSelected();
    UI.renderStats(this.player);
    UI.toast(Items.name(stack.id) + '을(를) 먹었습니다', 1200);
    return true;
  };

  // Sleeping runs the clock to dawn. In a room the host owns the time, so a
  // guest asks and everybody's sky moves together.
  Game.useBed = function (x, y, z) {
    const p = this.player;
    if (Math.hypot(p.pos.x - (x + 0.5), p.pos.z - (z + 0.5)) > 4) return;
    this.spawnPoint = { x: x + 0.5, y: y + 1.2, z: z + 0.5 };
    if (this.dayTime > 0.22 && this.dayTime < 0.78) {
      UI.toast('낮에는 잘 수 없어요. 부활 지점만 여기로 정했습니다.', 2600);
      return;
    }
    const monster = Mobs.list.some((m) => m.def.hostile &&
      Math.hypot(m.x - p.pos.x, m.z - p.pos.z) < 10);
    if (monster) { UI.toast('근처에 몬스터가 있어 잘 수 없어요', 2200); return; }

    if (Net.active && !Net.isHost) {
      Net.sendSleep();
      UI.toast('방장에게 아침을 요청했어요', 2000);
    } else {
      this.setDayTime(0.24);
      if (Net.active) Net.sendSystem(Net.name + ' 님이 잠을 자 아침이 되었습니다');
    }
    p.health = Math.min(p.maxHealth, p.health + 2);
    UI.renderStats(p);
  };

  Game.setDayTime = function (t) {
    this.dayTime = t;
    if (Net.active && Net.isHost) Net.sendTime(t);
  };

  Game.entityKey = function (x, y, z) { return x + ',' + y + ',' + z; };

  Game.furnaceAt = function (x, y, z) {
    const k = this.entityKey(x, y, z);
    let f = this.blockEntities.get(k);
    if (!f) {
      f = {
        type: 'furnace', x, y, z,
        input: [null], fuel: [null], output: [null],
        burn: 0, burnMax: 0, cook: 0, cookMax: 10
      };
      this.blockEntities.set(k, f);
    }
    return f;
  };

  Game.updateFurnaces = function (dt) {
    if (this.blockEntities.size === 0) return;
    const open = UI.screen && UI.screen.kind === 'furnace' ? UI.screen.entity : null;
    let openChanged = false;

    for (const f of this.blockEntities.values()) {
      if (f.type !== 'furnace') continue;
      const input = f.input[0];
      const result = input ? Recipes.smelting[input.id] : undefined;
      const out = f.output[0];
      const canCook = result !== undefined &&
        (!out || (out.id === result && out.count < Items.stackMax(result)));

      let active = false;
      if (f.burn > 0) { f.burn -= dt; active = true; }

      if (f.burn <= 0 && canCook && f.fuel[0]) {
        const secs = Items.fuelSeconds(f.fuel[0].id);
        if (secs > 0) {
          f.burn = secs;
          f.burnMax = secs;
          f.fuel[0].count -= 1;
          if (f.fuel[0].count <= 0) f.fuel[0] = null;
          active = true;
        }
      }

      if (f.burn > 0 && canCook) {
        f.cook += dt;
        if (f.cook >= f.cookMax) {
          f.cook = 0;
          input.count -= 1;
          if (input.count <= 0) f.input[0] = null;
          if (f.output[0]) f.output[0].count += 1;
          else f.output[0] = { id: result, count: 1 };
        }
      } else if (f.cook > 0) {
        f.cook = Math.max(0, f.cook - dt * 2);
      }

      const lit = f.burn > 0;
      if (lit !== f.lit) {
        f.lit = lit;
        const here = this.world.getBlock(f.x, f.y, f.z);
        if (here === B.FURNACE || here === B.FURNACE_LIT) {
          // through changeBlock so the glow is saved and the room sees it too
          this.changeBlock(f.x, f.y, f.z, lit ? B.FURNACE_LIT : B.FURNACE);
        }
      }
      if (f === open && (active || f.cook > 0)) openChanged = true;
    }

    if (openChanged) {
      this._furnaceUiTimer = (this._furnaceUiTimer || 0) + dt;
      if (this._furnaceUiTimer > 0.2) {
        this._furnaceUiTimer = 0;
        // a full re-render would swap out the node a drag is holding on to
        UI.refreshFurnace();
      }
    }
  };

  Game.spawnDropAtPlayer = function (id, count) {
    const p = this.player;
    this.spawnDrop(p.pos.x, p.pos.y + 0.8, p.pos.z, id, count);
  };

  Game.intersectsPlayer = function (x, y, z) {
    const p = this.player;
    const hw = PlayerConst.HALF_W, h = PlayerConst.HEIGHT;
    return (x + 1 > p.pos.x - hw && x < p.pos.x + hw &&
            y + 1 > p.pos.y && y < p.pos.y + h &&
            z + 1 > p.pos.z - hw && z < p.pos.z + hw);
  };

  Game.updateMining = function (dt) {
    const m = this.mining;
    if (!Controls.state.mining || this.paused || this.player.dead) {
      m.target = null;
      m.progress = 0;
      this.crackMesh.visible = false;
      return;
    }

    // Bedrock keeps breaking the block you grabbed while you walk and turn, so
    // the target is locked on the first frame instead of re-aimed every frame.
    if (!m.target) {
      const hit = this.targetAt(Controls.state.pointX, Controls.state.pointY);
      if (!hit) { this.crackMesh.visible = false; return; }
      m.target = { x: hit.x, y: hit.y, z: hit.z, id: hit.id };
      m.progress = 0;
    }

    const here = this.world.getBlock(m.target.x, m.target.y, m.target.z);
    if (here !== m.target.id) {
      m.target = null;
      m.progress = 0;
      this.crackMesh.visible = false;
      return;
    }

    const p = this.player;
    const dx = m.target.x + 0.5 - p.pos.x;
    const dy = m.target.y + 0.5 - p.eyeY();
    const dz = m.target.z + 0.5 - p.pos.z;
    const maxDist = REACH + 1.5;
    if (dx * dx + dy * dy + dz * dz > maxDist * maxDist) {
      m.target = null;
      m.progress = 0;
      this.crackMesh.visible = false;
      return;
    }

    // walking and small turns keep the break going, but looking away drops it
    if (Controls.cancelMineOnLook()) {
      const len = Math.hypot(dx, dy, dz) || 1;
      this._look = this._look || { x: 0, y: 0, z: 0 };
      p.lookDir(this._look);
      const facing = (dx * this._look.x + dy * this._look.y + dz * this._look.z) / len;
      if (facing < 0.55) {
        m.target = null;
        m.progress = 0;
        this.crackMesh.visible = false;
        return;
      }
    }

    const stack = this.inventory.selectedStack();
    const toolDef = stack ? Items.get(stack.id) : null;
    const seconds = this.mode === 'creative' ? 0.12 : B.mineTime(here, toolDef);
    if (!isFinite(seconds)) {
      this.crackMesh.visible = false;
      return;
    }

    m.progress += dt / seconds;
    if (m.progress >= 1) {
      this.breakBlock(m.target.x, m.target.y, m.target.z, here);
      m.target = null;
      m.progress = 0;
      this.crackMesh.visible = false;
      return;
    }

    const stage = Math.min(3, Math.floor(m.progress * 4));
    this.crackMaterial.map = Textures.crackTextures[stage];
    this.crackMaterial.needsUpdate = true;
    this.crackMesh.position.set(m.target.x + 0.5, m.target.y + 0.5, m.target.z + 0.5);
    this.crackMesh.visible = true;
  };

  Game.breakBlock = function (x, y, z, id) {
    const stack = this.inventory.selectedStack();
    const toolDef = stack ? Items.get(stack.id) : null;
    if (!this.changeBlock(x, y, z, B.AIR)) return;

    const entity = this.blockEntities.get(this.entityKey(x, y, z));
    if (entity) {
      this.blockEntities.delete(this.entityKey(x, y, z));
      if (this.mode === 'survival') {
        for (const arr of [entity.input, entity.fuel, entity.output]) {
          if (arr[0]) this.spawnDrop(x + 0.5, y + 0.5, z + 0.5, arr[0].id, arr[0].count);
        }
      }
      if (UI.screen && UI.screen.entity === entity) UI.closeScreen();
    }

    if (this.mode === 'survival') {
      if (B.canHarvest(id, toolDef)) {
        const drop = B.byId[id].drop;
        if (drop) this.spawnDrop(x + 0.5, y + 0.3, z + 0.5, drop, 1);
        // oak leaves occasionally give an apple, the first food you can find
        if (id === B.LEAVES && Math.random() < 0.06) {
          this.spawnDrop(x + 0.5, y + 0.3, z + 0.5, Items.APPLE, 1);
        }
      }
      if (toolDef && toolDef.tool && this.inventory.damageSelected(1)) {
        UI.toast('도구가 부서졌어요', 1600);
      }
      this.player.addExhaustion(0.005);
    }
  };

  // ------------------------------------------------------------ dropped items
  Game.spawnDrop = function (x, y, z, id, count) {
    const mesh = new THREE.Mesh(this.blockGeometry(id, 0.28), this.itemMaterial);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.drops.push({ mesh, id, count, vy: 1.2, age: 0, x, y, z });
  };

  Game.clearDrops = function () {
    for (const d of this.drops) this.scene.remove(d.mesh);
    this.drops.length = 0;
  };

  Game.updateDrops = function (dt) {
    const p = this.player;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.vy -= 22 * dt;
      let ny = d.y + d.vy * dt;
      const below = this.world.getBlock(Math.floor(d.x), Math.floor(ny - 0.14), Math.floor(d.z));
      if (below !== B.AIR && B.byId[below].solid) {
        ny = Math.floor(ny - 0.14) + 1.14;
        d.vy = 0;
      }
      d.y = ny;

      const dist = Math.hypot(d.x - p.pos.x, d.y - (p.pos.y + 0.9), d.z - p.pos.z);
      // Minecraft only reaches about a block: anything further stays put
      if (d.age > 0.4 && dist < PICKUP_PULL) {
        const pull = Math.min(1, (PICKUP_PULL - dist) / PICKUP_PULL + 0.25) * 9 * dt;
        d.x += (p.pos.x - d.x) * pull;
        d.z += (p.pos.z - d.z) * pull;
        d.y += (p.pos.y + 0.6 - d.y) * pull;
      }
      if (d.age > 0.4 && dist < PICKUP_RANGE) {
        const pulled = this.inventory.add(d.id, d.count);
        if (pulled > 0) {
          this.scene.remove(d.mesh);
          this.drops.splice(i, 1);
          continue;
        }
      }
      if (d.age > 300) {
        this.scene.remove(d.mesh);
        this.drops.splice(i, 1);
        continue;
      }

      d.mesh.position.set(d.x, d.y + Math.sin(d.age * 2.4) * 0.05, d.z);
      d.mesh.rotation.y += dt * 1.6;
    }
  };

  // ------------------------------------------------------------ environment
  Game.updateSky = function (dt) {
    this.dayTime = (this.dayTime + dt / DAY_LENGTH) % 1;
    const t = this.dayTime;
    const sunAngle = t * Math.PI * 2 - Math.PI / 2;
    const height = Math.sin(sunAngle);

    const daylight = THREE.MathUtils.clamp(height * 1.6 + 0.35, 0, 1);
    const duskAmount = THREE.MathUtils.clamp(1 - Math.abs(height) * 4.5, 0, 1) * (daylight > 0.05 ? 1 : 0);

    const sky = SKY_NIGHT.clone().lerp(SKY_DAY, daylight).lerp(SKY_DUSK, duskAmount * 0.55);
    this.scene.background = sky;
    this.fog.color.copy(sky);

    const brightness = 0.18 + daylight * 0.82;
    this.world.material.color.setScalar(brightness);
    this.world.liquidMaterial.color.setScalar(brightness);
    this.itemMaterial.color.setScalar(Math.min(1, brightness + 0.15));

    if (this.player.headInWater) {
      this.fog.near = 0.1;
      this.fog.far = 14;
      this.fog.color.setHex(0x2c5ca8);
      this.scene.background = new THREE.Color(0x2c5ca8);
    } else {
      const far = this.world.renderDistance * WorldConst.CHUNK_SIZE - 8;
      this.fog.far = far;
      this.fog.near = far * 0.62;
    }
  };

  Game.respawn = function (mode) {
    if (Net.active) mode = this.mode;
    if (mode && mode !== this.mode) {
      this.mode = mode;
      this.player.mode = mode;
      this.player.flying = mode === 'creative';
      UI.setFlyButtons(mode, this.player.flying);
    }
    const p = this.player;
    p.dead = false;
    this._deathHandled = false;
    p.health = p.maxHealth;
    p.food = 20;
    p.saturation = 5;
    p.exhaustion = 0;
    p.air = PlayerConst.MAX_AIR;
    p.vel.x = p.vel.y = p.vel.z = 0;
    p.pos.x = this.spawnPoint.x;
    p.pos.y = this.spawnPoint.y;
    p.pos.z = this.spawnPoint.z;
    p.fallStartY = p.pos.y;
    UI.hideDeath();
    UI.renderStats(p);
    this.paused = false;
  };

  Game.onDeath = function () {
    if (this.mode === 'survival') {
      const p = this.player;
      const all = this.inventory.slots.concat(this.inventory.armor, this.inventory.craft);
      if (this.inventory.held) all.push(this.inventory.held);
      for (const stack of all) {
        if (stack) this.spawnDrop(p.pos.x, p.pos.y + 0.5, p.pos.z, stack.id, stack.count);
      }
      this.inventory.clear();
      if (UI.screen) UI.closeScreen();
    }
    if (Net.active) {
      const killer = this._lastAttacker;
      const recent = killer && performance.now() - killer.at < 8000;
      Net.sendSystem(recent
        ? Net.name + ' 님이 ' + killer.name + ' 님에게 당했습니다'
        : Net.name + ' 님이 사망했습니다');
    }
    this._lastAttacker = null;
    this.saveNow(false);
    UI.showDeath();
  };

  // ------------------------------------------------------------ loop
  Game.loop = function () {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min((now - (this._last || now)) / 1000, 0.1);
    this._last = now;

    this._fpsAcc = (this._fpsAcc || 0) + dt;
    this._fpsFrames = (this._fpsFrames || 0) + 1;
    if (this._fpsAcc >= 0.5) {
      this._fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }

    if (!this.started) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const p = this.player;

    if (this.loading) {
      const pending = this.world.update(p.pos.x, p.pos.z, 26);
      UI.setLoading(true, '세계를 만드는 중... 남은 청크 ' + pending);
      if (pending === 0) {
        this.loading = false;
        UI.setLoading(false);
        UI.toast(this.mode === 'survival'
          ? '블록을 꾹 누르면 그 블록을 캐고, 톡 누르면 그 자리에 블록을 놓습니다'
          : '크리에이티브: 비행 버튼으로 날 수 있어요. 블록을 눌러 캐고 놓으세요', 4600);
        const sg = this.world.groundY(Math.floor(this.spawnPoint.x), Math.floor(this.spawnPoint.z));
        if (sg >= 0) this.spawnPoint.y = sg + 1.2;
        // a restored position is kept unless the world moved under it
        if (!this._restoredPos || this.blockedAt(p.pos)) {
          const g = this.world.groundY(Math.floor(p.pos.x), Math.floor(p.pos.z));
          // never settle onto a sea floor: that spot is water, not standing room
          if (g >= 0 && this.world.getBlock(Math.floor(p.pos.x), g + 1, Math.floor(p.pos.z)) === B.AIR) {
            p.pos.y = g + 1.2;
            p.vel.y = 0;
            p.fallStartY = p.pos.y;
          }
        }
        if (this._restored) {
          UI.toast('저장된 내 인벤토리를 불러왔어요', 3000);
          this._restored = false;
        }
      }
      this.syncCamera();
      this.renderer.render(this.scene, this.camera);
      return;
    }

    Controls.tickHold();
    const look = Controls.consumeLook();
    const sens = Controls.lookSens();
    p.yaw -= look.x * sens;
    p.pitch -= look.y * sens;
    p.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p.pitch));

    if (!this.paused && !p.dead) {
      p.update(dt, Controls.state, this.world);
      this.updateMining(dt);
      this.updateDrops(dt);
    }
    if (this.started && !this.loading) this.updateFurnaces(dt);

    // checked every frame so any damage source, not just Player.update, ends the run
    if (p.dead && !this._deathHandled) {
      this._deathHandled = true;
      this.onDeath();
    }

    this.world.update(p.pos.x, p.pos.z, 6);
    this.saveTick(dt);
    this.updateSky(dt);
    if (!this.paused) Mobs.update(dt, this.world, p, this);
    if (Net.active) {
      Net.sendPos(p);
      if (Net.isHost) Net.sendMobs(Mobs.snapshot());
    }
    this.updateAvatars(dt);

    const aim = this.mining.target;
    if (aim && !this.paused && !p.dead) {
      this.selectionBox.visible = true;
      this.selectionBox.position.set(aim.x + 0.5, aim.y + 0.5, aim.z + 0.5);
    } else {
      this.selectionBox.visible = false;
    }

    UI.renderStats(p);
    UI.setOverlay('damageOverlay', p.hurtFlash > 0 ? p.hurtFlash * 0.9 : 0);
    UI.setOverlay('waterOverlay', p.headInWater ? 0.35 : 0);
    UI.setDebug([
      'FPS ' + (this._fps || 0),
      'XYZ ' + p.pos.x.toFixed(1) + ' / ' + p.pos.y.toFixed(1) + ' / ' + p.pos.z.toFixed(1),
      '청크 ' + this.world.chunks.size + '   드롭 ' + this.drops.length + '   몹 ' + Mobs.list.length,
      '시드 ' + this.seed,
      '시간 ' + Math.floor(this.dayTime * 24) + '시',
      '모드 ' + (this.mode === 'survival' ? '서바이벌' : '크리에이티브')
    ]);

    this.syncCamera();
    this.renderer.render(this.scene, this.camera);
  };

  Game.syncCamera = function () {
    const p = this.player;
    this.camera.position.set(p.pos.x, p.eyeY(), p.pos.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  };

  // ------------------------------------------------------------ bootstrap
  Game.boot = function () {
    Settings.load();
    this.initRenderer();
    UI.init(this);

    Controls.init({
      joystick: el('joystickZone'),
      joyVisual: el('joyVisual'),
      knob: el('joystickKnob'),
      worldZone: el('worldZone'),
      jumpBtn: el('btnJump'),
      upBtn: el('btnFlyUp'),
      downBtn: el('btnFlyDown'),
      onTap: (x, y) => this.tryPlace(x, y),
      hooks: {
        onHotbar: (i) => { if (this.started) { this.inventory.selected = i; UI.renderHotbar(); } },
        onInventory: () => { if (this.started) UI.toggleInventory(); },
        onDrop: () => this.dropSelected(),
        onChat: () => { if (Net.active) UI.openChat(); },
        onFly: () => this.toggleFly(),
        onEscape: () => UI.onEscape(),
        onScroll: (dir) => {
          if (!this.started) return;
          const n = InventoryConst.HOTBAR_SIZE;
          this.inventory.selected = (this.inventory.selected + dir + n) % n;
          UI.renderHotbar();
        },
        onKeyboardMode: () => UI.showKeyboardHint()
      }
    });

    document.querySelectorAll('[data-start-mode]').forEach((btn) => {
      Controls.bindTap(btn, () => this.startSolo(btn.dataset.startMode, el('seedInput').value));
    });

    // the tab can vanish without warning on mobile, so write the save out then
    const flush = () => this.saveNow(true);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    document.querySelectorAll('[data-respawn-mode]').forEach((btn) => {
      Controls.bindTap(btn, () => this.respawn(btn.dataset.respawnMode));
    });

    UI.showMenu();
    this.loop();
  };

  Game.dropSelected = function () {
    if (!this.started || this.paused) return;
    const inv = this.inventory;
    const stack = inv.selectedStack();
    if (!stack) return;
    const p = this.player;
    this._fwd = this._fwd || { x: 0, y: 0, z: 0 };
    p.forward(this._fwd);
    this.spawnDrop(
      p.pos.x + this._fwd.x * 1.2, p.pos.y + 1.1, p.pos.z + this._fwd.z * 1.2,
      stack.id, 1
    );
    inv.consumeSelected();
  };

  Game.PUBLIC_ROOMS = PUBLIC_ROOMS;

  global.Game = Game;
  window.addEventListener('load', () => Game.boot());
})(window);
