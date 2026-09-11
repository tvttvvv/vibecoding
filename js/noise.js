(function (global) {
  'use strict';

  function hash2(ix, iy, seed) {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function hash3(ix, iy, iz, seed) {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x85ebca6b) ^ Math.imul(iz | 0, 0x165667b1);
    h ^= Math.imul(seed | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function value2(x, y, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
    const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }

  function value3(x, y, z, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const fx = smooth(x - x0), fy = smooth(y - y0), fz = smooth(z - z0);
    const c000 = hash3(x0, y0, z0, seed), c100 = hash3(x0 + 1, y0, z0, seed);
    const c010 = hash3(x0, y0 + 1, z0, seed), c110 = hash3(x0 + 1, y0 + 1, z0, seed);
    const c001 = hash3(x0, y0, z0 + 1, seed), c101 = hash3(x0 + 1, y0, z0 + 1, seed);
    const c011 = hash3(x0, y0 + 1, z0 + 1, seed), c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
    const x00 = lerp(c000, c100, fx), x10 = lerp(c010, c110, fx);
    const x01 = lerp(c001, c101, fx), x11 = lerp(c011, c111, fx);
    return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
  }

  function fbm2(x, y, seed, octaves) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * value2(x * freq, y * freq, seed + i * 137);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  function fbm3(x, y, z, seed, octaves) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * value3(x * freq, y * freq, z * freq, seed + i * 137);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  global.Noise = { hash2, hash3, value2, value3, fbm2, fbm3 };
})(window);
