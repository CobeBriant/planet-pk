/**
 * Q版星仔 — 捏脸工坊（第 7 个 Tab）
 *
 * 玩法：
 *  - 选一个真实星体作底（继承它的真实半径/质量，3D 里大小真实）
 *  - 在它的照片上叠加卡通【头发 / 眉毛 / 眼睛 / 鼻子 / 嘴巴】
 *  - 保存 → 合成图存进 localStorage，注册进 getCustomBodies()
 *    → 立刻出现在「星球岛」选择列表，也能进「星球PK」
 *
 * 复用：window.saveCustomBody / window.deleteCustomBody（game.js）
 *      window.PKImageCache（底图）
 *      window.getCustomBodies（已有星仔）
 *
 * 对外暴露 window.PlanetQStar：init() / open()
 */
window.PlanetQStar = (function () {
  'use strict';

  // ---------- 部件定义 ----------
  var CATS = [
    { key: 'hair',  label: '头发', opts: ['无', '刺猬', '波波', '呆毛'] },
    { key: 'brows', label: '眉毛', opts: ['无', '圆眉', '细眉', '怒眉'] },
    { key: 'eyes',  label: '眼睛', opts: ['大眼', '微笑', '星星', '眨眼', '闭眼'] },
    { key: 'nose',  label: '鼻子', opts: ['无', '点鼻', '线鼻'] },
    { key: 'mouth', label: '嘴巴', opts: ['微笑', '张嘴', '咧嘴', 'O嘴', '猫嘴'] }
  ];
  var DEFAULT_FACE = { hair: 1, brows: 3, eyes: 0, nose: 1, mouth: 0 };

  // ---------- 状态 ----------
  var inited = false;
  var currentBase = null;
  var face = Object.assign({}, DEFAULT_FACE);
  var editingId = null;

  // ---------- DOM ----------
  var preview, nameInput, basePicker, featsEl, saveBtn, listEl, toastEl;

  function $(id) { return document.getElementById(id); }

  // ============ 绘制 ============
  function drawComposite(ctx, base, fc, cx, cy, R) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // 背景
    var bg = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.2, cx, cy, R * 1.6);
    bg.addColorStop(0, '#1a2348');
    bg.addColorStop(1, '#070b1c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 星球底图
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    var img = window.PKImageCache && (window.PKImageCache[base.id] || window.PKImageCache[base.name]);
    if (img && img.complete && img.naturalWidth) {
      var ir = Math.max((2 * R) / img.naturalWidth, (2 * R) / img.naturalHeight);
      ctx.drawImage(img, cx - img.naturalWidth * ir / 2, cy - img.naturalHeight * ir / 2, img.naturalWidth * ir, img.naturalHeight * ir);
    } else {
      ctx.fillStyle = base.color || '#6CF';
      ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    }
    // 边缘暗角，让脸更立体
    var vg = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.5, cx, cy, R * 1.1);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();

    // 卡通五官
    drawFeature(ctx, 'hair', fc.hair, cx, cy, R);
    drawFeature(ctx, 'brows', fc.brows, cx, cy, R);
    drawFeature(ctx, 'eyes', fc.eyes, cx, cy, R);
    drawFeature(ctx, 'nose', fc.nose, cx, cy, R);
    drawFeature(ctx, 'mouth', fc.mouth, cx, cy, R);
  }

  function drawFeature(ctx, cat, idx, cx, cy, R) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var eyeY = cy - R * 0.02, eyeDX = R * 0.34, eyeR = R * 0.17;
    var HAIR = '#7a4a2b', BROW = '#3a2a1a', MOUTH = '#c0392b';

    if (cat === 'hair') {
      ctx.fillStyle = HAIR;
      if (idx === 1) { // 刺猬
        var n = 9;
        for (var i = 0; i < n; i++) {
          var a = Math.PI * (1.02 + 0.96 * i / (n - 1));
          var bx = cx + Math.cos(a) * R * 1.0, by = cy + Math.sin(a) * R * 1.0;
          var tx = cx + Math.cos(a) * R * 1.34, ty = cy + Math.sin(a) * R * 1.34;
          var pa = a + 0.22, pb = a - 0.22;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(pa) * R * 1.0, cy + Math.sin(pa) * R * 1.0);
          ctx.lineTo(tx, ty);
          ctx.lineTo(cx + Math.cos(pb) * R * 1.0, cy + Math.sin(pb) * R * 1.0);
          ctx.closePath(); ctx.fill();
        }
      } else if (idx === 2) { // 波波
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.04, Math.PI * 1.08, Math.PI * 1.92);
        ctx.lineTo(cx - R * 0.55, cy + R * 0.05);
        ctx.lineTo(cx - R * 0.55, cy - R * 0.18);
        ctx.lineTo(cx + R * 0.55, cy - R * 0.18);
        ctx.lineTo(cx + R * 0.55, cy + R * 0.05);
        ctx.closePath(); ctx.fill();
      } else if (idx === 3) { // 呆毛
        ctx.beginPath();
        ctx.moveTo(cx - R * 0.1, cy - R * 0.95);
        ctx.quadraticCurveTo(cx + R * 0.18, cy - R * 1.5, cx - R * 0.02, cy - R * 1.55);
        ctx.quadraticCurveTo(cx - R * 0.12, cy - R * 1.35, cx + R * 0.05, cy - R * 0.95);
        ctx.closePath(); ctx.fill();
      }
    } else if (cat === 'brows') {
      ctx.strokeStyle = BROW; ctx.lineWidth = Math.max(2, R * 0.05);
      var by = eyeY - R * 0.26;
      for (var s = -1; s <= 1; s += 2) {
        var ex = cx + s * eyeDX;
        if (idx === 1) { // 圆眉
          ctx.beginPath(); ctx.arc(ex, by + R * 0.04, R * 0.16, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
        } else if (idx === 2) { // 细眉
          ctx.beginPath(); ctx.moveTo(ex - R * 0.16, by); ctx.lineTo(ex + R * 0.16, by - R * 0.02); ctx.stroke();
        } else if (idx === 3) { // 怒眉（内低外高）
          ctx.beginPath(); ctx.moveTo(ex - s * R * 0.16, by + R * 0.06); ctx.lineTo(ex + s * R * 0.16, by - R * 0.06); ctx.stroke();
        }
      }
    } else if (cat === 'eyes') {
      if (idx === 0) { // 大眼
        for (var s2 = -1; s2 <= 1; s2 += 2) {
          var ex2 = cx + s2 * eyeDX;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.ellipse(ex2, eyeY, eyeR, eyeR * 1.15, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#161018';
          ctx.beginPath(); ctx.ellipse(ex2, eyeY + R * 0.02, eyeR * 0.5, eyeR * 0.62, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(ex2 - eyeR * 0.2, eyeY - eyeR * 0.25, eyeR * 0.18, 0, Math.PI * 2); ctx.fill();
        }
      } else if (idx === 1) { // 微笑 ^^
        ctx.strokeStyle = '#161018'; ctx.lineWidth = Math.max(2, R * 0.05);
        for (var s3 = -1; s3 <= 1; s3 += 2) {
          var ex3 = cx + s3 * eyeDX;
          ctx.beginPath(); ctx.arc(ex3, eyeY + R * 0.06, eyeR * 0.7, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        }
      } else if (idx === 2) { // 星星
        ctx.fillStyle = '#ffd24d';
        for (var s4 = -1; s4 <= 1; s4 += 2) drawStar(ctx, cx + s4 * eyeDX, eyeY, eyeR * 1.05);
      } else if (idx === 3) { // 眨眼
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(cx - eyeDX, eyeY, eyeR, eyeR * 1.15, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#161018';
        ctx.beginPath(); ctx.ellipse(cx - eyeDX, eyeY + R * 0.02, eyeR * 0.5, eyeR * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(cx - eyeDX - eyeR * 0.2, eyeY - eyeR * 0.25, eyeR * 0.18, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#161018'; ctx.lineWidth = Math.max(2, R * 0.05);
        ctx.beginPath(); ctx.arc(cx + eyeDX, eyeY + R * 0.04, eyeR * 0.7, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      } else if (idx === 4) { // 闭眼 ‿‿
        ctx.strokeStyle = '#161018'; ctx.lineWidth = Math.max(2, R * 0.05);
        for (var s5 = -1; s5 <= 1; s5 += 2) {
          var ex5 = cx + s5 * eyeDX;
          ctx.beginPath(); ctx.arc(ex5, eyeY - R * 0.02, eyeR * 0.7, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
        }
      }
    } else if (cat === 'nose') {
      var ny = cy + R * 0.2;
      ctx.fillStyle = 'rgba(20,16,24,0.75)';
      ctx.strokeStyle = 'rgba(20,16,24,0.75)';
      if (idx === 1) { // 点鼻
        ctx.beginPath(); ctx.arc(cx, ny, R * 0.05, 0, Math.PI * 2); ctx.fill();
      } else if (idx === 2) { // 线鼻
        ctx.lineWidth = Math.max(2, R * 0.035);
        ctx.beginPath(); ctx.moveTo(cx, ny - R * 0.06); ctx.lineTo(cx, ny + R * 0.06); ctx.stroke();
      }
    } else if (cat === 'mouth') {
      var my = cy + R * 0.42, mw = R * 0.5;
      ctx.strokeStyle = MOUTH; ctx.fillStyle = MOUTH;
      ctx.lineWidth = Math.max(2, R * 0.05);
      if (idx === 0) { // 微笑
        ctx.beginPath(); ctx.arc(cx, my - R * 0.05, mw * 0.5, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      } else if (idx === 1) { // 张嘴
        ctx.beginPath(); ctx.ellipse(cx, my, mw * 0.42, R * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      } else if (idx === 2) { // 咧嘴
        ctx.beginPath(); ctx.arc(cx, my - R * 0.04, mw * 0.55, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.beginPath(); ctx.moveTo(cx - mw * 0.4, my - R * 0.02); ctx.lineTo(cx + mw * 0.4, my - R * 0.02); ctx.stroke();
      } else if (idx === 3) { // O嘴
        ctx.beginPath(); ctx.arc(cx, my, R * 0.1, 0, Math.PI * 2); ctx.fill();
      } else if (idx === 4) { // 猫嘴 ω
        ctx.strokeStyle = MOUTH;
        ctx.beginPath(); ctx.arc(cx - mw * 0.28, my, mw * 0.26, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx + mw * 0.28, my, mw * 0.26, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawStar(ctx, x, y, r) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rr = (i % 2 === 0) ? r : r * 0.45;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }

  // ============ UI 构建 ============
  function buildBasePicker() {
    basePicker.innerHTML = '';
    var pool = (typeof CELESTIAL_DATA !== 'undefined') ? CELESTIAL_DATA : [];
    pool = pool.filter(function (b) { return b.category !== 'galaxy' && b.category !== 'blackhole'; });
    if (!currentBase && pool.length) currentBase = pool[0];
    pool.forEach(function (b) {
      var chip = document.createElement('div');
      chip.className = 'qstar-base-chip';
      var cv = document.createElement('canvas'); cv.width = 56; cv.height = 56;
      var c = cv.getContext('2d');
      c.beginPath(); c.arc(28, 28, 26, 0, 6.28); c.clip();
      var img = window.PKImageCache && (window.PKImageCache[b.id] || window.PKImageCache[b.name]);
      if (img && img.complete && img.naturalWidth) {
        var ir = Math.max(56 / img.naturalWidth, 56 / img.naturalHeight);
        c.drawImage(img, 28 - img.naturalWidth * ir / 2, 28 - img.naturalHeight * ir / 2, img.naturalWidth * ir, img.naturalHeight * ir);
      } else { c.fillStyle = b.color || '#6CF'; c.fillRect(0, 0, 56, 56); }
      var nm = document.createElement('div'); nm.className = 'qstar-base-name'; nm.textContent = b.name;
      chip.appendChild(cv); chip.appendChild(nm);
      chip.addEventListener('click', function () {
        currentBase = b; editingId = null;
        markSelectedBase(); renderPreview();
      });
      chip._body = b;
      basePicker.appendChild(chip);
    });
    markSelectedBase();
  }

  function markSelectedBase() {
    Array.prototype.forEach.call(basePicker.children, function (chip) {
      chip.classList.toggle('sel', chip._body === currentBase);
    });
  }

  function buildFeats() {
    featsEl.innerHTML = '';
    CATS.forEach(function (cat) {
      var row = document.createElement('div'); row.className = 'qstar-feat-row';
      var lab = document.createElement('div'); lab.className = 'qstar-feat-label'; lab.textContent = cat.label;
      row.appendChild(lab);
      var opts = document.createElement('div'); opts.className = 'qstar-feat-opts';
      cat.opts.forEach(function (name, idx) {
        var thumb = document.createElement('canvas'); thumb.width = 56; thumb.height = 56; thumb.className = 'qstar-feat-thumb';
        var c = thumb.getContext('2d');
        // 画一个中性脸当底，再画该部件
        c.beginPath(); c.arc(28, 30, 22, 0, 6.28); c.fillStyle = '#caa'; c.fill();
        drawFeature(c, cat.key, idx, 28, 30, 22);
        thumb.addEventListener('click', function () {
          face[cat.key] = idx;
          markSelectedFeat(); renderPreview();
        });
        thumb._cat = cat.key; thumb._idx = idx; thumb._name = name;
        opts.appendChild(thumb);
      });
      row.appendChild(opts);
      featsEl.appendChild(row);
    });
    markSelectedFeat();
  }

  function markSelectedFeat() {
    Array.prototype.forEach.call(featsEl.querySelectorAll('.qstar-feat-thumb'), function (t) {
      t.classList.toggle('sel', face[t._cat] === t._idx);
    });
  }

  function renderPreview() {
    if (!currentBase) return;
    drawComposite(preview.getContext('2d'), currentBase, face, 180, 200, 120);
  }

  function renderList() {
    listEl.innerHTML = '';
    var all = (window.getCustomBodies ? window.getCustomBodies() : []) || [];
    var qs = all.filter(function (b) { return b.face; });
    if (!qs.length) {
      listEl.innerHTML = '<div class="qstar-empty">还没有星仔，捏一个保存吧～</div>';
      return;
    }
    qs.forEach(function (b) {
      var chip = document.createElement('div'); chip.className = 'qstar-saved';
      var im = document.createElement('img'); im.src = b.customImage; im.className = 'qstar-saved-img';
      var nm = document.createElement('div'); nm.className = 'qstar-saved-name'; nm.textContent = b.name;
      var del = document.createElement('button'); del.className = 'qstar-saved-del'; del.textContent = '✕';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.deleteCustomBody) window.deleteCustomBody(b.id);
        renderList();
      });
      chip.appendChild(im); chip.appendChild(nm); chip.appendChild(del);
      chip.addEventListener('click', function () { loadForEdit(b); });
      listEl.appendChild(chip);
    });
  }

  function loadForEdit(b) {
    editingId = b.id;
    nameInput.value = b.name;
    face = Object.assign({}, DEFAULT_FACE, b.face || {});
    var base = (typeof CELESTIAL_DATA !== 'undefined') && CELESTIAL_DATA.filter(function (x) { return x.id === b.baseId; })[0];
    if (base) currentBase = base;
    markSelectedBase(); markSelectedFeat(); renderPreview();
    toast('已载入「' + b.name + '」可修改后重新保存');
  }

  function doSave() {
    if (!currentBase) return;
    var cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    drawComposite(cv.getContext('2d'), currentBase, face, 128, 140, 116);
    var dataURL = cv.toDataURL('image/png');
    var nm = (nameInput.value || '').trim() || (currentBase.name + '仔');
    var body = {
      id: editingId || ('qstar-' + Date.now()),
      name: nm, nameEn: nm,
      radius: currentBase.radius, mass: currentBase.mass,
      color: currentBase.color, category: currentBase.category,
      isCustom: true, customImage: dataURL,
      baseId: currentBase.id, face: JSON.parse(JSON.stringify(face))
    };
    if (window.saveCustomBody) window.saveCustomBody(body);
    editingId = null;
    toast('已保存「' + nm + '」，可在星球岛 / 星球PK 选择');
    renderList();
  }

  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, 2200);
  }

  // ============ 初始化 ============
  function init() {
    if (inited) return;
    preview = $('qstar-preview');
    nameInput = $('qstar-name');
    basePicker = $('qstar-base-picker');
    featsEl = $('qstar-feats');
    saveBtn = $('qstar-save');
    listEl = $('qstar-list');
    toastEl = $('qstar-toast');
    buildBasePicker();
    buildFeats();
    saveBtn.addEventListener('click', doSave);
    inited = true;
  }

  function open() {
    init();
    renderPreview();
    renderList();
  }

  return { init: init, open: open };
})();
