// ============================================================
// utils.js - 通用工具函数与像素纹理生成
// 提供以下功能：
// 1. 像素纹理生成器（用 Canvas 程序化绘制，无外部图片依赖）
// 2. 预置地牢纹理库（石砖、鹅卵石、木纹、火把、敌人皮肤等）
// 3. 可复现的伪随机数生成器
// 4. 数学与体素构建辅助工具
// ============================================================

import * as THREE from 'three';

// ---------- 数学工具 ----------
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const distance2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// ---------- 可复现伪随机数生成器 (mulberry32) ----------
// 使用种子保证每次生成同样的迷宫，方便调试
export function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------- 像素纹理生成核心 ----------
/**
 * 通用像素纹理生成器
 * @param {number} width  纹理宽度（像素）
 * @param {number} height 纹理高度（像素）
 * @param {(ctx: CanvasRenderingContext2D)=>void} drawFn 绘制函数
 * @returns {THREE.CanvasTexture}
 */
export function createPixelTexture(width, height, drawFn) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // 关闭图像平滑，保留锐利像素边缘
    ctx.imageSmoothingEnabled = false;
    drawFn(ctx);
    const tex = new THREE.CanvasTexture(canvas);
    // 关键：NearestFilter 让纹理保持像素感，不模糊
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

// ---------- 颜色辅助 ----------
function shade(hex, amt) {
    // 调整颜色明暗，amt 为正变亮，为负变暗
    const r = clamp(parseInt(hex.slice(1, 3), 16) + amt, 0, 255);
    const g = clamp(parseInt(hex.slice(3, 5), 16) + amt, 0, 255);
    const b = clamp(parseInt(hex.slice(5, 7), 16) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
}

// ---------- 预置纹理库 ----------

/**
 * 酒店走廊墙（上半暗花壁纸 + 下半深色木护墙板）
 */
export function makeStoneBrickTexture(size = 64) {
    return createPixelTexture(size, size, (ctx) => {
        const rng = mulberry32(12345);
        const split = Math.floor(size * 0.42); // 护墙板高度占比

        // --- 上半：暗色花纹壁纸 ---
        ctx.fillStyle = '#2a1c22';
        ctx.fillRect(0, 0, size, split);
        // 菱形/藤蔓式暗纹
        for (let y = 2; y < split - 2; y += 8) {
            for (let x = 2; x < size - 2; x += 8) {
                const ox = (Math.floor(y / 8) % 2) * 4;
                ctx.fillStyle = rng() > 0.45 ? '#3a2830' : '#24161c';
                ctx.beginPath();
                ctx.moveTo(x + ox + 3, y);
                ctx.lineTo(x + ox + 6, y + 3);
                ctx.lineTo(x + ox + 3, y + 6);
                ctx.lineTo(x + ox, y + 3);
                ctx.closePath();
                ctx.fill();
            }
        }
        // 壁纸污迹
        for (let i = 0; i < 18; i++) {
            ctx.fillStyle = 'rgba(10,6,8,0.35)';
            ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * split), 2 + Math.floor(rng() * 3), 1 + Math.floor(rng() * 2));
        }

        // 腰线装饰条
        ctx.fillStyle = '#1a100c';
        ctx.fillRect(0, split - 2, size, 2);
        ctx.fillStyle = '#5a4030';
        ctx.fillRect(0, split - 1, size, 1);

        // --- 下半：深色木护墙板 ---
        ctx.fillStyle = '#1c100a';
        ctx.fillRect(0, split, size, size - split);
        const panelW = 16;
        for (let x = 0; x < size; x += panelW) {
            const v = Math.floor(rng() * 14) - 7;
            ctx.fillStyle = shade('#3a2418', v);
            ctx.fillRect(x + 1, split + 2, panelW - 2, size - split - 4);
            // 木纹竖线
            for (let lx = x + 2; lx < x + panelW - 2; lx += 2) {
                ctx.fillStyle = shade('#2a1810', v - 8 + Math.floor(rng() * 10));
                ctx.fillRect(lx, split + 3, 1, size - split - 6);
            }
            // 镶板凹槽
            ctx.fillStyle = '#100808';
            ctx.fillRect(x, split + 1, 1, size - split - 2);
            ctx.fillStyle = '#4a3020';
            ctx.fillRect(x + panelW - 1, split + 1, 1, size - split - 2);
        }
        // 踢脚线
        ctx.fillStyle = '#0c0806';
        ctx.fillRect(0, size - 3, size, 3);
        ctx.fillStyle = '#4a3220';
        ctx.fillRect(0, size - 3, size, 1);
    });
}

/**
 * 酒店走廊地毯（深红棕，细密暗纹）
 */
export function makeCobblestoneTexture(size = 64) {
    return createPixelTexture(size, size, (ctx) => {
        ctx.fillStyle = '#1a0c10';
        ctx.fillRect(0, 0, size, size);
        const rng = mulberry32(54321);
        // 地毯底色块
        for (let y = 0; y < size; y += 4) {
            for (let x = 0; x < size; x += 4) {
                const v = Math.floor(rng() * 18) - 9;
                const odd = ((x / 4) + (y / 4)) % 2 === 0;
                ctx.fillStyle = shade(odd ? '#3a1820' : '#2a1018', v);
                ctx.fillRect(x, y, 4, 4);
            }
        }
        // 中央暗纹带
        for (let y = 0; y < size; y++) {
            for (let x = 10; x < size - 10; x++) {
                if ((x + y) % 6 === 0) {
                    ctx.fillStyle = 'rgba(80,30,40,0.35)';
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
        // 磨损斑点
        for (let i = 0; i < 40; i++) {
            ctx.fillStyle = rng() > 0.5 ? '#120810' : '#4a2030';
            ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
        }
    });
}

/**
 * 酒店天花板（深灰褐 + 细线）
 */
export function makeCeilingTexture(size = 32) {
    return createPixelTexture(size, size, (ctx) => {
        ctx.fillStyle = '#14100e';
        ctx.fillRect(0, 0, size, size);
        const rng = mulberry32(999);
        for (let i = 0; i < 40; i++) {
            const v = Math.floor(rng() * 16);
            ctx.fillStyle = `rgb(${22 + v},${18 + v},${16 + v})`;
            ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1 + Math.floor(rng() * 2), 1);
        }
        // 天花板板缝
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let x = 0; x < size; x += 8) ctx.fillRect(x, 0, 1, size);
        for (let y = 0; y < size; y += 8) ctx.fillRect(0, y, size, 1);
    });
}

/**
 * 木纹纹理（用于木桶、木箱、火把柄）
 */
export function makeWoodTexture(size = 32) {
    return createPixelTexture(size, size, (ctx) => {
        ctx.fillStyle = '#3a2818';
        ctx.fillRect(0, 0, size, size);
        const rng = mulberry32(7);
        // 垂直木纹
        for (let x = 0; x < size; x += 1) {
            const v = Math.floor(rng() * 20) - 10;
            ctx.fillStyle = shade('#5a3818', v);
            ctx.fillRect(x, 0, 1, size);
            // 木纹节点
            if (rng() > 0.85) {
                ctx.fillStyle = '#2a1808';
                ctx.fillRect(x, Math.floor(rng() * size), 1, 2);
            }
        }
    });
}

/**
 * 火把火焰纹理（动画帧可省略，单帧即可）
 */
export function makeTorchTexture(size = 16) {
    return createPixelTexture(size, size, (ctx) => {
        ctx.clearRect(0, 0, size, size);
        const rng = mulberry32(42);
        // 火焰主体
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - size / 2;
                const dy = y - size / 2;
                const d = Math.hypot(dx, dy * 1.5);
                if (d < size / 2 - 1) {
                    // 中心黄白，外圈橙红
                    const t = d / (size / 2);
                    const r = 255;
                    const g = Math.floor(220 - t * 180);
                    const b = Math.floor(60 - t * 60);
                    ctx.fillStyle = `rgb(${r},${Math.max(0, g)},${Math.max(0, b)})`;
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
        // 火星点
        for (let i = 0; i < 6; i++) {
            ctx.fillStyle = '#ffeb3b';
            ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
        }
    });
}

/**
 * 敌人皮肤纹理（暗红色史莱姆/怪物）
 */
export function makeEnemySkinTexture(size = 16) {
    return createPixelTexture(size, size, (ctx) => {
        ctx.fillStyle = '#5a1010';
        ctx.fillRect(0, 0, size, size);
        const rng = mulberry32(99);
        for (let i = 0; i < 40; i++) {
            const v = Math.floor(rng() * 40) - 20;
            ctx.fillStyle = shade('#8a1818', v);
            ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 2));
        }
        // 高光
        ctx.fillStyle = '#c83838';
        ctx.fillRect(3, 3, 3, 1);
        ctx.fillRect(3, 3, 1, 3);
    });
}

/**
 * 出口绿色发光门纹理
 */
export function makeExitTexture(size = 16) {
    return createPixelTexture(size, size, (ctx) => {
        ctx.fillStyle = '#0a1a08';
        ctx.fillRect(0, 0, size, size);
        // 发光绿色核心
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - size / 2;
                const dy = y - size / 2;
                const d = Math.hypot(dx, dy);
                if (d < size / 2) {
                    const t = d / (size / 2);
                    const g = Math.floor(255 - t * 100);
                    ctx.fillStyle = `rgb(${Math.floor(80 - t * 80)},${g},${Math.floor(60 - t * 60)})`;
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
    });
}

// ---------- 体素构建辅助 ----------
/**
 * 创建一个体素方块（带材质的 BoxGeometry mesh）
 * @param {number} x 世界坐标 X
 * @param {number} y 世界坐标 Y
 * @param {number} z 世界坐标 Z
 * @param {number} sx X 方向尺寸
 * @param {number} sy Y 方向尺寸
 * @param {number} sz Z 方向尺寸
 * @param {THREE.Material|THREE.Material[]} material 材质
 * @returns {THREE.Mesh}
 */
export function createVoxel(x, y, z, sx, sy, sz, material) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = false; // 性能考虑，关闭阴影
    mesh.receiveShadow = false;
    return mesh;
}

/**
 * 创建材质（统一使用 MeshBasicMaterial 或 LambertMaterial）
 * 这里用 MeshLambertMaterial 配合灯光产生明暗
 */
export function createMaterial(texture, options = {}) {
    return new THREE.MeshLambertMaterial({
        map: texture,
        ...options,
    });
}

// ---------- 缓存所有预置纹理 ----------
let textureCache = null;

/**
 * 一次性生成并缓存所有纹理，避免重复创建
 */
export function getTextures() {
    if (textureCache) return textureCache;
    textureCache = {
        stoneBrick: makeStoneBrickTexture(64),
        cobblestone: makeCobblestoneTexture(64),
        ceiling: makeCeilingTexture(32),
        wood: makeWoodTexture(32),
        torch: makeTorchTexture(16),
        enemySkin: makeEnemySkinTexture(16),
        exit: makeExitTexture(16),
    };
    return textureCache;
}
