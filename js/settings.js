(function (global) {
  'use strict';

  // Everything a player might want to tune about the controls. The joystick in
  // particular: how far it travels, how big a patch of screen it listens to and
  // how much of a nudge it ignores.
  const DEFS = [
    { key: 'joyRadius', label: '조이스틱 크기', min: 30, max: 80, step: 2, def: 46, unit: 'px' },
    { key: 'joyDead', label: '조이스틱 무반응 범위', min: 0, max: 24, step: 1, def: 7, unit: 'px' },
    { key: 'joyZone', label: '조이스틱 인식 범위', min: 20, max: 60, step: 2, def: 42, unit: '%' },
    { key: 'joyFixed', label: '조이스틱 고정 위치', type: 'bool', def: 0 },
    { key: 'lookSens', label: '시점 감도', min: 30, max: 250, step: 5, def: 100, unit: '%' },
    { key: 'invertY', label: '시점 상하 반전', type: 'bool', def: 0 },
    { key: 'holdMs', label: '길게 눌러 캐기 시간', min: 80, max: 500, step: 10, def: 180, unit: 'ms' },
    { key: 'cancelMine', label: '시점을 돌리면 캐기 취소', type: 'bool', def: 1 },
    { key: 'btnScale', label: '버튼 크기', min: 70, max: 160, step: 5, def: 100, unit: '%' },
    { key: 'volume', label: '소리 크기', min: 0, max: 100, step: 5, def: 70, unit: '%' },
    { key: 'viewBob', label: '걸을 때 화면 흔들림', type: 'bool', def: 1 },
    { key: 'shaders', label: '쉐이더 (햇빛·물결·흔들리는 잎)', type: 'bool', def: 1 },
    { key: 'shadows', label: '그림자 (느리면 끄세요)', type: 'bool', def: 1 }
  ];

  const values = {};
  for (const d of DEFS) values[d.key] = d.def;

  const Settings = {
    DEFS,
    values,
    onChange: null,

    load() {
      const saved = (global.Store && Store.ok) ? Store.loadSettings() : null;
      if (saved) {
        for (const d of DEFS) {
          const v = saved[d.key];
          if (typeof v !== 'number' || !isFinite(v)) continue;
          values[d.key] = d.type === 'bool' ? (v ? 1 : 0) : Math.max(d.min, Math.min(d.max, v));
        }
      }
      this.apply();
    },

    save() {
      if (global.Store && Store.ok) Store.saveSettings(values);
    },

    set(key, value) {
      const d = DEFS.find((x) => x.key === key);
      if (!d) return;
      values[key] = d.type === 'bool' ? (value ? 1 : 0) : Math.max(d.min, Math.min(d.max, value));
      this.save();
      this.apply();
    },

    reset() {
      for (const d of DEFS) values[d.key] = d.def;
      this.save();
      this.apply();
    },

    get(key) { return values[key]; },
    bool(key) { return !!values[key]; },

    // the things a stylesheet can express are handed to CSS as variables
    apply() {
      const root = document.documentElement;
      root.style.setProperty('--joy-radius', values.joyRadius + 'px');
      root.style.setProperty('--joy-zone', values.joyZone + '%');
      root.style.setProperty('--btn-scale', values.btnScale / 100);
      if (global.Sound) Sound.setVolume(values.volume / 100);
      if (this.onChange) this.onChange();
    },

    lookSens() { return 0.0042 * (values.lookSens / 100); }
  };

  global.Settings = Settings;
})(window);
