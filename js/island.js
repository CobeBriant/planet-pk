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
  var renderer, scene, camera;
  var starfield, islandGroup, ramps = [];
  var player = null, npcs = [];
  var rafId = null, running = false, lastT = 0;
  var state = 'idle';            // idle | select | playing
  var collisions = 0;
  var boosting = false;
  var W = 0, H = 0, dpr = 1;
  var islandR = 52;
  var FACE_TEX = null;

  // 物理参数
  var GRAV = 32, JUMP = 15, ACCEL = 48, BOOST_MULT = 2.3;
  var MAXSPD = 24, BOOST_MAXSPD = 46, DRAG = 1.9, REST = 0.30;

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

  // ============ 生成「天体」===========
  function makeBeing(body) {
    var R = displayRadius(body);
    var group = new THREE.Group();
    var tex = bodyTexture(body);
    var mat = tex
      ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 })
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(body.color || '#88aaff'), roughness: 0.8, metalness: 0.1 });
    var sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), mat);
    group.add(sphere);

    if (!FACE_TEX) FACE_TEX = faceTexture();
    var face = new THREE.Sprite(new THREE.SpriteMaterial({ map: FACE_TEX, transparent: true }));
    var fs = R * 1.55;
    face.scale.set(fs, fs, 1);
    face.position.set(0, R * 0.04, R * 0.98);
    group.add(face);

    scene.add(group);
    return {
      group: group, sphere: sphere, R: R, body: body, mass: massFactor(body),
      vel: new THREE.Vector3(), grounded: false, jumpCd: 0,
      ai: { tx: rand(-30, 30), tz: rand(-30, 30), hopCd: rand(1, 4), seek: false }
    };
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
    var d0 = islandR * 0.28;
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
    ramps.push({ ux: ux, uz: uz, px: px, pz: pz, d0: d0, len: len, hw: hw, h: h, slope: h / len });
  }

  function terrainHeight(x, z) {
    var g = 0;
    for (var i = 0; i < ramps.length; i++) {
      var r = ramps[i];
      var along = (x * r.ux + z * r.uz) - r.d0;
      if (along < 0 || along > r.len) continue;
      var across = x * r.px + z * r.pz;
      if (Math.abs(across) > r.hw) continue;
      var hh = r.slope * along;
      if (hh > g) g = hh;
    }
    return g;
  }

  function buildScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03020c);
    scene.fog = new THREE.FogExp2(0x03020c, 0.0055);

    camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 700);
    camera.position.set(0, 22, 30);
    camera.lookAt(0, 2, 0);

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
    addRamp(0, islandR * 0.18, islandR * 0.7, 17);
    addRamp(Math.PI * 0.66, islandR * 0.16, islandR * 0.7, 15);
    addRamp(-Math.PI * 0.66, islandR * 0.16, islandR * 0.7, 15);
  }

  // ============ NPC ============
  function spawnNPCs() {
    npcs.forEach(function (n) { scene.remove(n.group); });
    npcs = [];
    var pool = getPool();
    for (var i = 0; i < 5; i++) {
      var b = pool[(Math.random() * pool.length) | 0];
      var nb = makeBeing(b);
      var a = rand(0, 6.28), rr = rand(10, islandR * 0.8);
      nb.group.position.set(Math.cos(a) * rr, nb.R, Math.sin(a) * rr);
      nb.ai.tx = rand(-islandR * 0.7, islandR * 0.7);
      nb.ai.tz = rand(-islandR * 0.7, islandR * 0.7);
      npcs.push(nb);
    }
  }

  // ============ 物理 ============
  function stepBeing(b, dt) {
    b.vel.y -= GRAV * dt;
    b.group.position.addScaledVector(b.vel, dt);
    var gy = terrainHeight(b.group.position.x, b.group.position.z);
    var floor = gy + b.R;
    if (b.group.position.y <= floor) {
      b.group.position.y = floor;
      if (b.vel.y < 0) b.vel.y = -b.vel.y * REST;
      if (Math.abs(b.vel.y) < 1.2) b.vel.y = 0;
      b.grounded = true;
    } else {
      b.grounded = false;
    }
    var r2 = Math.hypot(b.group.position.x, b.group.position.z);
    var lim = islandR - b.R - 1;
    if (r2 > lim) {
      var nx = b.group.position.x / r2, nz = b.group.position.z / r2;
      b.group.position.x = nx * lim; b.group.position.z = nz * lim;
      var out = b.vel.x * nx + b.vel.z * nz;
      if (out > 0) { b.vel.x -= out * nx; b.vel.z -= out * nz; }
    }
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
    var sp = Math.hypot(b.vel.x, b.vel.z), mx = 20;
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
      if (a === player || b === player) { collisions++; updateScore(); sfx('hit'); }
    }
  }

  function updateCamera(dt) {
    if (!player) { camera.lookAt(0, 2, 0); return; }
    var p = player.group.position;
    var tx = p.x, ty = p.y + 16, tz = p.z + 26;
    var k = Math.min(1, dt * 4);
    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += (ty - camera.position.y) * k;
    camera.position.z += (tz - camera.position.z) * k;
    camera.lookAt(p.x, p.y + 2, p.z);
  }

  // ============ 主循环 ============
  function loop(t) {
    if (!running) return;
    var dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;

    if (state === 'playing') applyPlayerInput(dt);
    if (player) { stepBeing(player, dt); if (player.jumpCd > 0) player.jumpCd -= dt; }
    for (var i = 0; i < npcs.length; i++) { stepNPC(npcs[i], dt); stepBeing(npcs[i], dt); }
    if (state === 'playing') {
      for (var a = 0; a < npcs.length; a++) collide(player, npcs[a]);
      for (var c = 0; c < npcs.length; c++) for (var d = c + 1; d < npcs.length; d++) collide(npcs[c], npcs[d]);
    }
    if (player) rollSphere(player, dt);
    for (var e = 0; e < npcs.length; e++) rollSphere(npcs[e], dt);
    updateCamera(dt);
    if (starfield) starfield.rotation.y += dt * 0.02;

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
    if (player) scene.remove(player.group);
    player = makeBeing(body);
    player.group.position.set(0, player.R, 0);
    state = 'playing';
    collisions = 0; updateScore();
    showHint('点击球体起跳 · 滑动屏幕滚动 · 按住「马力」冲坡', 2.4);
    if (window.Sfx && window.Sfx.unlock) window.Sfx.unlock();
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
    scoreEl = $('island-score');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });

    canvas.addEventListener('pointerdown', function (e) {
      if (window.Sfx && window.Sfx.unlock) window.Sfx.unlock();
      if (state !== 'playing') return;
      var rect = canvas.getBoundingClientRect();
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
      if (!input.active || drag.id !== e.pointerId) return;
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left, y = e.clientY - rect.top;
      drag.lastX = x; drag.lastY = y;
      var tdx = x - drag.x0, tdy = y - drag.y0;
      input.x = clamp(tdx * 0.02, -1, 1);   // 右滑 → +X
      input.z = clamp(tdy * 0.02, -1, 1);   // 上滑(tdy<0) → -Z（向前）
    });
    function endDrag() { input.active = false; input.x = 0; input.z = 0; drag.id = null; }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    boostBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); boosting = true; boostBtn.classList.add('boosting'); });
    boostBtn.addEventListener('pointerup', function () { boosting = false; boostBtn.classList.remove('boosting'); });
    boostBtn.addEventListener('pointerleave', function () { boosting = false; boostBtn.classList.remove('boosting'); });
    boostBtn.addEventListener('pointercancel', function () { boosting = false; boostBtn.classList.remove('boosting'); });

    muteBtn.addEventListener('click', function () {
      var m = window.Sfx ? window.Sfx.toggleMute() : false;
      muteBtn.textContent = m ? '🔇' : '🔊';
    });

    window.addEventListener('resize', resize);
  }

  // ============ 对外 ============
  function open() {
    if (!canvas) init();
    resize();
    buildScene();
    spawnNPCs();
    resize();
    state = 'select';
    showSelect(true);
    running = true;
    lastT = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false; state = 'idle';
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    boosting = false;
  }

  return { init: init, open: open, beginPlay: beginPlay, stop: stop };
})();
