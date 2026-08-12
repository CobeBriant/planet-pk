/**
 * 星球PK — 拟人化星球对战（第 5 个 Tab，复刻参考视频效果）
 *
 * 玩法（大小 PK + 视频式演出）：
 *  - 每回合随机抽 2 个真实天体（来自 data.js CELESTIAL_DATA），左右并排
 *  - 星球拟人化：真实纹理球体 + 白色二次元眼睛（待机闭眼=半月弧，胜者睁眼=圆眼）
 *  - 玩家点击「更大的那颗」星球，它击败对手
 *  - 败者：红色斜射激光 + 红色十字 X + 震屏 + 橙光爆闪 → 碎裂消融
 *  - 胜者：眼睛睁开 + 头顶金色桂冠光环旋转 + 镜头推近
 *  - 硬切转场进入下一回合
 *  - 猜错扣 1 命（3 命），用尽则游戏结束
 *
 * 视觉：霓虹配色（青 #00E5FF / 红 #FF1744 / 金 #FFD700 / 白），深空黑底
 * 渲染：Canvas 2D，DPR 自适应，requestAnimationFrame + delta time
 * 复用：真实天体图片 window.PKImageCache；音效 window.Sfx（arcade.js 暴露）
 *
 * 对外暴露 window.PlanetPkGame：init() / start() / stop()
 */
window.PlanetPkGame = (function () {
  'use strict';

  // ---------- 画布与尺寸 ----------
  let canvas, ctx, dpr = 1;
  let W = 0, H = 0;
  let rafId = null;
  let lastT = 0;
  let running = false;

  // ---------- 状态 ----------
  let phase = 'idle';          // intro | idle | resolve | win
  let phaseT = 0;
  let lives = 3, score = 0, streak = 0, round = 0;
  let time = 0;
  let cutFlash = 0;             // 硬切白闪
  let state = 'idle';          // 顶层：idle | playing | over

  // ---------- 本回合实体 ----------
  let left = null, right = null;   // { body, x, baseY, R, eye, alpha, side }
  let winnerSide = null, loserSide = null;
  let playerCorrect = false;
  let particles = [];
  let shake = { t: 0, mag: 0 };
  let orangeFlash = 0;             // 败者爆闪
  let laser = { on: false, x: 0, y: 0, p: 0 };

  // 片头动画
  let titleL = null, titleR = null;
  let titleT = 0;
  let shockwave = { t: 0 };

  // ---------- DOM ----------
  let elScore, elStreak, elLives, elDanger, elToast, elOver, elOverTitle, elOverScore, elOverStats;

  // ---------- 参数 ----------
  const INTRO_DUR = 0.5, RESOLVE_DUR = 1.0, WIN_DUR = 1.3;
  const TITLE_DUR = 2.6, TITLE_FLY = 0.7;
  const COL = { cyan: '#00E5FF', red: '#FF1744', gold: '#FFD700', white: '#ffffff' };

  // ============ 工具 ============
  function $(id) { return document.getElementById(id); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function sfx(name) { if (window.Sfx && window.Sfx[name]) try { window.Sfx[name](); } catch (e) {} }

  // ============ 天体池 ============
  function getPool() {
    var base = (typeof CELESTIAL_DATA !== 'undefined') ? CELESTIAL_DATA.slice() : [];
    var custom = (window.getCustomBodies ? window.getCustomBodies() : []) || [];
    var pool = base.concat(custom);
    return pool.filter(function (b) { return b && b.radius && b.radius > 0; });
  }

  function pickTwo() {
    var pool = getPool();
    if (pool.length < 2) return null;
    var a = pool[(Math.random() * pool.length) | 0];
    var b, guard = 0;
    do { b = pool[(Math.random() * pool.length) | 0]; guard++; }
    while ((b === a || b.name === a.name) && guard < 50);
    return [a, b];
  }

  // ============ 初始化 / 尺寸 ============
  function init() {
    canvas = $('planetpk-canvas');
    ctx = canvas.getContext('2d');
    elScore = $('planetpk-score');
    elStreak = $('planetpk-streak');
    elLives = $('planetpk-lives');
    elDanger = $('planetpk-danger');
    elToast = $('planetpk-toast');
    elOver = $('planetpk-over');
    elOverTitle = $('planetpk-over-title');
    elOverScore = $('planetpk-over-score');
    elOverStats = $('planetpk-over-stats');

    // 输入：点击左右半屏选择更大的星球
    canvas.addEventListener('pointerdown', function (e) {
      if (window.Sfx && window.Sfx.unlock) window.Sfx.unlock();
      if (phase === 'title') { newRound(); return; }
      if (phase !== 'idle' || state !== 'playing') return;
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      onTap(x < rect.width / 2 ? 'left' : 'right');
    });

    // 静音开关
    var muteBtn = $('planetpk-mute');
    if (muteBtn) muteBtn.addEventListener('click', function () {
      var m = window.Sfx ? window.Sfx.toggleMute() : false;
      muteBtn.textContent = m ? '🔇' : '🔊';
    });

    // 结算面板按钮
    var replay = $('planetpk-replay'); if (replay) replay.addEventListener('click', start);
    var menu = $('planetpk-menu'); if (menu) menu.addEventListener('click', function () {
      if (window.__showMenu) window.__showMenu();
    });

    resize();
  }

  function resize() {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || (window.innerWidth || 360);
    var h = rect.height || (window.innerHeight * 0.6 || 480);
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    W = w; H = h;
  }

  // ============ 回合 ============
  function newRound() {
    var pair = pickTwo();
    if (!pair) { gameOver(); return; }
    round += 1;
    var R = clamp(Math.min(W, H) * 0.20, 54, 120);
    var baseY = H * 0.48;
    left = { body: pair[0], side: 'left', R: R, baseY: baseY, eye: 'closed', alpha: 0, x: W * 0.30, phase: rand(0, 6.28) };
    right = { body: pair[1], side: 'right', R: R, baseY: baseY, eye: 'closed', alpha: 0, x: W * 0.70, phase: rand(0, 6.28) };
    winnerSide = null; loserSide = null; playerCorrect = false;
    laser.on = false; orangeFlash = 0;
    phase = 'intro'; phaseT = 0;
    sfx('start');
  }

  // ============ 片头动画 ============
  function playTitle() {
    var pair = pickTwo();
    var R = clamp(Math.min(W, H) * 0.16, 44, 96);
    var baseY = H * 0.60;
    if (pair) {
      titleL = { body: pair[0], side: 'left', R: R, baseY: baseY, eye: 'closed', alpha: 0, x: -W * 0.18, phase: rand(0, 6.28) };
      titleR = { body: pair[1], side: 'right', R: R, baseY: baseY, eye: 'closed', alpha: 0, x: W * 1.18, phase: rand(0, 6.28) };
    } else {
      titleL = null; titleR = null;
    }
    titleT = 0;
    shockwave.t = 0;
    phase = 'title';
    sfx('start');
  }

  function onTap(side) {
    var chosen = side === 'left' ? left : right;
    var other = side === 'left' ? right : left;
    if (!chosen || !other) return;
    var chosenBigger = chosen.body.radius >= other.body.radius;
    playerCorrect = chosenBigger;
    winnerSide = chosenBigger ? side : (side === 'left' ? 'right' : 'left');
    loserSide = (winnerSide === 'left') ? 'right' : 'left';
    var winner = winnerSide === 'left' ? left : right;
    var loser = loserSide === 'left' ? left : right;

    // 判定演出
    loser.eye = 'x';
    winner.eye = 'open';
    laser.on = true; laser.x = loser.x; laser.y = loser.baseY; laser.p = 0;
    shake.t = 0.5; shake.mag = 14;
    orangeFlash = 1;

    if (playerCorrect) {
      streak += 1;
      score += 100 * streak;
      toast('答对了！' + winner.body.name + ' 更大', COL.cyan);
      sfx('destroy'); sfx('levelUp');
    } else {
      streak = 0;
      lives -= 1;
      toast('答错了！' + winner.body.name + ' 其实更大', COL.red);
      sfx('lifeLost');
      if (elDanger) elDanger.style.opacity = '1';
      setTimeout(function () { if (elDanger) elDanger.style.opacity = '0'; }, 400);
    }
    updateHud();
    phase = 'resolve'; phaseT = 0;
  }

  function finishRound() {
    if (lives <= 0) { gameOver(); return; }
    cutFlash = 1;
    newRound();
  }

  function gameOver() {
    state = 'over';
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    sfx('gameOver');
    elOverTitle.textContent = '游戏结束';
    elOverScore.textContent = score;
    elOverStats.innerHTML = '共对决 <b>' + round + '</b> 回合 \u00B7 最高连胜 <b>' + streak + '</b>';
    elOver.style.display = 'flex';
  }

  // ============ HUD ============
  function updateHud() {
    if (elScore) elScore.textContent = score;
    if (elStreak) elStreak.textContent = streak;
    if (elLives) elLives.textContent = lives > 0 ? '♥'.repeat(lives) : '✖';
  }

  function toast(msg, color) {
    if (!elToast) return;
    elToast.textContent = msg;
    elToast.style.color = color || '#fff';
    elToast.style.opacity = '1';
    elToast.style.transform = 'translate(-50%, -50%) scale(1)';
  }

  // ============ 粒子 ============
  function burst(x, y, color, n, spd) {
    for (var i = 0; i < n; i++) {
      var a = rand(0, Math.PI * 2), s = rand(0.3, 1) * spd;
      particles.push({
        x: x, y: y, vx: Math.cos(a) * s * 220, vy: Math.sin(a) * s * 220,
        life: 1, color: color, r: rand(2, 5)
      });
    }
  }

  // ============ 主循环 ============
  function start() {
    if (!canvas) init();
    resize();
    if (elOver) elOver.style.display = 'none';
    lives = 3; score = 0; streak = 0; round = 0;
    particles = []; shake.t = 0; cutFlash = 0;
    state = 'playing'; running = true;
    updateHud();
    playTitle();
    if (window.Sfx && window.Sfx.unlock) window.Sfx.unlock();
    lastT = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    state = 'idle';
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (elDanger) elDanger.style.opacity = '0';
  }

  function loop(t) {
    if (!running) return;
    var dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    time += dt;
    update(dt);
    render();
    rafId = requestAnimationFrame(loop);
  }

  function update(dt) {
    phaseT += dt;

    // 片头：星球飞入 + 冲击波，结束后进入回合
    if (phase === 'title') {
      titleT += dt;
      if (shockwave.t < TITLE_DUR) shockwave.t += dt;
      var tk = ease(clamp(titleT / TITLE_FLY, 0, 1));
      if (titleL) { titleL.x = lerp(-W * 0.18, W * 0.26, tk); titleL.alpha = tk; }
      if (titleR) { titleR.x = lerp(W * 1.18, W * 0.74, tk); titleR.alpha = tk; }
      if (titleT >= TITLE_DUR) newRound();
    }

    // 震屏衰减
    if (shake.t > 0) shake.t = Math.max(0, shake.t - dt);
    if (orangeFlash > 0) orangeFlash = Math.max(0, orangeFlash - dt * 2.2);
    if (cutFlash > 0) cutFlash = Math.max(0, cutFlash - dt * 3);

    // 待机轻微摇晃
    if (left) left.x = lerp(left.x, W * 0.30, 0.1);
    if (right) right.x = lerp(right.x, W * 0.70, 0.1);

    // 阶段推进
    if (phase === 'intro' && phaseT >= INTRO_DUR) phase = 'idle';
    if (phase === 'resolve' && phaseT >= RESOLVE_DUR) {
      phase = 'win'; phaseT = 0;
      var loser = loserSide === 'left' ? left : right;
      if (loser) burst(loser.x, loser.baseY, COL.orange || '#ff8a3c', 30, 1.3);
    }
    if (phase === 'win' && phaseT >= WIN_DUR) {
      finishRound();
      phaseT = 0;
    }

    // 激光进度
    if (laser.on) laser.p = Math.min(1, laser.p + dt * 3.5);

    // 粒子
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.96; p.vy *= 0.96;
      p.life -= dt * 1.6;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // 提示淡出
    if (elToast && phase === 'win' && phaseT > 0.6) {
      elToast.style.opacity = '0';
    }
  }

  // ============ 渲染 ============
  function render() {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 深空背景
    drawBackground();

    // 震屏偏移
    var sx = 0, sy = 0;
    if (shake.t > 0) { sx = rand(-1, 1) * shake.mag * (shake.t / 0.5); sy = rand(-1, 1) * shake.mag * (shake.t / 0.5); }
    ctx.save();
    ctx.translate(sx, sy);

    if (phase === 'title') {
      if (titleL) drawPlanet(titleL, titleL.x, titleL.baseY);
      if (titleR) drawPlanet(titleR, titleR.x, titleR.baseY);
      drawShockwave();
      drawTitle();
    } else if (phase === 'intro') {
      var k = ease(clamp(phaseT / INTRO_DUR, 0, 1));
      if (left) { left.alpha = k; drawPlanet(left, left.x, left.baseY); }
      if (right) { right.alpha = k; drawPlanet(right, right.x, right.baseY); }
    } else if (phase === 'idle') {
      drawPlanet(left, left.x, left.baseY);
      drawPlanet(right, right.x, right.baseY);
      drawVS();
    } else if (phase === 'resolve' || phase === 'win') {
      var loser = loserSide === 'left' ? left : right;
      var winner = winnerSide === 'left' ? left : right;

      // 激光（斜射）
      if (laser.on) drawLaser(loser);

      // 败者：随阶段碎裂消融
      var lp = clamp(phaseT / RESOLVE_DUR, 0, 1);
      if (loser) {
        loser.alpha = 1 - ease(clamp((phaseT - 0.35) / 0.5, 0, 1));
        if (loser.alpha > 0) drawPlanet(loser, loser.x, loser.baseY);
        if (phaseT > 0.3) drawX(loser, lp);
      }
      // 胜者：推近 + 桂冠
      if (winner) {
        var wp = phase === 'win' ? 1 : ease(clamp(phaseT / RESOLVE_DUR, 0, 1));
        var wr = winner.R * (1 + 0.06 * wp);
        winner.alpha = 1;
        drawPlanet(winner, winner.x, winner.baseY, wr);
        if (phaseT > 0.4) drawLaurel(winner, wp);
      }
    }

    // 粒子
    drawParticles();

    ctx.restore();

    // 橙光爆闪（败者位置）
    if (orangeFlash > 0 && loserSide) {
      var lz = loserSide === 'left' ? left : right;
      if (lz) {
        var g = ctx.createRadialGradient(lz.x, lz.baseY, 0, lz.x, lz.baseY, lz.R * 3);
        g.addColorStop(0, 'rgba(255,140,60,' + (orangeFlash * 0.7) + ')');
        g.addColorStop(1, 'rgba(255,140,60,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // 硬切白闪
    if (cutFlash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (cutFlash * 0.85) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05060f');
    g.addColorStop(0.5, '#0a0a18');
    g.addColorStop(1, '#05060f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 星点
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (var i = 0; i < 40; i++) {
      var x = (i * 97.3) % W;
      var y = (i * 53.7 + time * 8) % H;
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(time + i);
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlanet(p, x, y, R) {
    R = R || p.R;
    var a = p.alpha == null ? 1 : p.alpha;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;

    // 待机摇晃
    var bob = (phase === 'idle') ? Math.sin(time * 1.6 + p.phase) * 5 : 0;
    var cy = y + bob;

    // 球体
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, cy, R, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    var img = null;
    if (window.PKImageCache) {
      img = window.PKImageCache[p.body.id] || window.PKImageCache[p.body.name];
    }
    if (img && img.complete && img.naturalWidth) {
      // 用 cover 方式绘制
      var ir = Math.max(R * 2 / img.naturalWidth, R * 2 / img.naturalHeight);
      var dw = img.naturalWidth * ir, dh = img.naturalHeight * ir;
      ctx.drawImage(img, x - dw / 2, cy - dh / 2, dw, dh);
    } else {
      var gg = ctx.createRadialGradient(x - R * 0.35, cy - R * 0.35, R * 0.1, x, cy, R);
      var c = p.body.color || '#88aaff';
      gg.addColorStop(0, lighten(c, 40));
      gg.addColorStop(1, c);
      ctx.fillStyle = gg;
      ctx.fillRect(x - R, cy - R, R * 2, R * 2);
    }
    ctx.restore();

    // 边缘光
    ctx.beginPath();
    ctx.arc(x, cy, R, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();

    // 眼睛
    drawEyes(p, x, cy, R);

    // 名称（霓虹）
    var nameColor = p.side === 'left' ? COL.cyan : COL.red;
    ctx.globalAlpha = a;
    ctx.font = '600 ' + Math.round(R * 0.34) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = nameColor; ctx.shadowBlur = 14;
    ctx.fillStyle = nameColor;
    ctx.fillText(p.body.name, x, cy - R - R * 0.42);
    ctx.shadowBlur = 0;

    // 直径（PK 过程中先藏起来，玩家点完才揭晓答案）
    var showDiameter = (phase === 'resolve' || phase === 'win');
    if (showDiameter) {
      var dkm = Math.round(p.body.radius * 2).toLocaleString();
      ctx.font = '400 ' + Math.round(R * 0.20) + 'px sans-serif';
      ctx.fillStyle = 'rgba(200,210,240,0.85)';
      ctx.fillText('直径 ' + dkm + ' km', x, cy + R + R * 0.40);
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawEyes(p, x, cy, R) {
    var eyeDX = R * 0.40, eyeDY = -R * 0.06, er = R * 0.20;
    var LX = x - eyeDX, RX = x + eyeDX;       // 左右眼中心
    var glow = (p.eye === 'open') ? '#FF2D2D' : '#FFD23B';

    if (p.eye === 'closed') {
      // 邪恶怒视：内低外高的眯眼斜线
      ctx.strokeStyle = glow;
      ctx.shadowColor = glow; ctx.shadowBlur = 12;
      ctx.lineWidth = Math.max(3, R * 0.08);
      ctx.lineCap = 'round';
      // 左眼（外上 → 内下）
      ctx.beginPath();
      ctx.moveTo(LX - er * 0.85, cy + eyeDY - er * 0.55);
      ctx.lineTo(LX + er * 0.85, cy + eyeDY + er * 0.55);
      ctx.stroke();
      // 右眼（外上 → 内下）
      ctx.beginPath();
      ctx.moveTo(RX + er * 0.85, cy + eyeDY - er * 0.55);
      ctx.lineTo(RX - er * 0.85, cy + eyeDY + er * 0.55);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (p.eye === 'open') {
      // 发红光的狰狞眼睛 + 黑瞳 + 怒眉
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        var ex2 = x + s2 * eyeDX;
        ctx.fillStyle = glow;
        ctx.shadowColor = glow; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(ex2, cy + eyeDY, er, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#1a0000';
        ctx.beginPath(); ctx.arc(ex2, cy + eyeDY, er * 0.5, 0, Math.PI * 2); ctx.fill();
        // 细竖瞳（更邪）
        ctx.fillStyle = '#000';
        ctx.fillRect(ex2 - er * 0.10, cy + eyeDY - er * 0.6, er * 0.2, er * 1.2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(ex2 + s2 * er * 0.18, cy + eyeDY - er * 0.22, er * 0.14, 0, Math.PI * 2); ctx.fill();
      }
    }
    drawAngryBrows(LX, RX, cy, R, eyeDY, er);
    // 'x' 状态不在这里画眼睛（由 drawX 覆盖）
  }

  // 怒眉：内低外高，压在眼睛上方
  function drawAngryBrows(LX, RX, cy, R, eyeDY, er) {
    ctx.strokeStyle = 'rgba(15,8,25,0.92)';
    ctx.lineWidth = Math.max(3, R * 0.07);
    ctx.lineCap = 'round';
    var by = cy + eyeDY - er * 1.5;
    // 左眉：外(左,高) → 内(右,低)
    ctx.beginPath();
    ctx.moveTo(LX - er * 1.0, by - R * 0.06);
    ctx.lineTo(LX + er * 1.0, by + R * 0.07);
    ctx.stroke();
    // 右眉：外(右,高) → 内(左,低)
    ctx.beginPath();
    ctx.moveTo(RX + er * 1.0, by - R * 0.06);
    ctx.lineTo(RX - er * 1.0, by + R * 0.07);
    ctx.stroke();
  }

  function drawX(p, prog) {
    var x = p.x, y = p.baseY;
    var len = p.R * 1.5 * ease(clamp(prog, 0, 1));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.2);
    ctx.strokeStyle = COL.red;
    ctx.shadowColor = COL.red; ctx.shadowBlur = 18;
    ctx.lineWidth = Math.max(4, p.R * 0.16);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-len, -len); ctx.lineTo(len, len); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(len, -len); ctx.lineTo(-len, len); ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  function drawLaser(loser) {
    var x = loser.x, y = loser.baseY;
    var p = laser.p;
    var len = Math.hypot(x, y) * 1.1;
    var ex = x - len * p, ey = y - len * p;     // 从右上斜射向败者
    var sx0 = x + len, sy0 = y + len;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.shadowColor = COL.red; ctx.shadowBlur = 20;
    ctx.lineWidth = 3 + 5 * (1 - p);
    ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = COL.red;
    ctx.lineWidth = 1.5 + 3 * (1 - p);
    ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  function drawLaurel(winner, prog) {
    var x = winner.x, y = winner.baseY - winner.R - winner.R * 0.55;
    var r = winner.R * 0.5 * (0.4 + 0.6 * prog);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 1.2);
    ctx.strokeStyle = COL.gold;
    ctx.shadowColor = COL.gold; ctx.shadowBlur = 16;
    ctx.lineWidth = Math.max(3, winner.R * 0.06);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    // 射线
    for (var i = 0; i < 12; i++) {
      var ang = i / 12 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
      ctx.lineTo(Math.cos(ang) * (r + 8), Math.sin(ang) * (r + 8));
      ctx.stroke();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  function drawVS() {
    var x = W / 2, y = H * 0.48;
    var pulse = 1 + 0.08 * Math.sin(time * 4);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.font = '800 ' + Math.round(Math.min(W, H) * 0.12) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = COL.cyan; ctx.shadowBlur = 18;
    ctx.fillText('VS', 0, 0);
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  function drawTitle() {
    var cx = W / 2, ty = H * 0.32;
    var k = ease(clamp(titleT / 0.6, 0, 1));
    ctx.save();
    ctx.globalAlpha = k;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var fs = Math.round(Math.min(W, H) * 0.17);
    ctx.font = '900 ' + fs + 'px sans-serif';
    ctx.shadowColor = COL.cyan; ctx.shadowBlur = 26;
    ctx.fillStyle = '#fff';
    ctx.fillText('星球 PK', cx, ty + (1 - k) * 40);
    ctx.shadowBlur = 0;
    // 副标题
    ctx.globalAlpha = clamp((titleT - 0.35) / 0.4, 0, 1);
    ctx.font = '600 ' + Math.round(Math.min(W, H) * 0.05) + 'px sans-serif';
    ctx.fillStyle = 'rgba(180,210,255,0.92)';
    ctx.fillText('谁更大，谁就赢', cx, ty + fs * 0.95);
    ctx.globalAlpha = clamp((titleT - 0.8) / 0.5, 0, 1) * 0.7;
    ctx.font = '400 ' + Math.round(Math.min(W, H) * 0.038) + 'px sans-serif';
    ctx.fillStyle = 'rgba(150,170,210,0.9)';
    ctx.fillText('轻触屏幕开始', cx, ty + fs * 1.5);
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  function drawShockwave() {
    var prog = clamp(shockwave.t / 0.85, 0, 1);
    if (prog <= 0 || shockwave.t > TITLE_DUR) return;
    var r = prog * Math.min(W, H) * 0.72;
    ctx.save();
    ctx.globalAlpha = (1 - prog) * 0.6;
    ctx.strokeStyle = COL.cyan;
    ctx.lineWidth = 4 * (1 - prog) + 1;
    ctx.shadowColor = COL.cyan; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(W / 2, H * 0.60, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function lighten(hex, amt) {
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var n = parseInt(c, 16);
    var r = Math.min(255, (n >> 16) + amt);
    var g = Math.min(255, ((n >> 8) & 255) + amt);
    var b = Math.min(255, (n & 255) + amt);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  return { init, start, stop };
})();
