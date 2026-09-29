(function (global) {
  'use strict';

  // The square sun and moon, the stars at night and the flat blocky cloud layer.
  // All of it follows the camera, so it always sits "at infinity".
  const DIST = 260;
  const CLOUD_Y = 96;
  const CLOUD_CELL = 12;          // blocks per cloud texel, as in Minecraft
  const CLOUD_TEX = 64;
  const CLOUD_RADIUS = 230;

  function canvasTexture(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }

  function sunTexture() {
    return canvasTexture(16, (g) => {
      g.clearRect(0, 0, 16, 16);
      g.fillStyle = 'rgba(255, 236, 140, 0.35)';
      g.fillRect(1, 1, 14, 14);
      g.fillStyle = '#fff6b0';
      g.fillRect(3, 3, 10, 10);
      g.fillStyle = '#ffffff';
      g.fillRect(5, 5, 6, 6);
    });
  }

  function moonTexture() {
    return canvasTexture(16, (g) => {
      g.clearRect(0, 0, 16, 16);
      g.fillStyle = '#d9dde6';
      g.fillRect(3, 3, 10, 10);
      g.fillStyle = '#b3b9c7';
      g.fillRect(5, 5, 2, 2);
      g.fillRect(9, 8, 3, 2);
      g.fillRect(6, 10, 2, 1);
      g.fillStyle = '#eef1f7';
      g.fillRect(4, 4, 2, 1);
    });
  }

  function cloudTexture() {
    let s = 7;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const t = canvasTexture(CLOUD_TEX, (g, n) => {
      g.clearRect(0, 0, n, n);
      g.fillStyle = '#ffffff';
      // blobs of cells, the way Minecraft's clouds.png looks
      for (let i = 0; i < 70; i++) {
        const x = Math.floor(rnd() * n), y = Math.floor(rnd() * n);
        const w = 2 + Math.floor(rnd() * 6), h = 1 + Math.floor(rnd() * 4);
        for (let dx = 0; dx < w; dx++) {
          for (let dy = 0; dy < h; dy++) {
            if (rnd() < 0.18) continue;
            g.fillRect((x + dx) % n, (y + dy) % n, 1, 1);
          }
        }
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  const Sky = {};

  Sky.init = function (scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    const quad = new THREE.PlaneGeometry(1, 1);
    const flat = (tex) => new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, fog: false
    });
    this.sun = new THREE.Mesh(quad, flat(sunTexture()));
    this.sun.scale.set(34, 34, 1);
    this.moon = new THREE.Mesh(quad, flat(moonTexture()));
    this.moon.scale.set(24, 24, 1);
    for (const m of [this.sun, this.moon]) {
      m.renderOrder = -10;
      this.group.add(m);
    }

    const starPos = [];
    let s = 99;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 520; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      if (u < -0.1) continue;                  // none below the horizon
      starPos.push(Math.cos(a) * r * DIST, u * DIST, Math.sin(a) * r * DIST);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.renderOrder = -11;
    this.group.add(this.stars);

    this.cloudUniforms = {
      map: { value: cloudTexture() },
      offset: { value: new THREE.Vector2(0, 0) },
      camPos: { value: new THREE.Vector3() },
      bright: { value: 1 },
      radius: { value: CLOUD_RADIUS },
      cell: { value: CLOUD_CELL * CLOUD_TEX }
    };
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: [
        'varying vec3 vWorld;',
        'void main() {',
        '  vec4 w = modelMatrix * vec4(position, 1.0);',
        '  vWorld = w.xyz;',
        '  gl_Position = projectionMatrix * viewMatrix * w;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D map;',
        'uniform vec2 offset;',
        'uniform vec3 camPos;',
        'uniform float bright;',
        'uniform float radius;',
        'uniform float cell;',
        'varying vec3 vWorld;',
        'void main() {',
        '  vec4 c = texture2D(map, (vWorld.xz + offset) / cell);',
        '  if (c.a < 0.5) discard;',
        '  float d = length(vWorld.xz - camPos.xz);',
        '  float fade = 1.0 - smoothstep(radius * 0.5, radius, d);',
        '  gl_FragColor = vec4(vec3(bright), 0.82 * fade);',
        '}'
      ].join('\n')
    });
    const cloudGeo = new THREE.PlaneGeometry(CLOUD_RADIUS * 2, CLOUD_RADIUS * 2);
    cloudGeo.rotateX(-Math.PI / 2);
    this.clouds = new THREE.Mesh(cloudGeo, cloudMat);
    this.clouds.renderOrder = -5;
    scene.add(this.clouds);
    this._drift = 0;
  };

  Sky.update = function (camera, dayTime, dt) {
    if (!this.group) return;
    const cam = camera.position;
    this.group.position.copy(cam);

    const ang = dayTime * Math.PI * 2 - Math.PI / 2;
    const sx = Math.cos(ang), sy = Math.sin(ang);
    this.sun.position.set(sx * DIST, sy * DIST, 0);
    this.moon.position.set(-sx * DIST, -sy * DIST, 0);
    this.sun.lookAt(cam);
    this.moon.lookAt(cam);
    this.sun.visible = sy > -0.25;
    this.moon.visible = sy < 0.25;

    const night = THREE.MathUtils.clamp(-sy * 3 + 0.2, 0, 1);
    this.starMat.opacity = night * 0.9;
    this.stars.visible = night > 0.02;
    this.stars.rotation.y = dayTime * Math.PI * 2 * 0.25;

    // clouds drift slowly west, like Minecraft's
    this._drift += dt * 1.2;
    const u = this.cloudUniforms;
    u.offset.value.set(this._drift, 0);
    u.camPos.value.copy(cam);
    u.bright.value = 0.35 + THREE.MathUtils.clamp(sy * 1.6 + 0.35, 0, 1) * 0.65;
    this.clouds.position.set(cam.x, CLOUD_Y, cam.z);
  };

  Sky.setVisible = function (on) {
    if (!this.group) return;
    this.group.visible = on;
    this.clouds.visible = on;
  };

  global.Sky = Sky;
})(window);
