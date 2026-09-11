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
  function buildLookups() {
    const n = B.byId.length;
    OPAQUE = new Uint8Array(n);
    LIQUID = new Uint8Array(n);
    FACE_TILE_OF = new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) {
      if (!B.byId[i]) continue;
      OPAQUE[i] = B.byId[i].opaque ? 1 : 0;
      LIQUID[i] = B.byId[i].liquid ? 1 : 0;
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
  function ensureScratch(faces) {
    if (faces <= capFaces) return;
    capFaces = Math.max(faces, Math.ceil(capFaces * 1.6), 8192);
    sPos = new Float32Array(capFaces * 12);
    sUv = new Float32Array(capFaces * 8);
    sCol = new Float32Array(capFaces * 12);
    sIdx = new Uint32Array(capFaces * 6);
    lPos = new Float32Array(capFaces * 12);
    lUv = new Float32Array(capFaces * 8);
    lCol = new Float32Array(capFaces * 12);
    lIdx = new Uint32Array(capFaces * 6);
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

    growFeatures(chunk, seed);
    chunk.generated = true;
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
    this.material = new THREE.MeshBasicMaterial({
      map: Textures.texture,
      vertexColors: true,
      alphaTest: 0.5
    });
    this.liquidMaterial = new THREE.MeshBasicMaterial({
      map: Textures.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this._pad = new Uint8Array((CHUNK_SIZE + 2) * (WORLD_HEIGHT + 4) * (CHUNK_SIZE + 2));
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
    if (!c.generated) generateChunk(c, this.seed);
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
    c.dirty = true;

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

  // ---------------------------------------------------------------- meshing
  World.prototype.buildChunkMesh = function (chunk) {
    if (!OPAQUE) buildLookups();
    const PW = CHUNK_SIZE + 2;
    const pad = this._pad;
    const baseX = chunk.cx * CHUNK_SIZE, baseZ = chunk.cz * CHUNK_SIZE;
    const yTop = Math.min(WORLD_HEIGHT - 1, chunk.maxY + 1);
    const yFillTop = Math.min(WORLD_HEIGHT + 1, yTop + 2);

    for (let y = -2; y <= yFillTop; y++) {
      const py = y + 2;
      for (let z = -1; z <= CHUNK_SIZE; z++) {
        const pz = z + 1;
        const rowBase = (py * PW + pz) * PW;
        const inZ = z >= 0 && z < CHUNK_SIZE;
        const inY = y >= 0 && y < WORLD_HEIGHT;
        for (let x = -1; x <= CHUNK_SIZE; x++) {
          let v;
          if (inY && inZ && x >= 0 && x < CHUNK_SIZE) {
            v = chunk.data[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x];
          } else {
            v = this.getBlock(baseX + x, y, baseZ + z);
          }
          pad[rowBase + x + 1] = v;
        }
      }
    }

    const PWY = PW * PW;
    const padBase = 2 * PWY + PW + 1;

    ensureScratch(8192);
    const pos = sPos, uvs = sUv, cols = sCol, idx = sIdx;
    const lpos = lPos, luvs = lUv, lcols = lCol, lidx = lIdx;
    let sVert = 0, sTri = 0, lVert = 0, lTri = 0;

    for (let y = 0; y <= yTop; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const rowIdx = (y * CHUNK_SIZE + z) * CHUNK_SIZE;
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = chunk.data[rowIdx + x];
          if (id === B.AIR) continue;

          const isLiquid = LIQUID[id];
          const pHere = padBase + y * PWY + z * PW + x;
          const waterTopDrop = isLiquid && pad[pHere + PWY] !== id ? 0.125 : 0;

          for (let f = 0; f < 6; f++) {
            const f3 = f * 3;
            const nx = FACE_N[f3], ny = FACE_N[f3 + 1], nz = FACE_N[f3 + 2];
            const pNb = pHere + ny * PWY + nz * PW + nx;
            const nb = pad[pNb];
            if (OPAQUE[nb]) continue;
            if (isLiquid) { if (LIQUID[nb]) continue; }
            else if (nb === id && !OPAQUE[id] && id !== B.LEAVES) continue;

            const tile = FACE_TILE_OF[id * 6 + f] * 4;
            const u0 = TILE_UV[tile], u1 = TILE_UV[tile + 1];
            const v0 = TILE_UV[tile + 2], v1 = TILE_UV[tile + 3];
            const shade = FACE_SHADE[f];

            const tux = FACE_TU[f3], tuy = FACE_TU[f3 + 1], tuz = FACE_TU[f3 + 2];
            const tvx = FACE_TV[f3], tvy = FACE_TV[f3 + 1], tvz = FACE_TV[f3 + 2];
            const stepU = tuy * PWY + tuz * PW + tux;
            const stepV = tvy * PWY + tvz * PW + tvx;

            const P = isLiquid ? lpos : pos;
            const U = isLiquid ? luvs : uvs;
            const C = isLiquid ? lcols : cols;
            const I = isLiquid ? lidx : idx;
            const vStart = isLiquid ? lVert : sVert;

            let vp = vStart * 3, vu = vStart * 2;
            let ao0 = 0, ao1 = 0, ao2 = 0, ao3 = 0;

            for (let ci = 0; ci < 4; ci++) {
              const su = CORNER_SIGNS[ci][0], sv = CORNER_SIGNS[ci][1];
              const s1 = OPAQUE[pad[pNb + stepU * su]];
              const s2 = OPAQUE[pad[pNb + stepV * sv]];
              const cr = OPAQUE[pad[pNb + stepU * su + stepV * sv]];
              const level = (s1 && s2) ? 0 : 3 - (s1 + s2 + cr);
              if (ci === 0) ao0 = level; else if (ci === 1) ao1 = level;
              else if (ci === 2) ao2 = level; else ao3 = level;

              const c3 = f * 12 + ci * 3;
              const cy = FACE_CORNER[c3 + 1];
              P[vp] = x + FACE_CORNER[c3];
              P[vp + 1] = y + cy - (waterTopDrop && cy === 1 ? waterTopDrop : 0);
              P[vp + 2] = z + FACE_CORNER[c3 + 2];

              U[vu] = (ci === 1 || ci === 3) ? u1 : u0;
              U[vu + 1] = ci >= 2 ? v1 : v0;

              const b = shade * AO_LEVEL[level];
              C[vp] = b; C[vp + 1] = b; C[vp + 2] = b;

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

    this.applyMesh(chunk, 'solidMesh', pos, uvs, cols, idx, sVert, sTri, this.material, baseX, baseZ);
    this.applyMesh(chunk, 'liquidMesh', lpos, luvs, lcols, lidx, lVert, lTri, this.liquidMaterial, baseX, baseZ);
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
  World.prototype.raycast = function (origin, dir, maxDist) {
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
      if (id !== B.AIR && B.byId[id].solid) {
        return { x, y, z, id, nx, ny, nz };
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
