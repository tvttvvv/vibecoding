(function (global) {
  'use strict';

  const B = Blocks;
  const G = 30;

  function solidAt(world, x, y, z) {
    const id = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return id !== B.AIR && B.byId[id].solid;
  }

  const Entities = {
    particles: [],
    orbs: [],
    falling: [],
    boats: [],
    _pool: [],
    riding: null
  };

  Entities.init = function (game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.orbMat = new THREE.MeshBasicMaterial({ color: 0xc8f04a, fog: false });
    this.orbGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    this.critMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0, fog: false });
    this.critGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    this.boatMat = new THREE.MeshBasicMaterial({ map: Textures.texture });
  };

  Entities.clear = function () {
    for (const list of [this.particles, this.orbs, this.falling, this.boats]) {
      for (const e of list) this.group.remove(e.mesh);
      list.length = 0;
    }
    this.riding = null;
  };

  // ------------------------------------------------------------- particles
  Entities.burst = function (x, y, z, id, count, spread, size) {
    const geo = this.game.blockGeometry(id, size || 0.1);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, this.game.itemMaterial);
      const s = spread || 0.4;
      const px = x + (Math.random() - 0.5) * s * 2, py = y + (Math.random() - 0.5) * s * 2, pz = z + (Math.random() - 0.5) * s * 2;
      mesh.position.set(px, py, pz);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.group.add(mesh);
      this.particles.push({
        mesh, x: px, y: py, z: pz,
        vx: (px - x) * 5 + (Math.random() - 0.5), vy: 2 + Math.random() * 3, vz: (pz - z) * 5 + (Math.random() - 0.5),
        life: 0.5 + Math.random() * 0.5
      });
    }
  };

  Entities.crit = function (x, y, z) {
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(this.critGeo, this.critMat);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        mesh, x, y, z, vx: Math.cos(a) * 3, vy: 2 + Math.random() * 3, vz: Math.sin(a) * 3,
        life: 0.4 + Math.random() * 0.3, noGravity: true
      });
    }
  };

  Entities.updateParticles = function (dt) {
    const world = this.game.world;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.group.remove(p.mesh); this.particles.splice(i, 1); continue; }
      if (!p.noGravity) p.vy -= G * 0.6 * dt;
      else { p.vx *= 0.9; p.vz *= 0.9; p.vy *= 0.9; }
      const ny = p.y + p.vy * dt;
      if (!p.noGravity && solidAt(world, p.x, ny - 0.05, p.z)) { p.vy = 0; p.vx *= 0.6; p.vz *= 0.6; }
      else p.y = ny;
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      const s = Math.min(1, p.life * 3);
      p.mesh.scale.set(s, s, s);
    }
  };

  // ------------------------------------------------------------- xp orbs
  // Minecraft splits experience into orbs of a few fixed sizes
  Entities.dropXp = function (x, y, z, amount) {
    let left = Math.floor(amount);
    if (Math.random() < amount - left) left++;
    while (left > 0) {
      const v = left >= 17 ? 17 : left >= 7 ? 7 : left >= 3 ? 3 : 1;
      left -= v;
      const mesh = new THREE.Mesh(this.orbGeo, this.orbMat);
      const s = 0.7 + Math.min(v, 17) / 17 * 0.8;
      mesh.scale.set(s, s, s);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      this.orbs.push({
        mesh, value: v, x, y, z,
        vx: (Math.random() - 0.5) * 2.4, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 2.4,
        age: 0
      });
    }
  };

  Entities.updateOrbs = function (dt) {
    const game = this.game, world = game.world, p = game.player;
    const t = performance.now() / 1000;
    this.orbMat.color.setHSL(0.2 + Math.sin(t * 6) * 0.04, 0.9, 0.55);
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.age += dt;
      const dx = p.pos.x - o.x, dy = p.pos.y + 0.9 - o.y, dz = p.pos.z - o.z;
      const dist = Math.hypot(dx, dy, dz);
      if (o.age > 0.5 && dist < 7 && !p.dead) {
        const pull = (1 - dist / 7) * 14 * dt;
        o.vx += dx / dist * pull * 6; o.vy += dy / dist * pull * 6; o.vz += dz / dist * pull * 6;
      }
      o.vy -= G * 0.4 * dt;
      o.vx *= 0.94; o.vz *= 0.94;
      const ny = o.y + o.vy * dt;
      if (solidAt(world, o.x, ny - 0.1, o.z)) { o.vy = 0; } else o.y = ny;
      o.x += o.vx * dt; o.z += o.vz * dt;
      if (o.age > 0.5 && dist < 1.1 && !p.dead) {
        game.addXp(o.value);
        this.group.remove(o.mesh);
        this.orbs.splice(i, 1);
        continue;
      }
      if (o.age > 300) { this.group.remove(o.mesh); this.orbs.splice(i, 1); continue; }
      o.mesh.position.set(o.x, o.y + Math.sin(o.age * 4) * 0.04, o.z);
    }
  };

  // ------------------------------------------------------ falling blocks
  Entities.fall = function (x, y, z, id) {
    const mesh = new THREE.Mesh(this.game.blockGeometry(id, 0.999), this.game.itemMaterial);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.group.add(mesh);
    this.falling.push({ mesh, id, x, y, z, vy: 0 });
  };

  Entities.updateFalling = function (dt) {
    const game = this.game, world = game.world;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.vy = Math.max(-40, f.vy - G * dt);
      f.y += f.vy * dt;
      const cell = Math.floor(f.y);
      const below = world.getBlock(f.x, cell, f.z);
      if (f.y < 0 || (below !== B.AIR && B.byId[below].solid)) {
        const ly = cell + 1;
        const here = world.getBlock(f.x, ly, f.z);
        const def = B.byId[here];
        if (ly < WorldConst.WORLD_HEIGHT && (here === B.AIR || def.liquid || def.replaceable)) {
          game.changeBlock(f.x, ly, f.z, f.id);
          Sound.place(f.id, game.distTo(f.x, ly, f.z));
        } else if (game.mode === 'survival') {
          game.spawnDrop(f.x + 0.5, ly + 0.5, f.z + 0.5, f.id, 1);
        }
        this.group.remove(f.mesh);
        this.falling.splice(i, 1);
        continue;
      }
      f.mesh.position.set(f.x + 0.5, f.y + 0.5, f.z + 0.5);
      // anyone standing under it takes a knock, as with Minecraft's anvils-lite
      const p = game.player;
      if (Math.abs(p.pos.x - (f.x + 0.5)) < 0.8 && Math.abs(p.pos.z - (f.z + 0.5)) < 0.8 &&
          f.y < p.pos.y + 1.8 && f.y > p.pos.y) {
        p.pos.y = Math.min(p.pos.y, f.y - 1.8);
      }
    }
  };

  // --------------------------------------------------------------- boats
  function boatMesh(mat) {
    const g = new THREE.Group();
    const T = Textures.tileUV(B.byId[B.PLANKS].side);
    const box = (w, h, d, x, y, z) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) ? T.u1 : T.u0, uv.getY(i) ? T.v1 : T.v0);
      }
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
    };
    box(1.2, 0.12, 1.9, 0, 0.06, 0);
    box(0.1, 0.4, 1.9, -0.6, 0.3, 0);
    box(0.1, 0.4, 1.9, 0.6, 0.3, 0);
    box(1.3, 0.4, 0.1, 0, 0.3, -0.95);
    box(1.3, 0.4, 0.1, 0, 0.3, 0.95);
    return g;
  }

  // Boats are shared in a room: whoever places, rides or breaks one tells the
  // others through onChange, and a boat someone else is steering just follows
  // what they send instead of running its own physics.
  Entities.placeBoat = function (x, y, z, yaw, id, quiet) {
    const mesh = boatMesh(this.boatMat);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    const boat = {
      mesh, x, y, z, yaw: yaw || 0, speed: 0, vy: 0, hits: 0,
      id: id || ('b' + Math.random().toString(36).slice(2, 9)),
      rider: null, remoteUntil: 0
    };
    mesh.userData.boat = boat;
    this.boats.push(boat);
    if (!quiet) this.changed(boat, 'set');
    return boat;
  };

  Entities.changed = function (boat, op) {
    if (this.onChange) this.onChange(boat, op);
  };

  Entities.boatById = function (id) {
    for (const b of this.boats) if (b.id === id) return b;
    return null;
  };

  Entities.applyRemoteBoat = function (msg) {
    let boat = this.boatById(msg.id);
    if (msg.op === 'del') {
      if (boat) {
        if (this.riding === boat) this.dismount();
        const i = this.boats.indexOf(boat);
        if (i >= 0) this.boats.splice(i, 1);
        this.group.remove(boat.mesh);
      }
      return;
    }
    if (!boat) boat = this.placeBoat(msg.x, msg.y, msg.z, msg.yaw, msg.id, true);
    boat.rider = msg.rider || null;
    boat.tx = msg.x; boat.ty = msg.y; boat.tz = msg.z; boat.tyaw = msg.yaw;
    if (boat.rider) boat.remoteUntil = performance.now() + 1500;
    else { boat.x = msg.x; boat.y = msg.y; boat.z = msg.z; boat.yaw = msg.yaw; boat.remoteUntil = 0; }
  };

  Entities.boatAt = function (screenX, screenY, reach) {
    if (!this.boats.length) return null;
    const game = this.game;
    const ray = game.rayFrom(screenX, screenY);
    ray.far = reach || 4.5;
    const hits = ray.intersectObjects(this.boats.map((b) => b.mesh), true);
    ray.far = Infinity;
    if (!hits.length) return null;
    let n = hits[0].object;
    while (n && !n.userData.boat) n = n.parent;
    return n ? { boat: n.userData.boat, distance: hits[0].distance } : null;
  };

  Entities.removeBoat = function (boat, drop) {
    if (this.riding === boat) this.dismount();
    const i = this.boats.indexOf(boat);
    if (i >= 0) this.boats.splice(i, 1);
    this.group.remove(boat.mesh);
    this.changed(boat, 'del');
    if (drop && this.game.mode === 'survival') this.game.spawnDrop(boat.x, boat.y + 0.5, boat.z, Items.BOAT, 1);
  };

  Entities.mount = function (boat) {
    if (boat.rider && boat.remoteUntil > performance.now()) return false;
    this.riding = boat;
    boat.rider = this.game.myName ? this.game.myName() : 'me';
    this.changed(boat, 'set');
    const p = this.game.player;
    p.vel.x = p.vel.y = p.vel.z = 0;
    p.flying = false;
  };

  Entities.dismount = function () {
    const boat = this.riding;
    if (!boat) return;
    this.riding = null;
    boat.rider = null;
    this.changed(boat, 'set');
    const p = this.game.player;
    const world = this.game.world;
    // step off to the side that has room, else straight up
    const tries = [[1.2, 0], [-1.2, 0], [0, 1.4], [0, -1.4]];
    let placed = false;
    for (const [ox, oz] of tries) {
      const c = Math.cos(boat.yaw), s = Math.sin(boat.yaw);
      const x = boat.x + ox * c + oz * s, z = boat.z - ox * s + oz * c;
      const y = Math.floor(boat.y + 0.6);
      if (!solidAt(world, x, y, z) && !solidAt(world, x, y + 1, z) && solidAt(world, x, y - 1, z)) {
        p.pos.x = x; p.pos.y = y + 0.01; p.pos.z = z;
        placed = true;
        break;
      }
    }
    if (!placed) { p.pos.x = boat.x; p.pos.y = boat.y + 1; p.pos.z = boat.z; }
    p.vel.y = 0;
    p.fallStartY = p.pos.y;
  };

  function waterSurface(world, x, y, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let yy = Math.floor(y) + 1; yy >= Math.floor(y) - 1; yy--) {
      if (B.byId[world.getBlock(bx, yy, bz)].liquid) return yy + 0.875;
    }
    return null;
  }

  Entities.updateBoats = function (dt, input) {
    const game = this.game, world = game.world;
    const now = performance.now();
    for (const boat of this.boats) {
      const ridden = this.riding === boat;
      // someone else is steering this one: glide to where they say it is
      if (!ridden && boat.remoteUntil > now && boat.tx !== undefined) {
        const k = Math.min(1, dt * 10);
        boat.x += (boat.tx - boat.x) * k; boat.y += (boat.ty - boat.y) * k; boat.z += (boat.tz - boat.z) * k;
        let dy = boat.tyaw - boat.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        boat.yaw += dy * k;
        boat.mesh.position.set(boat.x, boat.y, boat.z);
        boat.mesh.rotation.y = boat.yaw;
        continue;
      }
      const surface = waterSurface(world, boat.x, boat.y, boat.z);
      const onWater = surface !== null;

      if (ridden) {
        const turn = -input.move.x * 1.9 * dt;
        boat.yaw += turn;
        game.player.yaw += turn;
        const max = onWater ? 8 : 1.2;
        const accel = input.move.y * (onWater ? 7 : 3);
        boat.speed += accel * dt;
        boat.speed = Math.max(-max * 0.4, Math.min(max, boat.speed));
      }
      boat.speed *= Math.exp(-(onWater ? 0.9 : 6) * dt);
      if (Math.abs(boat.speed) < 0.02) boat.speed = 0;

      if (onWater) {
        const target = surface - 0.28;
        boat.vy += (target - boat.y) * 30 * dt;
        boat.vy *= Math.exp(-6 * dt);
      } else {
        boat.vy -= G * dt;
      }

      const nx = boat.x - Math.sin(boat.yaw) * boat.speed * dt;
      const nz = boat.z - Math.cos(boat.yaw) * boat.speed * dt;
      const hy = boat.y + 0.3;
      if (!solidAt(world, nx, hy, boat.z)) boat.x = nx; else boat.speed *= -0.2;
      if (!solidAt(world, boat.x, hy, nz)) boat.z = nz; else boat.speed *= -0.2;

      const ny = boat.y + boat.vy * dt;
      if (boat.vy < 0 && solidAt(world, boat.x, ny, boat.z)) {
        boat.y = Math.floor(ny) + 1;
        boat.vy = 0;
      } else {
        boat.y = ny;
      }
      if (boat.y < -5) { this.removeBoat(boat, false); break; }

      boat.mesh.position.set(boat.x, boat.y, boat.z);
      boat.mesh.rotation.y = boat.yaw;

      if (ridden) {
        boat.sendT = (boat.sendT || 0) - dt;
        if (boat.sendT <= 0) { boat.sendT = 0.1; this.changed(boat, 'set'); }
        const p = game.player;
        p.pos.x = boat.x; p.pos.y = boat.y + 0.12; p.pos.z = boat.z;
        p.vel.x = p.vel.y = p.vel.z = 0;
        p.fallStartY = p.pos.y;
        p.onGround = true;
        p.inWater = false;
        p.headInWater = false;
      }
    }
  };

  // --------------------------------------------------------------- saving
  Entities.snapshotBoats = function () {
    return this.boats.map((b) => ['b', +b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2), +b.yaw.toFixed(2), b.id]);
  };

  Entities.update = function (dt, input) {
    this.updateParticles(dt);
    this.updateOrbs(dt);
    this.updateFalling(dt);
    this.updateBoats(dt, input);
  };

  global.Entities = Entities;
})(window);
