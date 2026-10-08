# 灵魂碎片 · Monkey Business

第一人称 3D 迷宫游戏。乘电梯进入酒店走廊，收集全部灵魂碎片，再跑回电梯逃脱。

**在线游玩：[http://pacman.zard.loc.cc/](http://pacman.zard.loc.cc/)**

建议使用桌面版 Chrome、Edge 或 Firefox。需要键盘、鼠标和 WebGL。

## 两种模式

首页可以切换模式，选择会保存在本地。

| 模式 | 体验 |
|------|------|
| 经典版 | 昏暗酒店走廊，Murder Monkey 追猎。含惊吓、追逐和闪烁画面。 |
| 窝囊版 | 萌宠乐园。敌人换成小橘猫，没有惊吓和血腥，被抓住只是被猫蹭一脸。 |

光敏性癫痫警告会在经典版开局前出现。对闪光敏感时请选窝囊版，或直接不要开始。

## 怎么通关

1. 乘电梯进入迷宫，收集 **110** 颗紫色灵魂碎片。
2. 碎片集齐后电梯门打开，归途上会再出现一批追兵。
3. 跑回电梯即胜利。被抓住 **3** 次则失败。

路上可以捡技能宝石：

- 青色宝石：全场敌人眩晕 8 秒
- 橙色宝石：小地图显示敌人位置 30 秒

## 操作

| 按键 | 作用 |
|------|------|
| W A S D | 移动 |
| 鼠标 | 转动视角 |
| Shift | 冲刺。可以一直按，但脚步声会暴露位置 |
| V | 疾跑，速度 +25%，持续 3 秒，冷却 20 秒 |
| 空格 | 打开或关闭平板小地图 |
| Z | 缩放小地图 |
| ESC | 暂停 |
| 点击画面 | 锁定鼠标，或从暂停中继续 |

暂停菜单里可以调节视野、亮度和画质。

## 登录与速通榜

- **游客**：直接开玩，成绩不上榜。
- **NodeLoc**：通关后记录个人最佳用时。榜上的名字使用 NodeLoc 昵称。

排行榜按用时从短到长排序。

## 本地运行

不要直接双击 `index.html`。页面使用 ES Module，必须通过网页服务打开。

已安装 Node.js 18 或更高版本时：

```bash
npm start
```

浏览器会打开 `http://127.0.0.1:8765/`。

Windows 也可以双击 `start.bat` 或 `运行游戏.bat`。脚本会依次尝试 Python、Node.js 和 PowerShell，并占用 8765 端口。

只用静态页面时：

```bash
python -m http.server 8765 --bind 127.0.0.1
```

NodeLoc 登录和速通榜需要 `npm start` 启动的 Node 服务。相关环境变量：

| 变量 | 作用 |
|------|------|
| `NodeLoc_CLIENT_ID` / `NodeLoc_CLIENT_SECRET` | NodeLoc OAuth 凭证 |
| `NodeLoc_REDIRECT_URI` | 回调地址，线上为 `http://pacman.zard.loc.cc/oauth/nodeloc` |
| `HOME_URL` | 登录成功后返回的地址，线上为 `http://pacman.zard.loc.cc/` |
| `NODELOC_SESSION_SECRET` | 会话签名密钥 |
| `PORT` / `HOST` | 监听端口和地址 |

凭证只从环境变量读取，不要写进仓库。成绩保存在 `data/profiles.json`。

## 项目结构

```
├── index.html          # 页面与界面
├── css/style.css       # 菜单、HUD、特效
├── js/                 # 游戏逻辑（场景、迷宫、玩家、敌人、碎片）
├── server/             # NodeLoc 登录与速通榜
├── scripts/serve.js    # 本地服务
├── data/profiles.json  # 速通档案
└── vendor/three/       # 本地 Three.js，不依赖 CDN
```

画面纹理用 Canvas 绘制，音效用 Web Audio 合成，没有单独的图片和音频文件。

## 许可

MIT License
