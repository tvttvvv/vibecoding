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

    this.fallStartY = this.pos.y;
    this._regenTimer = 0;
    this._starveTimer = 0;
    this._drownTimer = 0;
    this.hurtFlash = 0;
  }

  Player.prototype.eyeY = function () { return this.pos.y + EYE; };

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

    const x0 = Math.floor(this.pos.x - HALF_W), x1 = Math.floor(this.pos.x + HALF_W);
    const y0 = Math.floor(this.pos.y + EPS), y1 = Math.floor(this.pos.y + HEIGHT - EPS);
    const z0 = Math.floor(this.pos.z - HALF_W), z1 = Math.floor(this.pos.z + HALF_W);

    let hit = false, limit = 0;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (!solidAt(world, x, y, z)) continue;
          const cell = axis === 'x' ? x : axis === 'y' ? y : z;
          let bound;
          if (amount > 0) {
            bound = cell - (axis === 'y' ? HEIGHT : HALF_W) - EPS;
            if (!hit || bound < limit) limit = bound;
          } else {
            bound = cell + 1 + (axis === 'y' ? 0 : HALF_W) + EPS;
            if (!hit || bound > limit) limit = bound;
          }
          hit = true;
        }
      }
    }

    if (!hit) return;
    this.pos[axis] = limit;
    if (axis === 'y') {
      if (amount < 0) this.onGround = true;
      this.vel.y = 0;
    } else {
      this.blocked = true;
    }
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

    const mag = Math.hypot(input.move.x, input.move.y);
    this.sprinting = !this.flying && mag > 0.92 && this.food > 6 && !this.inWater;

    let speed;
    if (this.flying) speed = FLY_SPEED;
    else if (this.inWater) speed = SWIM_SPEED;
    else speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const fx = -sin, fz = -cos;
    const rx = cos, rz = -sin;
    let mx = (fx * input.move.y + rx * input.move.x);
    let mz = (fz * input.move.y + rz * input.move.x);
    const mlen = Math.hypot(mx, mz);
    if (mlen > 1) { mx /= mlen; mz /= mlen; }

    const prevX = this.pos.x, prevZ = this.pos.z;
    this.blocked = false;
    this.onGround = false;

    if (this.flying) {
      this.vel.y = 0;
      let vy = 0;
      if (input.up) vy += FLY_SPEED;
      if (input.down) vy -= FLY_SPEED;
      this._moveAxis(world, 'x', mx * speed * dt);
      this._moveAxis(world, 'z', mz * speed * dt);
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

      this._moveAxis(world, 'x', mx * speed * dt);
      this._moveAxis(world, 'z', mz * speed * dt);

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

    if (this.headInWater) {
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
    }
    amount = Math.max(0, Math.round(amount * 2) / 2);
    this.health = Math.max(0, this.health - amount);
    this.hurtFlash = 0.35;
    if (this.health <= 0) this.dead = true;
  };

  Player.prototype.eat = function (foodPoints, saturationPoints) {
    this.food = Math.min(20, this.food + foodPoints);
    this.saturation = Math.min(this.food, this.saturation + saturationPoints);
  };

  global.Player = Player;
  global.PlayerConst = { HALF_W, HEIGHT, EYE, MAX_AIR };
})(window);
