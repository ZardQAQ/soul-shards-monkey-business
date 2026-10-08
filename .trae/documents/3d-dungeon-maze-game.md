# 3D 地牢迷宫游戏 实施计划

## 一、需求摘要 (Summary)

在当前空文件夹 `c:\Users\14243\Desktop\wuyijie\其他\3d\whatever` 下，从零创建一款基于 HTML + Three.js 的 3D 地牢迷宫探索游戏。

**核心玩法**：玩家以第一人称视角在中世纪地牢风格的 3D 迷宫中探索，需要躲避巡逻的敌人，找到出口逃脱。

**视觉风格**：像素/体素风格建模（使用 BoxGeometry 组合 + 程序化生成的像素纹理），中世纪地牢氛围（石墙、火把、昏暗灯光、雾效）。

**技术栈**：Three.js（通过 CDN 引入，单文件无需构建），原生 JS 模块化，HTML + CSS。

**用户说明**：用户非专业技术人员，代码需附带中文注释，UI 文案使用中文。

---

## 二、当前状态分析 (Current State Analysis)

- 工作目录 `whatever/` 为**空文件夹**，无任何已有代码、依赖或配置。
- 无 `package.json`，无构建工具，无现有约定。
- 决定：采用**纯静态文件 + CDN 引入 Three.js** 方案，避免 npm/构建工具链（用户非技术人员，运行门槛越低越好；双击 `index.html` 或用简易本地服务器即可运行）。
- 由于浏览器 ES Module 安全限制，本地直接双击打开 `file://` 可能无法加载 JS 模块，需在计划中说明启动方式（用 `python -m http.server` 或 VS Code Live Server）。

---

## 三、设计决策 (Assumptions & Decisions)

| 项 | 决策 | 理由 |
|---|---|---|
| 3D 库 | Three.js r160+ (CDN) | 用户指定；文档丰富、上手快 |
| 模块加载 | ES Modules + `<script type="module">` | 现代标准，代码组织清晰 |
| 建模方式 | BoxGeometry 体素组合 + 程序化像素纹理 | 用户要求"像素风格"；无需外部模型文件，零依赖 |
| 纹理来源 | 全部用 Canvas API 程序化生成 | 避免外部图片资源，保证零依赖、可离线运行 |
| 迷宫算法 | 递归回溯法 (Recursive Backtracker) | 经典算法，生成迷宫有长走廊适合地牢探索感 |
| 相机控制 | PointerLockControls (Three.js 内置) | 第一人称沉浸感，鼠标锁定视角 |
| 碰撞检测 | AABB 网格碰撞（基于迷宫格子） | 简单高效，无需物理引擎 |
| 敌人 AI | 状态机：巡逻 → 警戒 → 追击 | 经典 stealth 玩法 |
| 视线检测 | 简化 raycasting（曼哈顿距离 + 直线判定） | 性能可控 |
| 灯光氛围 | 环境光 + 玩家手持火把 + 墙壁火把(闪烁) + 雾效 | 地牢昏暗氛围 |
| 字体 | 系统等宽字体 + CSS 像素风字体 | 无需外部字体文件 |

---

## 四、项目结构 (Proposed File Structure)

```
whatever/
├── index.html              # 入口页面，加载 Three.js CDN 与所有模块
├── css/
│   └── style.css           # UI 样式（菜单、HUD、准星、遮罩）
├── js/
│   ├── main.js             # 程序入口，初始化 Game 实例
│   ├── game.js             # 游戏状态机与主循环 (menu/playing/won/lost)
│   ├── scene.js            # Three.js 场景/相机/渲染器/灯光初始化
│   ├── maze.js             # 迷宫生成算法 + 网格数据
│   ├── world.js            # 地牢视觉构建（墙/地/顶/火把/道具）
│   ├── player.js           # 玩家控制器（移动、碰撞、视角）
│   ├── enemy.js            # 敌人 AI（巡逻/追击/视线检测）
│   ├── input.js            # 键盘/鼠标输入处理
│   ├── ui.js               # HUD、菜单、胜负界面、小地图
│   └── utils.js            # 工具：像素纹理生成、体素构建器、RNG
└── .trae/
    └── documents/
        └── 3d-dungeon-maze-game.md   # 本计划文件
```

**文件数共 11 个**（含计划文件），符合"完整中型项目"规模但不臃肿。

---

## 五、各文件实现细节 (Proposed Changes)

### 1. `index.html` — 入口页面
- 加载 Three.js r160+ (ES Module CDN: `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`)
- 加载 PointerLockControls (从 `three/addons/controls/PointerLockControls.js`)
- 通过 `<script type="module" src="./js/main.js">` 启动游戏
- DOM 中预留：开始菜单容器、HUD 容器、准星、胜负遮罩、小地图 canvas
- 引入 `css/style.css`

### 2. `css/style.css` — UI 样式
- 全屏 canvas，无滚动条
- 开始菜单：半透明黑色遮罩 + 居中标题"地牢逃脱"+ 副标题"点击开始"+ 操作说明（WASD 移动 / 鼠标视角 / Shift 跑步）
- HUD：左上角目标提示、右上角状态（被敌人发现时红色警示边框）、底部中央准星
- 胜负界面：绿色"逃脱成功！"/红色"被抓到了..."，附"重新开始"按钮
- 小地图：右上角 150x150 canvas，暗色背景，显示已探索区域、玩家、敌人、出口
- 像素风格：禁用抗锯齿字体，`image-rendering: pixelated`

### 3. `js/main.js` — 程序入口
- 等待 DOM 加载完成
- 创建 `Game` 实例并调用 `start()`
- 处理窗口 resize 事件

### 4. `js/game.js` — 游戏状态机
- 状态：`MENU` / `LOADING` / `PLAYING` / `PAUSED` / `WON` / `LOST`
- 持有 `Scene`、`Player`、`Enemy[]`、`World`、`UI`、`Input` 引用
- 主循环 `requestAnimationFrame`：更新 → 渲染
- 状态切换逻辑（开始游戏 / 暂停 / 胜利 / 失败 / 重启）
- 难度参数：迷宫尺寸（默认 15x15 格）、敌人数量（默认 3 个）

### 5. `js/scene.js` — Three.js 场景
- 创建 `Scene`、`PerspectiveCamera` (FOV 75)、`WebGLRenderer` (抗锯齿)
- 雾效 `FogExp2`（深色，营造昏暗氛围）
- 环境光（弱，让暗处仍可辨别）
- 玩家头顶火把：`PointLight`（暖橙色，跟随相机）
- 渲染循环与 resize 处理
- 暴露 `add(obj)` / `remove(obj)` 接口

### 6. `js/maze.js` — 迷宫生成
- 递归回溯算法生成 2D 网格（0=通路，1=墙）
- 网格尺寸可配置（默认 15x15，外圈固定为墙）
- 起点：左上角附近；出口：右下角附近（标记为 2）
- 暴露 `getCell(x, y)` 用于碰撞检测
- 暴露 `isWall(worldX, worldZ)` 世界坐标查询

### 7. `js/world.js` — 地牢视觉构建
- **墙体**：对每个墙格子放置 BoxGeometry，使用程序化生成的石砖像素纹理
- **地板**：大平面 BoxGeometry，程序化鹅卵石像素纹理
- **天花板**：大平面 BoxGeometry，深色石纹
- **火把**：每隔几格墙挂一个火把（小方块 + PointLight 闪烁动画）
- **出口标记**：发光的绿色门框体素 + 旋转粒子效果
- **装饰**：随机放置木桶、木箱（体素组合）作为氛围道具
- 单元格世界尺寸：`CELL_SIZE = 4` 单位

### 8. `js/player.js` — 玩家控制器
- 封装 PointerLockControls
- WASD 移动 + Shift 加速（跑步，消耗体力）
- 体力系统：跑步消耗，静止/走路恢复
- 碰撞检测：移动后检查目标位置所在格子是否为墙，是则回滚该轴位移
- 暴露 `update(dt)`、`getPosition()`、`getDirection()`

### 9. `js/enemy.js` — 敌人 AI
- 体素怪物造型（由多个 BoxGeometry 组成的史莱姆/骷髅像素风）
- 状态机：`PATROL`（沿走廊随机巡逻）→ `ALERT`（发现玩家，朝玩家方向移动）→ `CHASE`（持续追击）
- 视线检测：距离阈值 + 直线无墙阻挡判定
- 碰撞玩家：触发 `LOST` 状态
- 巡逻路径：基于迷宫通路相邻格随机选择
- 暴露 `update(dt, player, maze)`

### 10. `js/input.js` — 输入处理
- 监听 keydown/keyup 维护按键状态 Map
- 监听 PointerLock 状态变化
- 监听 ESC 暂停
- 暴露 `isDown(key)` / `justPressed(key)`

### 11. `js/ui.js` — HUD 与菜单
- 切换开始菜单显示/隐藏
- 更新 HUD：目标文字、体力条、警戒状态
- 显示胜负界面并绑定重启按钮
- 绘制小地图：遍历迷宫网格，已探索格亮色，未探索格黑色，玩家黄点，敌人红点（仅当敌人可见时显示），出口绿点
- 显示加载提示

### 12. `js/utils.js` — 工具函数
- `createPixelTexture(width, height, drawFn)`：用 Canvas 生成像素纹理，返回 THREE.CanvasTexture，`magFilter = NearestFilter` 保持像素感
- 预置纹理：`stoneBrick`、`cobblestone`、`wood`、`torch`、`enemySkin`
- `voxelBuilder()`：辅助用 BoxGeometry 组合体素模型
- `mulberry32(seed)`：可复现的伪随机数生成器
- `clamp(v, min, max)` 等通用数学工具

---

## 六、技术关键点

1. **零外部资源**：所有纹理通过 Canvas 程序化生成，所有模型用 BoxGeometry 组合。用户无需准备任何素材文件。
2. **像素感渲染**：纹理 `NearestFilter`、关闭 mipmap、`image-rendering: pixelated`。
3. **性能优化**：
   - 墙体使用 `InstancedMesh` 单次绘制（数百个墙格只需 1 draw call）
   - 火把 PointLight 数量限制（≤8 个），超出用无光火把装饰
   - 雾效让远处不需渲染细节
4. **碰撞检测简化**：玩家位置除以 CELL_SIZE 得到网格坐标，查 maze 数组即可判断是否撞墙，无需物理引擎。
5. **启动方式**：因 ES Module 的 CORS 限制，`file://` 直接打开会报错。计划在 README/菜单中说明：用 `python -m http.server 8000` 后访问 `localhost:8000`，或使用 VS Code Live Server 插件。

---

## 七、验证步骤 (Verification Steps)

1. **结构验证**：确认 11 个文件按计划结构创建。
2. **启动验证**：在 `whatever/` 目录运行 `python -m http.server 8000`，浏览器访问 `http://localhost:8000`，页面无控制台报错。
3. **菜单验证**：看到开始菜单显示"地牢逃脱"标题与"点击开始"按钮。
4. **游戏验证**：
   - 点击开始后进入第一人称视角，鼠标锁定
   - WASD 可移动，鼠标可转视角
   - 撞墙不能穿过
   - 可看到墙壁火把与氛围灯光
   - 小地图正常显示玩家位置
5. **敌人验证**：可见敌人在迷宫中巡逻；进入视线后追击；接触玩家时显示失败界面。
6. **胜利验证**：到达出口（绿色门）时显示胜利界面。
7. **重启验证**：点击"重新开始"可重新生成迷宫并开始新游戏。
8. **像素风格验证**：墙、地、敌人、火把均呈现明显像素/体素质感。

---

## 八、实施顺序 (Implementation Order)

1. 创建 `index.html` + `css/style.css` + `js/main.js`（基础骨架）
2. 实现 `js/utils.js`（纹理与工具，后续依赖）
3. 实现 `js/scene.js`（Three.js 基础场景，先看到空场景）
4. 实现 `js/maze.js`（迷宫数据生成）
5. 实现 `js/world.js`（地牢视觉，能看到迷宫）
6. 实现 `js/input.js` + `js/player.js`（玩家移动）
7. 实现 `js/enemy.js`（敌人 AI）
8. 实现 `js/ui.js`（HUD + 小地图 + 菜单）
9. 实现 `js/game.js`（串联状态机与主循环）
10. 整体调试与参数调优

---

## 九、待确认事项

无。所有关键决策已在第二节中明确，可立即执行。
