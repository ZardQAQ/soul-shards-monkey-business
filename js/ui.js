// ============================================================
// ui.js - HUD、小地图、菜单界面控制
// 新增：
//   - 灵魂碎片计数器
//   - 心跳屏幕脉动特效（敌人靠近时屏幕边缘红光）
//   - 临时消息提示
//   - 小地图绘制紫色碎片位置
// ============================================================

import { CELL_SIZE } from './maze.js';
import { MODE, getCuteConfig } from './mode.js';

export class UI {
    constructor() {
        this.mode = MODE.CLASSIC;
        // 缓存 DOM 元素
        this.menu = document.getElementById('menu');
        this.homeMenu = document.getElementById('home-menu');
        this.pauseMenu = document.getElementById('pause-menu');
        this.winScreen = document.getElementById('win-screen');
        this.loseScreen = document.getElementById('lose-screen');
        this.caughtScreen = document.getElementById('caught-screen');
        this.loading = document.getElementById('loading');
        this.nextLevelModal = document.getElementById('next-level-modal');

        this.hud = document.getElementById('hud');
        this.crosshair = document.getElementById('crosshair');
        this.tablet = document.getElementById('tablet');
        this.minimap = document.getElementById('minimap');
        this.minimapCtx = this.minimap.getContext('2d');
        this.clickToPlay = document.getElementById('click-to-play');
        this.tabletHint = document.getElementById('tablet-hint');
        this.seizureWarning = document.getElementById('seizure-warning');

        this.objective = document.getElementById('objective');
        this.staminaFill = document.getElementById('stamina-fill');
        this.alertIndicator = document.getElementById('alert-indicator');
        this.winTime = document.getElementById('win-time');
        this.livesIcons = document.getElementById('lives-icons');
        this.runTimerValue = document.getElementById('run-timer-value');
        this._timerDisplay = '';

        // 平板顶部剩余碎片数（显示剩余）
        this.tabletShardRemaining = document.getElementById('tablet-shard-remaining');
        this.shardCounter = document.getElementById('shard-counter');
        this.shardCount = document.getElementById('shard-count');
        this.shardTotal = document.getElementById('shard-total');

        // 技能栏元素
        this.skillBar = document.getElementById('skill-bar');
        this.skillStatus = document.getElementById('skill-status');
        this.skillCooldownFill = document.getElementById('skill-cooldown-fill');

        // 消息提示元素
        this.message = document.getElementById('message');
        this._messageTimer = null;
        this.cmdConsole = document.getElementById('cmd-console');
        this.cmdInput = document.getElementById('cmd-input');

        // 模式切换按钮 / 动态文案元素
        this.modeClassicBtn = document.getElementById('mode-classic');
        this.modeCuteBtn = document.getElementById('mode-cute');
        this.caughtTitle = document.getElementById('caught-title');
        this.loseText = document.getElementById('lose-text');
        this._onModeChange = null;

        // 心跳特效状态
        this._heartbeatIntensity = 0;

        // 已探索区域记录
        this.explored = null;
        this.maze = null;
        this.tabletOpen = false;
        this.tabletCompact = false;
        this._shardRemaining = 0;
        this._shardTotal = 0;
        this._minimapFrame = 0;

        // 初始化：同步模式到 body class（确保 CSS 选择器能生效）
        this.setMode(this.mode);
    }

    /**
     * 设置当前模式并同步 UI（按钮激活态、提示卡显隐、过场 class）
     * @param {string} mode MODE.CLASSIC | MODE.CUTE
     * @param {(mode:string)=>void} [onChange] 模式切换回调
     */
    setMode(mode, onChange = null) {
        this.mode = mode || MODE.CLASSIC;
        this._onModeChange = onChange || null;

        // body 上加 mode-cute / mode-classic，便于 CSS 全局适配
        document.body.classList.toggle('mode-cute', this.mode === MODE.CUTE);
        document.body.classList.toggle('mode-classic', this.mode === MODE.CLASSIC);

        // 按钮激活态
        if (this.modeClassicBtn) {
            const active = this.mode === MODE.CLASSIC;
            this.modeClassicBtn.classList.toggle('active', active);
            this.modeClassicBtn.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        if (this.modeCuteBtn) {
            const active = this.mode === MODE.CUTE;
            this.modeCuteBtn.classList.toggle('active', active);
            this.modeCuteBtn.setAttribute('aria-selected', active ? 'true' : 'false');
        }

        // 模式专属提示卡显隐
        document.querySelectorAll('[data-mode-only]').forEach((el) => {
            const only = el.getAttribute('data-mode-only');
            el.classList.toggle('hidden', only !== this.mode);
        });

        // 被抓 / 失败界面切换 cute 样式
        if (this.caughtScreen) {
            this.caughtScreen.classList.toggle('cute', this.mode === MODE.CUTE);
        }
        if (this.loseScreen) {
            this.loseScreen.classList.toggle('cute', this.mode === MODE.CUTE);
        }

        // 失败界面文案
        if (this.loseText) {
            this.loseText.textContent = this.mode === MODE.CUTE
                ? getCuteConfig().text.loseText
                : 'Murder Monkey 撕碎了你...';
        }
    }

    /** 绑定模式切换按钮点击（在 Game 构造后调用一次即可） */
    bindModeSwitch(onChange) {
        this._onModeChange = onChange || null;
        const handleClick = (mode) => {
            if (this.mode === mode) return;
            this.setMode(mode, this._onModeChange);
            if (typeof this._onModeChange === 'function') this._onModeChange(mode);
        };
        this.modeClassicBtn?.addEventListener('click', () => handleClick(MODE.CLASSIC));
        this.modeCuteBtn?.addEventListener('click', () => handleClick(MODE.CUTE));
    }

    /** 显示加载中界面 */
    showLoading() {
        this._hideAll();
        this.loading.classList.remove('hidden');
    }

    /** 显示主菜单 */
    showMenu() {
        this._hideAll();
        this.menu.classList.remove('hidden');
        this._setHudVisible(false);
    }

    /** 主页设置菜单 */
    showHomeMenu() {
        if (!this.homeMenu) return;
        this.homeMenu.classList.remove('hidden');
        this.homeMenu.setAttribute('aria-hidden', 'false');
    }

    hideHomeMenu() {
        if (!this.homeMenu) return;
        this.homeMenu.classList.add('hidden');
        this.homeMenu.setAttribute('aria-hidden', 'true');
    }

    isHomeMenuOpen() {
        return !!(this.homeMenu && !this.homeMenu.classList.contains('hidden'));
    }

    /** 显示暂停菜单 */
    showPause() {
        this.pauseMenu.classList.remove('hidden');
        this._setHudVisible(false);
    }

    /** 隐藏暂停菜单 */
    hidePause() {
        this.pauseMenu.classList.add('hidden');
        this._setHudVisible(true);
    }

    /** 显示胜利界面 */
    showWin(timeSeconds) {
        this._hideAll();
        // 窝囊版：通关时间 +3 分钟难度惩罚
        const penalty = this.mode === MODE.CUTE ? 180 : 0;
        const display = timeSeconds + penalty;
        const mm = Math.floor(display / 60);
        const ss = Math.floor(display % 60);
        this.winTime.textContent = `用时：${mm}分${ss}秒`;
        this.winScreen.classList.remove('hidden');
        this._setHudVisible(false);
    }

    /** 「下一关」催更弹窗 */
    showNextLevelModal() {
        if (this.nextLevelModal) this.nextLevelModal.classList.remove('hidden');
    }

    hideNextLevelModal() {
        if (this.nextLevelModal) this.nextLevelModal.classList.add('hidden');
    }

    /** 显示失败界面 */
    showLose() {
        this._hideAll();
        this.loseScreen.classList.remove('hidden');
        this._setHudVisible(false);
    }

    /**
     * 被抓过场动画
     * @param {number} livesLeft
     * @param {{ onReady?: () => void }} opts 动画结束后回调（可点击重生）
     */
    showCaught(livesLeft, opts = {}) {
        if (!this.caughtScreen) return;
        this.pauseMenu.classList.add('hidden');
        this.winScreen.classList.add('hidden');
        this.loseScreen.classList.add('hidden');
        this.menu.classList.add('hidden');
        this.loading.classList.add('hidden');
        this.hideCmdConsole();
        this.hideClickToPlay();
        this._setHudVisible(false);

        const livesEl = document.getElementById('caught-lives');
        const btn = document.getElementById('respawn-btn');
        const btnText = document.getElementById('respawn-btn-text');
        if (this.mode === MODE.CUTE) {
            const t = getCuteConfig().text;
            if (this.caughtTitle) this.caughtTitle.textContent = t.caughtTitle;
            if (livesEl) livesEl.textContent = t.caughtLives(livesLeft);
        } else {
            if (this.caughtTitle) this.caughtTitle.textContent = '被抓住了';
            if (livesEl) {
                livesEl.textContent = livesLeft > 0
                    ? `Murder Monkey 撕碎了你… 剩余 ${livesLeft} 条命`
                    : 'Murder Monkey 撕碎了你… 生命耗尽';
            }
        }
        if (btn) {
            btn.disabled = true;
            btn.classList.remove('ready');
        }
        if (btnText) {
            btnText.textContent = livesLeft > 0 ? '点击重生' : '再来一局';
        }

        this.caughtScreen.classList.remove('can-respawn', 'hidden');
        this.caughtScreen.setAttribute('aria-hidden', 'false');

        // 重启动画：强制回流
        const fx = this.caughtScreen.querySelector('.caught-fx');
        const content = this.caughtScreen.querySelector('.caught-content');
        for (const el of [fx, content, this.caughtScreen]) {
            if (!el) continue;
            el.style.animation = 'none';
            // eslint-disable-next-line no-unused-expressions
            el.offsetHeight;
            el.style.animation = '';
        }
        for (const slash of this.caughtScreen.querySelectorAll('.caught-slash, .caught-flash, .caught-vignette, .caught-noise')) {
            slash.style.animation = 'none';
            // eslint-disable-next-line no-unused-expressions
            slash.offsetHeight;
            slash.style.animation = '';
        }

        if (this._caughtReadyTimer) {
            clearTimeout(this._caughtReadyTimer);
            this._caughtReadyTimer = null;
        }
        this._caughtReadyTimer = setTimeout(() => {
            this._caughtReadyTimer = null;
            this.caughtScreen.classList.add('can-respawn');
            if (btn) btn.disabled = false;
            if (typeof opts.onReady === 'function') opts.onReady();
        }, 4000);
    }

    hideCaught() {
        if (this._caughtReadyTimer) {
            clearTimeout(this._caughtReadyTimer);
            this._caughtReadyTimer = null;
        }
        if (!this.caughtScreen) return;
        this.caughtScreen.classList.add('hidden');
        this.caughtScreen.classList.remove('can-respawn');
        this.caughtScreen.setAttribute('aria-hidden', 'true');
    }

    /** 进入游戏时显示 HUD */
    showPlaying() {
        this._hideAll();
        this._setHudVisible(true);
        this.setTabletOpen(false);
    }

    /** 开场光敏性癫痫警告 */
    showSeizureWarning() {
        this._hideAll();
        this._setHudVisible(false);
        if (this.seizureWarning) this.seizureWarning.classList.remove('hidden');
    }

    hideSeizureWarning() {
        if (this.seizureWarning) this.seizureWarning.classList.add('hidden');
    }

    showCmdConsole() {
        if (!this.cmdConsole || !this.cmdInput) return;
        this.cmdConsole.classList.remove('hidden');
        this.cmdConsole.setAttribute('aria-hidden', 'false');
        this.cmdInput.value = '';
        this.cmdInput.placeholder = '输入指令…';
        // 下一帧再 focus，避开 pointer unlock 抢焦点
        requestAnimationFrame(() => this.cmdInput.focus());
    }

    hideCmdConsole() {
        if (!this.cmdConsole || !this.cmdInput) return;
        this.cmdConsole.classList.add('hidden');
        this.cmdConsole.setAttribute('aria-hidden', 'true');
        this.cmdInput.blur();
        this.cmdInput.value = '';
    }

    getCmdText() {
        return (this.cmdInput?.value || '').trim();
    }

    /** 隐藏所有遮罩界面 */
    _hideAll() {
        this.menu.classList.add('hidden');
        this.hideHomeMenu();
        this.pauseMenu.classList.add('hidden');
        this.winScreen.classList.add('hidden');
        this.loseScreen.classList.add('hidden');
        this.loading.classList.add('hidden');
        this.hideCaught();
        if (this.nextLevelModal) this.nextLevelModal.classList.add('hidden');
        if (this.seizureWarning) this.seizureWarning.classList.add('hidden');
        this.hideCmdConsole();
    }

    /** 设置 HUD 显示状态 */
    _setHudVisible(visible) {
        this.hud.style.display = visible ? 'block' : 'none';
        this.crosshair.style.display = visible ? 'block' : 'none';
        if (!visible) {
            this.setTabletOpen(false);
            document.body.classList.remove('alert');
            document.body.classList.remove('heartbeat');
            this.alertIndicator.classList.remove('visible');
            this.hideClickToPlay();
            this._heartbeatIntensity = 0;
        } else if (this.tabletHint) {
            this.tabletHint.style.display = 'block';
        }
    }

    /** 掏出 / 收起平板 */
    toggleTablet() {
        this.setTabletOpen(!this.tabletOpen);
        return this.tabletOpen;
    }

    /** 缩小 / 还原地图（仅地图打开时生效） */
    toggleTabletCompact() {
        if (!this.tabletOpen) return false;
        this.setTabletCompact(!this.tabletCompact);
        return this.tabletCompact;
    }

    setTabletCompact(compact) {
        this.tabletCompact = !!compact;
        if (!this.tablet) return;
        this.tablet.classList.toggle('compact', this.tabletCompact);
    }

    setTabletOpen(open) {
        this.tabletOpen = !!open;
        if (!this.tablet) return;
        if (this.tabletOpen) {
            this.tablet.classList.remove('hidden');
            this.tablet.classList.toggle('compact', this.tabletCompact);
            // 下一帧再加 visible，触发滑入动画
            requestAnimationFrame(() => {
                if (this.tabletOpen) this.tablet.classList.add('visible');
            });
            this.tablet.setAttribute('aria-hidden', 'false');
            if (this.tabletHint) this.tabletHint.style.display = 'none';
        } else {
            this.tablet.classList.remove('visible');
            this.tablet.classList.add('hidden');
            this.tablet.setAttribute('aria-hidden', 'true');
            if (this.tabletHint && this.hud.style.display !== 'none') {
                this.tabletHint.style.display = 'block';
            }
        }
    }

    /** 显示"点击屏幕继续"提示 */
    showClickToPlay() {
        if (this.clickToPlay) {
            this.clickToPlay.classList.remove('hidden');
            this.crosshair.style.display = 'none';
        }
    }

    /** 隐藏"点击屏幕继续"提示 */
    hideClickToPlay() {
        if (this.clickToPlay) {
            this.clickToPlay.classList.add('hidden');
        }
    }

    /**
     * 更新灵魂碎片计数（平板顶部显示剩余数量，贴近原作）
     * @param {number} collected 已收集
     * @param {number} total 总数
     */
    updateShardCount(collected, total) {
        this._shardTotal = total;
        this._shardRemaining = Math.max(0, total - collected);
        if (this.tabletShardRemaining) {
            this.tabletShardRemaining.textContent = String(this._shardRemaining);
        }
        if (this.shardCount) this.shardCount.textContent = collected;
        if (this.shardTotal) this.shardTotal.textContent = total;
    }

    /**
     * 更新生命显示（实心 ♥ / 空心）
     * @param {number} current
     * @param {number} max
     */
    updateLives(current, max = 3) {
        if (!this.livesIcons) return;
        let html = '';
        for (let i = 0; i < max; i++) {
            if (i < current) html += '♥';
            else html += '<span class="life-lost">♥</span>';
        }
        this.livesIcons.innerHTML = html;
    }

    /**
     * 更新右上角用时（m:ss）
     * @param {number} seconds
     */
    updateTimer(seconds) {
        if (!this.runTimerValue) return;
        const t = Math.max(0, Number(seconds) || 0);
        const mm = Math.floor(t / 60);
        const ss = Math.floor(t % 60);
        const text = `${mm}:${String(ss).padStart(2, '0')}`;
        if (text === this._timerDisplay) return;
        this._timerDisplay = text;
        this.runTimerValue.textContent = text;
    }

    /**
     * 设置当前任务提示
     * @param {string} text 任务文本
     * @param {boolean} escape 是否为逃脱阶段（绿色高亮）
     */
    setObjective(text, escape = false) {
        if (!this.objective) return;
        this.objective.textContent = text;
        if (escape) this.objective.classList.add('escape');
        else this.objective.classList.remove('escape');
    }

    /**
     * 更新技能栏显示
     * @param {{active:boolean, cooling:boolean, activeRemaining:number, activeDuration:number, cooldownRemaining:number, cooldownDuration:number}} state
     */
    updateSkill(state) {
        if (!this.skillBar) return;
        this.skillBar.classList.toggle('active', !!state.active);
        this.skillBar.classList.toggle('cooling', !!state.cooling);
        if (state.active) {
            this.skillStatus.textContent = `加速中 · ${state.activeRemaining.toFixed(1)}s`;
            this.skillCooldownFill.style.height = '0%';
        } else if (state.cooling) {
            this.skillStatus.textContent = `冷却 · ${state.cooldownRemaining.toFixed(1)}s`;
            const pct = (state.cooldownRemaining / state.cooldownDuration) * 100;
            this.skillCooldownFill.style.height = pct + '%';
        } else {
            this.skillStatus.textContent = '就绪 · +25%';
            this.skillCooldownFill.style.height = '0%';
        }
    }

    /**
     * 显示临时消息提示
     * @param {string} text 消息内容
     * @param {number} duration 显示时长（秒）
     */
    showMessage(text, duration = 3) {
        if (!this.message) return;
        this.message.textContent = text;
        this.message.classList.add('visible');
        if (this._messageTimer) clearTimeout(this._messageTimer);
        this._messageTimer = setTimeout(() => {
            this.message.classList.remove('visible');
        }, duration * 1000);
    }

    /**
     * 设置心跳屏幕特效强度
     * @param {number} nearestEnemyDistance 最近敌人距离（格）
     */
    setHeartbeatIntensity(nearestEnemyDistance) {
        // 距离 < 10 时开始有红光；越近越强
        if (nearestEnemyDistance > 10) {
            this._heartbeatIntensity = 0;
            document.body.classList.remove('heartbeat');
            document.documentElement.style.setProperty('--hb-intensity', '0');
        } else {
            const t = Math.max(0, Math.min(1, (10 - nearestEnemyDistance) / 10));
            this._heartbeatIntensity = t;
            document.documentElement.style.setProperty('--hb-intensity', String(t));
            if (t > 0.1) {
                document.body.classList.add('heartbeat');
            } else {
                document.body.classList.remove('heartbeat');
            }
        }
    }

    /**
     * 初始化小地图数据
     * @param {Maze} maze
     */
    initMinimap(maze) {
        this.maze = maze;
        // 默认全图解锁（显示全部迷宫）
        this.explored = Array.from({ length: maze.height }, () =>
            new Array(maze.width).fill(true)
        );
        // 默认不显示敌人位置，需探知宝石（限时）
        this.showEnemiesOnMap = false;
        this._enemyRevealTimer = 0;
    }

    /**
     * 开启小地图显示敌人（duration 秒后自动关闭；<=0 表示立即关闭）
     */
    setShowEnemiesOnMap(enabled, duration = 0) {
        if (!enabled) {
            this.showEnemiesOnMap = false;
            this._enemyRevealTimer = 0;
            return;
        }
        this.showEnemiesOnMap = true;
        this._enemyRevealTimer = Math.max(0, duration);
    }

    /** 每帧更新显形剩余时间 */
    updateEnemyReveal(dt) {
        if (!this.showEnemiesOnMap || this._enemyRevealTimer <= 0) return;
        this._enemyRevealTimer -= dt;
        if (this._enemyRevealTimer <= 0) {
            this.showEnemiesOnMap = false;
            this._enemyRevealTimer = 0;
        }
    }

    getEnemyRevealRemaining() {
        return this.showEnemiesOnMap ? Math.max(0, this._enemyRevealTimer) : 0;
    }

    /**
     * 标记玩家附近格子为已探索（全图已开时为 no-op 兼容）
     */
    markExplored(gridX, gridY, radius = 3) {
        if (!this.explored) return;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = gridX + dx;
                const y = gridY + dy;
                if (x >= 0 && x < this.maze.width && y >= 0 && y < this.maze.height) {
                    if (dx * dx + dy * dy <= radius * radius) {
                        this.explored[y][x] = true;
                    }
                }
            }
        }
    }

    /**
     * 更新体力条
     */
    updateStamina(ratio) {
        const pct = Math.max(0, Math.min(100, ratio * 100));
        this.staminaFill.style.width = pct + '%';
        if (pct < 25) {
            this.staminaFill.style.background = 'linear-gradient(to right, #c62828, #ef5350)';
        } else {
            this.staminaFill.style.background = 'linear-gradient(to right, #8844dd, #bb44ff)';
        }
    }

    /**
     * 设置警戒状态
     */
    setAlert(alert) {
        if (alert) {
            this.alertIndicator.textContent = this.mode === MODE.CUTE
                ? getCuteConfig().text.alert
                : '！被发现了！';
            this.alertIndicator.classList.add('visible');
            document.body.classList.add('alert');
        } else {
            this.alertIndicator.classList.remove('visible');
            document.body.classList.remove('alert');
        }
    }

    /**
     * 绘制平板小地图（DD 风格：紫霓虹线框 + 节点 + 红点玩家）
     */
    drawMinimap(player, enemies, shards, gems = null) {
        if (!this.maze || !this.tabletOpen) return;
        this._minimapFrame = (this._minimapFrame + 1) % 2;
        if (this._minimapFrame !== 0) return;

        const ctx = this.minimapCtx;
        const W = this.minimap.width;
        const H = this.minimap.height;
        // 地图与玩家共用画布中心
        // 注意：世界格中心是整数坐标 (n*CELL_SIZE)，格子应画成 [n-0.5, n+0.5]
        const cx = W * 0.5;
        const cy = H * 0.5;

        const viewRadius = 8.5;
        const scale = Math.min(W, H) / (viewRadius * 2.15);

        const pos = player.getPosition();
        const px = pos.x / CELL_SIZE;
        const pz = pos.z / CELL_SIZE;
        const dir = player.getDirection();
        const fx = dir.x;
        const fz = dir.z;

        /** 世界格坐标 → 屏幕（上=前方，右=右方） */
        const toScreen = (mx, mz) => {
            const dx = mx - px;
            const dz = mz - pz;
            const localRight = dx * fz - dz * fx;
            const localFwd = dx * fx + dz * fz;
            return {
                // X 取反，与视角左右对齐
                x: cx - localRight * scale,
                y: cy - localFwd * scale,
            };
        };

        const inView = (mx, mz) => {
            const dx = mx - px;
            const dz = mz - pz;
            return dx * dx + dz * dz <= (viewRadius + 1.2) * (viewRadius + 1.2);
        };

        // 纯黑底
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, W, H);

        const gMinX = Math.max(0, Math.floor(px - viewRadius - 1));
        const gMaxX = Math.min(this.maze.width - 1, Math.ceil(px + viewRadius + 1));
        const gMinY = Math.max(0, Math.floor(pz - viewRadius - 1));
        const gMaxY = Math.min(this.maze.height - 1, Math.ceil(pz + viewRadius + 1));

        const pad = 0.12; // 格单位内缩
        const pathCells = [];

        // —— 1) 走廊填充：以整数格为中心 ——
        ctx.fillStyle = 'rgba(90, 20, 130, 0.35)';
        for (let gy = gMinY; gy <= gMaxY; gy++) {
            for (let gx = gMinX; gx <= gMaxX; gx++) {
                if (this.maze.getCell(gx, gy) === 1) continue;
                if (!inView(gx, gy)) continue;
                pathCells.push([gx, gy]);
                const x0 = gx - 0.5 + pad;
                const x1 = gx + 0.5 - pad;
                const y0 = gy - 0.5 + pad;
                const y1 = gy + 0.5 - pad;
                const c00 = toScreen(x0, y0);
                const c10 = toScreen(x1, y0);
                const c11 = toScreen(x1, y1);
                const c01 = toScreen(x0, y1);
                ctx.beginPath();
                ctx.moveTo(c00.x, c00.y);
                ctx.lineTo(c10.x, c10.y);
                ctx.lineTo(c11.x, c11.y);
                ctx.lineTo(c01.x, c01.y);
                ctx.closePath();
                ctx.fill();
            }
        }

        // —— 2) 霓虹紫墙线 ——
        const drawWallEdges = (glow) => {
            ctx.beginPath();
            for (const [gx, gy] of pathCells) {
                const x0 = gx - 0.5;
                const y0 = gy - 0.5;
                const x1 = gx + 0.5;
                const y1 = gy + 0.5;
                const edge = (ax, az, bx, bz) => {
                    const a = toScreen(ax, az);
                    const b = toScreen(bx, bz);
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                };
                if (this.maze.isWallCell(gx, gy - 1)) edge(x0, y0, x1, y0);
                if (this.maze.isWallCell(gx, gy + 1)) edge(x0, y1, x1, y1);
                if (this.maze.isWallCell(gx - 1, gy)) edge(x0, y0, x0, y1);
                if (this.maze.isWallCell(gx + 1, gy)) edge(x1, y0, x1, y1);
            }
            if (glow) {
                ctx.strokeStyle = 'rgba(220, 60, 255, 0.55)';
                ctx.lineWidth = Math.max(3.5, scale * 0.28);
                ctx.shadowColor = '#d030ff';
                ctx.shadowBlur = 10;
            } else {
                ctx.strokeStyle = '#e060ff';
                ctx.lineWidth = Math.max(1.6, scale * 0.14);
                ctx.shadowColor = '#ff66ff';
                ctx.shadowBlur = 4;
            }
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.shadowBlur = 0;
        };
        drawWallEdges(true);
        drawWallEdges(false);

        // —— 3) 路径节点 ——
        for (const [gx, gy] of pathCells) {
            let n = 0;
            if (!this.maze.isWallCell(gx, gy - 1)) n++;
            if (!this.maze.isWallCell(gx, gy + 1)) n++;
            if (!this.maze.isWallCell(gx - 1, gy)) n++;
            if (!this.maze.isWallCell(gx + 1, gy)) n++;
            const p = toScreen(gx, gy);
            const r = n >= 3 ? Math.max(2.2, scale * 0.16) : Math.max(1.2, scale * 0.09);
            ctx.fillStyle = n >= 3 ? 'rgba(230, 140, 255, 0.85)' : 'rgba(160, 60, 220, 0.55)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // —— 4) 起点电梯 ——
        const sx = this.maze.start.x;
        const sy = this.maze.start.y;
        const allCollected = !!(shards && shards.isAllCollected());
        if (inView(sx, sy)) {
            const p = toScreen(sx, sy);
            const s = scale * 0.55;
            ctx.save();
            ctx.shadowColor = allCollected ? '#40ff80' : '#ffcc40';
            ctx.shadowBlur = 10;
            ctx.strokeStyle = allCollected ? '#60ff90' : '#ffd060';
            ctx.lineWidth = 2;
            ctx.strokeRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
            ctx.fillStyle = allCollected ? 'rgba(60, 255, 120, 0.55)' : 'rgba(255, 200, 60, 0.45)';
            ctx.fillRect(p.x - s * 0.28, p.y - s * 0.28, s * 0.56, s * 0.56);
            ctx.restore();
        }

        // —— 5) 灵魂碎片 ——
        let shardInView = false;
        let nearestShard = null;
        let nearestShardDist = Infinity;
        if (shards) {
            for (const shard of shards.shards) {
                if (shard.collected) continue;
                const mx = shard.cell.x;
                const mz = shard.cell.y;
                const d2 = (mx - px) * (mx - px) + (mz - pz) * (mz - pz);
                if (d2 < nearestShardDist) {
                    nearestShardDist = d2;
                    nearestShard = { x: mx, z: mz };
                }
                if (!inView(mx, mz)) continue;
                shardInView = true;
                const p = toScreen(mx, mz);
                const r = Math.max(2.8, scale * 0.28);
                ctx.save();
                ctx.shadowColor = '#ffe080';
                ctx.shadowBlur = 12;
                ctx.fillStyle = '#fff0a0';
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        // —— 6) 宝石 ——
        if (gems) {
            for (const g of gems.gems) {
                if (g.collected) continue;
                const mx = g.cell.x;
                const mz = g.cell.y;
                if (!inView(mx, mz)) continue;
                const p = toScreen(mx, mz);
                const col = g.type === 'STUN' ? '#40e8ff' : '#ffb020';
                ctx.save();
                ctx.shadowColor = col;
                ctx.shadowBlur = 10;
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(p.x, p.y, Math.max(2.2, scale * 0.2), 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        // —— 7) 敌人 ——
        if (this.showEnemiesOnMap) {
            for (const enemy of enemies) {
                const mx = enemy.position.x / CELL_SIZE;
                const mz = enemy.position.z / CELL_SIZE;
                if (!inView(mx, mz)) continue;
                const p = toScreen(mx, mz);
                const col = enemy.stunTimer > 0 ? '#88ddff' : '#ff4040';
                ctx.save();
                ctx.shadowColor = col;
                ctx.shadowBlur = 8;
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(p.x, p.y, Math.max(2.8, scale * 0.26), 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        // —— 8) 方位箭头：视野内无碎片 → 最近水晶；集齐后 → 回家 ——
        let guide = null;
        let guideLabel = '';
        let guideColor = '#ffe080';
        if (allCollected) {
            if (!inView(sx, sy)) {
                guide = { x: sx, z: sy };
                guideLabel = 'HOME';
                guideColor = '#60ff90';
            }
        } else if (!shardInView && nearestShard) {
            guide = nearestShard;
            guideLabel = 'SHARD';
            guideColor = '#ffe080';
        }
        if (guide) {
            const dx = guide.x - px;
            const dz = guide.z - pz;
            const localRight = dx * fz - dz * fx;
            const localFwd = dx * fx + dz * fz;
            // 与 toScreen 一致：X 取反
            const ang = Math.atan2(-localRight, localFwd); // 0=正前(上)
            const ax = W * 0.5;
            const ay = 28;
            ctx.save();
            ctx.translate(ax, ay);
            ctx.rotate(ang);
            ctx.shadowColor = guideColor;
            ctx.shadowBlur = 12;
            ctx.fillStyle = guideColor;
            ctx.beginPath();
            ctx.moveTo(0, -14);
            ctx.lineTo(9, 8);
            ctx.lineTo(0, 3);
            ctx.lineTo(-9, 8);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.fillStyle = guideColor;
            ctx.font = 'bold 11px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 4;
            ctx.fillText(guideLabel, ax, ay + 16);
            ctx.restore();
        }

        // —— 9) 玩家红点 ——
        const pr = Math.max(5, scale * 0.42);
        ctx.save();
        ctx.shadowColor = '#ff1020';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#ff1828';
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ff9098';
        ctx.beginPath();
        ctx.arc(cx, cy - pr * 0.15, pr * 0.38, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}
