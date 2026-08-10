/**
 * 星球PK — 游戏 Tab（弹球击退星球）V5
 *
 * 玩法原型：
 *  - 顶部不断生成并下压「星球」障碍物，速度/密度随关卡提升
 *  - 底部由玩家滑动控制的「球网/挡板」
 *  - 能量球在边界与挡板间反弹，击中上方星球时击退/粉碎
 *  - 命中特效：粒子爆炸 + 光晕脉冲 + 震屏
 *  - 危险预警：星球逼近底部时屏幕边缘红光闪烁
 *  - 动态深空背景：星尘流动 + 霓虹光
 *
 * 渲染：Canvas 2D，DPR 自适应，requestAnimationFrame + delta time（兼容 60/120fps）
 * 碰撞：能量球(圆) vs 星球(圆) 圆-圆；能量球(圆) vs 挡板(AABB) 最近点
 *
 * 对外暴露 window.ArcadeGame：start() / stop()
 */
window.ArcadeGame = (function () {
  'use strict';

  // ---------- 画布与尺寸 ----------
  let canvas, ctx, dpr = 1;
  let W = 0, H = 0;          // CSS 像素逻辑尺寸
  let rafId = null;
  let lastT = 0;
  let running = false;

  // ---------- 实体 ----------
  let paddle = null;
  let balls = [];
  let planets = [];
  let particles = [];
  let bgStars = [];

  // ---------- 状态 ----------
  let state = 'idle';        // idle | playing | over
  let score = 0, lives = 3, level = 1, elapsed = 0;
  let spawnTimer = 0, levelTimer = 0;
  let shake = { t: 0, mag: 0 };
  let danger = 0;            // 0..1 危险强度（驱动红光）
  let flashWarning = 0;      // 失去生命时的强闪

  // ---------- DOM ----------
  let elScore, elLives, elLevel, elDanger, elToast, elOver, elOverTitle, elOverScore, elOverStats;

  // ---------- 可调参数（关卡难度系数） ----------
  const BASE = {
    ballSpeed: 360,          // px/s
    planetSpeed: 26,         // px/s 初始下压速度
    spawnInterval: 1.7,     // s 初始生成间隔
    planetHP: 1,
  };

  const PALETTE = [
    '#6cf', '#f6c', '#fc6', '#9f9', '#f96', '#c9f', '#6ff', '#ff7b9c', '#7bff9c',
  ];
  // 借用真实天体名增加代入感
  const NAMES = ['水星', '金星', '火星', '木星', '土星', '天王星', '海王星', '冥王星',
                 '谷神星', '木卫三', '天狼星', '参宿四', '北落师门', '比邻星'];

  // ============ 工具 ============
  function $(id) { return document.getElementById(id); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

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

    initBackground();
    bindInput();
  }

  // 因为 canvas 初始 display:none 时 getBoundingClientRect 为 0，
  // 必须在屏幕可见后再调用 resize()。
  function resize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.25); // 高刷屏限制 DPR 保性能
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (paddle) {
      paddle.w = clamp(W * 0.22, 70, 160);
      paddle.h = clamp(H * 0.022, 12, 22);
      paddle.y = H - paddle.h - 18;
      paddle.x = clamp(paddle.x || W / 2, paddle.w / 2, W - paddle.w / 2);
    }
    // 将界外实体收回
    balls.forEach(b => {
      if (b.x < b.r) b.x = b.r;
      if (b.x > W - b.r) b.x = W - b.r;
    });
  }

  function initBackground() {
    bgStars = [];
    for (let i = 0; i < 90; i++) {
      bgStars.push({
        x: Math.random(), y: Math.random(),
        r: rand(0.4, 1.8),
        s: rand(8, 40),            // 下流速度 px/s
        a: rand(0.2, 0.9),
      });
    }
  }

  // ============ 输入 ============
  function bindInput() {
    // 指针（鼠标/触摸统一），滑动控制挡板
    function moveTo(clientX) {
      if (!paddle || state !== 'playing') return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      paddle.x = clamp(x, paddle.w / 2, W - paddle.w / 2);
    }
    canvas.addEventListener('pointerdown', e => { moveTo(e.clientX); });
    canvas.addEventListener('pointermove', e => {
      if (e.pressure > 0 || e.buttons > 0 || e.pointerType === 'touch') moveTo(e.clientX);
    });
    // 防止移动端滑动页面
    canvas.addEventListener('touchmove', e => { e.preventDefault(); }, { passive: false });

    // 桌面调试：左右方向键微调
    window.addEventListener('keydown', e => {
      if (state !== 'playing' || !paddle) return;
      if (e.key === 'ArrowLeft') paddle.x = clamp(paddle.x - 24, paddle.w / 2, W - paddle.w / 2);
      if (e.key === 'ArrowRight') paddle.x = clamp(paddle.x + 24, paddle.w / 2, W - paddle.w / 2);
    });
  }

  // ============ 关卡难度 ============
  function difficulty() {
    const k = level - 1;
    return {
      ballSpeed: BASE.ballSpeed * (1 + k * 0.06),
      planetSpeed: BASE.planetSpeed * (1 + k * 0.18),
      spawnInterval: Math.max(0.55, BASE.spawnInterval - k * 0.12),
      planetHP: BASE.planetHP + (level >= 3 ? 1 : 0) + (level >= 6 ? 1 : 0),
    };
  }

  // ============ 实体生成 ============
  function spawnPlanet() {
    const d = difficulty();
    const r = rand(W * 0.05, W * 0.11);
    const x = rand(r + 4, W - r - 4);
    planets.push({
      x, y: -r - rand(0, 60),
      r,
      vy: d.planetSpeed * rand(0.85, 1.15),
      vx: rand(-12, 12),
      hp: d.planetHP + ((Math.random() < 0.25) ? 1 : 0),
      maxHp: 0,
      color: pick(PALETTE),
      name: pick(NAMES),
      flash: 0,
      rot: Math.random() * Math.PI,
      rotSpeed: rand(-1, 1),
    });
    planets[planets.length - 1].maxHp = planets[planets.length - 1].hp;
  }

  function spawnBall(x, y) {
    const d = difficulty();
    const ang = rand(-Math.PI * 0.65, -Math.PI * 0.35); // 向上偏
    balls.push({
      x: x ?? W / 2,
      y: y ?? (H - 60),
      r: clamp(W * 0.022, 8, 16),
      vx: Math.cos(ang) * d.ballSpeed,
      vy: Math.sin(ang) * d.ballSpeed,
    });
  }

  // ============ 粒子 / 特效 ============
  function burst(x, y, color, n, power) {
    n = Math.min(n, 60);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(40, 260) * (power || 1);
      particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.3, 0.8), max: 0.8,
        r: rand(1, 3.4), color,
      });
    }
  }
  function addShake(mag) { shake.t = 1; shake.mag = Math.max(shake.mag, mag); }
  function toast(msg) {
    elToast.textContent = msg;
    elToast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => elToast.classList.remove('show'), 1100);
  }

  // ============ 碰撞 ============
  function ballHitsPlanet(b, p) {
    const dx = b.x - p.x, dy = b.y - p.y;
    const dist = Math.hypot(dx, dy);
    const min = b.r + p.r;
    if (dist >= min) return false;

    // 推出 + 沿法线反弹
    const nx = dx / (dist || 1), ny = dy / (dist || 1);
    const overlap = min - dist;
    b.x += nx * overlap;
    b.y += ny * overlap;
    const dot = b.vx * nx + b.vy * ny;
    if (dot < 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }

    // 击退：给星球一个向上的冲量
    p.vy -= 40;
    p.vx += rand(-20, 20);
    p.flash = 1;

    p.hp -= 1;
    if (p.hp <= 0) {
      burst(p.x, p.y, p.color, 36, 1.3);
      score += 100 * level;
      addShake(7);
      planets.splice(planets.indexOf(p), 1);
    } else {
      burst(b.x, b.y, p.color, 10, 0.7);
      addShake(3);
    }
    updateHud();
    return true;
  }

  function ballHitsPaddle(b, pad) {
    // 最近点法（圆 vs AABB）
    const cx = clamp(b.x, pad.x - pad.w / 2, pad.x + pad.w / 2);
    const cy = clamp(b.y, pad.y, pad.y + pad.h);
    const dx = b.x - cx, dy = b.y - cy;
    if (dx * dx + dy * dy > b.r * b.r) return false;
    if (b.vy <= 0) return false; // 只在向下时接球

    b.y = cy - b.r - 0.5;
    // 反弹 + 由击打点决定角度（倾角控制）
    const off = (b.x - pad.x) / (pad.w / 2); // -1..1
    const speed = Math.hypot(b.vx, b.vy);
    const ang = -Math.PI / 2 + off * (Math.PI * 0.42); // 上偏，最多 ~75°
    b.vx = Math.cos(ang) * speed;
    b.vy = Math.sin(ang) * speed;
    p_flashPaddle();
    return true;
  }
  let paddleFlash = 0;
  function p_flashPaddle() { paddleFlash = 1; }

  // ============ 更新 ============
  function update(dt) {
    elapsed += dt;
    levelTimer += dt;

    // 关卡推进
    if (levelTimer >= 30) {
      levelTimer = 0; level += 1;
      toast('第 ' + level + ' 关！压力增强');
      updateHud();
    }

    // 生成星球
    spawnTimer += dt;
    if (spawnTimer >= difficulty().spawnInterval) {
      spawnTimer = 0;
      spawnPlanet();
      if (level >= 4 && Math.random() < 0.4) spawnPlanet(); // 高密度
    }

    // 挡板
    if (paddleFlash > 0) paddleFlash = Math.max(0, paddleFlash - dt * 3);

    // 能量球
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // 左右墙
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
      if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
      // 顶墙
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); }

      // 挡板
      ballHitsPaddle(b, paddle);

      // 星球
      for (let j = planets.length - 1; j >= 0; j--) {
        ballHitsPlanet(b, planets[j]);
      }

      // 掉落底部
      if (b.y - b.r > H) {
        balls.splice(i, 1);
        if (balls.length === 0) loseLife();
      }
    }

    // 星球下压
    let nearest = Infinity;
    for (let j = planets.length - 1; j >= 0; j--) {
      const p = planets[j];
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      p.rot += p.rotSpeed * dt;
      if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 2.5);
      // 横向边界软反弹
      if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx); }
      if (p.x > W - p.r) { p.x = W - p.r; p.vx = -Math.abs(p.vx); }

      const bottomGap = (paddle.y) - (p.y + p.r);
      if (bottomGap < nearest) nearest = bottomGap;

      // 触底：失去生命
      if (p.y + p.r >= paddle.y + paddle.h) {
        burst(p.x, p.y, '#ff3b5c', 28, 1.2);
        planets.splice(j, 1);
        loseLife();
      }
    }

    // 危险预警强度
    const dangerTarget = clamp(1 - nearest / (H * 0.45), 0, 1);
    danger += (dangerTarget - danger) * Math.min(1, dt * 6);
    if (flashWarning > 0) flashWarning = Math.max(0, flashWarning - dt * 2.5);

    // 粒子
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 220 * dt; // 轻微重力
      pt.life -= dt;
      if (pt.life <= 0) particles.splice(i, 1);
    }

    // 震屏衰减
    if (shake.t > 0) shake.t = Math.max(0, shake.t - dt * 2.2);
  }

  function loseLife() {
    lives -= 1;
    flashWarning = 1;
    addShake(10);
    burst(W / 2, H - 30, '#ff3b5c', 24, 1.1);
    updateHud();
    if (lives <= 0) {
      gameOver();
    } else {
      // 重新发球
      spawnBall(paddle.x, paddle.y - 30);
      toast('剩余生命 ' + lives);
    }
  }

  // ============ 渲染 ============
  function render() {
    ctx.clearRect(0, 0, W, H);

    // 震屏偏移
    let sx = 0, sy = 0;
    if (shake.t > 0) {
      const m = shake.mag * shake.t;
      sx = rand(-m, m); sy = rand(-m, m);
    }
    ctx.save();
    ctx.translate(sx, sy);

    drawBackground();

    // 顶部压迫区视觉带
    const grad = ctx.createLinearGradient(0, 0, 0, H * 0.12);
    grad.addColorStop(0, 'rgba(255,60,90,0.18)');
    grad.addColorStop(1, 'rgba(255,60,90,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H * 0.12);

    // 底部危险线
    ctx.strokeStyle = 'rgba(255,80,110,' + (0.25 + danger * 0.5) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, paddle.y - 6);
    ctx.lineTo(W, paddle.y - 6);
    ctx.stroke();

    // 星球
    planets.forEach(drawPlanet);

    // 能量球
    balls.forEach(drawBall);

    // 挡板
    drawPaddle();

    // 粒子
    particles.forEach(drawParticle);

    ctx.restore();
  }

  function drawBackground() {
    // 深空渐变
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05010f');
    g.addColorStop(1, '#0a0420');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 星尘流动
    const dt = 1 / 60;
    bgStars.forEach(s => {
      s.y += (s.s * dt) / H;
      if (s.y > 1) { s.y = 0; s.x = Math.random(); }
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#bfe9ff';
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawPlanet(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);

    // 命中光晕
    if (p.flash > 0) {
      const fg = ctx.createRadialGradient(0, 0, p.r * 0.4, 0, 0, p.r * 1.8);
      fg.addColorStop(0, 'rgba(255,255,255,' + (0.6 * p.flash) + ')');
      fg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(0, 0, p.r * 1.8, 0, Math.PI * 2); ctx.fill();
    }

    // 球体
    const g = ctx.createRadialGradient(-p.r * 0.3, -p.r * 0.3, p.r * 0.2, 0, 0, p.r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, p.color);
    g.addColorStop(1, shade(p.color, -0.55));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();

    // 受损裂纹（多血量时）
    if (p.maxHp > 1 && p.hp < p.maxHp) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-p.r * 0.5, 0); ctx.lineTo(p.r * 0.4, p.r * 0.3);
      ctx.stroke();
    }
    ctx.restore();

    // 名称（不旋转）
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = Math.max(10, p.r * 0.34) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - p.r - 4);
    ctx.restore();
  }

  function drawBall(b) {
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 2.2);
    g.addColorStop(0, 'rgba(120,230,255,0.9)');
    g.addColorStop(0.4, 'rgba(80,200,255,0.5)');
    g.addColorStop(1, 'rgba(80,200,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.2, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#eaffff';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  }

  function drawPaddle() {
    const x = paddle.x - paddle.w / 2;
    const glow = 0.4 + paddleFlash * 0.6;
    ctx.shadowColor = 'rgba(80,220,255,' + glow + ')';
    ctx.shadowBlur = 16 + paddleFlash * 20;
    const g = ctx.createLinearGradient(x, 0, x + paddle.w, 0);
    g.addColorStop(0, '#1ad6ff');
    g.addColorStop(0.5, '#7af9ff');
    g.addColorStop(1, '#1ad6ff');
    ctx.fillStyle = g;
    roundRect(x, paddle.y, paddle.w, paddle.h, paddle.h / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawParticle(pt) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.max);
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ============ 辅助绘制 ============
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function shade(hex, amt) {
    const c = hex.replace('#', '');
    let r = parseInt(c.substr(0, 2), 16);
    let g = parseInt(c.substr(2, 2), 16);
    let b = parseInt(c.substr(4, 2), 16);
    r = clamp(Math.round(r + r * amt), 0, 255);
    g = clamp(Math.round(g + g * amt), 0, 255);
    b = clamp(Math.round(b + b * amt), 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // ============ HUD / 危险光 ============
  function updateHud() {
    elScore.textContent = score;
    elLevel.textContent = level;
    elLives.textContent = lives > 0 ? '♥'.repeat(lives) : '—';
  }
  function updateDangerVisual() {
    // 危险红光 + 失去生命的强闪
    const a = clamp(danger * 0.7 + flashWarning * 0.5, 0, 0.85);
    elDanger.style.opacity = a.toFixed(2);
    elDanger.style.boxShadow = 'inset 0 0 ' + (30 + danger * 60) + 'px rgba(255,40,70,' + (0.4 + danger * 0.5) + ')';
  }

  // ============ 主循环 ============
  function loop(t) {
    if (!running) return;
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
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
    // 屏幕已可见，重置尺寸
    resize();
    score = 0; lives = 3; level = 1; elapsed = 0;
    spawnTimer = 0; levelTimer = 0; danger = 0; flashWarning = 0;
    planets = []; particles = []; balls = [];
    paddle = { x: W / 2, y: H - 40, w: 0, h: 0, vx: 0 };
    resize(); // 用真实尺寸设置 paddle
    spawnBall();
    // 初始铺几个星球
    for (let i = 0; i < 3; i++) spawnPlanet();
    elOver.style.display = 'none';
    updateHud();
    state = 'playing';
    running = true;
    lastT = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
    toast('第 1 关 · 开始！');
  }

  function stop() {
    running = false;
    state = 'idle';
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (elDanger) elDanger.style.opacity = '0';
  }

  function gameOver() {
    state = 'over';
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    elOverTitle.textContent = '游戏结束';
    elOverScore.textContent = score;
    elOverStats.innerHTML = '坚持到第 <b>' + level + '</b> 关 · 击退星球累计得分';
    elOver.style.display = 'flex';
  }

  return { init, start, stop };
})();
