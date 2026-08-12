# 星球PK — 架构文档（AI 交接用）

> 本文档面向开发者或 AI 助手，读完后应能完全理解项目架构并独立进行修改。

## 项目位置

```
/Users/brhon/WorkBuddy/2026-08-09-23-39-04/planet-pk/
```

GitHub 仓库: https://github.com/CobeBriant/planet-pk

## 一句话概要

HTML5 Canvas 天体大小对比小游戏，用 Capacitor 打包成 Android APK，给小朋友玩。

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 渲染 | HTML5 Canvas | 所有天体用 Canvas 程序化绘制 |
| 逻辑 | Vanilla JS | 无框架，无构建工具，无 TypeScript |
| 数据 | JSON 内嵌 | 天体数据直接写在 `js/data.js` 里 |
| 打包 | Capacitor 7+ | Web → Android WebView 壳 |
| 构建 | Gradle (Android) | 命令行构建，不需要 Android Studio |
| JDK | Temurin 21 | 路径: `~/jdk-21/Contents/Home` |
| Android SDK | cmdline-tools | 路径: `~/android-sdk` |

## 目录结构（只看这些就够了）

```
planet-pk/
├── index.html              # ★ 主页面 — 5 个屏幕的 HTML 结构（菜单/PK/探索/我的星系/游戏）
├── css/style.css           # ★ 全部样式 — 响应式 + 动画
├── js/data.js              # ★ 天体数据库 — 45+ 个天体的真实天文数据
├── js/game.js              # ★ 核心引擎 — 菜单切换/PK逻辑/探索/自定义天体/各Tab入口
├── js/arcade.js            # ★ 游戏 Tab — 太空射击（独立模块，挂 window.ArcadeGame，内置 Sfx 音效）
├── js/planetpk.js          # ★ 星球PK Tab — 拟人化星球对战（独立模块，挂 window.PlanetPkGame）
├── assets/images/          # 11 张真实天体纹理 (2K jpg/png)
├── www/                    # Capacitor 同步目录（index.html + css/ + js/ + assets/ 的副本）
├── android/                # Capacitor Android 工程
├── capacitor.config.json   # Capacitor 配置 (appId: com.planetpk.game)
├── package.json            # npm 依赖 (仅 @capacitor/* 三个包)
├── planet-pk.apk           # 已构建的 debug APK
├── docs/迭代记录.md          # V1→V4 迭代记录（产品视角）
├── README.md               # 面向用户的说明
└── ARCHITECTURE.md         # 本文件
```

**重要：核心改动基本集中在 6 个文件** — `index.html`（屏幕结构）、`css/style.css`（全部样式）、`js/data.js`（天体数据）、`js/game.js`（核心引擎/菜单切换/各Tab入口）、`js/arcade.js`（游戏Tab）、`js/planetpk.js`（星球PK Tab）。
`js/arcade.js` 与 `js/planetpk.js` 是互相解耦的独立模块，分别挂 `window.ArcadeGame` / `window.PlanetPkGame`，并复用 `game.js` 暴露的 `window.PKImageCache`（真实纹理）与 `window.Sfx`（音效）。
改完后必须同步到 `www/` 目录再重新构建 APK。

## 核心文件详解

### 1. `js/data.js` — 天体数据库

```javascript
const CELESTIAL_DATA = [
  {
    id: 'mercury',              // 唯一 ID
    name: '水星',               // 中文名（UI 显示）
    nameEn: 'Mercury',          // 英文名
    category: 'planet',         // 类别: planet|moon|dwarf|star|galaxy|blackhole
    radius: 2439.7,             // 半径 (km) — PK 判断的核心数据
    mass: 3.3011e23,            // 质量 (kg) — PK 判断的核心数据
    color: '#8C7853',           // 主色（程序化绘制用）
    image: 'mercury.jpg',       // 真实纹理文件名（对应 assets/images/ 下）
    style: {                    // 程序化绘制提示
      type: 'rocky',            //   rocky|gas|ice|earth|cloudy|star|galaxy|blackhole
      craters: true,            //   是否画陨石坑
      bands: true,              //   是否画气体条纹
      ring: true,               //   是否画光环
      spot: true,               //   是否画大红斑
      red: true,                //   红色变种
      smooth: true,             //   光滑表面
      storm: true,              //   风暴纹理
    },
    desc: '科普描述文字',        // 探索模式和 PK 结果中显示
    ringImage: 'saturn_ring.png' // 可选：土星光环纹理
  },
  // ... 共 45+ 个天体
];
```

**添加新天体：** 在数组里加一个对象即可。`id` 必须唯一，`radius` 和 `mass` 决定 PK 胜负。

**类别与难度分级：**
- `planet` / `moon` / `dwarf` → 简单题（前 5 题）
- `star` → 中等题（中间 5 题）
- `galaxy` / `blackhole` → 困难题（最后 5 题）

### 2. `js/game.js` — 核心游戏引擎

整个文件是一个 IIFE（立即执行函数），内部结构：

```
(function() {
  // 1. 全局状态 STATE          — 游戏运行时所有状态
  // 2. 自定义天体存储           — localStorage 读写 (key: planet_pk_custom_bodies)
  // 3. 工具函数                 — $, randInt, pick, shuffle, hashCode, mulberry32, formatNum...
  // 4. ImageManager             — 异步加载真实纹理，加载完成前用程序化绘制
  // 5. renderBody(canvas, body) — 核心：把天体画到 canvas 上
  //    ├── 有真实图片 → drawImage + 裁剪成圆形
  //    ├── 土星 → 额外画光环
  //    ├── 无图片 → 按 style.type 程序化绘制
  //    │   ├── rocky: 陨石坑
  //    │   ├── gas: 条纹 + 大红斑
  //    │   ├── earth: 大陆 + 海洋
  //    │   ├── star: 径向渐变 + 光芒
  //    │   ├── galaxy: 旋臂
  //    │   └── blackhole: 吸积盘
  //    └── 所有类型 → 边缘光晕 + 阴影
  // 6. 星空背景                  — 随机星点 + 闪烁
  // 7. PK 对战逻辑
  //    ├── startPK()            — 初始化 PK
  //    ├── generatePair()       — 按难度选两个天体
  //    ├── getPoolForRound()    — 根据回合数返回天体池
  //    ├── selectAnswer(side)   — 处理玩家选择 → 触发动画 → 显示结果
  //    ├── PK 动画              — 赢家放大发光✓ / 输家缩小变暗✗ + 粒子
  //    ├── showResult()         — 结果面板：正确/错误 + 对比数据
  //    └── nextQuestion()       — 自动进入下一题
  // 8. 探索模式                  — 上下滑动浏览天体列表
  // 9. 自定义天体（我的星系）
  //    ├── 加载/保存             — localStorage
  //    ├── 添加/编辑表单         — 名称/类型/半径/质量/颜色/描述/照片
  //    ├── 照片上传              — FileReader → base64 → 存 localStorage
  //    ├── 渲染自定义天体        — 有照片用照片，无则用颜色圆
  //    └── 删除
  // 10. 事件绑定                  — 所有按钮的 click + touchstart
  // 11. 初始化                     — DOMContentLoaded → 启动
})();
```

**关键状态变量 (STATE)：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | string | 当前模式: menu\|pk\|explore\|custom |
| `score` | number | 当前得分 |
| `combo` | number | 连续答对数 |
| `round` | number | 当前题号 (0-based) |
| `totalRounds` | number | 总题数 (默认 15) |
| `currentPair` | [body, body] | 当前 PK 的两个天体 |
| `answered` | boolean | 当前题是否已答 |
| `resultShown` | boolean | 结果面板是否已显示 |
| `pkAnimation` | object\|null | PK 动画状态 |
| `particles` | array | 粒子特效列表 |
| `autoNextTimer` | number\|null | 自动下一题的定时器 |

**PK 答题流程（重要 — V4 修复的核心）：**

```
玩家点击答案
  → selectAnswer(side)
    → STATE.answered = true
    → 启动 PK 动画 (赢家放大/输家缩小/粒子)
    → 1.2 秒安全兜底：如果 resultShown 还是 false，强制 showResult()
    → showResult() 显示结果面板
    → 结果面板显示 "2 秒后自动下一题"
    → nextQuestion() 或结束游戏
```

### 3. `index.html` — 页面结构

4 个屏幕通过 `display: none/block` 切换：

```
<div id="app">
  <canvas id="starfield">           # 星空背景（全屏）
  
  <div id="menu-screen">            # 主菜单
    按钮: PK对战 / 自由探索 / 我的星系
  
  <div id="pk-screen">              # PK 对战
    顶部HUD: 返回 / 第X/15题 / 分数 / 连击
    左右两个 canvas: pk-canvas-left / pk-canvas-right
    底部按钮: 左边更大 / 右边更大
    结果面板: pk-result-panel
  
  <div id="explore-screen">         # 探索模式
    canvas: explore-canvas
    信息面板: explore-info
  
  <div id="custom-screen">          # 我的星系
    列表: custom-list
    表单: custom-form (名称/类型/半径/质量/颜色/描述/照片)
</div>
```

### 4. `css/style.css` — 样式要点

- 全屏深色宇宙主题，`#000014` 背景
- `clamp()` 做响应式字号，适配手机
- `safe-area-inset` 适配刘海屏
- PK 动画用 CSS `@keyframes`：`pk-win`（放大发光）/ `pk-lose`（缩小变暗）
- 粒子效果用 JS Canvas 绘制（不是 CSS）
- 按钮同时绑 `click` + `touchend` 消除移动端 300ms 延迟

### 5. `js/arcade.js` — 游戏 Tab（弹球击退星球）

> 这是第 4 个 Tab「游戏」。与 PK/探索/我的星系解耦，作为独立模块挂在 `window.ArcadeGame` 上，由 `game.js` 的 `startArcade()` 调用 `start()`，返回菜单时 `hideAll()` 调用 `stop()`。

**玩法：** 顶部不断生成并下压「星球」障碍物；底部由玩家滑动控制的「球网/挡板」；能量球在边界与挡板间反弹，击中上方星球将其击退/粉碎。星球速度、密度、血量随关卡（每 30 秒）递增。

**代码结构（IIFE 返回 `{ init, start, stop }`）：**

```
window.ArcadeGame = (function() {
  // 画布/尺寸: canvas, ctx, dpr(DPR自适应, 高刷屏上限2.25), W/H
  // 实体: paddle(挡板), balls[](能量球), planets[](下压星球), particles[](粒子), bgStars[](动态星尘)
  // 状态: state(idle/playing/over), score, lives, level, elapsed
  //      shake(震屏), danger(危险强度0..1), flashWarning(失命强闪)
  // 难度: BASE + difficulty() 按 level 计算 ballSpeed/planetSpeed/spawnInterval/planetHP
  // 函数:
  //   init()        首次绑定 DOM + 输入
  //   resize()      DPR 缩放 + 挡板尺寸（canvas 可见后调用）
  //   bindInput()   pointerdown/move 滑动控制挡板 + 方向键调试 + touchmove preventDefault
  //   spawnPlanet()/spawnBall()   生成实体
  //   burst()/addShake()/toast()   粒子/震屏/浮层
  //   ballHitsPlanet()  圆-圆碰撞: 反弹 + 给星球向上冲量 + 扣血 + 粉碎
  //   ballHitsPaddle()  圆-AABB最近点: 反弹 + 由击打点决定反弹倾角
  //   update(dt)    物理步进（dt 来自 rAF，兼容 60/120fps）
  //   render()      绘制: 震屏偏移 → 背景 → 压迫带 → 星球/球/挡板/粒子
  //   loop(t)       requestAnimationFrame 主循环
  //   start()/stop()/gameOver()
})();
```

**关键实现点：**
- 渲染用 Canvas 2D；`ctx.setTransform(dpr,...)` 做高分屏适配
- 主循环 `dt = (t - lastT)/1000`，`Math.min(dt, 0.05)` 防卡顿跳变 → 物理与帧率解耦，60/120fps 行为一致
- 碰撞：能量球(圆) vs 星球(圆) 用距离判定；能量球(圆) vs 挡板(AABB) 用最近点法
- 特效：命中触发粒子爆炸(`burst`)、光晕脉冲(planet.flash 径向渐变)、震屏(`shake` 平移画布)、危险红光(`arcade-danger` 透明度随 `danger`)
- 动态背景：星尘向下流动 + 深空渐变
- **音效（V5.1 新增）**：`Sfx` 模块用 Web Audio API 实时合成，**不依赖任何音频文件**，在 Android WebView 中可直接播放。涵盖 `hit`(命中)/`destroy`(粉碎爆炸)/`paddle`(挡板反弹)/`lifeLost`(失命)/`levelUp`(过关)/`gameOver`/`start`。移动端自动播放策略要求用户手势后解锁，故在 `pointerdown` 和 `start()` 中调用 `Sfx.unlock()`；HUD 右上角有 🔊/🔇 静音开关（`arcade-mute`）。

**屏幕布局（竖屏，基准 S23 Ultra 19.3:9）：**
```
顶部 HUD(关卡/分数/生命/静音开关) → 顶部压迫提示条 → 战场(canvas 撑满) → 底部控制提示
```

## 构建流程

### 前置环境（已安装在用户机器上）

```
JDK 21:        ~/jdk-21/Contents/Home
Android SDK:   ~/android-sdk (cmdline-tools + platform-tools + build-tools-34 + platform-34)
Node.js:       随 WorkBuddy 自带
```

### 改代码后重新构建 APK

```bash
# 1. 同步源码到 www/（Capacitor 要求 web 资源在 www/ 下）
cd /Users/brhon/WorkBuddy/2026-08-09-23-39-04/planet-pk
rm -rf www && mkdir -p www
cp index.html www/
cp -r css js assets www/

# 2. Capacitor sync
export JAVA_HOME=~/jdk-21/Contents/Home
export ANDROID_HOME=~/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
npx cap sync android

# 3. 构建 APK
cd android
./gradlew assembleDebug

# 4. 拷贝出来
cp app/build/outputs/apk/debug/app-debug.apk ../planet-pk.apk
```

### 本地预览（不构建 APK）

```bash
cd /Users/brhon/WorkBuddy/2026-08-09-23-39-04/planet-pk
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

### 6. `js/planetpk.js` — 星球PK Tab（拟人化星球对战）

复刻「参考视频」效果：两个真实天体左右并排拟人化对战，玩家点更大的那颗，它击败对手。

- **入口**：`game.js` 的 `startPlanetPK()` 显示 `#planetpk-screen` 并调 `window.PlanetPkGame.start()`；`hideAll()` 里会 `window.PlanetPkGame.stop()` 停循环。
- **模块结构**：IIFE 挂 `window.PlanetPkGame = { init, start, stop }`，与 `game.js` 解耦。
- **数据源**：`getPool()` 合并 `CELESTIAL_DATA` + 自定义天体（`window.getCustomBodies()`），筛选有 `radius` 的。
- **回合状态机**：`phase` = `intro`（滑入）→ `idle`（等点击）→ `resolve`（攻击演出）→ `win`（胜者庆祝）→ 硬切 `newRound()`。各阶段时长常量：`INTRO_DUR / RESOLVE_DUR / WIN_DUR`。
- **交互**：`canvas` 上 `pointerdown`，按点击 x 落在左/右半屏判定选边；首次触摸解锁 `window.Sfx`。
- **视觉演出**：
  - 球体：`drawPlanet()` 用 `window.PKImageCache[name]` 真实纹理（无图则 `lighten()` 程序化径向渐变），clip 成圆。
  - 眼睛：`drawEyes()` — `closed`=半月弧（待机闭眼），`open`=白圆眼+瞳孔（胜者）。
  - 败者：`drawX()` 红色十字 + `drawLaser()` 斜射激光 + 震屏 + 橙光爆闪 → 粒子碎裂消融。
  - 胜者：`drawLaurel()` 金色桂冠光环旋转 + 镜头推近（`R` 放大）。
  - 名字：青（左）/红（右）霓虹发光，`drawVS()` 中央脉冲。
  - 配色常量 `COL` = { cyan:#00E5FF, red:#FF1744, gold:#FFD700, white }。
- **计分/生命**：答对 `streak++`、得分 `100*streak`；答错 `streak=0`、`lives-1`；3 命用尽 `gameOver()`。

**改星球PK 玩法**：基本都在 `js/planetpk.js` 内（阶段时长、配色 `COL`、眼睛/桂冠/激光绘制函数、`getPool()` 选体逻辑、计分规则 `onTap()`）。

## 常见修改指南

| 需求 | 改哪里 |
|------|--------|
| 添加天体 | `js/data.js` → CELESTIAL_DATA 数组加对象 |
| 修改题目数量 | `js/game.js` → STATE.totalRounds |
| 修改难度分级逻辑 | `js/game.js` → getPoolForRound() |
| 修改天体外观 | `js/game.js` → renderBody() 函数 |
| 添加新屏幕 | `index.html` 加一个 div + `js/game.js` 加切换逻辑 |
| 修改颜色主题 | `css/style.css` → 顶部的 :root 变量 |
| 修改 APK 名称/包名 | `capacitor.config.json` → appName/appId |
| 自定义天体持久化 | localStorage key: `planet_pk_custom_bodies` |
| 改游戏难度/速度 | `js/arcade.js` → `BASE` 常量 + `difficulty()` |
| 改星球外观/名字 | `js/arcade.js` → `PALETTE` / `NAMES` |
| 改游戏碰撞逻辑 | `js/arcade.js` → `ballHitsPlanet()` / `ballHitsPaddle()` |
| 改游戏特效参数 | `js/arcade.js` → `burst()` / `addShake()` / `updateDangerVisual()` |
| 改游戏布局 | `index.html` 的 `#arcade-screen` + `css/style.css` 的 `.arcade-*` |
| 改/加游戏音效 | `js/arcade.js` → `Sfx` 模块（`hit`/`destroy`/`paddle`/`lifeLost`/`levelUp`/`gameOver`/`start`，全用 Web Audio 合成，无音频文件；已通过 `window.Sfx` 暴露给 planetpk.js 复用） |
| 改星球PK 演出/配色 | `js/planetpk.js` → `COL` 常量、`drawX()`/`drawLaser()`/`drawLaurel()`/`drawEyes()`、`INTRO_DUR/RESOLVE_DUR/WIN_DUR` |
| 改星球PK 选体/计分 | `js/planetpk.js` → `getPool()`（选哪两个天体）、`onTap()`（判定与计分/生命规则） |
| 改星球PK 布局 | `index.html` 的 `#planetpk-screen` + `css/style.css` 的 `.planetpk-*` |
| 改主菜单（5 个 Tab） | `index.html` 的 `.menu-grid`（2 列网格，第 5 个 `.menu-btn-wide` 跨两列）+ `css/style.css` 的 `.menu-grid`/`.menu-btn` |

## 已知限制

1. 自定义天体照片存 localStorage（base64），大图会导致存储溢出，建议 < 500KB
2. 矮行星/部分恒星/星系无真实纹理，用程序化绘制
3. 探索模式未完全升级到 V4 天体数据
4. debug APK 未签名（不能上架应用商店）
5. 游戏 Tab 为太空射击（V6 重写）：战机+自动射击+下落天体，关卡/生命/特效/音效已实现；尚缺背景音乐、道具、Boss、排行榜
6. 星球PK Tab（V7 新增）：拟人化星球对战，复刻参考视频效果；尚缺背景音乐、连击特效、难度梯度

## 版本历史

| 版本 | 主要内容 |
|------|----------|
| V1.0 | 基础 PK + 探索，30 天体，程序化绘制 |
| V2.0 | 45+ 天体，15 题，PK 胜负动画 |
| V3.0 | 11 张真实纹理，ImageManager 异步加载，粒子特效 |
| V4.0 | 修复 PK 答题卡死 bug，新增「我的星系」自定义天体功能 |
| V5.0 | 新增第 4 个 Tab「游戏」：弹球击退星球原型（Canvas 2D + rAF + 粒子/震屏/危险预警） |
| V5.1 | 游戏 Tab 新增音效（Web Audio 实时合成，无音频文件）+ 静音开关 |
| V6.0 | 游戏 Tab 重写为太空射击（触摸飞行战机 + 自动射击 + 下落真实天体） |
| V7.0 | 主菜单改为 5-Tab 自适应网格；新增第 5 个 Tab「星球PK」：拟人化真实天体对战（闭眼/睁眼、斜射激光、红叉、震屏、金桂冠、硬切转场） |

详见 `docs/迭代记录.md`。
