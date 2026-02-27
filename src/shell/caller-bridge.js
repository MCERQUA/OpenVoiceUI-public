/**
 * caller-bridge.js — Connect caller phone effect to EventBridge (P6-T4)
 *
 * Only connected when the active adapter has 'caller_effects' capability.
 * Also blocks music sync during active caller skits.
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md (App Shell section)
 */

import { AgentEvents } from '../core/EventBridge.js';

/**
 * Wire caller phone effect to the EventBridge.
 * Only call this if the active adapter has 'caller_effects' capability.
 *
 * @param {import('../core/EventBridge.js').EventBridge} bridge
 * @param {string[]} capabilities - active adapter capabilities
 * @returns {Function[]} unsubscribe functions
 */
export function connectCallerEffect(bridge, capabilities) {
    if (!capabilities.includes('caller_effects')) return [];

    const unsubs = [
        bridge.on(AgentEvents.CALLER_EFFECT, ({ enabled }) => {
            window.setCallerEffect?.(enabled);

            // Block music sync during caller skit
            if (window.musicPlayer) {
                window.musicPlayer.syncBlocked = enabled;
            }
        }),
    ];

    return unsubs;
}
