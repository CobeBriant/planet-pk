/**
 * 星球岛 — 3D 拟人星球乐园（第 6 个 Tab）
 *
 * 玩法（基于 WebGL / Three.js，离线内置 three.min.js）：
 *  - 进入后先选星球：每个星球按【真实半径】做对数适配（1.3~4.0 显示半径），相对大小真实可见
 *  - 点击球体 → 起跳
 *  - 滑动屏幕 → 星球朝滑动方向滚动（真实摩擦 / 滚转）
 *  - 按住「马力」→ 加速，可冲上岛上的斜坡并飞出（冲个刺）
 *  - 岛上有若干「人机天体」：自主游荡、会跳、会朝你靠近，与你/彼此发生符合动量守恒的 3D 弹性碰撞
 *
 * 渲染：Three.js（全局 THREE），DPR 自适应，requestAnimationFrame + delta time
 * 复用：真实天体图片 window.PKImageCache；音效 window.Sfx（arcade.js 暴露）
 *
 * 对外暴露 window.PlanetIslandGame：init() / open() / beginPlay(body) / stop()
 */
window.PlanetIslandGame = (function () {
  'use strict';
  var THREE = window.THREE;

  // ---------- DOM ----------
  var canvas, selectEl, gridEl, hintEl, boostBtn, muteBtn, scoreEl;
  var heartsEl, overEl, overTitleEl, overSubEl, viewBtn;
  var stickEl, stickThumbEl;
  var renderer, scene, camera;
  var starfield, islandGroup, ramps = [];
  var props = [];                  // 道具 / 陷阱 / 障碍
  var bolts = [];                  // 玩家发射的激光弹
  var vendors = [];                // 街道摊贩（纯装饰，推车游走）
  var mines = [];                  // 小星球 / BOSS 种下的地雷
  var player = null, npcs = [];
  var rafId = null, running = false, lastT = 0;
  var state = 'idle';            // idle | select | playing | bossIntro | over
  var collisions = 0;
  var boosting = false;
  var W = 0, H = 0, dpr = 1;
  var islandR = 208;               // 岛平面半径（原 104，再 ×2）
  var FACE_TEX = null;
  var FALL_Y = -16;                // 低于此高度视为掉下岛
  var LIVES = 3;                   // 玩家红心数
  var lives = LIVES;
  var over = false;
  var playStartMs = 0;             // 本局开始时间（用于结算“坚持时长”）
  var boltCd = 0;                  // 激光冷却
  var BOSS_FACE_TEX = null;        // BOSS 专属脸（更高清、更凶）
  var bossDefeated = false;        // BOSS 被打完 → 玩家胜
  var desiredMinions = 5;          // 同时存在的“护驾”小星球数量
  var minionTimer = 0;             // 小星球重生计时
  // 相机参数（随岛变大而放大）
  var CAM_FOLLOW_DIST = 72, CAM_FOLLOW_H = 36, BOSS_INTRO_DIST = 52;
  // 激光 / 血量
  var LASER_DMG = 12;              // 每次激光伤害
  var MINION_HP = 30;              // 小星球血量（约 3 发）
  var BOSS_HP = 200;               // BOSS 血量（约 17 发）
  var TRAP_FALL = 5.0;             // 在陷阱上停留多久会掉下去（秒）

  // 玩家血条 / 摊贩回血
  var PLAYER_HP = 100;             // 玩家星球血量（被撞会掉，吃摊贩回血）
  var VENDOR_HEAL = 40;            // 吃一个摊贩回的血
  var VENDOR_RESPAWN = 8;          // 摊贩被吃后多久重新出现（秒）
  var PLAYER_HIT_DMG = 10;          // 被小星球 / BOSS 撞一下掉的血
  var PLAYER_HIT_GRACE = 0.7;      // 玩家受击间隔（防止一帧连扣）
  var PLAYER_RESPAWN_GRACE = 2.0;  // 复活后无敌时间（防止复活又被挤下岛秒掉第二颗心）
  // 地雷（某些小星球 / BOSS 会在脚下种）
  var MINE_DMG = 22;               // 地雷爆炸对范围内星球造成的伤害
  var MINE_FUSE_MIN = 10, MINE_FUSE_MAX = 30;   // 地雷随机引爆时间（秒）
  var MINE_RADIUS = 26;            // 地雷爆炸杀伤半径
  var MINE_PLANT_MIN = 7, MINE_PLANT_MAX = 15;  // 小星球种地雷的间隔（秒）
  var MAX_MINES = 10;              // 同屏最多地雷数

  // BOSS 专属出场特效
  var bossFx = [];                 // 冲击波 / 粒子
  var bossIntroT = 0;             // 出场动画倒计时
  var camShake = 0;               // 镜头抖动强度
  var currentBoss = null;
  var bossFlashEl = null, bossBannerEl = null;

  // 慢动作回放
  var slowmo = 0, focus = [];

  // 自由旋转视角（orbit）
  var camMode = 'follow';          // 'follow' | 'orbit'
  var camAz = 0, camEl = 0.62, camDist = 90;
  var pointers = {};               // 多点触控
  var orbitPinchLast = 0;

  // 物理参数（手感已调：跳更高 / 马力更猛 / 摩擦保留）
  var GRAV = 30, JUMP = 19, ACCEL = 52, BOOST_MULT = 2.6;
  var MAXSPD = 26, BOOST_MAXSPD = 52, DRAG = 1.9, REST = 0.30;

  // ---------- 输入 ----------
  var input = { x: 0, z: 0, active: false };
  var drag = { id: null, x0: 0, y0: 0, lastX: 0, lastY: 0 };
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();

  // ============ 工具 ============
  function $(id) { return document.getElementById(id); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function log10(v) { return Math.log(v) / Math.LN10; }
  function sfx(name) { if (window.Sfx && window.Sfx[name]) try { window.Sfx[name](); } catch (e) {} }

  function getPool() {
    var base = (typeof CELESTIAL_DATA !== 'undefined') ? CELESTIAL_DATA.slice() : [];
    var custom = (window.getCustomBodies ? window.getCustomBodies() : []) || [];
    return base.concat(custom).filter(function (b) { return b && b.radius && b.radius > 0; });
  }

  // 真实半径 → 显示半径（对数适配，避免 10 个数量级差异不可玩）
  function displayRadius(body) {
    var r = clamp((log10(body.radius) - 2) / (14 - 2), 0, 1);
    return 1.3 + r * 2.7;
  }
  // 真实质量 → 碰撞质量系数
  function massFactor(body) {
    var m = clamp((log10(Math.max(body.mass, 1)) - 18) / (42 - 18), 0.15, 1);
    return 0.4 + m * 2.6;
  }
  function fmtR(r) {
    if (r >= 1e9) return (r / 1e9).toFixed(1) + '亿km';
    if (r >= 1e4) return (r / 1e4).toFixed(0) + '万km';
    return Math.round(r) + 'km';
  }

  function bodyTexture(body) {
    var img = window.PKImageCache && (window.PKImageCache[body.id] || window.PKImageCache[body.name]);
    if (img && img.complete && img.naturalWidth) {
      var t = new THREE.Texture(img);
      t.needsUpdate = true;
      return t;
    }
    return null;
  }

  // 邪恶拟人脸（Canvas → Sprite，永远朝向相机）
  function faceTexture() {
    var c = document.createElement('canvas'); c.width = 128; c.height = 128;
    var x = c.getContext('2d');
    function eye(cx) {
      x.save();
      x.shadowColor = '#ff2d2d'; x.shadowBlur = 14;
      x.fillStyle = '#ffe14b';
      x.beginPath(); x.ellipse(cx, 60, 15, 19, 0, 0, Math.PI * 2); x.fill();
      x.shadowBlur = 0;
      x.fillStyle = '#1a0000';
      x.beginPath(); x.ellipse(cx, 62, 6, 13, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.9)';
      x.beginPath(); x.arc(cx - 3, 56, 3, 0, Math.PI * 2); x.fill();
      x.restore();
    }
    eye(44); eye(84);
    // 怒眉（内低外高）
    x.strokeStyle = '#160c20'; x.lineWidth = 10; x.lineCap = 'round';
    x.beginPath(); x.moveTo(22, 38); x.lineTo(62, 52); x.stroke();
    x.beginPath(); x.moveTo(106, 38); x.lineTo(66, 52); x.stroke();
    var t = new THREE.Texture(c); t.needsUpdate = true;
    return t;
  }

  // BOSS 专属脸：更高清（256px）、更凶的发红发光大眼 + 怒眉 + 獠牙
  function bossFaceTexture() {
    var c = document.createElement('canvas'); c.width = 256; c.height = 256;
    var x = c.getContext('2d');
    // 每只眼睛独立绘制，间距拉大、去掉会融合成“独眼”的红色光晕
    function eye(cx) {
      x.save();
      // 眼白（黄）
      x.fillStyle = '#ffe14b';
      x.beginPath(); x.ellipse(cx, 104, 30, 38, 0, 0, Math.PI * 2); x.fill();
      // 红色细描边（不再用大 blur，避免两只眼的光晕连成一只）
      x.lineWidth = 6; x.strokeStyle = '#c41a1a'; x.stroke();
      // 瞳孔（黑）
      x.fillStyle = '#160000';
      x.beginPath(); x.ellipse(cx, 110, 14, 30, 0, 0, Math.PI * 2); x.fill();
      // 高光
      x.fillStyle = 'rgba(255,255,255,0.95)';
      x.beginPath(); x.arc(cx - 6, 96, 6, 0, Math.PI * 2); x.fill();
      x.restore();
    }
    eye(74); eye(182);   // 两只眼明显分开
    // 凶恶怒眉（内低外高），分两段、不跨过两眼中间
    x.strokeStyle = '#160c20'; x.lineWidth = 22; x.lineCap = 'round';
    x.beginPath(); x.moveTo(24, 58); x.lineTo(112, 86); x.stroke();
    x.beginPath(); x.moveTo(232, 58); x.lineTo(144, 86); x.stroke();
    // 邪恶咧嘴 + 獠牙
    x.strokeStyle = '#160c20'; x.lineWidth = 14;
    x.beginPath(); x.moveTo(74, 182); x.quadraticCurveTo(128, 220, 182, 182); x.stroke();
    x.fillStyle = '#fff';
    x.beginPath(); x.moveTo(100, 196); x.lineTo(108, 222); x.lineTo(116, 196); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(140, 196); x.lineTo(148, 222); x.lineTo(156, 196); x.closePath(); x.fill();
    var t = new THREE.Texture(c); t.needsUpdate = true;
    return t;
  }

  // 名字标签（Canvas → Sprite，永远朝向相机）
  function nameTexture(text, accent) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 64;
    var x = c.getContext('2d');
    x.font = 'bold 36px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 7; x.strokeStyle = 'rgba(0,0,0,0.85)';
    x.strokeText(text, 128, 34);
    x.fillStyle = accent || '#ffd24d';
    x.fillText(text, 128, 34);
    var t = new THREE.Texture(c); t.needsUpdate = true;
    return t;
  }

  // 血条（Canvas → Sprite，始终朝向相机，挂在天体头顶）
  function makeHpBar(isBoss) {
    var c = document.createElement('canvas'); c.width = 128; c.height = 24;
    var tex = new THREE.Texture(c); tex.needsUpdate = true;
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    var w = isBoss ? 10 : 5.5;
    sprite.scale.set(w, w * 0.19, 1);
    sprite.renderOrder = 6;
    return { sprite: sprite, canvas: c, tex: tex, isBoss: !!isBoss };
  }
  function updateHpBar(b) {
    if (!b.hpBar) return;
    var x = b.hpBar.canvas.getContext('2d');
    var W = 128, H = 24, pad = 3;
    x.clearRect(0, 0, W, H);
    // 底框
    x.fillStyle = 'rgba(0,0,0,0.7)';
    x.fillRect(0, 0, W, H);
    var ratio = b.maxHp > 0 ? clamp(b.hp / b.maxHp, 0, 1) : 0;
    var col = b.hpBar.isBoss ? '#ff3b5c' : (ratio > 0.5 ? '#46e36b' : ratio > 0.25 ? '#ffd24d' : '#ff5a3c');
    x.fillStyle = col;
    x.fillRect(pad, pad, (W - pad * 2) * ratio, H - pad * 2);
    x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 2;
    x.strokeRect(1, 1, W - 2, H - 2);
    b.hpBar.tex.needsUpdate = true;
  }

  // ============ 生成「天体」===========
  function makeBeing(body, labelColor, isBoss, isPlayer) {
    var R = isBoss ? 6.2 : displayRadius(body);
    var group = new THREE.Group();
    var tex = bodyTexture(body);
    var mat = tex
      ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 })
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(body.color || '#88aaff'), roughness: 0.8, metalness: 0.1 });
    var sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), mat);
    group.add(sphere);

    if (!FACE_TEX) FACE_TEX = faceTexture();
    if (isBoss && !BOSS_FACE_TEX) BOSS_FACE_TEX = bossFaceTexture();
    var ftex = (isBoss && BOSS_FACE_TEX) ? BOSS_FACE_TEX : FACE_TEX;
    var face = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, transparent: true }));
    var fs = R * 1.55;
    face.scale.set(fs, fs, 1);
    face.position.set(0, R * 0.04, R * 0.98);
    // Q版星仔自带卡通脸（customImage），不再叠加邪恶拟人脸
    if (!(body.customImage)) group.add(face);

    // 名字标签（悬在球体上方，始终朝向相机）
    var labelText = (isBoss ? '👑BOSS ' : '') + body.name;
    var label = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(labelText, labelColor || '#ffd24d'), transparent: true, depthTest: false }));
    var lw = R * 4.2;
    label.scale.set(lw, lw * 0.25, 1);
    label.position.set(0, R * 1.55, 0);
    label.renderOrder = 5;
    group.add(label);

    // 血条（BOSS / 小星球 / 玩家都有；玩家用蓝绿色调，由 updateHpBar 自动配色）
    var hpBar = makeHpBar(!!isBoss);
    hpBar.sprite.position.set(0, R * 1.75, 0);
    group.add(hpBar.sprite);

    scene.add(group);
    var maxHp = isBoss ? BOSS_HP : (isPlayer ? PLAYER_HP : MINION_HP);
    var b = {
      group: group, sphere: sphere, label: label, R: R, body: body, mass: isBoss ? 9 : massFactor(body),
      isBoss: !!isBoss, isPlayer: !!isPlayer, vel: new THREE.Vector3(), grounded: false, jumpCd: 0, out: false,
      hp: maxHp, maxHp: maxHp, hpBar: hpBar, _trapT: 0, _grace: 0, _phGrace: 0,
      mineCd: isPlayer ? 0 : (isBoss ? rand(MINE_PLANT_MIN, MINE_PLANT_MAX) * 1.3 : rand(MINE_PLANT_MIN, MINE_PLANT_MAX)),
      ai: { tx: rand(-30, 30), tz: rand(-30, 30), hopCd: rand(1, 4), seek: false, dash: 0, dashTx: 0, dashTz: 0 }
    };
    if (hpBar) updateHpBar(b);
    return b;
  }

  // ============ 场景 ============
  function makeStarfield() {
    var n = 900, pos = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var r = rand(120, 320), th = rand(0, 6.28), ph = Math.acos(rand(-1, 1));
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfd8ff, size: 1.4, sizeAttenuation: true }));
  }

  function addRamp(angle, hw, len, h) {
    var ux = Math.sin(angle), uz = Math.cos(angle);
    var px = Math.cos(angle), pz = -Math.sin(angle);
    // 斜坡整体挪到岛屿外圈：坡底从约 0.5R 起，坡顶平台正好落在岛边缘（可冲出岛）
    var d0 = islandR * 0.5;
    var platLen = len * 0.20;       // 坡顶平台长度
    var geo = new THREE.BufferGeometry();
    var v = [
      -hw, 0, 0, hw, 0, 0, hw, 0, len, -hw, 0, len,
      -hw, h, len, hw, h, len
    ];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.setIndex([0, 2, 1, 0, 3, 2, 0, 1, 5, 0, 5, 4, 3, 2, 5, 3, 5, 4, 0, 4, 3, 1, 2, 5]);
    geo.computeVertexNormals();
    var mat = new THREE.MeshStandardMaterial({ color: 0x2a3a66, roughness: 0.9, emissive: 0x0a1838, emissiveIntensity: 0.5, side: THREE.DoubleSide });
    var m = new THREE.Mesh(geo, mat);
    m.matrixAutoUpdate = false;
    var basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(px, 0, pz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(ux, 0, uz)
    );
    basis.setPosition(ux * d0, 0, uz * d0);
    m.matrix.copy(basis);
    islandGroup.add(m);
    // 坡顶平台（一块平板，落在岛边缘当作起跳台）
    var pg = new THREE.BoxGeometry(2 * hw, 1.6, platLen);
    var pm = new THREE.Mesh(pg, mat);
    pm.matrixAutoUpdate = false;
    var pmat = new THREE.Matrix4().makeTranslation(0, h + 0.8, len + platLen / 2);
    pm.matrix.copy(basis).multiply(pmat);
    islandGroup.add(pm);
    ramps.push({ ux: ux, uz: uz, px: px, pz: pz, d0: d0, len: len, hw: hw, h: h, slope: h / len, platLen: platLen });
  }

  function terrainHeight(x, z) {
    var g = 0;
    for (var i = 0; i < ramps.length; i++) {
      var r = ramps[i];
      var along = (x * r.ux + z * r.uz) - r.d0;
      var across = x * r.px + z * r.pz;
      if (Math.abs(across) > r.hw) continue;
      if (along >= 0 && along <= r.len) {
        var hh = r.slope * along;
        if (hh > g) g = hh;
      } else if (along > r.len && along <= r.len + r.platLen) {
        if (r.h > g) g = r.h;   // 平台顶
      }
    }
    return g;
  }

  // ============ 道具 / 陷阱 / 障碍 ============
  // type: trampoline(大弹) / spring(中弹) / mud(减速) / speed(加速带)
  //       trap(塌陷陷阱) / bumper(弹射柱) / spinner(旋转风车)
  function makeProp(type, x, z, r) {
    var rec = { type: type, x: x, z: z, r: r };
    if (type === 'trampoline' || type === 'spring' || type === 'mud' || type === 'speed') {
      var color, h = 0.4;
      if (type === 'trampoline') color = 0x33ff99;
      else if (type === 'spring') color = 0x66ddff;
      else if (type === 'mud') color = 0x8a5a2b;
      else color = 0xffe24d; // speed
      var disc = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, h, 32),
        new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: type === 'mud' ? 0.05 : 0.4, roughness: 0.6 })
      );
      disc.position.set(x, h / 2, z);
      islandGroup.add(disc);
      if (type === 'trampoline' || type === 'spring') {
        var ring = new THREE.Mesh(
          new THREE.TorusGeometry(r * 0.6, 0.18, 8, 28),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        ring.rotation.x = Math.PI / 2; ring.position.set(x, h + 0.05, z); islandGroup.add(ring);
      }
      if (type === 'speed') {
        var arrow = new THREE.Mesh(
          new THREE.ConeGeometry(r * 0.4, r * 0.7, 4),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        arrow.rotation.x = Math.PI / 2; arrow.position.set(x, h + 0.2, z); islandGroup.add(arrow);
      }
    } else if (type === 'trap') {
      // 圆形塌陷陷阱：深色凹洞 + 红色脉动警示环
      var hole = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 0.8, 3.2, 36),
        new THREE.MeshStandardMaterial({ color: 0x05030a, roughness: 1, metalness: 0 })
      );
      hole.position.set(x, -1.4, z); islandGroup.add(hole);
      var edge = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.5, 10, 40),
        new THREE.MeshBasicMaterial({ color: 0xff3344 })
      );
      edge.rotation.x = Math.PI / 2; edge.position.set(x, 0.1, z); islandGroup.add(edge);
      rec.ring = edge; rec.phase = Math.random() * 6.28;
    } else if (type === 'bumper') {
      // 弹射柱：撞上会被强力弹开
      var post = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.55, r * 0.7, 4.5, 20),
        new THREE.MeshStandardMaterial({ color: 0xff5ad0, emissive: 0xff2db0, emissiveIntensity: 0.6, roughness: 0.4 })
      );
      post.position.set(x, 2.25, z); islandGroup.add(post);
      var cap = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.7, 18, 14),
        new THREE.MeshBasicMaterial({ color: 0xffd24d })
      );
      cap.position.set(x, 4.6, z); islandGroup.add(cap);
    } else if (type === 'spinner') {
      // 旋转风车：把靠近的天体甩开
      var g = new THREE.Group();
      var hub = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.25, r * 0.25, 2.2, 16),
        new THREE.MeshStandardMaterial({ color: 0x222a44, roughness: 0.8 })
      );
      hub.position.y = 1.1; g.add(hub);
      var barMat = new THREE.MeshStandardMaterial({ color: 0x46e3ff, emissive: 0x1a8fb0, emissiveIntensity: 0.5, roughness: 0.5 });
      for (var k = 0; k < 4; k++) {
        var bar = new THREE.Mesh(new THREE.BoxGeometry(r * 2, 1.1, 1.1), barMat);
        bar.position.y = 1.5; bar.rotation.y = k * Math.PI / 2;
        // 让叶片沿径向延伸
        bar.geometry.translate(r, 0, 0);
        g.add(bar);
      }
      g.position.set(x, 0, z); islandGroup.add(g);
      rec.mesh = g; rec.spin = rand(1.4, 2.4) * (Math.random() < 0.5 ? 1 : -1);
    }
    props.push(rec);
  }
  function buildProps() {
    props = [];
    // 蹦床 ×2
    makeProp('trampoline', islandR * 0.5, -islandR * 0.2, 7);
    makeProp('trampoline', -islandR * 0.45, islandR * 0.35, 7);
    // 弹簧坡 ×2
    makeProp('spring', islandR * 0.15, islandR * 0.55, 5.5);
    makeProp('spring', -islandR * 0.6, -islandR * 0.1, 5.5);
    // 减速泥沼 ×2
    makeProp('mud', islandR * 0.1, -islandR * 0.55, 8);
    makeProp('mud', -islandR * 0.2, islandR * 0.1, 8);
    // 加速带 ×2
    makeProp('speed', islandR * 0.62, islandR * 0.15, 5);
    makeProp('speed', -islandR * 0.05, -islandR * 0.35, 5);
    // 中部圆形塌陷陷阱 ×4（停留 5 秒会塌下去）
    makeProp('trap', islandR * 0.22, islandR * 0.18, 11);
    makeProp('trap', -islandR * 0.26, -islandR * 0.12, 11);
    makeProp('trap', islandR * 0.06, -islandR * 0.32, 10);
    makeProp('trap', -islandR * 0.12, islandR * 0.30, 10);
    // 趣味障碍：弹射柱 ×3
    makeProp('bumper', islandR * 0.40, islandR * 0.42, 6);
    makeProp('bumper', -islandR * 0.42, islandR * 0.08, 6);
    makeProp('bumper', islandR * 0.30, -islandR * 0.42, 6);
    // 旋转风车 ×2
    makeProp('spinner', islandR * 0.40, -islandR * 0.10, 12);
    makeProp('spinner', -islandR * 0.34, islandR * 0.30, 12);
  }
  function updateProps(dt, time) {
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (p.type === 'spinner' && p.mesh) {
        p.mesh.rotation.y += p.spin * dt;
      } else if (p.type === 'trap' && p.ring) {
        var o = 0.45 + 0.45 * Math.sin(time * 3 + p.phase);
        p.ring.material.opacity = o;
      }
    }
  }
  function applyProps(b, dt) {
    if (!b.grounded) { b._trapT = 0; return; }   // 离地（被弹飞/掉下）→ 陷阱计时清零
    var onTrap = false;
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      var dx = b.group.position.x - p.x, dz = b.group.position.z - p.z;
      if (dx * dx + dz * dz > p.r * p.r) continue;
      if (p.type === 'trampoline') { b.vel.y = JUMP * 2.3; b.grounded = false; sfx('start'); }
      else if (p.type === 'spring') { b.vel.y = JUMP * 1.6; b.grounded = false; sfx('start'); }
      else if (p.type === 'mud') { b.vel.x *= 0.4; b.vel.z *= 0.4; }
      else if (p.type === 'speed') { b.vel.x *= 1.7; b.vel.z *= 1.7; }
      else if (p.type === 'trap') {
        b._trapT += dt; onTrap = true;
        if (b._trapT >= TRAP_FALL) {
          // 塌陷：强制掉下岛，交给 detectOuts 统一结算
          b.grounded = false; b.vel.y = -3; b.out = true;
          if (b.isPlayer) showHint('💀 踩中陷阱塌下去了！-1 ❤', 1.4);
        }
      } else if (p.type === 'bumper') {
        var dd = Math.hypot(dx, dz) || 1;
        var K = b.isBoss ? 30 : 42;
        b.vel.x += (dx / dd) * K; b.vel.z += (dz / dd) * K;
        b.vel.y = Math.max(b.vel.y, 10); b.grounded = false;
        sfx('hit');
      } else if (p.type === 'spinner') {
        // 被旋转叶片甩开（径向 + 一点切向）
        var dist = Math.hypot(dx, dz) || 1;
        var nx = dx / dist, nz = dz / dist;
        var push = b.isBoss ? 26 : 38;
        b.vel.x += nx * push + (-nz) * push * 0.6 * Math.sign(p.spin);
        b.vel.z += nz * push + (nx) * push * 0.6 * Math.sign(p.spin);
        b.vel.y = Math.max(b.vel.y, 7); b.grounded = false;
        sfx('hit');
      }
      break;
    }
    if (!onTrap) b._trapT = 0;   // 不在任何陷阱上 → 计时清零
  }

  // ============ 激光攻击（替代投石：射出激光弹，削对手血条） ============
  function clearBolts() {
    for (var i = 0; i < bolts.length; i++) { if (bolts[i].mesh.parent) bolts[i].mesh.parent.remove(bolts[i].mesh); }
    bolts = [];
  }
  function aimDir() {
    var aim = new THREE.Vector3(0, 0, -1);
    var best = null, bestD = 1e9;
    for (var i = 0; i < npcs.length; i++) {
      var d = player.group.position.distanceTo(npcs[i].group.position);
      if (d < bestD) { bestD = d; best = npcs[i]; }
    }
    if (best && bestD < 90) aim.copy(best.group.position).sub(player.group.position).normalize();
    else {
      var hl = Math.hypot(player.vel.x, player.vel.z);
      if (hl > 0.5) aim.set(player.vel.x / hl, 0, player.vel.z / hl);
    }
    return aim;
  }
  function fireLaser() {
    if (state !== 'playing' || !player || boltCd > 0) return;
    boltCd = 0.22;
    var aim = aimDir(); aim.y = 0; if (aim.lengthSq() < 0.001) aim.set(0, 0, -1); aim.normalize();
    var origin = player.group.position.clone().addScaledVector(aim, player.R + 0.6);
    origin.y = player.group.position.y + player.R * 0.4;
    var geo = new THREE.CylinderGeometry(0.5, 0.5, 6, 10);
    var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x9bffe6 }));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), aim);
    mesh.position.copy(origin);
    var glow = new THREE.PointLight(0x66ffea, 1.2, 28); mesh.add(glow);
    islandGroup.add(mesh);
    bolts.push({ mesh: mesh, vel: aim.clone().multiplyScalar(120), life: 1.6 });
    sfx('laser');
  }
  function damageNPC(n, dmg, fromPos) {
    if (!n || n._dying || n.out) return;
    n.hp -= dmg;
    if (n.hpBar) updateHpBar(n);
    // 击退
    var dir = n.group.position.clone().sub(fromPos); dir.y = 0;
    var dl = dir.length() || 1; dir.divideScalar(dl);
    var K = n.isBoss ? 14 : 24;
    n.vel.x += dir.x * K; n.vel.z += dir.z * K;
    spawnHitSpark(n.group.position.x, n.group.position.y, n.group.position.z);
    if (n.hp <= 0) killNPC(n);
  }
  function killNPC(n) {
    if (n._dying) return;
    n._dying = true;   // 交给 resolveOuts 统一移除
    spawnBossParticles(n.group.position.x, n.group.position.y, n.group.position.z);
    sfx('destroy');
    if (typeof window.recordIslandEvent === 'function') window.recordIslandEvent('ko');
    // 与“掉下岛”一样走慢动作 + 结算流程：触发 resolveOuts（移除残骸 / BOSS 被打完则判胜）
    if (n.isBoss) { bossDefeated = true; slowmo = Math.max(slowmo, 1.4); }
    else slowmo = Math.max(slowmo, 1.0);
    focus.push(n);
  }
  // 玩家被小星球 / BOSS 撞到：掉血（有受击间隔，防止一帧连扣）
  function damagePlayer(dmg) {
    if (!player || player._done || player._grace > 0 || player._phGrace > 0) return;
    player.hp -= dmg; if (player.hp < 0) player.hp = 0;
    if (player.hpBar) updateHpBar(player);
    player._phGrace = PLAYER_HIT_GRACE;
    spawnHitSpark(player.group.position.x, player.group.position.y + player.R * 0.5, player.group.position.z);
    sfx('hit');
    // 血条空了 → 交给 detectOuts 统一扣红心 + 复活（与掉下岛走同一条路径）
  }
  // ============ 地雷 ============
  function makeMine(pos) {
    var g = new THREE.Group();
    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 2.0, 1.1, 12),
      new THREE.MeshStandardMaterial({ color: 0x252a33, roughness: 0.9, metalness: 0.2 })
    );
    base.position.y = 0.55; g.add(base);
    var cap = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    cap.position.y = 1.5; g.add(cap);
    var gy = terrainHeight(pos.x, pos.z);
    g.position.set(pos.x, gy, pos.z);
    islandGroup.add(g);
    return { group: g, light: cap, x: pos.x, y: gy, z: pos.z, fuse: rand(MINE_FUSE_MIN, MINE_FUSE_MAX), t: 0 };
  }
  function clearMines() {
    for (var i = 0; i < mines.length; i++) { if (mines[i].group.parent) mines[i].group.parent.remove(mines[i].group); }
    mines = [];
  }
  function spawnMine(pos) {
    if (mines.length >= MAX_MINES) return;
    mines.push(makeMine(pos));
    sfx('minePlant');
  }
  // 某些小星球（含 BOSS）周期性在脚下种地雷
  function plantMinesFromNPCs(dt) {
    for (var i = 0; i < npcs.length; i++) {
      var n = npcs[i];
      if (n._dying || n.out || !n.grounded) continue;
      n.mineCd -= dt;
      if (n.mineCd <= 0) {
        n.mineCd = (n.isBoss ? 1.3 : 1.0) * rand(MINE_PLANT_MIN, MINE_PLANT_MAX);
        spawnMine({ x: n.group.position.x, z: n.group.position.z });
      }
    }
  }
  function explodeMine(m) {
    spawnBossParticles(m.x, m.y + 1, m.z);
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.8, 48),
      new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(m.x, m.y + 1, m.z);
    islandGroup.add(ring);
    bossFx.push({ type: 'ring', mesh: ring, life: 0.9 });
    sfx('mine');
    if (player && !player._done) {
      var d = Math.hypot(player.group.position.x - m.x, player.group.position.z - m.z);
      if (d < MINE_RADIUS) damagePlayer(MINE_DMG);
    }
    for (var j = 0; j < npcs.length; j++) {
      var n = npcs[j];
      if (n.out || n._dying) continue;
      var d2 = Math.hypot(n.group.position.x - m.x, n.group.position.z - m.z);
      if (d2 < MINE_RADIUS) damageNPC(n, MINE_DMG, m);
    }
  }
  function updateMines(dt) {
    for (var i = mines.length - 1; i >= 0; i--) {
      var m = mines[i];
      m.fuse -= dt; m.t += dt;
      var near = Math.max(0, MINE_FUSE_MAX - m.fuse);
      var blink = 0.5 + 0.5 * Math.sin(m.t * (6 + near * 1.0));
      m.light.material.color.setRGB(1, 0.18 * blink, 0.15 * blink);
      var s = 1 + 0.35 * blink * (m.fuse < 4 ? 1.6 : 1);
      m.light.scale.set(s, s, s);
      if (m.fuse <= 0) {
        explodeMine(m);
        if (m.group.parent) m.group.parent.remove(m.group);
        mines.splice(i, 1);
      }
    }
  }
  function spawnMinion() {
    var pool = getPool();
    var b = pool[(Math.random() * pool.length) | 0];
    var nb = makeBeing(b, '#ffd24d');
    var a = rand(0, 6.28), rr = rand(islandR * 0.3, islandR * 0.85);
    nb.group.position.set(Math.cos(a) * rr, nb.R, Math.sin(a) * rr);
    nb.ai.tx = rand(-islandR * 0.7, islandR * 0.7);
    nb.ai.tz = rand(-islandR * 0.7, islandR * 0.7);
    npcs.push(nb);
  }
  // 小星球不断重生，围着 BOSS 当“护驾”
  function maintainMinions(dt) {
    if (over || bossDefeated) return;
    var alive = 0;
    for (var i = 0; i < npcs.length; i++) if (!npcs[i].isBoss && !npcs[i]._dying) alive++;
    if (alive < desiredMinions) {
      minionTimer -= dt;
      if (minionTimer <= 0) { spawnMinion(); minionTimer = 1.6; }
    } else minionTimer = 0.4;
  }
  function updateBolts(dt) {
    for (var i = bolts.length - 1; i >= 0; i--) {
      var s = bolts[i];
      s.mesh.position.addScaledVector(s.vel, dt);
      s.life -= dt;
      var hitNpc = null;
      for (var j = 0; j < npcs.length; j++) {
        var n = npcs[j];
        if (n.out || n._dying) continue;
        if (s.mesh.position.distanceTo(n.group.position) < n.R + 1.4) { hitNpc = n; break; }
      }
      if (hitNpc) {
        damageNPC(hitNpc, LASER_DMG, s.mesh.position);
        if (s.mesh.parent) s.mesh.parent.remove(s.mesh);
        bolts.splice(i, 1);
        continue;
      }
      var r2 = Math.hypot(s.mesh.position.x, s.mesh.position.z);
      if (s.life <= 0 || s.mesh.position.y < FALL_Y - 4 || r2 > islandR + 40) {
        if (s.mesh.parent) s.mesh.parent.remove(s.mesh);
        bolts.splice(i, 1);
      }
    }
  }
  function spawnHitSpark(x, y, z) {
    for (var i = 0; i < 8; i++) {
      var m = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x9bffe6, transparent: true, opacity: 1 })
      );
      m.position.set(x, y, z);
      var a = Math.random() * 6.28, sp = rand(6, 14);
      islandGroup.add(m);
      bossFx.push({ type: 'p', mesh: m, vx: Math.cos(a) * sp, vy: rand(2, 8), vz: Math.sin(a) * sp, life: 0.4, max: 0.4 });
    }
  }

  function buildScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03020c);
    scene.fog = new THREE.FogExp2(0x03020c, 0.0055);

    camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 900);
    camera.position.set(0, 42, 58);
    camera.lookAt(0, 3, 0);

    scene.add(new THREE.AmbientLight(0x556688, 0.95));
    var dir = new THREE.DirectionalLight(0xffffff, 0.95); dir.position.set(20, 45, 20); scene.add(dir);
    var pl = new THREE.PointLight(0x33aaff, 0.6, 320); pl.position.set(-30, 30, -20); scene.add(pl);

    starfield = makeStarfield(); scene.add(starfield);

    islandGroup = new THREE.Group(); scene.add(islandGroup);
    var disc = new THREE.Mesh(
      new THREE.CylinderGeometry(islandR, islandR * 0.8, 5, 64),
      new THREE.MeshStandardMaterial({ color: 0x101830, roughness: 1, metalness: 0.1 })
    );
    disc.position.y = -2.5; islandGroup.add(disc);
    var top = new THREE.Mesh(
      new THREE.CircleGeometry(islandR, 64),
      new THREE.MeshStandardMaterial({ color: 0x152046, roughness: 1 })
    );
    top.rotation.x = -Math.PI / 2; top.position.y = 0.02; islandGroup.add(top);
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(islandR, 0.6, 12, 90),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff })
    );
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.25; islandGroup.add(rim);
    var neb = [0x2244aa, 0x442288, 0x116655];
    for (var i = 0; i < 6; i++) {
      var patch = new THREE.Mesh(
        new THREE.CircleGeometry(rand(4, 10), 24),
        new THREE.MeshBasicMaterial({ color: neb[i % 3], transparent: true, opacity: 0.45 })
      );
      patch.rotation.x = -Math.PI / 2;
      var a = rand(0, 6.28), rr = rand(8, islandR * 0.7);
      patch.position.set(Math.cos(a) * rr, 0.03, Math.sin(a) * rr);
      islandGroup.add(patch);
    }
    ramps = [];
    addRamp(0, islandR * 0.16, islandR * 0.5, 20);
    addRamp(Math.PI * 0.66, islandR * 0.15, islandR * 0.5, 18);
    addRamp(-Math.PI * 0.66, islandR * 0.15, islandR * 0.5, 18);
    buildProps();
  }

  // ============ NPC ============
  function spawnNPCs() {
    npcs.forEach(function (n) { scene.remove(n.group); });
    npcs = [];
    bossDefeated = false;
    // 清理上一次 BOSS 出场特效残留
    bossFx.forEach(function (f) { if (f.mesh.parent) f.mesh.parent.remove(f.mesh); });
    bossFx = [];
    var pool = getPool();
    // 大 BOSS 天体（血条打空 / 被挤下岛 都算玩家胜）
    var bossBody = pool[(Math.random() * pool.length) | 0];
    var boss = makeBeing(bossBody, '#ff4d6d', true);
    boss.group.position.set(rand(-islandR * 0.15, islandR * 0.15), boss.R, rand(-islandR * 0.15, islandR * 0.15));
    boss.ai.tx = 0; boss.ai.tz = 0; boss.ai.hopCd = rand(3, 6);
    currentBoss = boss;
    npcs.push(boss);
    // “护驾”小星球（被激光炸了会不断重生，围着 BOSS）
    for (var i = 0; i < desiredMinions; i++) {
      var b = pool[(Math.random() * pool.length) | 0];
      var nb = makeBeing(b, '#ffd24d');
      var a = rand(0, 6.28), rr = rand(islandR * 0.3, islandR * 0.85);
      nb.group.position.set(Math.cos(a) * rr, nb.R, Math.sin(a) * rr);
      nb.ai.tx = rand(-islandR * 0.7, islandR * 0.7);
      nb.ai.tz = rand(-islandR * 0.7, islandR * 0.7);
      npcs.push(nb);
    }
    minionTimer = 0.4;
  }

  // ============ 街道摊贩（纯装饰，推车在岛上溜达） ============
  var VENDOR_KINDS = [
    { emoji: '🍖', label: '叉烧', color: 0xff6b5a, roof: 0xffd24d },
    { emoji: '🧋', label: '奶茶', color: 0xc9a07a, roof: 0xff9ec4 },
    { emoji: '🍜', label: '拉面', color: 0xffa64d, roof: 0xff5a3c },
    { emoji: '🍦', label: '冰淇淋', color: 0xffc0e0, roof: 0x9bdcff },
    { emoji: '🍢', label: '烤串', color: 0xd98b4a, roof: 0xffe24d },
    { emoji: '🍔', label: '汉堡', color: 0xf2b84b, roof: 0x7bd16b },
    { emoji: '☕', label: '咖啡', color: 0x8a5a3b, roof: 0xc0a080 },
    { emoji: '🥞', label: '煎饼', color: 0xe8c878, roof: 0xff8f6b }
  ];
  function vendorFaceTexture(kind) {
    var c = document.createElement('canvas'); c.width = 128; c.height = 128;
    var x = c.getContext('2d');
    // 小摊主：圆脸 + 厨师帽 + 笑脸
    x.fillStyle = '#ffe0bd'; x.beginPath(); x.arc(64, 70, 34, 0, 6.28); x.fill();
    x.fillStyle = '#ffffff'; x.beginPath(); x.ellipse(64, 40, 30, 16, 0, 0, 6.28); x.fill();
    x.fillStyle = '#222'; x.beginPath(); x.arc(52, 66, 5, 0, 6.28); x.fill();
    x.beginPath(); x.arc(76, 66, 5, 0, 6.28); x.fill();
    x.strokeStyle = '#a8521f'; x.lineWidth = 4; x.beginPath(); x.arc(64, 80, 14, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    x.fillStyle = kind.color ? '#fff' : '#fff';
    var t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  function vendorSignTexture(kind) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 128;
    var x = c.getContext('2d');
    x.clearRect(0, 0, 256, 128);
    x.fillStyle = 'rgba(20,12,30,0.82)';
    x.fillRect(8, 8, 240, 112);
    x.strokeStyle = '#ffd24d'; x.lineWidth = 6; x.strokeRect(8, 8, 240, 112);
    x.font = '64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(kind.emoji, 70, 64);
    x.font = 'bold 40px sans-serif'; x.fillStyle = '#ffe9a8';
    x.fillText(kind.label, 170, 64);
    var t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  function makeVendor(kind, radius, angle, dir) {
    var g = new THREE.Group();
    // 车身
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(7, 3, 4.5),
      new THREE.MeshStandardMaterial({ color: kind.color, roughness: 0.7 })
    );
    body.position.y = 2.4; g.add(body);
    // 顶棚（条纹感：用 roof 色 + 白）
    var roof = new THREE.Mesh(
      new THREE.BoxGeometry(7.6, 1.2, 5),
      new THREE.MeshStandardMaterial({ color: kind.roof, roughness: 0.6 })
    );
    roof.position.y = 4.4; g.add(roof);
    // 轮子
    var wmat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.9 });
    for (var s = -1; s <= 1; s += 2) {
      var w = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.8, 16), wmat);
      w.rotation.z = Math.PI / 2; w.position.set(0, 1.1, s * 2.4); g.add(w);
    }
    // 招牌
    var sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: vendorSignTexture(kind), transparent: true, depthTest: false }));
    sign.scale.set(7, 3.5, 1); sign.position.set(0, 7.2, 0); sign.renderOrder = 7; g.add(sign);
    // 摊主（小卡通脸，永远朝相机）
    var face = new THREE.Sprite(new THREE.SpriteMaterial({ map: vendorFaceTexture(kind), transparent: true }));
    face.scale.set(4, 4, 1); face.position.set(0, 5.2, 2.6); g.add(face);
    // 货品（头顶一个发光小圆，表示在卖的东西）
    var goods = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 14, 12),
      new THREE.MeshBasicMaterial({ color: kind.roof })
    );
    goods.position.set(0, 3.4, 0); g.add(goods);
    islandGroup.add(g);
    return {
      group: g, kind: kind, radius: radius, angle: angle, dir: dir,
      speed: rand(0.05, 0.11) * (islandR / 104), bob: rand(0, 6.28),
      goods: goods, baseY: 0
    };
  }
  function clearVendors() {
    for (var i = 0; i < vendors.length; i++) { if (vendors[i].group.parent) vendors[i].group.parent.remove(vendors[i].group); }
    vendors = [];
  }
  function spawnVendors() {
    clearVendors();
    var n = VENDOR_KINDS.length;
    for (var i = 0; i < n; i++) {
      var k = VENDOR_KINDS[i];
      var radius = islandR * (0.33 + 0.5 * (i / Math.max(1, n - 1)));
      var angle = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
      var dir = (i % 2 === 0) ? 1 : -1;
      vendors.push(makeVendor(k, radius, angle, dir));
    }
  }
  function updateVendors(dt) {
    for (var i = 0; i < vendors.length; i++) {
      var v = vendors[i];
      if (v.eaten) {                       // 被吃掉后先消失，过一会儿换个位置重新营业
        v.cooldown -= dt;
        if (v.cooldown <= 0) {
          v.eaten = false; v.group.visible = true;
          v.angle = rand(0, 6.28);
          v.radius = islandR * (0.33 + 0.5 * Math.random());
          v.dir = (Math.random() < 0.5) ? 1 : -1;
        }
        continue;
      }
      v.angle += v.dir * v.speed * dt;
      var r = v.radius + Math.sin(v.angle * 1.7) * islandR * 0.06;
      var px = Math.cos(v.angle) * r, pz = Math.sin(v.angle) * r;
      v.bob += dt * 3;
      v.group.position.set(px, Math.abs(Math.sin(v.bob)) * 0.8, pz);
      // 朝切线方向（推车前进方向）
      v.group.rotation.y = v.angle + (v.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }
  // 玩家星球碰到摊贩 → 吃掉回血（摊贩暂时消失，之后重新出现）
  function checkVendorEat() {
    if (!player) return;
    for (var i = 0; i < vendors.length; i++) {
      var v = vendors[i];
      if (v.eaten) continue;
      var dx = player.group.position.x - v.group.position.x;
      var dz = player.group.position.z - v.group.position.z;
      var dy = player.group.position.y - (v.group.position.y + 3);
      if (dx * dx + dy * dy + dz * dz < (player.R + v.radius + 1.6) * (player.R + v.radius + 1.6)) {
        eatVendor(v);
      }
    }
  }
  function eatVendor(v) {
    v.eaten = true; v.cooldown = VENDOR_RESPAWN; v.group.visible = false;
    if (player && player.hpBar) {
      player.hp = Math.min(player.maxHp, player.hp + VENDOR_HEAL);
      updateHpBar(player);
    }
    sfx('heal');
    showHint('🍴 吃到' + v.kind.label + '！回血 +' + VENDOR_HEAL, 1.2);
    spawnHitSpark(v.group.position.x, v.group.position.y + 3, v.group.position.z);
  }

  // ============ 物理 ============
  function stepBeing(b, dt) {
    b.vel.y -= GRAV * dt;
    b.group.position.addScaledVector(b.vel, dt);
    var r2 = Math.hypot(b.group.position.x, b.group.position.z);
    var onIsland = r2 <= islandR;                 // 岛外的虚空没有地面
    var gy = onIsland ? terrainHeight(b.group.position.x, b.group.position.z) : -1e9;
    var floor = gy + b.R;
    if (gy > -1e8 && b.group.position.y <= floor) {
      b.group.position.y = floor;
      if (b.vel.y < 0) b.vel.y = -b.vel.y * REST;
      if (Math.abs(b.vel.y) < 1.2) b.vel.y = 0;
      b.grounded = true;
    } else {
      b.grounded = false;
    }
    // 掉下岛（复活无敌期内不判定掉岛，并把玩家拉回安全点，避免复活瞬间被挤下岛又扣第二颗心）
    if (b.group.position.y < FALL_Y) {
      if (b === player && b._grace > 0) {
        b.group.position.set(islandR * 0.5, b.R, islandR * 0.5);
        b.vel.set(0, 0, 0);
      } else {
        b.out = true;
      }
    } else applyProps(b, dt);
  }

  function rollSphere(b, dt) {
    var vx = b.vel.x, vz = b.vel.z;
    var sp = Math.hypot(vx, vz);
    if (sp > 0.001) {
      var axis = new THREE.Vector3(vz, 0, -vx).normalize();
      var ang = sp * dt / b.R;
      var q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
      b.sphere.quaternion.premultiply(q);
    }
  }

  function applyPlayerInput(dt) {
    if (!player) return;
    var a = ACCEL * (boosting ? BOOST_MULT : 1);
    var max = boosting ? BOOST_MAXSPD : MAXSPD;
    if (input.active) {
      player.vel.x += input.x * a * dt;
      player.vel.z += input.z * a * dt;
    }
    if (player.grounded) {
      var d = Math.exp(-DRAG * dt);
      player.vel.x *= d; player.vel.z *= d;
    }
    var sp = Math.hypot(player.vel.x, player.vel.z);
    if (sp > max) { var k = max / sp; player.vel.x *= k; player.vel.z *= k; }
  }

  function tryJump() {
    if (player && player.grounded && player.jumpCd <= 0) {
      player.vel.y = JUMP * (boosting ? 1.3 : 1);
      player.jumpCd = 0.25;
      sfx('start');
    }
  }

  function stepNPC(b, dt) {
    b.jumpCd -= dt;
    if (player) {
      var dx = player.group.position.x - b.group.position.x;
      var dz = player.group.position.z - b.group.position.z;
      if (Math.hypot(dx, dz) < 16 && Math.random() < 0.012) {
        b.ai.seek = true; b.ai.tx = player.group.position.x; b.ai.tz = player.group.position.z;
      }
    }
    // 随机加速冲刺（朝玩家或随机方向猛冲）
    if (b.ai.dash > 0) {
      b.ai.dash -= dt;
      var gx = b.ai.dashTx - b.group.position.x, gz = b.ai.dashTz - b.group.position.z;
      var gl = Math.hypot(gx, gz) || 1;
      b.vel.x += (gx / gl) * 50 * dt; b.vel.z += (gz / gl) * 50 * dt;
    } else if (Math.random() < 0.004) {
      b.ai.dash = rand(0.5, 1.2);
      if (player && Math.hypot(player.group.position.x - b.group.position.x, player.group.position.z - b.group.position.z) < 42) {
        b.ai.dashTx = player.group.position.x; b.ai.dashTz = player.group.position.z;
      } else {
        b.ai.dashTx = rand(-islandR * 0.85, islandR * 0.85);
        b.ai.dashTz = rand(-islandR * 0.85, islandR * 0.85);
      }
    }
    if (b.ai.seek) {
      var tx = b.ai.tx - b.group.position.x, tz = b.ai.tz - b.group.position.z;
      var tl = Math.hypot(tx, tz);
      if (tl > 0.5) { b.vel.x += (tx / tl) * 30 * dt; b.vel.z += (tz / tl) * 30 * dt; }
      else b.ai.seek = false;
    } else {
      var wx = b.ai.tx - b.group.position.x, wz = b.ai.tz - b.group.position.z;
      var wl = Math.hypot(wx, wz);
      if (wl < 1.5 || b.ai.hopCd <= -3) {
        b.ai.tx = rand(-islandR * 0.7, islandR * 0.7);
        b.ai.tz = rand(-islandR * 0.7, islandR * 0.7);
        b.ai.hopCd = rand(2, 6);
      } else if (wl > 0.5) {
        b.vel.x += (wx / wl) * 18 * dt; b.vel.z += (wz / wl) * 18 * dt;
      }
    }
    if (b.grounded && b.ai.hopCd <= 0 && Math.random() < 0.02) {
      b.vel.y = JUMP * rand(0.7, 1.0); b.ai.hopCd = rand(2.5, 6); sfx('shoot');
    }
    var sp = Math.hypot(b.vel.x, b.vel.z), mx = b.ai.dash > 0 ? 36 : 20;
    if (sp > mx) { var k = mx / sp; b.vel.x *= k; b.vel.z *= k; }
    if (b.grounded) { var d = Math.exp(-DRAG * 1.3 * dt); b.vel.x *= d; b.vel.z *= d; }
  }

  function collide(a, b) {
    var dx = b.group.position.x - a.group.position.x;
    var dy = b.group.position.y - a.group.position.y;
    var dz = b.group.position.z - a.group.position.z;
    var dist = Math.hypot(dx, dy, dz);
    var minD = a.R + b.R;
    if (dist <= 0 || dist >= minD) return;
    var nx = dx / dist, ny = dy / dist, nz = dz / dist;
    var overlap = minD - dist, total = a.mass + b.mass;
    a.group.position.x -= nx * overlap * (b.mass / total);
    a.group.position.y -= ny * overlap * (b.mass / total);
    a.group.position.z -= nz * overlap * (b.mass / total);
    b.group.position.x += nx * overlap * (a.mass / total);
    b.group.position.y += ny * overlap * (a.mass / total);
    b.group.position.z += nz * overlap * (a.mass / total);
    var vn = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny + (b.vel.z - a.vel.z) * nz;
    if (vn < 0) {
      var e = 0.62;
      var j = -(1 + e) * vn / (1 / a.mass + 1 / b.mass);
      a.vel.x -= (j / a.mass) * nx; a.vel.y -= (j / a.mass) * ny; a.vel.z -= (j / a.mass) * nz;
      b.vel.x += (j / b.mass) * nx; b.vel.y += (j / b.mass) * ny; b.vel.z += (j / b.mass) * nz;
      if (a === player || b === player) { collisions++; updateScore(); sfx('hit'); damagePlayer(PLAYER_HIT_DMG); }
    }
  }

  function updateCamera(dt) {
    var k = Math.min(1, dt * 4);
    // BOSS 出场：聚焦 BOSS + 镜头抖动
    if (state === 'bossIntro' && currentBoss) {
      var bp = currentBoss.group.position;
      var tx = bp.x, ty = bp.y + 22, tz = bp.z + BOSS_INTRO_DIST;
      var kb = Math.min(1, dt * 3);
      camera.position.x += (tx - camera.position.x) * kb;
      camera.position.y += (ty - camera.position.y) * kb;
      camera.position.z += (tz - camera.position.z) * kb;
      if (camShake > 0) {
        camera.position.x += (Math.random() - 0.5) * camShake * 4;
        camera.position.y += (Math.random() - 0.5) * camShake * 4;
      }
      camera.lookAt(bp.x, bp.y, bp.z);
      return;
    }
    // 慢动作：聚焦正在掉下岛的天体
    if (slowmo > 0 && focus.length) {
      var f = focus[0].group.position;
      var tx = f.x, ty = f.y + 20, tz = f.z + 40;
      camera.position.x += (tx - camera.position.x) * k;
      camera.position.y += (ty - camera.position.y) * k;
      camera.position.z += (tz - camera.position.z) * k;
      camera.lookAt(f.x, f.y, f.z);
      return;
    }
    // 自由旋转视角
    if (camMode === 'orbit') {
      var tgt = player ? player.group.position : new THREE.Vector3(0, 2, 0);
      var cx = tgt.x + camDist * Math.cos(camEl) * Math.sin(camAz);
      var cy = tgt.y + camDist * Math.sin(camEl);
      var cz = tgt.z + camDist * Math.cos(camEl) * Math.cos(camAz);
      camera.position.x += (cx - camera.position.x) * Math.min(1, dt * 8);
      camera.position.y += (cy - camera.position.y) * Math.min(1, dt * 8);
      camera.position.z += (cz - camera.position.z) * Math.min(1, dt * 8);
      camera.lookAt(tgt.x, tgt.y + 4, tgt.z);
      return;
    }
    if (!player) { camera.lookAt(0, 2, 0); return; }
    var p = player.group.position;
    var px = p.x, py = p.y + CAM_FOLLOW_H, pz = p.z + CAM_FOLLOW_DIST;
    camera.position.x += (px - camera.position.x) * k;
    camera.position.y += (py - camera.position.y) * k;
    camera.position.z += (pz - camera.position.z) * k;
    camera.lookAt(p.x, p.y + 3, p.z);
  }

  // ============ 出局 / 胜负 ============
  function updateHearts() {
    if (heartsEl) heartsEl.textContent = '❤'.repeat(Math.max(0, lives)) + '🖤'.repeat(Math.max(0, LIVES - lives));
  }
  // 玩家复活：回到安全点、满血、清空陷阱/受击计时，并开启无敌期（防止复活又被秒扣第二颗心）
  function respawnPlayer() {
    player.group.position.set(islandR * 0.5, player.R, islandR * 0.5);
    player.vel.set(0, 0, 0);
    player.out = false;
    player._trapT = 0;                 // 关键：清空陷阱停留计时，否则落回中心陷阱会秒掉第二颗心
    player.hp = player.maxHp; if (player.hpBar) updateHpBar(player);
    player._respawning = false; player._outHandled = false;
    player._grace = PLAYER_RESPAWN_GRACE;   // 无敌期：这段时间再被撞下岛也不扣心
  }
  // 检测到掉下岛的天体 → 触发慢动作，但不立即结算
  function detectOuts() {
    // 玩家掉岛 / 血条耗尽：用 _outHandled + 复活无敌期(_grace) 防止一次事件连扣两颗红心
    if (player && !player._done && !player._outHandled && player._grace <= 0 && (player.out || player.hp <= 0)) {
      player.out = false; player._outHandled = true; lives--; updateHearts(); sfx('lifeLost');
      if (lives <= 0) player._pendingEnd = 'lose';
      else player._respawning = true;
      focus.push(player);
      slowmo = Math.max(slowmo, 1.2);
      showHint(player._pendingEnd ? '💥 KO！红心耗尽' : (player.hp <= 0 ? '💥 被撞爆！-1 ❤' : 'KO！掉下岛 -1 ❤'), 1.4);
    }
    for (var i = 0; i < npcs.length; i++) {
      if (npcs[i].out && !npcs[i]._dying) {
        npcs[i].out = false; npcs[i]._dying = true;
        if (npcs[i].isBoss) bossDefeated = true;   // BOSS 被挤下岛 → 玩家胜
        focus.push(npcs[i]);
        slowmo = Math.max(slowmo, 1.0);
        sfx('hit');
        if (typeof window.recordIslandEvent === 'function') window.recordIslandEvent('ko');
      }
    }
  }
  // 慢动作结束后结算
  function resolveOuts() {
    for (var i = npcs.length - 1; i >= 0; i--) {
      if (npcs[i]._dying) { scene.remove(npcs[i].group); npcs.splice(i, 1); }
    }
    if (player) {
      if (player._pendingEnd === 'lose') { endGame(false); }
      else if (player._respawning) {
        respawnPlayer();
        showHint('稳住了！无敌 2 秒，去吃摊贩回血～', 1.4);
      }
    }
    if (bossDefeated && !over) { endGame(true); return; }
    if (npcs.length === 0 && !over) {
      endGame(true);
    }
    focus = [];
  }
  function endGame(win) {
    over = true; state = 'over';
    var secs = playStartMs ? ((performance.now() - playStartMs) / 1000) : 0;
    var tstr = '，坚持了 ' + secs.toFixed(1) + ' 秒';
    if (overTitleEl) overTitleEl.textContent = win ? '🎉 胜利！' : '💥 被淘汰';
    if (overSubEl) overSubEl.textContent = win
      ? (bossDefeated ? ('激光把 BOSS 轰爆啦，护驾小星球全溃散！' + tstr) : ('所有对手（含 BOSS）都被挤下岛啦！' + tstr))
      : ('红心用完了，再接再厉！' + tstr);
    if (overEl) overEl.style.display = 'flex';
    if (player) player._done = true;
    slowmo = 0; focus = [];
    if (window.Bgm) window.Bgm.boss(false);
    if (typeof window.recordIslandEvent === 'function') window.recordIslandEvent(win ? 'win' : 'lose');
    sfx(win ? 'levelUp' : 'gameOver');
  }
  function restart() {
    if (overEl) overEl.style.display = 'none';
    lives = LIVES; updateHearts();
    npcs.forEach(function (n) { scene.remove(n.group); }); npcs = [];
    clearBolts();
    clearMines();
    spawnNPCs();
    if (player) {
      player.group.position.set(0, player.R, 0); player.vel.set(0, 0, 0);
      player.out = false; player._done = false; player._respawning = false; player._pendingEnd = null; player._outHandled = false; player._grace = 0; player._phGrace = 0;
      player.hp = player.maxHp; if (player.hpBar) updateHpBar(player);
    }
    bossDefeated = false;
    slowmo = 0; focus = []; camMode = 'follow';
    over = false;
    collisions = 0; updateScore();
    if (viewBtn) { viewBtn.textContent = '🔄 视角'; viewBtn.classList.remove('active'); }
    triggerBossEntrance();
  }

  // ============ BOSS 专属出场特效 ============
  function spawnShockwave(x, z) {
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.6, 48),
      new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.4, z);
    islandGroup.add(ring);
    bossFx.push({ type: 'ring', mesh: ring, life: 1.0 });
  }
  function spawnBossParticles(x, y, z) {
    var cols = [0xffd24d, 0xff5a3c, 0xff2d6b, 0xffffff];
    for (var i = 0; i < 30; i++) {
      var c = cols[(Math.random() * cols.length) | 0];
      var m = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 8, 8),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 1 })
      );
      m.position.set(x, y, z);
      var a = Math.random() * 6.28, el = rand(0.2, 1.4), sp = rand(8, 22);
      islandGroup.add(m);
      bossFx.push({
        type: 'p', mesh: m,
        vx: Math.cos(a) * sp * Math.cos(el), vy: Math.sin(el) * sp + 6, vz: Math.sin(a) * sp * Math.cos(el),
        life: rand(0.7, 1.3), max: 1.3
      });
    }
  }
  function triggerBossEntrance() {
    if (!currentBoss) return;
    var boss = currentBoss;
    boss._entering = true;
    state = 'bossIntro';
    bossIntroT = 2.0;
    // 从岛下方升起 + 由小变大
    boss.group.position.set(0, -14, -12);
    boss.group.scale.set(0.2, 0.2, 0.2);
    boss.vel.set(0, 0, 0);
    spawnShockwave(boss.group.position.x, boss.group.position.z);
    spawnBossParticles(boss.group.position.x, boss.group.position.y + 2, boss.group.position.z);
    camShake = 0.85;
    // 全屏红光 + 横幅
    if (bossFlashEl) {
      bossFlashEl.style.transition = 'none';
      bossFlashEl.style.opacity = '0.75';
      requestAnimationFrame(function () {
        bossFlashEl.style.transition = 'opacity 1s ease-out';
        bossFlashEl.style.opacity = '0';
      });
    }
    if (bossBannerEl) {
      bossBannerEl.textContent = '👑 BOSS 登场！';
      bossBannerEl.classList.add('show');
      clearTimeout(triggerBossEntrance._t);
      triggerBossEntrance._t = setTimeout(function () { if (bossBannerEl) bossBannerEl.classList.remove('show'); }, 1800);
    }
    sfx('bossIntro');
    if (window.Bgm) window.Bgm.boss(true);
    showHint('BOSS 登场！把它也挤下岛！', 2.2);
  }
  function updateBossFx(dt) {
    for (var i = bossFx.length - 1; i >= 0; i--) {
      var f = bossFx[i];
      if (f.type === 'ring') {
        var s = 1 + (1 - f.life) * 40;
        f.mesh.scale.set(s, s, 1);
        f.mesh.material.opacity = f.life * 0.9;
        f.life -= dt * 1.1;
      } else {
        f.vy -= 30 * dt;
        f.mesh.position.x += f.vx * dt;
        f.mesh.position.y += f.vy * dt;
        f.mesh.position.z += f.vz * dt;
        f.life -= dt;
        f.mesh.material.opacity = Math.max(0, f.life / f.max);
      }
      if (f.life <= 0) { if (f.mesh.parent) f.mesh.parent.remove(f.mesh); bossFx.splice(i, 1); }
    }
  }
  function updateBossIntro(dt) {
    bossIntroT -= dt;
    var boss = currentBoss;
    if (boss) {
      var t = clamp(1 - bossIntroT / 2.0, 0, 1);
      var ease = t * t * (3 - 2 * t);          // smoothstep
      var ty = boss.R;
      boss.group.position.y = -14 + (ty + 14) * ease;
      var sc = 0.2 + 0.8 * ease;
      boss.group.scale.set(sc, sc, sc);
      boss.group.rotation.y += dt * 2.2;
      if (t >= 1) { boss.group.scale.set(1, 1, 1); boss._entering = false; }
    }
    updateBossFx(dt);
    if (camShake > 0) camShake = Math.max(0, camShake - dt * 1.2);
    if (bossIntroT <= 0) { state = 'playing'; playStartMs = performance.now(); }
  }

  // ============ 主循环 ============
  function loop(t) {
    if (!running) return;
    var dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;

    // BOSS 出场动画：全屏暂停物理，只播放升腾 / 冲击波 / 抖动
    if (state === 'bossIntro') {
      updateBossIntro(dt);
      updateCamera(dt);
      if (starfield) starfield.rotation.y += dt * 0.02;
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(loop);
      return;
    }

    var slow = slowmo > 0;
    var sdt = slow ? dt * 0.32 : dt;   // 慢动作时物理减速
    if (boltCd > 0) boltCd -= dt;
    if (player && player._grace > 0) player._grace -= dt;
    if (player && player._phGrace > 0) player._phGrace -= dt;

    if (state === 'playing') applyPlayerInput(sdt);
    if (player) { stepBeing(player, sdt); if (player.jumpCd > 0) player.jumpCd -= sdt; }
    for (var i = 0; i < npcs.length; i++) { stepNPC(npcs[i], sdt); stepBeing(npcs[i], sdt); }
    if (state === 'playing') {
      for (var a = 0; a < npcs.length; a++) if (!npcs[a]._dying && !(player && player._grace > 0)) collide(player, npcs[a]);
      for (var c = 0; c < npcs.length; c++) for (var d = c + 1; d < npcs.length; d++) if (!npcs[c]._dying && !npcs[d]._dying) collide(npcs[c], npcs[d]);
      detectOuts();
      updateBolts(sdt);
      maintainMinions(sdt);
      plantMinesFromNPCs(sdt);   // 小星球 / BOSS 周期性种地雷
      updateMines(sdt);          // 地雷倒计时 + 引爆
      checkVendorEat();
    }
    if (player) rollSphere(player, sdt);
    for (var e = 0; e < npcs.length; e++) rollSphere(npcs[e], sdt);
    updateProps(sdt, t / 1000);
    updateBossFx(dt);
    updateVendors(dt);
    updateCamera(slow ? dt : dt);
    if (starfield) starfield.rotation.y += dt * 0.02;

    if (slowmo > 0) {
      slowmo -= dt;
      if (slowmo <= 0 && focus.length) resolveOuts();
    }

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  // ============ 选星球 ============
  function showSelect(show) {
    selectEl.style.display = show ? 'flex' : 'none';
    if (show) renderSelectGrid();
  }
  function renderSelectGrid() {
    gridEl.innerHTML = '';
    getPool().forEach(function (body) {
      var chip = document.createElement('div'); chip.className = 'island-chip';
      var cv = document.createElement('canvas'); cv.width = 108; cv.height = 108;
      drawChip(cv, body);
      var nm = document.createElement('div'); nm.textContent = body.name;
      var rd = document.createElement('div'); rd.className = 'island-chip-r'; rd.textContent = fmtR(body.radius);
      chip.appendChild(cv); chip.appendChild(nm); chip.appendChild(rd);
      chip.addEventListener('click', function () { beginPlay(body); });
      gridEl.appendChild(chip);
    });
  }
  function drawChip(cv, body) {
    var x = cv.getContext('2d');
    x.save();
    x.beginPath(); x.arc(54, 54, 52, 0, 6.28); x.clip();
    var img = window.PKImageCache && (window.PKImageCache[body.id] || window.PKImageCache[body.name]);
    if (img && img.complete && img.naturalWidth) {
      var ir = Math.max(108 / img.naturalWidth, 108 / img.naturalHeight);
      x.drawImage(img, 54 - img.naturalWidth * ir / 2, 54 - img.naturalHeight * ir / 2, img.naturalWidth * ir, img.naturalHeight * ir);
    } else {
      x.fillStyle = body.color || '#88aaff'; x.fillRect(0, 0, 108, 108);
    }
    x.restore();
  }

  function beginPlay(body) {
    showSelect(false);
    clearBolts();
    if (player) scene.remove(player.group);
    player = makeBeing(body, '#9be7ff', false, true);
    player.group.position.set(0, player.R, 0);
    player._done = false; player._respawning = false; player._pendingEnd = null; player._outHandled = false; player._grace = 0;
    bossDefeated = false;
    over = false;
    slowmo = 0; focus = []; camMode = 'follow';
    lives = LIVES; updateHearts();
    collisions = 0; updateScore();
    if (viewBtn) { viewBtn.textContent = '🔄 视角'; viewBtn.classList.remove('active'); }
    if (window.Sfx && window.Sfx.unlock) window.Sfx.unlock();
    if (window.Bgm) window.Bgm.start();
    showHint('摇杆遥控前后左右 · 点星球起跳 · 长按马力冲坡 · ⚡激光射爆对手（含BOSS）· 撞摊贩回血 · 小心💣地雷', 3.8);
    triggerBossEntrance();
  }

  function updateScore() { if (scoreEl) scoreEl.textContent = '碰撞 ' + collisions; }
  function showHint(msg, dur) {
    if (!hintEl) return;
    hintEl.textContent = msg; hintEl.style.opacity = '1';
    clearTimeout(showHint._t);
    showHint._t = setTimeout(function () { hintEl.style.opacity = '0'; }, (dur || 2) * 1000);
  }

  // ============ 尺寸 ============
  function resize() {
    var rect = canvas.getBoundingClientRect();
    W = rect.width || (window.innerWidth || 360);
    H = rect.height || (window.innerHeight * 0.7 || 480);
    dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    if (camera) { camera.aspect = W / H; camera.updateProjectionMatrix(); }
  }

  // ============ 初始化 / 输入绑定 ============
  function init() {
    canvas = $('island-canvas');
    selectEl = $('island-select');
    gridEl = $('island-select-grid');
    hintEl = $('island-hint');
    boostBtn = $('island-boost');
    muteBtn = $('island-mute');
    stickEl = $('island-stick');
    stickThumbEl = $('island-stick-thumb');
    scoreEl = $('island-score');
    heartsEl = $('island-hearts');
    overEl = $('island-over');
    overTitleEl = $('island-over-title');
    overSubEl = $('island-over-sub');
    viewBtn = $('island-view');
    bossFlashEl = $('island-boss-flash');
    bossBannerEl = $('island-boss-banner');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });

    canvas.addEventListener('pointerdown', function (e) {
      if (window.Sfx && window.Sfx.unlock) window.Sfx.unlock();
      var rect = canvas.getBoundingClientRect();
      pointers[e.pointerId] = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (state !== 'playing') return;
      if (camMode === 'orbit') return;     // 旋转视角模式：不跳不滚，只转相机
      var x = e.clientX - rect.left, y = e.clientY - rect.top;
      ndc.x = (x / rect.width) * 2 - 1; ndc.y = -(y / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      var hit = player ? raycaster.intersectObject(player.sphere) : [];
      if (hit.length > 0) tryJump();
      drag.id = e.pointerId; drag.x0 = x; drag.y0 = y; drag.lastX = x; drag.lastY = y;
      input.active = true; input.x = 0; input.z = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left, y = e.clientY - rect.top;
      var px = pointers[e.pointerId].x, py = pointers[e.pointerId].y;
      pointers[e.pointerId] = { x: x, y: y };
      if (camMode === 'orbit') {
        var ids = Object.keys(pointers);
        if (ids.length >= 2) {
          // 双指捏合缩放
          var p0 = pointers[ids[0]], p1 = pointers[ids[1]];
          var d = Math.hypot(p0.x - p1.x, p0.y - p1.y);
          if (orbitPinchLast > 0) camDist = clamp(camDist * (orbitPinchLast / d), 24, 130);
          orbitPinchLast = d;
        } else {
          camAz -= (x - px) * 0.006;
          camEl = clamp(camEl + (y - py) * 0.006, 0.12, 1.45);
          orbitPinchLast = 0;
        }
        return;
      }
      if (!input.active || drag.id !== e.pointerId) return;
      drag.lastX = x; drag.lastY = y;
      var tdx = x - drag.x0, tdy = y - drag.y0;
      input.x = clamp(tdx * 0.02, -1, 1);   // 右滑 → +X
      input.z = clamp(tdy * 0.02, -1, 1);   // 上滑(tdy<0) → -Z（向前）
    });
    function endDrag(e) {
      if (e && pointers[e.pointerId]) delete pointers[e.pointerId];
      orbitPinchLast = 0;
      if (Object.keys(pointers).length === 0) {
        input.active = false; input.x = 0; input.z = 0; drag.id = null;
      }
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') endDrag(e); });

    boostBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); boosting = true; boostBtn.classList.add('boosting'); });
    boostBtn.addEventListener('pointerup', function () { boosting = false; boostBtn.classList.remove('boosting'); });
    boostBtn.addEventListener('pointerleave', function () { boosting = false; boostBtn.classList.remove('boosting'); });
    boostBtn.addEventListener('pointercancel', function () { boosting = false; boostBtn.classList.remove('boosting'); });

    muteBtn.addEventListener('click', function () {
      var m = window.Sfx ? window.Sfx.toggleMute() : false;
      muteBtn.textContent = m ? '🔇' : '🔊';
    });
    if (muteBtn && window.Sfx) muteBtn.textContent = window.Sfx.isMuted() ? '🔇' : '🔊';

    var stoneBtn = $('island-stone');
    if (stoneBtn) {
      stoneBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); fireLaser(); stoneBtn.classList.add('boosting'); });
      stoneBtn.addEventListener('pointerup', function () { stoneBtn.classList.remove('boosting'); });
      stoneBtn.addEventListener('pointerleave', function () { stoneBtn.classList.remove('boosting'); });
      stoneBtn.addEventListener('pointercancel', function () { stoneBtn.classList.remove('boosting'); });
    }

    // 方向手柄（虚拟摇杆）：拖动控制前后左右
    if (stickEl) {
      var stickId = null;
      var stickMax = 44;   // 摇杆最大偏移 = (152-64)/2
      function stickMove(cx, cy) {
        var r = stickEl.getBoundingClientRect();
        var ccx = r.left + r.width / 2, ccy = r.top + r.height / 2;
        var dx = cx - ccx, dy = cy - ccy;
        var d = Math.hypot(dx, dy);
        if (d > stickMax) { dx = dx / d * stickMax; dy = dy / d * stickMax; }
        stickThumbEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        input.active = true;
        input.x = clamp(dx / stickMax, -1, 1);   // 右 → +X
        input.z = clamp(dy / stickMax, -1, 1);   // 下 → +Z(向后)，上 → -Z(向前)
      }
      function stickEnd() {
        stickId = null;
        stickThumbEl.style.transform = 'translate(0,0)';
        input.active = false; input.x = 0; input.z = 0;
      }
      stickEl.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (window.Sfx && window.Sfx.unlock) window.Sfx.unlock();
        stickId = e.pointerId;
        try { stickEl.setPointerCapture(e.pointerId); } catch (err) {}
        stickMove(e.clientX, e.clientY);
      });
      stickEl.addEventListener('pointermove', function (e) {
        if (e.pointerId !== stickId) return;
        e.preventDefault();
        stickMove(e.clientX, e.clientY);
      });
      stickEl.addEventListener('pointerup', function (e) { if (e.pointerId === stickId) stickEnd(); });
      stickEl.addEventListener('pointercancel', function (e) { if (e.pointerId === stickId) stickEnd(); });
    }

    var againBtn = $('btn-island-again');
    if (againBtn) againBtn.addEventListener('click', function () { restart(); });
    var menuBtn = $('btn-island-menu');
    if (menuBtn) menuBtn.addEventListener('click', function () { if (window.__showMenu) window.__showMenu(); });

    if (viewBtn) viewBtn.addEventListener('click', function () {
      camMode = (camMode === 'orbit') ? 'follow' : 'orbit';
      if (camMode === 'orbit') {
        camAz = 0; camEl = 0.7; camDist = 120; viewBtn.textContent = '🎮 跟拍';
      } else {
        viewBtn.textContent = '🔄 视角';
      }
      viewBtn.classList.toggle('active', camMode === 'orbit');
      showHint(camMode === 'orbit' ? '自由视角：拖动旋转 · 双指缩放 · 再看岛' : '回到跟拍视角', 1.6);
    });

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  }

  // ============ 对外 ============
  function open() {
    if (!canvas) init();
    resize();
    buildScene();
    spawnNPCs();
    spawnVendors();
    resize();
    state = 'select';
    showSelect(true);
    slowmo = 0; focus = []; camMode = 'follow';
    if (viewBtn) { viewBtn.textContent = '🔄 视角'; viewBtn.classList.remove('active'); }
    running = true;
    lastT = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false; state = 'idle';
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    boosting = false;
    clearBolts();
    clearVendors();
    clearMines();
    if (window.Bgm) window.Bgm.boss(false);
  }

  return {
    init: init, open: open, beginPlay: beginPlay, stop: stop,
    debug: function () {
      return {
        get player() { return player; },
        get npcs() { return npcs; },
        get vendors() { return vendors; },
        props: props,
        get bolts() { return bolts; },
        get mines() { return mines; },
        get slowmo() { return slowmo; },
        get camMode() { return camMode; },
        get input() { return input; },
        get lives() { return lives; },
        get over() { return over; },
        fireLaser: function () { return fireLaser(); }
      };
    }
  };
})();
