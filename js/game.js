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

  Game.start = function (mode, seedText) {
    this.mode = mode;
    UI.hideMenu();
    UI.hideDeath();
    UI.setLoading(true, '세계를 만드는 중...');

    let seed = 0;
    if (seedText && seedText.trim()) {
      for (let i = 0; i < seedText.length; i++) seed = (Math.imul(seed, 31) + seedText.charCodeAt(i)) | 0;
    } else {
      seed = (Math.random() * 2147483647) | 0;
    }
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

    this.world = new World(seed);
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
    this.dayTime = 0.42;
    this.mining = { target: null, progress: 0 };
    this._deathHandled = false;
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
  Game.currentTarget = function () {
    const p = this.player;
    const origin = new THREE.Vector3(p.pos.x, p.eyeY(), p.pos.z);
    const dir = new THREE.Vector3();
    p.lookDir(dir);
    return this.world.raycast(origin, dir, REACH);
  };

  Game.tryPlace = function () {
    if (this.paused || !this.started || this.player.dead) return;
    const hit = this.currentTarget();
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

    if (this.world.setBlock(x, y, z, stack.id)) {
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
    const hit = Controls.state.mining && !this.paused && !this.player.dead ? this.currentTarget() : null;

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
    if (!this.world.setBlock(x, y, z, B.AIR)) return;

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
          ? '화면을 꾹 누르면 채굴, 짧게 톡 누르면 블록 설치'
          : '크리에이티브: 비행 버튼으로 날 수 있어요', 4200);
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

    const hit = this.paused || p.dead ? null : this.currentTarget();
    if (hit) {
      this.selectionBox.visible = true;
      this.selectionBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
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
      onTap: () => this.tryPlace()
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
