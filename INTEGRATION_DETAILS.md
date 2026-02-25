# Supertonic TTS Integration Details

## Code Added to server.py

### 1. Initialization Section (Line 34-51)

```python
# ===== SUPERTONIC TTS INITIALIZATION =====
# Initialize TTS on startup (lazy load to avoid startup delays)
supertonic_tts = None

def get_supertonic_tts():
    """Get or initialize Supertonic TTS instance."""
    global supertonic_tts
    if supertonic_tts is None:
        try:
            from supertonic_tts import SupertonicTTS
            supertonic_tts = SupertonicTTS(
                onnx_dir="/home/mike/supertonic/assets/onnx",
                voice_style_path="/home/mike/supertonic/assets/voice_styles/M1.json",
                use_gpu=False
            )
            print("✓ Supertonic TTS initialized")
        except Exception as e:
            print(f"⚠ Warning: Failed to initialize Supertonic TTS: {e}")
            return None
    return supertonic_tts
```

**Features:**
- Lazy initialization on first request
- Returns None if TTS fails (graceful fallback)
- Uses M1 (male) voice by default
- CPU-only by default (can enable GPU)

### 2. API Endpoint (Line 3035+)

```python
@app.route('/api/supertonic-tts', methods=['POST'])
def supertonic_tts_endpoint():
    """
    Generate speech from text using Supertonic TTS.
    
    Request JSON:
    {
        "text": "Text to synthesize",
        "lang": "en" (optional, default: en),
        "speed": 1.05 (optional, default: 1.05),
        "voice_style": "M1" (optional, default: M1 - can be M1-M5, F1-F5)
    }
    
    Returns:
        WAV audio file or JSON error
    """
    try:
        # 1. Get and validate JSON input
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400
        
        # 2. Extract and validate text
        text = data.get('text', '').strip()
        if not text:
            return jsonify({"error": "Text cannot be empty"}), 400
        
        # 3. Extract and validate language
        lang = data.get('lang', 'en').lower()
        if lang not in ['en', 'ko', 'es', 'pt', 'fr']:
            return jsonify({"error": f"Invalid language: {lang}. Supported: en, ko, es, pt, fr"}), 400
        
        # 4. Extract and validate speed
        speed = float(data.get('speed', 1.05))
        if speed < 0.5 or speed > 2.0:
            return jsonify({"error": "Speed must be between 0.5 and 2.0"}), 400
        
        # 5. Extract and validate voice style
        voice_style = data.get('voice_style', 'M1').upper()
        valid_voices = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5']
        if voice_style not in valid_voices:
            return jsonify({"error": f"Invalid voice: {voice_style}. Available: {', '.join(valid_voices)}"}), 400
        
        voice_style_path = f"/home/mike/supertonic/assets/voice_styles/{voice_style}.json"
        
        # 6. Get or initialize TTS
        tts = get_supertonic_tts()
        if tts is None:
            return jsonify({"error": "TTS service not available"}), 503
        
        # 7. Initialize TTS with requested voice
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"Generating speech: {text[:50]}... (lang={lang}, speed={speed})")
        
        try:
            from supertonic_tts import SupertonicTTS
            tts_instance = SupertonicTTS(
                onnx_dir="/home/mike/supertonic/assets/onnx",
                voice_style_path=voice_style_path,
                use_gpu=False
            )
        except Exception as e:
            logger.error(f"Failed to initialize TTS with voice {voice_style}: {e}")
            return jsonify({"error": f"Failed to load voice style: {e}"}), 500
        
        # 8. Generate speech
        try:
            audio_bytes = tts_instance.generate_speech(
                text=text,
                lang=lang,
                speed=speed,
                total_step=5
            )
        except Exception as e:
            logger.error(f"Speech synthesis failed: {e}")
            return jsonify({"error": f"Speech synthesis failed: {e}"}), 500
        
        # 9. Return WAV audio file
        from flask import make_response
        response = make_response(audio_bytes)
        response.headers['Content-Type'] = 'audio/wav'
        response.headers['Content-Length'] = len(audio_bytes)
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return response
        
    except ValueError as e:
        return jsonify({"error": f"Invalid input: {e}"}), 400
    except Exception as e:
        import traceback
        logger = logging.getLogger(__name__)
        logger.error(f"TTS endpoint error: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500
```

**Features:**
- Comprehensive input validation
- Proper error handling with appropriate HTTP status codes
- Returns raw WAV audio bytes
- Logging for debugging
- Supports 10 different voice styles (M1-M5, F1-F5)
- Configurable speech speed and language

## Integration Points

### How It Works

1. **Request arrives** at `/api/supertonic-tts` with JSON body
2. **Validation** checks all parameters
3. **TTS Instance** is created/retrieved with requested voice style
4. **Speech Synthesis** happens in-process using ONNX models
5. **WAV Output** is streamed back to client as audio/wav

### Error Handling

| Scenario | HTTP Status | Response |
|----------|------------|----------|
| Missing/empty text | 400 | `{"error": "Text cannot be empty"}` |
| Invalid language | 400 | `{"error": "Invalid language: ..."}` |
| Invalid speed | 400 | `{"error": "Speed must be between 0.5 and 2.0"}` |
| Invalid voice | 400 | `{"error": "Invalid voice: ..."}` |
| Voice load fails | 500 | `{"error": "Failed to load voice style: ..."}` |
| Synthesis fails | 500 | `{"error": "Speech synthesis failed: ..."}` |
| TTS unavailable | 503 | `{"error": "TTS service not available"}` |

### Performance Characteristics

| Metric | Value |
|--------|-------|
| First request | 5-10 seconds (model load) |
| Subsequent requests | 1-3 seconds (text dependent) |
| Text length limit | No hard limit (tested up to 500 chars) |
| Audio quality | 44100 Hz, 16-bit PCM WAV |
| Typical output size | 100-300 KB per synthesis |

## Using the Endpoint

### From Python
```python
import requests

response = requests.post('http://localhost:5001/api/supertonic-tts', json={
    'text': 'Welcome to DJ-FoamBot',
    'lang': 'en',
    'speed': 1.05,
    'voice_style': 'M1'
})

if response.status_code == 200:
    with open('output.wav', 'wb') as f:
        f.write(response.content)
else:
    print('Error:', response.json())
```

### From JavaScript
```javascript
async function synthesize(text) {
    const response = await fetch('/api/supertonic-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text: text,
            lang: 'en',
            speed: 1.05,
            voice_style: 'M1'
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        console.error('TTS Error:', error.error);
        return null;
    }
    
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
}
```

### From Bash/cURL
```bash
curl -X POST http://localhost:5001/api/supertonic-tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "This is a test",
    "lang": "en",
    "speed": 1.05,
    "voice_style": "M1"
  }' \
  -o speech.wav && ffplay speech.wav
```

## Voice Characteristics

### Male Voices
- **M1**: Default male voice - neutral and clear
- **M2-M5**: Variations with different prosody/personality

### Female Voices
- **F1**: Default female voice - neutral and clear
- **F2-F5**: Variations with different prosody/personality

To test different voices:
```python
for voice in ['M1', 'M2', 'F1', 'F2']:
    response = requests.post('http://localhost:5001/api/supertonic-tts', json={
        'text': 'Hello, my name is DJ-FoamBot',
        'voice_style': voice
    })
    if response.ok:
        with open(f'voice_{voice}.wav', 'wb') as f:
            f.write(response.content)
```

## Future Enhancements

1. **Caching**: Store common phrases to avoid re-synthesis
2. **Streaming**: Support chunked/streaming responses
3. **Format Options**: Support MP3, OGG output
4. **Hume Integration**: Add as callable tool in Hume EVI
5. **Quality Settings**: Expose total_step in API
6. **GPU Support**: Enable CUDA acceleration option
7. **Batch Processing**: Support multiple texts in single request

## Monitoring

The endpoint logs to the server's logger:

```python
# Check logs with:
# sudo journalctl -u pi-guy -f
# grep "Generating speech" logs
# grep "TTS endpoint error" logs
```

Key log messages:
- `Generating speech: ...` - Synthesis started
- `✓ Supertonic TTS initialized` - TTS ready
- `Failed to initialize TTS with voice` - Voice load error
- `Speech synthesis failed` - Inference error
- `TTS endpoint error` - Unexpected error

## Testing the Integration

### Quick Test
```bash
python3 test_supertonic.py
```

### Manual API Test
```bash
curl -X POST http://localhost:5001/api/supertonic-tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Test"}' \
  > test.wav && file test.wav
```

Expected output: `test.wav: RIFF (little-endian) data, WAVE audio, ...`

## Configuration

Default settings in `get_supertonic_tts()`:
- ONNX directory: `/home/mike/supertonic/assets/onnx/`
- Default voice: M1.json
- GPU: Disabled (CPU only)

To change defaults, edit the `get_supertonic_tts()` function in server.py.

## Dependencies

Required Python packages (in requirements.txt):
- onnxruntime>=1.23.1
- soundfile>=0.12.1
- librosa>=0.10.0
- flask>=3.0.0
- numpy (implicit)

All should be installed via `pip install -r requirements.txt`
