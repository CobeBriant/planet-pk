/**
 * 星球PK — 统一音频引擎（音效 + 80年代红白机 8-bit BGM）
 *
 *  - window.Sfx：Web Audio 程序化音效（无需音频文件，离线可用）
 *    · 复刻 arcade.js 的全部旧音效，并补充 click / correct / wrong / select /
 *      powerup / win / lose / bossIntro 等新音效
 *    · 与 BGM 共用同一 AudioContext 与同一「静音」状态（toggleMute 同时控制两者）
 *  - window.Bgm：8-bit 步进音序器（方波主旋律 + 三角波贝斯 + 噪声鼓点），循环播放
 *    · boss(on) 切换为更暗、更密集的 BOSS 战曲目
 *    · 所有声音经 masterGain → destination，静音即整体置 0
 *
 * 加载顺序：必须在 arcade.js / island.js 之前加载（arcade.js 改为复用本模块的 Sfx）。
 */
(function () {
  'use strict';

  // ---------- 共享 AudioContext ----------
  var actx = null;
  var masterGain = null;
  var muted = false;

  function ensure() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { actx = new AC(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
    if (!masterGain && actx) {
      masterGain = actx.createGain();
      masterGain.gain.value = muted ? 0 : 0.9;   // 若已静音，创建即静音
      masterGain.connect(actx.destination);
    }
    return actx;
  }

  // 单音（方波/三角波/锯齿波）
  function tone(opt) {
    var a = ensure(); if (!a || muted) return;
    var t0 = (opt.when != null) ? opt.when : a.currentTime;
    var dur = opt.dur || 0.15;
    var vol = (opt.vol != null) ? opt.vol : 0.2;
    var osc = a.createOscillator();
    var gain = a.createGain();
    osc.type = opt.type || 'square';
    osc.frequency.setValueAtTime(opt.freq || 440, t0);
    if (opt.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opt.freqEnd), t0 + dur);
    var atk = (opt.attack != null) ? opt.attack : 0.005;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(masterGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  // 噪声（用于爆炸 / 军鼓 / 踩镲）
  function noise(opt) {
    var a = ensure(); if (!a || muted) return;
    var t0 = (opt.when != null) ? opt.when : a.currentTime;
    var dur = opt.dur || 0.2;
    var vol = (opt.vol != null) ? opt.vol : 0.3;
    var len = Math.max(1, Math.floor(a.sampleRate * dur));
    var buf = a.createBuffer(1, len, a.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = a.createBufferSource(); src.buffer = buf;
    var filt = a.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = opt.filterFreq || 1200;
    var gain = a.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(gain).connect(masterGain);
    src.start(t0); src.stop(t0 + dur);
  }

  // ---------- 音效集合 ----------
  function arp(notes, type, dur, vol, gap) {
    notes.forEach(function (f, i) {
      setTimeout(function () { tone({ freq: f, type: type, dur: dur, vol: vol }); }, i * (gap || 70));
    });
  }

  var Sfx = {
    unlock: function () { ensure(); },
    isMuted: function () { return muted; },
    toggleMute: function () {
      muted = !muted;
      if (masterGain) masterGain.gain.value = muted ? 0 : 0.9;
      if (window.Bgm) window.Bgm.setMuted(muted);
      return muted;
    },
    // —— 旧音效（保持与 arcade.js 调用兼容）——
    shoot: function () { tone({ freq: 880, freqEnd: 440, type: 'square', dur: 0.06, vol: 0.08 }); },
    // 投石头的“嗖”声：噪声扫频 + 下滑音
    throw: function () {
      noise({ dur: 0.16, vol: 0.18, filterFreq: 2600 });
      tone({ freq: 720, freqEnd: 300, type: 'square', dur: 0.12, vol: 0.10 });
    },
    // 激光发射：高频下滑 + 噪声扫频（像光束）
    laser: function () {
      tone({ freq: 1400, freqEnd: 320, type: 'sawtooth', dur: 0.16, vol: 0.12 });
      noise({ dur: 0.12, vol: 0.12, filterFreq: 3200 });
    },
    // 石头砸中天体的重击
    smash: function () {
      noise({ dur: 0.22, vol: 0.34, filterFreq: 1400 });
      tone({ freq: 180, freqEnd: 60, type: 'sawtooth', dur: 0.22, vol: 0.18 });
    },
    hit: function () { tone({ freq: 540, freqEnd: 300, type: 'square', dur: 0.08, vol: 0.10 }); },
    destroy: function () {
      noise({ dur: 0.26, vol: 0.32, filterFreq: 1800 });
      tone({ freq: 200, freqEnd: 60, type: 'sawtooth', dur: 0.26, vol: 0.16 });
    },
    lifeLost: function () { tone({ freq: 220, freqEnd: 70, type: 'sawtooth', dur: 0.42, vol: 0.22 }); },
    levelUp: function () { arp([523, 659, 784, 1046], 'triangle', 0.12, 0.15, 70); },
    gameOver: function () { arp([440, 350, 260, 180], 'sawtooth', 0.3, 0.2, 120); },
    start: function () { tone({ freq: 330, freqEnd: 660, type: 'triangle', dur: 0.2, vol: 0.16 }); },
    // —— 新音效 ——
    click: function () { tone({ freq: 660, type: 'square', dur: 0.05, vol: 0.10 }); },
    select: function () { tone({ freq: 520, freqEnd: 780, type: 'square', dur: 0.08, vol: 0.12 }); },
    correct: function () { arp([523, 659, 784], 'square', 0.10, 0.16, 70); },
    wrong: function () { tone({ freq: 300, freqEnd: 120, type: 'sawtooth', dur: 0.3, vol: 0.18 }); },
    powerup: function () { arp([392, 523, 659, 880], 'square', 0.09, 0.14, 60); },
    heal: function () { arp([523, 659, 784, 1046], 'triangle', 0.10, 0.16, 60); },
    // 种下地雷：低沉“嗒”一声
    minePlant: function () { tone({ freq: 160, freqEnd: 90, type: 'square', dur: 0.10, vol: 0.10 }); },
    // 地雷爆炸：低频砸落 + 宽频噪声爆裂
    mine: function () {
      noise({ dur: 0.34, vol: 0.40, filterFreq: 1200 });
      tone({ freq: 120, freqEnd: 40, type: 'sawtooth', dur: 0.34, vol: 0.24 });
      tone({ freq: 360, freqEnd: 80, type: 'square', dur: 0.18, vol: 0.12 });
    },
    win: function () { arp([523, 659, 784, 1046, 1318], 'triangle', 0.16, 0.18, 110); },
    lose: function () { arp([392, 330, 262, 196], 'sawtooth', 0.28, 0.18, 130); },
    // BOSS 专属号角：低沉长音 + 警报双音 + 重击
    bossIntro: function () {
      tone({ freq: 110, freqEnd: 55, type: 'sawtooth', dur: 0.9, vol: 0.22 });
      tone({ freq: 138, freqEnd: 69, type: 'square', dur: 0.9, vol: 0.14 });
      var a = ensure(); if (!a || muted) return;
      var t0 = a.currentTime;
      for (var k = 0; k < 3; k++) {
        tone({ freq: 880, type: 'square', dur: 0.10, vol: 0.12, when: t0 + 0.20 + k * 0.22 });
        tone({ freq: 660, type: 'square', dur: 0.10, vol: 0.12, when: t0 + 0.32 + k * 0.22 });
      }
      noise({ dur: 0.5, vol: 0.30, filterFreq: 400 });
    }
  };

  window.Sfx = Sfx;

  // ============ 8-bit BGM 步进音序器 ============
  var Bgm = (function () {
    var playing = false, timer = null, nextNoteTime = 0, step = 0, bossMode = false;
    var BPM = 132, stepDur = 60 / BPM / 4;   // 16 分音符
    var bgmGain = null;

    function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    // 普通曲目（C 大调，欢快冒险）
    var LEAD = [72,0,76,0, 79,0,76,0, 77,0,81,0, 79,0,76,0,
                72,0,74,0, 76,0,72,0, 71,0,74,0, 76,0,79,0];
    var BASS = [48,0,0,0, 48,0,0,0, 45,0,0,0, 45,0,0,0,
                53,0,0,0, 53,0,0,0, 55,0,0,0, 55,0,0,0];
    var DRUM = ['k',0,'h',0, 's',0,'h',0, 'k',0,'h',0, 's',0,'h',0,
                'k',0,'h',0, 's',0,'h',0, 'k',0,'h',0, 's',0,'h',0];

    // BOSS 曲目（A 小调，更暗、更密集）
    var LEAD_B = [69,0,69,69, 72,0,69,0, 67,0,67,0, 71,0,67,0,
                  69,0,72,0, 69,0,65,0, 67,0,69,0, 72,0,76,0];
    var BASS_B = [45,0,0,0, 45,0,0,0, 53,0,0,0, 53,0,0,0,
                  55,0,0,0, 55,0,0,0, 52,0,0,0, 52,0,0,0];
    var DRUM_B = ['k',0,'h',0, 's',0,'h',0, 'k',0,'h',0, 's',0,'h',0,
                  'k',0,'h',0, 's',0,'h',0, 'k','k','h','k', 's',0,'h',0];

    function ensureGain() {
      if (!bgmGain && masterGain) { bgmGain = actx.createGain(); bgmGain.gain.value = 0.5; bgmGain.connect(masterGain); }
      return bgmGain;
    }

    function blip(freq, when, dur, type, vol, dest) {
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, when);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g).connect(dest); o.start(when); o.stop(when + dur + 0.02);
    }
    function kick(when, dest) {
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(150, when);
      o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
      g.gain.setValueAtTime(0.22, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
      o.connect(g).connect(dest); o.start(when); o.stop(when + 0.18);
    }
    function snare(when, dest) {
      var len = Math.floor(actx.sampleRate * 0.18), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = actx.createBufferSource(); src.buffer = buf;
      var f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
      var g = actx.createGain(); g.gain.setValueAtTime(0.14, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
      src.connect(f).connect(g).connect(dest); src.start(when); src.stop(when + 0.2);
    }
    function hat(when, dest) {
      var len = Math.floor(actx.sampleRate * 0.05), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
      var src = actx.createBufferSource(); src.buffer = buf;
      var f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
      var g = actx.createGain(); g.gain.setValueAtTime(0.05, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      src.connect(f).connect(g).connect(dest); src.start(when); src.stop(when + 0.06);
    }

    function scheduleStep(s, t) {
      if (muted) return;
      var g = ensureGain(); if (!g) return;
      var lead = (bossMode ? LEAD_B : LEAD)[s];
      var bass = (bossMode ? BASS_B : BASS)[s];
      var drum = (bossMode ? DRUM_B : DRUM)[s];
      if (lead) blip(mtof(lead), t, stepDur * 0.9, 'square', 0.10, g);
      if (bass) blip(mtof(bass), t, stepDur * 1.8, 'triangle', 0.16, g);
      if (drum === 'k') kick(t, g);
      else if (drum === 's') snare(t, g);
      else if (drum === 'h') hat(t, g);
    }

    function scheduler() {
      if (!playing) return;
      var a = ensure(); if (!a) { timer = setTimeout(scheduler, 200); return; }
      while (nextNoteTime < a.currentTime + 0.12) {
        scheduleStep(step, nextNoteTime);
        nextNoteTime += stepDur;
        step = (step + 1) % 32;
      }
      timer = setTimeout(scheduler, 25);
    }

    return {
      start: function () {
        var a = ensure(); if (!a) return;
        if (playing) return;
        playing = true; step = 0; nextNoteTime = a.currentTime + 0.1;
        scheduler();
      },
      stop: function () { playing = false; if (timer) { clearTimeout(timer); timer = null; } },
      boss: function (on) { bossMode = !!on; },
      setMuted: function () { /* 静音由 masterGain 统一处理 */ }
    };
  })();

  window.Bgm = Bgm;

  // 首次任意手势即解锁音频（满足浏览器自动播放策略）
  function firstGesture() {
    if (window.Sfx) window.Sfx.unlock();
    if (window.Bgm) window.Bgm.start();
    document.removeEventListener('pointerdown', firstGesture);
    document.removeEventListener('keydown', firstGesture);
  }
  document.addEventListener('pointerdown', firstGesture);
  document.addEventListener('keydown', firstGesture);
})();
