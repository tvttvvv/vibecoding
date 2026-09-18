(function (global) {
  'use strict';

  // Peer-to-peer multiplayer. The host is the authority: guests connect
  // straight to it, and everyone generates the same terrain locally from the
  // host's seed, so only block changes and player positions travel the wire.
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ID_PREFIX = 'vxlcraft-';
  const POS_INTERVAL = 80;

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

  const peerTransport = {
    createHost(code, cb) {
      if (typeof Peer === 'undefined') { cb.error('no-peerjs'); return null; }
      const peer = new Peer(ID_PREFIX + code, { debug: 0 });
      peer.on('open', () => cb.ready(code));
      peer.on('connection', (conn) => {
        conn.on('open', () => cb.connection(wrap(conn)));
      });
      peer.on('error', (err) => cb.error(err && err.type ? err.type : String(err)));
      return { close: () => { try { peer.destroy(); } catch (e) { /* noop */ } } };
    },

    connectTo(code, cb) {
      if (typeof Peer === 'undefined') { cb.error('no-peerjs'); return null; }
      const peer = new Peer({ debug: 0 });
      let settled = false;
      peer.on('open', () => {
        const conn = peer.connect(ID_PREFIX + code, { reliable: true });
        const timer = setTimeout(() => { if (!settled) cb.error('timeout'); }, 15000);
        conn.on('open', () => { settled = true; clearTimeout(timer); cb.ready(wrap(conn)); });
        conn.on('error', () => { if (!settled) { settled = true; clearTimeout(timer); cb.error('peer-unavailable'); } });
      });
      peer.on('error', (err) => {
        if (settled) return;
        settled = true;
        cb.error(err && err.type ? err.type : String(err));
      });
      return { close: () => { try { peer.destroy(); } catch (e) { /* noop */ } } };
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
  Net.normalizeCode = normalizeCode;

  Net.reset = function () {
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

  Net.recordEdit = function (x, y, z, id) {
    this.edits[x + ',' + y + ',' + z] = id;
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
      delete this.players[conn.id];
      this._broadcast({ t: 'roster', roster: this.roster(), host: this.name });
      if (this.handlers.onPlayerLeave) this.handlers.onPlayerLeave(conn.id, gone);
    };
  };

  Net._hostMessage = function (conn, msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'hello') {
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
        edits: this.editList(),
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
      }
      this._broadcast({ t: 'pos', id: conn.id, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch }, conn.id);
      return;
    }

    if (msg.t === 'edit') {
      this.recordEdit(msg.x, msg.y, msg.z, msg.id);
      this._broadcast({ t: 'edit', x: msg.x, y: msg.y, z: msg.z, id: msg.id }, conn.id);
      if (this.handlers.onEdit) this.handlers.onEdit(msg);
      return;
    }

    if (msg.t === 'bye') {
      if (conn.onClose) conn.onClose();
      conn.close();
      return;
    }

    if (msg.t === 'chat') {
      const text = String(msg.text || '').slice(0, 120);
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
      return;
    }

    if (msg.t === 'edit') {
      if (this.handlers.onEdit) this.handlers.onEdit(msg);
      return;
    }

    if (msg.t === 'closed') {
      this.active = false;
      if (this.handlers.onHostClosed) this.handlers.onHostClosed();
      return;
    }

    if (msg.t === 'chat' && this.handlers.onChat) this.handlers.onChat(msg.from, msg.text);
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
      pitch: +player.pitch.toFixed(2)
    };
    if (this.isHost) {
      msg.id = 'host';
      this._broadcast(msg);
    } else if (this.hostConn) {
      this.hostConn.send(msg);
    }
  };

  Net.sendEdit = function (x, y, z, id) {
    if (!this.active) return;
    this.recordEdit(x, y, z, id);
    const msg = { t: 'edit', x, y, z, id };
    if (this.isHost) this._broadcast(msg);
    else if (this.hostConn) this.hostConn.send(msg);
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

  global.Net = Net;
})(window);
