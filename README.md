# 星球PK

> 给小朋友的宇宙天体大小对比游戏，完全离线运行，无广告无内购。

## 简介

星球PK 是一款专为小朋友设计的科普小游戏，通过 PK 对战的方式让小朋友直观感受宇宙中各种天体的大小差异——从水星到 IC 1101 星系，跨越 15 个数量级。

## 玩法

### PK 对战模式
- 屏幕左右各展示一个天体
- 玩家判断哪个天体"更大"或"更重"
- 答对得分，连续答对有连击奖励
- 共 10 题，难度递增：行星 → 恒星 → 星系/黑洞
- 答完后展示真实比例对比图和科普知识

### 自由探索模式
- 上下滑动穿越宇宙尺度
- 从谷神星一路放大到 IC 1101 星系
- 点击天体查看详细信息（半径、质量、科普描述）

## 天体数据

共包含 30+ 个天体，使用真实天文数据：

| 类别 | 数量 | 示例 |
|------|------|------|
| 行星/矮行星 | 10 | 水星、地球、木星、冥王星 |
| 卫星 | 7 | 月球、木卫三、土卫六 |
| 恒星 | 9 | 太阳、天狼星、参宿四、UY Scuti |
| 星系/黑洞 | 5 | 银河系、仙女座、TON 618 |

数据来源：NASA、ESA、Wikipedia 天文条目。

## 技术栈

- **渲染引擎**：HTML5 Canvas
- **游戏逻辑**：Vanilla JavaScript（无框架依赖）
- **数据**：JSON 内嵌，完全离线
- **打包**：Capacitor（HTML5 → Android APK）

## 本地运行

### 方式一：直接打开浏览器
```bash
# 直接用浏览器打开 index.html 即可游玩
open index.html
```

### 方式二：本地服务器
```bash
# 使用 Python 内置服务器
python3 -m http.server 8080

# 浏览器访问 http://localhost:8080
```

## 打包 Android APK

### 前置条件
- Node.js 18+
- Android Studio
- Java JDK 17+

### 步骤

```bash
# 1. 安装 Capacitor
cd planet-pk
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android

# 2. 初始化 Capacitor
npx cap init "星球PK" "com.planetpk.game" --web-dir="."

# 3. 添加 Android 平台
npx cap add android

# 4. 同步资源
npx cap sync

# 5. 在 Android Studio 中打开
npx cap open android

# 6. 在 Android Studio 中点击 Build → Build APK
```

生成的 APK 位于：
```
android/app/build/outputs/apk/debug/app-debug.apk
```

### 安装到手机

```bash
# 方式一：ADB 安装
adb install android/app/build/outputs/apk/debug/app-debug.apk

# 方式二：将 APK 文件传到手机，直接打开安装
```

## 项目结构

```
planet-pk/
├── index.html          # 主页面
├── css/
│   └── style.css       # 样式
├── js/
│   ├── data.js         # 天体数据（真实天文数据）
│   └── game.js         # 游戏逻辑
├── assets/             # 资源目录（图标等）
├── README.md           # 本文件
└── capacitor.config.ts # Capacitor 配置（打包时生成）
```

## 自定义

### 添加新天体
编辑 `js/data.js`，按格式添加：
```javascript
{ id: 'new_star', name: '新星', nameEn: 'New Star', category: 'star',
  radius: 1000000, mass: 1e30, color: '#FF6600',
  desc: '这是新添加的恒星描述。' },
```

### 修改题目数量
编辑 `js/game.js`，修改 `STATE.totalRounds`。

### 修改难度分级
编辑 `js/game.js` 中的 `getPoolForRound()` 函数。

## 许可

MIT License — 自由使用、修改、分发。

## 致谢

天体数据参考了以下开源项目：
- [Space Object Comparison](https://github.com/Mr21/space-object-comparison) (MIT)
- [Scale of the Universe 2](https://github.com/matttt/scale_of_the_universe)
