/**
 * profile-discovery.js — Adapter auto-discovery from profiles (P6-T5)
 *
 * ProfileDiscovery fetches agent profiles from the server, resolves which
 * adapter each profile requires, registers every profile as an orchestrator
 * mode, and activates the initial mode (from localStorage or server default).
 *
 * This implements the "plug-and-play" promise from the multi-agent framework:
 *   Adding a new agent = 1 adapter file + 1 profile JSON entry.
 *   ProfileDiscovery does the rest automatically.
 *
 * Integration:
 *   1. Call `await profileDiscovery.init({ serverUrl })` at app startup.
 *   2. All profiles → orchestrator modes are registered automatically.
 *   3. ProfileSwitcher's 'profile:switched' event triggers adapter hot-swap.
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md
 *      "Adding a New Agent System (The Plug-and-Play Promise)"
 *
 * Usage:
 *   import { profileDiscovery } from './profile-discovery.js';
 *   await profileDiscovery.init({ serverUrl: 'http://localhost:5001' });
 *   // Orchestrator is now registered with all adapters — call switchMode, start, etc.
 */

import { orchestrator }    from './orchestrator.js';
import { adapterRegistry } from './adapter-registry.js';
import { eventBus }        from '../core/EventBus.js';

// ─────────────────────────────────────────────────────────────────────────────
// ProfileDiscovery
// ─────────────────────────────────────────────────────────────────────────────

class ProfileDiscovery {
    constructor() {
        /** @type {string} */
        this._serverUrl = '';

        /** @type {object[]} — Raw profile objects from /api/profiles */
        this._profiles = [];

        /** @type {string|null} — Active profile ID reported by the server */
        this._serverActiveId = null;

        /** @type {boolean} */
        this._initialized = false;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Fetch profiles, load adapter modules, register each profile as an
     * orchestrator mode, and activate the initial mode.
     *
     * Errors in individual adapter registrations are non-fatal: other adapters
     * are still registered. A total failure falls back to the clawdbot adapter.
     *
     * @param {object}  options
     * @param {string}  options.serverUrl      - Base URL of the backend
     * @param {string} [options.fallbackMode]  - Adapter ID used if everything fails
     */
    async init({ serverUrl = '', fallbackMode = 'clawdbot' } = {}) {
        this._serverUrl = serverUrl;

        try {
            await this._fetchProfiles();
            await this._registerAllAdapters();
            await this._activateInitialMode(fallbackMode);
        } catch (err) {
            console.error('[ProfileDiscovery] Init failed:', err);
            // Best-effort fallback: register and activate clawdbot directly
            try {
                await this._registerFallback(fallbackMode);
                await orchestrator.switchMode(fallbackMode);
            } catch (e) {
                console.error('[ProfileDiscovery] Fallback registration also failed:', e);
            }
        }

        this._initialized = true;

        // Listen for profile-switch events emitted by ProfileSwitcher UI
        eventBus.on('profile:switched', (d) => this._onProfileSwitched(d.profile));

        console.log('[ProfileDiscovery] Initialised. Known modes:', Object.keys(orchestrator._adapters));
    }

    /**
     * Return the raw profile list fetched from the server.
     * @returns {object[]}
     */
    get profiles() {
        return this._profiles;
    }

    /**
     * Return the currently active profile ID.
     * Reads from the orchestrator's active mode (source of truth at runtime).
     * @returns {string|null}
     */
    get activeId() {
        return orchestrator.activeMode;
    }

    /**
     * Return true after init() has completed (successfully or via fallback).
     * @returns {boolean}
     */
    get initialized() {
        return this._initialized;
    }

    // ── Private: bootstrap ────────────────────────────────────────────────────

    /**
     * Fetch /api/profiles and store the result.
     * @private
     */
    async _fetchProfiles() {
        const resp = await fetch(`${this._serverUrl}/api/profiles`);
        if (!resp.ok) {
            throw new Error(`/api/profiles returned HTTP ${resp.status}`);
        }
        const data = await resp.json();
        this._profiles      = data.profiles || [];
        this._serverActiveId = data.active   || null;

        console.log(
            `[ProfileDiscovery] Fetched ${this._profiles.length} profile(s),`,
            `server active: "${this._serverActiveId}"`
        );
    }

    /**
     * For each profile, dynamically import its adapter and register the
     * profile as an orchestrator mode.
     *
     * Profile → orchestrator mode mapping:
     *   - mode key  = profile.id            (e.g. 'pi-guy', 'hume-evi')
     *   - adapter   = profile.adapter       (e.g. 'clawdbot', 'hume-evi')
     *   - config    = profile.adapter_config (adapter-specific params from JSON)
     *     plus serverUrl and profileId injected automatically.
     *
     * Adapter modules are cached by AdapterRegistry, so multiple profiles
     * sharing the same adapter (e.g. three ClawdBot profiles) only trigger
     * one dynamic import.
     *
     * @private
     */
    async _registerAllAdapters() {
        for (const profile of this._profiles) {
            const adapterId = profile.adapter || adapterRegistry.defaultAdapter;
            const modeKey   = profile.id;
            const config    = {
                ...(profile.adapter_config || {}),
                // Always inject serverUrl so adapters don't need to hardcode it
                serverUrl:  (profile.adapter_config?.serverUrl) || this._serverUrl,
                // profileId lets adapters read the full profile server-side if needed
                profileId: profile.id,
            };

            try {
                const adapter = await adapterRegistry.load(adapterId);
                orchestrator.register(modeKey, adapter, config);
                console.log(
                    `[ProfileDiscovery] Registered mode "${modeKey}"`,
                    `→ adapter "${adapterId}"`
                );
            } catch (err) {
                console.warn(
                    `[ProfileDiscovery] Could not register mode "${modeKey}"`,
                    `(adapter "${adapterId}"):`, err.message
                );
                // Continue with remaining profiles — non-fatal
            }
        }
    }

    /**
     * Decide which mode to activate at startup.
     *
     * Priority:
     *   1. localStorage 'agent_mode' (user's last manual selection)
     *   2. Server-reported active profile
     *   3. fallbackMode parameter
     *
     * @param {string} fallbackMode
     * @private
     */
    async _activateInitialMode(fallbackMode) {
        const saved  = this._readSavedMode();
        const target = saved || this._serverActiveId || fallbackMode;

        // Make sure target mode is registered (saved mode might be stale)
        const registered = Object.keys(orchestrator._adapters);
        const resolvedTarget = registered.includes(target)
            ? target
            : (this._serverActiveId || fallbackMode);

        if (resolvedTarget !== target) {
            console.warn(
                `[ProfileDiscovery] Saved mode "${target}" not registered;`,
                `falling back to "${resolvedTarget}"`
            );
        }

        try {
            await orchestrator.switchMode(resolvedTarget);
        } catch (err) {
            console.error(
                `[ProfileDiscovery] Could not activate mode "${resolvedTarget}":`, err
            );
            // Last resort: try the raw fallback
            if (resolvedTarget !== fallbackMode && registered.includes(fallbackMode)) {
                await orchestrator.switchMode(fallbackMode);
            }
        }
    }

    /**
     * Register the fallback adapter without needing a profile entry.
     * Used when _fetchProfiles fails entirely.
     * @param {string} adapterId
     * @private
     */
    async _registerFallback(adapterId) {
        const adapter = await adapterRegistry.load(adapterId);
        orchestrator.register(adapterId, adapter, { serverUrl: this._serverUrl });
        console.log(`[ProfileDiscovery] Registered fallback mode "${adapterId}"`);
    }

    /**
     * Read the saved agent mode from localStorage, returning null on error.
     * @returns {string|null}
     * @private
     */
    _readSavedMode() {
        try {
            return localStorage.getItem('agent_mode') || null;
        } catch (_) {
            return null;
        }
    }

    // ── Private: runtime profile switching ───────────────────────────────────

    /**
     * Called when the ProfileSwitcher UI emits 'profile:switched'.
     * Switches the orchestrator to the new profile's adapter mode.
     *
     * If the new profile was not in the initial fetch (e.g. dynamically
     * created), it is registered on-the-fly before switching.
     *
     * @param {object} profile - The newly-activated profile object from the server
     * @private
     */
    async _onProfileSwitched(profile) {
        if (!profile?.id) return;

        const modeKey   = profile.id;
        const adapterId = profile.adapter || adapterRegistry.defaultAdapter;

        console.log(
            `[ProfileDiscovery] 'profile:switched' → mode "${modeKey}"`,
            `adapter "${adapterId}"`
        );

        // Register on-the-fly if not already known (handles dynamically-created profiles)
        if (!orchestrator._adapters[modeKey]) {
            try {
                const adapter = await adapterRegistry.load(adapterId);
                orchestrator.register(modeKey, adapter, {
                    ...(profile.adapter_config || {}),
                    serverUrl: this._serverUrl,
                    profileId: profile.id,
                });
                console.log(`[ProfileDiscovery] On-the-fly registered mode "${modeKey}"`);
            } catch (err) {
                console.error(
                    `[ProfileDiscovery] Failed to register mode "${modeKey}" on-the-fly:`, err
                );
                return;
            }
        }

        try {
            await orchestrator.switchMode(modeKey);
        } catch (err) {
            console.error(
                `[ProfileDiscovery] Failed to switch orchestrator to "${modeKey}":`, err
            );
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

export const profileDiscovery = new ProfileDiscovery();

// Also export class for testing
export { ProfileDiscovery };
