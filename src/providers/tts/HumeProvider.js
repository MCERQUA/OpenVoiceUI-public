/**
 * Hume TTS Provider
 * Hume EVI handles TTS internally - this is a passthrough provider
 * that works with HumeAdapter
 */
import { BaseTTSProvider } from './BaseTTSProvider.js';

export class HumeProvider extends BaseTTSProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'hume';
        this.serverUrl = config.serverUrl || '';
        this.configId = config.hume?.configId || '';
        this.voiceId = config.hume?.voiceId || '';
        this.voiceName = config.hume?.voiceName || 'Default';
        this.voices = [this.voiceName];  // Hume uses configured voice
        this.currentVoice = this.voiceName;

        // Hume handles its own audio - these are for external callbacks
        this.onSpeaking = null;
        this.onListening = null;
    }

    async init() {
        console.log('[Hume] Initializing...');
        // Get config info from backend
        try {
            const response = await fetch(`${this.serverUrl}/api/hume/token`);
            if (response.ok) {
                const data = await response.json();
                if (data.config_id) {
                    this.configId = data.config_id;
                }
            }
        } catch (error) {
            console.warn('[Hume] Could not fetch config:', error);
        }

        console.log('[Hume] Ready');
        return true;
    }

    /**
     * Hume handles TTS internally via WebSocket
     * This method is for standalone TTS calls (not via EVI)
     */
    async speak(text, options = {}) {
        console.warn('[Hume] speak() called - Hume normally handles TTS internally via EVI');
        // Hume TTS is handled by the EVI WebSocket connection
        // This is here for interface compatibility
        return false;
    }

    getVoices() {
        return this.voices;
    }

    setVoice(voiceName) {
        // Hume voice is configured on the backend
        console.log('[Hume] Voice configured on backend:', voiceName);
        this.currentVoice = voiceName;
    }

    isReady() {
        return true;
    }

    getCostPerMinute() {
        return 0.032;  // $0.032/minute
    }

    destroy() {
        // Nothing to clean up
    }
}

export default HumeProvider;
