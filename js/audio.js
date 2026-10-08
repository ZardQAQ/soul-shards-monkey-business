// ============================================================
// audio.js - 程序化音效系统（Web Audio API）
// 所有音效无需外部音频文件，通过振荡器与噪声合成生成
// 包含：
//   - 心跳声（怪物靠近时加快）
//   - 低频环境恐怖音
//   - 收集灵魂碎片音效
//   - 怪物吼叫声
//   - 被抓住音效
//   - 胜利音效
// ============================================================

import { MODE } from './mode.js';

export class AudioSystem {
    constructor(options = {}) {
        this.ctx = null;
        this.masterGain = null;
        this._initialized = false;
        this.mode = options.mode || MODE.CLASSIC;

        // 心跳状态
        this._heartbeatTimer = null;
        this._heartbeatInterval = 1.2;  // 心跳间隔（秒），越小越快
        this._heartbeatActive = false;

        // 环境音节点（持续低频嗡鸣）
        this._ambientNodes = null;

        // 追逐音层
        this._chaseNodes = null;
        this._threatLevel = 0;
        this._chaseGainValue = 0;
        this._chasePulseTimer = null;
    }

    /** 初始化音频上下文（必须在用户交互后调用） */
    init() {
        if (this._initialized) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioCtx();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.6;
            this.masterGain.connect(this.ctx.destination);
            this._initialized = true;
        } catch (e) {
            console.warn('音频系统初始化失败:', e);
        }
    }

    /** 恢复音频上下文（浏览器自动挂起后需手动恢复） */
    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    // ============= 心跳声 =============
    /**
     * 开始心跳，间隔随危险等级变化
     * @param {number} intensity 危险等级 0-1（0=安全慢，1=极危险快）
     */
    startHeartbeat() {
        // 窝囊版：不播心跳，避免紧张感
        if (this.mode === MODE.CUTE) return;
        if (!this._initialized || this._heartbeatActive) return;
        this._heartbeatActive = true;
        this._scheduleHeartbeat();
    }

    stopHeartbeat() {
        this._heartbeatActive = false;
        if (this._heartbeatTimer) {
            clearTimeout(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    /**
     * 设置心跳速度（根据最近敌人距离）
     * @param {number} distance 最近敌人距离（格）
     */
    setHeartbeatByDistance(distance) {
        // 窝囊版：不播心跳
        if (this.mode === MODE.CUTE) return;
        // 距离 < 12 开始心跳；距离越近间隔越短
        if (distance > 14) {
            this.stopHeartbeat();
            return;
        }
        if (!this._heartbeatActive) this.startHeartbeat();
        // 间隔从 1.4s（远）到 0.35s（极近）
        const t = Math.max(0, Math.min(1, (14 - distance) / 14));
        this._heartbeatInterval = 1.4 - t * 1.05;
    }

    _scheduleHeartbeat() {
        if (!this._heartbeatActive || !this.ctx) return;
        this._playHeartbeatBeat();
        // 第二拍（心跳的"咚-咚"）
        setTimeout(() => {
            if (this._heartbeatActive) this._playHeartbeatBeat(0.7);
        }, 180);
        this._heartbeatTimer = setTimeout(() => {
            this._scheduleHeartbeat();
        }, this._heartbeatInterval * 1000);
    }

    _playHeartbeatBeat(volume = 1) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        // 低频鼓声：60Hz 正弦波 + 快速衰减
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(60, now);
        osc.frequency.exponentialRampToValueAtTime(35, now + 0.15);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.5 * volume, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(gain).connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.25);
    }

    // ============= 环境恐怖音 =============
    /**
     * 启动持续的低频环境音（经典版）/ 明亮和弦环境音（窝囊版）
     */
    startAmbient() {
        if (!this._initialized || this._ambientNodes) return;
        const now = this.ctx.currentTime;

        if (this.mode === MODE.CUTE) {
            // 窝囊版：明亮大三和弦（A 大调），增益减半
            const osc1 = this.ctx.createOscillator();
            osc1.type = 'sine';
            osc1.frequency.value = 220;  // A3
            const gain1 = this.ctx.createGain();
            gain1.gain.value = 0.04;
            osc1.connect(gain1).connect(this.masterGain);
            osc1.start();

            const osc2 = this.ctx.createOscillator();
            osc2.type = 'sine';
            osc2.frequency.value = 277.18;  // C#4（大三度）
            const gain2 = this.ctx.createGain();
            gain2.gain.value = 0.025;
            osc2.connect(gain2).connect(this.masterGain);
            osc2.start();

            const osc3 = this.ctx.createOscillator();
            osc3.type = 'sine';
            osc3.frequency.value = 329.63;  // E4（纯五度）
            const gain3 = this.ctx.createGain();
            gain3.gain.value = 0.02;
            osc3.connect(gain3).connect(this.masterGain);
            osc3.start();

            // 轻柔高频空气感（替代低频白噪声）
            const noiseBuffer = this._createNoiseBuffer(2);
            const noise = this.ctx.createBufferSource();
            noise.buffer = noiseBuffer;
            noise.loop = true;
            const noiseFilter = this.ctx.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 800;
            const noiseGain = this.ctx.createGain();
            noiseGain.gain.value = 0.015;
            noise.connect(noiseFilter).connect(noiseGain).connect(this.masterGain);
            noise.start();

            this._ambientNodes = { osc1, osc2, osc3, noise, gain1, gain2, gain3, noiseGain };
            return;
        }

        // 低频持续音（drone）
        const osc1 = this.ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.value = 55;  // 低 A
        const gain1 = this.ctx.createGain();
        gain1.gain.value = 0.08;
        osc1.connect(gain1).connect(this.masterGain);
        osc1.start();

        // 第二层略高频率，制造不和谐感
        const osc2 = this.ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = 58;  // 略微失调
        const gain2 = this.ctx.createGain();
        gain2.gain.value = 0.05;
        osc2.connect(gain2).connect(this.masterGain);
        osc2.start();

        // 低频白噪声层（风声感）
        const noiseBuffer = this._createNoiseBuffer(2);
        const noise = this.ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        noise.loop = true;
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.value = 200;
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.value = 0.04;
        noise.connect(noiseFilter).connect(noiseGain).connect(this.masterGain);
        noise.start();

        this._ambientNodes = { osc1, osc2, noise, gain1, gain2, noiseGain };
    }

    stopAmbient() {
        if (!this._ambientNodes) return;
        const { osc1, osc2, noise } = this._ambientNodes;
        const osc3 = this._ambientNodes.osc3;
        try {
            osc1.stop();
            osc2.stop();
            if (osc3) osc3.stop();
            noise.stop();
        } catch (e) { /* 已停止 */ }
        this._ambientNodes = null;
    }

    // ============= 追逐音层（被发现后混入） =============
    startChaseLayer() {
        if (!this._initialized || this._chaseNodes) return;
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 90;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        filter.Q.value = 6;
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        osc.connect(filter).connect(gain).connect(this.masterGain);
        osc.start(now);

        // 脉冲感第二层
        const noise = this.ctx.createBufferSource();
        noise.buffer = this._createNoiseBuffer(1);
        noise.loop = true;
        const nFilter = this.ctx.createBiquadFilter();
        nFilter.type = 'bandpass';
        nFilter.frequency.value = 180;
        nFilter.Q.value = 3;
        const nGain = this.ctx.createGain();
        nGain.gain.value = 0;
        noise.connect(nFilter).connect(nGain).connect(this.masterGain);
        noise.start(now);

        // 不和谐第二声部
        const osc2 = this.ctx.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.value = 96;
        const gain2 = this.ctx.createGain();
        gain2.gain.value = 0;
        osc2.connect(gain2).connect(this.masterGain);
        osc2.start(now);

        this._chaseNodes = { osc, osc2, noise, gain, gain2, nGain, filter };
        this._startChasePulse();
    }

    _startChasePulse() {
        if (!this._chaseNodes || !this.ctx) return;
        const pulseOnce = () => {
            if (!this._chaseNodes || !this._initialized) return;
            const g = this._chaseNodes.nGain;
            const now = this.ctx.currentTime;
            const level = this._chaseGainValue;
            if (level > 0.02) {
                g.gain.cancelScheduledValues(now);
                g.gain.setValueAtTime(level * 0.12, now);
                g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
            }
            const interval = 280 - this._threatLevel * 120; // 威胁越高越密
            this._chasePulseTimer = setTimeout(pulseOnce, Math.max(140, interval));
        };
        pulseOnce();
    }

    stopChaseLayer() {
        if (this._chasePulseTimer) {
            clearTimeout(this._chasePulseTimer);
            this._chasePulseTimer = null;
        }
        if (!this._chaseNodes) return;
        const { osc, osc2, noise } = this._chaseNodes;
        try {
            osc.stop();
            osc2.stop();
            noise.stop();
        } catch (e) { /* */ }
        this._chaseNodes = null;
        this._chaseGainValue = 0;
        this._threatLevel = 0;
    }

    /**
     * 威胁等级 0–1：推高追逐层、压低环境音
     * 窝囊版：直接 return，不启动追逐层
     * @param {number} level
     */
    setThreatLevel(level) {
        if (!this._initialized) return;
        if (this.mode === MODE.CUTE) return;
        this._threatLevel = Math.max(0, Math.min(1, level));
        if (this._threatLevel > 0.15 && !this._chaseNodes) {
            this.startChaseLayer();
        }
        if (this._threatLevel < 0.08 && this._chaseNodes) {
            // 渐弱后可保留节点，只把增益拉低
        }

        this._chaseGainValue = this._threatLevel * 0.22;
        if (this._chaseNodes) {
            const now = this.ctx.currentTime;
            this._chaseNodes.gain.gain.setTargetAtTime(this._chaseGainValue, now, 0.15);
            this._chaseNodes.gain2.gain.setTargetAtTime(this._chaseGainValue * 0.55, now, 0.15);
            this._chaseNodes.filter.frequency.setTargetAtTime(400 + this._threatLevel * 600, now, 0.2);
        }
        if (this._ambientNodes) {
            const now = this.ctx.currentTime;
            const ambScale = 1 - this._threatLevel * 0.55;
            this._ambientNodes.gain1.gain.setTargetAtTime(0.08 * ambScale, now, 0.25);
            this._ambientNodes.gain2.gain.setTargetAtTime(0.05 * ambScale, now, 0.25);
        }
    }

    /** 发现瞬间刺耳 cue（经典版）/ 轻「叮」一声（窝囊版） */
    playSpotCue() {
        if (!this._initialized) return;
        const now = this.ctx.currentTime;

        if (this.mode === MODE.CUTE) {
            // 窝囊版：轻「叮」一声，正弦 1200Hz 0.1s
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, now);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.18, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(gain).connect(this.masterGain);
            osc.start(now);
            osc.stop(now + 0.14);
            return;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = this._createNoiseBuffer(0.3);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(800, now);
        filter.frequency.exponentialRampToValueAtTime(4000, now + 0.12);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.35, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        noise.connect(filter).connect(gain).connect(this.masterGain);
        noise.start(now);
        noise.stop(now + 0.25);

        const osc = this.ctx.createOscillator();
        const og = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.18);
        og.gain.setValueAtTime(0.2, now);
        og.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(og).connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.22);
    }

    /** 创建白噪声缓冲区 */
    _createNoiseBuffer(seconds) {
        const sampleRate = this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, sampleRate * seconds, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }

    // ============= 收集灵魂碎片音效 =============
    playShardCollect() {
        if (!this._initialized) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(gain).connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.35);

        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(2400, now);
        osc2.frequency.exponentialRampToValueAtTime(1800, now + 0.1);
        gain2.gain.setValueAtTime(0, now);
        gain2.gain.linearRampToValueAtTime(0.12, now + 0.01);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc2.connect(gain2).connect(this.masterGain);
        osc2.start(now);
        osc2.stop(now + 0.25);
    }

    // ============= 怪物吼叫声（经典版）/ 喵叫（窝囊版） =============
    playMonsterRoar() {
        if (!this._initialized) return;
        const now = this.ctx.currentTime;

        if (this.mode === MODE.CUTE) {
            // 窝囊版：短促「喵」—— 正弦 500→800Hz 快速上滑 0.15s
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(500, now);
            osc.frequency.exponentialRampToValueAtTime(800, now + 0.12);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
            osc.connect(gain).connect(this.masterGain);
            osc.start(now);
            osc.stop(now + 0.2);

            // 第二条喵（稍低、稍后），更可爱
            const osc2 = this.ctx.createOscillator();
            const gain2 = this.ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(450, now + 0.15);
            osc2.frequency.exponentialRampToValueAtTime(700, now + 0.27);
            gain2.gain.setValueAtTime(0, now + 0.15);
            gain2.gain.linearRampToValueAtTime(0.16, now + 0.17);
            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
            osc2.connect(gain2).connect(this.masterGain);
            osc2.start(now + 0.15);
            osc2.stop(now + 0.34);
            return;
        }

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110, now);
        osc.frequency.linearRampToValueAtTime(55, now + 0.35);
        osc.frequency.linearRampToValueAtTime(90, now + 0.7);
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        filter.Q.value = 4;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.28, now + 0.04);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.55);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
        osc.connect(filter).connect(gain).connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 1.0);

        const noise = this.ctx.createBufferSource();
        noise.buffer = this._createNoiseBuffer(1);
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 350;
        noiseFilter.Q.value = 2;
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0, now);
        noiseGain.gain.linearRampToValueAtTime(0.18, now + 0.05);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
        noise.connect(noiseFilter).connect(noiseGain).connect(this.masterGain);
        noise.start(now);
        noise.stop(now + 0.95);
    }

    // ============= 被抓住音效（经典版）/ 下行小琶音（窝囊版） =============
    playCaught() {
        if (!this._initialized) return;
        const now = this.ctx.currentTime;

        if (this.mode === MODE.CUTE) {
            // 窝囊版：下行小琶音（三角波 600→400→300Hz），不刺耳
            const notes = [600, 400, 300];
            notes.forEach((freq, i) => {
                const t = now + i * 0.1;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
                osc.connect(gain).connect(this.masterGain);
                osc.start(t);
                osc.stop(t + 0.2);
            });
            return;
        }

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.6);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.4, now + 0.02);
        gain.gain.linearRampToValueAtTime(0.35, now + 0.5);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        osc.connect(gain).connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.85);

        const sub = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(120, now);
        sub.frequency.exponentialRampToValueAtTime(30, now + 0.5);
        subGain.gain.setValueAtTime(0.5, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        sub.connect(subGain).connect(this.masterGain);
        sub.start(now);
        sub.stop(now + 0.7);
    }

    // ============= 胜利音效 =============
    playWin() {
        if (!this._initialized) return;
        const now = this.ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, i) => {
            const t = now + i * 0.15;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
            osc.connect(gain).connect(this.masterGain);
            osc.start(t);
            osc.stop(t + 0.45);
        });
    }

    // ============= 出口开启音效 =============
    playExitOpen() {
        if (!this._initialized) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 1.0);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.8);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
        osc.connect(gain).connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 1.3);
    }

    /** 电梯到达叮一声 */
    playElevatorDing() {
        if (!this._initialized) return;
        const now = this.ctx.currentTime;
        const tones = [880, 660];
        tones.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            const t = now + i * 0.18;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
            osc.connect(gain).connect(this.masterGain);
            osc.start(t);
            osc.stop(t + 0.5);
        });
    }

    /** 清理所有音效 */
    dispose() {
        this.stopHeartbeat();
        this.stopAmbient();
        this.stopChaseLayer();
        if (this.ctx) {
            this.ctx.close();
            this.ctx = null;
        }
        this._initialized = false;
    }
}
