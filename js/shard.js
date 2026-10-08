// ============================================================
// shard.js - 灵魂碎片（实例化 + 无点光，性能优化）
// ============================================================

import * as THREE from 'three';
import { CELL_SIZE } from './maze.js';
import { mulberry32, distance2D } from './utils.js';

/** 仅动画玩家附近的碎片，降低 CPU */
const ANIM_RADIUS = 28;
const ANIM_RADIUS2 = ANIM_RADIUS * ANIM_RADIUS;

export class ShardSystem {
    /**
     * @param {THREE.Scene} scene
     * @param {Maze} maze
     * @param {number} count
     * @param {number} seed
     */
    constructor(scene, maze, count = 12, seed = 1) {
        this.scene = scene;
        this.maze = maze;
        this.totalCount = count;
        this.collected = 0;
        this.shards = [];
        this._allCollected = false;
        this._dummy = new THREE.Object3D();
        this._animAcc = 0;

        this._buildShards(seed);
    }

    _buildShards(seed) {
        const rng = mulberry32(seed);
        const candidates = this.maze.pathCells.filter(c => {
            const ds = Math.hypot(c.x - this.maze.start.x, c.y - this.maze.start.y);
            return ds > 2;
        });

        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }

        const count = Math.min(this.totalCount, candidates.length);
        const minGap = count > 60 ? 1.0 : 0;
        const placed = [];

        for (let i = 0; i < candidates.length && placed.length < count; i++) {
            const cell = candidates[i];
            if (minGap > 0) {
                const close = placed.some(
                    (p) => Math.hypot(p.x - cell.x, p.y - cell.y) < minGap
                );
                if (close) continue;
            }
            placed.push(cell);
        }

        const geo = new THREE.OctahedronGeometry(0.32, 0);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xc050ff,
            transparent: true,
            opacity: 0.92,
            depthWrite: false,
        });

        this.instanced = new THREE.InstancedMesh(geo, mat, placed.length);
        this.instanced.frustumCulled = true;
        this.scene.add(this.instanced);

        for (let i = 0; i < placed.length; i++) {
            const cell = placed[i];
            const wx = cell.x * CELL_SIZE;
            const wz = cell.y * CELL_SIZE;
            const phase = rng() * Math.PI * 2;

            this._dummy.position.set(wx, 1.15, wz);
            this._dummy.rotation.set(0, phase, 0);
            this._dummy.scale.set(1, 1, 1);
            this._dummy.updateMatrix();
            this.instanced.setMatrixAt(i, this._dummy.matrix);

            this.shards.push({
                index: i,
                cell: { x: cell.x, y: cell.y },
                worldPos: { x: wx, z: wz },
                collected: false,
                phase,
                baseY: 1.15,
            });
        }
        this.instanced.instanceMatrix.needsUpdate = true;
        this.totalCount = this.shards.length;
    }

    _setInstanceVisible(shard, visible, y = 1.15, rotY = 0) {
        if (visible) {
            this._dummy.position.set(shard.worldPos.x, y, shard.worldPos.z);
            this._dummy.rotation.set(0.3, rotY, 0.2);
            this._dummy.scale.set(1, 1, 1);
        } else {
            this._dummy.position.set(shard.worldPos.x, -99, shard.worldPos.z);
            this._dummy.scale.set(0, 0, 0);
        }
        this._dummy.updateMatrix();
        this.instanced.setMatrixAt(shard.index, this._dummy.matrix);
    }

    /**
     * @param {number} dt
     * @param {{x:number,z:number}|null} playerPos
     */
    update(dt, playerPos = null) {
        if (!this.instanced || this._allCollected) return;

        // 降频：约 20fps 更新动画即可
        this._animAcc += dt;
        if (this._animAcc < 0.05) return;
        const step = this._animAcc;
        this._animAcc = 0;

        const t = performance.now() * 0.001;
        const px = playerPos?.x ?? 0;
        const pz = playerPos?.z ?? 0;
        let dirty = false;

        for (const shard of this.shards) {
            if (shard.collected) continue;
            const dx = shard.worldPos.x - px;
            const dz = shard.worldPos.z - pz;
            if (dx * dx + dz * dz > ANIM_RADIUS2) continue;

            const y = shard.baseY + Math.sin(t * 2 + shard.phase) * 0.12;
            const rotY = t * 1.4 + shard.phase;
            this._setInstanceVisible(shard, true, y, rotY);
            dirty = true;
        }
        if (dirty) this.instanced.instanceMatrix.needsUpdate = true;
        void step;
    }

    checkCollect(playerPos) {
        if (this._allCollected) return false;
        const collectRadius = 1.0;
        for (const shard of this.shards) {
            if (shard.collected) continue;
            const d = distance2D(
                playerPos.x, playerPos.z,
                shard.worldPos.x, shard.worldPos.z
            );
            if (d < collectRadius) {
                this._collect(shard);
                return true;
            }
        }
        return false;
    }

    _collect(shard) {
        shard.collected = true;
        this.collected++;
        this._setInstanceVisible(shard, false);
        this.instanced.instanceMatrix.needsUpdate = true;

        if (this.collected >= this.totalCount) {
            this._allCollected = true;
        }
    }

    /**
     * 一键收集全部剩余碎片
     * @returns {number} 本次新收集数量
     */
    collectAll() {
        if (this._allCollected) return 0;
        let n = 0;
        for (const shard of this.shards) {
            if (shard.collected) continue;
            this._collect(shard);
            n++;
        }
        if (n > 0 && this.instanced) {
            this.instanced.instanceMatrix.needsUpdate = true;
        }
        return n;
    }

    isAllCollected() {
        return this._allCollected;
    }

    getProgress() {
        return { collected: this.collected, total: this.totalCount };
    }

    getNearestShardDistance(playerPos) {
        let min = Infinity;
        for (const shard of this.shards) {
            if (shard.collected) continue;
            const d = distance2D(
                playerPos.x, playerPos.z,
                shard.worldPos.x, shard.worldPos.z
            );
            if (d < min) min = d;
        }
        return min;
    }

    /**
     * 最近未收集碎片的世界坐标；若已全部收集则返回 null
     * @returns {{x:number,z:number,cell:{x:number,y:number}}|null}
     */
    getNearestShardPos(playerPos) {
        let best = null;
        let min = Infinity;
        for (const shard of this.shards) {
            if (shard.collected) continue;
            const d = distance2D(
                playerPos.x, playerPos.z,
                shard.worldPos.x, shard.worldPos.z
            );
            if (d < min) {
                min = d;
                best = {
                    x: shard.worldPos.x,
                    z: shard.worldPos.z,
                    cell: { x: shard.cell.x, y: shard.cell.y },
                };
            }
        }
        return best;
    }

    dispose() {
        if (this.instanced) {
            this.scene.remove(this.instanced);
            this.instanced.geometry.dispose();
            this.instanced.material.dispose();
            this.instanced = null;
        }
        this.shards = [];
    }
}
