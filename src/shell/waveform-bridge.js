/**
 * waveform-bridge.js — Connect WaveformModule to EventBridge (P6-T4)
 *
 * Routes TTS_PLAYING/TTS_STOPPED and AUDIO_LEVEL events to the
 * waveform mouth animation system.
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md (App Shell section)
 */

import { AgentEvents } from '../core/EventBridge.js';

/**
 * Wire WaveformModule to the EventBridge.
 * @param {import('../core/EventBridge.js').EventBridge} bridge
 * @returns {Function[]} unsubscribe functions
 */
export function connectWaveform(bridge) {
    const wf = () => window.WaveformModule;

    const unsubs = [
        bridge.on(AgentEvents.TTS_PLAYING, () => {
            wf()?.setSpeaking(true);
        }),
        bridge.on(AgentEvents.TTS_STOPPED, () => {
            wf()?.setSpeaking(false);
        }),
        bridge.on(AgentEvents.AUDIO_LEVEL, ({ level }) => {
            wf()?.setAmplitude(level);
        }),
    ];

    return unsubs;
}
