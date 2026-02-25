/**
 * ThemeManager - Handles dynamic color theming
 * Allows users to pick custom primary/accent colors
 */

window.ThemeManager = {
    // Current theme colors
    colors: {
        primary: '#0088ff',      // Main blue
        primaryDim: '#0055aa',   // Darker blue
        primaryBright: '#00aaff', // Brighter blue
        accent: '#00ffff',        // Cyan
        accentDim: '#008888',     // Darker cyan
    },

    // Preserved colors (don't change with theme)
    fixedColors: {
        green: '#00ff66',
        yellow: '#ffdd00',
        orange: '#ff6600',
        red: '#ff2244',
        purple: '#aa00ff',
    },

    // Default theme
    defaultTheme: {
        primary: '#0088ff',
        accent: '#00ffff'
    },

    // Preset themes
    presets: {
        'Classic Blue': { primary: '#0088ff', accent: '#00ffff' },
        'Neon Pink': { primary: '#ff0088', accent: '#ff66cc' },
        'Cyber Green': { primary: '#00ff88', accent: '#88ffcc' },
        'Purple Haze': { primary: '#8800ff', accent: '#cc66ff' },
        'Sunset Orange': { primary: '#ff6600', accent: '#ffaa00' },
        'Blood Red': { primary: '#cc0033', accent: '#ff6666' },
        'Matrix': { primary: '#00ff00', accent: '#88ff88' },
    },

    init() {
        // Load saved theme from localStorage (immediate, no flash)
        const saved = localStorage.getItem('ai-theme');
        if (saved) {
            try {
                const theme = JSON.parse(saved);
                this.colors.primary = theme.primary || this.defaultTheme.primary;
                this.colors.accent = theme.accent || this.defaultTheme.accent;
            } catch (e) {
                console.warn('Failed to load saved theme:', e);
            }
        }

        // Generate derived colors
        this.updateDerivedColors();

        // Apply theme immediately (avoid flash of default colors)
        this.applyTheme();

        // Sync with server in background (server is authoritative across devices)
        this.loadFromServer();
    },

    loadFromServer() {
        fetch('/api/theme')
            .then(r => r.ok ? r.json() : null)
            .then(theme => {
                if (theme && theme.primary && theme.accent) {
                    this.colors.primary = theme.primary;
                    this.colors.accent = theme.accent;
                    this.updateDerivedColors();
                    this.applyTheme();
                    // Keep localStorage in sync
                    localStorage.setItem('ai-theme', JSON.stringify({
                        primary: theme.primary,
                        accent: theme.accent
                    }));
                }
            })
            .catch(() => {
                // Server unavailable — localStorage fallback already applied
            });
    },

    updateDerivedColors() {
        const p = this.colors.primary;
        const a = this.colors.accent;

        // Create dimmer versions (darker)
        this.colors.primaryDim = this.darkenColor(p, 0.4);
        this.colors.primaryBright = this.lightenColor(p, 0.3);
        this.colors.accentDim = this.darkenColor(a, 0.4);
    },

    darkenColor(hex, factor) {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return hex;
        return this.rgbToHex(
            Math.floor(rgb.r * (1 - factor)),
            Math.floor(rgb.g * (1 - factor)),
            Math.floor(rgb.b * (1 - factor))
        );
    },

    lightenColor(hex, factor) {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return hex;
        return this.rgbToHex(
            Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * factor)),
            Math.min(255, Math.floor(rgb.g + (255 - rgb.g) * factor)),
            Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * factor))
        );
    },

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    },

    rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => {
            const hex = x.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
    },

    setPrimaryColor(hex) {
        this.colors.primary = hex;
        this.updateDerivedColors();
        this.applyTheme();
        this.saveTheme();
    },

    setAccentColor(hex) {
        this.colors.accent = hex;
        this.updateDerivedColors();
        this.applyTheme();
        this.saveTheme();
    },

    applyPreset(presetName) {
        const preset = this.presets[presetName];
        if (preset) {
            this.colors.primary = preset.primary;
            this.colors.accent = preset.accent;
            this.updateDerivedColors();
            this.applyTheme();
            this.saveTheme();
        }
    },

    applyTheme() {
        const root = document.documentElement;

        // Update CSS variables
        root.style.setProperty('--blue', this.colors.primary);
        root.style.setProperty('--blue-dim', this.colors.primaryDim);
        root.style.setProperty('--blue-bright', this.colors.primaryBright);
        root.style.setProperty('--cyan', this.colors.accent);

        // Also set as RGB values for rgba() usage
        const primaryRgb = this.hexToRgb(this.colors.primary);
        const accentRgb = this.hexToRgb(this.colors.accent);

        if (primaryRgb) {
            root.style.setProperty('--blue-rgb', `${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}`);
        }
        if (accentRgb) {
            root.style.setProperty('--cyan-rgb', `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`);
        }

        // Dispatch event for other modules to react
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: this.colors }));
    },

    saveTheme() {
        const theme = { primary: this.colors.primary, accent: this.colors.accent };
        localStorage.setItem('ai-theme', JSON.stringify(theme));
        // Persist to server (best-effort)
        fetch('/api/theme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(theme),
        }).catch(() => {});
    },

    resetTheme() {
        this.colors.primary = this.defaultTheme.primary;
        this.colors.accent = this.defaultTheme.accent;
        this.updateDerivedColors();
        this.applyTheme();
        localStorage.setItem('ai-theme', JSON.stringify({
            primary: this.colors.primary,
            accent: this.colors.accent
        }));
        // Reset on server too
        fetch('/api/theme/reset', { method: 'POST' }).catch(() => {});
    },

    getCurrentTheme() {
        return {
            primary: this.colors.primary,
            accent: this.colors.accent,
            primaryDim: this.colors.primaryDim,
            primaryBright: this.colors.primaryBright,
        };
    }
};
