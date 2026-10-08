// ============================================================
// auth.js - 游客 / NodeLoc 登录 + 速通榜
// ============================================================

const GUEST_NAME_KEY = 'ss-guest-name';
const LOGIN_MODE_KEY = 'ss-login-mode';

export class Auth {
    constructor() {
        this.mode = 'nl'; // guest | nl
        this.oauthUser = null;
        this.oauthEnabled = true;
        this.loginUrl = '/oauth/nodeloc';
        this.board = [];

        this.els = {
            modeGuest: document.getElementById('login-mode-guest'),
            modeNl: document.getElementById('login-mode-nl'),
            guestPanel: document.getElementById('guest-login-panel'),
            nlPanel: document.getElementById('nl-login-panel'),
            nameInput: document.getElementById('name-input'),
            btnNodeLoc: document.getElementById('btn-nodeloc'),
            oauthSession: document.getElementById('oauth-session'),
            oauthStatus: document.getElementById('oauth-status'),
            btnLogout: document.getElementById('btn-oauth-logout'),
            loginHint: document.getElementById('login-hint'),
            menuErr: document.getElementById('menu-err'),
            boardList: document.getElementById('speedrun-board'),
            startBtn: document.getElementById('start-btn'),
            winSubmit: document.getElementById('win-submit-msg'),
        };

        this._bind();
        this._restoreMode();
        this.refreshSession();
        this.refreshBoard();
        this._handleOauthQuery();
    }

    _bind() {
        this.els.modeGuest?.addEventListener('click', () => this.setMode('guest'));
        this.els.modeNl?.addEventListener('click', () => this.setMode('nl'));
        this.els.btnNodeLoc?.addEventListener('click', () => {
            location.href = this.loginUrl || '/oauth/nodeloc';
        });
        this.els.btnLogout?.addEventListener('click', () => this.logout());
        this.els.nameInput?.addEventListener('input', () => {
            if (this.mode !== 'guest') return;
            const n = this.els.nameInput.value.trim().slice(0, 12);
            try { localStorage.setItem(GUEST_NAME_KEY, n); } catch { /* ignore */ }
        });
    }

    _restoreMode() {
        let mode = 'nl';
        try { mode = localStorage.getItem(LOGIN_MODE_KEY) || 'nl'; } catch { /* ignore */ }
        if (mode !== 'guest' && mode !== 'nl') mode = 'nl';
        this.setMode(mode, false);
        try {
            const g = localStorage.getItem(GUEST_NAME_KEY) || '';
            if (this.els.nameInput && mode === 'guest') this.els.nameInput.value = g;
        } catch { /* ignore */ }
    }

    _handleOauthQuery() {
        const qs = new URLSearchParams(location.search);
        if (qs.get('oauth_error')) {
            this.setMode('nl', false);
            this.setError(qs.get('oauth_error'));
        }
        if (qs.get('oauth') === '1') {
            this.setMode('nl', false);
            if (qs.get('name') && this.els.nameInput) {
                this.els.nameInput.value = qs.get('name').slice(0, 12);
            }
        }
        if (qs.has('oauth') || qs.has('oauth_error') || qs.has('name')) {
            const url = new URL(location.href);
            url.searchParams.delete('oauth');
            url.searchParams.delete('oauth_error');
            url.searchParams.delete('name');
            history.replaceState(null, '', url.pathname + url.search + url.hash);
        }
    }

    setMode(mode, persist = true) {
        this.mode = mode === 'nl' ? 'nl' : 'guest';
        if (persist) {
            try { localStorage.setItem(LOGIN_MODE_KEY, this.mode); } catch { /* ignore */ }
        }

        this.els.modeGuest?.classList.toggle('active', this.mode === 'guest');
        this.els.modeNl?.classList.toggle('active', this.mode === 'nl');
        this.els.modeGuest?.setAttribute('aria-selected', this.mode === 'guest' ? 'true' : 'false');
        this.els.modeNl?.setAttribute('aria-selected', this.mode === 'nl' ? 'true' : 'false');
        this.els.guestPanel?.classList.toggle('hidden', this.mode !== 'guest');
        this.els.nlPanel?.classList.toggle('hidden', this.mode !== 'nl');

        if (this.mode === 'guest') {
            if (this.els.nameInput) {
                this.els.nameInput.readOnly = false;
                try {
                    this.els.nameInput.value = localStorage.getItem(GUEST_NAME_KEY) || '';
                } catch { /* ignore */ }
                this.els.nameInput.placeholder = '游客昵称（可选）';
            }
            this.setHint('游客可直接游玩；成绩不会写入速通榜。');
        } else {
            this.syncSiteName();
            if (this.els.nameInput) {
                this.els.nameInput.readOnly = true;
                this.els.nameInput.placeholder = 'NodeLoc 站点昵称（登录后自动填入）';
            }
            if (this.isNlLoggedIn()) {
                this.setHint('已登录 NodeLoc · 通关后自动以站点昵称上榜。');
            } else {
                this.setHint('请先 NodeLoc 登录；上榜名称强制使用站点昵称。');
            }
        }
        this.setError('');
        this._syncStartBtn();
        this._syncOauthUi();
    }

    setHint(text) {
        if (this.els.loginHint) this.els.loginHint.textContent = text || '';
    }

    setError(text) {
        if (this.els.menuErr) this.els.menuErr.textContent = text || '';
    }

    isNlLoggedIn() {
        return !!(this.oauthUser && this.oauthUser.id != null);
    }

    siteName() {
        if (!this.isNlLoggedIn()) return '';
        return String(this.oauthUser.username || this.oauthUser.name || '').slice(0, 12);
    }

    playerName() {
        if (this.mode === 'nl') return this.siteName();
        const n = (this.els.nameInput?.value || '').trim().slice(0, 12);
        return n || '游客';
    }

    canStart() {
        if (this.mode === 'guest') return true;
        return this.isNlLoggedIn();
    }

    syncSiteName() {
        const n = this.siteName();
        if (this.els.nameInput && this.mode === 'nl') {
            this.els.nameInput.value = n;
        }
    }

    _syncOauthUi() {
        const loggedIn = this.isNlLoggedIn();
        if (this.els.btnNodeLoc) {
            this.els.btnNodeLoc.classList.toggle('hidden', loggedIn || this.mode !== 'nl');
            this.els.btnNodeLoc.disabled = !this.oauthEnabled;
            this.els.btnNodeLoc.textContent = this.oauthEnabled ? 'NodeLoc 登录' : '登录未配置';
        }
        if (this.els.oauthSession) {
            this.els.oauthSession.classList.toggle('hidden', !(loggedIn && this.mode === 'nl'));
        }
        if (this.els.oauthStatus && loggedIn) {
            this.els.oauthStatus.textContent = `NodeLoc · ${this.siteName()}`;
        }
    }

    _syncStartBtn() {
        const btn = this.els.startBtn;
        if (!btn) return;
        const ok = this.canStart();
        btn.disabled = !ok;
        const hint = btn.querySelector('.btn-hint');
        if (hint) {
            hint.textContent = this.mode === 'nl' && !ok ? '需先登录 NodeLoc' : '';
            hint.classList.toggle('hidden', !(this.mode === 'nl' && !ok));
        }
    }

    async refreshSession() {
        try {
            const res = await fetch('/api/oauth/me', { credentials: 'same-origin' });
            const data = await res.json();
            this.oauthEnabled = data.enabled !== false;
            if (data.loginUrl) this.loginUrl = data.loginUrl;
            if (data.loggedIn && data.user) {
                this.oauthUser = data.user;
                if (this.mode === 'nl') this.syncSiteName();
            } else {
                this.oauthUser = null;
            }
        } catch {
            // 静态打开时无后端，保持游客可用
            this.oauthEnabled = false;
        }
        this._syncOauthUi();
        this._syncStartBtn();
        if (this.mode === 'nl') {
            this.setHint(
                this.isNlLoggedIn()
                    ? '已登录 NodeLoc · 通关后自动以站点昵称上榜。'
                    : (this.oauthEnabled
                        ? '请先 NodeLoc 登录；上榜名称强制使用站点昵称。'
                        : 'NodeLoc 登录未配置，请改用游客或检查服务端环境变量。')
            );
        }
    }

    async logout() {
        try {
            await fetch('/api/oauth/logout', { method: 'POST', credentials: 'same-origin' });
        } catch { /* ignore */ }
        this.oauthUser = null;
        if (this.els.nameInput && this.mode === 'nl') this.els.nameInput.value = '';
        this._syncOauthUi();
        this._syncStartBtn();
        this.setHint('请先 NodeLoc 登录；上榜名称强制使用站点昵称。');
    }

    async refreshBoard() {
        try {
            const res = await fetch('/api/leaderboard', { credentials: 'same-origin' });
            const data = await res.json();
            if (data && data.ok && Array.isArray(data.board)) {
                this.board = data.board;
                this.renderBoard();
            }
        } catch {
            if (this.els.boardList) {
                this.els.boardList.innerHTML = '<div class="board-empty">排行榜暂不可用（需通过 npm start 启动）</div>';
            }
        }
    }

    renderBoard(list) {
        const rows = list || this.board;
        const el = this.els.boardList;
        if (!el) return;
        if (!rows.length) {
            el.innerHTML = '<div class="board-empty">暂无纪录 · NodeLoc 通关后上榜</div>';
            return;
        }
        const head = '<div class="brow head"><span>#</span><span>玩家</span><span>用时</span></div>';
        const body = rows.map((r, i) => {
            const rank = i + 1;
            const cls = rank <= 3 ? ` top${rank}` : '';
            return `<div class="brow${cls}"><span>${rank}</span><span class="bn">${escapeHtml(r.n)}</span><span class="bt">${escapeHtml(r.tf)}</span></div>`;
        }).join('');
        el.innerHTML = head + body;
    }

    /**
     * 通关后提交成绩（仅 NL 模式且已登录）
     * @param {number} timeSeconds
     * @param {{ cheated?: boolean }} opts
     */
    async submitRun(timeSeconds, opts = {}) {
        const msgEl = this.els.winSubmit;
        const setMsg = (t, cls = '') => {
            if (!msgEl) return;
            msgEl.textContent = t;
            msgEl.className = 'win-submit-msg' + (cls ? ' ' + cls : '');
        };

        if (opts.cheated) {
            setMsg('本局使用了隐藏指令，成绩未上榜。', 'warn');
            return null;
        }
        if (this.mode !== 'nl' || !this.isNlLoggedIn()) {
            setMsg('游客模式不计入速通榜。切换 NodeLoc 登录可上榜。', 'muted');
            return null;
        }

        setMsg('正在提交成绩…');
        try {
            const res = await fetch('/api/leaderboard/submit', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timeMs: Math.round(timeSeconds * 1000) }),
            });
            const data = await res.json();
            if (!data.ok) {
                setMsg(data.error || '提交失败', 'warn');
                return data;
            }
            if (Array.isArray(data.board)) {
                this.board = data.board;
                this.renderBoard();
            }
            setMsg(
                data.improved
                    ? `新纪录！${data.bestTime} · 已以 ${data.name} 上榜`
                    : `已提交 ${data.submitted} · 个人最佳仍为 ${data.bestTime}`,
                data.improved ? 'ok' : 'muted'
            );
            return data;
        } catch {
            setMsg('提交失败：无法连接服务器', 'warn');
            return null;
        }
    }
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
