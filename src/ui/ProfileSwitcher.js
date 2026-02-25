/**
 * ProfileSwitcher — Agent profile selector UI (P4-T6)
 *
 * Displays available agent profiles as clickable cards. Activating a profile:
 *   1. POSTs to /api/profiles/activate
 *   2. Applies UI settings (theme preset, face mode) locally
 *   3. Emits 'profile:switched' on EventBus so VoiceSession can reload
 *
 * Usage (standalone):
 *   import { ProfileSwitcher } from './ui/ProfileSwitcher.js';
 *   const switcher = new ProfileSwitcher();
 *   switcher.mount(document.getElementById('profile-switcher-root'));
 *
 * Usage (via SettingsPanel):
 *   SettingsPanel.open('profiles');
 *
 * EventBus events emitted:
 *   'profile:switched'  { profile }  — after successful activation
 *   'profile:error'     { message }  — on activation failure
 *
 * ADR-002: Profiles stored as JSON files, served via /api/profiles.
 * ADR-009: Simple manager pattern — no framework.
 */

import { eventBus } from '../core/EventBus.js';

export class ProfileSwitcher {
    constructor({ serverUrl = '' } = {}) {
        this.serverUrl = serverUrl;
        this._root = null;
        this._profiles = [];
        this._activeId = null;
        this._busy = false;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Mount the ProfileSwitcher UI into `container` (replaces contents).
     * @param {HTMLElement} container
     */
    async mount(container) {
        this._root = container;
        this._root.innerHTML = '<div class="ps-loading">Loading profiles\u2026</div>';
        await this._loadProfiles();
    }

    destroy() {
        if (this._root) {
            this._root.innerHTML = '';
            this._root = null;
        }
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    async _loadProfiles() {
        try {
            const resp = await fetch(`${this.serverUrl}/api/profiles`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this._profiles = data.profiles || [];
            this._activeId = data.active || null;
            this._render();
        } catch (err) {
            console.error('[ProfileSwitcher] Failed to load profiles:', err);
            if (this._root) {
                this._root.innerHTML = `<div class="ps-error">Failed to load profiles: ${this._esc(err.message)}</div>`;
            }
        }
    }

    // ── Rendering ─────────────────────────────────────────────────────────────

    _render() {
        if (!this._root) return;

        if (!this._profiles.length) {
            this._root.innerHTML = '<div class="ps-empty">No profiles found.</div>';
            return;
        }

        const cards = this._profiles.map(p => this._renderCard(p)).join('');
        this._root.innerHTML = `
            <div class="profile-switcher">
                <div class="ps-grid">${cards}</div>
                <div class="ps-status" id="ps-status"></div>
            </div>
        `;
        this._attachListeners();
    }

    _renderCard(profile) {
        const isActive = profile.id === this._activeId;
        const icon = this._esc(profile.icon || '🤖');
        const name = this._esc(profile.name || profile.id);
        const desc = this._esc(profile.description || '');
        const tts = this._esc(profile.voice?.tts_provider || '—');
        const voice = this._esc(profile.voice?.voice_id || '—');
        const llm = this._esc(profile.llm?.provider || '—');

        return `
            <button
                class="ps-card${isActive ? ' ps-card--active' : ''}"
                data-profile-id="${this._esc(profile.id)}"
                title="${isActive ? 'Currently active' : `Switch to ${name}`}"
                ${isActive ? 'aria-current="true"' : ''}
            >
                <div class="ps-card-icon">${icon}</div>
                <div class="ps-card-body">
                    <div class="ps-card-name">${name}${isActive ? ' <span class="ps-active-badge">active</span>' : ''}</div>
                    <div class="ps-card-desc">${desc}</div>
                    <div class="ps-card-meta">
                        <span class="ps-meta-item" title="LLM provider">${llm}</span>
                        <span class="ps-meta-sep">·</span>
                        <span class="ps-meta-item" title="TTS provider">${tts} / ${voice}</span>
                    </div>
                </div>
                ${isActive ? '<div class="ps-card-check">&#10003;</div>' : ''}
            </button>
        `;
    }

    // ── Events ────────────────────────────────────────────────────────────────

    _attachListeners() {
        if (!this._root) return;
        this._root.addEventListener('click', (e) => {
            const card = e.target.closest('.ps-card');
            if (!card || this._busy) return;
            const profileId = card.dataset.profileId;
            if (profileId && profileId !== this._activeId) {
                this._activate(profileId);
            }
        });
    }

    async _activate(profileId) {
        if (this._busy) return;
        this._busy = true;
        this._setStatus('Switching profile\u2026', 'pending');

        try {
            const resp = await fetch(`${this.serverUrl}/api/profiles/activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profile_id: profileId }),
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
                throw new Error(err.error || `HTTP ${resp.status}`);
            }

            const data = await resp.json();
            const profile = data.profile || {};

            this._activeId = profileId;

            // Apply UI settings from the profile
            this._applyProfileUI(profile);

            // Re-render cards to update active state
            const cards = this._profiles.map(p => this._renderCard(p)).join('');
            const grid = this._root?.querySelector('.ps-grid');
            if (grid) grid.innerHTML = cards;
            this._attachListeners();

            this._setStatus(`Switched to ${profile.name || profileId}`, 'success');
            setTimeout(() => this._setStatus('', ''), 3000);

            eventBus.emit('profile:switched', { profile });
            console.log(`[ProfileSwitcher] Activated: ${profileId}`);

        } catch (err) {
            console.error('[ProfileSwitcher] Activate failed:', err);
            this._setStatus(`Failed: ${err.message}`, 'error');
            eventBus.emit('profile:error', { message: err.message });
            setTimeout(() => this._setStatus('', ''), 4000);
        } finally {
            this._busy = false;
        }
    }

    /**
     * Apply UI-related profile settings immediately (theme preset, face mode).
     * TTS/LLM provider changes take effect on the next conversation turn
     * (server reads the active profile before each Gateway call).
     * @param {object} profile
     */
    _applyProfileUI(profile) {
        const ui = profile.ui || {};

        // Apply theme preset if ThemeManager is available
        const themePreset = ui.theme_preset;
        if (themePreset && window.ThemeManager?.applyPreset) {
            window.ThemeManager.applyPreset(themePreset);
        }

        // Apply face mood if FaceRenderer is available
        const faceMood = ui.face_mood;
        if (faceMood && window.FaceRenderer?.setMood) {
            window.FaceRenderer.setMood(faceMood);
        }

        // Toggle face visibility
        if (typeof ui.face_enabled === 'boolean' && window.FaceRenderer?.setEnabled) {
            window.FaceRenderer.setEnabled(ui.face_enabled);
        }
    }

    _setStatus(text, state) {
        const el = this._root?.querySelector('#ps-status');
        if (!el) return;
        el.textContent = text;
        el.className = 'ps-status' + (state ? ` ps-status--${state}` : '');
    }

    _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

export default ProfileSwitcher;
