# Supertonic TTS Integration Guide for DJ-FoamBot

## Quick Start

This document describes the Supertonic TTS backend integration for DJ-FoamBot.

## What Was Added

### 1. Core Module: `supertonic_tts.py`
Main Python module for TTS functionality.

```python
from supertonic_tts import SupertonicTTS

tts = SupertonicTTS()
audio_bytes = tts.generate_speech("Hello World!", lang='en')
```

**Supported Parameters:**
- `text` (str): Text to synthesize (required)
- `lang` (str): Language code - 'en', 'ko', 'es', 'pt', 'fr' (default: 'en')
- `speed` (float): Speech speed 0.5-2.0 (default: 1.05)
- `total_step` (int): Inference quality steps (default: 5)

### 2. API Endpoint: `POST /api/supertonic-tts`
Flask REST API endpoint for TTS.

**Request:**
```json
{
  "text": "Text to synthesize",
  "lang": "en",
  "speed": 1.05,
  "voice_style": "M1"
}
```

**Response:**
- Success: WAV audio file (Content-Type: audio/wav)
- Error: JSON error with appropriate HTTP status

### 3. Test Script: `test_supertonic.py`
Verification script to test TTS setup.

## Installation

Dependencies are already in `requirements.txt`:
```bash
pip install -r requirements.txt
```

Models are pre-downloaded at:
- `/home/mike/supertonic/assets/onnx/` (ONNX models)
- `/home/mike/supertonic/assets/voice_styles/` (voice styles)

## Usage Examples

### Python API
```python
from supertonic_tts import SupertonicTTS

# Initialize (loads models)
tts = SupertonicTTS(
    onnx_dir="/home/mike/supertonic/assets/onnx",
    voice_style_path="/home/mike/supertonic/assets/voice_styles/M1.json"
)

# Generate speech
audio_bytes = tts.generate_speech(
    text="Welcome to Spray Foam Radio!",
    lang='en',
    speed=1.05,
    total_step=5
)

# Save to file
with open('speech.wav', 'wb') as f:
    f.write(audio_bytes)
```

### cURL API Call
```bash
curl -X POST http://localhost:5001/api/supertonic-tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "This is DJ-FoamBot speaking",
    "lang": "en",
    "speed": 1.05,
    "voice_style": "M1"
  }' \
  -o speech.wav
```

### JavaScript
```javascript
async function generateSpeech(text) {
  const response = await fetch('/api/supertonic-tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: text,
      lang: "en",
      speed: 1.05,
      voice_style: "M1"
    })
  });
  
  const audioBlob = await response.blob();
  const url = URL.createObjectURL(audioBlob);
  const audio = new Audio(url);
  audio.play();
}
```

## Voice Styles

| Voice | Gender | Style |
|-------|--------|-------|
| M1 | Male | Neutral (default) |
| M2 | Male | Variant 2 |
| M3 | Male | Variant 3 |
| M4 | Male | Variant 4 |
| M5 | Male | Variant 5 |
| F1 | Female | Neutral |
| F2 | Female | Variant 2 |
| F3 | Female | Variant 3 |
| F4 | Female | Variant 4 |
| F5 | Female | Variant 5 |

## Supported Languages

| Code | Language |
|------|----------|
| en | English |
| ko | Korean |
| es | Spanish |
| pt | Portuguese |
| fr | French |

## Performance Notes

- **First request**: Takes 5-10 seconds (models load into memory)
- **Subsequent requests**: 1-3 seconds depending on text length
- **CPU requirement**: ~4GB available RAM recommended
- **Speed parameter**: Higher = faster speech but may be less clear
- **Inference steps**: 5 is good balance; can reduce to 3 for faster output

## Integration with DJ-FoamBot

The TTS is integrated into the Flask server and can be called:

1. **From Hume EVI tools** (future): Add a tool that calls the endpoint
2. **From frontend**: Direct API calls to `/api/supertonic-tts`
3. **From DJ prompts**: Could extend DJ prompts to use TTS for announcements

## Troubleshooting

### Models not found
```
FileNotFoundError: .../onnx/duration_predictor.onnx
```
Check that Supertonic models are in `/home/mike/supertonic/assets/onnx/`

### Voice style not found
```
FileNotFoundError: .../voice_styles/M1.json
```
Check that voice styles are in `/home/mike/supertonic/assets/voice_styles/`

### OnnxRuntime error
```
ImportError: No module named 'onnxruntime'
```
Run: `pip install onnxruntime>=1.23.1`

### Out of memory
Reduce `total_step` parameter (default 5, try 3) or reduce text length

### Slow synthesis
Normal for first request. Verify system has ~4GB free RAM.

## Testing

Run the test script:
```bash
cd /path/to/websites/ai-eyes2
python3 test_supertonic.py
```

Expected output:
```
============================================================
Testing Supertonic TTS Integration
============================================================

[1/3] Initializing SupertonicTTS...
✓ SupertonicTTS initialized successfully

[2/3] Generating speech from text...
✓ Generated XXXXX bytes of audio

[3/3] Saving audio to file...
✓ Saved to /tmp/test_supertonic.wav

============================================================
SUCCESS: All tests passed!
============================================================
```

## Files Modified

- `supertonic_tts.py` - New, main TTS module (499 lines)
- `test_supertonic.py` - New, test script (75 lines)
- `server.py` - Added TTS initialization and /api/supertonic-tts endpoint
- `requirements.txt` - Already has dependencies

## Architecture

```
Request to /api/supertonic-tts
    ↓
Flask endpoint validates input
    ↓
SupertonicTTS.generate_speech()
    ↓
TextToSpeech inference pipeline:
  1. UnicodeProcessor normalizes text with language tags
  2. Duration predictor estimates phoneme durations
  3. Text encoder creates embeddings
  4. Vector estimator generates latent representation
  5. Vocoder synthesizes waveform
    ↓
Convert NumPy array to WAV bytes
    ↓
Return audio/wav response
```

## Future Enhancements

1. **GPU Acceleration**: Enable CUDA providers for faster inference
2. **Caching**: Cache common phrases to speed up responses
3. **Streaming**: Support chunked responses for real-time playback
4. **Hume Tool Integration**: Add as callable tool in Hume EVI config
5. **Quality Settings**: Expose total_step parameter in API
6. **Format Support**: Support MP3, OGG output formats

## Related Code

- Helper functions: `/home/mike/supertonic/py/helper.py`
- Example usage: `/home/mike/supertonic/py/example_onnx.py`
- Supertonic repo: `/home/mike/supertonic/`

## References

- [ONNX Runtime Docs](https://onnxruntime.ai/)
- [SoundFile Docs](https://soundfile.readthedocs.io/)
- [NumPy Docs](https://numpy.org/)
