/**
 * TTS Provider Registry
 * Manages available TTS providers and handles switching
 */
import { SupertonicProvider } from './SupertonicProvider.js';
import { HumeProvider } from './HumeProvider.js';

class TTSProviderRegistry {
    constructor() {
        this.providers = new Map();
        this.currentProvider = null;
        this.currentProviderId = null;
    }

    /**
     * Register a TTS provider
     * @param {string} id - Unique provider ID
     * @param {BaseTTSProvider} provider - Provider instance
     */
    register(id, provider) {
        this.providers.set(id, provider);
        console.log(`[TTSRegistry] Registered provider: ${id}`);
    }

    /**
     * Get a provider by ID
     * @param {string} id
     * @returns {BaseTTSProvider|null}
     */
    get(id) {
        return this.providers.get(id) || null;
    }

    /**
     * Get current provider
     * @returns {BaseTTSProvider|null}
     */
    getCurrent() {
        return this.currentProvider;
    }

    /**
     * Switch to a different provider
     * @param {string} id
     * @returns {boolean} Success
     */
    switchTo(id) {
        const provider = this.providers.get(id);
        if (!provider) {
            console.error(`[TTSRegistry] Provider not found: ${id}`);
            return false;
        }

        // Stop current provider if different
        if (this.currentProvider && this.currentProviderId !== id) {
            this.currentProvider.stop();
        }

        this.currentProvider = provider;
        this.currentProviderId = id;
        console.log(`[TTSRegistry] Switched to: ${id}`);
        return true;
    }

    /**
     * Get all registered provider IDs
     * @returns {string[]}
     */
    getProviderIds() {
        return Array.from(this.providers.keys());
    }

    /**
     * Speak text using current provider
     * @param {string} text
     * @param {object} options
     * @returns {Promise<boolean>}
     */
    async speak(text, options = {}) {
        if (!this.currentProvider) {
            console.error('[TTSRegistry] No provider selected');
            return false;
        }
        return this.currentProvider.speak(text, options);
    }

    /**
     * Stop current playback
     */
    stop() {
        if (this.currentProvider) {
            this.currentProvider.stop();
        }
    }

    /**
     * Set voice on current provider
     * @param {string} voice
     */
    setVoice(voice) {
        if (this.currentProvider) {
            this.currentProvider.setVoice(voice);
        }
    }

    /**
     * Get voices for current provider
     * @returns {string[]}
     */
    getVoices() {
        if (this.currentProvider) {
            return this.currentProvider.getVoices();
        }
        return [];
    }

    /**
     * Initialize all providers
     */
    async initAll(config) {
        // Create and register providers
        const supertonic = new SupertonicProvider(config);
        const hume = new HumeProvider(config);

        await supertonic.init();
        await hume.init();

        this.register('supertonic', supertonic);
        this.register('hume', hume);

        // Default to supertonic
        this.switchTo('supertonic');

        console.log('[TTSRegistry] All providers initialized');
    }
}

// Export singleton
export const ttsRegistry = new TTSProviderRegistry();
export default ttsRegistry;
