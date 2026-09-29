(function (global) {
  'use strict';

  // First-person view of your own arm or whatever you are holding, drawn in its
  // own little scene on top of the world so it never clips into walls.
  const SKIN = 0xc99b7c;

  const Hand = {
    swingT: 1,
    bob: 0,
    heldId: -1,
    lower: 0
  };

  Hand.init = function (game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.armMat = new THREE.MeshBasicMaterial({ color: SKIN });
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.5), this.armMat);
    this.itemMat = new THREE.MeshBasicMaterial({ map: Textures.texture, alphaTest: 0.5 });
    this.item = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), this.itemMat);
    this.root.add(this.arm);
    this.root.add(this.item);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  };

  Hand.swing = function () {
    // restarting mid-swing is what makes holding the button look like chopping
    if (this.swingT > 0.55) this.swingT = 0;
  };

  Hand.setHeld = function (id) {
    if (id === this.heldId) return;
    this.heldId = id;
    this.lower = 1;                 // dips out and back in when you switch items
    if (!id) {
      this.arm.visible = true;
      this.item.visible = false;
      return;
    }
    const isBlock = Items.isBlock(id);
    const def = Items.get(id);
    const flat = !isBlock || (def && def.render === 'cross');
    this.item.geometry = flat
      ? this.game.flatItemGeometry(id)
      : this.game.blockGeometry(id, 0.2);
    this.item.userData.flat = flat;
    this.item.userData.tool = !!(def && def.tool);
    this.arm.visible = false;
    this.item.visible = true;
  };

  Hand.update = function (dt, player, stack, brightness, mining) {
    this.setHeld(stack ? stack.id : 0);

    if (mining) this.swing();
    if (this.swingT < 1) this.swingT = Math.min(1, this.swingT + dt / 0.3);
    if (this.lower > 0) this.lower = Math.max(0, this.lower - dt * 5);

    const speed = Math.hypot(player.vel.x, player.vel.z);
    if (player.onGround && speed > 0.3) this.bob += dt * speed * 2.1;
    const bx = Math.sin(this.bob) * 0.022 * Math.min(1, speed / 4);
    const by = -Math.abs(Math.cos(this.bob)) * 0.028 * Math.min(1, speed / 4);

    const s = Math.sin(this.swingT * Math.PI);
    const s2 = Math.sin(Math.sqrt(this.swingT) * Math.PI);
    const drop = this.lower * 0.45;

    this.root.position.set(bx - s2 * 0.12, by - s * 0.12 - drop, -s2 * 0.05);
    this.root.rotation.set(-s * 0.9, s2 * 0.35, 0);

    if (this.arm.visible) {
      this.arm.position.set(0.4, -0.4, -0.62);
      this.arm.rotation.set(0.35, 0.28, 0.1);
    }
    if (this.item.visible) {
      if (this.item.userData.flat) {
        this.item.scale.setScalar(0.62);
        this.item.position.set(0.4, -0.3, -0.62);
        this.item.rotation.set(0, -1.25, this.item.userData.tool ? 0.35 : 0.1);
      } else {
        this.item.scale.setScalar(1);
        this.item.position.set(0.42, -0.36, -0.7);
        this.item.rotation.set(0.12, 0.8, 0);
      }
    }

    const b = Math.max(0.12, Math.min(1, brightness));
    this.armMat.color.setHex(SKIN).multiplyScalar(b);
    this.itemMat.color.setScalar(b);
  };

  Hand.render = function (renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  };

  global.Hand = Hand;
})(window);
