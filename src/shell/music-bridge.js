/**
 * music-bridge.js — Connect MusicModule to EventBridge (P6-T4)
 *
 * Handles music play/pause/stop/skip, volume ducking during speech,
 * and DJ track-ending notifications back to the agent.
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md (App Shell section)
 */

import { AgentEvents, AgentActions } from '../core/EventBridge.js';

/**
 * Wire MusicModule to the EventBridge.
 * @param {import('../core/EventBridge.js').EventBridge} bridge
 * @returns {Function[]} unsubscribe functions
 */
export function connectMusic(bridge) {
    const music = () => window.musicPlayer;

    const unsubs = [
        // Agent-driven music control
        bridge.on(AgentEvents.MUSIC_PLAY, ({ action, track }) => {
            if (!music()) return;
            if (action === 'stop')  music().stop?.();
            else if (action === 'pause') music().pause?.();
            else if (action === 'play')  music().play?.(track);
            else if (action === 'skip')  music().next?.();
        }),

        // Agent triggers server-side music sync
        bridge.on(AgentEvents.MUSIC_SYNC, () => {
            window.syncMusicWithServer?.();
        }),

        // Volume ducking when agent speaks
        bridge.on(AgentEvents.STATE_CHANGED, ({ state }) => {
            music()?.duck?.(state === 'speaking');
        }),
    ];

    // DJ track-ending notifications (tell agent when track is ending)
    if (music()) {
        music().onTrackEnding = (trackName, secondsLeft) => {
            bridge.emit(AgentActions.CONTEXT_UPDATE, {
                text: `[DJ INFO: "${trackName}" has ${secondsLeft}s left]`,
            });
            bridge.emit(AgentActions.FORCE_MESSAGE, {
                text: `[SYSTEM: Song ending! Announce next track and call play_music action=skip!]`,
            });
        };

        music().onTrackEnded = (trackName) => {
            bridge.emit(AgentActions.FORCE_MESSAGE, {
                text: `[SYSTEM: "${trackName}" ended! Call play_music action=skip NOW!]`,
            });
        };
    }

    return unsubs;
}
