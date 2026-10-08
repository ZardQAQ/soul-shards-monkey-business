// ============================================================
// input.js - 键盘/鼠标输入处理
// 维护按键状态 Map，提供查询接口
// ============================================================

export class Input {
    constructor() {
        this.keys = new Map();          // 当前按下状态
        this.justPressed = new Map();   // 本帧刚按下
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
    }

    _onKeyDown(e) {
        // 阻止 WASD 等键的默认行为（避免滚动条滚动）
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyZ',
             'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
            e.preventDefault();
        }
        if (!this.keys.get(e.code)) {
            this.justPressed.set(e.code, true);
        }
        this.keys.set(e.code, true);
    }

    _onKeyUp(e) {
        this.keys.set(e.code, false);
    }

    /** 查询某键是否当前按下 */
    isDown(code) {
        return !!this.keys.get(code);
    }

    /** 查询某键是否本帧刚按下（仅在调用帧返回 true 一次） */
    consumePressed(code) {
        const v = this.justPressed.get(code);
        this.justPressed.set(code, false);
        return !!v;
    }

    /** 每帧结束前调用，清空 justPressed */
    endFrame() {
        this.justPressed.clear();
    }

    dispose() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
    }
}
