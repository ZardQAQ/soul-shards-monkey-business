// ============================================================
// game.js - 灵魂碎片：Monkey Business
// 嘉年华迷宫 · 收集灵魂碎片 · 躲避 Murder Monkeys · 逃入传送门
// ============================================================

import * as THREE from 'three';
import { Scene } from './scene.js';
import { Maze, CELL_SIZE } from './maze.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Enemy, State } from './enemy.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { AudioSystem } from './audio.js';
import { ShardSystem } from './shard.js';
import { SkillGemSystem, GemType } from './gem.js';
import { mulberry32 } from './utils.js';
import { Auth } from './auth.js';
import { MODE, loadMode, saveMode, getCuteConfig } from './mode.js';

const STATE = {
    MENU: 'MENU',
    LOADING: 'LOADING',
    SEIZURE_WARN: 'SEIZURE_WARN',
    INTRO: 'INTRO',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    CAUGHT: 'CAUGHT',
    WON: 'WON',
    LOST: 'LOST',
};

const MAZE_SIZE = 35;          // 更大迷宫，被追时有绕路空间
const ENEMY_COUNT = 6;
const ESCAPE_ENEMY_COUNT = 6;  // 集齐碎片开电梯后，再刷几只同速猴子
const SHARD_COUNT = 110;
const MAX_LIVES = 3;
const SETTINGS_KEY = 'dd-monkey-settings';
const DEFAULT_FOV = 75;
const DEFAULT_BRIGHTNESS = 100;
const DEFAULT_QUALITY = 100;

export class Game {
    constructor() {
        this.state = STATE.MENU;
        this.scene = null;
        this.maze = null;
        this.world = null;
        this.player = null;
        this.enemies = [];
        this.shards = null;
        this.gems = null;
        this.input = new Input();
        this.ui = new UI();
        this.mode = loadMode();
        this.audio = new AudioSystem({ mode: this.mode });
        this.auth = new Auth();

        this.clock = new THREE.Clock();
        this.elapsed = 0;
        this.alerted = false;
        this._initializing = false;
        this._threatSmoothed = 0;
        this.lives = MAX_LIVES;
        this._intro = null;
        this._escapeMonkeysSpawned = false;
        this._cmdOpen = false;
        this._ignoreUnlockPause = false;
        this._cheated = false;
        this._collectGodMode = false;
        this._caughtReady = false;
        this._pendingRespawn = null;
        this._catchLookAt = null;
        this._lungeEnemy = null;

        this.container = document.getElementById('game-container');

        this._bindUI();
        this._init();
        this._bindSettings();
    }

    /** 兼容入口（构造时已启动） */
    start() {}

    _loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) {
                return { fov: DEFAULT_FOV, brightness: DEFAULT_BRIGHTNESS, quality: DEFAULT_QUALITY };
            }
            const data = JSON.parse(raw);
            const fov = Math.max(60, Math.min(100, Number(data.fov) || DEFAULT_FOV));
            const brightness = Math.max(50, Math.min(150, Number(data.brightness) || DEFAULT_BRIGHTNESS));
            const quality = Math.max(50, Math.min(100, Number(data.quality) || DEFAULT_QUALITY));
            return { fov, brightness, quality };
        } catch {
            return { fov: DEFAULT_FOV, brightness: DEFAULT_BRIGHTNESS, quality: DEFAULT_QUALITY };
        }
    }

    _saveSettings(partial) {
        const next = { ...this._loadSettings(), ...partial };
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        } catch { /* ignore quota */ }
        return next;
    }

    _bindSettings() {
        const settings = this._loadSettings();

        const bindPair = (ids, key, applyFn, formatFn, initial) => {
            const sliders = ids.map((id) => document.getElementById(id)).filter(Boolean);
            const apply = (value, sourceEl = null) => {
                const v = applyFn(value);
                this._saveSettings({ [key]: v });
                for (const slider of sliders) {
                    if (slider !== sourceEl) slider.value = String(v);
                    const label = document.querySelector(`.setting-value[data-for="${slider.id}"]`)
                        || document.querySelector(`.fov-value[data-for="${slider.id}"]`);
                    if (label) label.textContent = formatFn(v);
                }
            };
            for (const slider of sliders) {
                slider.value = String(initial);
                slider.addEventListener('input', () => apply(slider.value, slider));
            }
            apply(initial);
        };

        bindPair(
            ['fov-slider-menu', 'fov-slider-pause'],
            'fov',
            (value) => this.scene
                ? this.scene.setBaseFov(value)
                : Math.max(60, Math.min(100, Number(value) || DEFAULT_FOV)),
            (v) => `${v}°`,
            settings.fov
        );

        bindPair(
            ['brightness-slider-menu', 'brightness-slider-pause'],
            'brightness',
            (value) => this.scene
                ? this.scene.setBrightness(value)
                : Math.max(50, Math.min(150, Number(value) || DEFAULT_BRIGHTNESS)),
            (v) => `${v}%`,
            settings.brightness
        );

        bindPair(
            ['quality-slider-menu', 'quality-slider-pause'],
            'quality',
            (value) => this.scene
                ? this.scene.setQuality(value)
                : Math.max(50, Math.min(100, Number(value) || DEFAULT_QUALITY)),
            (v) => `${v}%`,
            settings.quality
        );
    }

    _init() {
        this._running = true;
        this.scene = new Scene(this.container);
        this.ui.setMode(this.mode, (mode) => this._switchMode(mode));
        this.ui.bindModeSwitch((mode) => this._switchMode(mode));
        this.ui.showMenu();

        this.scene.renderer.domElement.addEventListener('click', () => {
            this._onUserGesture();
            if (this.state === STATE.PLAYING && this.player && !this.player.locked) {
                this.player.lock();
            }
        });

        this.ui.clickToPlay.addEventListener('click', () => {
            this._onUserGesture();
            if (this.state === STATE.PLAYING && this.player && !this.player.locked) {
                this.player.lock();
            }
        });

        this._loop();
    }

    _onUserGesture() {
        if (!this.audio._initialized) {
            this.audio.init();
            this.audio.resume();
        } else {
            this.audio.resume();
        }
    }

    _bindUI() {
        const startBtn = document.getElementById('start-btn');
        startBtn.addEventListener('click', () => {
            if (!this.auth.canStart()) {
                this.auth.setError(
                    this.auth.mode === 'nl'
                        ? '请先使用 NodeLoc 登录'
                        : '无法开始游戏'
                );
                return;
            }
            this.auth.setError('');
            this._onUserGesture();
            this._startNewGame();
        });
        const seizureBtn = document.getElementById('seizure-continue-btn');
        if (seizureBtn) {
            seizureBtn.addEventListener('click', () => {
                if (this.state !== STATE.SEIZURE_WARN) return;
                this._onUserGesture();
                this._acceptSeizureWarning();
            });
        }
        document.getElementById('resume-btn').addEventListener('click', () => {
            this._onUserGesture();
            this._resume();
        });
        const restart = () => {
            this._onUserGesture();
            this._startNewGame();
        };
        document.getElementById('restart-btn-pause').addEventListener('click', restart);
        document.getElementById('restart-btn-win').addEventListener('click', restart);
        document.getElementById('restart-btn-lose').addEventListener('click', restart);

        document.getElementById('home-menu-btn')?.addEventListener('click', () => {
            if (this.state !== STATE.MENU) return;
            this.ui.showHomeMenu();
        });
        document.getElementById('home-menu-back-btn')?.addEventListener('click', () => {
            this.ui.hideHomeMenu();
        });
        document.getElementById('home-menu')?.addEventListener('click', (e) => {
            if (e.target.id === 'home-menu') this.ui.hideHomeMenu();
        });
        document.getElementById('home-btn-pause')?.addEventListener('click', () => {
            this._onUserGesture();
            this._returnToMenu();
        });

        const respawnBtn = document.getElementById('respawn-btn');
        const caughtScreen = document.getElementById('caught-screen');
        const tryRespawn = () => {
            if (this.state !== STATE.CAUGHT || !this._caughtReady) return;
            this._onUserGesture();
            this._confirmRespawn();
        };
        respawnBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            tryRespawn();
        });
        caughtScreen?.addEventListener('click', () => tryRespawn());

        document.getElementById('next-level-btn')?.addEventListener('click', () => {
            this.ui.showNextLevelModal();
        });
        document.getElementById('next-level-ok-btn')?.addEventListener('click', () => {
            this.ui.hideNextLevelModal();
        });
        document.getElementById('next-level-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'next-level-modal') this.ui.hideNextLevelModal();
        });

        document.addEventListener('pointerlockchange', () => {
            if (this._initializing) return;
            if (this.state === STATE.INTRO || this.state === STATE.SEIZURE_WARN || this.state === STATE.CAUGHT) return;
            if (this.state !== STATE.PLAYING || !this.player) return;
            const locked = document.pointerLockElement === this.scene.renderer.domElement;
            if (locked) {
                this.ui.hideClickToPlay();
                this.ui.crosshair.style.display = '';
            } else if (this._cmdOpen || this._ignoreUnlockPause) {
                // 指令输入期间解锁鼠标，不进暂停
                return;
            } else {
                this._pause();
            }
        });

        document.addEventListener('pointerlockerror', () => {
            if (this.state === STATE.PLAYING && this.player) {
                const locked = document.pointerLockElement === this.scene.renderer.domElement;
                if (!locked && !this._cmdOpen) this.ui.showClickToPlay();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (this._cmdOpen) {
                if (e.code === 'Escape') {
                    e.preventDefault();
                    this._closeCmdConsole(true);
                } else if (e.code === 'Enter') {
                    e.preventDefault();
                    this._submitCmd();
                }
                return;
            }

            if (e.code === 'KeyZ') {
                if (this.state === STATE.PLAYING && this.ui.tabletOpen) {
                    e.preventDefault();
                    this.ui.toggleTabletCompact();
                }
                return;
            }
            if (e.code === 'Enter') {
                if (this.state === STATE.SEIZURE_WARN) {
                    e.preventDefault();
                    this._onUserGesture();
                    this._acceptSeizureWarning();
                    return;
                }
                if (this.state === STATE.PLAYING && this.player?.locked) {
                    e.preventDefault();
                    this._openCmdConsole();
                }
                return;
            }
            if (e.code === 'Space') {
                if (this.state === STATE.SEIZURE_WARN) {
                    e.preventDefault();
                    this._onUserGesture();
                    this._acceptSeizureWarning();
                    return;
                }
                if (this.state === STATE.PLAYING) {
                    e.preventDefault();
                    this.ui.toggleTablet();
                }
                return;
            }
            if (e.code !== 'Escape') return;
            if (this.state === STATE.CAUGHT) return;
            if (this.state === STATE.MENU && this.ui.isHomeMenuOpen()) {
                e.preventDefault();
                this.ui.hideHomeMenu();
                return;
            }
            if (this.state === STATE.PLAYING) {
                if (!document.pointerLockElement) this._pause();
            }
        });
    }

    _startNewGame() {
        this.state = STATE.LOADING;
        this.ui.showLoading();
        this._cleanupLevel();

        this._initializing = true;
        this._initLevel();
        this.lives = MAX_LIVES;
        this.ui.updateLives(this.lives, MAX_LIVES);
        this.elapsed = 0;
        this._cheated = false;
        this._collectGodMode = false;
        this._caughtReady = false;
        this._pendingRespawn = null;
        this._catchLookAt = null;
        this._lungeEnemy = null;
        this._threatSmoothed = 0;
        this.clock.start();

        this.audio.startAmbient();
        const progress = this.shards ? this.shards.getProgress() : { collected: 0, total: SHARD_COUNT };
        this.ui.updateShardCount(progress.collected, progress.total);
        this.ui.setObjective('目标：收集所有灵魂碎片', false);
        this.ui.updateTimer(0);

        // 先站进电梯，再弹出癫痫警告；确认后才开电梯过场
        this._prepareIntroPose();
        this.state = STATE.SEIZURE_WARN;
        this.ui.showSeizureWarning();

        setTimeout(() => {
            this._initializing = false;
        }, 300);
    }

    /**
     * 切换游戏模式（经典 / 窝囊）
     * - 持久化选择
     * - 同步 audio 与 UI
     * - 进行中则用新模式重开本局
     */
    _switchMode(mode) {
        if (mode !== MODE.CLASSIC && mode !== MODE.CUTE) return;
        if (this.mode === mode) return;
        saveMode(mode);
        this.mode = mode;
        this.audio.mode = mode;
        // UI 已在按钮点击时由 ui.setMode 同步；这里再保底刷新一次
        this.ui.setMode(mode, (m) => this._switchMode(m));

        // 菜单态：下次开局自动生效；进行中/暂停/被抓则重开以套用新模式
        if (
            this.state === STATE.PLAYING ||
            this.state === STATE.PAUSED ||
            this.state === STATE.CAUGHT ||
            this.state === STATE.INTRO
        ) {
            this._onUserGesture();
            this._startNewGame();
        }
    }

    /** 当前模式下的初始敌人数量（窝囊版更少，降低压迫感） */
    _getEnemyCount() {
        if (this.mode === MODE.CUTE) return getCuteConfig().enemyCount;
        return ENEMY_COUNT;
    }

    /** 当前模式下的逃脱期追加敌人数量 */
    _getEscapeEnemyCount() {
        if (this.mode === MODE.CUTE) return getCuteConfig().escapeEnemyCount;
        return ESCAPE_ENEMY_COUNT;
    }

    /** 开场前把玩家放进轿厢（警告期间可看到场景） */
    _prepareIntroPose() {
        const elev = this.world?.getElevator();
        if (!elev || !this.player) return;
        const start = this.maze.getStartWorldPos();
        this.world.primeLightsAround(start.x, start.z);
        // 朝门外稍远一点看，避免鼻尖贴门
        const lookX = elev.hallPreview?.x ?? elev.outside.x;
        const lookZ = elev.hallPreview?.z ?? elev.outside.z;
        this.player.placeLookingAt(
            elev.interior.x, elev.interior.z,
            lookX, lookZ
        );
        this.world._setDoorOpenAmount(0);
        this.world.elevator.targetOpen = 0;
        if (this.ui.crosshair) this.ui.crosshair.style.display = 'none';
    }

    _acceptSeizureWarning() {
        this.ui.hideSeizureWarning();
        // 确认时再预热一次灯光，确保走廊已点亮
        const start = this.maze?.getStartWorldPos();
        if (start && this.world) this.world.primeLightsAround(start.x, start.z);
        this._beginIntro();
    }

    _beginIntro() {
        const elev = this.world.getElevator();
        if (!elev || !this.player) {
            this.state = STATE.PLAYING;
            this.ui.showPlaying();
            this.player.lock();
            return;
        }

        this.state = STATE.INTRO;
        this.ui.showPlaying();
        this.ui.hideClickToPlay();
        this.ui.setTabletOpen(false);
        this.crosshairHideForIntro = true;
        if (this.ui.crosshair) this.ui.crosshair.style.display = 'none';

        const lookX = elev.hallPreview?.x ?? elev.outside.x;
        const lookZ = elev.hallPreview?.z ?? elev.outside.z;
        this.player.placeLookingAt(
            elev.interior.x, elev.interior.z,
            lookX, lookZ
        );
        this.world._setDoorOpenAmount(0);
        this.world.elevator.targetOpen = 0;

        const start = this.maze.getStartWorldPos();
        this.world.primeLightsAround(start.x, start.z);

        this._intro = {
            phase: 'wait', // wait → ding → open → hold → walk → done
            t: 0,
        };
        this.ui.showMessage('电梯到站…', 1.2);
    }

    _updateIntro(dt) {
        if (!this._intro || !this.world || !this.player) return;
        const elev = this.world.getElevator();
        if (!elev) {
            this._finishIntro();
            return;
        }

        this._intro.t += dt;
        const p = this._intro;
        const lookX = elev.hallPreview?.x ?? (elev.outside.x + elev.faceX * 2);
        const lookZ = elev.hallPreview?.z ?? (elev.outside.z + elev.faceZ * 2);

        if (p.phase === 'wait') {
            if (p.t >= 0.7) {
                p.phase = 'ding';
                p.t = 0;
                this.audio.playElevatorDing();
            }
        } else if (p.phase === 'ding') {
            if (p.t >= 0.45) {
                p.phase = 'open';
                p.t = 0;
                this.world.openElevatorDoors();
                const start = this.maze.getStartWorldPos();
                this.world.primeLightsAround(start.x, start.z);
            }
        } else if (p.phase === 'open') {
            // 门开到位后先停顿，让玩家看清已点亮的走廊
            if (elev.doorOpen >= 0.92 && p.t >= 0.9) {
                p.phase = 'hold';
                p.t = 0;
            } else if (p.t >= 2.0) {
                p.phase = 'hold';
                p.t = 0;
            }
            this.player.placeLookingAt(
                elev.interior.x, elev.interior.z,
                lookX, lookZ
            );
        } else if (p.phase === 'hold') {
            this.player.placeLookingAt(
                elev.interior.x, elev.interior.z,
                lookX, lookZ
            );
            if (p.t >= 0.65) {
                p.phase = 'walk';
                p.t = 0;
            }
        } else if (p.phase === 'walk') {
            this.player.placeLookingAt(
                this.player.camera.position.x,
                this.player.camera.position.z,
                lookX, lookZ
            );
            const arrived = this.player.moveToward(
                elev.outside.x, elev.outside.z, 2.2, dt
            );
            if (arrived || p.t >= 4.0) {
                p.phase = 'done';
                p.t = 0;
                this.world.closeElevatorDoors();
            }
        } else if (p.phase === 'done') {
            if (p.t >= 0.35) this._finishIntro();
        }
    }

    _finishIntro() {
        this._intro = null;
        this.state = STATE.PLAYING;
        if (this.ui.crosshair) this.ui.crosshair.style.display = '';
        this.ui.setObjective('目标：收集所有灵魂碎片', false);
        this.ui.showMessage('按 空格 打开地图 · 按 Z 可缩小', 3.2);
        this.player.lock();
        setTimeout(() => {
            if (this.state === STATE.PLAYING) {
                this.ui.showMessage('收集碎片，再跑回电梯逃脱', 2.8);
            }
        }, 3400);
        setTimeout(() => {
            if (this.state === STATE.PLAYING && this.player && !this.player.locked) {
                this.ui.showClickToPlay();
            }
        }, 300);
    }

    _initLevel() {
        const seed = (Math.random() * 1e9) | 0;
        this.maze = new Maze(MAZE_SIZE, MAZE_SIZE, seed);

        this.scene.clear();
        this.scene.setMode(this.mode);
        this.world = new World(this.scene.scene, this.maze, { mode: this.mode });
        // 重新开局时保持用户设置
        const s = this._loadSettings();
        this.scene.setBaseFov(s.fov);
        this.scene.setBrightness(s.brightness);
        this.scene.setQuality(s.quality);

        this.player = new Player(
            this.scene.camera,
            this.maze,
            this.scene.renderer.domElement,
            this.scene
        );
        this.player.extraBlocked = (x, z, r) =>
            this.world?.isElevatorDoorBlocking(x, z, r) ?? false;

        this.shards = new ShardSystem(this.scene.scene, this.maze, SHARD_COUNT, seed ^ 0x5A4D);
        this.gems = new SkillGemSystem(this.scene.scene, this.maze, seed ^ 0x6E31, {
            stunCount: 4,
            revealCount: 2,
        });
        this.ui.setShowEnemiesOnMap(false);
        this.ui.setTabletOpen(false);

        const rng = mulberry32(seed ^ 0x55AA);
        const candidates = this.maze.pathCells.filter(c => {
            const d = Math.hypot(c.x - this.maze.start.x, c.y - this.maze.start.y);
            return d > MAZE_SIZE * 0.4;
        });
        this.enemies = [];
        this._escapeMonkeysSpawned = false;
        this._cmdOpen = false;
        this._ignoreUnlockPause = false;
        const enemyCount = this._getEnemyCount();
        for (let i = 0; i < enemyCount && candidates.length > 0; i++) {
            const idx = Math.floor(rng() * candidates.length);
            const cell = candidates.splice(idx, 1)[0];
            this.enemies.push(new Enemy(this.scene.scene, this.maze, cell, seed + i, {
                variant: 'monkey',
                mode: this.mode,
            }));
        }

        this.ui.initMinimap(this.maze);
        const sg = this.player.getGridPos();
        this.ui.markExplored(sg.x, sg.y, 4);
    }

    /**
     * 集齐碎片、电梯开启后：在回家路上再刷若干同速猴子，并立刻进入追击
     */
    _spawnEscapeMonkeys(count = this._getEscapeEnemyCount()) {
        if (this._escapeMonkeysSpawned || !this.maze || !this.player) return;
        this._escapeMonkeysSpawned = true;

        const pg = this.player.getGridPos();
        const start = this.maze.start;
        const occupied = new Set();
        for (const e of this.enemies) {
            const ex = Math.round(e.position.x / CELL_SIZE);
            const ez = Math.round(e.position.z / CELL_SIZE);
            occupied.add(ex + ',' + ez);
        }
        occupied.add(pg.x + ',' + pg.y);
        occupied.add(start.x + ',' + start.y);

        // 优先刷在「离玩家不太近、靠电梯一侧」的通路，封堵回家路线
        let candidates = this.maze.pathCells.filter(c => {
            const key = c.x + ',' + c.y;
            if (occupied.has(key)) return false;
            const dPlayer = Math.hypot(c.x - pg.x, c.y - pg.y);
            const dStart = Math.hypot(c.x - start.x, c.y - start.y);
            return dPlayer >= 7 && dStart < MAZE_SIZE * 0.55;
        });
        if (candidates.length < count) {
            candidates = this.maze.pathCells.filter(c => {
                const key = c.x + ',' + c.y;
                if (occupied.has(key)) return false;
                return Math.hypot(c.x - pg.x, c.y - pg.y) >= 6;
            });
        }

        const rng = mulberry32(((Date.now() % 1e9) ^ (this.enemies.length * 9973)) >>> 0);
        const baseSeed = (Date.now() % 1e9) | 0;
        let spawned = 0;
        for (let i = 0; i < count && candidates.length > 0; i++) {
            const idx = Math.floor(rng() * candidates.length);
            const cell = candidates.splice(idx, 1)[0];
            occupied.add(cell.x + ',' + cell.y);
            const enemy = new Enemy(
                this.scene.scene,
                this.maze,
                cell,
                baseSeed + 1000 + i,
                { variant: 'monkey', mode: this.mode }
            );
            // 立刻追击，制造回家压力
            enemy.state = State.HUNT;
            enemy.huntTimer = enemy.huntDuration;
            enemy.lastKnownPlayerCell = { x: pg.x, y: pg.y };
            this.enemies.push(enemy);
            spawned++;
        }

        if (spawned > 0) {
            this.audio.playMonsterRoar();
        }
    }

    /** 打开指令输入（Enter）；quit=开电梯(不上榜)；collect=收齐碎片(可上榜) */
    _openCmdConsole() {
        if (this._cmdOpen || this.state !== STATE.PLAYING) return;
        this._cmdOpen = true;
        this._ignoreUnlockPause = true;
        this.ui.showCmdConsole();
        if (this.player && document.pointerLockElement) {
            this.player.unlock();
        }
    }

    _closeCmdConsole(relock = true) {
        if (!this._cmdOpen) return;
        this._cmdOpen = false;
        this.ui.hideCmdConsole();
        this._ignoreUnlockPause = false;
        if (relock && this.state === STATE.PLAYING && this.player) {
            // 稍后再锁，避免与 unlock 同帧冲突
            setTimeout(() => {
                if (this.state === STATE.PLAYING && this.player && !this._cmdOpen) {
                    this.player.lock();
                }
            }, 50);
        }
    }

    _submitCmd() {
        const raw = this.ui.getCmdText().toLowerCase();
        this._closeCmdConsole(true);
        if (raw === 'quit') {
            this._activateHiddenClear();
        } else if (raw === 'collect') {
            this._activateCollectAll();
        } else if (raw.length > 0) {
            this.ui.showMessage('未知指令', 1.4);
        }
    }

    /** 作弊开启电梯门（不刷额外猴子，便于直接逃脱）——成绩不上榜 */
    _activateHiddenClear() {
        if (!this.world || this.world.isExitOpen()) return;
        this._cheated = true;
        this.world.openExit();
        this.audio.playExitOpen();
        this.audio.playElevatorDing();
        this.ui.setObjective('跑回电梯逃脱', true);
        this.ui.showMessage('？？？ 电梯门自己开了……', 3.2);
    }

    /**
     * 一键收齐全部灵魂碎片并开启电梯（不标记作弊，可上榜）
     * 同时进入无敌：猴子无法锁定/抓到玩家
     */
    _activateCollectAll() {
        if (!this.shards || this.shards.isAllCollected()) {
            this.ui.showMessage('碎片已全部收集', 1.6);
            return;
        }
        const n = this.shards.collectAll();
        if (n <= 0) return;

        this._collectGodMode = true;
        this.audio.playShardCollect();
        const progress = this.shards.getProgress();
        this.ui.updateShardCount(progress.collected, progress.total);
        this._handleAllShardsCollected();
        this._clearEnemyAggro();
        this.ui.setAlert(false);
        this.audio.setThreatLevel(0);
        this.audio.stopHeartbeat();
        const collectMsg = this.mode === MODE.CUTE
            ? getCuteConfig().text.collectAllMsg
            : '碎片已收齐 · 无敌启程，跑回电梯！';
        this.ui.showMessage(collectMsg, 3.5);
    }

    /** 强制所有猴子脱战，不再锁定玩家 */
    _clearEnemyAggro() {
        for (const enemy of this.enemies) {
            enemy.breakOffChase(0);
        }
        this.alerted = false;
        this._threatSmoothed = 0;
        this.ui.setHeartbeatIntensity(Infinity);
    }

    /** 碎片收齐后的统一处理：开门、刷回家猴、更新目标 */
    _handleAllShardsCollected() {
        if (!this.shards?.isAllCollected() || !this.world || this.world.isExitOpen()) return;
        this.world.openExit();
        this.audio.playExitOpen();
        this.audio.playElevatorDing();
        this._spawnEscapeMonkeys();
        // 无敌模式下不显示「被封锁」惊吓文案（由 collect 自己提示）
        if (!this._collectGodMode) {
            const msg = this.mode === MODE.CUTE
                ? getCuteConfig().text.exitOpenMsg
                : '电梯已开启！更多血猴封锁归途——快跑回电梯！';
            this.ui.showMessage(msg, 3.8);
        }
        this.ui.setObjective('跑回电梯逃脱', true);
    }

    _pause() {
        if (this.state !== STATE.PLAYING) return;
        if (this._cmdOpen) this._closeCmdConsole(false);
        this.state = STATE.PAUSED;
        this.ui.hideClickToPlay();
        this.ui.showPause();
        this.audio.stopHeartbeat();
        this.audio.setThreatLevel(0);
        if (this.player && document.pointerLockElement) {
            this.player.unlock();
        }
    }

    _resume() {
        if (this.state !== STATE.PAUSED) return;
        this.state = STATE.PLAYING;
        this.ui.hidePause();
        this.player.lock();
        setTimeout(() => {
            if (this.state === STATE.PLAYING && this.player && !this.player.locked) {
                this.ui.showClickToPlay();
            }
        }, 300);
    }

    /** 从暂停退回主页 */
    _returnToMenu() {
        if (this.state !== STATE.PAUSED) return;
        this._cleanupLevel();
        this.state = STATE.MENU;
        this.alerted = false;
        this.ui.setAlert(false);
        this.ui.showMenu();
        this.auth.refreshBoard();
    }

    _win() {
        if (this.state !== STATE.PLAYING) return;
        this.state = STATE.WON;
        this.player.unlock();
        this.audio.stopHeartbeat();
        this.audio.stopChaseLayer();
        this.audio.stopAmbient();
        this.audio.playWin();
        this.ui.showWin(this.elapsed);
        this.auth.submitRun(this.elapsed, { cheated: this._cheated });
    }

    _lose(catcher = null) {
        if (this.state !== STATE.PLAYING) return;

        this.lives = Math.max(0, this.lives - 1);
        this.ui.updateLives(this.lives, MAX_LIVES);
        this.audio.playCaught();
        // 窝囊版：被抱住不抖屏，温柔一点
        if (this.mode !== MODE.CUTE) {
            this.scene.shake(2.0, 0.28);
        }
        this.ui.setAlert(false);
        this.ui.setHeartbeatIntensity(Infinity);
        this.audio.stopHeartbeat();
        this.audio.setThreatLevel(0);
        this.audio.stopChaseLayer();

        // 计算重生点（动画结束后再传送）
        const pos = this.player.getPosition();
        let dest = this.shards ? this.shards.getNearestShardPos(pos) : null;
        if (!dest) {
            const start = this.maze.getStartWorldPos();
            dest = { x: start.x, z: start.z };
        }
        this._pendingRespawn = { dest, lives: this.lives };
        this._caughtReady = false;

        // 强制看向抓住你的那只血猴（背后被抓也会转头）
        if (catcher && catcher.position) {
            this._catchLookAt = { x: catcher.position.x, z: catcher.position.z };
            this.player.snapLookAt(this._catchLookAt.x, this._catchLookAt.z);
        } else {
            this._catchLookAt = null;
        }

        this.state = STATE.CAUGHT;
        if (this._cmdOpen) this._closeCmdConsole(false);
        this.ui.setTabletOpen(false);
        if (this.player) this.player.unlock();

        // 扑脸怪单独播 3D 冲脸；其余怪脱战
        this._lungeEnemy = catcher || null;
        for (const enemy of this.enemies) {
            if (enemy !== catcher) enemy.breakOffChase(3.5);
        }
        if (catcher) catcher.startFaceLunge(this.player.camera);

        this.ui.showCaught(this.lives, {
            onReady: () => {
                if (this.state === STATE.CAUGHT) this._caughtReady = true;
            },
        });
    }

    /** 动画结束后点击：有命则重生，否则进入失败界面 */
    _confirmRespawn() {
        if (this.state !== STATE.CAUGHT || !this._caughtReady) return;

        const pending = this._pendingRespawn;
        this._caughtReady = false;
        this._pendingRespawn = null;
        this._catchLookAt = null;
        if (this._lungeEnemy) {
            this._lungeEnemy.endFaceLunge(2.8);
            this._lungeEnemy = null;
        }
        this.ui.hideCaught();

        if (!pending || pending.lives <= 0) {
            this.state = STATE.LOST;
            this.audio.stopAmbient();
            this._onUserGesture();
            this._startNewGame();
            return;
        }

        const dest = pending.dest;
        this.player.teleportTo(dest.x, dest.z, 2.8);
        for (const enemy of this.enemies) {
            enemy.breakOffChase(2.8);
        }

        const pg = this.player.getGridPos();
        this.ui.markExplored(pg.x, pg.y, 4);

        this.state = STATE.PLAYING;
        this.ui.showPlaying();
        this.ui.showMessage(`重生！剩余 ${this.lives} 条命`, 2.0);
        this.player.lock();
        setTimeout(() => {
            if (this.state === STATE.PLAYING && this.player && !this.player.locked) {
                this.ui.showClickToPlay();
            }
        }, 300);
    }

    _cleanupLevel() {
        if (this.audio._initialized) {
            this.audio.stopHeartbeat();
            this.audio.stopChaseLayer();
            this.audio.stopAmbient();
        }
        if (this.player) {
            this.player.dispose();
            this.player = null;
        }
        for (const e of this.enemies) e.dispose();
        this.enemies = [];
        if (this.shards) {
            this.shards.dispose();
            this.shards = null;
        }
        if (this.gems) {
            this.gems.dispose();
            this.gems = null;
        }
        if (this.world) {
            this.world.dispose();
            this.world = null;
        }
        if (this.scene) this.scene.clear();
        this.maze = null;
        this._threatSmoothed = 0;
        this._intro = null;
        this._catchLookAt = null;
        this._lungeEnemy = null;
        this.ui.setShowEnemiesOnMap(false);
    }

    _loop() {
        if (!this._running) return;
        requestAnimationFrame(() => this._loop());

        const dt = Math.min(this.clock.getDelta(), 0.05);

        if (this.state === STATE.INTRO) {
            this._updateIntro(dt);
        } else if (this.state === STATE.PLAYING) {
            this._update(dt);
        } else if (this.state === STATE.CAUGHT) {
            const cam = this.player?.camera;
            const lunger = this._lungeEnemy;
            if (lunger && cam) {
                const done = lunger.updateFaceLunge(dt);
                if (done || lunger._lunge?.done) {
                    // 扑脸结束：怪物定格，摄像机摆到正眼前看脸（不穿模）
                    lunger.holdJumpscarePose();
                    lunger.frameCameraOnFace(cam, 0.85);
                } else {
                    // 冲过来过程中跟脸
                    this.player.snapLookAtFace(lunger);
                }
            } else if (this.player && this._catchLookAt) {
                this.player.lookToward(this._catchLookAt.x, this._catchLookAt.z, 8, dt);
            }
        }
        const playerPos = this.player ? this.player.getPosition() : null;
        if (this.world) this.world.update(dt, playerPos);
        if (this.shards) this.shards.update(dt, playerPos);
        if (this.gems) this.gems.update(dt);
        if (this.scene) {
            this.scene.updateCameraEffects(dt);
            if (this.player && (this.player.locked || this.state === STATE.CAUGHT)) {
                const dir = this.player.getDirection();
                this.scene.updateFlashlight(this.player.getPosition(), dir);
            }
            this.scene.render();
        }
        this.input.endFrame();
    }

    _update(dt) {
        // 指令输入时玩家不动，敌人仍可行动
        if (this._cmdOpen) {
            this.elapsed += dt;
            // 仍更新敌人威胁，但不处理玩家输入
            const playerRunning = false;
            const enemyOpts = { ignorePlayer: !!this._collectGodMode };
            let anySee = false;
            let minDist = Infinity;
            for (const enemy of this.enemies) {
                const result = enemy.update(dt, this.player, playerRunning, enemyOpts);
                if (result.canSee) anySee = true;
                if (result.distance < minDist) minDist = result.distance;
            }
            if (this._collectGodMode) {
                anySee = false;
                this.audio.setThreatLevel(0);
                this.ui.setAlert(false);
                this.ui.setHeartbeatIntensity(Infinity);
            } else {
                this.alerted = anySee;
                this.audio.setHeartbeatByDistance(minDist);
                this.ui.setAlert(anySee);
                this.ui.setHeartbeatIntensity(minDist);
            }
            this.ui.updateTimer(this.elapsed);
            this.ui.drawMinimap(this.player, this.enemies, this.shards, this.gems);
            return;
        }

        if (!this.player.locked) return;

        this.elapsed += dt;
        this.player.update(dt, this.input);
        this.ui.updateSkill(this.player.getSkillState());
        this.ui.updateTimer(this.elapsed);

        const playerRunning = this.player.isRunning();
        const enemyOpts = { ignorePlayer: !!this._collectGodMode };

        let anySee = false;
        let caught = false;
        let catcher = null;
        let catchDist = Infinity;
        let minDist = Infinity;
        let roarTriggered = false;
        let spotted = false;

        for (const enemy of this.enemies) {
            const result = enemy.update(dt, this.player, playerRunning, enemyOpts);
            if (result.canSee) anySee = true;
            if (result.caught) {
                caught = true;
                if (!catcher || result.distance < catchDist) {
                    catcher = enemy;
                    catchDist = result.distance;
                }
            }
            if (result.distance < minDist) minDist = result.distance;
            if (result.roar) roarTriggered = true;
            if (result.spotted) spotted = true;
        }

        if (this._collectGodMode) {
            anySee = false;
            caught = false;
            catcher = null;
            spotted = false;
            roarTriggered = false;
            this._threatSmoothed = 0;
            this.audio.setThreatLevel(0);
            this.audio.stopHeartbeat();
            this.ui.setAlert(false);
            this.ui.setHeartbeatIntensity(Infinity);
        }

        this.alerted = anySee;

        if (spotted) {
            this.audio.playSpotCue();
            // 窝囊版：被盯上也不抖屏，轻轻提示一下就好
            if (this.mode !== MODE.CUTE) {
                this.scene.shake(0.45, 0.12);
            }
        }
        if (roarTriggered) {
            this.audio.playMonsterRoar();
        }

        if (!this._collectGodMode) {
            this.audio.setHeartbeatByDistance(minDist);

            let threatTarget = 0;
            if (anySee) threatTarget = 0.75;
            if (minDist < 8) threatTarget = Math.max(threatTarget, 1 - minDist / 8);
            if (minDist < 4 && anySee) threatTarget = 1;
            this._threatSmoothed += (threatTarget - this._threatSmoothed) * Math.min(1, dt * 3);
            this.audio.setThreatLevel(this._threatSmoothed);
        }

        if (this.shards) {
            const collected = this.shards.checkCollect(this.player.getPosition());
            if (collected) {
                this.audio.playShardCollect();
                const progress = this.shards.getProgress();
                this.ui.updateShardCount(progress.collected, progress.total);
                if (this.shards.isAllCollected()) {
                    this._handleAllShardsCollected();
                }
            }
        }

        if (this.gems) {
            const gem = this.gems.checkCollect(this.player.getPosition());
            if (gem) {
                this.audio.playShardCollect();
                if (gem.type === GemType.STUN) {
                    const sec = gem.def.stunSeconds || 8;
                    for (const enemy of this.enemies) enemy.stun(sec);
                    this.ui.showMessage(gem.def.message, 2.5);
                } else if (gem.type === GemType.REVEAL) {
                    const sec = gem.def.revealSeconds || 30;
                    this.ui.setShowEnemiesOnMap(true, sec);
                    this.ui.showMessage(gem.def.message, 2.5);
                }
            }
        }

        const pg = this.player.getGridPos();
        this.ui.markExplored(pg.x, pg.y, 3);
        this.ui.updateStamina(this.player.getStaminaRatio());
        if (this._collectGodMode) {
            this.ui.setAlert(false);
            this.ui.setHeartbeatIntensity(Infinity);
        } else {
            this.ui.setAlert(anySee);
            this.ui.setHeartbeatIntensity(minDist);
        }
        this.ui.updateEnemyReveal(dt);
        this.ui.drawMinimap(this.player, this.enemies, this.shards, this.gems);

        if (this.world.isExitOpen() && this.world.isPlayerInElevator(
            this.player.getPosition().x,
            this.player.getPosition().z
        )) {
            this._win();
            return;
        }
        if (caught && !this._collectGodMode && !this.player.isInvulnerable()) {
            this._lose(catcher);
        }
    }
}
