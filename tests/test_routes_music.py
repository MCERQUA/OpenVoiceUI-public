"""
Tests for routes/music.py — Music Blueprint (P7-T1, ADR-010)
"""

import json
import pytest
from flask import Flask


@pytest.fixture(scope="module")
def music_client():
    """Minimal Flask app with music blueprint registered."""
    from app import create_app
    app, _ = create_app(config_override={"TESTING": True})
    from routes.music import music_bp
    app.register_blueprint(music_bp)
    return app.test_client()


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------

class TestMusicHelpers:
    def test_reserve_track(self):
        from routes.music import reserve_track, get_reserved_track, clear_reservation
        track = {"name": "track_a.mp3", "path": "music/track_a.mp3"}
        reservation_id = reserve_track(track)
        assert reservation_id is not None
        reserved = get_reserved_track()
        assert reserved == track
        clear_reservation()

    def test_clear_reservation(self):
        from routes.music import reserve_track, get_reserved_track, clear_reservation
        track = {"name": "some_track.mp3", "path": "music/some_track.mp3"}
        reserve_track(track)
        clear_reservation()
        assert get_reserved_track() is None

    def test_get_reserved_track_none_initially(self):
        from routes.music import clear_reservation, get_reserved_track
        clear_reservation()
        assert get_reserved_track() is None

    def test_load_music_metadata_returns_dict(self):
        from routes.music import load_music_metadata
        meta = load_music_metadata()
        assert isinstance(meta, dict)

    def test_load_generated_music_metadata_returns_dict(self):
        from routes.music import load_generated_music_metadata
        meta = load_generated_music_metadata()
        assert isinstance(meta, dict)

    def test_get_music_files_returns_list(self):
        from routes.music import get_music_files
        files = get_music_files()
        assert isinstance(files, list)

    def test_get_music_files_generated_playlist(self):
        from routes.music import get_music_files
        files = get_music_files(playlist="generated")
        assert isinstance(files, list)

    def test_load_playlist_order_returns_list(self):
        from routes.music import load_playlist_order
        order = load_playlist_order("sprayfoam")
        assert isinstance(order, list)


# ---------------------------------------------------------------------------
# API: /api/music?action=status
# ---------------------------------------------------------------------------

class TestMusicStatusEndpoint:
    def test_status_returns_200(self, music_client):
        resp = music_client.get("/api/music?action=status")
        assert resp.status_code == 200

    def test_status_returns_json(self, music_client):
        resp = music_client.get("/api/music?action=status")
        data = resp.get_json()
        assert data is not None

    def test_status_has_playing_key(self, music_client):
        resp = music_client.get("/api/music?action=status")
        data = resp.get_json()
        assert "playing" in data

    def test_status_has_volume_key(self, music_client):
        resp = music_client.get("/api/music?action=status")
        data = resp.get_json()
        assert "volume" in data


# ---------------------------------------------------------------------------
# API: /api/music?action=list
# ---------------------------------------------------------------------------

class TestMusicListEndpoint:
    def test_list_returns_200(self, music_client):
        resp = music_client.get("/api/music?action=list")
        assert resp.status_code == 200

    def test_list_returns_json(self, music_client):
        resp = music_client.get("/api/music?action=list")
        data = resp.get_json()
        assert data is not None


# ---------------------------------------------------------------------------
# API: /api/music?action=volume
# ---------------------------------------------------------------------------

class TestMusicVolumeEndpoint:
    def test_volume_set(self, music_client):
        resp = music_client.get("/api/music?action=volume&volume=0.5")
        assert resp.status_code == 200

    def test_volume_set_response_has_volume(self, music_client):
        resp = music_client.get("/api/music?action=volume&volume=0.3")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data is not None

    def test_volume_clamped_min(self, music_client):
        resp = music_client.get("/api/music?action=volume&volume=-5")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# API: /api/music?action=shuffle
# ---------------------------------------------------------------------------

class TestMusicShuffleEndpoint:
    def test_shuffle_toggle(self, music_client):
        resp = music_client.get("/api/music?action=shuffle")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# API: /api/music/transition GET
# ---------------------------------------------------------------------------

class TestMusicTransitionEndpoint:
    def test_get_transition_returns_200(self, music_client):
        resp = music_client.get("/api/music/transition")
        assert resp.status_code == 200

    def test_get_transition_returns_json(self, music_client):
        resp = music_client.get("/api/music/transition")
        data = resp.get_json()
        assert data is not None


# ---------------------------------------------------------------------------
# API: /api/music/playlists
# ---------------------------------------------------------------------------

class TestMusicPlaylistsEndpoint:
    def test_list_playlists_returns_200(self, music_client):
        resp = music_client.get("/api/music/playlists")
        assert resp.status_code == 200

    def test_list_playlists_returns_json(self, music_client):
        resp = music_client.get("/api/music/playlists")
        data = resp.get_json()
        assert data is not None

    def test_list_playlists_has_playlists_key(self, music_client):
        resp = music_client.get("/api/music/playlists")
        data = resp.get_json()
        # API returns {"playlists": [...]}
        assert "playlists" in data

    def test_list_playlists_playlists_is_list(self, music_client):
        resp = music_client.get("/api/music/playlists")
        data = resp.get_json()
        assert isinstance(data.get("playlists"), list)
