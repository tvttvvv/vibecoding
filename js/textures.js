(function (global) {
  'use strict';

  const TILE = 16;
  const COLS = 16;
  const ATLAS_PX = TILE * COLS;

  let rngState = 1;
  function rnd() {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
  }
  function pick(list) { return list[Math.floor(rnd() * list.length)]; }

  const atlas = document.createElement('canvas');
  atlas.width = ATLAS_PX;
  atlas.height = ATLAS_PX;
  const actx = atlas.getContext('2d');

  const names = [];
  const TILES = {};

  function tileOrigin(index) {
    return { x: (index % COLS) * TILE, y: Math.floor(index / COLS) * TILE };
  }

  function define(name, draw) {
    const index = names.length;
    names.push(name);
    TILES[name] = index;
    const o = tileOrigin(index);
    rngState = 0x9e3779b1 ^ Math.imul(index + 1, 0x85ebca6b);
    const put = (x, y, color) => {
      actx.fillStyle = color;
      actx.fillRect(o.x + x, o.y + y, 1, 1);
    };
    const fill = (color) => {
      actx.fillStyle = color;
      actx.fillRect(o.x, o.y, TILE, TILE);
    };
    const clear = () => actx.clearRect(o.x, o.y, TILE, TILE);
    draw({ put, fill, clear, rnd, pick });
    return index;
  }

  function speckle(api, base, shades, density) {
    api.fill(base);
    const count = Math.floor(TILE * TILE * density);
    for (let i = 0; i < count; i++) {
      api.put(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), pick(shades));
    }
  }

  define('grass_top', (api) => speckle(api, '#5d9c3c', ['#4f8a33', '#6cae46', '#57953a', '#74b74c'], 0.6));

  define('dirt', (api) => speckle(api, '#79553a', ['#6b4a31', '#85603f', '#6f4f35', '#8c6845'], 0.55));

  define('grass_side', (api) => {
    speckle(api, '#79553a', ['#6b4a31', '#85603f', '#6f4f35'], 0.5);
    const edge = [];
    for (let x = 0; x < TILE; x++) edge[x] = 3 + Math.floor(rnd() * 3);
    for (let x = 0; x < TILE; x++) {
      for (let y = 0; y < edge[x]; y++) {
        api.put(x, y, pick(['#5d9c3c', '#4f8a33', '#6cae46', '#57953a']));
      }
    }
  });

  define('stone', (api) => speckle(api, '#8a8a8a', ['#7d7d7d', '#979797', '#727272', '#a0a0a0'], 0.5));

  define('cobblestone', (api) => {
    api.fill('#6f6f6f');
    const stones = [
      [0, 0, 6, 5], [7, 0, 5, 4], [13, 0, 3, 6], [0, 6, 4, 5], [5, 5, 6, 5],
      [12, 7, 4, 4], [0, 12, 7, 4], [8, 11, 4, 5], [13, 12, 3, 4]
    ];
    for (const [sx, sy, w, h] of stones) {
      const shade = pick(['#8f8f8f', '#9d9d9d', '#848484', '#a6a6a6']);
      for (let x = sx; x < Math.min(TILE, sx + w); x++) {
        for (let y = sy; y < Math.min(TILE, sy + h); y++) {
          api.put(x, y, rnd() < 0.18 ? '#787878' : shade);
        }
      }
      for (let x = sx; x < Math.min(TILE, sx + w); x++) api.put(x, Math.min(TILE - 1, sy + h - 1), '#5c5c5c');
      for (let y = sy; y < Math.min(TILE, sy + h); y++) api.put(Math.min(TILE - 1, sx + w - 1), y, '#5c5c5c');
    }
  });

  define('sand', (api) => speckle(api, '#dbd0a0', ['#d2c692', '#e6dcb0', '#cabd88'], 0.45));

  define('sandstone_top', (api) => speckle(api, '#d8cc9a', ['#cfc28c', '#e2d8ab'], 0.4));

  define('sandstone_side', (api) => {
    speckle(api, '#d8cc9a', ['#cfc28c', '#e2d8ab'], 0.3);
    for (let x = 0; x < TILE; x++) {
      api.put(x, 0, '#e8dfb6');
      api.put(x, 3, '#bfb17c');
      api.put(x, 11, '#bfb17c');
    }
  });

  define('gravel', (api) => {
    speckle(api, '#867f7c', ['#736c69', '#9a9491', '#5f5a57', '#a8a29f'], 0.85);
  });

  define('log_side', (api) => {
    api.fill('#6b532e');
    for (let x = 0; x < TILE; x++) {
      const col = pick(['#5e4827', '#775b33', '#54401f', '#82653a']);
      for (let y = 0; y < TILE; y++) {
        api.put(x, y, rnd() < 0.25 ? pick(['#4d3a1d', '#8a6c3e']) : col);
      }
    }
  });

  define('log_top', (api) => {
    api.fill('#a1814c');
    for (let x = 0; x < TILE; x++) {
      for (let y = 0; y < TILE; y++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        const ring = Math.floor(d) % 2 === 0 ? '#ab8b53' : '#8f7142';
        api.put(x, y, d > 7 ? '#5e4827' : ring);
      }
    }
  });

  define('leaves', (api) => {
    api.clear();
    for (let x = 0; x < TILE; x++) {
      for (let y = 0; y < TILE; y++) {
        if (rnd() < 0.12) continue;
        api.put(x, y, pick(['#3d7a2a', '#336a22', '#478c31', '#2c5c1d', '#519d38']));
      }
    }
  });

  define('planks', (api) => {
    api.fill('#9c7b4a');
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        api.put(x, y, pick(['#9c7b4a', '#a88654', '#8f7043']));
      }
    }
    for (let x = 0; x < TILE; x++) {
      api.put(x, 0, '#6f5531');
      api.put(x, 5, '#6f5531');
      api.put(x, 10, '#6f5531');
      api.put(x, 15, '#6f5531');
    }
    api.put(3, 2, '#75592f'); api.put(4, 2, '#75592f'); api.put(11, 7, '#75592f'); api.put(7, 12, '#75592f');
  });

  define('bedrock', (api) => {
    api.fill('#4f4f4f');
    for (let x = 0; x < TILE; x++) {
      for (let y = 0; y < TILE; y++) {
        api.put(x, y, pick(['#3a3a3a', '#565656', '#2b2b2b', '#6a6a6a', '#454545']));
      }
    }
  });

  function oreTile(name, blobColors, highlight) {
    define(name, (api) => {
      speckle(api, '#8a8a8a', ['#7d7d7d', '#979797', '#727272'], 0.5);
      const blobs = [[2, 3], [9, 2], [4, 10], [11, 9], [7, 6]];
      for (const [bx, by] of blobs) {
        if (rnd() < 0.15) continue;
        const w = 2 + Math.floor(rnd() * 2), h = 2 + Math.floor(rnd() * 2);
        for (let x = bx; x < Math.min(TILE, bx + w); x++) {
          for (let y = by; y < Math.min(TILE, by + h); y++) {
            api.put(x, y, pick(blobColors));
          }
        }
        api.put(bx, by, highlight);
      }
    });
  }

  oreTile('coal_ore', ['#2b2b2b', '#1c1c1c', '#3a3a3a'], '#4a4a4a');
  oreTile('iron_ore', ['#c9a184', '#b98d6f', '#d7b096'], '#e5c7b1');
  oreTile('gold_ore', ['#f0c635', '#dbaf24', '#ffdd55'], '#fff0a0');
  oreTile('diamond_ore', ['#4aedd9', '#35c9b8', '#7cf7e8'], '#c4fff8');

  define('water', (api) => {
    api.fill('#3a68c9');
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        api.put(x, y, pick(['#3a68c9', '#4374d6', '#3560bb', '#4a7ce0']));
      }
    }
    for (let i = 0; i < 3; i++) {
      const y = 2 + i * 5;
      for (let x = 0; x < TILE; x++) if (rnd() < 0.7) api.put(x, y, '#5588ee');
    }
  });

  define('snow', (api) => speckle(api, '#f2f8f8', ['#e6eeee', '#ffffff', '#dde7e7'], 0.35));

  define('grass_side_snow', (api) => {
    speckle(api, '#79553a', ['#6b4a31', '#85603f', '#6f4f35'], 0.5);
    for (let x = 0; x < TILE; x++) {
      const d = 3 + Math.floor(rnd() * 3);
      for (let y = 0; y < d; y++) api.put(x, y, pick(['#f2f8f8', '#ffffff', '#e6eeee']));
    }
  });

  define('cactus_side', (api) => {
    speckle(api, '#4f7d3a', ['#456e32', '#5b8d44'], 0.4);
    for (let y = 0; y < TILE; y++) {
      api.put(0, y, '#3b5e2b');
      api.put(15, y, '#3b5e2b');
    }
    for (let i = 0; i < 5; i++) api.put(4 + Math.floor(rnd() * 8), Math.floor(rnd() * TILE), '#d7e8c0');
  });

  define('cactus_top', (api) => {
    speckle(api, '#5b8d44', ['#4f7d3a', '#67a04d'], 0.4);
    for (let x = 4; x < 12; x++) { api.put(x, 4, '#3b5e2b'); api.put(x, 11, '#3b5e2b'); }
    for (let y = 4; y < 12; y++) { api.put(4, y, '#3b5e2b'); api.put(11, y, '#3b5e2b'); }
  });

  define('glass', (api) => {
    api.clear();
    for (let x = 0; x < TILE; x++) {
      api.put(x, 0, '#c8e4ea'); api.put(x, 15, '#c8e4ea');
      api.put(0, x, '#c8e4ea'); api.put(15, x, '#c8e4ea');
    }
    api.put(3, 3, '#e8f6f9'); api.put(4, 3, '#e8f6f9'); api.put(3, 4, '#e8f6f9');
    api.put(11, 9, '#e8f6f9'); api.put(12, 9, '#e8f6f9');
  });

  // ---------------------------------------------------------------- workstations
  define('crafting_table_top', (api) => {
    speckle(api, '#9c7b4a', ['#a88654', '#8f7043'], 0.3);
    for (let x = 0; x < TILE; x++) { api.put(x, 0, '#6f5531'); api.put(x, 15, '#6f5531'); }
    for (let y = 0; y < TILE; y++) { api.put(0, y, '#6f5531'); api.put(15, y, '#6f5531'); }
    for (let x = 2; x < 14; x++) { api.put(x, 5, '#75592f'); api.put(x, 10, '#75592f'); }
    for (let y = 2; y < 14; y++) { api.put(5, y, '#75592f'); api.put(10, y, '#75592f'); }
  });

  define('crafting_table_front', (api) => {
    speckle(api, '#8f7043', ['#9c7b4a', '#7d6039'], 0.3);
    for (let x = 0; x < TILE; x++) api.put(x, 0, '#6f5531');
    api.put(3, 4, '#3f3020'); api.put(4, 4, '#3f3020'); api.put(3, 5, '#3f3020');
    for (let x = 2; x < 8; x++) for (let y = 7; y < 12; y++) api.put(x, y, '#6b5330');
    for (let x = 9; x < 14; x++) for (let y = 4; y < 9; y++) api.put(x, y, '#6b5330');
  });

  define('crafting_table_side', (api) => {
    speckle(api, '#8f7043', ['#9c7b4a', '#7d6039'], 0.3);
    for (let x = 0; x < TILE; x++) api.put(x, 0, '#6f5531');
    for (let x = 1; x < 15; x++) { api.put(x, 3, '#75592f'); api.put(x, 9, '#75592f'); }
  });

  define('furnace_top', (api) => speckle(api, '#7d7d7d', ['#6f6f6f', '#8c8c8c', '#636363'], 0.5));

  define('furnace_side', (api) => {
    speckle(api, '#7d7d7d', ['#6f6f6f', '#8c8c8c'], 0.45);
    for (let x = 0; x < TILE; x++) { api.put(x, 0, '#5c5c5c'); api.put(x, 15, '#5c5c5c'); }
  });

  define('furnace_front', (api) => {
    speckle(api, '#7d7d7d', ['#6f6f6f', '#8c8c8c'], 0.45);
    for (let x = 0; x < TILE; x++) { api.put(x, 0, '#5c5c5c'); api.put(x, 15, '#5c5c5c'); }
    for (let x = 3; x < 13; x++) for (let y = 5; y < 13; y++) api.put(x, y, '#2f2f2f');
    for (let x = 3; x < 13; x++) api.put(x, 4, '#5c5c5c');
    for (let x = 4; x < 12; x++) { api.put(x, 6, '#4a4a4a'); api.put(x, 7, '#4a4a4a'); }
  });

  define('furnace_front_lit', (api) => {
    speckle(api, '#7d7d7d', ['#6f6f6f', '#8c8c8c'], 0.45);
    for (let x = 0; x < TILE; x++) { api.put(x, 0, '#5c5c5c'); api.put(x, 15, '#5c5c5c'); }
    for (let x = 3; x < 13; x++) for (let y = 5; y < 13; y++) api.put(x, y, '#2f2f2f');
    for (let x = 3; x < 13; x++) api.put(x, 4, '#5c5c5c');
    for (let x = 4; x < 12; x++) {
      for (let y = 8; y < 12; y++) {
        api.put(x, y, pick(['#ff9a2b', '#ffd04d', '#e2631a', '#ffb43d']));
      }
    }
  });

  define('wool', (api) => {
    speckle(api, '#e9ecec', ['#dcdfdf', '#f4f6f6', '#d3d6d6'], 0.5);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rnd() * TILE), y = Math.floor(rnd() * TILE);
      api.put(x, y, '#c9cccc');
    }
  });

  // a torch is drawn on a transparent tile: the mesher hangs it on crossed quads
  define('torch', (api) => {
    api.clear();
    for (let y = 8; y < 16; y++) {
      api.put(7, y, '#6b4a2a');
      api.put(8, y, '#8b6a3f');
    }
    api.put(7, 13, '#5c3f24');
    api.put(8, 11, '#9c7b4a');
    for (let y = 5; y < 8; y++) { api.put(7, y, '#ffd04d'); api.put(8, y, '#ffb43d'); }
    api.put(7, 4, '#fff1a8'); api.put(8, 4, '#ffd97a');
    api.put(6, 6, '#e2631a'); api.put(9, 6, '#e2631a');
    api.put(6, 5, '#ff9a2b'); api.put(9, 5, '#ff9a2b');
  });

  define('bed_top', (api) => {
    speckle(api, '#a02020', ['#8d1b1b', '#b52a2a'], 0.4);
    for (let x = 2; x < 14; x++) { api.put(x, 1, '#e9ecec'); api.put(x, 2, '#f4f6f6'); api.put(x, 3, '#dcdfdf'); }
    for (let y = 0; y < TILE; y++) { api.put(0, y, '#7d1717'); api.put(15, y, '#7d1717'); }
    for (let x = 0; x < TILE; x++) api.put(x, 15, '#7d1717');
  });

  define('bed_side', (api) => {
    speckle(api, '#a02020', ['#8d1b1b', '#b52a2a'], 0.35);
    for (let x = 0; x < TILE; x++) { api.put(x, 0, '#c23434'); api.put(x, 9, '#6b4a2a'); }
    for (let x = 0; x < TILE; x++) for (let y = 10; y < TILE; y++) api.put(x, y, pick(['#9c7b4a', '#8b6a3f', '#6f5531']));
    for (let x = 1; x < 5; x++) for (let y = 1; y < 8; y++) api.put(x, y, '#e9ecec');
  });

  // ---- plants and farming ---------------------------------------------------
  define('tall_grass', (api) => {
    api.clear();
    const greens = ['#5d9c3c', '#4f8a33', '#6cae46', '#437a2b'];
    for (let b = 0; b < 9; b++) {
      let x = 1 + Math.floor(rnd() * 14);
      const h = 6 + Math.floor(rnd() * 9);
      for (let y = 15; y > 15 - h; y--) {
        api.put(x, y, pick(greens));
        if (rnd() < 0.25) x = Math.max(0, Math.min(15, x + (rnd() < 0.5 ? -1 : 1)));
      }
    }
  });

  function flower(name, petal, dark, centre) {
    define(name, (api) => {
      api.clear();
      for (let y = 8; y < 16; y++) api.put(7, y, y % 3 ? '#4f8a33' : '#437a2b');
      api.put(6, 12, '#5d9c3c'); api.put(5, 11, '#5d9c3c'); api.put(8, 13, '#5d9c3c'); api.put(9, 12, '#5d9c3c');
      const pts = [[6, 4], [7, 4], [8, 4], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [5, 6], [6, 6], [8, 6], [9, 6], [6, 7], [7, 7], [8, 7]];
      for (const [x, y] of pts) api.put(x, y, rnd() < 0.3 ? dark : petal);
      api.put(7, 6, centre);
    });
  }
  flower('dandelion', '#f5d82b', '#d8b418', '#f09a1a');
  flower('poppy', '#d6282a', '#a31c1f', '#2b2b2b');

  define('farmland_top', (api) => {
    speckle(api, '#5a3b22', ['#4d321c', '#664429', '#3f2916'], 0.6);
    for (let y = 1; y < TILE; y += 4) for (let x = 0; x < TILE; x++) api.put(x, y, pick(['#3f2916', '#35220f']));
  });

  for (let stage = 0; stage < 4; stage++) {
    define('wheat_' + stage, (api) => {
      api.clear();
      const h = 4 + stage * 3;
      const stem = stage < 3 ? ['#5d9c3c', '#6cae46', '#4f8a33'] : ['#b8a23a', '#c9b64a', '#a18c2c'];
      for (const x of [1, 4, 7, 10, 13]) {
        for (let y = 15; y > 15 - h; y--) api.put(x + (y % 5 === 0 ? 1 : 0), y, pick(stem));
        if (stage === 3) {
          for (let y = 15 - h; y < 15 - h + 4; y++) { api.put(x, y, '#d9c25a'); api.put(x + 1, y, '#c4a93f'); }
        }
      }
    });
  }

  for (let stage = 0; stage < 4; stage++) {
    define('carrots_' + stage, (api) => {
      api.clear();
      const h = 3 + stage * 2;
      for (const x of [2, 6, 10, 13]) {
        for (let y = 15; y > 15 - h; y--) api.put(x + (y % 3 === 0 ? 1 : 0), y, pick(['#4f8a33', '#5d9c3c', '#6cae46']));
        if (stage === 3) { api.put(x, 15, '#e9731a'); api.put(x + 1, 15, '#f39a2a'); api.put(x, 14, '#e9731a'); }
      }
    });
  }

  oreTile('lapis_ore', ['#1f4fb4', '#2a62d4', '#173c8c'], '#6f9cf0');

  define('sugar_cane', (api) => {
    api.clear();
    for (const x of [3, 7, 11]) {
      for (let y = 0; y < TILE; y++) {
        api.put(x, y, y % 5 === 0 ? '#7fa84a' : '#9ccc5c');
        api.put(x + 1, y, y % 5 === 0 ? '#6b9440' : '#86b84e');
      }
      api.put(x - 1, 3 + (x % 4), '#9ccc5c'); api.put(x + 2, 9 - (x % 3), '#86b84e');
    }
  });

  define('bookshelf', (api) => {
    speckle(api, '#9c7b4a', ['#8b6a3f', '#a8875a'], 0.3);
    for (const row of [1, 9]) {
      for (let x = 1; x < 15; x++) {
        const c = ['#a8322e', '#3a5aa8', '#3e8a3e', '#c9a43a', '#6b3a8c', '#8b5a2b'][Math.floor(x / 2.4) % 6];
        for (let y = row; y < row + 6; y++) api.put(x, y, x % 2 ? c : '#2a1a0e');
      }
    }
    for (let x = 0; x < TILE; x++) { api.put(x, 0, '#6b4a2a'); api.put(x, 7, '#6b4a2a'); api.put(x, 8, '#6b4a2a'); api.put(x, 15, '#6b4a2a'); }
  });

  define('enchant_top', (api) => {
    speckle(api, '#9e1b25', ['#8b1620', '#b0232e'], 0.3);
    for (let i = 0; i < TILE; i++) { api.put(i, 0, '#15101f'); api.put(i, 15, '#15101f'); api.put(0, i, '#15101f'); api.put(15, i, '#15101f'); }
    for (let x = 4; x < 12; x++) for (let y = 5; y < 11; y++) api.put(x, y, x === 7 || x === 8 ? '#6b4a2a' : '#e8e0c8');
  });

  define('enchant_side', (api) => {
    speckle(api, '#15101f', ['#1f1830', '#2a2140', '#3a2c55'], 0.5);
    for (let x = 0; x < TILE; x++) for (let y = 0; y < 4; y++) api.put(x, y, pick(['#9e1b25', '#8b1620']));
    for (const [x, y] of [[1, 5], [14, 5], [2, 6], [13, 6]]) api.put(x, y, '#4aedd9');
  });

  // ---- the nether ----------------------------------------------------------
  define('netherrack', (api) => {
    speckle(api, '#6b2626', ['#7d2e2e', '#5a1e1e', '#8a3a36', '#4d1818'], 0.65);
  });
  define('soul_sand', (api) => {
    speckle(api, '#4d3a2c', ['#5a4535', '#3f2f24', '#614b3a'], 0.6);
    for (const [x, y] of [[3, 4], [10, 3], [6, 10], [12, 11]]) {
      api.put(x, y, '#2a1e16'); api.put(x + 1, y, '#2a1e16'); api.put(x, y + 1, '#2a1e16'); api.put(x + 1, y + 1, '#2a1e16');
    }
  });
  define('glowstone', (api) => {
    speckle(api, '#c89a4a', ['#f2d27a', '#ffe9a8', '#a8793a', '#e8b85a'], 0.7);
  });
  oreTile('quartz_ore', ['#e8e2d8', '#f4f0e8', '#d0c8b8'], '#ffffff');
  define('portal', (api) => {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const w = Math.sin((x + y * 0.7) * 0.9) + Math.cos((x * 0.6 - y) * 0.8);
        api.put(x, y, w > 0.6 ? '#b36cff' : w > -0.2 ? '#7a2ad8' : '#4a1498');
      }
    }
  });

  define('chest_top', (api) => {
    speckle(api, '#a0712f', ['#8b5f24', '#b58239', '#946826'], 0.5);
    for (let i = 0; i < TILE; i++) { api.put(i, 0, '#4a3312'); api.put(i, 15, '#4a3312'); api.put(0, i, '#4a3312'); api.put(15, i, '#4a3312'); }
  });

  define('chest_side', (api) => {
    speckle(api, '#a0712f', ['#8b5f24', '#b58239', '#946826'], 0.5);
    for (let i = 0; i < TILE; i++) { api.put(i, 0, '#4a3312'); api.put(i, 15, '#4a3312'); api.put(0, i, '#4a3312'); api.put(15, i, '#4a3312'); api.put(i, 5, '#4a3312'); }
    for (let x = 7; x < 9; x++) for (let y = 4; y < 8; y++) api.put(x, y, y === 4 ? '#8a8a8a' : '#c8c8c8');
  });

  // ---- building ----------------------------------------------------------
  function doorHalf(api, upper) {
    speckle(api, '#9c7b4a', ['#8b6a3f', '#a8875a', '#8f7043'], 0.4);
    for (let y = 0; y < TILE; y++) { api.put(0, y, '#6b4a2a'); api.put(15, y, '#6b4a2a'); }
    for (let x = 0; x < TILE; x++) { api.put(x, upper ? 0 : 15, '#6b4a2a'); }
    if (upper) {
      // two small windows
      for (let x = 3; x < 7; x++) for (let y = 3; y < 8; y++) api.put(x, y, '#c9e4f0');
      for (let x = 9; x < 13; x++) for (let y = 3; y < 8; y++) api.put(x, y, '#c9e4f0');
      for (let x = 2; x < 14; x++) { api.put(x, 10, '#6b4a2a'); }
    } else {
      for (let x = 2; x < 14; x++) { api.put(x, 4, '#6b4a2a'); api.put(x, 11, '#6b4a2a'); }
      api.put(12, 1, '#3b3b3b'); api.put(12, 2, '#3b3b3b');
    }
  }
  define('door_lower', (api) => doorHalf(api, false));
  define('door_upper', (api) => doorHalf(api, true));

  define('ladder', (api) => {
    api.clear();
    for (let y = 0; y < TILE; y++) { api.put(2, y, '#8b6a3f'); api.put(3, y, '#6b4a2a'); api.put(12, y, '#8b6a3f'); api.put(13, y, '#6b4a2a'); }
    for (const y of [1, 5, 9, 13]) for (let x = 2; x < 14; x++) { api.put(x, y, '#9c7b4a'); api.put(x, y + 1, '#6b4a2a'); }
  });

  define('lava', (api) => {
    speckle(api, '#d4580f', ['#e9731a', '#f39a2a', '#c2410b', '#ffb13b'], 0.7);
    for (let i = 0; i < 10; i++) api.put(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), '#ffd46a');
  });

  define('obsidian', (api) => {
    speckle(api, '#15101f', ['#1f1830', '#2a2140', '#0d0a14', '#3a2c55'], 0.55);
  });

  // ---------------------------------------------------------------- items
  const MAT = {
    wood: { a: '#9c7b4a', b: '#6f5531', c: '#b79262' },
    stone: { a: '#8a8a8a', b: '#5c5c5c', c: '#a6a6a6' },
    iron: { a: '#d8d8d8', b: '#9a9a9a', c: '#f2f2f2' },
    gold: { a: '#f0c635', b: '#b8901c', c: '#ffe071' },
    diamond: { a: '#4aedd9', b: '#2ba99a', c: '#9df9ee' }
  };
  const HANDLE = { a: '#8b6a3f', b: '#5e4527' };

  function rectOn(api, x, y, w, h, color) {
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) api.put(x + dx, y + dy, color);
  }

  function drawHandle(api) {
    for (let i = 0; i < 8; i++) {
      const x = 10 - i, y = 5 + i;
      api.put(x, y, HANDLE.b);
      api.put(x + 1, y, HANDLE.a);
    }
    api.put(2, 13, HANDLE.b);
  }

  function drawTool(api, kind, m) {
    api.clear();
    if (kind !== 'sword') drawHandle(api);

    if (kind === 'pickaxe') {
      rectOn(api, 7, 1, 6, 1, m.c);
      rectOn(api, 6, 2, 8, 2, m.a);
      api.put(5, 3, m.a); api.put(14, 3, m.a);
      api.put(4, 4, m.b); api.put(5, 4, m.a); api.put(13, 4, m.a); api.put(14, 4, m.b);
      api.put(3, 5, m.b); api.put(15, 5, m.b);
      for (let x = 6; x < 14; x++) api.put(x, 1, m.c);
    } else if (kind === 'axe') {
      rectOn(api, 8, 1, 4, 1, m.c);
      rectOn(api, 7, 2, 6, 3, m.a);
      rectOn(api, 8, 5, 4, 1, m.a);
      rectOn(api, 9, 6, 2, 1, m.b);
      for (let y = 2; y < 5; y++) api.put(7, y, m.c);
      api.put(12, 2, m.b); api.put(12, 4, m.b);
    } else if (kind === 'shovel') {
      rectOn(api, 9, 1, 3, 1, m.c);
      rectOn(api, 8, 2, 5, 3, m.a);
      rectOn(api, 9, 5, 3, 1, m.a);
      api.put(10, 6, m.b);
      api.put(8, 2, m.c); api.put(12, 4, m.b);
    } else if (kind === 'hoe') {
      rectOn(api, 8, 1, 6, 2, m.a);
      rectOn(api, 8, 3, 2, 2, m.a);
      for (let x = 8; x < 14; x++) api.put(x, 1, m.c);
      api.put(13, 2, m.b); api.put(9, 4, m.b);
    } else if (kind === 'sword') {
      api.put(2, 13, HANDLE.b); api.put(3, 13, HANDLE.b);
      api.put(2, 12, HANDLE.b); api.put(3, 12, HANDLE.a);
      api.put(4, 11, HANDLE.a); api.put(3, 11, HANDLE.b);
      api.put(2, 10, m.b); api.put(3, 10, m.a); api.put(4, 10, m.a);
      api.put(5, 11, m.a); api.put(5, 12, m.b); api.put(4, 12, m.a);
      for (let i = 0; i < 8; i++) {
        api.put(4 + i, 10 - i, m.a);
        api.put(5 + i, 10 - i, m.c);
      }
      api.put(12, 2, m.a); api.put(13, 2, m.c); api.put(13, 1, m.c);
    }
  }

  function drawArmor(api, piece, m) {
    api.clear();
    if (piece === 'helmet') {
      rectOn(api, 4, 3, 8, 2, m.a);
      rectOn(api, 3, 5, 10, 1, m.a);
      rectOn(api, 3, 6, 2, 4, m.a);
      rectOn(api, 11, 6, 2, 4, m.a);
      rectOn(api, 5, 6, 6, 1, m.b);
      for (let x = 4; x < 12; x++) api.put(x, 3, m.c);
    } else if (piece === 'chestplate') {
      rectOn(api, 3, 3, 3, 2, m.a);
      rectOn(api, 10, 3, 3, 2, m.a);
      rectOn(api, 4, 5, 8, 7, m.a);
      rectOn(api, 3, 5, 1, 4, m.b);
      rectOn(api, 12, 5, 1, 4, m.b);
      for (let x = 4; x < 12; x++) api.put(x, 5, m.c);
      rectOn(api, 7, 7, 2, 3, m.b);
    } else if (piece === 'leggings') {
      rectOn(api, 4, 2, 8, 3, m.a);
      rectOn(api, 4, 5, 3, 7, m.a);
      rectOn(api, 9, 5, 3, 7, m.a);
      for (let x = 4; x < 12; x++) api.put(x, 2, m.c);
      rectOn(api, 7, 5, 2, 2, m.b);
    } else if (piece === 'boots') {
      rectOn(api, 3, 6, 4, 4, m.a);
      rectOn(api, 9, 6, 4, 4, m.a);
      rectOn(api, 2, 10, 5, 2, m.b);
      rectOn(api, 9, 10, 5, 2, m.b);
      for (let x = 3; x < 7; x++) api.put(x, 6, m.c);
      for (let x = 9; x < 13; x++) api.put(x, 6, m.c);
    }
  }

  define('item_stick', (api) => {
    api.clear();
    for (let i = 0; i < 9; i++) {
      api.put(10 - i, 4 + i, HANDLE.b);
      api.put(11 - i, 4 + i, HANDLE.a);
    }
  });

  define('item_coal', (api) => {
    api.clear();
    const blob = [[5, 4, 6, 2], [4, 6, 8, 4], [5, 10, 6, 2], [6, 3, 4, 1]];
    for (const [x, y, w, h] of blob) rectOn(api, x, y, w, h, '#2b2b2b');
    for (let i = 0; i < 14; i++) api.put(5 + Math.floor(rnd() * 6), 4 + Math.floor(rnd() * 8), pick(['#1a1a1a', '#3d3d3d', '#141414']));
    api.put(6, 5, '#4f4f4f'); api.put(7, 5, '#4f4f4f');
  });

  function ingotTile(name, m) {
    define(name, (api) => {
      api.clear();
      rectOn(api, 4, 6, 8, 4, m.a);
      rectOn(api, 3, 7, 1, 2, m.b);
      rectOn(api, 12, 7, 1, 2, m.b);
      for (let x = 4; x < 12; x++) api.put(x, 6, m.c);
      for (let x = 4; x < 12; x++) api.put(x, 9, m.b);
      api.put(5, 7, m.c); api.put(6, 7, m.c);
    });
  }
  ingotTile('item_iron_ingot', MAT.iron);
  ingotTile('item_gold_ingot', MAT.gold);

  define('item_diamond', (api) => {
    api.clear();
    const d = MAT.diamond;
    rectOn(api, 6, 3, 4, 1, d.c);
    rectOn(api, 5, 4, 6, 1, d.a);
    rectOn(api, 4, 5, 8, 3, d.a);
    rectOn(api, 5, 8, 6, 2, d.a);
    rectOn(api, 6, 10, 4, 1, d.b);
    rectOn(api, 7, 11, 2, 1, d.b);
    api.put(6, 5, d.c); api.put(7, 4, d.c); api.put(5, 6, d.c);
    api.put(10, 8, d.b); api.put(9, 9, d.b);
  });

  // ---- food, mob drops --------------------------------------------------
  function lump(api, body, shade, light) {
    api.clear();
    const rows = [[5, 4, 6, 1], [4, 5, 8, 6], [5, 11, 6, 1]];
    for (const [x, y, w, h] of rows) rectOn(api, x, y, w, h, body);
    for (let i = 0; i < 16; i++) {
      api.put(4 + Math.floor(rnd() * 8), 5 + Math.floor(rnd() * 6), pick([shade, body, light]));
    }
    for (let x = 5; x < 9; x++) api.put(x, 5, light);
    for (let x = 6; x < 11; x++) api.put(x, 10, shade);
  }

  define('item_apple', (api) => {
    api.clear();
    rectOn(api, 4, 5, 8, 7, '#d5322b');
    rectOn(api, 5, 4, 6, 1, '#d5322b');
    rectOn(api, 5, 12, 6, 1, '#a9231e');
    for (let y = 5; y < 11; y++) api.put(11, y, '#a9231e');
    api.put(5, 6, '#f16a5f'); api.put(6, 5, '#f16a5f'); api.put(6, 6, '#ff9a90');
    rectOn(api, 8, 2, 1, 3, '#6b4a2a');
    rectOn(api, 9, 2, 3, 1, '#4f8a33');
    api.put(10, 3, '#5d9c3c');
  });

  define('item_rotten_flesh', (api) => lump(api, '#7a5a3c', '#5b4229', '#9a7a56'));
  define('item_raw_beef', (api) => lump(api, '#c2585a', '#9c3f45', '#e08a86'));
  define('item_cooked_beef', (api) => lump(api, '#8a5230', '#6a3c22', '#b57a4c'));
  define('item_raw_pork', (api) => lump(api, '#e0918f', '#bd6a6c', '#f5b8b2'));
  define('item_cooked_pork', (api) => lump(api, '#c07a44', '#96592e', '#e0a468'));
  define('item_raw_chicken', (api) => lump(api, '#e3b7a0', '#c08d79', '#f6d8c6'));
  define('item_cooked_chicken', (api) => lump(api, '#cf9558', '#a56f3a', '#eabb85'));
  define('item_raw_mutton', (api) => lump(api, '#d05a52', '#a83f3f', '#eb9089'));
  define('item_cooked_mutton', (api) => lump(api, '#b06a3c', '#8a4c26', '#d59462'));

  define('item_bone', (api) => {
    api.clear();
    for (let i = 0; i < 9; i++) rectOn(api, 4 + i * 0.7 | 0, 10 - i, 2, 2, '#e8e6d8');
    rectOn(api, 3, 11, 3, 2, '#e8e6d8'); rectOn(api, 4, 13, 2, 2, '#d5d2c2');
    rectOn(api, 10, 1, 3, 2, '#f4f2e6'); rectOn(api, 11, 3, 2, 2, '#e8e6d8');
    api.put(3, 12, '#f4f2e6'); api.put(12, 2, '#f4f2e6');
  });

  define('item_string', (api) => {
    api.clear();
    const pts = [[3, 2], [5, 3], [7, 5], [8, 7], [7, 9], [5, 10], [4, 12], [6, 13], [9, 13], [11, 11], [12, 9]];
    for (const [x, y] of pts) { api.put(x, y, '#e8e8e8'); api.put(x, y + 1, '#c4c4c4'); }
  });

  define('item_gunpowder', (api) => {
    api.clear();
    for (let i = 0; i < 46; i++) {
      const x = 3 + Math.floor(rnd() * 10), y = 3 + Math.floor(rnd() * 10);
      api.put(x, y, pick(['#4a4a4a', '#2f2f2f', '#6a6a6a', '#3d3d3d']));
    }
  });

  define('item_oak_door', (api) => {
    api.clear();
    rectOn(api, 4, 1, 8, 14, '#9c7b4a');
    for (let y = 1; y < 15; y++) { api.put(4, y, '#6b4a2a'); api.put(11, y, '#6b4a2a'); }
    rectOn(api, 5, 3, 2, 3, '#c9e4f0'); rectOn(api, 8, 3, 2, 3, '#c9e4f0');
    rectOn(api, 5, 8, 6, 1, '#6b4a2a');
    api.put(10, 10, '#3b3b3b');
  });

  function bucket(name, fill) {
    define(name, (api) => {
      api.clear();
      rectOn(api, 3, 5, 10, 1, '#9a9a9a');
      rectOn(api, 3, 6, 1, 7, '#b8b8b8'); rectOn(api, 12, 6, 1, 7, '#8a8a8a');
      rectOn(api, 4, 13, 8, 1, '#8a8a8a');
      rectOn(api, 4, 6, 8, 7, fill ? fill : '#6a6a6a');
      if (!fill) rectOn(api, 4, 7, 8, 6, '#555555');
      for (let x = 4; x < 12; x++) api.put(x, 3 - Math.round(Math.sin((x - 4) / 7 * Math.PI) * 2), '#c8c8c8');
    });
  }
  bucket('item_bucket', null);
  bucket('item_water_bucket', '#3f6fd8');
  bucket('item_lava_bucket', '#e9731a');

  define('item_bow', (api) => {
    api.clear();
    // the stave curves down the left, the string runs straight up the right
    const arc = [[10, 1], [9, 2], [8, 3], [7, 4], [6, 5], [5, 6], [5, 7], [5, 8], [5, 9], [6, 10], [7, 11], [8, 12], [9, 13], [10, 14]];
    for (const [x, y] of arc) { api.put(x, y, '#8b6a3f'); api.put(x - 1, y, '#6b4a2a'); }
    for (let y = 1; y <= 14; y++) api.put(12, y, '#e8e8e8');
    api.put(11, 1, '#c8c8c8'); api.put(11, 14, '#c8c8c8');
  });

  define('item_arrow', (api) => {
    api.clear();
    for (let i = 0; i < 10; i++) { api.put(3 + i, 12 - i, '#8b6a3f'); }
    rectOn(api, 12, 2, 2, 2, '#a8a8a8'); api.put(13, 1, '#d0d0d0'); api.put(14, 2, '#d0d0d0');
    api.put(2, 12, '#e8e8e8'); api.put(3, 13, '#e8e8e8'); api.put(2, 13, '#c0c0c0'); api.put(4, 13, '#e8e8e8'); api.put(2, 11, '#e8e8e8');
  });

  define('item_flint', (api) => {
    api.clear();
    rectOn(api, 5, 4, 5, 8, '#3a3a3a'); rectOn(api, 6, 3, 3, 1, '#4a4a4a'); rectOn(api, 10, 6, 1, 5, '#2a2a2a');
    api.put(6, 5, '#6a6a6a'); api.put(7, 6, '#5a5a5a');
  });

  define('item_feather', (api) => {
    api.clear();
    for (let i = 0; i < 11; i++) api.put(4 + i, 13 - i, '#d8d8d8');
    for (let i = 2; i < 10; i++) { api.put(5 + i, 13 - i - 2, '#f4f4f4'); api.put(3 + i, 13 - i + 1, '#e8e8e8'); }
  });

  define('item_leather', (api) => {
    api.clear();
    rectOn(api, 3, 4, 10, 8, '#8b5a2b'); rectOn(api, 4, 3, 8, 1, '#8b5a2b'); rectOn(api, 4, 12, 8, 1, '#6f4520');
    for (let i = 0; i < 10; i++) api.put(4 + Math.floor(rnd() * 8), 5 + Math.floor(rnd() * 6), '#a06a36');
  });

  define('item_carrot', (api) => {
    api.clear();
    for (let i = 0; i < 9; i++) { rectOn(api, 3 + i, 12 - i, 2, 2, i % 3 ? '#f08a24' : '#d5701a'); }
    rectOn(api, 12, 1, 1, 3, '#4f8a33'); rectOn(api, 13, 2, 2, 1, '#5d9c3c'); api.put(11, 2, '#6cae46');
  });

  define('item_lapis', (api) => {
    api.clear();
    rectOn(api, 4, 4, 8, 8, '#2a62d4'); rectOn(api, 5, 3, 6, 1, '#3a74e8'); rectOn(api, 3, 5, 1, 6, '#1f4fb4');
    rectOn(api, 12, 5, 1, 6, '#173c8c'); rectOn(api, 5, 12, 6, 1, '#173c8c');
    api.put(6, 5, '#8fb4ff'); api.put(7, 6, '#6f9cf0');
  });

  define('item_paper', (api) => {
    api.clear();
    rectOn(api, 3, 3, 10, 11, '#f2efe4');
    rectOn(api, 12, 4, 1, 10, '#d8d2c0'); rectOn(api, 4, 13, 9, 1, '#d8d2c0');
    for (const y of [5, 7, 9, 11]) rectOn(api, 5, y, 6, 1, '#e2ddce');
  });

  define('item_book', (api) => {
    api.clear();
    rectOn(api, 3, 3, 10, 11, '#8b3a2b'); rectOn(api, 3, 3, 2, 11, '#6b2a1e');
    rectOn(api, 5, 12, 8, 1, '#f2efe4'); rectOn(api, 12, 4, 1, 8, '#f2efe4');
    rectOn(api, 7, 6, 4, 1, '#c9a43a');
  });

  define('item_emerald', (api) => {
    api.clear();
    rectOn(api, 6, 2, 4, 1, '#7ff0a0'); rectOn(api, 5, 3, 6, 1, '#3fd46a');
    rectOn(api, 4, 4, 8, 8, '#17b84a'); rectOn(api, 5, 12, 6, 1, '#0f8a36'); rectOn(api, 6, 13, 4, 1, '#0f8a36');
    rectOn(api, 5, 5, 2, 5, '#5fe68a'); api.put(7, 4, '#9ff7b8');
    rectOn(api, 11, 5, 1, 6, '#0f8a36');
  });

  define('item_flint_and_steel', (api) => {
    api.clear();
    rectOn(api, 3, 8, 5, 5, '#3a3a3a'); rectOn(api, 4, 9, 2, 2, '#5a5a5a');
    for (let i = 0; i < 6; i++) { api.put(8 + i, 7 - i, '#c8c8c8'); api.put(9 + i, 7 - i, '#8a8a8a'); }
    rectOn(api, 12, 1, 3, 2, '#a8a8a8');
  });
  define('item_quartz', (api) => {
    api.clear();
    rectOn(api, 5, 4, 6, 8, '#ece6dc'); rectOn(api, 6, 3, 4, 1, '#fffaf2'); rectOn(api, 11, 5, 1, 6, '#c8c0b0');
    rectOn(api, 6, 12, 4, 1, '#c8c0b0'); api.put(6, 5, '#ffffff');
  });

  define('item_seeds', (api) => {
    api.clear();
    const pts = [[5, 5], [9, 4], [7, 7], [4, 9], [10, 8], [6, 11], [9, 11], [12, 6], [3, 6]];
    for (const [x, y] of pts) { api.put(x, y, '#5d9c3c'); api.put(x + 1, y, '#3f6b25'); api.put(x, y + 1, '#4f8a33'); }
  });

  define('item_wheat', (api) => {
    api.clear();
    for (let i = 0; i < 11; i++) { api.put(3 + i, 13 - i, '#b8a23a'); api.put(4 + i, 13 - i, '#a18c2c'); }
    for (let i = 0; i < 5; i++) { rectOn(api, 10 + (i % 2), 1 + i, 3, 1, i % 2 ? '#d9c25a' : '#c4a93f'); }
    rectOn(api, 9, 4, 2, 2, '#d9c25a');
  });

  define('item_bread', (api) => {
    api.clear();
    rectOn(api, 2, 7, 12, 4, '#b8793a');
    rectOn(api, 3, 6, 10, 1, '#c98a45');
    rectOn(api, 2, 11, 12, 1, '#8a5626');
    for (const x of [4, 7, 10]) { api.put(x, 7, '#e3b066'); api.put(x + 1, 8, '#e3b066'); }
  });

  define('item_boat', (api) => {
    api.clear();
    rectOn(api, 1, 8, 14, 3, '#9c7b4a');
    rectOn(api, 2, 11, 12, 1, '#6f5531');
    rectOn(api, 1, 6, 2, 2, '#9c7b4a');
    rectOn(api, 13, 6, 2, 2, '#9c7b4a');
    for (let x = 1; x < 15; x++) api.put(x, 8, '#b79262');
    rectOn(api, 6, 3, 1, 5, '#6b4a2a');
  });

  const TOOL_KINDS = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
  const TOOL_TIERS = ['wood', 'stone', 'iron', 'gold', 'diamond'];
  for (const tier of TOOL_TIERS) {
    for (const kind of TOOL_KINDS) {
      define('item_' + tier + '_' + kind, (api) => drawTool(api, kind, MAT[tier]));
    }
  }

  const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];
  const ARMOR_TIERS = ['iron', 'gold', 'diamond'];
  for (const tier of ARMOR_TIERS) {
    for (const piece of ARMOR_PIECES) {
      define('item_' + tier + '_' + piece, (api) => drawArmor(api, piece, MAT[tier]));
    }
  }

  const texture = new THREE.CanvasTexture(atlas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const UV_INSET = 0.0008;
  function tileUV(index) {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const s = 1 / COLS;
    return {
      u0: col * s + UV_INSET,
      u1: (col + 1) * s - UV_INSET,
      v0: 1 - (row + 1) * s + UV_INSET,
      v1: 1 - row * s - UV_INSET
    };
  }

  const crackTextures = [];
  for (let stage = 0; stage < 4; stage++) {
    const c = document.createElement('canvas');
    c.width = TILE; c.height = TILE;
    const ctx = c.getContext('2d');
    rngState = 0x1234567 ^ Math.imul(stage + 1, 0x9e3779b1);
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    const lines = 1 + stage * 2;
    for (let i = 0; i < lines; i++) {
      let x = Math.floor(rnd() * TILE), y = Math.floor(rnd() * TILE);
      const len = 4 + stage * 3 + Math.floor(rnd() * 4);
      for (let s = 0; s < len; s++) {
        ctx.fillRect(x, y, 1, 1);
        if (rnd() < 0.5) x += rnd() < 0.5 ? 1 : -1; else y += rnd() < 0.5 ? 1 : -1;
        if (x < 0 || x >= TILE || y < 0 || y >= TILE) break;
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    crackTextures.push(t);
  }

  const iconCache = {};
  function iconURL(tileIndex, backdrop) {
    const key = tileIndex + (backdrop ? 'b' : '');
    if (iconCache[key]) return iconCache[key];
    const o = tileOrigin(tileIndex);
    const c = document.createElement('canvas');
    c.width = TILE; c.height = TILE;
    const ctx = c.getContext('2d');
    // see-through blocks (glass, leaves) need a backdrop to read as icons;
    // items must stay transparent so their silhouette shows
    if (backdrop) {
      ctx.fillStyle = '#9aa3ad';
      ctx.fillRect(0, 0, TILE, TILE);
    }
    ctx.drawImage(atlas, o.x, o.y, TILE, TILE, 0, 0, TILE, TILE);
    const url = c.toDataURL();
    iconCache[key] = url;
    return url;
  }

  function spriteFromMask(mask, palette, scale) {
    const h = mask.length, w = mask[0].length;
    const c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale;
    const ctx = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = mask[y][x];
        if (ch === ' ' || !palette[ch]) continue;
        ctx.fillStyle = palette[ch];
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return c.toDataURL();
  }

  const HEART = [
    ' xx xx ',
    'xaaxaax',
    'xaaaaax',
    'xaaaaax',
    ' xaaax ',
    '  xax  ',
    '   x   '
  ];
  const HALF_HEART = [
    ' xx xx ',
    'xaaxbbx',
    'xaaabbx',
    'xaaabbx',
    ' xaabx ',
    '  xbx  ',
    '   x   '
  ];
  const FOOD = [
    '   xx  ',
    '  xaax ',
    ' xaaax ',
    ' xaax  ',
    'xbbx   ',
    'xbx    ',
    ' x     '
  ];

  const ARMOR_ICON = [
    ' xxxxx ',
    'xaaaaax',
    'xaaaaax',
    'xaaaaax',
    ' xaaax ',
    '  xax  ',
    '   x   '
  ];
  const HALF_ARMOR = [
    ' xxxxx ',
    'xaaxbbx',
    'xaaxbbx',
    'xaaxbbx',
    ' xaxbx ',
    '  xbx  ',
    '   x   '
  ];

  // Steve-ish doll for the inventory preview; armour is painted over the base.
  const SKIN = { base: '#c99b7c', dark: '#a87e61', hair: '#3b2a1c', shirt: '#2f9fa8', shirtDark: '#26838a', pants: '#3b4396', shoe: '#5a4632' };

  function playerPreview(equipped) {
    const W = 16, H = 32, S = 4;
    const c = document.createElement('canvas');
    c.width = W * S; c.height = H * S;
    const ctx = c.getContext('2d');
    const px = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(x * S, y * S, S, S); };
    const box = (x, y, w, h, color) => { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) px(x + i, y + j, color); };

    box(4, 1, 8, 7, SKIN.base);
    box(4, 1, 8, 2, SKIN.hair);
    px(3, 2, SKIN.hair); px(12, 2, SKIN.hair);
    px(6, 4, '#ffffff'); px(9, 4, '#ffffff');
    px(6, 5, '#3b5ea8'); px(9, 5, '#3b5ea8');
    box(6, 6, 4, 1, SKIN.dark);

    box(5, 8, 6, 8, SKIN.shirt);
    box(3, 8, 2, 6, SKIN.shirt);
    box(11, 8, 2, 6, SKIN.shirt);
    box(3, 14, 2, 3, SKIN.base);
    box(11, 14, 2, 3, SKIN.base);

    box(5, 16, 3, 8, SKIN.pants);
    box(8, 16, 3, 8, SKIN.pants);
    box(5, 24, 3, 2, SKIN.shoe);
    box(8, 24, 3, 2, SKIN.shoe);

    const tint = { iron: MAT.iron, gold: MAT.gold, diamond: MAT.diamond };
    if (equipped) {
      const helm = tint[equipped.helmet];
      if (helm) { box(4, 0, 8, 3, helm.a); px(3, 1, helm.b); px(12, 1, helm.b); box(4, 3, 8, 1, helm.b); }
      const chest = tint[equipped.chestplate];
      if (chest) { box(5, 8, 6, 7, chest.a); box(3, 8, 2, 4, chest.a); box(11, 8, 2, 4, chest.a); box(5, 8, 6, 1, chest.c); }
      const legs = tint[equipped.leggings];
      if (legs) { box(5, 15, 6, 4, legs.a); box(5, 19, 3, 3, legs.a); box(8, 19, 3, 3, legs.a); }
      const boots = tint[equipped.boots];
      if (boots) { box(5, 22, 3, 4, boots.a); box(8, 22, 3, 4, boots.a); }
    }
    return c.toDataURL();
  }

  const icons = {
    heartFull: spriteFromMask(HEART, { x: '#3a0000', a: '#e02020' }, 3),
    heartHalf: spriteFromMask(HALF_HEART, { x: '#3a0000', a: '#e02020', b: '#4a4a4a' }, 3),
    heartEmpty: spriteFromMask(HEART, { x: '#1f1f1f', a: '#4a4a4a' }, 3),
    foodFull: spriteFromMask(FOOD, { x: '#2b1a0a', a: '#c98b3f', b: '#e8e0cf' }, 3),
    foodHalf: spriteFromMask(FOOD, { x: '#2b1a0a', a: '#8a7a5f', b: '#8a8377' }, 3),
    foodEmpty: spriteFromMask(FOOD, { x: '#1f1f1f', a: '#4a4a4a', b: '#3a3a3a' }, 3),
    armorFull: spriteFromMask(ARMOR_ICON, { x: '#1b1b1b', a: '#dfe6ef' }, 3),
    armorHalf: spriteFromMask(HALF_ARMOR, { x: '#1b1b1b', a: '#dfe6ef', b: '#4a4a4a' }, 3),
    armorEmpty: spriteFromMask(ARMOR_ICON, { x: '#1f1f1f', a: '#3d3d3d' }, 3)
  };

  global.Textures = { texture, TILES, tileUV, crackTextures, iconURL, icons, playerPreview, atlasCanvas: atlas };
})(window);
