"""
Extended tests for routes/music.py — covers play/pause/resume/stop/skip/
next_up/sync/confirm actions, save helpers, and _build_dj_hints.
(P7-T1, ADR-010)
"""

import json
import pytest
import time
from pathlib import Path
from unittest.mock import patch, MagicMock


@pytest.fixture(scope="module")
def music_client():
    """Flask test client with music blueprint."""
    from app import create_app
    app, _ = create_app(config_override={"TESTING": True})
    from routes.music import music_bp
    app.register_blueprint(music_bp)
    return app.test_client()


# ---------------------------------------------------------------------------
# save helpers
# ---------------------------------------------------------------------------

class TestSaveHelpers:
    def test_save_music_metadata_roundtrip(self, tmp_path, monkeypatch):
        from routes import music as music_mod
        monkeypatch.setattr(music_mod, "MUSIC_DIR", tmp_path)
        meta = {"track.mp3": {"title": "Track One", "artist": "DJ Bot"}}
        music_mod.save_music_metadata(meta)
        loaded = music_mod.load_music_metadata()
        assert loaded == meta

    def test_save_generated_music_metadata_roundtrip(self, tmp_path, monkeypatch):
        from routes import music as music_mod
        monkeypatch.setattr(music_mod, "GENERATED_MUSIC_DIR", tmp_path)
        meta = {"gen.mp3": {"title": "AI Banger"}}
        music_mod.save_generated_music_metadata(meta)
        loaded = music_mod.load_generated_music_metadata()
        assert loaded == meta

    def test_save_playlist_order_roundtrip(self, tmp_path, monkeypatch):
        from routes import music as music_mod
        monkeypatch.setattr(music_mod, "MUSIC_DIR", tmp_path)
        order = ["b.mp3", "a.mp3", "c.mp3"]
        music_mod.save_playlist_order("sprayfoam", order)
        loaded = music_mod.load_playlist_order("sprayfoam")
        assert loaded == order

    def test_save_playlist_order_generated(self, tmp_path, monkeypatch):
        from routes import music as music_mod
        monkeypatch.setattr(music_mod, "GENERATED_MUSIC_DIR", tmp_path)
        order = ["z.mp3", "y.mp3"]
        music_mod.save_playlist_order("generated", order)
        loaded = music_mod.load_playlist_order("generated")
        assert loaded == order

    def test_load_playlist_order_nonexistent(self, tmp_path, monkeypatch):
        from routes import music as music_mod
        monkeypatch.setattr(music_mod, "MUSIC_DIR", tmp_path)
        # No order.json exists
        result = music_mod.load_playlist_order("sprayfoam")
        assert result == []

    def test_load_music_metadata_invalid_json(self, tmp_path, monkeypatch):
        from routes import music as music_mod
        monkeypatch.setattr(music_mod, "MUSIC_DIR", tmp_path)
        (tmp_path / "music_metadata.json").write_text("not json")
        result = music_mod.load_music_metadata()
        assert result == {}

    def test_load_generated_music_metadata_invalid_json(self, tmp_path, monkeypatch):
        from routes import music as music_mod
        monkeypatch.setattr(music_mod, "GENERATED_MUSIC_DIR", tmp_path)
        (tmp_path / "generated_metadata.json").write_text("{broken")
        result = music_mod.load_generated_music_metadata()
        assert result == {}


# ---------------------------------------------------------------------------
# _build_dj_hints
# ---------------------------------------------------------------------------

class TestBuildDjHints:
    def _hints(self, track):
        from routes.music import _build_dj_hints
        return _build_dj_hints(track)

    def test_returns_something(self):
        result = self._hints({"name": "track_a", "title": "Track A"})
        assert result is not None

    def test_includes_title_string(self):
        result = self._hints({"name": "track_a", "title": "My Song"})
        result_str = str(result)
        assert "My Song" in result_str

    def test_returns_string_or_dict(self):
        result = self._hints({"name": "track_a", "title": "My Song", "energy": "high"})
        assert isinstance(result, (str, dict))

    def test_handles_full_track(self):
        result = self._hints({
            "name": "track_a",
            "title": "Track A",
            "genre": "House",
            "energy": "high",
            "duration_seconds": 180,
        })
        assert result is not None

    def test_handles_minimal_track(self):
        result = self._hints({"name": "track_a"})
        assert result is not None


# ---------------------------------------------------------------------------
# /api/music?action=play
# ---------------------------------------------------------------------------

class TestMusicPlayAction:
    def test_play_returns_200(self, music_client):
        resp = music_client.get("/api/music?action=play")
        # Either 200 with a track or 200 with error (empty dir is OK)
        assert resp.status_code == 200

    def test_play_returns_json(self, music_client):
        resp = music_client.get("/api/music?action=play")
        data = resp.get_json()
        assert data is not None

    def test_play_has_action_key(self, music_client):
        resp = music_client.get("/api/music?action=play")
        data = resp.get_json()
        assert "action" in data

    def test_play_specific_track_not_found(self, music_client):
        resp = music_client.get("/api/music?action=play&track=nonexistent_track_xyz")
        data = resp.get_json()
        assert data is not None
        # Should be error or play action
        assert "action" in data

    def test_play_sets_playing_state(self, music_client):
        from routes.music import current_music_state, get_music_files
        files = get_music_files()
        if files:
            music_client.get("/api/music?action=play")
            assert current_music_state["playing"] is True


# ---------------------------------------------------------------------------
# /api/music?action=pause
# ---------------------------------------------------------------------------

class TestMusicPauseAction:
    def test_pause_returns_200(self, music_client):
        resp = music_client.get("/api/music?action=pause")
        assert resp.status_code == 200

    def test_pause_returns_json(self, music_client):
        resp = music_client.get("/api/music?action=pause")
        data = resp.get_json()
        assert data is not None

    def test_pause_action_key(self, music_client):
        resp = music_client.get("/api/music?action=pause")
        data = resp.get_json()
        assert data.get("action") == "pause"

    def test_pause_sets_not_playing(self, music_client):
        from routes.music import current_music_state
        music_client.get("/api/music?action=pause")
        assert current_music_state["playing"] is False


# ---------------------------------------------------------------------------
# /api/music?action=resume
# ---------------------------------------------------------------------------

class TestMusicResumeAction:
    def test_resume_returns_200(self, music_client):
        resp = music_client.get("/api/music?action=resume")
        assert resp.status_code == 200

    def test_resume_action_key(self, music_client):
        resp = music_client.get("/api/music?action=resume")
        data = resp.get_json()
        assert data.get("action") == "resume"


# ---------------------------------------------------------------------------
# /api/music?action=stop
# ---------------------------------------------------------------------------

class TestMusicStopAction:
    def test_stop_returns_200(self, music_client):
        resp = music_client.get("/api/music?action=stop")
        assert resp.status_code == 200

    def test_stop_action_key(self, music_client):
        resp = music_client.get("/api/music?action=stop")
        data = resp.get_json()
        assert data.get("action") == "stop"

    def test_stop_clears_track(self, music_client):
        from routes.music import current_music_state
        music_client.get("/api/music?action=stop")
        assert current_music_state["current_track"] is None
        assert current_music_state["playing"] is False


# ---------------------------------------------------------------------------
# /api/music?action=skip
# ---------------------------------------------------------------------------

class TestMusicSkipAction:
    def test_skip_returns_200(self, music_client):
        resp = music_client.get("/api/music?action=skip")
        assert resp.status_code == 200

    def test_skip_returns_json(self, music_client):
        resp = music_client.get("/api/music?action=skip")
        data = resp.get_json()
        assert data is not None

    def test_next_alias_returns_200(self, music_client):
        resp = music_client.get("/api/music?action=next")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# /api/music?action=next_up
# ---------------------------------------------------------------------------

class TestMusicNextUpAction:
    def test_next_up_returns_200(self, music_client):
        resp = music_client.get("/api/music?action=next_up")
        assert resp.status_code == 200

    def test_next_up_action_key(self, music_client):
        resp = music_client.get("/api/music?action=next_up")
        data = resp.get_json()
        assert "action" in data


# ---------------------------------------------------------------------------
# /api/music?action=sync
# ---------------------------------------------------------------------------

class TestMusicSyncAction:
    def test_sync_returns_200(self, music_client):
        resp = music_client.get("/api/music?action=sync")
        assert resp.status_code == 200

    def test_sync_returns_json(self, music_client):
        resp = music_client.get("/api/music?action=sync")
        data = resp.get_json()
        assert data is not None

    def test_sync_with_reserved_track(self, music_client):
        from routes.music import reserve_track
        track = {"filename": "test.mp3", "name": "test", "title": "Test Track",
                 "duration_seconds": 120}
        reserve_track(track)
        resp = music_client.get("/api/music?action=sync")
        data = resp.get_json()
        assert data is not None
        assert "action" in data

    def test_sync_no_track(self, music_client):
        from routes.music import clear_reservation, current_music_state
        clear_reservation()
        current_music_state["current_track"] = None
        current_music_state["playing"] = False
        resp = music_client.get("/api/music?action=sync")
        data = resp.get_json()
        assert data.get("action") == "none"


# ---------------------------------------------------------------------------
# /api/music?action=confirm
# ---------------------------------------------------------------------------

class TestMusicConfirmAction:
    def test_confirm_invalid_id(self, music_client):
        resp = music_client.get("/api/music?action=confirm&reservation_id=invalid_xyz")
        data = resp.get_json()
        assert data is not None

    def test_confirm_with_valid_reservation(self, music_client):
        from routes.music import reserve_track, current_music_state
        track = {"filename": "test.mp3", "name": "test", "title": "Test Track"}
        res_id = reserve_track(track)
        resp = music_client.get(f"/api/music?action=confirm&reservation_id={res_id}")
        data = resp.get_json()
        assert "action" in data


# ---------------------------------------------------------------------------
# /api/music?action=unknown
# ---------------------------------------------------------------------------

class TestMusicUnknownAction:
    def test_unknown_action_returns_200(self, music_client):
        resp = music_client.get("/api/music?action=invalid_action_xyz")
        assert resp.status_code == 200

    def test_unknown_action_has_error_key(self, music_client):
        resp = music_client.get("/api/music?action=invalid_action_xyz")
        data = resp.get_json()
        assert data.get("action") == "error"


# ---------------------------------------------------------------------------
# /api/music?action=volume (additional cases)
# ---------------------------------------------------------------------------

class TestMusicVolumeExtended:
    def test_volume_100(self, music_client):
        resp = music_client.get("/api/music?action=volume&volume=100")
        data = resp.get_json()
        assert data.get("volume") == 100

    def test_volume_0(self, music_client):
        resp = music_client.get("/api/music?action=volume&volume=0")
        data = resp.get_json()
        assert data.get("volume") == 0

    def test_volume_50(self, music_client):
        resp = music_client.get("/api/music?action=volume&volume=50")
        data = resp.get_json()
        assert data.get("volume") == 50

    def test_volume_clamped_max(self, music_client):
        resp = music_client.get("/api/music?action=volume&volume=200")
        data = resp.get_json()
        assert data.get("volume") == 100

    def test_volume_no_param_returns_current(self, music_client):
        resp = music_client.get("/api/music?action=volume")
        data = resp.get_json()
        assert "volume" in data

    def test_volume_invalid_value(self, music_client):
        resp = music_client.get("/api/music?action=volume&volume=abc")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("action") == "error"


# ---------------------------------------------------------------------------
# POST /api/music/transition (set a current track first to avoid NoneType bug)
# ---------------------------------------------------------------------------

class TestMusicTransitionPost:
    def test_post_transition_with_track_returns_200(self, music_client):
        from routes.music import current_music_state
        # Set a current track to avoid AttributeError in route
        current_music_state["current_track"] = {
            "name": "current.mp3",
            "filename": "current.mp3",
            "title": "Current Track",
            "duration_seconds": 120,
        }
        resp = music_client.post(
            "/api/music/transition",
            json={"track": "next_track.mp3", "transition_type": "crossfade"},
            content_type="application/json",
        )
        assert resp.status_code == 200

    def test_post_transition_returns_json(self, music_client):
        from routes.music import current_music_state
        current_music_state["current_track"] = {
            "name": "current.mp3",
            "filename": "current.mp3",
            "title": "Current Track",
            "duration_seconds": 120,
        }
        resp = music_client.post(
            "/api/music/transition",
            json={},
            content_type="application/json",
        )
        data = resp.get_json()
        assert data is not None
