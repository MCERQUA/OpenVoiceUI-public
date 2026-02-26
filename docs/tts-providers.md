# TTS Provider System

> Multi-provider Text-to-Speech architecture for flexible, cost-effective voice synthesis

## Overview

The TTS Provider System is a modular architecture that allows OpenVoiceUI to use multiple Text-to-Speech backends interchangeably.

Currently supported providers:
- **Supertonic TTS** (Active, Free) - Local ONNX-based TTS
- **Hume EVI** (Inactive) - Emotion-aware TTS with custom voice cloning

## Provider Comparison

| Provider | Status | Cost/Min | Quality | Latency | Voices | Languages |
|----------|--------|----------|---------|---------|--------|-----------|
| **Supertonic** | Active | $0.00 | High | Very Fast | 10 | 5 |
| **Hume EVI** | Inactive | $0.032 | High | Medium | 1 | 1 |

### Cost Examples

**Supertonic (Free)**:
- $0 per hour unlimited usage
- No API key required

**Hume EVI (Paid)**:
- $1.92 per hour
- Currently inactive due to cost


## Quick Start

### API Usage

```bash
# List providers
curl http://localhost:5001/api/tts/providers

# Generate speech
curl -X POST http://localhost:5001/api/tts/generate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello from OpenVoiceUI!",
    "provider": "supertonic",
    "voice": "M1",
    "lang": "en",
    "speed": 1.05
  }' \
  --output speech.wav
```

### Python Usage

```python
from tts_providers import get_provider, list_providers

# Get default provider (Supertonic)
provider = get_provider()
audio = provider.generate_speech("Hey yo!", voice="M1")

# Save to file
with open('output.wav', 'wb') as f:
    f.write(audio)
```

## Adding New Providers

### Step 1: Create Provider Class

Create `tts_providers/yourprovider_provider.py`:

```python
from .base_provider import TTSProvider

class YourProvider(TTSProvider):
    def generate_speech(self, text: str, **kwargs) -> bytes:
        # Your implementation
        return audio_bytes

    def list_voices(self):
        return ['voice1', 'voice2']

    def get_info(self):
        return {'name': 'YourProvider', 'status': 'active'}
```

### Step 2: Add to Configuration

Update `tts_providers/providers_config.json`:

```json
{
  "providers": {
    "yourprovider": {
      "name": "Your Provider",
      "cost_per_minute": 0.10,
      "status": "active"
    }
  }
}
```

### Step 3: Register

Update `tts_providers/__init__.py`:

```python
from .yourprovider_provider import YourProvider

_PROVIDERS = {
    'yourprovider': YourProvider,
    # ...
}
```

## Troubleshooting

### Provider Not Available
Check registration in `__init__.py` and restart server.

### Audio Generation Fails
Check logs: `journalctl -u openvoiceui -f`

### Voice Not Found
Use `provider.list_voices()` to see available voices.

## API Reference

### GET /api/tts/providers
Returns list of all providers with metadata.

### POST /api/tts/generate
Generate speech from text. Returns WAV audio.

**Request**: `{text, provider, voice, lang, speed, options}`

---

**Version**: 1.0.0
**Author**: OpenVoiceUI
