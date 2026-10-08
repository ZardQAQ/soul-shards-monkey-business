// ============================================================
// main.js - 程序入口
// 等待 DOM 加载完成后创建 Game 实例并启动
// ============================================================

import { Game } from './game.js';

// 等待 DOM 准备就绪后启动游戏
window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    game.start();
    // 将 game 挂载到 window，便于在控制台调试
    window.__game = game;
});
