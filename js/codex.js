/**
 * 图鉴 / 成就（第 8 个 Tab）
 *
 *  - 列出所有【真实天体 + 自定义星仔】，点击看大图
 *  - 浏览过的天体自动入图鉴（在「自由探索」看详情也会被记录）
 *  - 统计：图鉴收集进度 / 星球PK 胜·负·最高连胜 / 星球岛 胜·负·挤下数 / 我的星仔数
 *  - 成就：按上述数据解锁徽章
 *
 * 复用：window.PKImageCache（图片）；window.getCustomBodies（自定义星仔）
 *      window.CELESTIAL_DATA（全量天体）
 * 对外暴露 window.PlanetCodex：init() / open()
 *       同时暴露 window.AppStats（统计模块，供 island.js / game.js 写入）
 */
window.PlanetCodex = (function () {
  'use strict';

  // ============ 统计模块（被游戏写入） ============
  var SKEY = 'planetpk_stats_v1';
  var sd = loadStats();
  function loadStats() {
    try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; }
  }
  function saveStats() { try { localStorage.setItem(SKEY, JSON.stringify(sd)); } catch (e) {} }
  window.AppStats = {
    markViewed: function (id) {
      sd.viewed = sd.viewed || {};
      if (!sd.viewed[id]) { sd.viewed[id] = 1; saveStats(); }
    },
    recordIsland: function (res) {
      sd.island = sd.island || { win: 0, lose: 0, ko: 0 };
      if (res === 'win') sd.island.win++;
      else if (res === 'lose') sd.island.lose++;
      else if (res === 'ko') sd.island.ko++;
      saveStats();
    },
    recordPK: function (res) {
      sd.pk = sd.pk || { win: 0, lose: 0, streak: 0, best: 0 };
      if (res === 'win') { sd.pk.win++; sd.pk.streak++; sd.pk.best = Math.max(sd.pk.best, sd.pk.streak); }
      else { sd.pk.lose++; sd.pk.streak = 0; }
      saveStats();
    },
    get: function () { return sd; }
  };
  // 供 island.js 直接调用
  window.recordIslandEvent = function (r) { window.AppStats.recordIsland(r); };
  window.recordPKEvent = function (r) { window.AppStats.recordPK(r); };

  // ============ UI ============
  function $(id) { return document.getElementById(id); }
  function fmtR(r) {
    if (r >= 1e9) return (r / 1e9).toFixed(1) + '亿km';
    if (r >= 1e4) return (r / 1e4).toFixed(0) + '万km';
    return Math.round(r) + 'km';
  }
  function formatNum(n) {
    if (!n) return '—';
    if (n >= 1e44) return (n / 1e44).toFixed(2) + '×10⁴⁴ kg(太阳质量级)';
    var s = n.toExponential(2);
    return s + ' kg';
  }
  var TYPE = { planet: '行星', dwarf: '矮行星', moon: '卫星', star: '恒星', galaxy: '星系', blackhole: '黑洞', other: '天体' };

  var gridEl, statsEl, achEl, progressEl, detailEl, detailImg, detailName, detailMeta, detailDesc;

  function getAllBodies() {
    var base = (typeof CELESTIAL_DATA !== 'undefined') ? CELESTIAL_DATA.slice() : [];
    var custom = (window.getCustomBodies ? window.getCustomBodies() : []) || [];
    return base.concat(custom);
  }

  function thumbURL(body) {
    var img = window.PKImageCache && (window.PKImageCache[body.id] || window.PKImageCache[body.name]);
    if (img && img.complete && img.naturalWidth) return img.src || null;
    return null;
  }

  function renderStats() {
    var all = getAllBodies();
    var viewed = sd.viewed || {};
    var n = 0; all.forEach(function (b) { if (viewed[b.id]) n++; });
    var isl = sd.island || { win: 0, lose: 0, ko: 0 };
    var pk = sd.pk || { win: 0, lose: 0, best: 0 };
    var custom = (window.getCustomBodies ? window.getCustomBodies() : []).filter(function (b) { return b.face; });
    if (progressEl) progressEl.textContent = n + ' / ' + all.length;
    var rows = [
      ['图鉴收集', n + ' / ' + all.length],
      ['星球PK 胜/负', pk.win + ' / ' + pk.lose],
      ['星球PK 最高连胜', pk.best + ' 连'],
      ['星球岛 胜/负', isl.win + ' / ' + isl.lose],
      ['星球岛 挤下对手', isl.ko + ' 个'],
      ['我的星仔', custom.length + ' 个']
    ];
    statsEl.innerHTML = rows.map(function (r) {
      return '<div class="codex-stat"><span class="codex-stat-k">' + r[0] + '</span><span class="codex-stat-v">' + r[1] + '</span></div>';
    }).join('');
  }

  function renderAch() {
    var all = getAllBodies();
    var viewed = sd.viewed || {};
    var n = 0; all.forEach(function (b) { if (viewed[b.id]) n++; });
    var isl = sd.island || { win: 0, lose: 0, ko: 0 };
    var pk = sd.pk || { win: 0, lose: 0, best: 0 };
    var custom = (window.getCustomBodies ? window.getCustomBodies() : []).filter(function (b) { return b.face; });
    var achs = [
      { name: '初窥宇宙', desc: '浏览第 1 个天体', ok: n >= 1 },
      { name: '收藏过半', desc: '图鉴收集 ≥ 50%', ok: all.length > 0 && n >= all.length * 0.5 },
      { name: '满星图鉴', desc: '收集全部天体', ok: all.length > 0 && n >= all.length },
      { name: 'PK 首胜', desc: '星球PK 赢 1 场', ok: pk.win >= 1 },
      { name: '连胜大师', desc: '星球PK 最高连胜 ≥ 5', ok: pk.best >= 5 },
      { name: '岛主诞生', desc: '星球岛 赢 1 局', ok: isl.win >= 1 },
      { name: '推手', desc: '星球岛 挤下 ≥ 10 个对手', ok: isl.ko >= 10 },
      { name: '捏脸师', desc: '创建 1 个 Q版星仔', ok: custom.length >= 1 }
    ];
    achEl.innerHTML = achs.map(function (a) {
      return '<div class="codex-ach-item ' + (a.ok ? 'on' : 'off') + '"><span class="codex-ach-icon">' + (a.ok ? '🏆' : '🔒') + '</span>' +
        '<span class="codex-ach-txt"><b>' + a.name + '</b><i>' + a.desc + '</i></span></div>';
    }).join('');
  }

  function renderGrid() {
    gridEl.innerHTML = '';
    var all = getAllBodies();
    var viewed = sd.viewed || {};
    all.forEach(function (b) {
      var card = document.createElement('div');
      card.className = 'codex-card';
      var cv = document.createElement('canvas'); cv.width = 96; cv.height = 96;
      var c = cv.getContext('2d');
      c.beginPath(); c.arc(48, 48, 46, 0, 6.28); c.clip();
      var img = window.PKImageCache && (window.PKImageCache[b.id] || window.PKImageCache[b.name]);
      if (img && img.complete && img.naturalWidth) {
        var ir = Math.max(96 / img.naturalWidth, 96 / img.naturalHeight);
        c.drawImage(img, 48 - img.naturalWidth * ir / 2, 48 - img.naturalHeight * ir / 2, img.naturalWidth * ir, img.naturalHeight * ir);
      } else if (b.customImage) {
        var im2 = new Image(); im2.src = b.customImage;
        if (im2.complete && im2.naturalWidth) c.drawImage(im2, 0, 0, 96, 96);
        else { c.fillStyle = b.color || '#6CF'; c.fillRect(0, 0, 96, 96); }
      } else { c.fillStyle = b.color || '#6CF'; c.fillRect(0, 0, 96, 96); }
      var nm = document.createElement('div'); nm.className = 'codex-card-name'; nm.textContent = b.name;
      var seen = document.createElement('div'); seen.className = 'codex-card-seen'; seen.textContent = viewed[b.id] ? '★ 已览' : '○ 未览';
      card.appendChild(cv); card.appendChild(nm); card.appendChild(seen);
      card.addEventListener('click', function () { showDetail(b); });
      gridEl.appendChild(card);
    });
  }

  function showDetail(b) {
    window.AppStats.markViewed(b.id);
    var src = b.customImage;
    if (!src) { var img = window.PKImageCache && (window.PKImageCache[b.id] || window.PKImageCache[b.name]); if (img && img.complete && img.naturalWidth) src = img.src || (img.naturalWidth ? img.src : null); }
    if (src) detailImg.src = src; else { detailImg.removeAttribute('src'); detailImg.style.background = b.color || '#6CF'; }
    detailName.textContent = b.name + (b.isCustom ? '（我的）' : '');
    detailMeta.textContent = (TYPE[b.category] || '天体') + ' · 半径 ' + fmtR(b.radius) + (b.mass ? ' · 质量 ' + formatNum(b.mass) : '');
    detailDesc.textContent = b.desc || '暂无介绍';
    detailEl.style.display = 'flex';
  }

  function closeDetail() { detailEl.style.display = 'none'; }

  function init() {
    gridEl = $('codex-grid'); statsEl = $('codex-stats'); achEl = $('codex-ach'); progressEl = $('codex-progress');
    detailEl = $('codex-detail'); detailImg = $('codex-detail-img'); detailName = $('codex-detail-name');
    detailMeta = $('codex-detail-meta'); detailDesc = $('codex-detail-desc');
    var closeBtn = $('codex-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDetail);
  }

  function open() {
    init();
    renderStats(); renderAch(); renderGrid();
    closeDetail();
  }

  return { init: init, open: open };
})();
