/**
 * sounds-bridge.js — Connect DJ/caller sounds to EventBridge (P6-T4)
 *
 * Routes PLAY_SOUND events to the DJ soundboard or caller sound player.
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md (App Shell section)
 */

import { AgentEvents } from '../core/EventBridge.js';

/**
 * Wire sound effects to the EventBridge.
 * @param {import('../core/EventBridge.js').EventBridge} bridge
 * @returns {Function[]} unsubscribe functions
 */
export function connectSounds(bridge) {
    const unsubs = [
        bridge.on(AgentEvents.PLAY_SOUND, ({ sound, type }) => {
            if (type === 'dj') {
                window.DJSoundboard?.play(sound);
            } else if (type === 'caller') {
                window.playCallerSound?.(sound);
            }
        }),
    ];

    return unsubs;
}
