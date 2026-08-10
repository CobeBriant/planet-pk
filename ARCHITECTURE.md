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
├── index.html              # ★ 主页面 — 4 个屏幕的 HTML 结构
├── css/style.css           # ★ 全部样式 — 响应式 + 动画
├── js/data.js              # ★ 天体数据库 — 45+ 个天体的真实天文数据
├── js/game.js              # ★ 核心游戏引擎 — 渲染/PK逻辑/探索/自定义天体
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

**重要：改代码只改 `index.html` / `css/style.css` / `js/data.js` / `js/game.js` 这 4 个文件。**
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

## 已知限制

1. 自定义天体照片存 localStorage（base64），大图会导致存储溢出，建议 < 500KB
2. 矮行星/部分恒星/星系无真实纹理，用程序化绘制
3. 无音效
4. 探索模式未完全升级到 V4 天体数据
5. debug APK 未签名（不能上架应用商店）

## 版本历史

| 版本 | 主要内容 |
|------|----------|
| V1.0 | 基础 PK + 探索，30 天体，程序化绘制 |
| V2.0 | 45+ 天体，15 题，PK 胜负动画 |
| V3.0 | 11 张真实纹理，ImageManager 异步加载，粒子特效 |
| V4.0 | 修复 PK 答题卡死 bug，新增「我的星系」自定义天体功能 |

详见 `docs/迭代记录.md`。
