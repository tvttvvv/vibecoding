(function (global) {
  'use strict';

  const B = Blocks;
  const HALF_W = 0.3;
  const HEIGHT = 1.8;
  const EYE = 1.62;
  const EPS = 1e-3;

  const GRAVITY = 30;
  const JUMP_V = 8.6;
  const WALK_SPEED = 4.4;
  const SPRINT_SPEED = 5.7;
  const SWIM_SPEED = 2.4;
  const SNEAK_SPEED = 1.3;
  const SNEAK_EYE = 1.27;
  const FLY_SPEED = 11;
  const MAX_FALL = 55;
  const MAX_AIR = 15;

  // Water is buoyant, not weightless: you ease up while holding jump and sink
  // slowly when you let go. Rising is capped below walking speed so bobbing at
  // the surface can never beat travelling on land.
  const WATER_GRAVITY = 9;
  const WATER_SINK_MAX = -1.6;
  const WATER_RISE_ACCEL = 15;
  const WATER_RISE_MAX = 2.2;
  const WATER_CLIMB_V = 3.4;

  // Horizontal speed carries between frames. On the ground you reach the speed
  // you asked for almost at once; in mid-air you only nudge it, so a jump keeps
  // the direction it started with instead of turning on a coin.
  const ACCEL_GROUND = 18;
  const ACCEL_AIR = 3.2;
  const ACCEL_WATER = 9;
  const ACCEL_FLY = 24;

  function Player(mode) {
    this.pos = { x: 0.5, y: 40, z: 0.5 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.mode = mode;
    this.flying = mode === 'creative';
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.blocked = false;
    this.sprinting = false;

    this.health = 20;
    this.maxHealth = 20;
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = MAX_AIR;
    this.dead = false;

    this.knockX = 0;
    this.knockZ = 0;
    this.fallStartY = this.pos.y;
    this._regenTimer = 0;
    this._starveTimer = 0;
    this._drownTimer = 0;
    this.hurtFlash = 0;
  }

  // the camera eases down when you crouch rather than snapping
  Player.prototype.eyeY = function () { return this.pos.y + (this.eye || EYE); };

  // is there anything under the body's footprint to stand on?
  Player.prototype.supported = function (world, x, z) {
    const y = Math.floor(this.pos.y - 0.05);
    const x0 = Math.floor(x - HALF_W + 0.01), x1 = Math.floor(x + HALF_W - 0.01);
    const z0 = Math.floor(z - HALF_W + 0.01), z1 = Math.floor(z + HALF_W - 0.01);
    for (let bx = x0; bx <= x1; bx++) {
      for (let bz = z0; bz <= z1; bz++) if (solidAt(world, bx, y, bz)) return true;
    }
    return false;
  };

  Player.prototype.forward = function (out) {
    out.x = -Math.sin(this.yaw);
    out.y = 0;
    out.z = -Math.cos(this.yaw);
    return out;
  };

  Player.prototype.lookDir = function (out) {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp;
    out.y = Math.sin(this.pitch);
    out.z = -Math.cos(this.yaw) * cp;
    return out;
  };

  function solidAt(world, x, y, z) {
    const id = world.getBlock(x, y, z);
    return id !== B.AIR && B.byId[id].solid;
  }

  Player.prototype._moveAxis = function (world, axis, amount) {
    if (!amount) return;
    this.pos[axis] += amount;
    const limit = world.collideLimit(
      this.pos.x - HALF_W, this.pos.y, this.pos.z - HALF_W,
      this.pos.x + HALF_W, this.pos.y + HEIGHT, this.pos.z + HALF_W, axis, amount);
    if (limit === null) return;
    const ext = axis === 'y' ? HEIGHT : HALF_W;
    this.pos[axis] = amount > 0 ? limit - ext - EPS : limit + (axis === 'y' ? 0 : HALF_W) + EPS;
    if (axis === 'y') {
      if (amount < 0) this.onGround = true;
      this.vel.y = 0;
    } else {
      this.blocked = true;
      this.vel[axis] = 0;
    }
  };

  // Walking into a slab or a stair lifts you onto it, as Minecraft's 0.6
  // block step does; a full block still needs the little auto-jump.
  const STEP = 0.6;
  Player.prototype._stepAxis = function (world, axis, amount, canStep) {
    if (!amount) return;
    const sx = this.pos.x, sy = this.pos.y, sz = this.pos.z;
    const vAxis = this.vel[axis], vy = this.vel.y;
    const wasBlocked = this.blocked;
    this.blocked = false;
    this._moveAxis(world, axis, amount);
    if (!this.blocked || !canStep) { this.blocked = this.blocked || wasBlocked; return; }

    const got1 = Math.abs(this.pos[axis] - (axis === 'x' ? sx : sz));
    const ex = this.pos.x, ey = this.pos.y, ez = this.pos.z;
    this.pos.x = sx; this.pos.y = sy; this.pos.z = sz;
    this.vel[axis] = vAxis;
    this._moveAxis(world, 'y', STEP);
    const lifted = this.pos.y - sy;
    this.blocked = false;
    this._moveAxis(world, axis, amount);
    const got2 = Math.abs(this.pos[axis] - (axis === 'x' ? sx : sz));
    if (lifted > 0.05 && got2 > got1 + 1e-4) {
      this.onGround = false;
      this._moveAxis(world, 'y', -lifted - 0.01);
      this.vel.y = 0;
      return;
    }
    this.pos.x = ex; this.pos.y = ey; this.pos.z = ez;
    this.vel[axis] = 0;
    this.vel.y = vy;
    this.blocked = true;
  };

  // anything climbable around the body: ladders
  Player.prototype.onLadder = function (world) {
    const x = Math.floor(this.pos.x), z = Math.floor(this.pos.z);
    for (const dy of [0.1, 1.0]) {
      const d = B.byId[world.getBlock(x, Math.floor(this.pos.y + dy), z)];
      if (d && d.climbable) return true;
    }
    return false;
  };

  Player.prototype.update = function (dt, input, world) {
    if (this.dead) return;

    const bx = Math.floor(this.pos.x), bz = Math.floor(this.pos.z);
    const feetBlock = world.getBlock(bx, Math.floor(this.pos.y + 0.1), bz);
    const bodyBlock = world.getBlock(bx, Math.floor(this.pos.y + 0.9), bz);
    const eyeBlock = world.getBlock(bx, Math.floor(this.eyeY()), bz);
    // any part of the body in water keeps water physics, so breaking the
    // surface for a frame cannot hand back land speed and a land jump
    this.inWater = B.byId[feetBlock].liquid || B.byId[bodyBlock].liquid;
    this.headInWater = B.byId[eyeBlock].liquid;
    this.inLava = B.byId[feetBlock].fluid === 'lava' || B.byId[bodyBlock].fluid === 'lava';
    this.headInLava = B.byId[eyeBlock].fluid === 'lava';

    // sneaking: slow, crouched, and it will not walk you off an edge
    this.sneaking = !!input.sneak && !this.flying && !this.inWater;
    const eyeTarget = this.sneaking ? SNEAK_EYE : EYE;
    this.eye = (this.eye || EYE) + (eyeTarget - (this.eye || EYE)) * Math.min(1, dt * 14);

    const mag = Math.hypot(input.move.x, input.move.y);
    // a keyboard says so explicitly; a joystick means it by pushing to the rim
    const wantRun = input.run !== undefined ? !!input.run : mag > 0.92;
    this.sprinting = !this.flying && wantRun && mag > 0.2 && this.food > 6 && !this.inWater;

    if (this.sneaking) this.sprinting = false;
    let speed;
    if (this.flying) speed = FLY_SPEED;
    else if (this.inLava) speed = SWIM_SPEED * 0.45;
    else if (this.inWater) speed = SWIM_SPEED;
    else if (this.sneaking) speed = SNEAK_SPEED;
    else if (B.byId[world.getBlock(bx, Math.floor(this.pos.y - 0.2), bz)].slow) speed = WALK_SPEED * B.byId[world.getBlock(bx, Math.floor(this.pos.y - 0.2), bz)].slow;
    else speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (!this.flying && this.speedMul) speed *= this.speedMul;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const fx = -sin, fz = -cos;
    const rx = cos, rz = -sin;
    let mx = (fx * input.move.y + rx * input.move.x);
    let mz = (fz * input.move.y + rz * input.move.x);
    const mlen = Math.hypot(mx, mz);
    if (mlen > 1) { mx /= mlen; mz /= mlen; }

    const prevX = this.pos.x, prevZ = this.pos.z;
    const grounded = this.onGround;
    this.blocked = false;
    this.onGround = false;

    const accel = this.flying ? ACCEL_FLY
      : this.inWater ? ACCEL_WATER
        : grounded ? ACCEL_GROUND : ACCEL_AIR;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (mx * speed - this.vel.x) * k;
    this.vel.z += (mz * speed - this.vel.z) * k;
    if (Math.abs(this.vel.x) < 0.01) this.vel.x = 0;
    if (Math.abs(this.vel.z) < 0.01) this.vel.z = 0;

    if (this.flying) {
      this.vel.y = 0;
      let vy = 0;
      if (input.up) vy += FLY_SPEED;
      if (input.down) vy -= FLY_SPEED;
      this._moveAxis(world, 'x', this.vel.x * dt);
      this._moveAxis(world, 'z', this.vel.z * dt);
      this._moveAxis(world, 'y', vy * dt);
    } else {
      if (this.inWater) {
        if (input.jump) {
          this.vel.y = Math.min(WATER_RISE_MAX, this.vel.y + WATER_RISE_ACCEL * dt);
        } else {
          this.vel.y = Math.max(WATER_SINK_MAX, this.vel.y - WATER_GRAVITY * dt);
        }
        this.fallStartY = this.pos.y;
      } else {
        this.vel.y -= GRAVITY * dt;
        if (this.vel.y < -MAX_FALL) this.vel.y = -MAX_FALL;
      }

      // ladders: push against one or hold jump to climb, crouch to hang still,
      // otherwise slide down slowly and safely
      this.climbing = this.onLadder(world);
      if (this.climbing) {
        this.fallStartY = this.pos.y;
        if (input.jump || input.move.y > 0.2) this.vel.y = 2.4;
        else if (this.sneaking) this.vel.y = 0;
        else this.vel.y = Math.max(this.vel.y, -2.2);
      }

      const edgeGuard = this.sneaking && grounded;
      const canStep = grounded && !this.inWater;
      const ox = this.pos.x;
      this._stepAxis(world, 'x', this.vel.x * dt, canStep);
      if (edgeGuard && !this.supported(world, this.pos.x, this.pos.z)) { this.pos.x = ox; this.vel.x = 0; }
      const oz = this.pos.z;
      this._stepAxis(world, 'z', this.vel.z * dt, canStep);
      if (edgeGuard && !this.supported(world, this.pos.x, this.pos.z)) { this.pos.z = oz; this.vel.z = 0; }

      const wasAirborne = this.vel.y < -0.1;
      this._moveAxis(world, 'y', this.vel.y * dt);

      if (this.onGround) {
        if (wasAirborne && !this.inWater) {
          const fall = this.fallStartY - this.pos.y;
          const dmg = Math.floor(fall - 3);
          if (dmg > 0) this.hurt(dmg);
        }
        this.fallStartY = this.pos.y;
        if (input.jump && !this.inWater) {
          this.vel.y = JUMP_V;
          this.addExhaustion(this.sprinting ? 0.2 : 0.05);
        }
      } else if (this.pos.y > this.fallStartY) {
        this.fallStartY = this.pos.y;
      }

      if (this.blocked && mlen > 0.1) {
        if (this.inWater) {
          // pressing into the bank lifts you, so you can climb out of water
          this.vel.y = Math.max(this.vel.y, WATER_CLIMB_V);
        } else if (this.onGround && this.canStepUp(world, mx, mz)) {
          this.vel.y = JUMP_V;
        }
      }
    }

    if (this.knockX || this.knockZ) {
      this._moveAxis(world, 'x', this.knockX * dt);
      this._moveAxis(world, 'z', this.knockZ * dt);
      const decay = Math.max(0, 1 - dt * 6);
      this.knockX *= decay;
      this.knockZ *= decay;
      if (Math.abs(this.knockX) < 0.08) this.knockX = 0;
      if (Math.abs(this.knockZ) < 0.08) this.knockZ = 0;
    }

    const moved = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
    if (moved > 0 && !this.flying) {
      this.addExhaustion(moved * (this.sprinting ? 0.1 : 0.01));
    }

    if (this.pos.y < -8) this.hurt(20, true);

    this.updateStats(dt);
  };

  Player.prototype.canStepUp = function (world, mx, mz) {
    const len = Math.hypot(mx, mz) || 1;
    const ax = this.pos.x + (mx / len) * (HALF_W + 0.25);
    const az = this.pos.z + (mz / len) * (HALF_W + 0.25);
    const bx = Math.floor(ax), bz = Math.floor(az);
    const feetY = Math.floor(this.pos.y + 0.1);
    if (!solidAt(world, bx, feetY, bz)) return false;
    if (solidAt(world, bx, feetY + 1, bz)) return false;
    if (solidAt(world, bx, feetY + 2, bz)) return false;
    return true;
  };

  Player.prototype.addExhaustion = function (amount) {
    if (this.mode !== 'survival') return;
    this.exhaustion += amount;
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
  };

  Player.prototype.updateStats = function (dt) {
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    if (this.mode !== 'survival') {
      this.health = this.maxHealth;
      this.food = 20;
      this.air = MAX_AIR;
      return;
    }

    if (this.inLava && !this.fireImmune) {
      this._lavaTimer = (this._lavaTimer || 0) + dt;
      if (this._lavaTimer >= 0.5) { this._lavaTimer = 0; this.hurt(4); }
      this.burning = 3;
    } else {
      this._lavaTimer = 0.5;
    }
    if (this.fireImmune) this.burning = 0;
    // still on fire for a moment after climbing out
    if (this.burning > 0 && !this.inLava) {
      this.burning -= dt;
      if (this.inWater) this.burning = 0;
      this._fireTimer = (this._fireTimer || 0) + dt;
      if (this._fireTimer >= 1) { this._fireTimer = 0; this.hurt(1, true); }
    }

    if (this.headInWater && !this.headInLava) {
      this.air -= dt;
      if (this.air <= 0) {
        this._drownTimer += dt;
        if (this._drownTimer >= 2) { this._drownTimer = 0; this.hurt(2, true); }
        this.air = 0;
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 4);
      this._drownTimer = 0;
    }

    if (this.food >= 18 && this.health < this.maxHealth) {
      this._regenTimer += dt;
      if (this._regenTimer >= 3.5) {
        this._regenTimer = 0;
        this.health = Math.min(this.maxHealth, this.health + 1);
        this.addExhaustion(6);
      }
    } else {
      this._regenTimer = 0;
    }

    if (this.food <= 0) {
      this._starveTimer += dt;
      if (this._starveTimer >= 4) {
        this._starveTimer = 0;
        if (this.health > 1) this.hurt(1, true);
      }
    } else {
      this._starveTimer = 0;
    }
  };

  Player.prototype.hurt = function (amount, ignoreArmor) {
    if (this.mode !== 'survival' || this.dead) return;
    if (!ignoreArmor && this.armorProvider) {
      const points = this.armorProvider.armorPoints();
      if (points > 0) {
        amount = amount * (1 - Math.min(20, points) * 0.04);
        this.armorProvider.damageArmor(1);
      }
      if (this.armorProvider.protection) amount *= 1 - this.armorProvider.protection();
    }
    amount = Math.max(0, Math.round(amount * 2) / 2);
    if (amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtFlash = 0.35;
    this.hurtTilt = 1;
    if (this.onHurt) this.onHurt(amount);
    if (this.health <= 0) this.dead = true;
  };

  Player.prototype.eat = function (foodPoints, saturationPoints) {
    this.food = Math.min(20, this.food + foodPoints);
    this.saturation = Math.min(this.food, this.saturation + saturationPoints);
  };

  global.Player = Player;
  global.PlayerConst = { HALF_W, HEIGHT, EYE, MAX_AIR, SNEAK_EYE };
})(window);
