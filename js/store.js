(function (global) {
  'use strict';

  // Everything is kept in this browser. There is no always-on server to hold a
  // shared world, so each player keeps their own copy: their inventory always,
  // and the world of any room they have been in. A player rejoining a room they
  // remember can hand that world back to whoever opened it.
  const PREFIX = 'vxl:';
  const MAX_EDITS = 40000;

  function available() {
    try {
      const k = PREFIX + 'probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  const ok = available();

  function read(key) {
    if (!ok) return null;
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    if (!ok) return false;
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      // out of quota (or a blocked store): the caller tells the player
      return false;
    }
  }

  function remove(key) {
    if (!ok) return;
    try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  }

  const Store = {
    ok,
    MAX_EDITS,

    saveWorld(worldKey, seed, flatEdits, entities) {
      if (flatEdits.length > MAX_EDITS * 4) flatEdits = flatEdits.slice(-MAX_EDITS * 4);
      return write(worldKey + ':world', {
        seed, edits: flatEdits, entities: entities || [], savedAt: Date.now()
      });
    },

    loadWorld(worldKey) {
      const data = read(worldKey + ':world');
      if (!data || !Array.isArray(data.edits)) return null;
      return data;
    },

    savePlayer(worldKey, state) {
      return write(worldKey + ':me', Object.assign({ savedAt: Date.now() }, state));
    },

    loadPlayer(worldKey) {
      return read(worldKey + ':me');
    },

    clearWorld(worldKey) {
      remove(worldKey + ':world');
      remove(worldKey + ':me');
      remove(worldKey + ':nether:world');
    },

    // no seed typed on the menu: carry on with the most recent single-player world
    lastSolo() {
      let best = null, bestT = 0;
      for (const key of this.savedWorlds()) {
        if (key.indexOf('s:') !== 0) continue;
        const w = this.loadWorld(key);
        if (!w) continue;
        // a world whose player is off in the nether was still played last
        const n = this.loadWorld(key + ':nether');
        const t = Math.max(w.savedAt || 0, n ? n.savedAt || 0 : 0);
        if ((w.edits.length || (n && n.edits.length)) && (!best || t > bestT)) { best = w; bestT = t; }
      }
      return best;
    },

    clearKind(prefix) {
      let n = 0;
      for (const key of this.savedWorlds()) {
        if (key.indexOf(prefix) !== 0) continue;
        this.clearWorld(key);
        n++;
      }
      return n;
    },

    hasKind(prefix) {
      for (const key of this.savedWorlds()) {
        if (key.indexOf(prefix) === 0) return true;
      }
      return false;
    },

    savedWorlds() {
      if (!ok) return [];
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(PREFIX) && k.endsWith(':world')) {
            const key = k.slice(PREFIX.length, -':world'.length);
            // the nether is part of the world it hangs off, not a world of its own
            if (!/:nether$/.test(key)) out.push(key);
          }
        }
      } catch (e) { /* ignore */ }
      return out;
    },

    saveSettings(values) { return write('settings', values); },

    loadSettings() { return read('settings'); },

    name(name) {
      if (name !== undefined) write('name', name);
      return read('name');
    }
  };

  global.Store = Store;
})(window);
