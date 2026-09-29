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
    // the hand is drawn in a second pass over the world, so clearing is manual
    this.renderer.autoClear = false;
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

    this.itemMaterial = new THREE.MeshBasicMaterial({ map: Textures.texture, alphaTest: 0.5 });
    Sky.init(this.scene);
    Hand.init(this);
    Entities.init(this);
    Mobs.lightFn = (x, y, z) => this.lightAtPoint(x, y, z);
    Entities.onChange = (boat, op) => {
      if (!Net.active) return;
      Net.sendBoat({ op, id: boat.id, x: +boat.x.toFixed(2), y: +boat.y.toFixed(2), z: +boat.z.toFixed(2), yaw: +boat.yaw.toFixed(2), rider: boat.rider });
      this._worldDirty = true;
    };
  };

  Game.render = function (withHand) {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (withHand) Hand.render(r);
  };

  // one ray through a screen point, shared by every "what am I touching" test
  Game.rayFrom = function (screenX, screenY) {
    this._ndc = this._ndc || new THREE.Vector2();
    this._caster = this._caster || new THREE.Raycaster();
    this._ndc.set(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1
    );
    this._caster.setFromCamera(this._ndc, this.camera);
    return this._caster;
  };

  Game.distTo = function (x, y, z) {
    const p = this.player;
    if (!p) return 0;
    return Math.hypot(x + 0.5 - p.pos.x, y + 0.5 - p.eyeY(), z + 0.5 - p.pos.z);
  };

  // how bright a spot is, on the same curve the terrain shader uses
  Game.lightAtPoint = function (x, y, z) {
    if (!this.world) return 1;
    let fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    // a point inside a solid block has no light of its own: use the cell above
    for (let i = 0; i < 2; i++) {
      const id = this.world.getBlock(fx, fy, fz);
      if (id === B.AIR || !B.byId[id].opaque) break;
      fy++;
    }
    const l = this.world.lightAt(fx, fy, fz);
    const day = World.lightUniforms.uDaylight.value;
    const curve = (f) => f / (2.3 - 1.3 * f);
    return Math.max(curve(l.sky / 15 * day), curve(l.blk / 15), 0.08);
  };

  // how bright it is where the player's head is: used for held items and drops
  Game.lightHere = function (fallback) {
    if (!this.world || !this.player) return fallback;
    const p = this.player;
    return this.lightAtPoint(p.pos.x, p.eyeY(), p.pos.z);
  };

  // other players' avatars share the world's light too
  Game.shadeGroup = function (group, b) {
    group.traverse((n) => {
      if (!n.material || !n.material.color || n.isSprite) return;
      if (n.userData.base === undefined) n.userData.base = n.material.color.getHex();
      n.material.color.setHex(n.userData.base).multiplyScalar(b);
    });
  };

  Game.blockGeometry = function (id, size) {
    const key = id + ':' + size;
    if (this._geoCache[key]) return this._geoCache[key];
    // torches, flowers and seeds show as a flat sprite, not a tiny cube
    const isBlock = Items.isBlock(id) && B.byId[id].render !== 'cross';
    const geo = isBlock
      ? new THREE.BoxGeometry(size, size * (B.byId[id].height || 1), size)
      : new THREE.BoxGeometry(size, size, size * 0.14);
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const t = Textures.tileUV(isBlock ? B.tileFor(id, f) : Items.tileOf(id));
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

  Game.flatItemGeometry = function (id) {
    const key = 'flat:' + id;
    if (this._geoCache[key]) return this._geoCache[key];
    const geo = new THREE.BoxGeometry(0.5, 0.5, 0.035);
    const uv = geo.attributes.uv;
    const t = Textures.tileUV(Items.tileOf(id));
    for (let f = 0; f < 6; f++) {
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
    Entities.clear();
    this.crops = new Set();
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
    this.inventory.onChange = () => {
      UI.renderHotbar();
      if (UI.screen && UI.screen.kind === 'chest') this.syncChest(UI.screen.entity);
    };
    this.bedSpawn = null;

    this.player = new Player(mode);
    this.player.armorProvider = this.inventory;
    this.player.onHurt = () => Sound.hurt();
    this.player.xp = 0;

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
    this._cropTimer = 0;
    this._stepDist = 0;
    this.eating = null;
    Fluids.clear();
    UI.renderXp(this.player);
    UI.setSneak(false);
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
    // growing wheat, so the farm keeps ticking without scanning the world
    if (!this.crops) this.crops = new Set();
    const def = B.byId[id];
    if (def && def.crop !== undefined && def.crop < 3) this.crops.add(key);
    else this.crops.delete(key);
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
      if (B.byId[id] && B.byId[id].light) chunk.hasLight = true;
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
    this.blockUpdate(x, y, z);
    Fluids.touch(this.world, x, y, z);
    return true;
  };

  Game.applyRemoteEdit = function (msg) {
    this.registerEdit(msg.x, msg.y, msg.z, msg.id);
    this.world.setBlock(msg.x, msg.y, msg.z, msg.id);
    const key = this.entityKey(msg.x, msg.y, msg.z);
    if (msg.id === B.AIR && this.blockEntities.has(key)) this.blockEntities.delete(key);
    if (msg.id === B.FURNACE) this.furnaceAt(msg.x, msg.y, msg.z);
    if (msg.id === B.CHEST) this.chestAt(msg.x, msg.y, msg.z);
    // the host runs the water for everyone, so a guest's change wakes it here
    if (Net.isHost) Fluids.touch(this.world, msg.x, msg.y, msg.z);
  };

  // ------------------------------------------------------------ block updates
  // What Minecraft calls block updates: a change pokes its neighbours, so a
  // flower loses its footing, a torch falls off the wall and sand drops.
  Game.isSupported = function (x, y, z, id) {
    const def = B.byId[id];
    const below = this.world.getBlock(x, y - 1, z);
    if (def.crop !== undefined) return below === B.FARMLAND;
    if (def.door) {
      if (def.door.upper) { const b = B.byId[below]; return !!(b && b.door && !b.door.upper); }
      const above = B.byId[this.world.getBlock(x, y + 1, z)];
      return below !== B.AIR && B.byId[below].solid && !B.byId[below].door && !!(above && above.door && above.door.upper);
    }
    if (def.ladder !== undefined) {
      const dir = [[0, -1], [1, 0], [0, 1], [-1, 0]][def.ladder];
      const wall = this.world.getBlock(x + dir[0], y, z + dir[1]);
      return wall !== B.AIR && B.byId[wall].opaque;
    }
    if (below !== B.AIR && B.byId[below].solid) return true;
    if (id === B.TORCH) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = this.world.getBlock(x + dx, y, z + dz);
        if (n !== B.AIR && B.byId[n].solid && B.byId[n].opaque) return true;
      }
    }
    return false;
  };

  Game.blockUpdate = function (x, y, z) {
    const w = this.world;
    const around = [[x, y + 1, z], [x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1], [x, y - 1, z]];
    for (const [cx, cy, cz] of around) {
      const id = w.getBlock(cx, cy, cz);
      const def = B.byId[id];
      if (!def || !def.needsGround || this.isSupported(cx, cy, cz, id)) continue;
      this.popBlock(cx, cy, cz, id);
    }
    // farmland under a solid block is packed back into dirt
    if (w.getBlock(x, y - 1, z) === B.FARMLAND) {
      const here = w.getBlock(x, y, z);
      if (here !== B.AIR && B.byId[here].solid) this.changeBlock(x, y - 1, z, B.DIRT);
    }
    for (const [cx, cy, cz] of [[x, y, z], [x, y + 1, z]]) {
      const id = w.getBlock(cx, cy, cz);
      if ((id !== B.SAND && id !== B.GRAVEL) || cy <= 0) continue;
      const below = w.getBlock(cx, cy - 1, cz);
      if (below !== B.AIR && B.byId[below].solid) continue;
      this.changeBlock(cx, cy, cz, B.AIR);
      Entities.fall(cx, cy, cz, id);
    }
  };

  Game.popBlock = function (x, y, z, id) {
    this.changeBlock(x, y, z, B.AIR);
    if (this.mode === 'survival') {
      for (const [did, n] of this.dropsFor(id, null)) this.spawnDrop(x + 0.5, y + 0.3, z + 0.5, did, n);
    }
    Entities.burst(x + 0.5, y + 0.4, z + 0.5, id, 6, 0.25);
  };

  // what a block leaves behind, following Minecraft's loot rules
  Game.dropsFor = function (id, toolDef) {
    const out = [];
    const def = B.byId[id];
    if (def.door) return def.door.upper ? out : [[Items.OAK_DOOR, 1]];
    if (def.cropKind === 'carrot') {
      out.push([Items.CARROT, def.crop >= 3 ? 1 + Math.floor(Math.random() * 4) : 1]);
      return out;
    }
    if (id === B.GRAVEL && Math.random() < 0.1) return [[Items.FLINT, 1]];
    if (def.crop !== undefined) {
      if (def.crop >= 3) {
        out.push([Items.WHEAT, 1]);
        const seeds = Math.floor(Math.random() * 4);
        if (seeds) out.push([Items.SEEDS, seeds]);
      } else {
        out.push([Items.SEEDS, 1]);
      }
      return out;
    }
    if (id === B.TALL_GRASS) {
      if (Math.random() < 0.125) out.push([Items.SEEDS, 1]);
      return out;
    }
    if (!B.canHarvest(id, toolDef)) return out;
    if (def.drop) out.push([def.drop, 1]);
    // oak leaves occasionally give an apple, the first food you can find
    if (id === B.LEAVES && Math.random() < 0.06) out.push([Items.APPLE, 1]);
    return out;
  };

  // ------------------------------------------------------------------ farming
  Game.updateCrops = function (dt) {
    if (Net.active && !Net.isHost) return;
    this._cropTimer = (this._cropTimer || 0) + dt;
    if (this._cropTimer < 1) return;
    this._cropTimer = 0;
    const day = World.lightUniforms.uDaylight.value;
    for (const key of Array.from(this.crops)) {
      if (Math.random() > 1 / 30) continue;
      const p = key.split(',');
      const x = +p[0], y = +p[1], z = +p[2];
      const chunk = this.world.getChunk(Math.floor(x / WorldConst.CHUNK_SIZE), Math.floor(z / WorldConst.CHUNK_SIZE));
      if (!chunk || !chunk.generated) continue;         // resumes when you come back
      const id = this.world.getBlock(x, y, z);
      const def = B.byId[id];
      if (def.crop === undefined || def.crop >= 3) { this.crops.delete(key); continue; }
      // wheat needs light, from the sun or a torch
      const l = this.world.lightAt(x, y, z);
      if (Math.max(l.sky * day, l.blk) < 9) continue;
      this.changeBlock(x, y, z, id + 1);
    }
  };

  // tilling with a hoe, sowing seeds: returns true when the tap was used up
  Game.tryFarm = function (hit, stack) {
    const def = Items.get(stack.id);
    const w = this.world;
    if (def && def.tool && def.tool.type === 'hoe' && (hit.id === B.GRASS || hit.id === B.DIRT)) {
      const above = w.getBlock(hit.x, hit.y + 1, hit.z);
      if (above !== B.AIR && !B.byId[above].replaceable) return false;
      if (above !== B.AIR) this.changeBlock(hit.x, hit.y + 1, hit.z, B.AIR);
      this.changeBlock(hit.x, hit.y, hit.z, B.FARMLAND);
      Sound.place(B.DIRT);
      Hand.swing();
      if (this.mode === 'survival') this.inventory.damageSelected(1);
      return true;
    }
    if ((stack.id === Items.SEEDS || stack.id === Items.CARROT) && hit.id === B.FARMLAND) {
      if (w.getBlock(hit.x, hit.y + 1, hit.z) !== B.AIR) return true;
      this.changeBlock(hit.x, hit.y + 1, hit.z, stack.id === Items.CARROT ? B.CARROTS : B.WHEAT_0);
      Sound.place(B.TALL_GRASS);
      Hand.swing();
      if (this.mode === 'survival') this.inventory.consumeSelected();
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------------- chests
  Game.chestAt = function (x, y, z) {
    const k = this.entityKey(x, y, z);
    let c = this.blockEntities.get(k);
    if (!c) {
      c = { type: 'chest', x, y, z, slots: new Array(27).fill(null) };
      this.blockEntities.set(k, c);
    }
    return c;
  };

  const packStack = (s) => (s ? (s.dur ? [s.id, s.count, s.dur] : [s.id, s.count]) : 0);
  const unpackStack = (e) => {
    if (!Array.isArray(e) || !e[0] || !Items.get(e[0])) return null;
    const s = { id: e[0], count: Math.max(1, e[1] | 0) };
    if (e[2]) s.dur = e[2];
    return s;
  };

  // a chest is shared: whatever one player moves in or out, everyone sees
  Game.syncChest = function (chest) {
    if (!Net.active || !chest) return;
    const data = chest.slots.map(packStack);
    const sig = JSON.stringify(data);
    if (sig === chest._sent) return;
    chest._sent = sig;
    Net.sendEntity(this.entityKey(chest.x, chest.y, chest.z), { type: 'chest', slots: data });
  };

  Game.onEntity = function (msg) {
    if (!msg || !msg.data || msg.data.type !== 'chest') return;
    const p = String(msg.key).split(',');
    const chest = this.chestAt(+p[0], +p[1], +p[2]);
    chest.slots = msg.data.slots.map(unpackStack);
    while (chest.slots.length < 27) chest.slots.push(null);
    chest._sent = JSON.stringify(msg.data.slots);
    this._worldDirty = true;
    if (UI.screen && UI.screen.entity && UI.screen.kind === 'chest' &&
        UI.screen.entity.x === chest.x && UI.screen.entity.y === chest.y && UI.screen.entity.z === chest.z) {
      UI.screen.entity = chest;
      if (!UI._dragging) UI.renderScreen();
    }
  };

  // --------------------------------------------------------------- experience
  // Minecraft's curve: early levels come quickly, later ones slowly
  Game.xpForLevel = function (L) {
    if (L <= 16) return L * L + 6 * L;
    if (L <= 31) return 2.5 * L * L - 40.5 * L + 360;
    return 4.5 * L * L - 162.5 * L + 2220;
  };

  Game.xpInfo = function (xp) {
    let L = 0;
    while (this.xpForLevel(L + 1) <= xp) L++;
    const base = this.xpForLevel(L), next = this.xpForLevel(L + 1);
    return { level: L, progress: (xp - base) / (next - base) };
  };

  Game.addXp = function (n) {
    const p = this.player;
    const before = this.xpInfo(p.xp || 0).level;
    p.xp = (p.xp || 0) + n;
    const after = this.xpInfo(p.xp).level;
    if (after > before && after % 5 === 0) Sound.levelUp(); else Sound.xp();
    UI.renderXp(p);
  };

  Game.smeltXp = function (id, count) {
    const per = {};
    per[Items.IRON_INGOT] = 0.7; per[Items.GOLD_INGOT] = 1;
    per[B.GLASS] = 0.1; per[B.STONE] = 0.1; per[Items.COAL] = 0.15;
    const each = per[id] !== undefined ? per[id] : 0.35;
    const p = this.player;
    if (this.mode === 'survival' && count > 0) Entities.dropXp(p.pos.x, p.pos.y + 1, p.pos.z, each * count);
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
      xp: p.xp || 0,
      spawn: this.bedSpawn || null,
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
      if (f.type === 'chest') {
        if (f.slots.some(Boolean)) out.push(['c', f.x, f.y, f.z, f.slots.map(pack)]);
        continue;
      }
      if (f.type !== 'furnace') continue;
      if (!f.input[0] && !f.fuel[0] && !f.output[0] && f.burn <= 0) continue;
      out.push([f.x, f.y, f.z, pack(f.input[0]), pack(f.fuel[0]), pack(f.output[0]),
        +f.burn.toFixed(1), +f.burnMax.toFixed(1), +f.cook.toFixed(1)]);
    }
    return out.concat(Entities.snapshotBoats());
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
      if (r[0] === 'c') {
        const c = this.chestAt(r[1], r[2], r[3]);
        c.slots = (r[4] || []).map(unpack);
        while (c.slots.length < 27) c.slots.push(null);
        continue;
      }
      if (r[0] === 'b') { Entities.placeBoat(r[1], r[2], r[3], r[4], r[5], true); continue; }
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
    if (typeof saved.xp === 'number') p.xp = saved.xp;
    if (saved.spawn && typeof saved.spawn.x === 'number') {
      this.bedSpawn = saved.spawn;
      this.spawnPoint = { x: saved.spawn.x, y: saved.spawn.y, z: saved.spawn.z };
    }
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
      this.shadeGroup(a.group, this.lightAtPoint(a.group.position.x, a.group.position.y + 1.5, a.group.position.z));
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
      getEntities: () => this.entityList(),
      onBoat: (msg) => Entities.applyRemoteBoat(msg),
      onArrow: (msg) => Entities.shootArrow(msg.x, msg.y, msg.z, msg.vx, msg.vy, msg.vz, { visual: true, damage: 0 }),
      onMobFeed: (msg) => { const m = Mobs.byId(msg.mobId); if (m) Mobs.feed(m); },
      onEntity: (msg) => this.onEntity(msg),
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
      room: code, savedAt: msg.savedAt, entities: msg.entities
    });
    if (msg.spawn) {
      this.spawnPoint = this.bedSpawn || msg.spawn;
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
    const o = this._caster.ray.origin, d = this._caster.ray.direction;
    const hit = this.world.raycast(o, d, REACH);
    if (hit) { hit.px = o.x + d.x * hit.dist; hit.py = o.y + d.y * hit.dist; hit.pz = o.z + d.z * hit.dist; }
    return hit;
  };

  // which way the player is looking, as 0 north, 1 east, 2 south, 3 west
  Game.facing = function () {
    const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
    if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 1 : 3;
    return fz < 0 ? 0 : 2;
  };

  Game.currentTarget = function () {
    return this.targetAt(Controls.state.pointX, Controls.state.pointY);
  };

  Game.tryPlace = function (screenX, screenY) {
    if (this.paused || !this.started || this.player.dead) return;
    const sx = screenX === undefined ? Controls.state.pointX : screenX;
    const sy = screenY === undefined ? Controls.state.pointY : screenY;

    // climbing into a boat
    const boat = Entities.boatAt(sx, sy);
    if (boat && !Entities.riding) {
      if (Entities.mount(boat.boat) === false) { UI.toast(boat.boat.rider + ' 님이 타고 있어요', 1600); return; }
      UI.toast('점프 버튼(키보드: Space)으로 내립니다', 1800);
      return;
    }
    if (this.tryAttack(sx, sy)) return;

    const stack = this.inventory.selectedStack();
    const hit = this.targetAt(sx, sy);
    const p = this.player;

    // using a block: sneaking lets you build against it instead, as in Minecraft
    if (hit && !(p.sneaking && stack && Items.isBlock(stack.id))) {
      const targetDef = B.byId[hit.id];
      if (targetDef.interactive === 'craft') { UI.openScreen('crafting'); return; }
      if (targetDef.interactive === 'furnace') { UI.openScreen('furnace', this.furnaceAt(hit.x, hit.y, hit.z)); return; }
      if (targetDef.interactive === 'chest') {
        UI.openScreen('chest', this.chestAt(hit.x, hit.y, hit.z));
        Sound.chest(true);
        return;
      }
      if (targetDef.interactive === 'bed') { this.useBed(hit.x, hit.y, hit.z); return; }
      if (targetDef.interactive === 'door') { this.toggleDoor(hit.x, hit.y, hit.z); return; }
    }

    if (!stack) { if (hit) UI.toast('손에 든 블록이 없어요', 1200); return; }
    if (hit && this.tryFarm(hit, stack)) return;
    // food works anywhere, not only when you are pointing at a block
    if (this.tryEat(stack)) return;
    if (stack.id === Items.BOAT) { this.useBoat(sx, sy); return; }
    if (Items.get(stack.id) && Items.get(stack.id).bow) return;      // a bow is drawn by holding
    if (stack.id === Items.BUCKET || stack.id === Items.WATER_BUCKET || stack.id === Items.LAVA_BUCKET) {
      this.useBucket(sx, sy, stack);
      return;
    }
    if (!hit) return;
    if (this.tryFarm(hit, stack)) return;
    if (this.placeShaped(hit, stack)) return;
    if (!Items.isBlock(stack.id)) { UI.toast(Items.name(stack.id) + '은(는) 설치할 수 없어요', 1400); return; }

    // tall grass is simply replaced, like Minecraft
    let x, y, z;
    if (B.byId[hit.id].replaceable) { x = hit.x; y = hit.y; z = hit.z; }
    else { x = hit.x + hit.nx; y = hit.y + hit.ny; z = hit.z + hit.nz; }
    const existing = this.world.getBlock(x, y, z);
    const exDef = B.byId[existing];
    if (existing !== B.AIR && !exDef.liquid && !exDef.replaceable) return;
    const def = B.byId[stack.id];
    if (def.solid && this.intersectsPlayer(x, y, z)) return;
    if (def.solid && this.mobInside(x, y, z)) return;
    if (def.needsGround && !this.isSupported(x, y, z, stack.id)) return;

    if (this.changeBlock(x, y, z, stack.id)) {
      if (stack.id === B.FURNACE) this.furnaceAt(x, y, z);
      if (stack.id === B.CHEST) this.chestAt(x, y, z);
      Sound.place(stack.id);
      Hand.swing();
      if (this.mode === 'survival') this.inventory.consumeSelected();
      else UI.renderHotbar();
    }
  };

  Game.myName = function () { return Net.active ? Net.name : 'me'; };

  // ------------------------------------------------------------------ the bow
  // Minecraft's draw: power grows over about a second, (t^2 + 2t) / 3.
  Game.bowPower = function (t) {
    return Math.min(1, (t * t + 2 * t) / 3);
  };

  Game.updateBow = function (dt) {
    const held = Controls.state.mining && !this.paused && !this.player.dead;
    if (held) {
      if (!this.bowCharge && this.mode === 'survival' && this.inventory.count(Items.ARROW) === 0) {
        if (!this._noArrowWarned) { this._noArrowWarned = true; UI.toast('화살이 없어요', 1200); }
        return;
      }
      this._noArrowWarned = false;
      this.bowCharge = (this.bowCharge || 0) + dt;
      return;
    }
    if (this.bowCharge > 0.1) this.shootBow(this.bowPower(this.bowCharge));
    this.bowCharge = 0;
  };

  Game.shootBow = function (power) {
    const p = this.player;
    const ray = this.rayFrom(Controls.state.pointX, Controls.state.pointY).ray;
    const d = ray.direction;
    const speed = 58 * power;
    let damage = Math.ceil(power * 6);
    if (power >= 1) damage += Math.floor(Math.random() * (damage / 2 + 2));   // a full draw can crit
    const x = ray.origin.x + d.x * 0.4, y = ray.origin.y + d.y * 0.4 - 0.1, z = ray.origin.z + d.z * 0.4;
    Entities.shootArrow(x, y, z, d.x * speed, d.y * speed, d.z * speed, { damage, pickup: this.mode === 'survival' });
    if (Net.active) Net.sendArrow({ x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), vx: +(d.x * speed).toFixed(2), vy: +(d.y * speed).toFixed(2), vz: +(d.z * speed).toFixed(2) });
    Sound.bow();
    Hand.swing();
    if (this.mode === 'survival') {
      this.inventory.takeFromSlots(Items.ARROW, 1);
      this.inventory.damageSelected(1);
      this.inventory.changed();
    }
  };

  Game.arrowHitMob = function (mob, damage, kx, kz) {
    Sound.hit(this.distTo(mob.x, mob.y, mob.z));
    if (Net.active && !Net.isHost) { Net.sendMobHit(mob.id, damage, kx, kz); mob.hurtFlash = 0.3; return; }
    this.damageMob(mob, damage, kx, kz);
  };

  Game.onBred = function (baby) {
    if (this.mode === 'survival') Entities.dropXp(baby.x, baby.y + 0.5, baby.z, 1 + Math.random() * 6);
  };

  // ------------------------------------------------------------ shaped blocks
  // after something is placed from the hand
  Game.placed = function (id) {
    Sound.place(id);
    Hand.swing();
    if (this.mode === 'survival') this.inventory.consumeSelected();
    else UI.renderHotbar();
  };

  Game.freeCell = function (x, y, z) {
    const d = B.byId[this.world.getBlock(x, y, z)];
    return d.id === B.AIR || d.liquid || d.replaceable;
  };

  Game.placeShaped = function (hit, stack) {
    const w = this.world;
    const id = stack.id;
    const hd = B.byId[hit.id];
    let x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    if (hd.replaceable && !hd.liquid) { x = hit.x; y = hit.y; z = hit.z; }

    // a door is two blocks tall and opens away from you
    if (id === Items.OAK_DOOR) {
      if (!this.freeCell(x, y, z) || !this.freeCell(x, y + 1, z)) return true;
      const under = B.byId[w.getBlock(x, y - 1, z)];
      if (!under.solid || under.door) return true;
      if (this.intersectsPlayer(x, y, z) || this.intersectsPlayer(x, y + 1, z)) return true;
      const f = this.facing();
      this.world.setBlock(x, y + 1, z, B.DOOR + 8 + f * 2);   // upper first, so the lower is supported
      this.changeBlock(x, y, z, B.DOOR + f * 2);
      this.changeBlock(x, y + 1, z, B.DOOR + 8 + f * 2);
      this.placed(B.PLANKS);
      return true;
    }
    if (!Items.isBlock(id)) return false;
    const def = B.byId[id];

    // slabs: top or bottom half by where you aim, two of a kind make a block
    if (def.slab) {
      const fam = def.family;
      if (hd.slab && hd.family === fam &&
          ((hd.slab === 'bottom' && hit.ny === 1) || (hd.slab === 'top' && hit.ny === -1))) {
        this.changeBlock(hit.x, hit.y, hit.z, hd.full);
        this.placed(hd.full);
        return true;
      }
      const td = B.byId[w.getBlock(x, y, z)];
      if (td.slab && td.family === fam) {
        this.changeBlock(x, y, z, td.full);
        this.placed(td.full);
        return true;
      }
      if (!this.freeCell(x, y, z)) return true;
      let top;
      if (hit.ny === -1) top = true;
      else if (hit.ny === 1) top = false;
      else top = hit.py !== undefined && (hit.py - Math.floor(hit.py)) > 0.5;
      const sid = top ? fam + 3 : fam;
      if (this.intersectsPlayer(x, y, z)) return true;
      this.changeBlock(x, y, z, sid);
      this.placed(sid);
      return true;
    }

    // stairs climb away from you
    if (def.stairs !== undefined) {
      if (!this.freeCell(x, y, z) || this.intersectsPlayer(x, y, z)) return true;
      const sid = def.family + this.facing();
      this.changeBlock(x, y, z, sid);
      this.placed(sid);
      return true;
    }

    // ladders go on walls, against the face you touched
    if (def.ladder !== undefined) {
      if (hit.ny !== 0 || !hd.opaque || !this.freeCell(x, y, z)) return true;
      const f = hit.nz === 1 ? 0 : hit.nx === -1 ? 1 : hit.nz === -1 ? 2 : 3;
      this.changeBlock(x, y, z, B.LADDER + f);
      this.placed(B.LADDER);
      return true;
    }
    return false;
  };

  Game.toggleDoor = function (x, y, z) {
    const d = B.byId[this.world.getBlock(x, y, z)];
    if (!d.door) return;
    const lowY = d.door.upper ? y - 1 : y;
    for (const yy of [lowY, lowY + 1]) {
      const id = this.world.getBlock(x, yy, z);
      if (B.byId[id].door) this.world.setBlock(x, yy, z, id ^ 1);
    }
    // registered after both halves flip, so neither half sees the other missing
    for (const yy of [lowY, lowY + 1]) {
      const id = this.world.getBlock(x, yy, z);
      if (B.byId[id].door) { this.registerEdit(x, yy, z, id); Net.sendEdit(x, yy, z, id); }
    }
    Sound.door();
    Hand.swing();
  };

  // --------------------------------------------------------------- buckets
  Game.useBucket = function (sx, sy, stack) {
    const ray = this.rayFrom(sx, sy).ray;
    const hit = this.world.raycast(ray.origin, ray.direction, REACH, true);
    if (!hit) return;
    const inv = this.inventory;
    const hd = B.byId[hit.id];
    const give = (id) => {
      if (this.mode !== 'survival') return;
      if (stack.count > 1) { stack.count--; if (inv.add(id, 1) < 1) this.spawnDropAtPlayer(id, 1); }
      else inv.slots[inv.selected] = { id, count: 1 };
      inv.changed();
    };
    if (stack.id === Items.BUCKET) {
      if (!hd.fluid || hd.level !== 0) return;
      this.changeBlock(hit.x, hit.y, hit.z, B.AIR);
      give(hd.fluid === 'water' ? Items.WATER_BUCKET : Items.LAVA_BUCKET);
      Sound.bucket(hd.fluid === 'lava');
      Hand.swing();
      return;
    }
    let x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    if (hd.fluid || hd.replaceable) { x = hit.x; y = hit.y; z = hit.z; }
    if (!this.freeCell(x, y, z)) return;
    const lava = stack.id === Items.LAVA_BUCKET;
    this.changeBlock(x, y, z, lava ? B.LAVA : B.WATER);
    give(Items.BUCKET);
    Sound.bucket(lava);
    Hand.swing();
  };

  Game.mobInside = function (x, y, z) {
    for (const m of Mobs.list) {
      const hw = m.def.hw;
      if (x + 1 > m.x - hw && x < m.x + hw && z + 1 > m.z - hw && z < m.z + hw &&
          y + 1 > m.y && y < m.y + m.def.h) return true;
    }
    return false;
  };

  // boats go on water, or on top of a block
  Game.useBoat = function (sx, sy) {
    const ray = this.rayFrom(sx, sy).ray;
    const hit = this.world.raycast(ray.origin, ray.direction, REACH, true);
    if (!hit) return;
    let y;
    if (B.byId[hit.id].liquid) y = hit.y + 0.875 - 0.28;
    else if (hit.ny === 1) y = hit.y + 1;
    else return;
    Entities.placeBoat(hit.x + 0.5, y, hit.z + 0.5, this.player.yaw);
    Sound.place(B.PLANKS);
    Hand.swing();
    if (this.mode === 'survival') this.inventory.consumeSelected();
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

    const mob = target.mob;
    const stack = this.inventory.selectedStack();
    // an animal's favourite food puts it in the mood instead of hurting it
    if (stack && mob.def.breedWith === stack.id) {
      let fed;
      if (Net.active && !Net.isHost) { Net.sendMobFeed(mob.id); fed = true; }
      else fed = Mobs.feed(mob);
      if (fed) {
        Entities.hearts(mob.x, mob.y + mob.def.h * mob.size + 0.2, mob.z, 3);
        Hand.swing();
        if (this.mode === 'survival') this.inventory.consumeSelected();
      }
      return true;
    }
    this._lastAttack = now;
    const def = stack ? Items.get(stack.id) : null;
    let damage = def && def.damage ? def.damage : 1;
    Hand.swing();

    // a blow landed while falling is a critical hit: half again as strong
    const p = this.player;
    if (p.vel.y < -0.5 && !p.onGround && !p.inWater && !p.flying && !Entities.riding) {
      damage *= 1.5;
      Entities.crit(mob.x, mob.y + mob.def.h * 0.6, mob.z);
      Sound.crit();
    }
    Sound.hit();

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
    // animals bolt when hit
    if (!mob.def.hostile) { mob.panic = 3; mob.wanderYaw = Math.atan2(kx, kz); }
    Sound.mob(mob.type, 'hurt', this.distTo(mob.x, mob.y, mob.z));
    if (mob.dead) {
      Mobs.dropLoot(mob, this);
      if (this.mode === 'survival') {
        Entities.dropXp(mob.x, mob.y + 0.5, mob.z, mob.def.hostile ? 5 : 1 + Math.random() * 2);
      }
      Entities.burst(mob.x, mob.y + mob.def.h * 0.5, mob.z, B.SNOW, 10, 0.4);
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

  // Eating the Minecraft way: hold with food in hand and it takes 1.6 seconds
  // of munching. A quick tap starts the same munch and lets it finish.
  const EAT_TIME = 1.6;

  Game.canEat = function () {
    return this.mode !== 'survival' || this.player.food < 20;
  };

  Game.tryEat = function (stack) {
    const food = Items.foodOf(stack.id);
    if (!food) return false;
    if (this.eating) return true;
    if (!this.canEat()) { UI.toast('배가 불러서 더 먹을 수 없어요', 1300); return true; }
    this.startEating(false);
    return true;
  };

  Game.startEating = function (hold) {
    const inv = this.inventory;
    const stack = inv.selectedStack();
    if (!stack || !Items.foodOf(stack.id)) return;
    this.eating = { id: stack.id, slot: inv.selected, t: 0, hold: !!hold, munch: 0 };
  };

  Game.updateEating = function (dt) {
    const inv = this.inventory;
    const stack = inv.selectedStack();
    const holdingFood = Controls.state.mining && stack && Items.foodOf(stack.id);
    let e = this.eating;
    if (!e) {
      if (holdingFood) {
        if (this.canEat()) this.startEating(true);
        else if (!this._fullWarned) { this._fullWarned = true; UI.toast('배가 불러서 더 먹을 수 없어요', 1300); }
      } else {
        this._fullWarned = false;
      }
      return;
    }
    // switching items or letting go of a held press stops the meal
    if (!stack || stack.id !== e.id || inv.selected !== e.slot || (e.hold && !Controls.state.mining)) {
      this.eating = null;
      return;
    }
    e.t += dt;
    e.munch -= dt;
    if (e.munch <= 0) {
      e.munch = 0.22;
      Sound.eat();
      const p = this.player;
      this._look = this._look || { x: 0, y: 0, z: 0 };
      p.lookDir(this._look);
      // crumbs fall from just below the chin, small, as in Minecraft
      Entities.burst(p.pos.x + this._look.x * 0.8, p.eyeY() - 0.35, p.pos.z + this._look.z * 0.8, e.id, 3, 0.06, 0.045);
    }
    if (e.t < EAT_TIME) return;

    const food = Items.foodOf(e.id);
    this.player.eat(food.food, food.saturation || 0);
    if (this.mode === 'survival') inv.consumeSelected();
    if (this.player.food >= 20) Sound.burp();
    UI.renderStats(this.player);
    this.eating = null;
    // keep eating while the press is held and there is room, as in Minecraft
    if (holdingFood && this.canEat()) this.startEating(true);
  };

  // Sleeping runs the clock to dawn. In a room the host owns the time, so a
  // guest asks and everybody's sky moves together.
  Game.useBed = function (x, y, z) {
    const p = this.player;
    if (Math.hypot(p.pos.x - (x + 0.5), p.pos.z - (z + 0.5)) > 4) return;
    this.spawnPoint = { x: x + 0.5, y: y + 1.2, z: z + 0.5 };
    this.bedSpawn = { x: x + 0.5, y: y + 1.2, z: z + 0.5 };
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
    const held = this.inventory.selectedStack();
    const eatingHand = held && Items.foodOf(held.id);
    const bowHand = held && Items.get(held.id) && Items.get(held.id).bow;
    if (bowHand) {
      this.updateBow(dt);
      m.target = null; m.progress = 0; this.crackMesh.visible = false;
      return;
    }
    this.bowCharge = 0;
    if (!Controls.state.mining || this.paused || this.player.dead || eatingHand) {
      m.target = null;
      m.progress = 0;
      this.crackMesh.visible = false;
      return;
    }

    // Bedrock keeps breaking the block you grabbed while you walk and turn, so
    // the target is locked on the first frame instead of re-aimed every frame.
    if (!m.target) {
      // holding on a boat knocks it loose
      const boat = Entities.boatAt(Controls.state.pointX, Controls.state.pointY);
      if (boat && boat.boat !== Entities.riding) {
        m.boatTime = (m.boatTime || 0) + dt;
        Hand.swing();
        if (m.boatTime > 0.5) { m.boatTime = 0; Entities.removeBoat(boat.boat, true); Sound.breakBlock(B.PLANKS); }
        return;
      }
      m.boatTime = 0;
      const hit = this.targetAt(Controls.state.pointX, Controls.state.pointY);
      if (!hit) { this.crackMesh.visible = false; return; }
      m.target = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, nx: hit.nx, ny: hit.ny, nz: hit.nz };
      m.progress = 0;
      m.soundT = 0;
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
    let seconds = this.mode === 'creative' ? 0.12 : B.mineTime(here, toolDef);
    if (!isFinite(seconds)) {
      this.crackMesh.visible = false;
      return;
    }
    // Minecraft digs five times slower off the ground and again under water
    if (this.mode === 'survival') {
      if (!p.onGround && !p.flying && !Entities.riding) seconds *= 5;
      if (p.headInWater) seconds *= 5;
    }

    Hand.swing();
    m.soundT = (m.soundT || 0) - dt;
    if (m.soundT <= 0 && seconds > 0.15) {
      m.soundT = 0.24;
      Sound.dig(here);
      const t = m.target;
      Entities.burst(t.x + 0.5 + (t.nx || 0) * 0.55, t.y + 0.5 + (t.ny || 0) * 0.55, t.z + 0.5 + (t.nz || 0) * 0.55, here, 2, 0.3);
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
    if (B.byId[id].door && B.byId[id].door.upper) {
      const low = this.world.getBlock(x, y - 1, z);
      if (B.byId[low].door) this.popBlock(x, y - 1, z, low);
    }
    Sound.breakBlock(id);
    Entities.burst(x + 0.5, y + 0.5, z + 0.5, id, 14);

    const entity = this.blockEntities.get(this.entityKey(x, y, z));
    if (entity) {
      this.blockEntities.delete(this.entityKey(x, y, z));
      if (this.mode === 'survival') {
        const lists = entity.type === 'chest' ? [entity.slots] : [entity.input, entity.fuel, entity.output];
        for (const arr of lists) {
          for (const s of arr) if (s) this.spawnDrop(x + 0.5, y + 0.5, z + 0.5, s.id, s.count);
        }
      }
      if (UI.screen && UI.screen.entity === entity) UI.closeScreen();
    }

    if (this.mode === 'survival') {
      for (const [did, n] of this.dropsFor(id, toolDef)) this.spawnDrop(x + 0.5, y + 0.3, z + 0.5, did, n);
      // ores give experience when mined for their item
      if (B.canHarvest(id, toolDef)) {
        if (id === B.COAL_ORE) Entities.dropXp(x + 0.5, y + 0.5, z + 0.5, Math.random() * 2);
        else if (id === B.DIAMOND_ORE) Entities.dropXp(x + 0.5, y + 0.5, z + 0.5, 3 + Math.random() * 4);
      }
      const instant = B.byId[id].hardness === 0;
      if (!instant && toolDef && toolDef.tool && this.inventory.damageSelected(1)) {
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
          Sound.pop();
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
    // underground the fog goes dark, as in Minecraft: otherwise the far wall of
    // a cave melts into sky blue and looks like a hole to the surface
    const p = this.player;
    const eye = this.world.lightAt(Math.floor(p.pos.x), Math.floor(p.eyeY()), Math.floor(p.pos.z));
    const target = eye.sky / 15;
    if (this._eyeSky === undefined) this._eyeSky = target;
    this._eyeSky += (target - this._eyeSky) * Math.min(1, dt * 1.5);
    const dim = 0.06 + 0.94 * this._eyeSky * this._eyeSky;
    this.fog.color.copy(sky).multiplyScalar(dim);
    this.scene.background = sky.clone().multiplyScalar(dim);

    const brightness = 0.18 + daylight * 0.82;
    const L = World.lightUniforms;
    L.uDaylight.value = 0.22 + daylight * 0.78;
    // moonlight is a little blue, dusk a little warm
    L.uSkyTint.value.setRGB(0.78 + daylight * 0.22, 0.84 + daylight * 0.16, 1);
    const here = Math.min(1, this.lightHere(brightness) + 0.1);
    this.itemMaterial.color.setScalar(here);
    Entities.boatMat.color.setScalar(here);

    const under = this.player.headInWater;
    if (under) {
      this.fog.near = 0.1;
      this.fog.far = 14;
      this.fog.color.setHex(0x2c5ca8);
      this.scene.background = new THREE.Color(0x2c5ca8);
    } else {
      // pull the fog in over anything not drawn yet, then ease it back out
      const base = this.world.renderDistance * WorldConst.CHUNK_SIZE - 8;
      const edge = this.world.meshedRadius;
      const want = Math.min(base, isFinite(edge) ? Math.max(14, edge - 1) : base);
      if (this._fogFar === undefined) this._fogFar = want;
      const rate = want < this._fogFar ? 10 : 1.5;
      this._fogFar += (want - this._fogFar) * Math.min(1, dt * rate);
      this.fog.far = this._fogFar;
      this.fog.near = this._fogFar * 0.6;
    }
    Sky.setVisible(!under && this._eyeSky > 0.25);
    Sky.update(this.camera, this.dayTime, dt);
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
    p.hurtFlash = 0;
    UI.hideDeath();
    UI.renderStats(p);
    UI.renderXp(p);
    this.paused = false;
  };

  Game.onDeath = function () {
    if (Entities.riding) Entities.dismount();
    const score = this.player.xp || 0;
    if (this.mode === 'survival') {
      const p = this.player;
      // Minecraft keeps a little of your experience on the ground
      const level = this.xpInfo(p.xp || 0).level;
      if (level > 0) Entities.dropXp(p.pos.x, p.pos.y + 0.5, p.pos.z, Math.min(100, level * 7));
      p.xp = 0;
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
    UI.showDeath(score);
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
      this.updatePanorama(dt);
      this.render(false);
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
        if (sg >= 0 && !this.bedSpawn) this.spawnPoint.y = sg + 1.2;
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
      this.updateSky(0);
      this.syncCamera();
      this.render(false);
      return;
    }

    Controls.tickHold();
    const look = Controls.consumeLook();
    const sens = Controls.lookSens();
    p.yaw -= look.x * sens;
    p.pitch -= look.y * sens;
    p.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p.pitch));

    const input = Controls.state;
    if (!this.paused && !p.dead) {
      const px0 = p.pos.x, pz0 = p.pos.z;
      const wasInWater = p.inWater, vy0 = p.vel.y;

      if (Entities.riding) {
        // jump or sneak steps out of the boat
        const leave = (input.jump && !this._jumpHeld) || (input.sneak && !this._sneakHeld);
        if (leave) Entities.dismount();
        p.updateStats(dt);
      } else {
        p.update(dt, input, this.world);
      }
      this._jumpHeld = input.jump;
      this._sneakHeld = input.sneak;

      if (!wasInWater && p.inWater && vy0 < -4) Sound.splash();
      if (p.onGround && !p.sneaking && !Entities.riding && !p.flying) {
        this._stepDist = (this._stepDist || 0) + Math.hypot(p.pos.x - px0, p.pos.z - pz0);
        if (this._stepDist > 1.8) {
          this._stepDist = 0;
          Sound.step(this.world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.2), Math.floor(p.pos.z)));
        }
      }
      if (p.onGround && Math.hypot(p.vel.x, p.vel.z) > 0.5) this._walkBob = (this._walkBob || 0) + dt * Math.hypot(p.vel.x, p.vel.z) * 1.9;

      this.updateMining(dt);
      this.updateEating(dt);
      this.updateDrops(dt);
      this.updateCrops(dt);
      Fluids.update(dt, this);
      Entities.update(dt, input);
    } else {
      Entities.updateParticles(dt);
    }
    if (this.started && !this.loading) this.updateFurnaces(dt);

    // checked every frame so any damage source, not just Player.update, ends the run
    if (p.dead && !this._deathHandled) {
      this._deathHandled = true;
      this.onDeath();
    }

    // a bigger slice of the frame while there are still holes near the player
    const holes = this.world.meshedRadius < this.world.renderDistance * WorldConst.CHUNK_SIZE;
    this.world.update(p.pos.x, p.pos.z, holes ? 11 : 6, -Math.sin(p.yaw), -Math.cos(p.yaw));
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
    UI.setOverlay('waterOverlay', p.headInWater && !p.headInLava ? 0.35 : 0);
    UI.setOverlay('lavaOverlay', p.headInLava ? 0.85 : (p.burning > 0 ? 0.25 + Math.sin(performance.now() / 60) * 0.08 : 0));
    if (this.debugVisible()) {
      const l = this.world.lightAt(Math.floor(p.pos.x), Math.floor(p.pos.y + 0.5), Math.floor(p.pos.z));
      UI.setDebug([
        'FPS ' + (this._fps || 0),
        'XYZ ' + p.pos.x.toFixed(1) + ' / ' + p.pos.y.toFixed(1) + ' / ' + p.pos.z.toFixed(1),
        '빛 하늘 ' + l.sky + ' / 블록 ' + l.blk,
        '청크 ' + this.world.chunks.size + '   드롭 ' + this.drops.length + '   몹 ' + Mobs.list.length,
        '시드 ' + this.seed,
        '시간 ' + Math.floor(this.dayTime * 24) + '시',
        '모드 ' + (this.mode === 'survival' ? '서바이벌' : '크리에이티브')
      ]);
    }

    const stack = this.inventory.selectedStack();
    Hand.update(dt, p, stack, this.lightHere(1), !!(Controls.state.mining && this.mining.target),
      this.eating ? this.eating.t : -1, this.bowCharge ? this.bowPower(this.bowCharge) : -1);

    // sprinting widens the view, as in Minecraft
    const fovTarget = (p.sprinting ? 80 : 72) - (this.bowCharge ? this.bowPower(this.bowCharge) * 12 : 0);
    if (Math.abs(this.camera.fov - fovTarget) > 0.05) {
      this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
    if (p.hurtTilt > 0) p.hurtTilt = Math.max(0, p.hurtTilt - dt * 4);

    this.syncCamera();
    this.render(!p.dead);
  };

  Game.debugVisible = function () { return !!UI.debugOn; };

  Game.syncCamera = function () {
    const p = this.player;
    let bobY = 0, roll = 0;
    if (Settings.bool('viewBob') && p.onGround && !p.flying && !Entities.riding) {
      const b = this._walkBob || 0;
      const amp = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 4.4);
      bobY = -Math.abs(Math.cos(b)) * 0.07 * amp;
      roll = Math.sin(b) * 0.012 * amp;
    }
    // the hurt wobble
    if (p.hurtTilt > 0) roll += Math.sin(p.hurtTilt * Math.PI) * 0.1;
    this.camera.position.set(p.pos.x, p.eyeY() + bobY, p.pos.z);
    this.camera.rotation.set(p.pitch, p.yaw, roll, 'YXZ');
  };

  // The title screen shows a world slowly turning behind the menu, as the
  // real game does with its panorama.
  const MENU_SEED = 20240613;
  Game.updatePanorama = function (dt) {
    if (!this.world) {
      this.world = new World(MENU_SEED);
      this.world.renderDistance = 3;
      this.world.onChunkReady = null;
      this.scene.add(this.world.group);
      this.panoCenter = null;
    }
    if (!this.panoCenter) {
      const g = this.world.groundY(0, 0);
      this.panoCenter = { x: 0.5, y: Math.max(g, WorldConst.SEA_LEVEL) + 10, z: 0.5 };
    }
    const c = this.panoCenter;
    this.world.update(c.x, c.z, 8);
    this._panoYaw = (this._panoYaw || 0) + dt * 0.05;
    this.camera.position.set(c.x, c.y, c.z);
    this.camera.rotation.set(-0.12, this._panoYaw, 0, 'YXZ');

    const L = World.lightUniforms;
    L.uDaylight.value = 1;
    L.uSkyTint.value.setRGB(1, 1, 1);
    this.scene.background = SKY_DAY;
    this.fog.color.copy(SKY_DAY);
    this.fog.far = this.world.renderDistance * WorldConst.CHUNK_SIZE - 6;
    this.fog.near = this.fog.far * 0.6;
    Sky.setVisible(true);
    Sky.update(this.camera, 0.36, dt);
  };

  Game.quitToTitle = function () {
    this.saveNow(true);
    if (Net.active) this.leaveRoom();
    if (Entities.riding) Entities.dismount();
    if (UI.screen) UI.closeScreen();
    this.started = false;
    this.paused = false;
    Mobs.clear();
    Entities.clear();
    this.clearDrops();
    this.clearAvatars();
    this.selectionBox.visible = false;
    this.crackMesh.visible = false;
    // keep turning over the world you just left
    this.panoCenter = { x: this.player.pos.x, y: this.player.eyeY() + 6, z: this.player.pos.z };
    UI.hideDeath();
    UI.hidePause();
    UI.showMenu();
    UI.showMenuPage('menuMain');
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
        onKeyboardMode: () => UI.showKeyboardHint(),
        onPointerLock: (locked, ours) => {
          if (!locked && !ours && this.started && !this.player.dead && !UI.screen) UI.showPause();
        }
      }
    });

    // browsers keep audio silent until the first touch or key
    const unlock = () => Sound.unlock();
    for (const ev of ['touchstart', 'mousedown', 'keydown']) document.addEventListener(ev, unlock, true);
    Sound.setVolume(Settings.get('volume') / 100);

    Controls.bindTap(el('btnSneak'), () => {
      const on = Controls.toggleSneak();
      UI.setSneak(on);
    });
    Controls.bindTap(el('btnPause'), () => UI.showPause());
    Controls.bindTap(el('btnResume'), () => UI.hidePause());
    Controls.bindTap(el('btnPauseSettings'), () => UI.openSettings());
    Controls.bindTap(el('btnQuitTitle'), () => this.quitToTitle());
    Controls.bindTap(el('btnDeathTitle'), () => { this.respawn(); this.quitToTitle(); });

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
