/**
 * 星球PK — 主游戏逻辑 V4
 * 使用真实天体纹理图片 + 程序化 fallback
 * 增强 PK 动效 + 粒子特效
 * 支持自定义天体（我的星系）
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
    totalRounds: 15,
    currentPair: null,
    answered: false,
    pkAnimation: null,
    imagesLoaded: false,
    particles: [],
    autoNextTimer: null,
    resultShown: false,
  };

  const CUSTOM_KEY = 'planet_pk_custom_bodies';
  let CUSTOM_BODIES = [];
  let editingCustomId = null;
  let pendingCustomPhoto = null;

  // ========== 工具函数 ==========
  function $(id) { return document.getElementById(id); }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) { return arr.slice().sort(() => Math.random() - 0.5); }

  function hashCode(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function formatNum(n) {
    if (n >= 1e42) return (n / 1e42).toFixed(1) + ' x10^42 kg';
    if (n >= 1e30) return (n / 1e30).toFixed(2) + ' x10^30 kg';
    if (n >= 1e24) return (n / 1e24).toFixed(2) + ' x10^24 kg';
    if (n >= 1e20) return (n / 1e20).toFixed(2) + ' x10^20 kg';
    if (n >= 1e15) return (n / 1e15).toFixed(1) + ' x10^15 km';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' x10^9 km';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' x10^6 km';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + ' x10^3 km';
    return n.toFixed(1) + ' km';
  }

  function formatRadius(r) {
    if (r >= 9.461e12) return (r / 9.461e12).toFixed(1) + ' 光年';
    if (r >= 1e9) return (r / 1e6).toFixed(1) + ' 百万 km';
    if (r >= 1e6) return (r / 1e3).toFixed(0) + ' 千 km';
    return r.toLocaleString() + ' km';
  }

  function parseNumberInput(val) {
    if (!val) return 0;
    val = String(val).trim().replace(/,/g, '');
    if (val.indexOf('e') !== -1 || val.indexOf('E') !== -1) {
      return parseFloat(val);
    }
    return parseFloat(val);
  }

  // ========== 自定义天体持久化 ==========
  function loadCustomBodies() {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY);
      if (raw) {
        CUSTOM_BODIES = JSON.parse(raw);
      }
    } catch (e) {
      CUSTOM_BODIES = [];
    }
    if (!Array.isArray(CUSTOM_BODIES)) CUSTOM_BODIES = [];
    // 给每个自定义天体补齐字段
    CUSTOM_BODIES.forEach(b => {
      b.isCustom = true;
      if (!b.style) b.style = { type: guessStyleType(b.category) };
      if (!b.color) b.color = '#6CF';
      if (!b.nameEn) b.nameEn = b.name;
    });
  }

  function saveCustomBodies() {
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(CUSTOM_BODIES));
    } catch (e) {
      alert('保存失败，可能是照片太大。建议压缩图片后重试。');
    }
  }

  function guessStyleType(category) {
    switch (category) {
      case 'planet': return 'rocky';
      case 'moon': return 'rocky';
      case 'star': return 'star';
      case 'galaxy': return 'galaxy';
      case 'blackhole': return 'blackhole';
      case 'dwarf': return 'rocky';
      default: return 'rocky';
    }
  }

  function getAllBodies() {
    return CELESTIAL_DATA.concat(CUSTOM_BODIES);
  }

  // ========== 图片加载系统 ==========
  const imageCache = {};
  // 暴露给 arcade.js / planetpk.js 复用（避免重复加载）
  window.PKImageCache = imageCache;
  // 暴露给 planetpk.js：获取自定义天体数组（始终为最新引用）
  window.getCustomBodies = function () { return CUSTOM_BODIES; };
  // 暴露给 planetpk.js：返回主菜单
  window.__showMenu = showMenu;

  function preloadImages(callback) {
    const bodiesWithImages = getAllBodies().filter(b => b.image && !b.isCustom);
    let loaded = 0;
    const total = bodiesWithImages.length;

    if (total === 0) {
      STATE.imagesLoaded = true;
      callback();
      return;
    }

    bodiesWithImages.forEach(body => {
      const img = new Image();
      img.onload = () => {
        imageCache[body.id] = img;
        loaded++;
        if (loaded >= total) {
          STATE.imagesLoaded = true;
          callback();
        }
      };
      img.onerror = () => {
        loaded++;
        if (loaded >= total) {
          STATE.imagesLoaded = true;
          callback();
        }
      };
      img.src = 'assets/images/' + body.image;
    });

    // Also load ring image
    const ringImg = new Image();
    ringImg.onload = () => { imageCache['saturn_ring'] = ringImg; };
    ringImg.src = 'assets/images/saturn_ring.png';
  }

  // ========== 天体池与配对 ==========
  function getPoolForRound(round) {
    const all = getAllBodies();
    if (round <= 4) {
      return all.filter(d => d.category === 'planet' || d.category === 'dwarf' || d.category === 'moon' || d.category === 'other');
    } else if (round <= 9) {
      return all.filter(d => d.category !== 'galaxy' && d.category !== 'blackhole');
    }
    return all.slice();
  }

  function pickPair(round) {
    const pool = getPoolForRound(round);
    const shuffled = shuffle(pool);
    let a = shuffled[0];
    let b = shuffled[1];
    if (!a) a = getAllBodies()[0];
    if (!b) b = getAllBodies()[1] || a;
    if (a.id === b.id) b = shuffled[2] || shuffled[0] || getAllBodies()[1] || a;
    return { a, b };
  }

  function isRinged(body) {
    return !!(body.style && body.style.ring);
  }

  // ========== 颜色工具 ==========
  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function lighten(hex, p) {
    const c = hexToRgb(hex);
    return rgbToHex(c.r + p, c.g + p, c.b + p);
  }
  function darken(hex, p) {
    const c = hexToRgb(hex);
    return rgbToHex(c.r - p, c.g - p, c.b - p);
  }

  function radialSphere(ctx, cx, cy, r, color) {
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx, cy, r);
    g.addColorStop(0, lighten(color, 50));
    g.addColorStop(0.5, color);
    g.addColorStop(1, darken(color, 60));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ========== 精灵生成 ==========
  const SPRITE_SIZE = 256;
  const SPRITE_R = 96;
  const SPRITE_C = SPRITE_SIZE / 2;
  const spriteCache = {};

  function getSprite(body) {
    if (!spriteCache[body.id]) {
      if (body.image && imageCache[body.id]) {
        spriteCache[body.id] = generateTextureSprite(body);
      } else if (body.isCustom && body.customImage) {
        spriteCache[body.id] = generateCustomSprite(body);
      } else {
        spriteCache[body.id] = generateProceduralSprite(body);
      }
    }
    return spriteCache[body.id];
  }

  function invalidateSprite(id) {
    delete spriteCache[id];
  }

  // ---- 真实纹理精灵 ----
  function generateTextureSprite(body) {
    const c = document.createElement('canvas');
    c.width = SPRITE_SIZE;
    c.height = SPRITE_SIZE;
    const ctx = c.getContext('2d');
    const img = imageCache[body.id];
    const r = SPRITE_R;

    if (isRinged(body) && imageCache['saturn_ring']) {
      drawRingBack(ctx, SPRITE_C, SPRITE_C, r);
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(SPRITE_C, SPRITE_C, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.drawImage(img, SPRITE_C - r, SPRITE_C - r, r * 2, r * 2);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(SPRITE_C, SPRITE_C, r, 0, Math.PI * 2);
    ctx.clip();

    const shade = ctx.createRadialGradient(
      SPRITE_C - r * 0.4, SPRITE_C - r * 0.4, r * 0.1,
      SPRITE_C, SPRITE_C, r * 1.1
    );
    shade.addColorStop(0, 'rgba(255,255,255,0.18)');
    shade.addColorStop(0.5, 'rgba(255,255,255,0)');
    shade.addColorStop(0.8, 'rgba(0,0,0,0.25)');
    shade.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = shade;
    ctx.fillRect(SPRITE_C - r, SPRITE_C - r, r * 2, r * 2);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(SPRITE_C, SPRITE_C, r, 0, Math.PI * 2);
    ctx.clip();
    const edge = ctx.createRadialGradient(SPRITE_C, SPRITE_C, r * 0.85, SPRITE_C, SPRITE_C, r);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = edge;
    ctx.fillRect(SPRITE_C - r, SPRITE_C - r, r * 2, r * 2);
    ctx.restore();

    if (body.id === 'sun') {
      const corona = ctx.createRadialGradient(SPRITE_C, SPRITE_C, r * 0.7, SPRITE_C, SPRITE_C, r * 1.5);
      corona.addColorStop(0, 'rgba(255,200,50,0.3)');
      corona.addColorStop(0.5, 'rgba(255,140,30,0.1)');
      corona.addColorStop(1, 'rgba(255,100,20,0)');
      ctx.fillStyle = corona;
      ctx.beginPath();
      ctx.arc(SPRITE_C, SPRITE_C, r * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (isRinged(body) && imageCache['saturn_ring']) {
      drawRingFront(ctx, SPRITE_C, SPRITE_C, r);
    }

    return c;
  }

  // ---- 自定义照片精灵 ----
  function generateCustomSprite(body) {
    const c = document.createElement('canvas');
    c.width = SPRITE_SIZE;
    c.height = SPRITE_SIZE;
    const ctx = c.getContext('2d');
    const img = body.customImage ? imageCache[body.id] : null;
    const r = SPRITE_R;

    ctx.save();
    ctx.beginPath();
    ctx.arc(SPRITE_C, SPRITE_C, r, 0, Math.PI * 2);
    ctx.clip();

    if (img) {
      const aspect = img.width / img.height;
      let sw, sh, sx, sy;
      if (aspect > 1) {
        sh = img.height;
        sw = img.height;
        sx = (img.width - sw) / 2;
        sy = 0;
      } else {
        sw = img.width;
        sh = img.width;
        sx = 0;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, SPRITE_C - r, SPRITE_C - r, r * 2, r * 2);
    } else {
      radialSphere(ctx, SPRITE_C, SPRITE_C, r, body.color || '#6CF');
    }
    ctx.restore();

    // 3D 球体着色
    ctx.save();
    ctx.beginPath();
    ctx.arc(SPRITE_C, SPRITE_C, r, 0, Math.PI * 2);
    ctx.clip();
    const shade = ctx.createRadialGradient(
      SPRITE_C - r * 0.4, SPRITE_C - r * 0.4, r * 0.1,
      SPRITE_C, SPRITE_C, r * 1.1
    );
    shade.addColorStop(0, 'rgba(255,255,255,0.15)');
    shade.addColorStop(0.5, 'rgba(255,255,255,0)');
    shade.addColorStop(0.8, 'rgba(0,0,0,0.2)');
    shade.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = shade;
    ctx.fillRect(SPRITE_C - r, SPRITE_C - r, r * 2, r * 2);
    ctx.restore();

    // 自定义标识小圆点
    ctx.fillStyle = '#6CF';
    ctx.beginPath();
    ctx.arc(SPRITE_C + r * 0.65, SPRITE_C - r * 0.65, 6, 0, Math.PI * 2);
    ctx.fill();

    return c;
  }

  // ---- 土星环渲染 ----
  function drawRingBack(ctx, cx, cy, r) {
    const ringImg = imageCache['saturn_ring'];
    if (!ringImg) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.3);
    ctx.beginPath();
    ctx.rect(-SPRITE_SIZE, -SPRITE_SIZE, SPRITE_SIZE * 2, SPRITE_SIZE);
    ctx.clip();
    const rw = r * 2.3;
    const rh = r * 0.6;
    ctx.drawImage(ringImg, -rw / 2, -rh / 2, rw, rh);
    ctx.restore();
  }

  function drawRingFront(ctx, cx, cy, r) {
    const ringImg = imageCache['saturn_ring'];
    if (!ringImg) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.3);
    ctx.beginPath();
    ctx.rect(-SPRITE_SIZE, 0, SPRITE_SIZE * 2, SPRITE_SIZE);
    ctx.clip();
    const rw = r * 2.3;
    const rh = r * 0.6;
    ctx.drawImage(ringImg, -rw / 2, -rh / 2, rw, rh);
    ctx.restore();
  }

  // ---- 程序化精灵 (fallback) ----
  function generateProceduralSprite(body) {
    const c = document.createElement('canvas');
    c.width = SPRITE_SIZE;
    c.height = SPRITE_SIZE;
    const ctx = c.getContext('2d');
    const rng = mulberry32(hashCode(body.id));
    const style = body.style || {};

    ctx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);

    if (style.ring) {
      drawProceduralRing(ctx, SPRITE_C, SPRITE_C, SPRITE_R, body.color);
    }

    switch (style.type) {
      case 'rocky': drawRocky(ctx, body, rng); break;
      case 'cloudy': drawCloudy(ctx, body, rng); break;
      case 'earth': drawEarth(ctx, body, rng); break;
      case 'gas': drawGas(ctx, body, rng); break;
      case 'ice': drawIce(ctx, body, rng); break;
      case 'hazy': drawHazy(ctx, body, rng); break;
      case 'icy': drawIcy(ctx, body, rng); break;
      case 'sun': drawSun(ctx, body, rng); break;
      case 'star': drawStar(ctx, body, rng); break;
      case 'galaxy': drawGalaxy(ctx, body, rng); break;
      case 'blackhole': drawBlackHole(ctx, body, rng); break;
      default: drawRocky(ctx, body, rng);
    }

    return c;
  }

  function drawProceduralRing(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.25);
    const grad = ctx.createLinearGradient(-r * 1.7, 0, r * 1.7, 0);
    grad.addColorStop(0, 'rgba(200,170,120,0)');
    grad.addColorStop(0.15, 'rgba(200,170,120,0.55)');
    grad.addColorStop(0.4, 'rgba(220,190,140,0.25)');
    grad.addColorStop(0.6, 'rgba(200,170,120,0.55)');
    grad.addColorStop(1, 'rgba(200,170,120,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = r * 0.18;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.7, r * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawRocky(ctx, body, rng) {
    radialSphere(ctx, SPRITE_C, SPRITE_C, SPRITE_R, body.color);
    const nCraters = randInt(6, 14);
    for (let i = 0; i < nCraters; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * SPRITE_R * 0.85;
      const x = SPRITE_C + Math.cos(a) * d;
      const y = SPRITE_C + Math.sin(a) * d;
      const r = 3 + rng() * 10;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r + 1, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (body.style && body.style.heart) {
      ctx.fillStyle = 'rgba(180,120,120,0.35)';
      ctx.beginPath();
      const x = SPRITE_C - 18, y = SPRITE_C + 8;
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - 15, y - 15, x - 25, y + 10, x, y + 28);
      ctx.bezierCurveTo(x + 25, y + 10, x + 15, y - 15, x, y);
      ctx.fill();
    }
  }

  function drawCloudy(ctx, body, rng) {
    radialSphere(ctx, SPRITE_C, SPRITE_C, SPRITE_R, body.color);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 8; i++) {
      const y = SPRITE_C - SPRITE_R + rng() * SPRITE_R * 2;
      const h = 5 + rng() * 18;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.15 + rng() * 0.15) + ')';
      ctx.beginPath();
      ctx.ellipse(SPRITE_C + (rng() - 0.5) * 60, y, SPRITE_R * (0.7 + rng() * 0.3), h, (rng() - 0.5) * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEarth(ctx, body, rng) {
    radialSphere(ctx, SPRITE_C, SPRITE_C, SPRITE_R, '#1E5B8C');
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const continents = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < continents; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * SPRITE_R * 0.7;
      const x = SPRITE_C + Math.cos(a) * d;
      const y = SPRITE_C + Math.sin(a) * d;
      const size = 18 + rng() * 22;
      const g = ctx.createRadialGradient(x - size * 0.3, y - size * 0.3, 2, x, y, size);
      g.addColorStop(0, '#4CAF50');
      g.addColorStop(0.6, '#2E7D32');
      g.addColorStop(1, 'rgba(46,125,50,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * SPRITE_R * 0.8;
      ctx.beginPath();
      ctx.ellipse(SPRITE_C + Math.cos(a) * d, SPRITE_C + Math.sin(a) * d, 12 + rng() * 10, 5 + rng() * 4, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGas(ctx, body, rng) {
    radialSphere(ctx, SPRITE_C, SPRITE_C, SPRITE_R, body.color);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const bands = 7 + Math.floor(rng() * 4);
    const step = (SPRITE_R * 2) / bands;
    for (let i = 0; i < bands; i++) {
      const y = SPRITE_C - SPRITE_R + i * step;
      const isDark = i % 2 === 0;
      ctx.fillStyle = isDark ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.12)';
      ctx.fillRect(SPRITE_C - SPRITE_R, y, SPRITE_R * 2, step * 0.85);
    }
    if (body.style && body.style.spot) {
      ctx.fillStyle = 'rgba(180,60,40,0.65)';
      ctx.beginPath();
      ctx.ellipse(SPRITE_C + 32, SPRITE_C + 12, 26, 16, -0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawIce(ctx, body, rng) {
    radialSphere(ctx, SPRITE_C, SPRITE_C, SPRITE_R, body.color);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 5; i++) {
      const y = SPRITE_C - SPRITE_R + (i + 0.5) * (SPRITE_R * 2 / 5);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.1 + rng() * 0.1) + ')';
      ctx.fillRect(SPRITE_C - SPRITE_R, y, SPRITE_R * 2, 4 + rng() * 8);
    }
    if (body.style && body.style.storm) {
      ctx.fillStyle = 'rgba(30,40,120,0.5)';
      ctx.beginPath();
      ctx.ellipse(SPRITE_C - 28, SPRITE_C - 10, 18, 12, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHazy(ctx, body, rng) {
    radialSphere(ctx, SPRITE_C, SPRITE_C, SPRITE_R, body.color);
    const g = ctx.createRadialGradient(SPRITE_C, SPRITE_C, SPRITE_R * 0.7, SPRITE_C, SPRITE_C, SPRITE_R * 1.25);
    g.addColorStop(0, 'rgba(255,180,80,0)');
    g.addColorStop(0.7, 'rgba(255,180,80,0.25)');
    g.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(SPRITE_C, SPRITE_C, SPRITE_R * 1.25, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawIcy(ctx, body, rng) {
    radialSphere(ctx, SPRITE_C, SPRITE_C, SPRITE_R, body.color);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = 'rgba(80,140,180,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2;
      const d1 = rng() * SPRITE_R * 0.3;
      const d2 = d1 + 20 + rng() * 35;
      ctx.beginPath();
      ctx.moveTo(SPRITE_C + Math.cos(a) * d1, SPRITE_C + Math.sin(a) * d1);
      ctx.lineTo(SPRITE_C + Math.cos(a) * d2, SPRITE_C + Math.sin(a) * d2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSun(ctx, body, rng) {
    const corona = ctx.createRadialGradient(SPRITE_C, SPRITE_C, SPRITE_R * 0.6, SPRITE_C, SPRITE_C, SPRITE_R * 1.35);
    corona.addColorStop(0, 'rgba(255,200,50,0.35)');
    corona.addColorStop(0.5, 'rgba(255,140,30,0.12)');
    corona.addColorStop(1, 'rgba(255,100,20,0)');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(SPRITE_C, SPRITE_C, SPRITE_R * 1.35, 0, Math.PI * 2);
    ctx.fill();
    radialSphere(ctx, SPRITE_C, SPRITE_C, SPRITE_R, '#FFD700');
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 12; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * SPRITE_R * 0.8;
      const r = 4 + rng() * 10;
      ctx.fillStyle = 'rgba(255,255,180,' + (0.15 + rng() * 0.2) + ')';
      ctx.beginPath();
      ctx.arc(SPRITE_C + Math.cos(a) * d, SPRITE_C + Math.sin(a) * d, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStar(ctx, body, rng) {
    const spikes = 12;
    ctx.save();
    ctx.translate(SPRITE_C, SPRITE_C);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, SPRITE_R * 1.3);
    g.addColorStop(0, body.color + 'AA');
    g.addColorStop(0.4, body.color + '44');
    g.addColorStop(1, body.color + '00');
    ctx.fillStyle = g;
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? SPRITE_R * 1.25 : SPRITE_R * 0.55;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    radialSphere(ctx, SPRITE_C, SPRITE_C, SPRITE_R * 0.9, body.color);
  }

  function drawGalaxy(ctx, body, rng) {
    ctx.save();
    ctx.translate(SPRITE_C, SPRITE_C);
    ctx.rotate(rng() * Math.PI);
    const g = ctx.createRadialGradient(0, 0, 5, 0, 0, SPRITE_R * 1.1);
    g.addColorStop(0, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.2, body.color + 'CC');
    g.addColorStop(0.7, body.color + '55');
    g.addColorStop(1, body.color + '00');
    ctx.fillStyle = g;
    if (body.style && body.style.irregular) {
      ctx.beginPath();
      ctx.ellipse(0, 0, SPRITE_R * 1.0, SPRITE_R * 0.7, rng() * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (body.style && body.style.elliptical) {
      ctx.beginPath();
      ctx.ellipse(0, 0, SPRITE_R * 1.05, SPRITE_R * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(0, 0, SPRITE_R * 0.95, SPRITE_R * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      const arms = 2;
      ctx.strokeStyle = body.color;
      ctx.lineWidth = SPRITE_R * 0.18;
      ctx.lineCap = 'round';
      for (let arm = 0; arm < arms; arm++) {
        ctx.beginPath();
        for (let t = 0; t < 25; t++) {
          const angle = arm * Math.PI + t * 0.22;
          const rr = 10 + t * 3.5;
          const x = Math.cos(angle) * rr;
          const y = Math.sin(angle) * rr * 0.45;
          if (t === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    const core = ctx.createRadialGradient(0, 0, 2, 0, 0, SPRITE_R * 0.25);
    core.addColorStop(0, 'rgba(255,255,230,0.9)');
    core.addColorStop(1, 'rgba(255,255,230,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, SPRITE_R * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBlackHole(ctx, body, rng) {
    ctx.save();
    ctx.translate(SPRITE_C, SPRITE_C);
    ctx.rotate(-0.3);
    const disk = ctx.createRadialGradient(0, -SPRITE_R * 0.3, SPRITE_R * 0.2, 0, SPRITE_R * 0.5, SPRITE_R * 1.4);
    disk.addColorStop(0, 'rgba(255,200,120,0.9)');
    disk.addColorStop(0.3, 'rgba(255,100,60,0.55)');
    disk.addColorStop(0.6, 'rgba(180,60,180,0.25)');
    disk.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = disk;
    ctx.beginPath();
    ctx.ellipse(0, 0, SPRITE_R * 1.35, SPRITE_R * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,230,180,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(SPRITE_C, SPRITE_C, SPRITE_R * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(SPRITE_C, SPRITE_C, SPRITE_R * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ========== 渲染逻辑 ==========
  function setupCanvas(canvas) {
    const wrap = canvas.parentElement;
    const size = Math.min(wrap.clientWidth, wrap.clientHeight) || 160;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    canvas._cssSize = size;
  }

  function getRenderRadius(realRadius, maxRealRadius, maxPixelRadius) {
    if (realRadius <= 0) return 4;
    const logR = Math.log10(realRadius);
    const logMax = Math.log10(maxRealRadius);
    const minLog = 2.5;
    const t = (logR - minLog) / (logMax - minLog);
    return Math.max(6, Math.min(maxPixelRadius, t * maxPixelRadius + 6));
  }

  function getMaxSphereRadius(body, halfSize) {
    const padding = 8;
    let visualFactor = 1.0;
    if (isRinged(body)) visualFactor = 1.3;
    else if (body.category === 'star' && !body.image) visualFactor = 1.35;
    else if (body.category === 'galaxy') visualFactor = 1.15;
    else if (body.category === 'blackhole') visualFactor = 1.5;
    return (halfSize - padding) / visualFactor;
  }

  function renderBody(canvas, body, maxRealRadius, opts) {
    opts = opts || {};
    setupCanvas(canvas);
    const size = canvas._cssSize;
    const half = size / 2;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    const desiredR = getRenderRadius(body.radius, maxRealRadius, half);
    const maxR = getMaxSphereRadius(body, half);
    const sphereR = Math.min(desiredR, maxR);

    const sprite = getSprite(body);
    const spriteScale = sphereR / SPRITE_R;
    const drawSize = SPRITE_SIZE * spriteScale;
    const scale = opts.scale || 1;

    ctx.save();
    ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;
    ctx.translate(half, half);
    ctx.scale(scale, scale);
    ctx.translate(-half, -half);

    if (body.category === 'star' || opts.glowColor) {
      const glowColor = opts.glowColor || body.color;
      const glowR = sphereR * 1.4;
      const glow = ctx.createRadialGradient(half, half, sphereR * 0.7, half, half, glowR);
      glow.addColorStop(0, glowColor + '40');
      glow.addColorStop(1, glowColor + '00');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(half, half, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.drawImage(sprite, half - drawSize / 2, half - drawSize / 2, drawSize, drawSize);

    ctx.restore();

    if (opts.mark) {
      ctx.save();
      const markSize = Math.min(size * 0.32, 48);
      ctx.translate(half, half);
      if (opts.mark === 'win') {
        ctx.fillStyle = 'rgba(40,200,80,0.9)';
        ctx.shadowColor = 'rgba(40,255,80,0.9)';
      } else {
        ctx.fillStyle = 'rgba(220,50,50,0.9)';
        ctx.shadowColor = 'rgba(255,60,60,0.9)';
      }
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(0, 0, markSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + (markSize * 0.6) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 0;
      ctx.fillText(opts.mark === 'win' ? '\u2713' : '\u2717', 0, 2);
      ctx.restore();
    }
  }

  // ========== 粒子系统 ==========
  function spawnParticles(x, y, color, count, isWin) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 2 + Math.random() * 4;
      STATE.particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: 0.015 + Math.random() * 0.01,
        size: 3 + Math.random() * 4,
        color: color,
        isWin: isWin,
      });
    }
  }

  function updateAndDrawParticles(ctx) {
    for (let i = STATE.particles.length - 1; i >= 0; i--) {
      const p = STATE.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life -= p.decay;
      if (p.life <= 0) {
        STATE.particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
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
        ctx.fillStyle = 'rgba(200, 220, 255, ' + s.alpha + ')';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (STATE.particles.length > 0) {
        updateAndDrawParticles(ctx);
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
    $('custom-screen').style.display = 'none';
    $('arcade-screen').style.display = 'none';
    $('planetpk-screen').style.display = 'none';
    $('island-screen').style.display = 'none';
    $('gameover-screen').style.display = 'none';
    $('result-overlay').classList.remove('show');
    clearAutoNext();
    cancelPKAnimation();
    if (window.ArcadeGame) window.ArcadeGame.stop();
    if (window.PlanetPkGame) window.PlanetPkGame.stop();
    if (window.PlanetIslandGame) window.PlanetIslandGame.stop();
  }

  function cancelPKAnimation() {
    STATE.pkAnimation = null;
  }

  function clearAutoNext() {
    if (STATE.autoNextTimer) {
      clearTimeout(STATE.autoNextTimer);
      STATE.autoNextTimer = null;
    }
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
    STATE.resultShown = false;
    cancelPKAnimation();
    clearAutoNext();
    STATE.currentPair = pickPair(STATE.round);
    $('result-overlay').classList.remove('show');

    updateHUD();

    const compareType = Math.random() < 0.5 ? 'radius' : 'mass';
    STATE.currentPair.compareType = compareType;

    const questionText = compareType === 'radius' ? '更大' : '更重';
    $('pk-question').innerHTML = '\u54ea\u4e2a\u5929\u4f53<span class="highlight">' + questionText + '</span>\uff1f';

    const pair = STATE.currentPair;
    const maxR = Math.max(pair.a.radius, pair.b.radius);

    renderBody($('pk-canvas-a'), pair.a, maxR);
    renderBody($('pk-canvas-b'), pair.b, maxR);

    $('pk-name-a').textContent = pair.a.name;
    $('pk-name-b').textContent = pair.b.name;

    const btnA = $('pk-btn-a');
    const btnB = $('pk-btn-b');
    btnA.className = 'pk-choice-btn';
    btnB.className = 'pk-choice-btn';
    btnA.textContent = '\u2190 ' + pair.a.name;
    btnB.textContent = pair.b.name + ' \u2192';
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
      STATE.score += 10 + STATE.combo * 5;
      STATE.correctCount++;
    } else {
      STATE.combo = 0;
      $('pk-screen').classList.add('shake');
      setTimeout(function() { $('pk-screen').classList.remove('shake'); }, 350);
    }
    updateHUD();

    playPKAnimation(correctSide, isCorrect);

    // 安全兜底：即使动画异常，1.2秒后一定显示结果
    setTimeout(function() {
      if (!STATE.resultShown && STATE.mode === 'pk') {
        showResult(isCorrect, pair, prop);
      }
    }, 1200);
  }

  function playPKAnimation(correctSide, isCorrect) {
    const start = performance.now();
    const duration = 900;
    STATE.pkAnimation = { start: start, duration: duration, correctSide: correctSide, isCorrect: isCorrect };

    const canvasA = $('pk-canvas-a');
    const canvasB = $('pk-canvas-b');
    const rectA = canvasA.getBoundingClientRect();
    const rectB = canvasB.getBoundingClientRect();
    const cy = window.innerHeight / 2;

    const winX = correctSide === 'a' ? rectA.left + rectA.width / 2 : rectB.left + rectB.width / 2;
    const loseX = correctSide === 'a' ? rectB.left + rectB.width / 2 : rectA.left + rectA.width / 2;
    const winColor = '#5F5';
    const loseColor = '#F55';

    spawnParticles(winX, cy, winColor, 20, true);
    spawnParticles(loseX, cy, loseColor, 12, false);

    function step(now) {
      if (!STATE.pkAnimation) return;
      const anim = STATE.pkAnimation;
      const t = Math.min((now - anim.start) / anim.duration, 1);
      const pair = STATE.currentPair;
      const maxR = Math.max(pair.a.radius, pair.b.radius);

      const winnerScale = 1 + 0.18 * Math.sin(t * Math.PI);
      const loserScale = 1 - 0.25 * t;
      const winAlpha = 1;
      const loseAlpha = 1 - 0.35 * t;
      const winGlow = '#5F5';
      const loseGlow = '#F55';

      const markA = correctSide === 'a' ? 'win' : 'lose';
      const markB = correctSide === 'b' ? 'win' : 'lose';

      if (correctSide === 'a') {
        renderBody(canvasA, pair.a, maxR, { scale: winnerScale, glowColor: winGlow, alpha: winAlpha, mark: markA });
        renderBody(canvasB, pair.b, maxR, { scale: loserScale, glowColor: loseGlow, alpha: loseAlpha, mark: markB });
      } else {
        renderBody(canvasA, pair.a, maxR, { scale: loserScale, glowColor: loseGlow, alpha: loseAlpha, mark: markA });
        renderBody(canvasB, pair.b, maxR, { scale: winnerScale, glowColor: winGlow, alpha: winAlpha, mark: markB });
      }

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        cancelPKAnimation();
        setTimeout(function() { showResult(anim.isCorrect, pair, pair.compareType); }, 120);
      }
    }
    requestAnimationFrame(step);
  }

  function showResult(isCorrect, pair, prop) {
    if (STATE.resultShown) return;
    STATE.resultShown = true;

    const overlay = $('result-overlay');
    const winner = pair.a[prop] > pair.b[prop] ? pair.a : pair.b;
    const loser = pair.a[prop] > pair.b[prop] ? pair.b : pair.a;
    const ratio = winner[prop] / loser[prop];

    let ratioText;
    if (ratio > 1000) {
      ratioText = ratio.toExponential(1) + ' 倍';
    } else if (ratio > 10) {
      ratioText = ratio.toFixed(0) + ' 倍';
    } else {
      ratioText = ratio.toFixed(1) + ' 倍';
    }

    const propText = prop === 'radius' ? '半径' : '质量';

    $('result-text').textContent = isCorrect ? '\u7b54\u5bf9\u4e86\uff01' : '\u7b54\u9519\u4e86';
    $('result-text').className = 'result-text ' + (isCorrect ? 'correct' : 'wrong');

    $('result-desc').innerHTML =
      '<b style="color:' + winner.color + '">' + winner.name + '</b> 的' + propText + '是 <b style="color:' + loser.color + '">' + loser.name + '</b> 的 <span style="color:#6CF;font-size:18px;font-weight:700">' + ratioText + '</span><br><br>' +
      winner.name + ': ' + (prop === 'radius' ? formatRadius(winner.radius) : formatNum(winner.mass)) + '<br>' +
      loser.name + ': ' + (prop === 'radius' ? formatRadius(loser.radius) : formatNum(loser.mass)) + '<br><br>' +
      '<span style="font-size:13px;color:rgba(160,180,220,0.7)">' + winner.desc + '</span>';

    drawResultComparison(winner, loser);
    overlay.classList.add('show');

    // 自动下一题倒计时
    let secondsLeft = 2;
    const hintEl = $('result-auto-hint');
    hintEl.textContent = secondsLeft + '秒后自动下一题';

    const countdown = setInterval(function() {
      secondsLeft--;
      if (secondsLeft > 0) {
        hintEl.textContent = secondsLeft + '秒后自动下一题';
      } else {
        clearInterval(countdown);
        hintEl.textContent = '即将下一题...';
      }
    }, 1000);

    STATE.autoNextTimer = setTimeout(function() {
      clearInterval(countdown);
      if (STATE.mode === 'pk') {
        nextRound();
      }
    }, 2200);
  }

  function drawResultComparison(winner, loser) {
    const canvas = $('result-comparison-canvas');
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(320, window.innerWidth - 40);
    const h = 130;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const maxR = Math.max(winner.radius, loser.radius);
    const maxPx = 48;
    const rWinner = getRenderRadius(winner.radius, maxR, maxPx);
    const rLoser = getRenderRadius(loser.radius, maxR, maxPx);

    drawMiniBody(ctx, w * 0.22, 55, rWinner, winner);
    drawMiniBody(ctx, w * 0.75, 55, rLoser, loser);

    ctx.fillStyle = 'rgba(200,220,255,0.7)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(winner.name, w * 0.22, 115);
    ctx.fillText(loser.name, w * 0.75, 115);

    ctx.strokeStyle = '#6CF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.22 + 55, 55);
    ctx.lineTo(w * 0.75 - 55, 55);
    ctx.lineTo(w * 0.75 - 60, 50);
    ctx.moveTo(w * 0.75 - 55, 55);
    ctx.lineTo(w * 0.75 - 60, 60);
    ctx.stroke();
  }

  function drawMiniBody(ctx, cx, cy, r, body) {
    const sprite = getSprite(body);
    const scale = r / SPRITE_R;
    const drawSize = SPRITE_SIZE * scale;
    ctx.drawImage(sprite, cx - drawSize / 2, cy - drawSize / 2, drawSize, drawSize);
  }

  function showGameOver() {
    STATE.mode = 'gameover';
    hideAll();
    $('gameover-screen').style.display = 'flex';

    const accuracy = ((STATE.correctCount / STATE.totalRounds) * 100).toFixed(0);
    $('gameover-score').textContent = STATE.score;
    $('gameover-stats').innerHTML =
      '答对 ' + STATE.correctCount + ' / ' + STATE.totalRounds + ' 题<br>' +
      '正确率 ' + accuracy + '%<br>' +
      '最高连击 ' + STATE.maxCombo + ' 连击';

    let title = '继续努力！';
    if (STATE.correctCount === STATE.totalRounds) title = '宇宙大师！';
    else if (STATE.correctCount >= 12) title = '星空学者！';
    else if (STATE.correctCount >= 8) title = '太空探险家！';
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
    $('round-info').textContent = '第 ' + STATE.round + ' / ' + STATE.totalRounds + ' 题';
  }

  // ========== 探索模式 ==========
  const exploreState = {
    index: 0,
    sortedData: [],
  };

  function startExplore() {
    STATE.mode = 'explore';
    hideAll();
    $('explore-screen').style.display = 'block';
    exploreState.sortedData = getAllBodies().slice().sort(function(a, b) { return a.radius - b.radius; });
    exploreState.index = Math.floor(exploreState.sortedData.length / 2);
    renderExplore();
    $('explore-scale-hint').textContent = '上下滑动探索宇宙尺度，点击查看详情';
  }

  function renderExplore() {
    const canvas = $('explore-canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    const data = exploreState.sortedData;
    const currentData = data[exploreState.index];
    if (!currentData) return;

    const half = Math.min(w, h) * 0.32;
    const maxR = getMaxSphereRadius(currentData, half);
    const renderR = Math.min(getRenderRadius(currentData.radius, data[data.length - 1].radius, half), maxR);

    const cy = h / 2;
    drawExploreBody(ctx, cx, cy, renderR, currentData);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(currentData.name, cx, cy + renderR + 45);

    ctx.fillStyle = 'rgba(160, 180, 220, 0.5)';
    ctx.font = '13px sans-serif';
    ctx.fillText(currentData.nameEn, cx, cy + renderR + 65);

    ctx.fillStyle = 'rgba(100, 200, 255, 0.7)';
    ctx.font = '14px sans-serif';
    ctx.fillText(formatRadius(currentData.radius), cx, cy + renderR + 88);

    if (currentData.isCustom) {
      ctx.fillStyle = 'rgba(100, 200, 255, 0.9)';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('我的星系', cx, cy + renderR + 108);
    }

    if (exploreState.index > 0) {
      const prev = data[exploreState.index - 1];
      ctx.fillStyle = 'rgba(160, 180, 220, 0.35)';
      ctx.font = '14px sans-serif';
      ctx.fillText('\u2191 ' + prev.name, cx, 90);
    }
    if (exploreState.index < data.length - 1) {
      const next = data[exploreState.index + 1];
      ctx.fillStyle = 'rgba(160, 180, 220, 0.35)';
      ctx.font = '14px sans-serif';
      ctx.fillText('\u2193 ' + next.name, cx, h - 150);
    }

    const totalSteps = data.length;
    const progress = exploreState.index / (totalSteps - 1);
    const barH = h - 220;
    const barY = 110;
    ctx.strokeStyle = 'rgba(100, 130, 255, 0.25)';
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

  function drawExploreBody(ctx, cx, cy, r, body) {
    const sprite = getSprite(body);
    const scale = r / SPRITE_R;
    const drawSize = SPRITE_SIZE * scale;
    ctx.drawImage(sprite, cx - drawSize / 2, cy - drawSize / 2, drawSize, drawSize);
  }

  function showExploreInfo() {
    const data = exploreState.sortedData[exploreState.index];
    if (!data) return;
    const typeMap = {
      planet: '行星',
      dwarf: '矮行星',
      moon: '卫星',
      star: '恒星',
      galaxy: '星系',
      blackhole: '黑洞',
      other: '天体',
    };

    $('explore-info-name').textContent = data.name;
    $('explore-info-type').textContent = (data.isCustom ? '我的星系 · ' : '') + (typeMap[data.category] || '天体');
    $('explore-info-desc').textContent = data.desc;
    $('explore-stat-radius').textContent = formatRadius(data.radius);
    $('explore-stat-mass').textContent = formatNum(data.mass);
    $('explore-info').classList.add('show');
  }

  function hideExploreInfo() {
    $('explore-info').classList.remove('show');
  }

  function initExploreTouch() {
    const canvas = $('explore-canvas');
    let startY = 0;
    let isDragging = false;

    canvas.addEventListener('touchstart', function(e) {
      startY = e.touches[0].clientY;
      isDragging = true;
      hideExploreInfo();
    });

    canvas.addEventListener('touchmove', function(e) {
      if (!isDragging) return;
      const dy = e.touches[0].clientY - startY;
      if (Math.abs(dy) > 50) {
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

    canvas.addEventListener('touchend', function() {
      isDragging = false;
    });

    canvas.addEventListener('click', function() {
      showExploreInfo();
    });

    canvas.addEventListener('wheel', function(e) {
      e.preventDefault();
      if (e.deltaY > 0 && exploreState.index < exploreState.sortedData.length - 1) {
        exploreState.index++;
      } else if (e.deltaY < 0 && exploreState.index > 0) {
        exploreState.index--;
      }
      renderExplore();
    });
  }

  // ========== 我的星系 ==========
  function startCustom() {
    STATE.mode = 'custom';
    hideAll();
    $('custom-screen').style.display = 'block';
    showCustomList();
  }

  // ========== 游戏 Tab（弹球击退星球） ==========
  function startArcade() {
    STATE.mode = 'arcade';
    hideAll();
    $('arcade-screen').style.display = 'flex';
    if (window.ArcadeGame) window.ArcadeGame.start();
  }

  function startPlanetPK() {
    STATE.mode = 'planetpk';
    hideAll();
    $('planetpk-screen').style.display = 'flex';
    if (window.PlanetPkGame) window.PlanetPkGame.start();
  }

  function startIsland() {
    STATE.mode = 'island';
    hideAll();
    $('island-screen').style.display = 'flex';
    if (window.PlanetIslandGame) window.PlanetIslandGame.open();
  }

  function showCustomList() {
    $('custom-list-view').style.display = 'block';
    $('custom-form-view').style.display = 'none';
    renderCustomList();
  }

  function showCustomForm(id) {
    editingCustomId = id || null;
    pendingCustomPhoto = null;
    $('custom-list-view').style.display = 'none';
    $('custom-form-view').style.display = 'block';
    $('custom-form-title').textContent = id ? '编辑天体' : '添加天体';
    $('custom-form').reset();
    $('custom-photo-preview').style.display = 'none';
    $('custom-photo-preview').src = '';
    $('custom-photo-placeholder').style.display = 'block';

    if (id) {
      const body = CUSTOM_BODIES.find(b => b.id === id);
      if (body) {
        $('custom-name').value = body.name;
        $('custom-name-en').value = body.nameEn || '';
        $('custom-category').value = body.category;
        $('custom-radius').value = body.radius;
        $('custom-mass').value = body.mass;
        $('custom-color').value = body.color || '#6CF';
        $('custom-desc').value = body.desc || '';
        if (body.customImage) {
          $('custom-photo-preview').src = body.customImage;
          $('custom-photo-preview').style.display = 'block';
          $('custom-photo-placeholder').style.display = 'none';
          pendingCustomPhoto = body.customImage;
        }
      }
    }
  }

  function renderCustomList() {
    const listEl = $('custom-list');
    const emptyEl = $('custom-empty');
    listEl.innerHTML = '';

    if (CUSTOM_BODIES.length === 0) {
      emptyEl.classList.add('show');
      return;
    }
    emptyEl.classList.remove('show');

    const typeMap = {
      planet: '行星',
      dwarf: '矮行星',
      moon: '卫星',
      star: '恒星',
      galaxy: '星系',
      blackhole: '黑洞',
      other: '天体',
    };

    CUSTOM_BODIES.forEach(body => {
      const card = document.createElement('div');
      card.className = 'custom-card';

      const photo = document.createElement(body.customImage ? 'img' : 'div');
      photo.className = 'custom-card-photo' + (body.customImage ? '' : ' placeholder');
      if (body.customImage) {
        photo.src = body.customImage;
      } else {
        photo.textContent = '?';
      }

      const info = document.createElement('div');
      info.className = 'custom-card-info';
      info.innerHTML =
        '<div class="custom-card-name">' + escapeHtml(body.name) + '</div>' +
        '<div class="custom-card-meta">' + (typeMap[body.category] || '天体') + ' · 半径 ' + formatRadius(body.radius) + '</div>' +
        '<div class="custom-card-desc">' + escapeHtml(body.desc || '暂无介绍') + '</div>';

      const actions = document.createElement('div');
      actions.className = 'custom-card-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'custom-card-edit';
      editBtn.textContent = '编辑';
      editBtn.addEventListener('click', function() { showCustomForm(body.id); });
      const delBtn = document.createElement('button');
      delBtn.className = 'custom-card-delete';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', function() { deleteCustomBody(body.id); });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      card.appendChild(photo);
      card.appendChild(info);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function handlePhotoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('照片太大，请选择小于 2MB 的图片');
      return;
    }
    const reader = new FileReader();
    reader.onload = function(evt) {
      pendingCustomPhoto = evt.target.result;
      $('custom-photo-preview').src = pendingCustomPhoto;
      $('custom-photo-preview').style.display = 'block';
      $('custom-photo-placeholder').style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  function handleCustomSubmit(e) {
    e.preventDefault();
    const name = $('custom-name').value.trim();
    const nameEn = $('custom-name-en').value.trim();
    const category = $('custom-category').value;
    const radius = parseNumberInput($('custom-radius').value);
    const mass = parseNumberInput($('custom-mass').value);
    const color = $('custom-color').value;
    const desc = $('custom-desc').value.trim();

    if (!name) { alert('请输入名称'); return; }
    if (radius <= 0) { alert('半径必须大于0'); return; }
    if (mass <= 0) { alert('质量必须大于0'); return; }

    const isNew = !editingCustomId;
    const id = editingCustomId || 'custom_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

    const body = {
      id: id,
      name: name,
      nameEn: nameEn || name,
      category: category,
      radius: radius,
      mass: mass,
      color: color,
      desc: desc,
      isCustom: true,
      style: { type: guessStyleType(category) },
      customImage: pendingCustomPhoto || null,
    };

    if (isNew) {
      CUSTOM_BODIES.push(body);
    } else {
      const idx = CUSTOM_BODIES.findIndex(b => b.id === editingCustomId);
      if (idx >= 0) {
        // 保留旧照片如果没有新照片
        if (!pendingCustomPhoto && CUSTOM_BODIES[idx].customImage) {
          body.customImage = CUSTOM_BODIES[idx].customImage;
        }
        CUSTOM_BODIES[idx] = body;
      }
    }

    saveCustomBodies();
    invalidateSprite(id);
    // 预加载自定义图片到缓存
    if (body.customImage) {
      const img = new Image();
      img.onload = function() { imageCache[id] = img; };
      img.src = body.customImage;
    }

    showCustomList();
  }

  function deleteCustomBody(id) {
    if (!confirm('确定要删除这个天体吗？')) return;
    CUSTOM_BODIES = CUSTOM_BODIES.filter(b => b.id !== id);
    saveCustomBodies();
    invalidateSprite(id);
    delete imageCache[id];
    renderCustomList();
  }

  function initCustomPhotoUpload() {
    $('custom-photo-box').addEventListener('click', function() {
      $('custom-photo').click();
    });
    $('custom-photo').addEventListener('change', handlePhotoSelect);
  }

  // ========== 初始化 ==========
  function init() {
    loadCustomBodies();
    initStarfield();

    $('btn-pk').addEventListener('click', startPK);
    $('btn-explore').addEventListener('click', startExplore);
    $('btn-custom').addEventListener('click', startCustom);
    $('btn-arcade').addEventListener('click', startArcade);
    $('btn-planetpk').addEventListener('click', startPlanetPK);
    $('btn-island').addEventListener('click', startIsland);

    $('pk-btn-a').addEventListener('click', function() { answer('a'); });
    $('pk-btn-b').addEventListener('click', function() { answer('b'); });
    // 移动端 touch 响应更及时
    $('pk-btn-a').addEventListener('touchstart', function(e) { e.preventDefault(); answer('a'); });
    $('pk-btn-b').addEventListener('touchstart', function(e) { e.preventDefault(); answer('b'); });

    $('result-next-btn').addEventListener('click', function() {
      clearAutoNext();
      nextRound();
    });

    $('btn-replay').addEventListener('click', startPK);
    $('btn-menu').addEventListener('click', showMenu);

    $('btn-back-pk').addEventListener('click', showMenu);
    $('btn-back-explore').addEventListener('click', showMenu);
    $('btn-back-custom').addEventListener('click', showMenu);
    $('btn-back-arcade').addEventListener('click', showMenu);
    $('btn-back-planetpk').addEventListener('click', showMenu);
    $('btn-back-island').addEventListener('click', showMenu);

    // 游戏 Tab 内结算面板
    $('arcade-replay').addEventListener('click', startArcade);
    $('arcade-menu').addEventListener('click', showMenu);

    $('btn-add-custom').addEventListener('click', function() { showCustomForm(null); });
    $('btn-cancel-custom').addEventListener('click', showCustomList);
    $('custom-form').addEventListener('submit', handleCustomSubmit);

    initExploreTouch();
    initCustomPhotoUpload();
    $('explore-info-close').addEventListener('click', hideExploreInfo);

    window.addEventListener('resize', function() {
      if (STATE.mode === 'pk' && STATE.currentPair && !STATE.pkAnimation && !$('result-overlay').classList.contains('show')) {
        const maxR = Math.max(STATE.currentPair.a.radius, STATE.currentPair.b.radius);
        renderBody($('pk-canvas-a'), STATE.currentPair.a, maxR);
        renderBody($('pk-canvas-b'), STATE.currentPair.b, maxR);
      } else if (STATE.mode === 'explore') {
        renderExplore();
      }
    });

    // 预加载图片
    preloadImages(function() {
      Object.keys(spriteCache).forEach(function(k) { delete spriteCache[k]; });
      // 预加载自定义图片
      CUSTOM_BODIES.forEach(function(b) {
        if (b.customImage) {
          const img = new Image();
          img.onload = function() { imageCache[b.id] = img; };
          img.src = b.customImage;
        }
      });
    });

    showMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
