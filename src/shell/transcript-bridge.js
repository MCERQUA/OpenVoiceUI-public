/**
 * transcript-bridge.js — Connect TranscriptPanel and ActionConsole to EventBridge (P6-T4)
 *
 * Routes message/transcript events to the transcript panel and
 * tool/lifecycle events to the action console.
 *
 * Ref: future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md (App Shell section)
 */

import { AgentEvents } from '../core/EventBridge.js';

/**
 * Wire TranscriptPanel to the EventBridge.
 * @param {import('../core/EventBridge.js').EventBridge} bridge
 * @returns {Function[]} unsubscribe functions
 */
export function connectTranscript(bridge) {
    const tp = () => window.TranscriptPanel;

    const unsubs = [
        bridge.on(AgentEvents.MESSAGE, ({ role, text, final }) => {
            if (!tp()) return;
            if (final) tp().addMessage(role, text);
            else tp().updateStreaming?.(text);
        }),
        bridge.on(AgentEvents.TRANSCRIPT, ({ text }) => {
            tp()?.updateStreaming?.(text);
        }),
    ];

    return unsubs;
}

/**
 * Wire ActionConsole to the EventBridge.
 * @param {import('../core/EventBridge.js').EventBridge} bridge
 * @returns {Function[]} unsubscribe functions
 */
export function connectActionConsole(bridge) {
    const ac = () => window.ActionConsole;

    const unsubs = [
        bridge.on(AgentEvents.TOOL_CALLED, ({ name, result }) => {
            ac()?.addEntry('tool', name, JSON.stringify(result ?? ''));
        }),
        bridge.on(AgentEvents.CONNECTED, () => {
            ac()?.addEntry('lifecycle', 'Agent connected');
        }),
        bridge.on(AgentEvents.DISCONNECTED, () => {
            ac()?.addEntry('lifecycle', 'Agent disconnected');
        }),
        bridge.on(AgentEvents.ERROR, ({ message }) => {
            ac()?.addEntry('error', `Agent error: ${message}`);
        }),
        bridge.on(AgentEvents.STATE_CHANGED, ({ state }) => {
            ac()?.addEntry('system', `State: ${state}`);
        }),
    ];

    return unsubs;
}
