// ============================================================
// scene.js - Three.js 场景（酒店走廊：暖暗雾 + 顶灯光池可读）
// ============================================================

import * as THREE from 'three';
import { MODE, getCuteConfig } from './mode.js';

export class Scene {
    constructor(container) {
        this.container = container;
        this.mode = MODE.CLASSIC;

        this.scene = new THREE.Scene();
        // 酒店走廊：暖色底 + 较轻雾，保证远端墙面仍可读（对齐参考明度）
        this.scene.background = new THREE.Color(0x1a1210);
        this.scene.fog = new THREE.FogExp2(0x1e1614, 0.038);

        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            72
        );
        this.camera.position.set(0, 1.6, 0);
        this.baseFov = 75;
        this.targetFov = 75;

        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            powerPreference: 'high-performance',
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.LinearToneMapping;
        this.renderer.toneMappingExposure = 1.15;
        this.container.appendChild(this.renderer.domElement);

        this._shakeTime = 0;
        this._shakeAmp = 0;
        this._shakeOffset = new THREE.Vector3();
        this.brightness = 100; // 50~150
        this.quality = 100; // 50~100，控制渲染分辨率比例

        // 经典版默认基线（cute 模式会在 setMode 中覆盖）
        this._baseAmbient = 0.95;
        this._baseHemi = 0.55;
        this._baseFlash = 0.55; // 环境已够亮，手电只作近距补光

        this._applyResolution();
        this._setupLights();
        window.addEventListener('resize', () => this._onResize());
    }

    /**
     * 按模式切换场景氛围（背景/雾/环境光/曝光）
     * @param {string} mode MODE.CLASSIC | MODE.CUTE
     */
    setMode(mode) {
        this.mode = mode || MODE.CLASSIC;
        const cfg = getCuteConfig().scene;
        if (this.mode === MODE.CUTE) {
            this.scene.background = new THREE.Color(cfg.background);
            this.scene.fog = new THREE.FogExp2(cfg.fogColor, cfg.fogDensity);
            this._baseAmbient = cfg.ambientIntensity;
            this._baseHemi = cfg.hemiIntensity;
            this._baseFlash = 0.35; // 窝囊版环境很亮，手电更弱
            this.renderer.toneMappingExposure = cfg.exposure;
            if (this.ambient) {
                this.ambient.color.setHex(cfg.ambientColor);
            }
            if (this.hemi) {
                this.hemi.color.setHex(cfg.hemiSky);
                this.hemi.groundColor.setHex(cfg.hemiGround);
            }
            if (this.flashlight) {
                this.flashlight.color.setHex(cfg.flashlightColor);
            }
        } else {
            this.scene.background = new THREE.Color(0x1a1210);
            this.scene.fog = new THREE.FogExp2(0x1e1614, 0.038);
            this._baseAmbient = 0.95;
            this._baseHemi = 0.55;
            this._baseFlash = 0.55;
            this.renderer.toneMappingExposure = 1.15;
            if (this.ambient) {
                this.ambient.color.setHex(0x6a5848);
            }
            if (this.hemi) {
                this.hemi.color.setHex(0x8a7868);
                this.hemi.groundColor.setHex(0x2a1e18);
            }
            if (this.flashlight) {
                this.flashlight.color.setHex(0xfff0d0);
            }
        }
        // 重新应用当前亮度倍率（按新基线缩放）
        this.setBrightness(this.brightness);
    }

    _setupLights() {
        // 环境光接近参考图：墙面奶油色可读，不是纯黑走廊
        this.ambient = new THREE.AmbientLight(0x6a5848, this._baseAmbient);
        this.scene.add(this.ambient);

        this.hemi = new THREE.HemisphereLight(0x8a7868, 0x2a1e18, this._baseHemi);
        this.scene.add(this.hemi);

        this.flashlight = new THREE.SpotLight(
            0xfff0d0,
            this._baseFlash,
            14,
            Math.PI / 5.5,
            0.55,
            1.15
        );
        this.flashlight.position.set(0, 1.6, 0);
        this.flashlightTarget = new THREE.Object3D();
        this.flashlightTarget.position.set(0, 1.6, -1);
        this.scene.add(this.flashlightTarget);
        this.flashlight.target = this.flashlightTarget;
        this.scene.add(this.flashlight);

        this.playerGlow = null;
    }

    updateFlashlight(cameraPos, cameraDir) {
        this.flashlight.position.set(cameraPos.x, cameraPos.y - 0.1, cameraPos.z);
        this.flashlightTarget.position.set(
            cameraPos.x + cameraDir.x * 5,
            cameraPos.y + cameraDir.y * 5 - 0.2,
            cameraPos.z + cameraDir.z * 5
        );
        const mult = (this.brightness || 100) / 100;
        this.flashlight.intensity = this._baseFlash * mult;
    }

    setTargetFov(fov) {
        this.targetFov = fov;
    }

    /** 设置基础视野（设置面板），冲刺会在此基础上再放大 */
    setBaseFov(fov) {
        const v = Math.max(60, Math.min(100, Number(fov) || 75));
        this.baseFov = v;
        this.targetFov = v;
        this.camera.fov = v;
        this.camera.updateProjectionMatrix();
        return v;
    }

    getBaseFov() {
        return this.baseFov;
    }

    /**
     * 设置游戏亮度（50~150，100 为默认）
     * 同时调整曝光与环境光
     */
    setBrightness(value) {
        const v = Math.max(50, Math.min(150, Math.round(Number(value) || 100)));
        this.brightness = v;
        const mult = v / 100;
        this.renderer.toneMappingExposure = 0.85 + mult * 0.45; // 约 1.075~1.525
        if (this.ambient) this.ambient.intensity = this._baseAmbient * mult;
        if (this.hemi) this.hemi.intensity = this._baseHemi * mult;
        if (this.flashlight) this.flashlight.intensity = this._baseFlash * mult;
        return v;
    }

    getBrightness() {
        return this.brightness;
    }

    /**
     * 设置画质 / 渲染分辨率（50~100，100 为默认）
     * 降低可明显提升帧率，画面会更糊一些
     */
    setQuality(value) {
        const v = Math.max(50, Math.min(100, Math.round(Number(value) || 100)));
        this.quality = v;
        this._applyResolution();
        return v;
    }

    getQuality() {
        return this.quality;
    }

    /** 按画质比例设置像素比与画布尺寸 */
    _applyResolution() {
        const scale = (this.quality || 100) / 100;
        // 限制像素比上限为 1，再乘画质比例（高分屏上性能更稳）
        const dpr = Math.min(window.devicePixelRatio || 1, 1) * scale;
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    shake(duration = 0.4, amplitude = 0.1) {
        this._shakeTime = Math.max(this._shakeTime, duration);
        this._shakeAmp = Math.max(this._shakeAmp, amplitude);
    }

    updateCameraEffects(dt) {
        const cam = this.camera;
        if (Math.abs(cam.fov - this.targetFov) > 0.05) {
            cam.fov += (this.targetFov - cam.fov) * Math.min(1, dt * 8);
            cam.updateProjectionMatrix();
        } else if (cam.fov !== this.targetFov) {
            cam.fov = this.targetFov;
            cam.updateProjectionMatrix();
        }

        if (this._shakeTime > 0) {
            this._shakeTime -= dt;
            const damp = Math.max(0, this._shakeTime / 0.4);
            this._shakeOffset.set(
                (Math.random() - 0.5) * this._shakeAmp * damp,
                (Math.random() - 0.5) * this._shakeAmp * damp,
                (Math.random() - 0.5) * this._shakeAmp * 0.4 * damp
            );
            if (this._shakeTime <= 0) {
                this._shakeAmp = 0;
                this._shakeOffset.set(0, 0, 0);
            }
        }
    }

    add(obj) { this.scene.add(obj); }
    remove(obj) { this.scene.remove(obj); }

    render() {
        const cam = this.camera;
        const ox = this._shakeOffset.x;
        const oy = this._shakeOffset.y;
        const oz = this._shakeOffset.z;
        cam.position.x += ox;
        cam.position.y += oy;
        cam.position.z += oz;
        this.renderer.render(this.scene, cam);
        cam.position.x -= ox;
        cam.position.y -= oy;
        cam.position.z -= oz;
    }

    _onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this._applyResolution();
    }

    clear() {
        const toRemove = [];
        this.scene.traverse((obj) => {
            if (obj === this.scene) return;
            if (obj.isLight) return;
            if (obj === this.flashlightTarget) return;
            toRemove.push(obj);
        });
        toRemove.forEach((obj) => {
            this.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
    }
}
