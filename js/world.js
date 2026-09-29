(function (global) {
  'use strict';

  const CHUNK_SIZE = 16;
  const WORLD_HEIGHT = 80;
  const SEA_LEVEL = 26;
  const B = Blocks;

  const FACES = [
    { normal: [1, 0, 0], tanU: [0, 0, -1], tanV: [0, 1, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 1], [1, 1, 0]] },
    { normal: [-1, 0, 0], tanU: [0, 0, 1], tanV: [0, 1, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1]] },
    { normal: [0, 1, 0], tanU: [1, 0, 0], tanV: [0, 0, -1], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
    { normal: [0, -1, 0], tanU: [1, 0, 0], tanV: [0, 0, 1], corners: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]] },
    { normal: [0, 0, 1], tanU: [1, 0, 0], tanV: [0, 1, 0], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] },
    { normal: [0, 0, -1], tanU: [-1, 0, 0], tanV: [0, 1, 0], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] }
  ];
  const FACE_SHADE = [0.80, 0.80, 1.0, 0.50, 0.66, 0.66];
  const AO_LEVEL = [0.45, 0.63, 0.81, 1.0];
  const CORNER_SIGNS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

  // Flattened face data + block property lookups: the meshing loop runs millions
  // of times per second, so every property access here is hoisted into a table.
  const FACE_N = new Int8Array(18);
  const FACE_TU = new Int8Array(18);
  const FACE_TV = new Int8Array(18);
  const FACE_CORNER = new Int8Array(72);
  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    for (let i = 0; i < 3; i++) {
      FACE_N[f * 3 + i] = face.normal[i];
      FACE_TU[f * 3 + i] = face.tanU[i];
      FACE_TV[f * 3 + i] = face.tanV[i];
    }
    for (let c = 0; c < 4; c++) {
      for (let i = 0; i < 3; i++) FACE_CORNER[f * 12 + c * 3 + i] = face.corners[c][i];
    }
  }

  let OPAQUE = null, LIQUID = null, FACE_TILE_OF = null, TILE_UV = null;
  let CROSS = null, BHEIGHT = null;
  function buildLookups() {
    const n = B.byId.length;
    OPAQUE = new Uint8Array(n);
    LIQUID = new Uint8Array(n);
    CROSS = new Uint8Array(n);
    BHEIGHT = new Float32Array(n);
    FACE_TILE_OF = new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) {
      if (!B.byId[i]) continue;
      OPAQUE[i] = B.byId[i].opaque ? 1 : 0;
      LIQUID[i] = B.byId[i].liquid ? 1 : 0;
      CROSS[i] = B.byId[i].render === 'cross' ? 1 : 0;
      BHEIGHT[i] = B.byId[i].height;
      for (let f = 0; f < 6; f++) FACE_TILE_OF[i * 6 + f] = B.tileFor(i, f);
    }
    TILE_UV = new Float32Array(256 * 4);
    for (let t = 0; t < 256; t++) {
      const uv = Textures.tileUV(t);
      TILE_UV[t * 4] = uv.u0;
      TILE_UV[t * 4 + 1] = uv.u1;
      TILE_UV[t * 4 + 2] = uv.v0;
      TILE_UV[t * 4 + 3] = uv.v1;
    }
  }

  let capFaces = 0;
  let sPos = null, sUv = null, sCol = null, sIdx = null;
  let lPos = null, lUv = null, lCol = null, lIdx = null;
  // grows mid-chunk without losing what is already written
  function grow(arr, size, Ctor) {
    const out = new Ctor(size);
    if (arr) out.set(arr);
    return out;
  }
  function ensureScratch(faces) {
    if (faces <= capFaces) return;
    capFaces = Math.max(faces, Math.ceil(capFaces * 1.6), 8192);
    sPos = grow(sPos, capFaces * 12, Float32Array);
    sUv = grow(sUv, capFaces * 8, Float32Array);
    sCol = grow(sCol, capFaces * 12, Float32Array);
    sIdx = grow(sIdx, capFaces * 6, Uint32Array);
    lPos = grow(lPos, capFaces * 12, Float32Array);
    lUv = grow(lUv, capFaces * 8, Float32Array);
    lCol = grow(lCol, capFaces * 12, Float32Array);
    lIdx = grow(lIdx, capFaces * 6, Uint32Array);
  }

  // ---------------------------------------------------------------- worldgen
  // fbm output clusters tightly around 0.5, so each band is re-centred and
  // stretched before it contributes any height.
  function columnHeight(wx, wz, seed) {
    const continent = (Noise.fbm2(wx * 0.0045, wz * 0.0045, seed + 1, 4) - 0.5) * 2;
    const hills = (Noise.fbm2(wx * 0.013, wz * 0.013, seed + 2, 3) - 0.5) * 2;
    const detail = (Noise.fbm2(wx * 0.055, wz * 0.055, seed + 3, 2) - 0.5) * 2;
    const mRaw = Noise.fbm2(wx * 0.0025, wz * 0.0025, seed + 4, 3);
    const mountain = Math.max(0, mRaw - 0.58) * 2.8;

    let h = SEA_LEVEL + 4 + continent * 26 + hills * 9 + detail * 2.5 + mountain * 36;

    const r = Math.abs(Noise.fbm2(wx * 0.0055, wz * 0.0055, seed + 7, 3) - 0.5);
    const riverW = 0.045;
    if (r < riverW) {
      const t = Math.min(1, (1 - r / riverW) * 2.2);
      const carve = t * t * (3 - 2 * t) * Math.max(0, 1 - mountain * 1.6);
      const bed = SEA_LEVEL - 5;
      if (h > bed) h -= carve * (h - bed);
    }
    return h;
  }

  function biomeAt(wx, wz, seed) {
    const temp = Noise.fbm2(wx * 0.004, wz * 0.004, seed + 21, 3);
    const humid = Noise.fbm2(wx * 0.004, wz * 0.004, seed + 22, 3);
    if (temp > 0.56 && humid < 0.44) return 'desert';
    if (temp < 0.35) return 'snowy';
    if (humid > 0.52) return 'forest';
    return 'plains';
  }

  function caveAt(wx, y, wz, seed) {
    return Noise.fbm3(wx * 0.045, y * 0.075, wz * 0.045, seed + 11, 2) > 0.635;
  }

  function oreAt(wx, y, wz, seed) {
    const v = Noise.hash3(wx >> 1, y >> 1, wz >> 1, seed + 55);
    if (y < 14 && v < 0.0018) return B.DIAMOND_ORE;
    if (y < 26 && v < 0.0034) return B.GOLD_ORE;
    if (y < 44 && v < 0.015) return B.IRON_ORE;
    if (y < 58 && v < 0.026) return B.COAL_ORE;
    return 0;
  }

  // ---------------------------------------------------------------- chunk
  function Chunk(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.data = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
    this.generated = false;
    this.maxY = 0;
    this.dirty = true;
    this.solidMesh = null;
    this.liquidMesh = null;
  }

  Chunk.prototype.index = function (x, y, z) {
    return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
  };

  Chunk.prototype.get = function (x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return y < 0 ? B.STONE : B.AIR;
    return this.data[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x];
  };

  Chunk.prototype.set = function (x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.data[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x] = id;
    if (id !== B.AIR && y > this.maxY) this.maxY = y;
  };

  function placeIfAir(chunk, lx, y, lz, id) {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const i = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
    if (chunk.data[i] !== B.AIR) return;
    chunk.data[i] = id;
    if (y > chunk.maxY) chunk.maxY = y;
  }

  function placeForce(chunk, lx, y, lz, id) {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    if (y < 0 || y >= WORLD_HEIGHT) return;
    chunk.data[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx] = id;
    if (y > chunk.maxY) chunk.maxY = y;
  }

  function generateChunk(chunk, seed) {
    const baseX = chunk.cx * CHUNK_SIZE;
    const baseZ = chunk.cz * CHUNK_SIZE;

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = baseX + lx, wz = baseZ + lz;
        const hf = columnHeight(wx, wz, seed);
        const surfaceY = Math.floor(hf);
        const biome = biomeAt(wx, wz, seed);
        const top = Math.min(WORLD_HEIGHT - 1, Math.max(surfaceY, SEA_LEVEL));

        for (let y = 0; y <= top; y++) {
          let id = B.AIR;

          if (y > surfaceY) {
            id = y <= SEA_LEVEL ? B.WATER : B.AIR;
          } else {
            const depth = surfaceY - y;
            if (depth === 0) {
              if (surfaceY < SEA_LEVEL) id = Noise.hash2(wx, wz, seed + 41) < 0.25 ? B.GRAVEL : B.SAND;
              else if (surfaceY <= SEA_LEVEL + 1) id = B.SAND;
              else if (biome === 'desert') id = B.SAND;
              else if (biome === 'snowy') id = B.SNOW_GRASS;
              else id = B.GRASS;
            } else if (depth < 4) {
              if (biome === 'desert') id = depth < 3 ? B.SAND : B.SANDSTONE;
              else if (surfaceY < SEA_LEVEL + 1) id = B.SAND;
              else id = B.DIRT;
            } else {
              id = B.STONE;
              const ore = oreAt(wx, y, wz, seed);
              if (ore) id = ore;
            }

            if (y > 3 && depth > 0 && caveAt(wx, y, wz, seed)) id = B.AIR;
          }

          if (y === 0) id = B.BEDROCK;
          else if (y <= 2 && Noise.hash3(wx, y, wz, seed + 99) < 0.7 - y * 0.22) id = B.BEDROCK;

          if (id !== B.AIR) {
            chunk.data[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx] = id;
            if (y > chunk.maxY) chunk.maxY = y;
          }
        }
      }
    }

    growPlants(chunk, seed);
    growFeatures(chunk, seed);
    chunk.generated = true;
  }

  // tall grass and flowers on open grass; trees grown afterwards overwrite them
  function growPlants(chunk, seed) {
    const baseX = chunk.cx * CHUNK_SIZE, baseZ = chunk.cz * CHUNK_SIZE;
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = baseX + lx, wz = baseZ + lz;
        const y = Math.floor(columnHeight(wx, wz, seed));
        if (y <= SEA_LEVEL || y >= WORLD_HEIGHT - 2) continue;
        const i = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
        if (chunk.data[i] !== B.GRASS) continue;
        if (chunk.data[i + CHUNK_SIZE * CHUNK_SIZE] !== B.AIR) continue;
        const biome = biomeAt(wx, wz, seed);
        const h = Noise.hash2(wx, wz, seed + 71);
        const grass = biome === 'plains' ? 0.2 : biome === 'forest' ? 0.12 : 0.04;
        let plant = 0;
        if (h < grass) plant = B.TALL_GRASS;
        else if (h < grass + 0.012) plant = B.DANDELION;
        else if (h < grass + 0.022) plant = B.POPPY;
        if (!plant) continue;
        chunk.data[i + CHUNK_SIZE * CHUNK_SIZE] = plant;
        if (y + 1 > chunk.maxY) chunk.maxY = y + 1;
      }
    }
  }

  function growFeatures(chunk, seed) {
    const baseX = chunk.cx * CHUNK_SIZE;
    const baseZ = chunk.cz * CHUNK_SIZE;

    for (let ox = -3; ox < CHUNK_SIZE + 3; ox++) {
      for (let oz = -3; oz < CHUNK_SIZE + 3; oz++) {
        const wx = baseX + ox, wz = baseZ + oz;
        const biome = biomeAt(wx, wz, seed);
        let density = 0;
        if (biome === 'forest') density = 0.030;
        else if (biome === 'plains') density = 0.005;
        else if (biome === 'snowy') density = 0.014;
        else if (biome === 'desert') density = 0.008;
        if (Noise.hash2(wx, wz, seed + 31) >= density) continue;

        const surfaceY = Math.floor(columnHeight(wx, wz, seed));
        if (surfaceY <= SEA_LEVEL + 1 || surfaceY > WORLD_HEIGHT - 12) continue;
        if (caveAt(wx, surfaceY, wz, seed)) continue;

        const r = Noise.hash2(wx, wz, seed + 32);
        if (biome === 'desert') {
          const h = 2 + Math.floor(r * 2);
          for (let i = 1; i <= h; i++) placeForce(chunk, ox, surfaceY + i, oz, B.CACTUS);
        } else {
          const trunk = 4 + Math.floor(r * 3);
          const topY = surfaceY + trunk;
          for (let dy = -2; dy <= 1; dy++) {
            const radius = dy <= -1 ? 2 : 1;
            for (let dx = -radius; dx <= radius; dx++) {
              for (let dz = -radius; dz <= radius; dz++) {
                const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
                if (corner && radius === 2 && Noise.hash3(wx + dx, topY + dy, wz + dz, seed + 33) < 0.55) continue;
                if (corner && dy === 1) continue;
                placeIfAir(chunk, ox + dx, topY + dy, oz + dz, B.LEAVES);
              }
            }
          }
          for (let i = 0; i < trunk; i++) placeForce(chunk, ox, surfaceY + 1 + i, oz, B.LOG);
        }
      }
    }
  }

  // ---------------------------------------------------------------- world
  function World(seed) {
    this.seed = seed | 0;
    this.chunks = new Map();
    this.group = new THREE.Group();
    this.renderDistance = 4;
    this._lastChunk = null;
    this._lastKey = '';
    this.light = World.lightUniforms;
    // chunks the player just changed: rebuilt before anything else
    this.urgent = new Set();
    this.material = litMaterial({
      map: Textures.texture,
      vertexColors: true,
      alphaTest: 0.5
    });
    this.liquidMaterial = litMaterial({
      map: Textures.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.onChunkReady = null;
  }

  // Vertex colour carries (face shade x AO, sky light, block light). The sky
  // part is scaled by daylight here, so the day cycle costs nothing per chunk.
  World.lightUniforms = {
    uDaylight: { value: 1 },
    uSkyTint: { value: new THREE.Color(1, 1, 1) },
    uMinLight: { value: 0.06 }
  };

  function litMaterial(opts) {
    const m = new THREE.MeshBasicMaterial(opts);
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uDaylight = World.lightUniforms.uDaylight;
      shader.uniforms.uSkyTint = World.lightUniforms.uSkyTint;
      shader.uniforms.uMinLight = World.lightUniforms.uMinLight;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', [
          '#include <common>',
          'uniform float uDaylight;',
          'uniform vec3 uSkyTint;',
          'uniform float uMinLight;',
          'float mcCurve(float f) { return f / (2.3 - 1.3 * f); }'
        ].join('\n'))
        .replace('#include <color_fragment>', [
          '#ifdef USE_COLOR',
          '  vec3 skyPart = uSkyTint * mcCurve(vColor.g * uDaylight);',
          '  vec3 blkPart = vec3(1.0, 0.93, 0.8) * mcCurve(vColor.b);',
          '  vec3 lit = max(max(skyPart, blkPart), vec3(uMinLight));',
          '  diffuseColor.rgb *= vColor.r * lit;',
          '#endif'
        ].join('\n'));
    };
    return m;
  }

  World.prototype.key = function (cx, cz) { return cx + ',' + cz; };

  World.prototype.getChunk = function (cx, cz) {
    const k = this.key(cx, cz);
    if (k === this._lastKey) return this._lastChunk;
    const c = this.chunks.get(k) || null;
    this._lastKey = k;
    this._lastChunk = c;
    return c;
  };

  World.prototype.ensureChunk = function (cx, cz) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk(cx, cz);
      this.chunks.set(k, c);
      this._lastKey = '';
    }
    if (!c.generated) {
      generateChunk(c, this.seed);
      // edits made by anyone outlive chunk unload, so replay them on rebuild
      if (this.onChunkReady) this.onChunkReady(c);
    }
    return c;
  };

  World.prototype.getBlock = function (x, y, z) {
    if (y < 0) return B.STONE;
    if (y >= WORLD_HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c || !c.generated) return B.AIR;
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    return c.data[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
  };

  World.prototype.setBlock = function (x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c || !c.generated) return false;
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    c.data[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx] = id;
    if (id !== B.AIR && y > c.maxY) c.maxY = y;
    if (B.byId[id].light) c.hasLight = true;
    c.dirty = true;
    this.urgent.add(c);
    (c.pendingEdits || (c.pendingEdits = [])).push(x, y, z);

    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    return true;
  };

  World.prototype.markDirty = function (cx, cz) {
    const c = this.chunks.get(this.key(cx, cz));
    if (c && c.generated) c.dirty = true;
  };

  World.prototype.surfaceY = function (x, z) {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    this.ensureChunk(cx, cz);
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && id !== B.WATER) return y;
    }
    return 0;
  };

  const GROUND_IDS = [B.GRASS, B.DIRT, B.STONE, B.SAND, B.SANDSTONE, B.GRAVEL, B.SNOW, B.SNOW_GRASS];

  World.prototype.groundY = function (x, z) {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    this.ensureChunk(cx, cz);
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (GROUND_IDS.indexOf(id) !== -1) return y;
    }
    return -1;
  };

  // ---------------------------------------------------------------- lighting
  // Minecraft keeps two light values per cell: sky light (15 under open sky,
  // fading into caves and under water) and block light (torches). A chunk is
  // lit from a 3x3-chunk region around it, which is exact because light never
  // travels more than 15 blocks. The mesher bakes both values into the vertex
  // colours and the shader mixes them with the time of day, so night falls
  // without rebuilding a single chunk.
  const RW = CHUNK_SIZE * 3;           // region width in x and z
  const RM = CHUNK_SIZE;               // margin: region x/z index = local + 16
  const RH = WORLD_HEIGHT + 4;         // region height, y index = y + 2
  const SZ = RW, SY = RW * RW;
  const RSIZE = SY * RH;
  const region = new Uint8Array(RSIZE);
  const skyL = new Uint8Array(RSIZE);
  const blkL = new Uint8Array(RSIZE);
  const colTop = new Int16Array(RW * RW);
  const queue = new Int32Array(RSIZE);

  let EMIT = null, DIM = null;
  function buildLightLookups() {
    const n = B.byId.length;
    EMIT = new Uint8Array(n);
    DIM = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const d = B.byId[i];
      if (!d) continue;
      EMIT[i] = d.light || 0;
      // water and leaves let light through but take a little of it
      DIM[i] = (d.liquid || i === B.LEAVES) ? 1 : 0;
    }
  }

  function regionIndex(lx, y, lz) {
    return (y + 2) * SY + (lz + RM) * SZ + (lx + RM);
  }

  World.prototype.fillRegion = function (chunk) {
    let top = 0, anyLight = false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(this.key(chunk.cx + dx, chunk.cz + dz));
        const ox = RM + dx * CHUNK_SIZE, oz = RM + dz * CHUNK_SIZE;
        if (!c || !c.generated) {
          for (let y = 0; y < WORLD_HEIGHT; y++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
              const b = (y + 2) * SY + (z + oz) * SZ + ox;
              region.fill(B.AIR, b, b + CHUNK_SIZE);
            }
          }
          continue;
        }
        if (c.maxY > top) top = c.maxY;
        if (c.hasLight) anyLight = true;
        const d = c.data;
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          for (let z = 0; z < CHUNK_SIZE; z++) {
            const s = (y * CHUNK_SIZE + z) * CHUNK_SIZE;
            region.set(d.subarray(s, s + CHUNK_SIZE), (y + 2) * SY + (z + oz) * SZ + ox);
          }
        }
      }
    }
    // below the world is rock, above it is air
    region.fill(B.STONE, 0, 2 * SY);
    region.fill(B.AIR, (WORLD_HEIGHT + 2) * SY, RSIZE);
    return { top: Math.min(WORLD_HEIGHT - 1, top + 2), anyLight };
  };

  function lightRegion(top, anyLight) {
    const yLim = top;                        // world y; everything above is open sky
    const limIdx = (yLim + 3) * SY;
    skyL.fill(0, 0, limIdx);
    skyL.fill(15, limIdx, RSIZE);
    blkL.fill(0);

    // straight down from the sky, dimmed by water and leaves
    for (let z = 0; z < RW; z++) {
      for (let x = 0; x < RW; x++) {
        let level = 15, y = yLim;
        let i = (y + 2) * SY + z * SZ + x;
        for (; y >= 0; y--, i -= SY) {
          const id = region[i];
          if (OPAQUE[id]) break;
          if (DIM[id]) level = level > 0 ? level - 1 : 0;
          skyL[i] = level;
        }
        colTop[z * RW + x] = y;
      }
    }

    // sideways into overhangs and cave mouths: only where a neighbouring
    // column is taller can light need to spread
    let qh = 0, qt = 0;
    for (let z = 0; z < RW; z++) {
      for (let x = 0; x < RW; x++) {
        const c = z * RW + x;
        const own = colTop[c];
        let high = own;
        if (x > 0 && colTop[c - 1] > high) high = colTop[c - 1];
        if (x < RW - 1 && colTop[c + 1] > high) high = colTop[c + 1];
        if (z > 0 && colTop[c - RW] > high) high = colTop[c - RW];
        if (z < RW - 1 && colTop[c + RW] > high) high = colTop[c + RW];
        for (let y = own + 1; y <= high && y <= yLim; y++) {
          const i = (y + 2) * SY + z * SZ + x;
          if (skyL[i] > 1) queue[qt++] = i;
        }
      }
    }
    spread(skyL, qh, qt, yLim);

    if (!anyLight) return;
    qt = 0;
    const end = (yLim + 3) * SY;
    for (let i = 2 * SY; i < end; i++) {
      const e = EMIT[region[i]];
      if (e) { blkL[i] = e; queue[qt++] = i; }
    }
    if (qt) spread(blkL, 0, qt, yLim);
  }

  function spread(L, qh, qt, yLim) {
    while (qh < qt) {
      const i = queue[qh++];
      const level = L[i];
      if (level <= 1) continue;
      const next = level - 1;
      const x = i % SZ;
      const z = ((i / SZ) | 0) % RW;
      const y = ((i / SY) | 0) - 2;
      if (x > 0) { const n = i - 1; if (!OPAQUE[region[n]] && L[n] < next) { L[n] = next; queue[qt++] = n; } }
      if (x < RW - 1) { const n = i + 1; if (!OPAQUE[region[n]] && L[n] < next) { L[n] = next; queue[qt++] = n; } }
      if (z > 0) { const n = i - SZ; if (!OPAQUE[region[n]] && L[n] < next) { L[n] = next; queue[qt++] = n; } }
      if (z < RW - 1) { const n = i + SZ; if (!OPAQUE[region[n]] && L[n] < next) { L[n] = next; queue[qt++] = n; } }
      if (y > 0) { const n = i - SY; if (!OPAQUE[region[n]] && L[n] < next) { L[n] = next; queue[qt++] = n; } }
      if (y < yLim) { const n = i + SY; if (!OPAQUE[region[n]] && L[n] < next) { L[n] = next; queue[qt++] = n; } }
    }
  }

  // light of one cell, for spawning rules and the hand in first person
  World.prototype.lightAt = function (x, y, z) {
    if (y >= WORLD_HEIGHT) return { sky: 15, blk: 0 };
    if (y < 0) return { sky: 0, blk: 0 };
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c || !c.sky) return { sky: 15, blk: 0 };
    const i = (y * CHUNK_SIZE + (z - cz * CHUNK_SIZE)) * CHUNK_SIZE + (x - cx * CHUNK_SIZE);
    return { sky: c.sky[i], blk: c.blk[i] };
  };

  // After an edit only the edited chunk is rebuilt at once; a neighbour is
  // rebuilt only if the new light actually reaches it.
  World.prototype.checkNeighbourLight = function (chunk) {
    const edits = chunk.pendingEdits;
    chunk.pendingEdits = null;
    if (!edits) return;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = this.chunks.get(this.key(chunk.cx + dx, chunk.cz + dz));
        if (!n || !n.generated || n.dirty || !n.sky) continue;
        const bx = n.cx * CHUNK_SIZE, bz = n.cz * CHUNK_SIZE;
        let changed = false;
        for (let e = 0; e < edits.length && !changed; e += 3) {
          const ex = edits[e], ey = edits[e + 1], ez = edits[e + 2];
          const x0 = Math.max(0, ex - 15 - bx), x1 = Math.min(CHUNK_SIZE - 1, ex + 15 - bx);
          const z0 = Math.max(0, ez - 15 - bz), z1 = Math.min(CHUNK_SIZE - 1, ez + 15 - bz);
          const y0 = Math.max(0, ey - 15), y1 = Math.min(WORLD_HEIGHT - 1, ey + 15);
          if (x0 > x1 || z0 > z1) continue;
          for (let y = y0; y <= y1 && !changed; y++) {
            for (let z = z0; z <= z1 && !changed; z++) {
              const ri = (y + 2) * SY + (z + RM + dz * CHUNK_SIZE) * SZ + RM + dx * CHUNK_SIZE;
              const ci = (y * CHUNK_SIZE + z) * CHUNK_SIZE;
              for (let x = x0; x <= x1; x++) {
                if (skyL[ri + x] !== n.sky[ci + x] || blkL[ri + x] !== n.blk[ci + x]) { changed = true; break; }
              }
            }
          }
        }
        if (changed) n.dirty = true;
      }
    }
  };

  // ---------------------------------------------------------------- meshing
  World.prototype.buildChunkMesh = function (chunk) {
    if (!OPAQUE) buildLookups();
    if (!EMIT) buildLightLookups();
    const baseX = chunk.cx * CHUNK_SIZE, baseZ = chunk.cz * CHUNK_SIZE;
    const yTop = Math.min(WORLD_HEIGHT - 1, chunk.maxY + 1);

    const info = this.fillRegion(chunk);
    lightRegion(Math.max(info.top, yTop + 1), info.anyLight);

    // keep this chunk's own light for later questions about it
    if (!chunk.sky) {
      chunk.sky = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
      chunk.blk = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
    }
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const ri = regionIndex(0, y, z), ci = (y * CHUNK_SIZE + z) * CHUNK_SIZE;
        chunk.sky.set(skyL.subarray(ri, ri + CHUNK_SIZE), ci);
        chunk.blk.set(blkL.subarray(ri, ri + CHUNK_SIZE), ci);
      }
    }
    this.checkNeighbourLight(chunk);

    ensureScratch(8192);
    let sVert = 0, sTri = 0, lVert = 0, lTri = 0;
    const pad = region;

    for (let y = 0; y <= yTop; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const rowIdx = (y * CHUNK_SIZE + z) * CHUNK_SIZE;
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = chunk.data[rowIdx + x];
          if (id === B.AIR) continue;

          const isLiquid = LIQUID[id];
          const pHere = regionIndex(x, y, z);
          const waterTopDrop = isLiquid && pad[pHere + SY] !== id ? 0.125 : 0;

          // torches, grass and flowers: two crossed quads drawn from both sides,
          // lit by the light in their own cell
          if (CROSS[id]) {
            if (sVert + 16 > capFaces * 4) ensureScratch(capFaces * 2);
            const pos = sPos, uvs = sUv, cols = sCol, idx = sIdx;
            const t4 = FACE_TILE_OF[id * 6 + 2] * 4;
            const cu0 = TILE_UV[t4], cu1 = TILE_UV[t4 + 1];
            const cv0 = TILE_UV[t4 + 2], cv1 = TILE_UV[t4 + 3];
            const ls = skyL[pHere] / 15, lb = blkL[pHere] / 15;
            const r = 0.36, cx = x + 0.5, cz = z + 0.5;
            const quads = [[-r, -r, r, r], [-r, r, r, -r]];
            for (const q of quads) {
              for (let side = 0; side < 2; side++) {
                const vS = sVert;
                let vp = vS * 3, vu = vS * 2;
                const ax = q[side ? 2 : 0], az = q[side ? 3 : 1];
                const bx2 = q[side ? 0 : 2], bz2 = q[side ? 1 : 3];
                const px = [ax, bx2, ax, bx2], pz = [az, bz2, az, bz2];
                for (let ci = 0; ci < 4; ci++) {
                  pos[vp] = cx + px[ci];
                  pos[vp + 1] = y + (ci >= 2 ? BHEIGHT[id] : 0);
                  pos[vp + 2] = cz + pz[ci];
                  uvs[vu] = (ci === 1 || ci === 3) ? cu1 : cu0;
                  uvs[vu + 1] = ci >= 2 ? cv0 : cv1;
                  cols[vp] = 0.92; cols[vp + 1] = ls; cols[vp + 2] = lb;
                  vp += 3; vu += 2;
                }
                const ti = sTri * 3;
                idx[ti] = vS; idx[ti + 1] = vS + 1; idx[ti + 2] = vS + 2;
                idx[ti + 3] = vS + 2; idx[ti + 4] = vS + 1; idx[ti + 5] = vS + 3;
                sVert += 4; sTri += 2;
              }
            }
            continue;
          }

          const bh = BHEIGHT[id];

          for (let f = 0; f < 6; f++) {
            const f3 = f * 3;
            const nx = FACE_N[f3], ny = FACE_N[f3 + 1], nz = FACE_N[f3 + 2];
            const pNb = pHere + ny * SY + nz * SZ + nx;
            const nb = pad[pNb];
            // a shortened block only hides its underside behind a neighbour
            if (OPAQUE[nb] && (bh >= 1 || f === 3)) continue;
            if (isLiquid) { if (LIQUID[nb]) continue; }
            else if (nb === id && !OPAQUE[id] && id !== B.LEAVES) continue;

            if ((isLiquid ? lVert : sVert) + 4 > capFaces * 4) ensureScratch(capFaces * 2);
            const P = isLiquid ? lPos : sPos;
            const U = isLiquid ? lUv : sUv;
            const C = isLiquid ? lCol : sCol;
            const I = isLiquid ? lIdx : sIdx;

            const tile = FACE_TILE_OF[id * 6 + f] * 4;
            const u0 = TILE_UV[tile], u1 = TILE_UV[tile + 1];
            const v0 = TILE_UV[tile + 2], v1 = TILE_UV[tile + 3];
            const shade = FACE_SHADE[f];

            const tux = FACE_TU[f3], tuy = FACE_TU[f3 + 1], tuz = FACE_TU[f3 + 2];
            const tvx = FACE_TV[f3], tvy = FACE_TV[f3 + 1], tvz = FACE_TV[f3 + 2];
            const stepU = tuy * SY + tuz * SZ + tux;
            const stepV = tvy * SY + tvz * SZ + tvx;

            // a short block's side faces look sideways from inside its own cell
            const lightCell = (bh < 1 && f !== 3) ? pHere : pNb;
            const vStart = isLiquid ? lVert : sVert;
            let vp = vStart * 3, vu = vStart * 2;
            let ao0 = 0, ao1 = 0, ao2 = 0, ao3 = 0;

            for (let ci = 0; ci < 4; ci++) {
              const su = CORNER_SIGNS[ci][0], sv = CORNER_SIGNS[ci][1];
              const pa = pNb + stepU * su, pb = pNb + stepV * sv, pc = pa + stepV * sv;
              const s1 = OPAQUE[pad[pa]];
              const s2 = OPAQUE[pad[pb]];
              const cr = OPAQUE[pad[pc]];
              const level = (s1 && s2) ? 0 : 3 - (s1 + s2 + cr);
              if (ci === 0) ao0 = level; else if (ci === 1) ao1 = level;
              else if (ci === 2) ao2 = level; else ao3 = level;

              // smooth lighting: average the open cells around this corner
              let ls = skyL[lightCell], lb = blkL[lightCell], n = 1;
              if (lightCell === pNb) {
                if (!s1) { ls += skyL[pa]; lb += blkL[pa]; n++; }
                if (!s2) { ls += skyL[pb]; lb += blkL[pb]; n++; }
                if (!cr && !(s1 && s2)) { ls += skyL[pc]; lb += blkL[pc]; n++; }
              }

              const c3 = f * 12 + ci * 3;
              const cy = FACE_CORNER[c3 + 1];
              P[vp] = x + FACE_CORNER[c3];
              P[vp + 1] = y + cy * bh - (waterTopDrop && cy === 1 ? waterTopDrop : 0);
              P[vp + 2] = z + FACE_CORNER[c3 + 2];

              U[vu] = (ci === 1 || ci === 3) ? u1 : u0;
              U[vu + 1] = ci >= 2 ? v1 : v0;

              C[vp] = shade * AO_LEVEL[level];
              C[vp + 1] = ls / (n * 15);
              C[vp + 2] = lb / (n * 15);

              vp += 3; vu += 2;
            }

            let ti = (isLiquid ? lTri : sTri) * 3;
            if (ao0 + ao3 > ao1 + ao2) {
              I[ti] = vStart; I[ti + 1] = vStart + 1; I[ti + 2] = vStart + 3;
              I[ti + 3] = vStart; I[ti + 4] = vStart + 3; I[ti + 5] = vStart + 2;
            } else {
              I[ti] = vStart; I[ti + 1] = vStart + 1; I[ti + 2] = vStart + 2;
              I[ti + 3] = vStart + 2; I[ti + 4] = vStart + 1; I[ti + 5] = vStart + 3;
            }

            if (isLiquid) { lVert += 4; lTri += 2; } else { sVert += 4; sTri += 2; }
          }
        }
      }
    }

    this.applyMesh(chunk, 'solidMesh', sPos, sUv, sCol, sIdx, sVert, sTri, this.material, baseX, baseZ);
    this.applyMesh(chunk, 'liquidMesh', lPos, lUv, lCol, lIdx, lVert, lTri, this.liquidMaterial, baseX, baseZ);
    chunk.dirty = false;
  };

  World.prototype.applyMesh = function (chunk, slot, pos, uvs, cols, idx, vertCount, triCount, material, baseX, baseZ) {
    let mesh = chunk[slot];
    if (triCount === 0) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        chunk[slot] = null;
      }
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, vertCount * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(0, vertCount * 2), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(cols.slice(0, vertCount * 3), 3));
    geo.setIndex(new THREE.BufferAttribute(idx.slice(0, triCount * 3), 1));
    geo.computeBoundingSphere();
    if (!mesh) {
      mesh = new THREE.Mesh(geo, material);
      mesh.position.set(baseX, 0, baseZ);
      chunk[slot] = mesh;
      this.group.add(mesh);
    } else {
      mesh.geometry.dispose();
      mesh.geometry = geo;
    }
  };

  // ---------------------------------------------------------------- streaming
  World.prototype.update = function (px, pz, budgetMs) {
    const t0 = performance.now();
    const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
    const R = this.renderDistance;
    let pending = 0;

    // what the player just broke or placed shows up this frame, whatever else
    // is waiting; light spilling into neighbours follows under the budget
    if (this.urgent.size) {
      for (const c of this.urgent) {
        if (c.generated && c.dirty && this.chunks.get(this.key(c.cx, c.cz)) === c) {
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.ensureChunk(c.cx + dx, c.cz + dz);
          this.buildChunkMesh(c);
        }
      }
      this.urgent.clear();
    }

    for (let ring = 0; ring <= R; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const cx = pcx + dx, cz = pcz + dz;
          const c = this.chunks.get(this.key(cx, cz));
          if (c && c.generated && !c.dirty) continue;
          pending++;
          if (performance.now() - t0 > budgetMs) return pending;

          this.ensureChunk(cx, cz);
          this.ensureChunk(cx - 1, cz);
          this.ensureChunk(cx + 1, cz);
          this.ensureChunk(cx, cz - 1);
          this.ensureChunk(cx, cz + 1);
          this.ensureChunk(cx - 1, cz - 1);
          this.ensureChunk(cx + 1, cz - 1);
          this.ensureChunk(cx - 1, cz + 1);
          this.ensureChunk(cx + 1, cz + 1);
          this.buildChunkMesh(this.chunks.get(this.key(cx, cz)));
        }
      }
    }

    this.unloadFar(pcx, pcz, R + 3);
    return pending;
  };

  World.prototype.unloadFar = function (pcx, pcz, maxDist) {
    for (const [k, c] of this.chunks) {
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) <= maxDist) continue;
      if (c.solidMesh) { this.group.remove(c.solidMesh); c.solidMesh.geometry.dispose(); }
      if (c.liquidMesh) { this.group.remove(c.liquidMesh); c.liquidMesh.geometry.dispose(); }
      this.chunks.delete(k);
      this._lastKey = '';
    }
  };

  // ---------------------------------------------------------------- raycast
  World.prototype.raycast = function (origin, dir, maxDist, hitLiquid) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tMaxX = dir.x !== 0 ? ((dir.x > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX) : Infinity;
    let tMaxY = dir.y !== 0 ? ((dir.y > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY) : Infinity;
    let tMaxZ = dir.z !== 0 ? ((dir.z > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ) : Infinity;
    let nx = 0, ny = 0, nz = 0;
    let t = 0;

    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && (hitLiquid || !B.byId[id].liquid)) {
        return { x, y, z, id, nx, ny, nz, dist: t };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
    }
    return null;
  };

  World.columnHeight = columnHeight;
  World.biomeAt = biomeAt;

  global.World = World;
  global.WorldConst = { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL };
})(window);
