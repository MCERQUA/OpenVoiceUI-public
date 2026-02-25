#!/usr/bin/env python3
"""
Test script for Supertonic TTS integration.
"""

import sys
import os
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

from supertonic_tts import SupertonicTTS


def test_supertonic():
    """Test Supertonic TTS functionality."""
    print("=" * 60)
    print("Testing Supertonic TTS Integration")
    print("=" * 60)
    
    try:
        # Initialize TTS
        print("\n[1/3] Initializing SupertonicTTS...")
        tts = SupertonicTTS(
            onnx_dir="/home/mike/supertonic/assets/onnx",
            voice_style_path="/home/mike/supertonic/assets/voice_styles/M1.json",
            use_gpu=False
        )
        print("✓ SupertonicTTS initialized successfully")
        
        # Generate speech
        print("\n[2/3] Generating speech from text...")
        test_text = "Hello world! This is a test of the Supertonic TTS system."
        audio_bytes = tts.generate_speech(
            text=test_text,
            lang='en',
            speed=1.05,
            total_step=5
        )
        print(f"✓ Generated {len(audio_bytes)} bytes of audio")
        
        # Save to file
        print("\n[3/3] Saving audio to file...")
        output_path = "/tmp/test_supertonic.wav"
        with open(output_path, 'wb') as f:
            f.write(audio_bytes)
        print(f"✓ Saved to {output_path}")
        
        # Check file
        file_size = os.path.getsize(output_path)
        print(f"\nTest Results:")
        print(f"  - File size: {file_size} bytes")
        print(f"  - Text: {test_text}")
        print(f"  - Language: en")
        print(f"  - Voice: M1 (male)")
        
        print("\n" + "=" * 60)
        print("SUCCESS: All tests passed!")
        print("=" * 60)
        return True
        
    except Exception as e:
        print(f"\n✗ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = test_supertonic()
    sys.exit(0 if success else 1)
