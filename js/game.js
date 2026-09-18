(function (global) {
  'use strict';

  const B = Blocks;
  const el = (id) => document.getElementById(id);
  const DAY_LENGTH = 1200;
  const REACH = 5.2;

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
    if (opts && opts.edits) for (const e of opts.edits) this.registerEdit(e[0], e[1], e[2], e[3]);

    this.world = new World(seed);
    this.world.onChunkReady = (chunk) => this.applyChunkEdits(chunk);
    this.scene.add(this.world.group);

    this.inventory = new Inventory();
    this.inventory.onChange = () => UI.renderHotbar();

    this.player = new Player(mode);
    this.player.armorProvider = this.inventory;
    this.blockEntities = new Map();
    this.itemMaterial = this.itemMaterial ||
      new THREE.MeshBasicMaterial({ map: Textures.texture, alphaTest: 0.5 });

    if (mode === 'creative') {
      const list = B.creativeList;
      for (let i = 0; i < 9 && i < list.length; i++) this.inventory.slots[i] = { id: list[i], count: 64 };
    }

    this.spawnPlayer();
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
  };

  Game.hashSeed = function (text) {
    if (!text || !String(text).trim()) return (Math.random() * 2147483647) | 0;
    let seed = 0;
    const str = String(text);
    for (let i = 0; i < str.length; i++) seed = (Math.imul(seed, 31) + str.charCodeAt(i)) | 0;
    return seed;
  };

  // ------------------------------------------------------------ world edits
  Game.registerEdit = function (x, y, z, id) {
    const key = Math.floor(x / WorldConst.CHUNK_SIZE) + ',' + Math.floor(z / WorldConst.CHUNK_SIZE);
    const list = this.editsByChunk[key] || (this.editsByChunk[key] = []);
    list.push([x, y, z, id]);
  };

  Game.applyChunkEdits = function (chunk) {
    const list = this.editsByChunk[chunk.cx + ',' + chunk.cz];
    if (!list) return;
    const CS = WorldConst.CHUNK_SIZE;
    for (const e of list) {
      const y = e[1];
      if (y < 0 || y >= WorldConst.WORLD_HEIGHT) continue;
      const lx = e[0] - chunk.cx * CS, lz = e[2] - chunk.cz * CS;
      chunk.data[(y * CS + lz) * CS + lx] = e[3];
      if (e[3] !== B.AIR && y > chunk.maxY) chunk.maxY = y;
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
      onEdit: (msg) => this.applyRemoteEdit(msg),
      onRoster: () => UI.renderRoom(),
      onPlayerJoin: (id, p) => { UI.toast(p.name + ' 님이 참여했어요', 2600); UI.renderRoom(); },
      onPlayerLeave: (id, p) => { UI.toast((p ? p.name : '플레이어') + ' 님이 나갔어요', 2600); UI.renderRoom(); },
      onDisconnect: () => { UI.toast('방 연결이 끊어졌어요', 4000); this.clearAvatars(); UI.renderRoom(); },
      onHostClosed: () => { UI.toast('방장이 방을 닫았어요', 4000); this.clearAvatars(); UI.renderRoom(); }
    };
  };

  Game.hostRoom = function (mode, seedText, code, name) {
    const seed = this.hashSeed(seedText);
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
    this.start(mode, seedText, { seed });
  };

  Game.joinRoom = function (code, name) {
    UI.hideMenu();
    UI.setLoading(true, '방에 접속하는 중...');
    const handlers = this.netHandlers();
    handlers.onWelcome = (msg) => {
      this.start(msg.mode, '', {
        seed: msg.seed,
        edits: msg.edits,
        dayTime: msg.dayTime
      });
      if (msg.spawn) {
        this.spawnPoint = msg.spawn;
        this.player.pos.x = msg.spawn.x;
        this.player.pos.y = msg.spawn.y + 1;
        this.player.pos.z = msg.spawn.z;
      }
      UI.toast('방 ' + code + ' 에 참여했어요', 3000);
      UI.renderRoom();
    };
    handlers.onError = (err) => {
      Net.reset();
      UI.setLoading(false);
      UI.showMenu();
      UI.setNetStatus(UI.netErrorText(err));
    };
    Net.joinRoom(code, name, handlers);
  };

  Game.leaveRoom = function () {
    Net.leave();
    this.clearAvatars();
    UI.renderRoom();
    UI.toast('방에서 나왔어요', 2200);
  };

  Game.spawnPlayer = function () {
    const w = this.world;
    let sx = 0, sz = 0, sy = WorldConst.SEA_LEVEL + 1;
    let found = false;
    for (let r = 0; r < 14 && !found; r++) {
      for (let a = 0; a < 14 && !found; a++) {
        const x = Math.round(Math.cos(a * 0.9) * r * 7);
        const z = Math.round(Math.sin(a * 0.9) * r * 7);
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

    const stack = this.inventory.selectedStack();
    if (!stack) { UI.toast('손에 든 블록이 없어요', 1200); return; }
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
          this.world.setBlock(f.x, f.y, f.z, lit ? B.FURNACE_LIT : B.FURNACE);
        }
      }
      if (f === open && (active || f.cook > 0)) openChanged = true;
    }

    if (openChanged) {
      this._furnaceUiTimer = (this._furnaceUiTimer || 0) + dt;
      if (this._furnaceUiTimer > 0.2) {
        this._furnaceUiTimer = 0;
        UI.renderScreen();
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
    const hit = Controls.state.mining && !this.paused && !this.player.dead
      ? this.targetAt(Controls.state.pointX, Controls.state.pointY)
      : null;

    if (!hit) {
      m.target = null;
      m.progress = 0;
      this.crackMesh.visible = false;
      return;
    }

    if (!m.target || m.target.x !== hit.x || m.target.y !== hit.y || m.target.z !== hit.z) {
      m.target = { x: hit.x, y: hit.y, z: hit.z };
      m.progress = 0;
    }

    const stack = this.inventory.selectedStack();
    const toolDef = stack ? Items.get(stack.id) : null;
    const seconds = this.mode === 'creative' ? 0.12 : B.mineTime(hit.id, toolDef);
    if (!isFinite(seconds)) {
      this.crackMesh.visible = false;
      return;
    }

    m.progress += dt / seconds;
    if (m.progress >= 1) {
      this.breakBlock(hit.x, hit.y, hit.z, hit.id);
      m.target = null;
      m.progress = 0;
      this.crackMesh.visible = false;
      return;
    }

    const stage = Math.min(3, Math.floor(m.progress * 4));
    this.crackMaterial.map = Textures.crackTextures[stage];
    this.crackMaterial.needsUpdate = true;
    this.crackMesh.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
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
      if (d.age > 0.4 && dist < 3.2) {
        const pull = Math.min(1, (3.2 - dist) / 3.2 + 0.25) * 7 * dt;
        d.x += (p.pos.x - d.x) * pull;
        d.z += (p.pos.z - d.z) * pull;
        d.y += (p.pos.y + 0.6 - d.y) * pull;
      }
      if (d.age > 0.4 && dist < 1.1) {
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
        const g = this.world.groundY(Math.floor(p.pos.x), Math.floor(p.pos.z));
        if (g >= 0) {
          p.pos.y = g + 1.2;
          this.spawnPoint.y = p.pos.y;
        }
      }
      this.syncCamera();
      this.renderer.render(this.scene, this.camera);
      return;
    }

    Controls.tickHold();
    const look = Controls.consumeLook();
    p.yaw -= look.x * Controls.LOOK_SENS;
    p.pitch -= look.y * Controls.LOOK_SENS;
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
    this.updateSky(dt);
    if (Net.active) Net.sendPos(p);
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
      '청크 ' + this.world.chunks.size + '   드롭 ' + this.drops.length,
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
      onTap: (x, y) => this.tryPlace(x, y)
    });

    document.querySelectorAll('[data-start-mode]').forEach((btn) => {
      Controls.bindTap(btn, () => this.start(btn.dataset.startMode, el('seedInput').value));
    });
    document.querySelectorAll('[data-respawn-mode]').forEach((btn) => {
      Controls.bindTap(btn, () => this.respawn(btn.dataset.respawnMode));
    });

    UI.showMenu();
    this.loop();
  };

  global.Game = Game;
  window.addEventListener('load', () => Game.boot());
})(window);
