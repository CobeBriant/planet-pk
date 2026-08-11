/**
 * 星球PK — 游戏 Tab（太空射击）V6.0
 *
 * 玩法（经典街机太空射击）：
 *  - 玩家控制一架「星际战机」，触摸/滑动可在屏幕内自由飞行（前后左右）
 *  - 战机自动向上发射能量弹
 *  - 真实天体（来自 data.js CELESTIAL_DATA）从屏幕顶部不断落下
 *  - 射击击碎天体得分；被天体撞到或让天体穿过底部则扣命
 *  - 随时间推移，天体下落速度和密度递增（每 30 秒一关）
 *
 * 数据源：
 *  - 天体从 CELESTIAL_DATA（data.js）随机选取，使用真实名称/颜色/图片
 *  - 图片复用 game.js 的 window.PKImageCache（已预加载的纹理）
 *
 * 渲染：Canvas 2D，DPR 自适应，requestAnimationFrame + delta time
 * 碰撞：子弹(圆) vs 天体(圆) 圆-圆；战机(圆) vs 天体(圆) 圆-圆
 *
 * 对外暴露 window.ArcadeGame：init() / start() / stop()
 */
window.ArcadeGame = (function () {
  'use strict';

  // ---------- 画布与尺寸 ----------
  let canvas, ctx, dpr = 1;
  let W = 0, H = 0;
  let rafId = null;
  let lastT = 0;
  let running = false;

  // ---------- 实体 ----------
  let ship = null;        // 玩家战机
  let bullets = [];       // 子弹
  let planets = [];       // 下落的天体
  let particles = [];     // 粒子特效
  let bgStars = [];       // 背景星空

  // ---------- 状态 ----------
  let state = 'idle';          // idle | playing | over
  let score = 0, lives = 3, level = 1, elapsed = 0;
  let spawnTimer = 0, levelTimer = 0;
  let fireTimer = 0;           // 自动射击计时
  let shake = { t: 0, mag: 0 };
  let danger = 0;
  let flashWarning = 0;
  let framesSinceStart = 0;

  // ---------- DOM ----------
  let elScore, elLives, elLevel, elDanger, elToast, elOver, elOverTitle, elOverScore, elOverStats;

  // ---------- 可调参数 ----------
  const BASE = {
    shipSpeed: 320,         // 战机移动速度 px/s
    bulletSpeed: 600,       // 子弹速度 px/s
    fireRate: 0.22,         // 射击间隔秒
    planetSpeed: 55,        // 天体下落基础速度
    spawnInterval: 1.8,     // 生成间隔秒
    bulletDamage: 1,        // 每发子弹伤害
    planetHPBase: 1,        // 基础血量
  };

  // ============ 工具 ============
  function $(id) { return document.getElementById(id); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  // ============ 音效（Web Audio 合成，无需音频文件） ============
  const Sfx = (function () {
    let actx = null;
    let muted = false;
    function ensure() {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { actx = new AC(); } catch (e) { return null; }
      }
      if (actx.state === 'suspended') actx.resume();
      return actx;
    }
    function tone(opt) {
      const a = ensure(); if (!a || muted) return;
      const t0 = a.currentTime;
      const dur = opt.dur ?? 0.15;
      const vol = opt.vol ?? 0.2;
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = opt.type || 'sine';
      osc.frequency.setValueAtTime(opt.freq || 440, t0);
      if (opt.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opt.freqEnd), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + (opt.attack ?? 0.005));
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(a.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    }
    function noise(opt) {
      const a = ensure(); if (!a || muted) return;
      const t0 = a.currentTime;
      const dur = opt.dur ?? 0.2;
      const vol = opt.vol ?? 0.3;
      const len = Math.floor(a.sampleRate * dur);
      const buf = a.createBuffer(1, len, a.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource(); src.buffer = buf;
      const filt = a.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = opt.filterFreq || 1200;
      const gain = a.createGain();
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filt).connect(gain).connect(a.destination);
      src.start(t0); src.stop(t0 + dur);
    }
    return {
      unlock() { ensure(); },
      shoot() { tone({ freq: 880, freqEnd: 440, type: 'square', dur: 0.06, vol: 0.08 }); },
      hit() { tone({ freq: 540, freqEnd: 300, type: 'square', dur: 0.08, vol: 0.10 }); },
      destroy() {
        noise({ dur: 0.26, vol: 0.32, filterFreq: 1800 });
        tone({ freq: 200, freqEnd: 60, type: 'sawtooth', dur: 0.26, vol: 0.16 });
      },
      lifeLost() { tone({ freq: 220, freqEnd: 70, type: 'sawtooth', dur: 0.42, vol: 0.22 }); },
      levelUp() {
        [523, 659, 784, 1046].forEach((f, i) =>
          setTimeout(() => tone({ freq: f, type: 'triangle', dur: 0.12, vol: 0.15 }), i * 70));
      },
      gameOver() {
        [440, 350, 260, 180].forEach((f, i) =>
          setTimeout(() => tone({ freq: f, type: 'sawtooth', dur: 0.3, vol: 0.2 }), i * 120));
      },
      start() { tone({ freq: 330, freqEnd: 660, type: 'triangle', dur: 0.2, vol: 0.16 }); },
      toggleMute() { muted = !muted; return muted; },
      isMuted() { return muted; },
    };
  })();

  // ============ 真实天体池 ============
  function getArcadePool() {
    var pool = (typeof CELESTIAL_DATA !== 'undefined') ? CELESTIAL_DATA.slice() : [];
    return pool.filter(function(b) {
      return b.category !== 'galaxy' && b.category !== 'blackhole';
    });
  }
  let arcadePool = [];

  // ============ 初始化 / 尺寸 ============
  function init() {
    canvas = $('arcade-canvas');
    ctx = canvas.getContext('2d');
    elScore = $('arcade-score');
    elLives = $('arcade-lives');
    elLevel = $('arcade-level');
    elDanger = $('arcade-danger');
    elToast = $('arcade-toast');
    elOver = $('arcade-over');
    elOverTitle = $('arcade-over-title');
    elOverScore = $('arcade-over-score');
    elOverStats = $('arcade-over-stats');

    // 静音开关
    var muteBtn = $('arcade-mute');
    if (muteBtn) {
      muteBtn.textContent = Sfx.isMuted() ? '\uD83D\uDD07' : '\uD83D\uDD0A';
      muteBtn.addEventListener('click', function () {
        var m = Sfx.toggleMute();
        muteBtn.textContent = m ? '\uD83D\uDD07' : '\uD83D\uDD0A';
        if (!m) { Sfx.unlock(); Sfx.shoot(); }
      });
    }

    arcadePool = getArcadePool();
    initBackground();
    bindInput();
  }

  function resize() {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 重置战机位置到安全区域
    if (ship) {
      ship.x = clamp(ship.x, ship.r + 10, W - ship.r - 10);
      ship.y = clamp(ship.y, H * 0.55, H - ship.r - 10);
    }
  }

  function initBackground() {
    bgStars = [];
    for (var i = 0; i < 100; i++) {
      bgStars.push({
        x: Math.random(), y: Math.random(),
        r: rand(0.4, 2),
        s: rand(12, 50),
        a: rand(0.2, 0.9),
      });
    }
  }

  // ============ 输入（触摸/鼠标拖动控制战机位置） ============
  let touchActive = false;
  function bindInput() {
    // 触摸/鼠标 → 移动战机到手指位置
    function moveShip(clientX, clientY) {
      if (!ship || state !== 'playing' || !canvas) return;
      var rect = canvas.getBoundingClientRect();
      var x = clientX - rect.left;
      var y = clientY - rect.top;
      // 限制在画布范围内
      ship.targetX = clamp(x, ship.r + 5, W - ship.r - 5);
      ship.targetY = clamp(y, ship.r + 5, H - ship.r - 5);
    }

    canvas.addEventListener('pointerdown', function(e) {
      Sfx.unlock();
      touchActive = true;
      moveShip(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointermove', function(e) {
      if (touchActive || e.pointerType === 'touch') moveShip(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerup', function() { touchActive = false; });
    canvas.addEventListener('pointerleave', function() { touchActive = false; });
    canvas.addEventListener('touchmove', function(e) { e.preventDefault(); }, { passive: false });

    // 键盘备用
    window.addEventListener('keydown', function(e) {
      if (state !== 'playing' || !ship) return;
      var step = 20;
      if (e.key === 'ArrowLeft' || e.key === 'a') ship.targetX = clamp(ship.x - step, ship.r, W - ship.r);
      if (e.key === 'ArrowRight' || e.key === 'd') ship.targetX = clamp(ship.x + step, ship.r, W - ship.r);
      if (e.key === 'ArrowUp' || e.key === 'w') ship.targetY = clamp(ship.y - step, ship.r, H - ship.r);
      if (e.key === 'ArrowDown' || e.key === 's') ship.targetY = clamp(ship.y + step, ship.r, H - ship.r);
    });
  }

  // ============ 关卡难度 ============
  function difficulty() {
    var k = level - 1;
    return {
      planetSpeed: BASE.planetSpeed * (1 + k * 0.12),
      spawnInterval: Math.max(0.6, BASE.spawnInterval - k * 0.10),
      planetHP: BASE.planetHPBase + (level >= 3 ? 1 : 0) + (level >= 6 ? 1 : 0),
    };
  }

  // ============ 实体生成 ============
  function spawnPlanet() {
    if (arcadePool.length === 0) arcadePool = getArcadePool();
    var body = arcadePool.length > 0 ? pick(arcadePool) : {
      id: 'fallback_' + Math.random().toString(36).slice(2, 6),
      name: ['水星', '金星', '火星', '木星', '土星', '天王星', '海王星', '月球'][(Math.random() * 8) | 0],
      color: pick(['#6cf', '#f6c', '#fc6', '#9f9', '#f96', '#c9f']),
      category: 'planet',
      image: null,
    };
    var d = difficulty();

    // 半径按屏幕比例，恒星大、卫星小
    var baseR = body.category === 'star' ? rand(0.07, 0.12) :
                body.category === 'moon' ? rand(0.03, 0.055) :
                rand(0.045, 0.09);
    var r = clamp(baseR * W, 20, Math.min(W * 0.16, 65));

    planets.push({
      x: rand(r + 10, W - r - 10),
      y: -r - rand(5, 50),
      r: r,
      vy: d.planetSpeed * rand(0.85, 1.15),
      vx: rand(-18, 18),
      hp: d.planetHP + ((Math.random() < 0.2) ? 1 : 0),
      maxHp: 0,
      color: body.color || '#888',
      name: body.name || '未知天体',
      bodyId: body.id,
      hasImage: !!body.image,
      flash: 0,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: rand(-0.6, 0.6),
    });
    var p = planets[planets.length - 1];
    p.maxHp = p.hp;
  }

  function fireBullet() {
    if (!ship) return;
    bullets.push({
      x: ship.x,
      y: ship.y - ship.r - 4,
      r: clamp(W * 0.012, 4, 7),
      vy: -BASE.bulletSpeed,
    });
    Sfx.shoot();
  }

  // ============ 粒子 / 特效 ============
  function burst(x, y, color, n, power) {
    n = Math.min(n, 60);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = rand(40, 280) * (power || 1);
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.3, 0.8), max: 0.8,
        r: rand(1.2, 4.5), color: color,
      });
    }
  }
  function addShake(mag) { shake.t = 1; shake.mag = Math.max(shake.mag, mag); }
  function toast(msg) {
    elToast.textContent = msg;
    elToast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { elToast.classList.remove('show'); }, 1100);
  }

  // ============ 碰撞检测 ============
  function circleCollide(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    var dist = Math.hypot(dx, dy);
    var min = (a.r || 0) + (b.r || 0);
    return dist < min;
  }

  function bulletHitsPlanet(bullet, planet) {
    if (!circleCollide(bullet, planet)) return false;

    planet.hp -= BASE.bulletDamage;
    planet.flash = 1;

    if (planet.hp <= 0) {
      burst(planet.x, planet.y, planet.color, 40, 1.4);
      score += 100 * level;
      addShake(7);
      Sfx.destroy();
      planets.splice(planets.indexOf(planet), 1);
    } else {
      burst(bullet.x, bullet.y, planet.color, 8, 0.6);
      Sfx.hit();
    }
    updateHud();
    return true;
  }

  function shipHitsPlanet(p) {
    if (!circleCollide(ship, p)) return false;

    loseLife();
    // 被撞到的天体也一起消失
    burst(p.x, p.y, p.color, 30, 1.1);
    planets.splice(planets.indexOf(p), 1);
    return true;
  }

  // ============ 更新逻辑 ============
  function update(dt) {
    elapsed += dt;
    levelTimer += dt;
    framesSinceStart++;

    // 开局安全：第 10 帧强制 resize
    if (framesSinceStart === 10) resize();

    // 关卡推进
    if (levelTimer >= 30) {
      levelTimer = 0; level += 1;
      toast('第 ' + level + ' 关！天体加速');
      Sfx.levelUp();
      updateHud();
    }

    // 生成天体
    spawnTimer += dt;
    if (spawnTimer >= difficulty().spawnInterval) {
      spawnTimer = 0;
      spawnPlanet();
      if (level >= 4 && Math.random() < 0.3) spawnPlanet();
    }

    // 自动射击
    fireTimer += dt;
    if (fireTimer >= BASE.fireRate) {
      fireTimer = 0;
      fireBullet();
    }

    // ===== 战机平滑跟随手指 =====
    if (ship) {
      var dx = ship.targetX - ship.x;
      var dy = ship.targetY - ship.y;
      // 平滑插值（lerp），手感更顺
      ship.x += dx * Math.min(1, dt * 12);
      ship.y += dy * Math.min(1, dt * 12);
      // 引擎尾焰动画
      ship.enginePhase = (ship.enginePhase || 0) + dt * 15;
    }

    // ===== 子弹更新 =====
    for (var i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      b.y += b.vy * dt;

      // 子弹 vs 天体碰撞
      var hit = false;
      for (var j = planets.length - 1; j >= 0; j--) {
        if (bulletHitsPlanet(b, planets[j])) { hit = true; break; }
      }
      if (hit) { bullets.splice(i, 1); continue; }

      // 出屏移除
      if (b.y + b.r < 0) bullets.splice(i, 1);
    }

    // ===== 天体更新 =====
    var nearestBottom = Infinity;
    for (var j = planets.length - 1; j >= 0; j--) {
      var p = planets[j];
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      p.rot += p.rotSpeed * dt;
      if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 2.5);

      // 左右边界反弹
      if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx); }
      if (p.x > W - p.r) { p.x = W - p.r; p.vx = -Math.abs(p.vx); }

      // 计算最近底部距离（用于危险预警）
      var bottomDist = H - (p.y + p.r);
      if (bottomDist < nearestBottom) nearestBottom = bottomDist;

      // 天体触底 → 扣命
      if (p.y - p.r > H) {
        planets.splice(j, 1);
        loseLife();
        continue;
      }

      // 天体撞击战机
      shipHitsPlanet(p);
    }

    // 危险预警值
    var dangerTarget = clamp(1 - nearestBottom / (H * 0.4), 0, 1);
    danger += (dangerTarget - danger) * Math.min(1, dt * 6);
    if (flashWarning > 0) flashWarning = Math.max(0, flashWarning - dt * 2.5);

    // ===== 粒子更新 =====
    for (var i = particles.length - 1; i >= 0; i--) {
      var pt = particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 200 * dt;   // 微重力
      pt.life -= dt;
      if (pt.life <= 0) particles.splice(i, 1);
    }

    // 震屏衰减
    if (shake.t > 0) shake.t = Math.max(0, shake.t - dt * 2.2);
  }

  function loseLife() {
    lives -= 1;
    flashWarning = 1;
    addShake(12);
    burst(ship ? ship.x : W / 2, ship ? ship.y : H - 50, '#ff3b5c', 28, 1.1);
    Sfx.lifeLost();
    updateHud();
    if (lives <= 0) {
      gameOver();
    } else {
      toast('剩余生命 ' + lives);
    }
  }

  // ============ 渲染 ============
  function render() {
    ctx.clearRect(0, 0, W, H);

    var sx = 0, sy = 0;
    if (shake.t > 0) {
      var m = shake.mag * shake.t;
      sx = rand(-m, m); sy = rand(-m, m);
    }
    ctx.save();
    ctx.translate(sx, sy);

    drawBackground();

    // 顶部压迫区视觉带
    var grad = ctx.createLinearGradient(0, 0, 0, H * 0.1);
    grad.addColorStop(0, 'rgba(255,60,90,0.16)');
    grad.addColorStop(1, 'rgba(255,60,90,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H * 0.1);

    // 底部危险线
    ctx.strokeStyle = 'rgba(255,80,110,' + (0.2 + danger * 0.45) + ')';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(0, H - 3);
    ctx.lineTo(W, H - 3);
    ctx.stroke();
    ctx.setLineDash([]);

    // 天体
    planets.forEach(drawPlanet);

    // 子弹
    bullets.forEach(drawBullet);

    // 战机
    if (ship) drawShip();

    // 粒子
    particles.forEach(drawParticle);

    ctx.restore();
  }

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05010f');
    g.addColorStop(1, '#0a0420');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 星尘流动
    bgStars.forEach(function(s) {
      s.y += (s.s / 60);   // 基于 60fps 的恒定速度
      if (s.y > 1.05) { s.y = -0.02; s.x = Math.random(); }
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#bfe9ff';
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /**
   * 绘制天体 — 优先用真实图片（PKImageCache），否则程序化绘制
   */
  function drawPlanet(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);

    // 命中光晕
    if (p.flash > 0) {
      var fg = ctx.createRadialGradient(0, 0, p.r * 0.3, 0, 0, p.r * 1.8);
      fg.addColorStop(0, 'rgba(255,255,255,' + (0.55 * p.flash) + ')');
      fg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(0, 0, p.r * 1.8, 0, Math.PI * 2); ctx.fill();
    }

    // 尝试真实图片
    var img = null;
    if (p.hasImage && typeof window.PKImageCache !== 'undefined') {
      img = window.PKImageCache[p.bodyId];
    }
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, -p.r, -p.r, p.r * 2, p.r * 2);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.stroke();
    } else {
      // 程序化球体
      var g = ctx.createRadialGradient(-p.r * 0.3, -p.r * 0.3, p.r * 0.15, 0, 0, p.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, p.color);
      g.addColorStop(1, shadeColor(p.color, -0.55));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
    }

    // 受损裂纹
    if (p.maxHp > 1 && p.hp < p.maxHp) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-p.r * 0.4, -p.r * 0.2); ctx.lineTo(p.r * 0.3, p.r * 0.35);
      ctx.moveTo(p.r * 0.1, -p.r * 0.4); ctx.lineTo(-p.r * 0.2, p.r * 0.15);
      ctx.stroke();
    }
    ctx.restore();

    // 名称标签（不旋转）
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    var fontSize = Math.max(11, Math.min(p.r * 0.38, 15));
    ctx.font = fontSize + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - p.r - 4);
    ctx.restore();
  }

  function drawBullet(b) {
    // 发光子弹
    var g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 3);
    g.addColorStop(0, 'rgba(120,255,200,0.95)');
    g.addColorStop(0.4, 'rgba(80,230,180,0.5)');
    g.addColorStop(1, 'rgba(80,230,180,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 3, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#dfffff';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  }

  /**
   * 绘制战机 — 三角形飞船 + 引擎尾焰
   */
  function drawShip() {
    var sx = ship.x, sy = ship.y, sr = ship.r;
    var phase = ship.enginePhase || 0;

    ctx.save();
    ctx.translate(sx, sy);

    // 引擎尾焰
    var flameLen = sr * (1.0 + 0.35 * Math.sin(phase));
    var flameGrad = ctx.createLinearGradient(0, sr * 0.3, 0, sr * 0.3 + flameLen);
    flameGrad.addColorStop(0, 'rgba(80,200,255,0.95)');
    flameGrad.addColorStop(0.4, 'rgba(40,140,255,0.6)');
    flameGrad.addColorStop(1, 'rgba(40,140,255,0)');
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.moveTo(-sr * 0.4, sr * 0.3);
    ctx.lineTo(sr * 0.4, sr * 0.3);
    ctx.lineTo(0, sr * 0.3 + flameLen);
    ctx.closePath();
    ctx.fill();

    // 飞船主体（三角形）
    ctx.shadowColor = 'rgba(80,200,255,0.7)';
    ctx.shadowBlur = 16;
    var bodyGrad = ctx.createLinearGradient(0, -sr, 0, sr * 0.5);
    bodyGrad.addColorStop(0, '#7af9ff');
    bodyGrad.addColorStop(0.5, '#1ad6ff');
    bodyGrad.addColorStop(1, '#0e8faa');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(0, -sr);           // 机头
    ctx.lineTo(-sr * 0.75, sr * 0.6);  // 左翼
    ctx.lineTo(0, sr * 0.3);           // 机尾中
    ctx.lineTo(sr * 0.75, sr * 0.6);   // 右翼
    ctx.closePath();
    ctx.fill();

    // 驾驶舱高光
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(200,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(0, -sr * 0.2, sr * 0.2, sr * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // 护盾光环（受伤后短暂闪烁）
    if (flashWarning > 0) {
      ctx.strokeStyle = 'rgba(255,60,90,' + (flashWarning * 0.7) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, sr * 1.4, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawParticle(pt) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.max);
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ============ 辅助函数 ============
  function shadeColor(hex, amt) {
    var c = hex.replace('#', '');
    var rr = parseInt(c.substr(0, 2), 16);
    var gg = parseInt(c.substr(2, 2), 16);
    var bb = parseInt(c.substr(4, 2), 16);
    rr = clamp(Math.round(rr + rr * amt), 0, 255);
    gg = clamp(Math.round(gg + gg * amt), 0, 255);
    bb = clamp(Math.round(bb + bb * amt), 0, 255);
    return 'rgb(' + rr + ',' + gg + ',' + bb + ')';
  }

  // ============ HUD / 危险光 ============
  function updateHud() {
    elScore.textContent = score;
    elLevel.textContent = level;
    elLives.textContent = lives > 0 ? '\u2665'.repeat(lives) : '\u2014';
  }
  function updateDangerVisual() {
    var a = clamp(danger * 0.7 + flashWarning * 0.5, 0, 0.85);
    elDanger.style.opacity = a.toFixed(2);
    elDanger.style.boxShadow = 'inset 0 0 ' + (30 + danger * 60) + 'px rgba(255,40,70,' + (0.4 + danger * 0.5) + ')';
  }

  // ============ 主循环 ============
  function loop(t) {
    if (!running) return;
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;

    if (state === 'playing') {
      update(dt);
      updateDangerVisual();
    }
    render();
    rafId = requestAnimationFrame(loop);
  }

  // ============ 生命周期 ============
  function start() {
    if (!canvas) init();
    Sfx.unlock();
    Sfx.start();
    resize();

    // 重置状态
    score = 0; lives = 3; level = 1; elapsed = 0;
    spawnTimer = 0; levelTimer = 0; fireTimer = 0;
    danger = 0; flashWarning = 0;
    framesSinceStart = 0;
    planets = []; particles = []; bullets = [];

    // 创建战机 — 大小明显可见
    var shipR = clamp(W * 0.055, 24, 42);
    ship = {
      x: W / 2,
      y: H * 0.78,
      targetX: W / 2,
      targetY: H * 0.78,
      r: shipR,
      enginePhase: 0,
    };

    // 初始天体（直接出现在屏幕上半部，不用等飘入）
    for (var i = 0; i < 3; i++) {
      spawnPlanet();
      // 把初始天体拉到屏幕可见区域
      var p = planets[planets.length - 1];
      p.y = rand(H * 0.03, H * 0.38);
    }

    elOver.style.display = 'none';
    updateHud();
    state = 'playing';
    running = true;
    lastT = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
    toast('第 1 关 · 起飞！');
  }

  function stop() {
    running = false;
    state = 'idle';
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (elDanger) elDanger.style.opacity = '0';
    touchActive = false;
  }

  function gameOver() {
    state = 'over';
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    Sfx.gameOver();
    elOverTitle.textContent = '游戏结束';
    elOverScore.textContent = score;
    elOverStats.innerHTML = '坚持到第 <b>' + level + '</b> 关 \u00B7 击毁天体累计得分';
    elOver.style.display = 'flex';
  }

  return { init, start, stop };
})();
