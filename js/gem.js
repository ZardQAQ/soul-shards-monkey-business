// ============================================================
// gem.js - 技能宝石（能力球）
// STUN  : 捡到后眩晕全场怪物若干秒
// STUN  : 捡到后眩晕全场怪物若干秒
// REVEAL: 捡到后限时在小地图显示怪物位置
// ============================================================

import * as THREE from 'three';
import { CELL_SIZE } from './maze.js';
import { mulberry32, distance2D } from './utils.js';

export const GemType = {
    STUN: 'STUN',
    REVEAL: 'REVEAL',
};

const GEM_DEFS = {
    [GemType.STUN]: {
        color: 0x40e0ff,
        label: '眩晕宝石',
        message: '眩晕宝石！血猴被定住了！',
        stunSeconds: 8,
    },
    [GemType.REVEAL]: {
        color: 0xffaa22,
        label: '探知宝石',
        message: '探知宝石！小地图显示血猴 30 秒',
        stunSeconds: 0,
        revealSeconds: 30,
    },
};

export class SkillGemSystem {
    /**
     * @param {THREE.Scene} scene
     * @param {Maze} maze
     * @param {number} seed
     * @param {{stunCount?:number, revealCount?:number}} [options]
     */
    constructor(scene, maze, seed = 1, options = {}) {
        this.scene = scene;
        this.maze = maze;
        this.gems = [];
        this.hasReveal = false;
        this._build(seed, options.stunCount ?? 3, options.revealCount ?? 2);
    }

    _build(seed, stunCount, revealCount) {
        const rng = mulberry32(seed ^ 0x6E31);
        const candidates = this.maze.pathCells.filter(c => {
            const ds = Math.hypot(c.x - this.maze.start.x, c.y - this.maze.start.y);
            return ds > 3;
        });

        const place = (type, count) => {
            for (let i = 0; i < count && candidates.length > 0; i++) {
                const idx = Math.floor(rng() * candidates.length);
                const cell = candidates.splice(idx, 1)[0];
                this._addGem(type, cell, rng);
            }
        };

        place(GemType.REVEAL, revealCount);
        place(GemType.STUN, stunCount);
    }

    _addGem(type, cell, rng) {
        const def = GEM_DEFS[type];
        const wx = cell.x * CELL_SIZE + (rng() - 0.5) * 0.4;
        const wz = cell.y * CELL_SIZE + (rng() - 0.5) * 0.4;

        const geo = new THREE.IcosahedronGeometry(0.32, 0);
        const mat = new THREE.MeshBasicMaterial({
            color: def.color,
            transparent: true,
            opacity: 0.95,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(wx, 1.15, wz);

        const ringGeo = new THREE.RingGeometry(0.35, 0.55, 10);
        const ringMat = new THREE.MeshBasicMaterial({
            color: def.color,
            transparent: true,
            opacity: 0.45,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(wx, 0.06, wz);

        this.scene.add(mesh, ring);
        this.gems.push({
            type,
            def,
            mesh,
            light: null,
            ring,
            cell: { x: cell.x, y: cell.y },
            worldPos: { x: wx, z: wz },
            collected: false,
            phase: rng() * Math.PI * 2,
        });
    }

    update(dt) {
        const t = performance.now() * 0.001;
        for (const g of this.gems) {
            if (g.collected) continue;
            g.mesh.rotation.y += dt * 1.8;
            const bob = 1.15 + Math.sin(t * 3 + g.phase) * 0.12;
            g.mesh.position.y = bob;
        }
    }

    /**
     * @returns {null|{type:string, def:object}}
     */
    checkCollect(playerPos) {
        for (const g of this.gems) {
            if (g.collected) continue;
            const d = distance2D(playerPos.x, playerPos.z, g.worldPos.x, g.worldPos.z);
            if (d < 1.1) {
                g.collected = true;
                this.scene.remove(g.mesh, g.ring);
                g.mesh.geometry.dispose();
                g.mesh.material.dispose();
                g.ring.geometry.dispose();
                g.ring.material.dispose();
                if (g.type === GemType.REVEAL) this.hasReveal = true;
                return { type: g.type, def: g.def };
            }
        }
        return null;
    }

    drawOnMinimap(ctx, cellW, cellH) {
        for (const g of this.gems) {
            if (g.collected) continue;
            const x = g.cell.x;
            const y = g.cell.y;
            ctx.fillStyle = g.type === GemType.STUN ? '#40e0ff' : '#ffaa22';
            ctx.beginPath();
            ctx.arc(x * cellW + cellW / 2, y * cellH + cellH / 2, Math.max(2, cellW * 0.35), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    dispose() {
        for (const g of this.gems) {
            if (g.collected) continue;
            this.scene.remove(g.mesh, g.ring);
            g.mesh.geometry.dispose();
            g.mesh.material.dispose();
            g.ring.geometry.dispose();
            g.ring.material.dispose();
        }
        this.gems = [];
    }
}
