/**
 * BaseVisualizer - Interface contract for swappable visualizer plugins
 *
 * Any visualizer that assigns to window.VisualizerModule must implement
 * all methods listed here. MusicModule and the app init code call these.
 *
 * To create a new visualizer:
 * 1. Copy this template
 * 2. Implement all methods
 * 3. Assign to window.VisualizerModule
 * 4. Load via <script src="..."> before the main app script
 */

window.BaseVisualizer = {
    name: 'Base',
    description: 'Template visualizer — does nothing. Override all methods.',

    enabled: true,
    autoplayEnabled: false,

    async init() {},
    async setupAnalyser() {},
    startAnimation() {},
    stopAnimation() {},
    setEnabled(enabled) { this.enabled = enabled; },
    setAutoplay(enabled) { this.autoplayEnabled = enabled; },
    onTrackEnded() {},
    updateToggleUI() {},
};
