# OpenVoiceUI — Future Developments

Planned features and improvements tracked here. Items are roughly prioritized by impact vs effort.

---

## 🔐 Authentication & Access Control

### Visual Authentication (Camera-Based)
- Per-agent camera auth gate: only recognized faces can wake the agent
- Confidence threshold configurable per profile (currently hardcoded 50%)
- Multi-user household: register Mom, Dad, Child — each gets personalized greeting
- Age-appropriate agent access: child-safe agent only wakes for registered children

### Voice Authentication
- Speaker verification / voice fingerprinting
- Voice-print enrollment flow (record 3–5 sentences, build profile)
- Can gate wake activation to recognized voices only
- Pairs with camera auth for dual-factor "biometric wake"

### Full User Credential System
- Per-agent user management panel in Admin Dashboard
- Role-based access: owner / family / guest
- Registered users (under a Clerk account) can each have:
  - Face photo(s)
  - Voice print
  - Preferred agent(s)
  - Personalized greeting
  - Custom wake word
- Admin can set which agents each user can activate

### Conversation-Level Auth
- Require re-auth for sensitive tool calls (banking, home control, etc.)
- Session expiry + re-auth prompt
- "Lock" the agent mid-conversation

---

## 👥 Multi-User Household Features

### Person-Specific Personalization
- Greeting by recognized name: "Hey Dad, what's up?"
- Per-person conversation history / preferences stored server-side
- Agent can remember each person's preferences across sessions
- Profile switching based on who's recognized (Mom prefers different agent than Child)

### Presence Detection
- Passive camera monitoring: detect when someone approaches
- Auto-wake when registered person detected (no voice required)
- "Away mode" when no one recognized for N minutes

---

## 🎥 Vision System

### Biometric Face Recognition Library
- Replace current LLM-based face matching with proper biometric library
  (e.g. `deepface`, `insightface`, or `face_recognition` + dlib)
- Faster (local, no API call) and more accurate
- Enrollment: capture multiple angles, generate face embedding vector
- Recognition: cosine similarity against embedding database
- Reduces recognition from ~3s (LLM API) to ~100ms (local)

### Advanced Vision Capabilities
- Object detection and tracking (YOLO)
- Emotion detection from camera feed → affect agent mood/tone
- Gesture recognition (wave to wake, thumbs up to confirm, etc.)
- Document/whiteboard reading
- QR code / barcode scanning via camera

---

## 🔧 Admin Dashboard

### Face User Management Panel
- Dedicated admin panel tab: "Users & Faces"
- Add/remove household users
- Capture or upload multiple face photos per user
- Test recognition live in admin
- Set per-user permissions and preferred agents

### Agent Access Control Panel
- Per-agent: allowed users, blocked users
- Time-of-day restrictions ("kid agent" only 7am–9pm)
- Conversation log per user

### Full STT Settings Panel
- Silence timeout slider
- Continuous vs PTT toggle
- Wake word testing (live test button)
- Language/accent selection

---

## 🗣️ Voice & Conversation

### Multi-Language Support
- Detect spoken language automatically
- Switch TTS voice language to match
- Per-user preferred language

### Conversation Memory
- Long-term memory across sessions (summaries, preferences, facts)
- "Remember that I like..." → stored in user profile
- Briefing on session start: "Last time you asked about..."

### Interruption & Barge-In Polish
- Smarter interruption detection (voice activity vs noise)
- "Hold on" / pause command
- Resume from where it left off after interruption

---

## 🎵 Music & Media

### Spotify Integration (Full)
- OAuth login per user
- Play from personal library
- Playlist control
- "Play my morning playlist" → knows which user asked

### Music Recommendations
- Learn per-user taste
- "Play something like what I usually like"
- Genre/mood matching from conversation

---

## 🏠 Smart Home & IoT

### Home Automation Integration
- Home Assistant / MQTT bridge
- Control lights, locks, thermostats by voice
- Presence-triggered automations (arrive home → turn on lights)
- Per-user automations (Dad arrives → different scene than Mom)

---

## 🛠️ Infrastructure

### Local Vision Model Option
- Ollama + LLaVA for fully offline vision processing
- No API key required, no cost
- ~1–2s latency on modern hardware

### Multi-Instance / Multi-Room
- Run separate voice UI instances per room
- Central admin manages all instances
- Shared user/face database across instances

---

## Notes

- Items marked with no priority number are longer-term / post-v1
- Camera auth / visual auth is the highest-priority future auth feature
- The current face recognition (LLM-based) is intentionally temporary —
  upgrade path is to swap `routes/vision.py`'s `_call_vision()` for
  local biometric comparison once a library is selected
- Clerk handles INTERFACE auth; the user/face system above handles
  CONVERSATION-LEVEL and AGENT-LEVEL auth (different layers)
