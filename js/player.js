// ============================================================
// player.js - 第一人称控制（DD 冲刺体感：更快 + FOV + head-bob）
// ============================================================

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CELL_SIZE } from './maze.js';

export class Player {
    /**
     * @param {THREE.Camera} camera
     * @param {Maze} maze
     * @param {HTMLElement} domElement
     * @param {import('./scene.js').Scene|null} gameScene 用于 FOV
     */
    constructor(camera, maze, domElement, gameScene = null) {
        this.camera = camera;
        this.maze = maze;
        this.domElement = domElement;
        this.gameScene = gameScene;

        this.controls = new PointerLockControls(camera, domElement);

        /** @type {((x:number,z:number,r:number)=>boolean)|null} 额外阻挡（如电梯门） */
        this.extraBlocked = null;

        this.walkSpeed = 2.5;
        this.runSpeed = 4.6;
        // 世界单位；窄走廊下保持可通行
        this.playerRadius = 0.28;
        this.eyeHeight = 1.6;

        // 无限体力：可一直冲刺
        this.maxStamina = 100;
        this.stamina = 100;
        this.infiniteStamina = true;

        // V 键疾跑技能：+25% 速度，持续 3 秒，冷却 20 秒
        this.skillSpeedMult = 1.25;
        this.skillDuration = 3.0;
        this.skillCooldown = 20.0;
        this.skillActiveRemaining = 0;
        this.skillCooldownRemaining = 0;

        this._moveDir = new THREE.Vector3();
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();

        this._bobPhase = 0;
        this._isRunning = false;
        this._isMoving = false;

        this.locked = false;
        this.controls.addEventListener('lock', () => { this.locked = true; });
        this.controls.addEventListener('unlock', () => { this.locked = false; });

        /** 被抓后短暂无敌，避免立刻再被抓住 */
        this.invulnTimer = 0;

        this._setStartPosition();
    }

    _setStartPosition() {
        const start = this.maze.getStartWorldPos();
        this.camera.position.set(start.x, this.eyeHeight, start.z);
        this.camera.lookAt(start.x, this.eyeHeight, start.z + 1);
    }

    /**
     * 放置玩家并朝向某点（过场用，不依赖 PointerLock）
     */
    placeLookingAt(x, z, lookX, lookZ) {
        this.camera.position.set(x, this.eyeHeight, z);
        this.camera.lookAt(lookX, this.eyeHeight, lookZ);
        this._bobPhase = 0;
    }

    /**
     * 平滑移动到目标（过场）
     * @returns {boolean} 是否已到达
     */
    moveToward(x, z, speed, dt) {
        const dx = x - this.camera.position.x;
        const dz = z - this.camera.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.05) {
            this.camera.position.x = x;
            this.camera.position.z = z;
            return true;
        }
        const step = Math.min(dist, speed * dt);
        this.camera.position.x += (dx / dist) * step;
        this.camera.position.z += (dz / dist) * step;
        this.camera.position.y = this.eyeHeight;
        return false;
    }

    lock() {
        this.controls.lock();
    }

    unlock() {
        this.controls.unlock();
    }

    update(dt, input) {
        if (this.invulnTimer > 0) {
            this.invulnTimer = Math.max(0, this.invulnTimer - dt);
        }
        if (!this.locked) return;

        // ===== V 键疾跑技能：触发 + 计时 =====
        if (this.skillActiveRemaining > 0) {
            this.skillActiveRemaining = Math.max(0, this.skillActiveRemaining - dt);
            if (this.skillActiveRemaining === 0) {
                this.skillCooldownRemaining = this.skillCooldown;
            }
        } else if (this.skillCooldownRemaining > 0) {
            this.skillCooldownRemaining = Math.max(0, this.skillCooldownRemaining - dt);
        }
        if (input.consumePressed('KeyV') &&
            this.skillActiveRemaining <= 0 &&
            this.skillCooldownRemaining <= 0) {
            this.skillActiveRemaining = this.skillDuration;
        }
        const skillActive = this.skillActiveRemaining > 0;

        const moveX = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
        const moveZ = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);

        const wantRun = (input.isDown('ShiftLeft') || input.isDown('ShiftRight'))
            && (moveX !== 0 || moveZ !== 0);
        this._isRunning = wantRun;
        this._isMoving = moveX !== 0 || moveZ !== 0;
        let speed = wantRun ? this.runSpeed : this.walkSpeed;
        if (skillActive) speed *= this.skillSpeedMult;

        // 无限体力：始终保持满值
        this.stamina = this.maxStamina;

        // 冲刺 FOV（在设置的基础 FOV 上放大）
        if (this.gameScene) {
            const base = this.gameScene.getBaseFov?.() ?? this.gameScene.baseFov ?? 75;
            let targetFov = base;
            if (wantRun) targetFov = base + 13;
            if (skillActive) targetFov = base + 21;
            this.gameScene.setTargetFov(Math.min(110, targetFov));
        }

        // head-bob（仅视觉，不改碰撞用的逻辑高度基准）
        if (this._isMoving) {
            const bobSpeed = wantRun ? 14 : 9;
            const bobAmp = wantRun ? 0.055 : 0.03;
            this._bobPhase += dt * bobSpeed;
            this.camera.position.y = this.eyeHeight + Math.sin(this._bobPhase) * bobAmp;
        } else {
            this.camera.position.y += (this.eyeHeight - this.camera.position.y) * Math.min(1, dt * 10);
            this._bobPhase = 0;
        }

        if (!this._isMoving) return;

        this.camera.getWorldDirection(this._forward);
        this._forward.y = 0;
        this._forward.normalize();
        this._right.crossVectors(this._forward, this.camera.up).normalize();

        this._moveDir.set(0, 0, 0);
        this._moveDir.addScaledVector(this._forward, moveZ);
        this._moveDir.addScaledVector(this._right, moveX);
        if (this._moveDir.lengthSq() > 0) {
            this._moveDir.normalize();
        }

        const distance = speed * dt;
        const dx = this._moveDir.x * distance;
        const dz = this._moveDir.z * distance;

        const pos = this.camera.position;
        const newX = pos.x + dx;
        if (!this._isBlocked(newX, pos.z)) {
            pos.x = newX;
        }
        const newZ = pos.z + dz;
        if (!this._isBlocked(pos.x, newZ)) {
            pos.z = newZ;
        }
    }

    /** 迷宫墙 + 额外阻挡（电梯关闭的门等） */
    _isBlocked(worldX, worldZ) {
        const r = this.playerRadius;
        if (this.maze.isWallAt(worldX, worldZ, r)) return true;
        if (this.extraBlocked && this.extraBlocked(worldX, worldZ, r)) return true;
        return false;
    }

    getGridPos() {
        return {
            x: Math.round(this.camera.position.x / CELL_SIZE),
            y: Math.round(this.camera.position.z / CELL_SIZE),
        };
    }

    getPosition() {
        return this.camera.position;
    }

    getStaminaRatio() {
        return this.stamina / this.maxStamina;
    }

    isRunning() {
        return this._isRunning;
    }

    /** 获取技能状态供 UI 显示 */
    getSkillState() {
        return {
            active: this.skillActiveRemaining > 0,
            cooling: this.skillCooldownRemaining > 0,
            activeRemaining: this.skillActiveRemaining,
            activeDuration: this.skillDuration,
            cooldownRemaining: this.skillCooldownRemaining,
            cooldownDuration: this.skillCooldown,
        };
    }

    /**
     * 平滑转向世界坐标某点（被抓看向怪物等）
     * @returns {boolean} 是否已对准
     */
    lookToward(worldX, worldZ, turnSpeed = 5, dt = 0.016) {
        const from = this.camera.position;
        const dx = worldX - from.x;
        const dz = worldZ - from.z;
        if (Math.hypot(dx, dz) < 0.05) return true;

        this.camera.getWorldDirection(this._forward);
        this._forward.y = 0;
        if (this._forward.lengthSq() < 1e-6) this._forward.set(0, 0, 1);
        this._forward.normalize();

        const target = this._moveDir.set(dx, 0, dz).normalize();
        const curYaw = Math.atan2(this._forward.x, this._forward.z);
        const tgtYaw = Math.atan2(target.x, target.z);
        let dy = tgtYaw - curYaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;

        const maxStep = Math.max(0, turnSpeed) * dt;
        const step = Math.abs(dy) <= maxStep ? dy : Math.sign(dy) * maxStep;
        const yaw = curYaw + step;

        const lookDist = 3;
        this.camera.lookAt(
            from.x + Math.sin(yaw) * lookDist,
            this.eyeHeight,
            from.z + Math.cos(yaw) * lookDist
        );
        this._bobPhase = 0;
        return Math.abs(dy - step) < 0.03;
    }

    /**
     * 立即看向某点（可指定高度，默认平视）
     */
    snapLookAt(worldX, worldZ, worldY = null) {
        const y = worldY == null ? this.eyeHeight : worldY;
        this.camera.lookAt(worldX, y, worldZ);
        this._bobPhase = 0;
    }

    /** 锁定看向敌人脸部 */
    snapLookAtFace(enemy) {
        if (!enemy || !enemy.getFaceWorldPos) return;
        const face = enemy.getFaceWorldPos(this._moveDir);
        this.camera.lookAt(face.x, face.y, face.z);
        this._bobPhase = 0;
    }

    /**
     * 传送到指定世界坐标（保持朝向，用于死亡重生）
     */
    teleportTo(x, z, invulnSeconds = 2.5) {
        this.camera.position.x = x;
        this.camera.position.z = z;
        this.camera.position.y = this.eyeHeight;
        this._bobPhase = 0;
        this.invulnTimer = invulnSeconds;
    }

    isInvulnerable() {
        return this.invulnTimer > 0;
    }

    getDirection() {
        this.camera.getWorldDirection(this._forward);
        this._forward.y = 0;
        return this._forward.normalize();
    }

    isAtExit() {
        // 兼容：优先用电梯入口判定
        return this.maze.isAtExit(this.camera.position.x, this.camera.position.z);
    }

    dispose() {
        this.controls.dispose();
    }
}
