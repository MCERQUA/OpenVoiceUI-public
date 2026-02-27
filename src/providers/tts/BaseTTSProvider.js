/**
 * Base TTS Provider Interface
 * All TTS providers must implement these methods
 */
export class BaseTTSProvider {
    constructor(config = {}) {
        this.config = config;
        this.name = 'base';
        this.voices = [];
        this.currentVoice = null;
        this.isPlaying = false;
    }

    /**
     * Initialize the provider
     * @returns {Promise<boolean>} Success
     */
    async init() {
        throw new Error('init() must be implemented');
    }

    /**
     * Get available voices
     * @returns {string[]} Array of voice names
     */
    getVoices() {
        return this.voices;
    }

    /**
     * Set the current voice
     * @param {string} voiceName
     */
    setVoice(voiceName) {
        if (this.voices.includes(voiceName)) {
            this.currentVoice = voiceName;
        }
    }

    /**
     * Synthesize speech from text
     * @param {string} text - Text to speak
     * @param {object} options - Optional parameters
     * @returns {Promise<AudioBuffer|HTMLAudioElement|null>}
     */
    async speak(text, options = {}) {
        throw new Error('speak() must be implemented');
    }

    /**
     * Stop current playback
     */
    stop() {
        this.isPlaying = false;
    }

    /**
     * Check if provider is ready
     * @returns {boolean}
     */
    isReady() {
        return false;
    }

    /**
     * Get cost per minute (0 = free)
     * @returns {number}
     */
    getCostPerMinute() {
        return 0;
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.stop();
    }
}

export default BaseTTSProvider;
