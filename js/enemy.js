// ============================================================
// enemy.js - Murder Monkey（Monkey Business 血猴）/ 萌宠橘猫（窝囊版）
// 状态：PATROL → SPOT → HUNT → SEARCH
// 移动：网格 BFS 寻路
// ============================================================

import * as THREE from 'three';
import { CELL_SIZE } from './maze.js';
import { createVoxel, mulberry32, distance2D } from './utils.js';
import { MODE, getCuteConfig } from './mode.js';

export const State = {
    PATROL: 'PATROL',
    SPOT: 'SPOT',
    HUNT: 'HUNT',
    SEARCH: 'SEARCH',
};

export class Enemy {
    /**
     * @param {THREE.Scene} scene
     * @param {Maze} maze
     * @param {{x,y}} startCell
     * @param {number} seed
     * @param {{variant?:string, mode?:string}} [options]
     */
    constructor(scene, maze, startCell, seed, options = {}) {
        this.scene = scene;
        this.maze = maze;
        this.rng = mulberry32(seed);
        this.variant = options.variant || 'monkey';
        this.mode = options.mode || MODE.CLASSIC;

        this.state = State.PATROL;
        this.position = new THREE.Vector3(
            startCell.x * CELL_SIZE,
            0,
            startCell.y * CELL_SIZE
        );
        this.targetCell = { x: startCell.x, y: startCell.y };
        this.lastKnownPlayerCell = null;
        this._path = [];
        this._pathIndex = 0;
        this._repathTimer = 0;

        // DD 风格：追击接近跑步，巡逻较慢
        // 窝囊版：整体更慢，玩家可轻松甩开
        if (this.mode === MODE.CUTE) {
            const c = getCuteConfig().enemy;
            this.patrolSpeed = c.patrolSpeed;
            this.huntSpeed = c.huntSpeed;
            this.searchSpeed = c.searchSpeed;
            this.viewDistance = c.viewDistance;
            this.catchDistance = c.catchDistance;
            this.hearingRange = c.hearingRange;
        } else {
            this.patrolSpeed = 1.8;
            this.huntSpeed = 3.6;
            this.searchSpeed = 2.7;
            this.viewDistance = 14;
            this.catchDistance = 1.45;
            this.hearingRange = 7;
        }
        this.spotDuration = 0.55;
        this.spotTimer = 0;

        this.huntTimer = 0;
        this.huntDuration = 4.5; // 丢失视野后追击时长（原 9s 减半）
        this.searchTimer = 0;
        this.searchDuration = 5.0;

        this.canSeePlayer = false;
        this.distToPlayer = Infinity;
        this._roarCooldown = 0;
        this._justSpotted = false;

        // 眩晕（技能宝石）
        this.stunTimer = 0;

        this._buildModel();
    }

    /** 眩晕若干秒：无法移动/追击 */
    stun(seconds) {
        this.stunTimer = Math.max(this.stunTimer, seconds);
    }

    /** 玩家被抓住后：脱战，短暂眩晕并清空追击路径 */
    breakOffChase(seconds = 2.5) {
        this.state = State.PATROL;
        this.canSeePlayer = false;
        this.lastKnownPlayerCell = null;
        this._path = [];
        this._pathIndex = 0;
        this.huntTimer = 0;
        this.searchTimer = 0;
        this.spotTimer = 0;
        this.stun(seconds);
    }

    /**
     * 被抓时 3D 扑脸：冲到玩家身前（保持距离，避免穿模）
     * @param {THREE.Camera} camera
     */
    startFaceLunge(camera) {
        const camPos = camera.position.clone();
        const from = this.mesh.position.clone();
        const toCam = new THREE.Vector3(camPos.x - from.x, 0, camPos.z - from.z);
        const dist = toCam.length();
        // 停在身前约 1.55m，再把摄像机摆到眼前特写
        const stopDist = 1.55;

        let target;
        if (dist > 0.05) {
            toCam.multiplyScalar(1 / dist);
            const travel = Math.max(0, dist - stopDist);
            target = new THREE.Vector3(from.x + toCam.x * travel, 0, from.z + toCam.z * travel);
        } else {
            camera.getWorldDirection(toCam);
            toCam.y = 0;
            if (toCam.lengthSq() < 1e-6) toCam.set(0, 0, -1);
            else toCam.normalize();
            target = new THREE.Vector3(
                camPos.x + toCam.x * stopDist,
                0,
                camPos.z + toCam.z * stopDist
            );
        }

        this._lunge = {
            active: true,
            done: false,
            t: 0,
            duration: this.mode === MODE.CUTE ? 3.0 : 2.1,
            from: from.clone(),
            fromScale: this.mesh.scale.x || 1.4,
            toScale: this.mode === MODE.CUTE ? 1.2 : 1.65,
            target,
            camPos: camPos.clone(),
            stopDist,
        };
        this._lungeHome = { x: this.position.x, z: this.position.z };
        this.canSeePlayer = true;
        this.state = State.HUNT;
        if (this.glow) {
            this.glow.intensity = 3.5;
            this.glow.distance = 14;
        }
    }

    /** 双眼中心世界坐标 */
    getFaceWorldPos(out = new THREE.Vector3()) {
        out.set(0, 1.58, 0.3);
        this.mesh.updateMatrixWorld(true);
        this.mesh.localToWorld(out);
        return out;
    }

    /** 扑脸结束后的定格姿态（不往镜头里塞） */
    holdJumpscarePose() {
        if (this.mode === MODE.CUTE) {
            // 窝囊版：坐着歪头，不放大、不俯冲
            const scale = 1.2;
            this.mesh.scale.setScalar(scale);
            this.mesh.rotation.x = 0.1;
            this.mesh.rotation.z = 0.18; // 歪头
            this.mesh.position.y = -0.15; // 屁股贴地坐姿
            if (this._arms) {
                this._arms.armL.rotation.set(-0.5, 0, 0.2);
                this._arms.armR.rotation.set(-0.5, 0, -0.2);
            }
            if (this.glow) {
                this.glow.intensity = 0.8;
                this.glow.distance = 6;
            }
            return;
        }
        const scale = (this._lunge && this._lunge.toScale) || 1.65;
        this.mesh.scale.setScalar(scale);
        this.mesh.rotation.x = -0.18;
        this.mesh.rotation.z = 0;
        this.mesh.position.y = 0;

        if (this._arms) {
            this._arms.armL.rotation.set(-2.15, 0, 0.4);
            this._arms.armR.rotation.set(-2.15, 0, -0.4);
        }
        if (this.glow) {
            this.glow.intensity = 5;
            this.glow.distance = 14;
        }
    }

    /**
     * 把摄像机摆到猴子正眼前（脸外固定距离，不穿模）
     * @param {THREE.Camera} camera
     * @param {number} [standOff=0.75]
     */
    frameCameraOnFace(camera, standOff = 0.75) {
        // 窝囊版：不强制对脸特写，保持玩家视角（只让小猫走到视野内坐着）
        if (this.mode === MODE.CUTE) return;
        this.mesh.updateMatrixWorld(true);
        const face = this.getFaceWorldPos();

        // 模型脸朝 +Z
        const fwd = new THREE.Vector3(0, 0, 1).transformDirection(this.mesh.matrixWorld);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) {
            fwd.set(face.x - this.mesh.position.x, 0, face.z - this.mesh.position.z);
            if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
        }
        fwd.normalize();

        camera.position.set(
            face.x + fwd.x * standOff,
            face.y,
            face.z + fwd.z * standOff
        );
        camera.lookAt(face.x, face.y, face.z);
        camera.updateMatrixWorld(true);
    }

    /**
     * @returns {boolean} 扑脸是否已结束
     */
    updateFaceLunge(dt) {
        if (!this._lunge) return true;
        if (this._lunge.done) return true;

        this._lunge.t += dt;
        const u = Math.min(1, this._lunge.t / this._lunge.duration);
        const e = u < 0.22
            ? (u / 0.22) * 0.08
            : 0.08 + Math.pow((u - 0.22) / 0.78, 2.2) * 0.92;

        const { from, target, fromScale, toScale, camPos } = this._lunge;
        this.mesh.position.x = from.x + (target.x - from.x) * e;
        this.mesh.position.z = from.z + (target.z - from.z) * e;
        this.mesh.position.y = Math.sin(Math.min(1, e) * Math.PI) * 0.35;

        const s = fromScale + (toScale - fromScale) * e;
        this.mesh.scale.setScalar(s);

        const dx = camPos.x - this.mesh.position.x;
        const dz = camPos.z - this.mesh.position.z;
        if (Math.abs(dx) + Math.abs(dz) > 0.01) {
            this.mesh.rotation.y = Math.atan2(dx, dz);
        }
        this.mesh.rotation.x = -0.08 - e * 0.22;
        this.mesh.rotation.z = Math.sin(u * Math.PI * 5) * 0.03 * e;

        if (this._arms) {
            if (this.mode === MODE.CUTE) {
                // 窝囊版：小猫坐姿举爪（轻微 begging），不剧烈挥臂
                const raise = -0.3 - e * 0.5;
                this._arms.armL.rotation.x = raise;
                this._arms.armR.rotation.x = raise;
                this._arms.armL.rotation.z = 0.2 * e;
                this._arms.armR.rotation.z = -0.2 * e;
            } else {
                const raise = -0.45 - e * 1.7;
                this._arms.armL.rotation.x = raise;
                this._arms.armR.rotation.x = raise;
                this._arms.armL.rotation.z = 0.4 * e;
                this._arms.armR.rotation.z = -0.4 * e;
            }
        }

        if (this.glow) {
            if (this.mode === MODE.CUTE) {
                this.glow.intensity = 0.6 + e * 0.3;
                this.glow.distance = 6;
            } else {
                this.glow.intensity = 2.2 + e * 4;
                this.glow.distance = 10 + e * 6;
            }
        }

        if (u >= 1) {
            this._lunge.active = false;
            this._lunge.done = true;
            this.mesh.position.y = 0;
            this.holdJumpscarePose();
            return true;
        }
        return false;
    }

    /** 扑脸结束：复位模型并脱战 */
    endFaceLunge(breakSeconds = 3.5) {
        this._lunge = null;
        if (this._lungeHome) {
            this.position.x = this._lungeHome.x;
            this.position.z = this._lungeHome.z;
            this._lungeHome = null;
        }
        const baseScale = this.mode === MODE.CUTE ? getCuteConfig().enemyScale : 1.4;
        if (this.mesh) {
            this.mesh.scale.setScalar(baseScale);
            this.mesh.rotation.x = 0;
            this.mesh.rotation.z = 0;
            this.mesh.position.set(this.position.x, 0, this.position.z);
        }
        if (this._arms) {
            this._arms.armL.rotation.set(0, 0, 0);
            this._arms.armR.rotation.set(0, 0, 0);
        }
        if (this.glow) {
            this.glow.intensity = this.mode === MODE.CUTE ? 0.6 : 1.0;
            this.glow.distance = this.mode === MODE.CUTE ? 6 : 8;
        }
        this.breakOffChase(breakSeconds);
    }

    /** Murder Monkey 体素造型 / 萌宠橘猫（窝囊版） */
    _buildModel() {
        const group = new THREE.Group();

        if (this.mode === MODE.CUTE) {
            this._buildCatModel(group);
        } else {
            this._buildMonkeyModel(group);
        }

        group.position.copy(this.position);
        // 经典版放大 1.4 倍有压迫感；窝囊版缩小到 0.75 倍更像小猫
        const baseScale = this.mode === MODE.CUTE ? getCuteConfig().enemyScale : 1.4;
        group.scale.setScalar(baseScale);
        this.mesh = group;
        this.scene.add(group);
    }

    /** 经典版：血猴造型（原实现） */
    _buildMonkeyModel(group) {
        const fur = new THREE.MeshBasicMaterial({ color: 0x6a2018 });
        const furDark = new THREE.MeshBasicMaterial({ color: 0x3a100c });
        const face = new THREE.MeshBasicMaterial({ color: 0xc07050 });
        // 眼睛：亮红色 + 关闭雾影响，让玩家在远处也能看到红色光点
        const eye = new THREE.MeshBasicMaterial({ color: 0xff3030, fog: false });
        const tooth = new THREE.MeshBasicMaterial({ color: 0xf0e0c0 });

        // 头 + 脸
        const head = createVoxel(0, 1.55, 0, 0.55, 0.5, 0.5, fur);
        const muzzle = createVoxel(0, 1.4, 0.28, 0.32, 0.22, 0.2, face);
        group.add(head, muzzle);

        // 躯干
        const torso = createVoxel(0, 0.95, 0, 0.65, 0.7, 0.4, fur);
        const belly = createVoxel(0, 0.9, 0.12, 0.4, 0.45, 0.2, furDark);
        group.add(torso, belly);

        // 夸张长臂
        const armL = createVoxel(-0.55, 0.85, 0.1, 0.22, 0.9, 0.22, fur);
        const armR = createVoxel(0.55, 0.85, 0.1, 0.22, 0.9, 0.22, fur);
        const handL = createVoxel(-0.55, 0.35, 0.2, 0.28, 0.22, 0.28, furDark);
        const handR = createVoxel(0.55, 0.35, 0.2, 0.28, 0.22, 0.28, furDark);
        group.add(armL, armR, handL, handR);

        // 腿
        const legL = createVoxel(-0.18, 0.3, 0, 0.22, 0.55, 0.22, furDark);
        const legR = createVoxel(0.18, 0.3, 0, 0.22, 0.55, 0.22, furDark);
        group.add(legL, legR);

        // 红眼 + 牙（眼睛放大一些，远处更易看见）
        const eyeL = createVoxel(-0.14, 1.58, 0.28, 0.14, 0.14, 0.08, eye);
        const eyeR = createVoxel(0.14, 1.58, 0.28, 0.14, 0.14, 0.08, eye);
        const fangL = createVoxel(-0.08, 1.32, 0.38, 0.06, 0.1, 0.06, tooth);
        const fangR = createVoxel(0.08, 1.32, 0.38, 0.06, 0.1, 0.06, tooth);
        group.add(eyeL, eyeR, fangL, fangR);

        // 头顶红色信号灯：不受雾影响，让玩家从远处就能看到红点
        const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2020, fog: false });
        this.beacon = createVoxel(0, 2.05, 0, 0.18, 0.18, 0.18, beaconMat);
        group.add(this.beacon);

        this.glow = new THREE.PointLight(0xff2000, 1.0, 8, 2.0);
        this.glow.position.set(0, 1.4, 0);
        group.add(this.glow);

        this._arms = { armL, armR, handL, handR };
    }

    /** 窝囊版：萌宠橘猫造型（无红眼/无獠牙/无信标/无红光） */
    _buildCatModel(group) {
        const fur = new THREE.MeshBasicMaterial({ color: 0xff9933 });       // 橘毛
        const furDark = new THREE.MeshBasicMaterial({ color: 0xcc6611 });   // 深橘条纹
        const belly = new THREE.MeshBasicMaterial({ color: 0xfff0e0 });     // 白肚皮
        const face = new THREE.MeshBasicMaterial({ color: 0xffb070 });      // 脸（浅橘）
        const eye = new THREE.MeshBasicMaterial({ color: 0x226633 });       // 绿眼（普通雾）
        const pupil = new THREE.MeshBasicMaterial({ color: 0x101810 });    // 黑眼珠
        const nose = new THREE.MeshBasicMaterial({ color: 0xff9999 });      // 粉鼻头
        const earInner = new THREE.MeshBasicMaterial({ color: 0xffaaaa });  // 粉内耳

        // 头 + 脸
        const head = createVoxel(0, 1.55, 0, 0.55, 0.5, 0.5, fur);
        const muzzle = createVoxel(0, 1.42, 0.28, 0.3, 0.2, 0.18, face);
        group.add(head, muzzle);

        // 三角耳朵（用扁方块拼近似三角）
        const earL = createVoxel(-0.28, 1.92, 0, 0.14, 0.2, 0.14, fur);
        const earR = createVoxel(0.28, 1.92, 0, 0.14, 0.2, 0.14, fur);
        const earInnerL = createVoxel(-0.28, 1.9, 0.08, 0.08, 0.12, 0.06, earInner);
        const earInnerR = createVoxel(0.28, 1.9, 0.08, 0.08, 0.12, 0.06, earInner);
        group.add(earL, earR, earInnerL, earInnerR);

        // 躯干 + 白肚皮
        const torso = createVoxel(0, 0.95, 0, 0.65, 0.7, 0.4, fur);
        const bellyMesh = createVoxel(0, 0.9, 0.12, 0.4, 0.45, 0.2, belly);
        group.add(torso, bellyMesh);

        // 短腿手臂（猫前腿）
        const armL = createVoxel(-0.5, 0.85, 0.1, 0.2, 0.7, 0.2, fur);
        const armR = createVoxel(0.5, 0.85, 0.1, 0.2, 0.7, 0.2, fur);
        const handL = createVoxel(-0.5, 0.4, 0.2, 0.24, 0.18, 0.24, furDark);
        const handR = createVoxel(0.5, 0.4, 0.2, 0.24, 0.18, 0.24, furDark);
        group.add(armL, armR, handL, handR);

        // 腿
        const legL = createVoxel(-0.18, 0.3, 0, 0.22, 0.55, 0.22, furDark);
        const legR = createVoxel(0.18, 0.3, 0, 0.22, 0.55, 0.22, furDark);
        group.add(legL, legR);

        // 绿眼 + 黑眼珠 + 粉鼻（无獠牙、无信标）
        const eyeL = createVoxel(-0.14, 1.58, 0.28, 0.1, 0.1, 0.06, eye);
        const eyeR = createVoxel(0.14, 1.58, 0.28, 0.1, 0.1, 0.06, eye);
        const pupilL = createVoxel(-0.14, 1.58, 0.31, 0.05, 0.07, 0.04, pupil);
        const pupilR = createVoxel(0.14, 1.58, 0.31, 0.05, 0.07, 0.04, pupil);
        const noseMesh = createVoxel(0, 1.36, 0.38, 0.06, 0.05, 0.05, nose);
        group.add(eyeL, eyeR, pupilL, pupilR, noseMesh);

        // 柔和暖白点光（替代红色恐怖光）
        this.glow = new THREE.PointLight(0xffd0a0, 0.6, 6, 2.0);
        this.glow.position.set(0, 1.4, 0);
        group.add(this.glow);

        this._arms = { armL, armR, handL, handR };
    }

    /**
     * @param {number} dt
     * @param {*} player
     * @param {boolean} playerRunning
     * @param {{ ignorePlayer?: boolean }} [opts]
     * @returns {{caught:boolean, canSee:boolean, distance:number, roar:boolean, spotted:boolean}}
     */
    update(dt, player, playerRunning = false, opts = {}) {
        // 眩晕中：只播动画，不行动、不抓人
        if (this.stunTimer > 0) {
            this.stunTimer -= dt;
            this.canSeePlayer = false;
            const t = performance.now() * 0.003;
            this.mesh.position.set(this.position.x, 0.05 + Math.sin(t * 20) * 0.04, this.position.z);
            this.mesh.rotation.y += dt * 4;
            if (this.glow) this.glow.intensity = 0.4 + Math.sin(t * 15) * 0.2;
            const pg = player.getGridPos();
            const myGrid = {
                x: Math.round(this.position.x / CELL_SIZE),
                y: Math.round(this.position.z / CELL_SIZE),
            };
            this.distToPlayer = distance2D(pg.x, pg.y, myGrid.x, myGrid.y);
            return {
                caught: false,
                canSee: false,
                distance: this.distToPlayer,
                roar: false,
                spotted: false,
                stunned: true,
            };
        }

        const playerGrid = player.getGridPos();
        const myGrid = {
            x: Math.round(this.position.x / CELL_SIZE),
            y: Math.round(this.position.z / CELL_SIZE),
        };
        this.distToPlayer = distance2D(playerGrid.x, playerGrid.y, myGrid.x, myGrid.y);

        // 玩家无敌 / 隐藏：不锁定、不追击、不抓人，只巡逻
        if (opts.ignorePlayer) {
            if (
                this.state === State.SPOT ||
                this.state === State.HUNT ||
                this.state === State.SEARCH
            ) {
                this.state = State.PATROL;
                this.lastKnownPlayerCell = null;
                this._path = [];
                this._pathIndex = 0;
                this.huntTimer = 0;
                this.searchTimer = 0;
                this.spotTimer = 0;
            }
            this.canSeePlayer = false;
            this._roarCooldown -= dt;
            this._repathTimer -= dt;
            this._patrol(dt, myGrid);

            const t = performance.now() * 0.003;
            this.mesh.position.set(
                this.position.x,
                Math.abs(Math.sin(t * 4)) * 0.03,
                this.position.z
            );
            if (this._path.length > this._pathIndex) {
                const n = this._path[this._pathIndex];
                const faceX = n.x * CELL_SIZE - this.position.x;
                const faceZ = n.y * CELL_SIZE - this.position.z;
                if (Math.abs(faceX) + Math.abs(faceZ) > 0.05) {
                    this.mesh.rotation.y = Math.atan2(faceX, faceZ);
                }
            }
            if (this._arms) {
                const swing = Math.sin(t * 3) * 0.35;
                this._arms.armL.rotation.x = swing;
                this._arms.armR.rotation.x = -swing;
            }
            if (this.glow) this.glow.intensity = 1.0 + Math.sin(t * 3) * 0.25;

            return {
                caught: false,
                canSee: false,
                distance: this.distToPlayer,
                roar: false,
                spotted: false,
            };
        }

        const blocked = this.maze.lineOfSightBlocked(myGrid.x, myGrid.y, playerGrid.x, playerGrid.y);
        this.canSeePlayer = (this.distToPlayer < this.viewDistance) && !blocked;
        const canHear = playerRunning && this.distToPlayer < this.hearingRange;

        let spottedEvent = false;
        let roar = false;
        this._roarCooldown -= dt;
        this._repathTimer -= dt;

        // 状态切换
        if (this.state === State.SPOT) {
            this.spotTimer -= dt;
            if (this.spotTimer <= 0) {
                this.state = State.HUNT;
                this.huntTimer = this.huntDuration;
            }
        } else if (this.canSeePlayer || canHear) {
            if (this.state === State.PATROL || this.state === State.SEARCH) {
                this.state = State.SPOT;
                this.spotTimer = this.spotDuration;
                spottedEvent = true;
                roar = true;
                this._roarCooldown = 5.0;
            } else if (this.state === State.HUNT) {
                this.huntTimer = this.huntDuration;
            }
            this.lastKnownPlayerCell = { x: playerGrid.x, y: playerGrid.y };
        } else if (this.state === State.HUNT) {
            this.huntTimer -= dt;
            if (this.huntTimer <= 0) {
                this.state = State.SEARCH;
                this.searchTimer = this.searchDuration;
                this._path = [];
            }
        } else if (this.state === State.SEARCH) {
            this.searchTimer -= dt;
            if (this.searchTimer <= 0) {
                this.state = State.PATROL;
                this.lastKnownPlayerCell = null;
                this._path = [];
            }
        }

        // 行动
        switch (this.state) {
            case State.PATROL:
                this._patrol(dt, myGrid);
                break;
            case State.SPOT:
                // 顿挫：原地愣住，面向玩家
                break;
            case State.HUNT: {
                // 近距离直扑玩家世界坐标（避免只追格子中心导致贴脸抓不到）
                const pp = player.getPosition();
                const worldDist = distance2D(this.position.x, this.position.z, pp.x, pp.z);
                if (worldDist < CELL_SIZE * 1.35) {
                    this._moveTowardWorld(dt, pp.x, pp.z, this.huntSpeed);
                } else {
                    this._chaseGrid(dt, playerGrid, myGrid, 0.35);
                }
                if (!roar && this._roarCooldown <= 0 && this.distToPlayer < 9) {
                    this._roarCooldown = 5.5;
                    roar = true;
                }
                break;
            }
            case State.SEARCH:
                if (this.lastKnownPlayerCell) {
                    this._chaseGrid(dt, this.lastKnownPlayerCell, myGrid, 0.8);
                    const d = distance2D(myGrid.x, myGrid.y,
                        this.lastKnownPlayerCell.x, this.lastKnownPlayerCell.y);
                    if (d < 1) {
                        this.state = State.PATROL;
                        this.lastKnownPlayerCell = null;
                        this._path = [];
                    }
                } else {
                    this._patrol(dt, myGrid);
                }
                break;
        }

        // 模型同步
        const t = performance.now() * 0.003;
        // 窝囊版：行走不上下抖动，平稳走路更可爱不吓人
        const bob = this.mode === MODE.CUTE
            ? 0
            : (this.state === State.HUNT ? 0.06 : 0.03);
        this.mesh.position.set(
            this.position.x,
            Math.abs(Math.sin(t * (this.state === State.HUNT ? 12 : 4))) * bob,
            this.position.z
        );

        // 朝向
        let faceX = 0, faceZ = 0;
        if (this.state === State.SPOT || this.state === State.HUNT) {
            const pp = player.getPosition();
            faceX = pp.x - this.position.x;
            faceZ = pp.z - this.position.z;
        } else if (this._path.length > this._pathIndex) {
            const n = this._path[this._pathIndex];
            faceX = n.x * CELL_SIZE - this.position.x;
            faceZ = n.y * CELL_SIZE - this.position.z;
        }
        if (Math.abs(faceX) + Math.abs(faceZ) > 0.05) {
            this.mesh.rotation.y = Math.atan2(faceX, faceZ);
        }

        // 手臂挥动
        if (this._arms) {
            const swing = Math.sin(t * (this.state === State.HUNT ? 10 : 3)) * 0.35;
            this._arms.armL.rotation.x = swing;
            this._arms.armR.rotation.x = -swing;
        }

        this.glow.intensity = this.mode === MODE.CUTE
            ? ((this.state === State.HUNT || this.state === State.SPOT)
                ? 0.9 + Math.sin(t * 6) * 0.2
                : 0.6 + Math.sin(t * 3) * 0.15)
            : ((this.state === State.HUNT || this.state === State.SPOT)
                ? 1.6 + Math.sin(t * 8) * 0.4
                : 1.0 + Math.sin(t * 3) * 0.25);

        const caught = this._checkCatch(player);
        return {
            caught,
            canSee: this.canSeePlayer || this.state === State.HUNT || this.state === State.SPOT,
            distance: this.distToPlayer,
            roar,
            spotted: spottedEvent,
        };
    }

    _checkCatch(player) {
        // 愣神（SPOT）时也可抓住：已经贴脸就不应免疫
        const px = player.getPosition().x;
        const pz = player.getPosition().z;
        return distance2D(this.position.x, this.position.z, px, pz) < this.catchDistance;
    }

    _patrol(dt, myGrid) {
        const tx = this.targetCell.x * CELL_SIZE;
        const tz = this.targetCell.y * CELL_SIZE;
        const dist = distance2D(this.position.x, this.position.z, tx, tz);
        if (dist < 0.25) {
            this._pickNextPatrolCell();
        }
        this._moveTowardWorld(dt, tx, tz, this.patrolSpeed);
    }

    _pickNextPatrolCell() {
        const cx = this.targetCell.x;
        const cy = this.targetCell.y;
        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const candidates = [];
        for (const [dx, dy] of dirs) {
            const nx = cx + dx, ny = cy + dy;
            if (!this.maze.isWallCell(nx, ny)) {
                candidates.push({ x: nx, y: ny });
            }
        }
        if (candidates.length === 0) return;
        const filtered = candidates.filter(c =>
            !(c.x === this._lastCell?.x && c.y === this._lastCell?.y)
        );
        const pool = filtered.length > 0 ? filtered : candidates;
        this._lastCell = { x: cx, y: cy };
        this.targetCell = pool[Math.floor(this.rng() * pool.length)];
    }

    /** 沿 BFS 路径追向目标格 */
    _chaseGrid(dt, goalCell, myGrid, repathInterval) {
        if (this._repathTimer <= 0 || this._path.length === 0) {
            this._path = this._bfsPath(myGrid, goalCell);
            this._pathIndex = 0;
            this._repathTimer = repathInterval;
        }

        if (this._path.length === 0) {
            // 兜底直线
            this._moveTowardWorld(dt, goalCell.x * CELL_SIZE, goalCell.y * CELL_SIZE,
                this.state === State.HUNT ? this.huntSpeed : this.searchSpeed);
            return;
        }

        // 推进路径点
        while (this._pathIndex < this._path.length) {
            const node = this._path[this._pathIndex];
            const wx = node.x * CELL_SIZE;
            const wz = node.y * CELL_SIZE;
            const d = distance2D(this.position.x, this.position.z, wx, wz);
            if (d < 0.3) {
                this._pathIndex++;
                continue;
            }
            const speed = this.state === State.HUNT ? this.huntSpeed : this.searchSpeed;
            this._moveTowardWorld(dt, wx, wz, speed);
            return;
        }

        // 路径走完，直扑目标格中心
        this._moveTowardWorld(dt, goalCell.x * CELL_SIZE, goalCell.y * CELL_SIZE,
            this.state === State.HUNT ? this.huntSpeed : this.searchSpeed);
    }

    _moveTowardWorld(dt, tx, tz, speed) {
        const dx = tx - this.position.x;
        const dz = tz - this.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.04) return;
        const step = Math.min(speed * dt, d);
        this.position.x += (dx / d) * step;
        this.position.z += (dz / d) * step;
    }

    /** BFS：从 start 到 goal 的通路格路径（不含起点，含终点） */
    _bfsPath(start, goal) {
        if (start.x === goal.x && start.y === goal.y) return [];
        const key = (x, y) => x + ',' + y;
        const queue = [{ x: start.x, y: start.y }];
        const came = new Map();
        came.set(key(start.x, start.y), null);
        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        let found = false;

        while (queue.length > 0) {
            const cur = queue.shift();
            if (cur.x === goal.x && cur.y === goal.y) {
                found = true;
                break;
            }
            for (const [dx, dy] of dirs) {
                const nx = cur.x + dx;
                const ny = cur.y + dy;
                const k = key(nx, ny);
                if (came.has(k)) continue;
                if (this.maze.isWallCell(nx, ny)) continue;
                came.set(k, cur);
                queue.push({ x: nx, y: ny });
            }
        }

        if (!found) return [];

        const path = [];
        let cur = { x: goal.x, y: goal.y };
        while (cur) {
            path.push(cur);
            const prev = came.get(key(cur.x, cur.y));
            cur = prev;
        }
        path.reverse();
        // 去掉起点
        if (path.length > 0 && path[0].x === start.x && path[0].y === start.y) {
            path.shift();
        }
        return path;
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
    }
}
