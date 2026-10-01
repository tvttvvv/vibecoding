(function (global) {
  'use strict';

  // Peer-to-peer multiplayer. The host is the authority: guests connect
  // straight to it, and everyone generates the same terrain locally from the
  // host's seed, so only block changes and player positions travel the wire.
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ID_PREFIX = 'vxlcraft-';
  const POS_INTERVAL = 80;
  const MOB_INTERVAL = 140;
  const MAX_GUESTS = 7;

  function randomCode(len) {
    let out = '';
    for (let i = 0; i < (len || 6); i++) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
  }

  function normalizeCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }

  function wrap(conn) {
    const w = {
      id: conn.peer,
      send(msg) { try { if (conn.open) conn.send(msg); } catch (e) { /* peer went away */ } },
      close() { try { conn.close(); } catch (e) { /* already closed */ } },
      onData: null,
      onClose: null
    };
    conn.on('data', (d) => { if (w.onData) w.onData(d); });
    conn.on('close', () => { if (w.onClose) w.onClose(); });
    conn.on('error', () => { if (w.onClose) w.onClose(); });
    return w;
  }

  // more ways through home routers and mobile networks than the defaults
  const PEER_OPTS = {
    debug: 0,
    config: {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
        { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' }
      ],
      sdpSemantics: 'unified-plan'
    }
  };

  const peerTransport = {
    createHost(code, cb) {
      if (typeof Peer === 'undefined') { cb.error('no-peerjs'); return null; }
      const peer = new Peer(ID_PREFIX + code, PEER_OPTS);
      let opened = false, closed = false, retry = 0;
      // the link to the matchmaking server can drop (sleeping tablet, a
      // network change); the room keeps its players and quietly signs back
      // in under the same code so new people can still find it
      const reconnect = () => {
        if (closed || peer.destroyed || !peer.disconnected) return;
        retry++;
        setTimeout(() => { if (!closed && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch (e) { reconnect(); } } }, Math.min(15000, 1000 * retry));
      };
      peer.on('open', () => { retry = 0; if (!opened) { opened = true; cb.ready(code); } });
      peer.on('disconnected', reconnect);
      peer.on('connection', (conn) => {
        conn.on('open', () => cb.connection(wrap(conn)));
      });
      peer.on('error', (err) => {
        const type = err && err.type ? err.type : String(err);
        if (!opened) { cb.error(type); return; }
        // once the room is open, only losing the server matters, and that heals itself
        if (peer.disconnected) reconnect();
      });
      return { close: () => { closed = true; try { peer.destroy(); } catch (e) { /* noop */ } } };
    },

    connectTo(code, cb) {
      if (typeof Peer === 'undefined') { cb.error('no-peerjs'); return null; }
      const peer = new Peer(PEER_OPTS);
      let settled = false;
      // give up if the matchmaking server or the host never answers
      const timer = setTimeout(() => { if (!settled) { settled = true; cb.error('timeout'); } }, 20000);
      peer.on('open', () => {
        const conn = peer.connect(ID_PREFIX + code, { reliable: true });
        conn.on('open', () => { settled = true; clearTimeout(timer); cb.ready(wrap(conn)); });
        conn.on('error', () => { if (!settled) { settled = true; clearTimeout(timer); cb.error('peer-unavailable'); } });
      });
      peer.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cb.error(err && err.type ? err.type : String(err));
      });
      return { close: () => { try { peer.destroy(); } catch (e) { /* noop */ } } };
    },

    // Who is hosting which of these rooms right now? Each open room answers
    // with its players; a code nobody holds comes back null.
    probe(codes, cb) {
      if (typeof Peer === 'undefined' || !codes.length) { cb({}); return; }
      const peer = new Peer(PEER_OPTS);
      const out = {};
      let left = codes.length, done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const c of codes) if (out[c] === undefined) out[c] = null;
        setTimeout(() => { try { peer.destroy(); } catch (e) { /* noop */ } }, 200);
        cb(out);
      };
      const settle = (code, info) => {
        if (done || out[code] !== undefined) return;
        out[code] = info;
        if (--left <= 0) finish();
      };
      const timer = setTimeout(finish, 8000);
      peer.on('open', () => {
        for (const code of codes) {
          const conn = peer.connect(ID_PREFIX + code, { reliable: true });
          conn.on('open', () => {
            conn.send({ t: 'info' });
            // an older host does not answer, but it is there
            setTimeout(() => settle(code, { players: 0, old: true }), 3000);
          });
          conn.on('data', (d) => {
            if (!d || d.t !== 'info') return;
            settle(code, d);
            setTimeout(() => { try { conn.close(); } catch (e) { /* noop */ } }, 100);
          });
        }
      });
      peer.on('error', (err) => {
        if (err && err.type === 'peer-unavailable') {
          const m = /vxlcraft-([A-Z0-9]+)/.exec(err.message || '');
          if (m) settle(m[1], null);
          return;
        }
        finish();
      });
    }
  };

  const Net = {
    transport: peerTransport,
    active: false,
    isHost: false,
    code: null,
    myId: null,
    name: '플레이어',
    players: {},
    conns: {},
    hostConn: null,
    edits: {},
    handlers: {},
    _socket: null,
    _lastPos: 0
  };

  Net.randomCode = randomCode;

  // look up several rooms at once: cb({ CODE: info or null })
  Net.probe = function (codes, cb) {
    if (!this.transport.probe) { cb({}); return; }
    this.transport.probe(codes.map(normalizeCode), cb);
  };
  Net.normalizeCode = normalizeCode;

  Net.reset = function () {
    // closing our own connections is not the other side going away
    this.handlers = {};
    for (const id in this.conns) this.conns[id].close();
    if (this.hostConn) this.hostConn.close();
    if (this._socket) this._socket.close();
    this.active = false;
    this.isHost = false;
    this.code = null;
    this.myId = null;
    this.players = {};
    this.conns = {};
    this.hostConn = null;
    this.edits = {};
    this._socket = null;
  };

  Net.playerCount = function () {
    return 1 + Object.keys(this.players).length;
  };

  Net.roster = function () {
    const out = {};
    for (const id in this.players) out[id] = this.players[id].name;
    return out;
  };

  Net.editList = function () {
    const out = [];
    for (const key in this.edits) {
      const parts = key.split(',');
      out.push([+parts[0], +parts[1], +parts[2], this.edits[key]]);
    }
    return out;
  };

  Net.recordEdit = function (x, y, z, id, dim) {
    if (dim && dim !== 'overworld') return;
    this.edits[x + ',' + y + ',' + z] = id;
  };

  // which dimension this player is standing in; every message about the
  // world carries it so the other side can tell whose world it is
  Net.dim = function () {
    return this.handlers && this.handlers.getDim ? this.handlers.getDim() : 'overworld';
  };

  // ------------------------------------------------------------------ host
  Net.createRoom = function (code, name, info, handlers) {
    this.reset();
    this.isHost = true;
    this.code = code;
    this.name = name || '방장';
    this.info = info;
    this.handlers = handlers || {};
    this.myId = 'host';

    this._socket = this.transport.createHost(code, {
      ready: () => {
        this.active = true;
        if (this.handlers.onReady) this.handlers.onReady(code);
      },
      error: (err) => {
        this.active = false;
        if (this.handlers.onError) this.handlers.onError(err);
      },
      connection: (conn) => this._acceptGuest(conn)
    });
  };

  Net._acceptGuest = function (conn) {
    this.conns[conn.id] = conn;
    conn.onData = (msg) => this._hostMessage(conn, msg);
    conn.onClose = () => {
      const gone = this.players[conn.id];
      delete this.conns[conn.id];
      // someone who only asked who is here, not a player
      if (!gone) return;
      delete this.players[conn.id];
      this._broadcast({ t: 'roster', roster: this.roster(), host: this.name });
      if (this.handlers.onPlayerLeave) this.handlers.onPlayerLeave(conn.id, gone);
    };
  };

  Net._hostMessage = function (conn, msg) {
    if (!msg || !msg.t) return;
    // the multiplayer menu asking who is on this server
    if (msg.t === 'info') {
      const names = [this.name];
      for (const id in this.players) names.push(this.players[id].name);
      conn.send({ t: 'info', players: names.length, max: MAX_GUESTS + 1, names, mode: this.info ? this.info.mode : '', host: this.name });
      return;
    }
    if (msg.t === 'hello') {
      // the host relays for everyone, so keep a public room to a sane size
      if (Object.keys(this.players).length >= MAX_GUESTS) {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 200);
        return;
      }
      this.players[conn.id] = {
        name: String(msg.name || '플레이어').slice(0, 12),
        x: 0, y: 0, z: 0, yaw: 0, pitch: 0
      };
      conn.send({
        t: 'welcome',
        id: conn.id,
        seed: this.info.seed,
        mode: this.info.mode,
        dayTime: this.handlers.getDayTime ? this.handlers.getDayTime() : 0.42,
        spawn: this.handlers.getSpawn ? this.handlers.getSpawn() : null,
        edits: this.handlers.getEdits ? this.handlers.getEdits() : this.editList(),
        savedAt: this.handlers.getSavedAt ? this.handlers.getSavedAt() : 0,
        entities: this.handlers.getEntities ? this.handlers.getEntities() : [],
        nether: this.handlers.getDimData ? this.handlers.getDimData('nether') : null,
        end: this.handlers.getDimData ? this.handlers.getDimData('end') : null,
        roster: this.roster(),
        host: this.name
      });
      this._broadcast({ t: 'roster', roster: this.roster(), host: this.name });
      if (this.handlers.onPlayerJoin) this.handlers.onPlayerJoin(conn.id, this.players[conn.id]);
      return;
    }

    if (msg.t === 'pos') {
      const p = this.players[conn.id];
      if (p) {
        p.x = msg.x; p.y = msg.y; p.z = msg.z;
        p.yaw = msg.yaw; p.pitch = msg.pitch;
        p.dim = msg.dim || 'overworld';
        p.gold = !!msg.g;
      }
      this._broadcast({ t: 'pos', id: conn.id, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch, dim: msg.dim }, conn.id);
      return;
    }

    if (msg.t === 'edit') {
      this.recordEdit(msg.x, msg.y, msg.z, msg.id, msg.dim);
      this._broadcast({ t: 'edit', x: msg.x, y: msg.y, z: msg.z, id: msg.id, dim: msg.dim }, conn.id);
      if (this.handlers.onEdit) this.handlers.onEdit(msg);
      return;
    }

    if (msg.t === 'hit') {
      const from = this.players[conn.id] ? this.players[conn.id].name : '?';
      const payload = { t: 'hit', dmg: msg.dmg, kx: msg.kx, kz: msg.kz, from };
      if (msg.to === 'host') {
        if (this.handlers.onHit) this.handlers.onHit(payload);
      } else if (this.conns[msg.to]) {
        this.conns[msg.to].send(payload);
      }
      return;
    }

    // monsters live on the host; guests report their swings and get the result
    if (msg.t === 'mobhit') {
      msg.from = conn.id;
      if (this.handlers.onMobHit) this.handlers.onMobHit(msg);
      return;
    }

    if (msg.t === 'boat') {
      this._broadcast(msg, conn.id);
      if (this.handlers.onBoat) this.handlers.onBoat(msg);
      return;
    }

    if (msg.t === 'arrow') {
      this._broadcast(msg, conn.id);
      if (this.handlers.onArrow) this.handlers.onArrow(msg);
      return;
    }

    if (msg.t === 'mobfeed') {
      msg.from = conn.id;
      if (this.handlers.onMobFeed) this.handlers.onMobFeed(msg);
      return;
    }

    if (msg.t === 'fx') {
      this._broadcast(msg, conn.id);
      if (this.handlers.onFx) this.handlers.onFx(msg);
      return;
    }

    // a chest changed: the host keeps it and passes it on to everyone else
    if (msg.t === 'ent') {
      this._broadcast({ t: 'ent', key: msg.key, data: msg.data, dim: msg.dim }, conn.id);
      if (this.handlers.onEntity) this.handlers.onEntity(msg);
      return;
    }

    if (msg.t === 'sleep') {
      if (this.handlers.onSleep) this.handlers.onSleep(conn.id);
      return;
    }

    if (msg.t === 'restore') {
      if (this.handlers.onRestore) this.handlers.onRestore(conn.id, msg);
      return;
    }

    if (msg.t === 'bye') {
      if (conn.onClose) conn.onClose();
      conn.close();
      return;
    }

    if (msg.t === 'chat') {
      const text = String(msg.text || '').slice(0, 120);
      if (msg.sys) {
        this._broadcast({ t: 'chat', sys: true, text });
        if (this.handlers.onChat) this.handlers.onChat(null, text, true);
        return;
      }
      const from = this.players[conn.id] ? this.players[conn.id].name : '?';
      this._broadcast({ t: 'chat', from, text });
      if (this.handlers.onChat) this.handlers.onChat(from, text);
    }
  };

  Net._broadcast = function (msg, exceptId) {
    for (const id in this.conns) {
      if (id === exceptId) continue;
      this.conns[id].send(msg);
    }
  };

  // ----------------------------------------------------------------- guest
  Net.joinRoom = function (code, name, handlers) {
    this.reset();
    this.isHost = false;
    this.code = code;
    this.name = name || '플레이어';
    this.handlers = handlers || {};

    this._socket = this.transport.connectTo(code, {
      ready: (conn) => {
        this.hostConn = conn;
        conn.onData = (msg) => this._guestMessage(msg);
        conn.onClose = () => {
          this.active = false;
          if (this.handlers.onDisconnect) this.handlers.onDisconnect();
        };
        conn.send({ t: 'hello', name: this.name });
      },
      error: (err) => {
        this.active = false;
        if (this.handlers.onError) this.handlers.onError(err);
      }
    });
  };

  Net._guestMessage = function (msg) {
    if (!msg || !msg.t) return;

    if (msg.t === 'welcome') {
      this.myId = msg.id;
      this.active = true;
      this.players = {};
      for (const id in msg.roster) {
        if (id === this.myId) continue;
        this.players[id] = { name: msg.roster[id], x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
      }
      this.players.host = { name: msg.host || '방장', x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
      if (this.handlers.onWelcome) this.handlers.onWelcome(msg);
      return;
    }

    if (msg.t === 'roster') {
      const next = {};
      for (const id in msg.roster) {
        if (id === this.myId) continue;
        next[id] = this.players[id] || { name: msg.roster[id], x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
        next[id].name = msg.roster[id];
      }
      next.host = this.players.host || { name: msg.host || '방장', x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
      next.host.name = msg.host || '방장';
      this.players = next;
      if (this.handlers.onRoster) this.handlers.onRoster();
      return;
    }

    if (msg.t === 'pos') {
      let p = this.players[msg.id];
      if (!p) {
        p = this.players[msg.id] = { name: '플레이어', x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
      }
      p.x = msg.x; p.y = msg.y; p.z = msg.z;
      p.yaw = msg.yaw; p.pitch = msg.pitch;
      p.dim = msg.dim || 'overworld';
      return;
    }

    if (msg.t === 'edit') {
      if (this.handlers.onEdit) this.handlers.onEdit(msg);
      return;
    }

    if (msg.t === 'ent') {
      if (this.handlers.onEntity) this.handlers.onEntity(msg);
      return;
    }

    if (msg.t === 'boat') {
      if (this.handlers.onBoat) this.handlers.onBoat(msg);
      return;
    }

    if (msg.t === 'arrow') {
      if (this.handlers.onArrow) this.handlers.onArrow(msg);
      return;
    }

    if (msg.t === 'fx') {
      if (this.handlers.onFx) this.handlers.onFx(msg);
      return;
    }

    if (msg.t === 'mobs') {
      if (this.handlers.onMobs) this.handlers.onMobs(msg.m, msg.dim || 'overworld');
      return;
    }

    if (msg.t === 'time') {
      if (this.handlers.onTime) this.handlers.onTime(msg.dayTime);
      return;
    }

    if (msg.t === 'bulk') {
      if (this.handlers.onBulk) this.handlers.onBulk(msg.edits, msg.by);
      return;
    }

    if (msg.t === 'full') {
      this.active = false;
      if (this.handlers.onError) this.handlers.onError('room-full');
      return;
    }

    if (msg.t === 'closed') {
      this.active = false;
      if (this.handlers.onHostClosed) this.handlers.onHostClosed();
      return;
    }

    if (msg.t === 'hit') {
      if (this.handlers.onHit) this.handlers.onHit(msg);
      return;
    }

    if (msg.t === 'chat' && this.handlers.onChat) {
      this.handlers.onChat(msg.sys ? null : msg.from, msg.text, !!msg.sys);
    }
  };

  // ---------------------------------------------------------------- sending
  Net.sendPos = function (player) {
    if (!this.active) return;
    const now = performance.now();
    if (now - this._lastPos < POS_INTERVAL) return;
    this._lastPos = now;
    const msg = {
      t: 'pos',
      x: +player.pos.x.toFixed(2),
      y: +player.pos.y.toFixed(2),
      z: +player.pos.z.toFixed(2),
      yaw: +player.yaw.toFixed(2),
      pitch: +player.pitch.toFixed(2),
      dim: this.dim()
    };
    if (this.handlers.getGold && this.handlers.getGold()) msg.g = 1;
    if (this.isHost) {
      msg.id = 'host';
      this._broadcast(msg);
    } else if (this.hostConn) {
      this.hostConn.send(msg);
    }
  };

  Net.sendEdit = function (x, y, z, id, dim) {
    if (!this.active) return;
    dim = dim || 'overworld';
    this.recordEdit(x, y, z, id, dim);
    const msg = { t: 'edit', x, y, z, id, dim };
    if (this.isHost) this._broadcast(msg);
    else if (this.hostConn) this.hostConn.send(msg);
  };

  // A guest that kept a copy of this room's world offers it to a host that
  // opened the room with nothing in it, so buildings survive everyone leaving.
  Net.sendRestore = function (savedAt, edits) {
    if (!this.active || this.isHost || !this.hostConn) return;
    this.hostConn.send({ t: 'restore', savedAt, edits });
  };

  Net.broadcastBulk = function (edits, by) {
    if (!this.active || !this.isHost) return;
    this._broadcast({ t: 'bulk', edits, by });
  };

  Net.sendHit = function (targetId, dmg, kx, kz, from) {
    if (!this.active || targetId === this.myId) return;
    if (this.isHost) {
      const c = this.conns[targetId];
      if (c) c.send({ t: 'hit', dmg, kx, kz, from: from || this.name });
    } else if (this.hostConn) {
      this.hostConn.send({ t: 'hit', to: targetId, dmg, kx, kz });
    }
  };

  Net.sendMobs = function (rows) {
    if (!this.active || !this.isHost) return;
    const now = performance.now();
    if (now - (this._lastMobs || 0) < MOB_INTERVAL) return;
    this._lastMobs = now;
    this._broadcast({ t: 'mobs', m: rows, dim: this.dim() });
  };

  Net.sendMobHit = function (mobId, dmg, kx, kz) {
    if (!this.active || this.isHost || !this.hostConn) return;
    this.hostConn.send({ t: 'mobhit', mobId, dmg, kx, kz });
  };

  Net.sendArrow = function (msg) {
    if (!this.active) return;
    msg.t = 'arrow';
    msg.dim = this.dim();
    if (this.isHost) this._broadcast(msg);
    else if (this.hostConn) this.hostConn.send(msg);
  };

  // something everyone should see happen: lit TNT, an explosion, a mob's shot
  Net.sendFx = function (msg) {
    if (!this.active) return;
    msg.t = 'fx';
    msg.dim = this.dim();
    if (this.isHost) this._broadcast(msg);
    else if (this.hostConn) this.hostConn.send(msg);
  };

  Net.sendMobFeed = function (mobId) {
    if (!this.active || this.isHost || !this.hostConn) return;
    this.hostConn.send({ t: 'mobfeed', mobId });
  };

  Net.sendBoat = function (msg) {
    if (!this.active) return;
    msg.t = 'boat';
    msg.dim = this.dim();
    if (this.isHost) this._broadcast(msg);
    else if (this.hostConn) this.hostConn.send(msg);
  };

  Net.sendEntity = function (key, data) {
    if (!this.active) return;
    const msg = { t: 'ent', key, data, dim: this.dim() };
    if (this.isHost) this._broadcast(msg);
    else if (this.hostConn) this.hostConn.send(msg);
  };

  Net.sendSleep = function () {
    if (!this.active || this.isHost || !this.hostConn) return;
    this.hostConn.send({ t: 'sleep' });
  };

  Net.sendTime = function (dayTime) {
    if (!this.active || !this.isHost) return;
    this._broadcast({ t: 'time', dayTime });
  };

  Net.sendSystem = function (text) {
    if (!this.active) return;
    if (this.isHost) {
      this._broadcast({ t: 'chat', sys: true, text });
      if (this.handlers.onChat) this.handlers.onChat(null, text, true);
    } else if (this.hostConn) {
      this.hostConn.send({ t: 'chat', sys: true, text });
    }
  };

  Net.sendChat = function (text) {
    if (!this.active) return;
    if (this.isHost) {
      this._broadcast({ t: 'chat', from: this.name, text });
      if (this.handlers.onChat) this.handlers.onChat(this.name, text);
    } else if (this.hostConn) {
      this.hostConn.send({ t: 'chat', text });
    }
  };

  Net.leave = function () {
    if (this.isHost) this._broadcast({ t: 'closed' });
    else if (this.hostConn) this.hostConn.send({ t: 'bye' });
    this.reset();
  };

  Net.MAX_GUESTS = MAX_GUESTS;

  global.Net = Net;
})(window);
