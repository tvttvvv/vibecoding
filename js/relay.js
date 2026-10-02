(function (global) {
  'use strict';

  // A second way for players to reach a room's host. Normally devices talk
  // to each other directly (WebRTC), but some networks (mobile data, school
  // or office Wi-Fi) never let that link form. Then the game messages go
  // through a public MQTT message server instead: everyone connects out to
  // it over a web socket, which almost any network allows. The host always
  // listens there too, so a guest can fall back to it at any time.
  const LIB = 'https://unpkg.com/mqtt@5.10.4/dist/mqtt.min.js';
  const BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];
  const ROOT = 'tvttvvv-vxc/';
  const PING = 3000;          // both sides say "still here" this often
  const SILENT = 15000;       // and give up on the other after this long
  const OPEN_WAIT = 6000;     // how long a guest waits for the host to answer

  const brokers = () => global.VXL_RELAY_BROKERS || BROKERS;
  const lib = () => global.VXL_MQTT_LIB || LIB;
  const rid = () => Math.random().toString(36).slice(2, 10);

  let loading = null;
  function loadLib(cb) {
    if (global.mqtt && global.mqtt.connect) { cb(true); return; }
    if (!loading) {
      loading = [];
      const s = document.createElement('script');
      s.src = lib();
      s.async = true;
      const done = (ok) => { const l = loading; loading = null; for (const f of l) f(ok); };
      s.onload = () => done(!!(global.mqtt && global.mqtt.connect));
      s.onerror = () => { s.remove(); done(false); };
      document.head.appendChild(s);
    }
    loading.push(cb);
  }

  function client(url, keepTrying) {
    return global.mqtt.connect(url, {
      clientId: 'vxc_' + rid(),
      clean: true,
      keepalive: 30,
      connectTimeout: OPEN_WAIT,
      reconnectPeriod: keepTrying ? 5000 : 0
    });
  }

  function send(c, topic, obj) {
    try { if (c && c.connected) c.publish(topic, JSON.stringify(obj)); } catch (e) { /* gone */ }
  }

  function parse(buf) {
    try { return JSON.parse(typeof buf === 'string' ? buf : new TextDecoder().decode(buf)); } catch (e) { return null; }
  }

  const Relay = {};

  // The host side: listen on every broker for guests knocking on this room.
  // onConnection gets the same kind of connection object as a direct link.
  Relay.host = function (code, onConnection) {
    let closed = false;
    const clients = [];
    const conns = {};
    const inbox = ROOT + code + '/h';
    const toGuest = (g) => ROOT + code + '/g/' + g;

    const drop = (g, tell) => {
      const w = conns[g];
      if (!w) return;
      delete conns[g];
      if (tell) send(w._c, toGuest(g), { k: 'x' });
      if (w.onClose) w.onClose();
    };

    const handle = (c, msg) => {
      if (!msg || !msg.g || closed) return;
      const g = String(msg.g);
      let w = conns[g];
      if (msg.k === 'open') {
        if (!w) {
          w = conns[g] = {
            id: 'r-' + g, _c: c, _seen: Date.now(), onData: null, onClose: null,
            send(m) { send(this._c, toGuest(g), { k: 'd', m }); },
            close() { drop(g, true); }
          };
          send(c, toGuest(g), { k: 'ok' });
          onConnection(w);
        } else {
          w._c = c; w._seen = Date.now();
          send(c, toGuest(g), { k: 'ok' });
        }
        return;
      }
      if (!w) {
        // a guest we forgot about (we restarted): tell it to knock again
        if (msg.k === 'd' || msg.k === 'p') send(c, toGuest(g), { k: 'x' });
        return;
      }
      w._seen = Date.now();
      if (msg.k === 'd' && w.onData) w.onData(msg.m);
      else if (msg.k === 'x') drop(g, false);
    };

    // a one-off question from the server list: who is here?
    const info = (c, msg) => {
      if (!msg.r) return;
      const w = {
        id: 'q-' + rid(), onData: null, onClose: null,
        send(m) { send(c, String(msg.r), m); },
        close() { if (this.onClose) { const f = this.onClose; this.onClose = null; f(); } }
      };
      onConnection(w);
      if (w.onData) w.onData({ t: 'info' });
      setTimeout(() => w.close(), 500);
    };

    loadLib((ok) => {
      if (!ok || closed) return;
      for (const url of brokers()) {
        let c;
        try { c = client(url, true); } catch (e) { continue; }
        clients.push(c);
        c.on('connect', () => c.subscribe(inbox));
        c.on('message', (topic, buf) => {
          const msg = parse(buf);
          if (msg && msg.k === 'info') info(c, msg);
          else handle(c, msg);
        });
        c.on('error', () => { /* it keeps trying on its own */ });
      }
    });

    const timer = setInterval(() => {
      const now = Date.now();
      for (const g in conns) {
        const w = conns[g];
        if (now - w._seen > SILENT) drop(g, false);
        else send(w._c, toGuest(g), { k: 'p' });
      }
    }, PING);

    return {
      close() {
        closed = true;
        clearInterval(timer);
        for (const g in conns) drop(g, true);
        setTimeout(() => { for (const c of clients) { try { c.end(true); } catch (e) { /* noop */ } } }, 300);
      }
    };
  };

  // The guest side: knock on the room through each broker in turn.
  // cb.ready(conn) with a connection like a direct one, or cb.error().
  Relay.connect = function (code, cb) {
    let done = false, c = null, timer = null, pinger = null, watch = null;
    const g = rid() + rid();
    const inbox = ROOT + code + '/g/' + g;
    const toHost = ROOT + code + '/h';
    const fail = (why) => { if (done) return; done = true; cleanup(); cb.error(why); };
    const cleanup = () => {
      clearTimeout(timer); clearInterval(pinger); clearInterval(watch);
      if (c) { const old = c; c = null; try { old.end(true); } catch (e) { /* noop */ } }
    };

    const tryBroker = (i) => {
      if (done) return;
      const list = brokers();
      if (i >= list.length) { fail('relay-failed'); return; }
      try { c = client(list[i], false); } catch (e) { tryBroker(i + 1); return; }
      const mine = c;
      let knock = null;
      const next = () => { if (c !== mine) return; clearInterval(knock); clearTimeout(timer); try { mine.end(true); } catch (e) { /* noop */ } c = null; tryBroker(i + 1); };
      timer = setTimeout(next, OPEN_WAIT * 2);
      mine.on('error', next);
      mine.on('close', () => { if (!w.open) next(); else lost(); });
      mine.on('connect', () => {
        mine.subscribe(inbox, () => {
          const say = () => send(mine, toHost, { k: 'open', g });
          say();
          knock = setInterval(say, 1500);
          clearTimeout(timer);
          timer = setTimeout(next, OPEN_WAIT);
        });
      });
      mine.on('message', (topic, buf) => {
        const msg = parse(buf);
        if (!msg || c !== mine) return;
        w._seen = Date.now();
        if (msg.k === 'ok') {
          clearInterval(knock);
          clearTimeout(timer);
          if (w.open || done) return;
          w.open = true;
          done = true;
          pinger = setInterval(() => send(mine, toHost, { k: 'p', g }), PING);
          watch = setInterval(() => { if (Date.now() - w._seen > SILENT) lost(); }, 2000);
          cb.ready(w);
        } else if (msg.k === 'd') {
          if (w.onData) w.onData(msg.m);
        } else if (msg.k === 'x') {
          lost();
        }
      });
    };

    // the link to the host is gone, whatever the reason
    const lost = () => {
      if (!w.open) return;
      w.open = false;
      cleanup();
      if (w.onClose) w.onClose();
    };

    const w = {
      id: 'host', open: false, _seen: Date.now(), onData: null, onClose: null,
      send(m) { if (c) send(c, toHost, { k: 'd', g, m }); },
      close() {
        if (c) send(c, toHost, { k: 'x', g });
        w.open = false;
        w.onClose = null;
        setTimeout(cleanup, 100);
      }
    };

    loadLib((ok) => { if (!ok) fail('relay-failed'); else tryBroker(0); });
    return { close() { if (!done) { done = true; cleanup(); } else w.close(); } };
  };

  // Ask these rooms who is in them, through the relay: cb({ CODE: info })
  // with only the rooms that answered.
  Relay.probe = function (codes, cb) {
    const out = {};
    let finished = false;
    const finish = (c) => {
      if (finished) return;
      finished = true;
      if (c) { try { c.end(true); } catch (e) { /* noop */ } }
      cb(out);
    };
    loadLib((ok) => {
      if (!ok || !codes.length) { finish(null); return; }
      let c;
      try { c = client(brokers()[0], false); } catch (e) { finish(null); return; }
      const reply = ROOT + 'r/' + rid() + rid();
      const t = setTimeout(() => finish(c), 3500);
      c.on('error', () => { clearTimeout(t); finish(c); });
      c.on('connect', () => {
        c.subscribe(reply, () => {
          for (const code of codes) send(c, ROOT + code + '/h', { k: 'info', r: reply });
        });
      });
      c.on('message', (topic, buf) => {
        const msg = parse(buf);
        if (!msg || msg.t !== 'info' || !msg.code) return;
        out[msg.code] = msg;
        if (Object.keys(out).length >= codes.length) { clearTimeout(t); finish(c); }
      });
    });
  };

  global.Relay = Relay;
})(window);
