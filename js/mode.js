// ============================================================
// mode.js - 游戏模式配置（经典版 / 窝囊版）
// 经典版：原恐怖血猴体验
// 窝囊版：萌宠乐园风，去恐怖化
// ============================================================

export const MODE = {
    CLASSIC: 'classic',
    CUTE: 'cute',
};

const MODE_KEY = 'dd-mode';

/** 读取 localStorage 中的模式，默认经典版 */
export function loadMode() {
    try {
        const v = localStorage.getItem(MODE_KEY);
        if (v === MODE.CUTE || v === MODE.CLASSIC) return v;
    } catch { /* ignore */ }
    return MODE.CLASSIC;
}

/** 持久化模式选择 */
export function saveMode(mode) {
    try {
        localStorage.setItem(MODE_KEY, mode);
    } catch { /* ignore */ }
}

/**
 * 窝囊版（萌宠乐园）配置参数
 * 集中管理，避免散落硬编码
 */
export function getCuteConfig() {
    return {
        // 敌人移速/感知（速度跟经典版一样，只是换皮不换难度）
        enemy: {
            patrolSpeed: 1.8,
            huntSpeed: 3.6,
            searchSpeed: 2.7,
            viewDistance: 14,
            catchDistance: 1.45,
            hearingRange: 7,
        },
        // 数量平衡
        enemyCount: 4,
        escapeEnemyCount: 3,
        // 敌人模型缩放（窝囊版更小，更可爱不压迫）
        enemyScale: 0.75,
        // 场景氛围
        scene: {
            background: 0xb8e0ff,
            fogColor: 0xc8e8ff,
            fogDensity: 0.012,
            ambientColor: 0xffe8c8,
            ambientIntensity: 1.6,
            hemiSky: 0xfff0d8,
            hemiGround: 0x90c070,
            hemiIntensity: 1.0,
            exposure: 1.5,
            flashlightColor: 0xfff5d0,
            // 窝囊版地图配色（萌宠乐园风）
            floorColor: 0xe8d4b0,       // 暖米白地板
            floorAccentColor: 0xd4b890, // 地板拼花纹理色
            wallColor: 0xf0e0c8,        // 奶油色墙面
            wallTopColor: 0xdcc8a8,     // 墙顶/腰线色
            ceilingColor: 0xf8f0e0,     // 浅米色天花板
            doorColor: 0xc89060,        // 木门色
            frameColor: 0xa07040,       // 门框色
        },
        // 文案
        text: {
            alert: '！被盯上了！',
            caughtTitle: '被抱住了',
            caughtLives: (n) => n > 0
                ? `小橘猫黏住了你… 剩余 ${n} 条命`
                : '小橘猫黏住了你… 生命耗尽',
            loseText: '小橘猫黏住你不放，还是回家喂猫吧…',
            respawn: '重生',
            restart: '再来一局',
            exitOpenMsg: '电梯开了，快回家喂猫！',
            collectAllMsg: '碎片已收齐 · 路上小猫都让开，跑回电梯！',
            caughtHint: '被抓只是被小猫蹭一脸',
        },
    };
}
