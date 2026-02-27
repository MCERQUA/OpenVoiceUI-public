/**
 * SessionControl — Reset Conversation button and session management UI
 *
 * Provides a UI for resetting the conversation session:
 *   - Soft reset: increment session key only (history stays in server memory)
 *   - Hard reset: increment session key + clear all in-memory conversation history
 *
 * Usage:
 *   import { SessionControl } from './ui/SessionControl.js';
 *   const ctrl = new SessionControl({ serverUrl: '' });
 *   ctrl.mount(document.getElementById('session-control-root'));
 *
 * EventBus events emitted:
 *   'session:reset'  { old, new, mode }  — after successful reset
 *   'session:error'  { message }         — on reset failure
 *
 * ADR-009: simple manager pattern (no framework)
 */

import { eventBus } from '../core/EventBus.js';

export class SessionControl {
    /**
     * @param {object} opts
     * @param {string} [opts.serverUrl]  — base URL of Flask server (default: '')
     */
    constructor({ serverUrl = '' } = {}) {
        this.serverUrl = serverUrl;
        this._root = null;
        this._busy = false;
    }

    // ── Mount / Unmount ───────────────────────────────────────────────────────

    /**
     * Mount the SessionControl UI into a container element.
     * @param {HTMLElement} container
     */
    mount(container) {
        this._root = container;
        this._render();
    }

    /**
     * Destroy the component and clean up DOM.
     */
    destroy() {
        if (this._root) {
            this._root.innerHTML = '';
            this._root = null;
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    _render() {
        if (!this._root) return;
        this._root.innerHTML = `
            <div class="session-control">
                <div class="sc-header">
                    <span class="sc-title">Session</span>
                </div>
                <div class="sc-actions">
                    <button class="sc-btn sc-soft-btn" id="sc-soft-reset" title="Soft reset: start a new context window, keep server state">
                        🔄 Reset (Soft)
                    </button>
                    <button class="sc-btn sc-hard-btn" id="sc-hard-reset" title="Hard reset: start fresh — clear all conversation history">
                        ⚡ Reset (Hard)
                    </button>
                </div>
                <div class="sc-status" id="sc-status"></div>
                <div class="sc-confirm" id="sc-confirm" style="display:none;">
                    <div class="sc-confirm-msg" id="sc-confirm-msg"></div>
                    <div class="sc-confirm-btns">
                        <button class="sc-btn sc-confirm-yes" id="sc-confirm-yes">Confirm</button>
                        <button class="sc-btn sc-confirm-cancel" id="sc-confirm-cancel">Cancel</button>
                    </div>
                </div>
            </div>
        `;
        this._attachListeners();
    }

    _attachListeners() {
        const softBtn = this._root.querySelector('#sc-soft-reset');
        const hardBtn = this._root.querySelector('#sc-hard-reset');
        const cancelBtn = this._root.querySelector('#sc-confirm-cancel');
        const confirmBtn = this._root.querySelector('#sc-confirm-yes');

        if (softBtn) softBtn.addEventListener('click', () => this._confirmReset('soft'));
        if (hardBtn) hardBtn.addEventListener('click', () => this._confirmReset('hard'));
        if (cancelBtn) cancelBtn.addEventListener('click', () => this._hideConfirm());
        if (confirmBtn) confirmBtn.addEventListener('click', () => this._executeReset());

        // Close confirm on outside click
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this._hideConfirm();
        }, { once: false });
    }

    // ── Confirm dialog ────────────────────────────────────────────────────────

    _confirmReset(mode) {
        this._pendingMode = mode;
        const msgEl = this._root?.querySelector('#sc-confirm-msg');
        const confirmEl = this._root?.querySelector('#sc-confirm');
        if (!confirmEl) return;

        const msgs = {
            soft: 'Start a fresh conversation context? (Server history stays — this is quick.)',
            hard: 'Hard reset will clear ALL conversation history on the server. Are you sure?'
        };

        if (msgEl) msgEl.textContent = msgs[mode] || msgs.soft;
        confirmEl.style.display = 'block';
    }

    _hideConfirm() {
        const confirmEl = this._root?.querySelector('#sc-confirm');
        if (confirmEl) confirmEl.style.display = 'none';
        this._pendingMode = null;
    }

    // ── Reset execution ───────────────────────────────────────────────────────

    async _executeReset() {
        const mode = this._pendingMode || 'soft';
        this._hideConfirm();

        if (this._busy) return;
        this._busy = true;
        this._setStatus('Resetting…', 'pending');

        try {
            const res = await fetch(`${this.serverUrl}/api/session/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            const modeLabel = mode === 'hard' ? 'Hard' : 'Soft';
            this._setStatus(`${modeLabel} reset done.`, 'success');

            eventBus.emit('session:reset', {
                old: data.old,
                new: data.new,
                mode: data.mode
            });

            console.log(`[SessionControl] Reset ${mode}: ${data.old} → ${data.new}`);

            // Clear status after 3 s
            setTimeout(() => this._setStatus('', ''), 3000);

        } catch (err) {
            console.error('[SessionControl] Reset failed:', err);
            this._setStatus(`Reset failed: ${err.message}`, 'error');
            eventBus.emit('session:error', { message: `Session reset failed: ${err.message}` });
            setTimeout(() => this._setStatus('', ''), 4000);
        } finally {
            this._busy = false;
        }
    }

    _setStatus(text, state) {
        const el = this._root?.querySelector('#sc-status');
        if (!el) return;
        el.textContent = text;
        el.className = 'sc-status' + (state ? ` sc-status--${state}` : '');
    }

    // ── Static convenience ────────────────────────────────────────────────────

    /**
     * Perform a programmatic soft reset (no UI confirmation).
     * @param {string} [serverUrl]
     * @returns {Promise<object>} reset result
     */
    static async softReset(serverUrl = '') {
        const ctrl = new SessionControl({ serverUrl });
        ctrl._pendingMode = 'soft';
        return ctrl._executeReset();
    }

    /**
     * Perform a programmatic hard reset (no UI confirmation).
     * @param {string} [serverUrl]
     * @returns {Promise<object>} reset result
     */
    static async hardReset(serverUrl = '') {
        const ctrl = new SessionControl({ serverUrl });
        ctrl._pendingMode = 'hard';
        return ctrl._executeReset();
    }
}

// ── Global singleton for legacy/inline usage ──────────────────────────────────

/**
 * Global SessionControl helper — call from ActionConsole or AppShell inline handlers.
 * Usage:
 *   window.SessionControl.reset('soft')
 *   window.SessionControl.reset('hard')
 */
window.SessionControl = {
    _instance: null,

    /**
     * Mount a SessionControl into a container.
     * @param {HTMLElement} container
     * @param {string} [serverUrl]
     * @returns {SessionControl}
     */
    mount(container, serverUrl = '') {
        if (this._instance) this._instance.destroy();
        this._instance = new SessionControl({ serverUrl });
        this._instance.mount(container);
        return this._instance;
    },

    /**
     * Trigger a reset (soft or hard) programmatically, no UI confirmation.
     * @param {'soft'|'hard'} [mode]
     * @param {string} [serverUrl]
     */
    async reset(mode = 'soft', serverUrl = '') {
        if (mode === 'hard') {
            return SessionControl.hardReset(serverUrl);
        }
        return SessionControl.softReset(serverUrl);
    }
};

export default SessionControl;
