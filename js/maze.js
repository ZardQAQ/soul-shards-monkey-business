// ============================================================
// maze.js - 迷宫数据生成
// 使用递归回溯算法 (Recursive Backtracker) 生成迷宫网格
//
// 网格约定：
//   0 = 通路（可走）
//   1 = 墙
//   2 = 出口
//   3 = 起点
//
// 算法思路：
//   1. 将网格初始全设为墙
//   2. 从起点开始 DFS，每次随机选未访问的相邻格（隔一格）
//   3. 打通当前格与相邻格之间的墙
//   4. 递归直到所有通路都被访问
// ============================================================

import { mulberry32 } from './utils.js';

// 单元格世界尺寸：偏窄走廊（贴近 Dark Deception 酒店通道比例）
export const CELL_SIZE = 2.35;
export const WALL_HEIGHT = 3.25;

export class Maze {
    /**
     * @param {number} width  网格宽度（必须为奇数）
     * @param {number} height 网格高度（必须为奇数）
     * @param {number} seed   随机种子
     */
    constructor(width = 21, height = 21, seed = Date.now()) {
        // 强制为奇数（递归回溯算法要求）
        this.width = width % 2 === 0 ? width + 1 : width;
        this.height = height % 2 === 0 ? height + 1 : height;
        this.seed = seed;
        this.rng = mulberry32(seed);

        // 初始化网格：全部为墙
        this.grid = Array.from({ length: this.height }, () =>
            new Array(this.width).fill(1)
        );

        this.start = { x: 1, y: 1 };
        // 传送门就在起点，收齐碎片后跑回起点逃脱
        this.exit = { x: this.start.x, y: this.start.y };

        this._generate();
        // 起点兼作传送门格
        this.grid[this.start.y][this.start.x] = 3;

        // 记录所有通路格（用于敌人/装饰物随机放置）
        this.pathCells = this._collectPathCells();
    }

    /**
     * 递归回溯算法生成迷宫
     */
    _generate() {
        const visited = Array.from({ length: this.height }, () =>
            new Array(this.width).fill(false)
        );
        const stack = [];
        const startX = 1, startY = 1;
        this.grid[startY][startX] = 0;
        visited[startY][startX] = true;
        stack.push([startX, startY]);

        // 四个方向：上、右、下、左（每次走 2 格）
        const dirs = [
            [0, -2], [2, 0], [0, 2], [-2, 0]
        ];

        while (stack.length > 0) {
            const [cx, cy] = stack[stack.length - 1];
            // 收集未访问的相邻格
            const candidates = [];
            for (const [dx, dy] of dirs) {
                const nx = cx + dx, ny = cy + dy;
                if (nx > 0 && nx < this.width - 1 &&
                    ny > 0 && ny < this.height - 1 &&
                    !visited[ny][nx]) {
                    candidates.push([nx, ny, dx, dy]);
                }
            }
            if (candidates.length === 0) {
                stack.pop();
                continue;
            }
            // 随机选一个方向
            const [nx, ny, dx, dy] = candidates[Math.floor(this.rng() * candidates.length)];
            // 打通中间的墙
            this.grid[cy + dy / 2][cx + dx / 2] = 0;
            this.grid[ny][nx] = 0;
            visited[ny][nx] = true;
            stack.push([nx, ny]);
        }

        // 额外打通墙，制造大量循环路径，让玩家被追时可以绕路
        const openable = [];
        for (let y = 2; y < this.height - 2; y++) {
            for (let x = 2; x < this.width - 2; x++) {
                if (this.grid[y][x] !== 1) continue;
                const horiz = this.grid[y][x - 1] === 0 && this.grid[y][x + 1] === 0;
                const vert = this.grid[y - 1][x] === 0 && this.grid[y + 1][x] === 0;
                if (horiz || vert) openable.push({ x, y });
            }
        }
        // 打通约 30% 可打通墙，形成更多环路
        const target = Math.floor(openable.length * 0.30);
        for (let i = 0; i < target; i++) {
            const idx = Math.floor(this.rng() * openable.length);
            const { x, y } = openable.splice(idx, 1)[0];
            this.grid[y][x] = 0;
        }

        // 开几处小广场（3x3），被追时有喘息与变向空间
        this._carvePlazas(8);
    }

    /** 在迷宫中开出若干 3×3 空地 */
    _carvePlazas(count) {
        let placed = 0;
        let attempts = 0;
        while (placed < count && attempts < count * 40) {
            attempts++;
            const x = 2 + Math.floor(this.rng() * (this.width - 5));
            const y = 2 + Math.floor(this.rng() * (this.height - 5));
            // 避开起点传送门附近
            if (Math.hypot(x - this.start.x, y - this.start.y) < 5) continue;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx > 0 && nx < this.width - 1 && ny > 0 && ny < this.height - 1) {
                        this.grid[ny][nx] = 0;
                    }
                }
            }
            placed++;
        }
    }

    /** 收集所有通路格坐标（不含起点与出口） */
    _collectPathCells() {
        const cells = [];
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.grid[y][x] === 0) {
                    cells.push({ x, y });
                }
            }
        }
        return cells;
    }

    /** 获取网格单元类型 */
    getCell(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 1;
        return this.grid[y][x];
    }

    /** 判断网格坐标是否为墙 */
    isWallCell(x, y) {
        return this.getCell(x, y) === 1;
    }

    /**
     * 判断世界坐标是否撞墙（圆 vs 墙格 AABB，半径为世界单位）
     * @param {number} worldX
     * @param {number} worldZ
     * @param {number} radius 玩家碰撞半径（世界单位）
     */
    isWallAt(worldX, worldZ, radius = 0.3) {
        const half = CELL_SIZE * 0.5;
        const r2 = radius * radius;
        // 只检查周围 3×3 墙格
        const gx = Math.round(worldX / CELL_SIZE);
        const gz = Math.round(worldZ / CELL_SIZE);
        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                const cx = gx + dx;
                const cz = gz + dz;
                if (!this.isWallCell(cx, cz)) continue;
                const wx = cx * CELL_SIZE;
                const wz = cz * CELL_SIZE;
                // 点到 AABB 最近点
                const closestX = Math.max(wx - half, Math.min(worldX, wx + half));
                const closestZ = Math.max(wz - half, Math.min(worldZ, wz + half));
                const ddx = worldX - closestX;
                const ddz = worldZ - closestZ;
                if (ddx * ddx + ddz * ddz < r2) return true;
            }
        }
        return false;
    }

    /**
     * 检查从 (x1,y1) 到 (x2,y2) 的直线是否被墙阻挡
     * 用于敌人视线检测
     */
    lineOfSightBlocked(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2;
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const x = Math.round(x1 + dx * t);
            const y = Math.round(y1 + dy * t);
            if (this.isWallCell(x, y)) return true;
        }
        return false;
    }

    /** 获取起点世界坐标 */
    getStartWorldPos() {
        return {
            x: this.start.x * CELL_SIZE,
            z: this.start.y * CELL_SIZE,
        };
    }

    /** 获取传送门（起点）世界坐标 */
    getExitWorldPos() {
        return this.getStartWorldPos();
    }

    /** 判断是否回到起点传送门 */
    isAtExit(worldX, worldZ) {
        const portal = this.getStartWorldPos();
        const dx = worldX - portal.x;
        const dz = worldZ - portal.z;
        return Math.hypot(dx, dz) < CELL_SIZE * 0.7;
    }
}
