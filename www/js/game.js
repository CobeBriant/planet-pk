/**
 * 星球PK — 主游戏逻辑
 * 模式: PK对战 + 探索模式
 */

(function() {
  'use strict';

  // ========== 全局状态 ==========
  const STATE = {
    mode: 'menu',
    score: 0,
    combo: 0,
    maxCombo: 0,
    round: 0,
    correctCount: 0,
    totalRounds: 10,
    currentPair: null,
    answered: false,
  };

  // ========== 工具函数 ==========
  function $(id) { return document.getElementById(id); }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) { return arr.slice().sort(() => Math.random() - 0.5); }

  function formatNum(n) {
    if (n >= 1e42) return (n / 1e42).toFixed(1) + ' x 10^42 kg';
    if (n >= 1e30) return (n / 1e30).toFixed(2) + ' x 10^30 kg';
    if (n >= 1e24) return (n / 1e24).toFixed(2) + ' x 10^24 kg';
    if (n >= 1e20) return (n / 1e20).toFixed(2) + ' x 10^20 kg';
    if (n >= 1e15) return (n / 1e15).toFixed(1) + ' x 10^15 km';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' x 10^9 km';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' x 10^6 km';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + ' x 10^3 km';
    return n.toFixed(1) + ' km';
  }

  function formatRadius(r) {
    if (r >= 1e15) return (r / 9.461e12).toFixed(1) + ' 光年';
    if (r >= 1e9) return (r / 1e6).toFixed(1) + ' 百万 km';
    if (r >= 1e6) return (r / 1e3).toFixed(0) + ' 千 km';
    return r.toLocaleString() + ' km';
  }

  // 根据回合数选择天体池
  function getPoolForRound(round) {
    if (round < 4) {
      return CELESTIAL_DATA.filter(d => d.category === 'planet' || d.category === 'moon');
    } else if (round < 7) {
      return CELESTIAL_DATA.filter(d => d.category !== 'galaxy' && d.category !== 'blackhole');
    } else {
      return CELESTIAL_DATA.slice();
    }
  }

  // 选择一对天体（确保有差异但不至于太悬殊）
  function pickPair(round) {
    const pool = getPoolForRound(round);
    const shuffled = shuffle(pool);
    let a = shuffled[0];
    let b = shuffled[1];
    // 确保不是同一个天体
    if (a.id === b.id) b = shuffled[2] || shuffled[0];
    return { a, b };
  }

  // 计算渲染半径（对数缩放以适应屏幕）
  function getRenderRadius(realRadius, maxRealRadius, maxPixelRadius) {
    if (realRadius <= 0) return 4;
    const logR = Math.log10(realRadius);
    const logMax = Math.log10(maxRealRadius);
    const minLog = Math.log10(1000); // 最小1km
    const t = (logR - minLog) / (logMax - minLog);
    return Math.max(8, Math.min(maxPixelRadius, t * maxPixelRadius + 8));
  }

  // 绘制天体到canvas
  function drawCelestial(canvas, data, maxRadius) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const r = getRenderRadius(data.radius, maxRadius, Math.min(w, h) * 0.38);

    // 外发光
    const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.5);
    glowGrad.addColorStop(0, data.color + '60');
    glowGrad.addColorStop(1, data.color + '00');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // 主体
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
    grad.addColorStop(0, lightenColor(data.color, 30));
    grad.addColorStop(0.7, data.color);
    grad.addColorStop(1, darkenColor(data.color, 40));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // 边缘
    ctx.strokeStyle = darkenColor(data.color, 20);
    ctx.lineWidth = 1;
    ctx.stroke();

    // 土星环特殊处理
    if (data.id === 'saturn') {
      ctx.strokeStyle = '#D4A868';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.5, r * 0.35, -0.3, 0, Math.PI * 2);
      ctx.stroke();
    }

    return r;
  }

  function lightenColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, ((num >> 16) & 0xff) + percent);
    const g = Math.min(255, ((num >> 8) & 0xff) + percent);
    const b = Math.min(255, (num & 0xff) + percent);
    return `rgb(${r},${g},${b})`;
  }

  function darkenColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, ((num >> 16) & 0xff) - percent);
    const g = Math.max(0, ((num >> 8) & 0xff) - percent);
    const b = Math.max(0, (num & 0xff) - percent);
    return `rgb(${r},${g},${b})`;
  }

  // ========== 星空背景 ==========
  function initStarfield() {
    const canvas = $('starfield');
    const ctx = canvas.getContext('2d');
    let stars = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = [];
      const count = Math.floor((canvas.width * canvas.height) / 4000);
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.5 + 0.3,
          alpha: Math.random() * 0.8 + 0.2,
          speed: Math.random() * 0.02 + 0.005,
        });
      }
    }
    resize();
    window.addEventListener('resize', resize);

    function animate() {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const s of stars) {
        s.alpha += s.speed;
        if (s.alpha > 1 || s.alpha < 0.15) s.speed = -s.speed;
        ctx.fillStyle = `rgba(200, 220, 255, ${s.alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(animate);
    }
    animate();
  }

  // ========== 主菜单 ==========
  function showMenu() {
    STATE.mode = 'menu';
    hideAll();
    $('menu-screen').style.display = 'flex';
  }

  function hideAll() {
    $('menu-screen').style.display = 'none';
    $('pk-screen').style.display = 'none';
    $('explore-screen').style.display = 'none';
    $('gameover-screen').style.display = 'none';
    $('result-overlay').classList.remove('show');
  }

  // ========== PK 对战模式 ==========
  function startPK() {
    STATE.mode = 'pk';
    STATE.score = 0;
    STATE.combo = 0;
    STATE.maxCombo = 0;
    STATE.round = 0;
    STATE.correctCount = 0;
    hideAll();
    $('pk-screen').style.display = 'flex';
    nextRound();
  }

  function nextRound() {
    STATE.round++;
    if (STATE.round > STATE.totalRounds) {
      showGameOver();
      return;
    }

    STATE.answered = false;
    STATE.currentPair = pickPair(STATE.round);
    $('result-overlay').classList.remove('show');

    updateHUD();

    // 随机决定比较属性：大小或质量
    const compareType = Math.random() < 0.5 ? 'radius' : 'mass';
    STATE.currentPair.compareType = compareType;

    const questionText = compareType === 'radius' ? '更大' : '更重';
    $('pk-question').innerHTML = `哪个天体<span class="highlight">${questionText}</span>？`;

    // 绘制两侧天体
    const pair = STATE.currentPair;
    const maxR = Math.max(pair.a.radius, pair.b.radius);

    const canvasA = $('pk-canvas-a');
    const canvasB = $('pk-canvas-b');
    setupCanvas(canvasA);
    setupCanvas(canvasB);

    drawCelestial(canvasA, pair.a, maxR);
    drawCelestial(canvasB, pair.b, maxR);

    // 显示名字（PK模式中显示名字）
    $('pk-name-a').textContent = pair.a.name;
    $('pk-name-b').textContent = pair.b.name;

    // 重置按钮
    const btnA = $('pk-btn-a');
    const btnB = $('pk-btn-b');
    btnA.className = 'pk-choice-btn';
    btnB.className = 'pk-choice-btn';
    btnA.textContent = '← ' + pair.a.name;
    btnB.textContent = pair.b.name + ' →';
  }

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(window.innerWidth * 0.4, 180);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    canvas._cssWidth = size;
    canvas._cssHeight = size;
  }

  function answer(side) {
    if (STATE.answered) return;
    STATE.answered = true;

    const pair = STATE.currentPair;
    const prop = pair.compareType;
    const aVal = pair.a[prop];
    const bVal = pair.b[prop];

    const correctSide = aVal > bVal ? 'a' : 'b';
    const isCorrect = side === correctSide;

    const btnA = $('pk-btn-a');
    const btnB = $('pk-btn-b');

    if (correctSide === 'a') {
      btnA.classList.add('correct');
      btnB.classList.add('wrong');
    } else {
      btnB.classList.add('correct');
      btnA.classList.add('wrong');
    }

    if (isCorrect) {
      STATE.combo++;
      STATE.maxCombo = Math.max(STATE.maxCombo, STATE.combo);
      const points = 10 + STATE.combo * 5;
      STATE.score += points;
      STATE.correctCount++;
    } else {
      STATE.combo = 0;
    }

    updateHUD();

    // 显示结果
    setTimeout(() => showResult(isCorrect, pair, prop), 600);
  }

  function showResult(isCorrect, pair, prop) {
    const overlay = $('result-overlay');
    const winner = pair.a[prop] > pair.b[prop] ? pair.a : pair.b;
    const loser = pair.a[prop] > pair.b[prop] ? pair.b : pair.a;
    const ratio = winner[prop] / loser[prop];

    let ratioText;
    if (ratio > 1000) {
      ratioText = (ratio / 1).toExponential(1) + ' 倍';
    } else if (ratio > 10) {
      ratioText = ratio.toFixed(0) + ' 倍';
    } else {
      ratioText = ratio.toFixed(1) + ' 倍';
    }

    const propText = prop === 'radius' ? '半径' : '质量';

    $('result-text').textContent = isCorrect ? '答对了！' : '答错了';
    $('result-text').className = 'result-text ' + (isCorrect ? 'correct' : 'wrong');

    $('result-desc').innerHTML =
      `<b style="color:${winner.color}">${winner.name}</b> 的${propText}是 <b style="color:${loser.color}">${loser.name}</b> 的 <span style="color:#6CF;font-size:18px;font-weight:700">${ratioText}</span><br><br>` +
      `${winner.name}: ${formatRadius(winner.radius)}<br>` +
      `${loser.name}: ${formatRadius(loser.radius)}<br><br>` +
      `<span style="font-size:13px;color:rgba(160,180,220,0.7)">${winner.desc}</span>`;

    // 绘制对比图
    drawResultComparison(winner, loser);

    overlay.classList.add('show');

    if (isCorrect) {
      $('result-text').classList.add('pop-in');
    } else {
      $('pk-screen').classList.add('shake');
      setTimeout(() => $('pk-screen').classList.remove('shake'), 300);
    }
  }

  function drawResultComparison(winner, loser) {
    const canvas = $('result-comparison-canvas');
    const dpr = window.devicePixelRatio || 1;
    const w = 300;
    const h = 120;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const maxR = Math.max(winner.radius, loser.radius);
    const maxPx = 45;
    const rWinner = getRenderRadius(winner.radius, maxR, maxPx);
    const rLoser = getRenderRadius(loser.radius, maxR, maxPx);

    // 左侧 - 赢家
    drawCircle(ctx, 60, 60, rWinner, winner.color);
    ctx.fillStyle = 'rgba(200,220,255,0.7)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(winner.name, 60, 110);

    // 右侧 - 输家
    drawCircle(ctx, 220, 60, rLoser, loser.color);
    ctx.fillText(loser.name, 220, 110);
  }

  function drawCircle(ctx, cx, cy, r, color) {
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
    grad.addColorStop(0, lightenColor(color, 30));
    grad.addColorStop(1, darkenColor(color, 30));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function showGameOver() {
    STATE.mode = 'gameover';
    hideAll();
    $('gameover-screen').style.display = 'flex';

    const accuracy = ((STATE.correctCount / STATE.totalRounds) * 100).toFixed(0);
    $('gameover-score').textContent = STATE.score;
    $('gameover-stats').innerHTML =
      `答对 ${STATE.correctCount} / ${STATE.totalRounds} 题<br>` +
      `正确率 ${accuracy}%<br>` +
      `最高连击 ${STATE.maxCombo} 连击`;

    let title = '继续努力！';
    if (STATE.correctCount === STATE.totalRounds) title = '宇宙大师！';
    else if (STATE.correctCount >= 8) title = '星空学者！';
    else if (STATE.correctCount >= 6) title = '太空探险家！';
    $('gameover-title').textContent = title;
  }

  function updateHUD() {
    $('score-value').textContent = STATE.score;
    const comboEl = $('combo-badge');
    if (STATE.combo > 1) {
      comboEl.textContent = STATE.combo + '连击';
      comboEl.style.display = 'inline-block';
    } else {
      comboEl.style.display = 'none';
    }
    $('round-info').textContent = `第 ${STATE.round} / ${STATE.totalRounds} 题`;
  }

  // ========== 探索模式 ==========
  let exploreState = {
    index: 0,
    sortedData: [],
    dragStartY: 0,
    offsetY: 0,
    targetOffsetY: 0,
  };

  function startExplore() {
    STATE.mode = 'explore';
    hideAll();
    $('explore-screen').style.display = 'block';

    // 按大小排序
    exploreState.sortedData = CELESTIAL_DATA.slice().sort((a, b) => a.radius - b.radius);
    exploreState.index = Math.floor(exploreState.sortedData.length / 2);
    exploreState.offsetY = 0;
    exploreState.targetOffsetY = 0;

    renderExplore();
    $('explore-scale-hint').textContent = '上下滑动探索宇宙尺度';
  }

  function renderExplore() {
    const canvas = $('explore-canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // 绘制周围的天体（模糊）
    const data = exploreState.sortedData;
    const currentData = data[exploreState.index];

    // 计算当前天体的渲染半径
    const maxR = Math.min(w, h) * 0.3;
    const renderR = getRenderRadius(currentData.radius, data[data.length - 1].radius, maxR);

    // 当前天体
    const cy = h / 2;
    drawCircle(ctx, cx, cy, renderR, currentData.color);

    // 发光
    const glowGrad = ctx.createRadialGradient(cx, cy, renderR * 0.8, cx, cy, renderR * 2);
    glowGrad.addColorStop(0, currentData.color + '40');
    glowGrad.addColorStop(1, currentData.color + '00');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, renderR * 2, 0, Math.PI * 2);
    ctx.fill();

    // 重新画主体
    drawCircle(ctx, cx, cy, renderR, currentData.color);

    // 土星环
    if (currentData.id === 'saturn') {
      ctx.strokeStyle = '#D4A868';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, renderR * 1.5, renderR * 0.35, -0.3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 名字
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(currentData.name, cx, cy + renderR + 40);

    ctx.fillStyle = 'rgba(160, 180, 220, 0.5)';
    ctx.font = '12px sans-serif';
    ctx.fillText(currentData.nameEn, cx, cy + renderR + 60);

    ctx.fillStyle = 'rgba(100, 200, 255, 0.6)';
    ctx.font = '13px sans-serif';
    ctx.fillText(formatRadius(currentData.radius), cx, cy + renderR + 80);

    // 上一个/下一个提示
    if (exploreState.index > 0) {
      const prev = data[exploreState.index - 1];
      ctx.fillStyle = 'rgba(160, 180, 220, 0.3)';
      ctx.font = '13px sans-serif';
      ctx.fillText('↑ ' + prev.name, cx, 80);
    }
    if (exploreState.index < data.length - 1) {
      const next = data[exploreState.index + 1];
      ctx.fillStyle = 'rgba(160, 180, 220, 0.3)';
      ctx.font = '13px sans-serif';
      ctx.fillText('↓ ' + next.name, cx, h - 140);
    }

    // 刻度指示
    const totalSteps = data.length;
    const progress = exploreState.index / (totalSteps - 1);
    const barH = h - 200;
    const barY = 100;
    ctx.strokeStyle = 'rgba(100, 130, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w - 30, barY);
    ctx.lineTo(w - 30, barY + barH);
    ctx.stroke();

    ctx.fillStyle = '#6CF';
    ctx.beginPath();
    ctx.arc(w - 30, barY + barH * progress, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function showExploreInfo() {
    const data = exploreState.sortedData[exploreState.index];
    const typeMap = {
      planet: '行星 / 矮行星',
      moon: '卫星',
      star: '恒星',
      galaxy: '星系',
      blackhole: '黑洞',
    };

    $('explore-info-name').textContent = data.name;
    $('explore-info-type').textContent = typeMap[data.category] || '天体';
    $('explore-info-desc').textContent = data.desc;
    $('explore-stat-radius').textContent = formatRadius(data.radius);
    $('explore-stat-mass').textContent = formatNum(data.mass);
    $('explore-info').classList.add('show');
  }

  function hideExploreInfo() {
    $('explore-info').classList.remove('show');
  }

  // 探索模式触摸事件
  function initExploreTouch() {
    const canvas = $('explore-canvas');
    let startY = 0;
    let isDragging = false;

    canvas.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      isDragging = true;
      hideExploreInfo();
    });

    canvas.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const dy = e.touches[0].clientY - startY;
      if (Math.abs(dy) > 60) {
        if (dy < 0 && exploreState.index < exploreState.sortedData.length - 1) {
          exploreState.index++;
          renderExplore();
          startY = e.touches[0].clientY;
        } else if (dy > 0 && exploreState.index > 0) {
          exploreState.index--;
          renderExplore();
          startY = e.touches[0].clientY;
        }
      }
    });

    canvas.addEventListener('touchend', () => {
      isDragging = false;
    });

    // 点击查看详情
    canvas.addEventListener('click', () => {
      showExploreInfo();
    });

    // 鼠标滚轮（桌面调试）
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY > 0 && exploreState.index < exploreState.sortedData.length - 1) {
        exploreState.index++;
      } else if (e.deltaY < 0 && exploreState.index > 0) {
        exploreState.index--;
      }
      renderExplore();
    });
  }

  // ========== 初始化 ==========
  function init() {
    initStarfield();

    // 菜单按钮
    $('btn-pk').addEventListener('click', startPK);
    $('btn-explore').addEventListener('click', startExplore);

    // PK按钮
    $('pk-btn-a').addEventListener('click', () => answer('a'));
    $('pk-btn-b').addEventListener('click', () => answer('b'));

    // 结果"下一题"按钮
    $('result-next-btn').addEventListener('click', nextRound);

    // 游戏结束按钮
    $('btn-replay').addEventListener('click', startPK);
    $('btn-menu').addEventListener('click', showMenu);

    // 返回按钮
    $('btn-back-pk').addEventListener('click', showMenu);
    $('btn-back-explore').addEventListener('click', showMenu);

    // 探索模式
    initExploreTouch();
    $('explore-info-close').addEventListener('click', hideExploreInfo);

    // 窗口大小变化
    window.addEventListener('resize', () => {
      if (STATE.mode === 'pk' && STATE.currentPair) {
        const canvasA = $('pk-canvas-a');
        const canvasB = $('pk-canvas-b');
        setupCanvas(canvasA);
        setupCanvas(canvasB);
        const maxR = Math.max(STATE.currentPair.a.radius, STATE.currentPair.b.radius);
        drawCelestial(canvasA, STATE.currentPair.a, maxR);
        drawCelestial(canvasB, STATE.currentPair.b, maxR);
      } else if (STATE.mode === 'explore') {
        renderExplore();
      }
    });

    showMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
