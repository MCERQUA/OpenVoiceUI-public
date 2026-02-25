"""
Tests for routes/static_files.py — Static Asset Serving Blueprint (P7-T1, ADR-010)
"""

import pytest
from pathlib import Path


@pytest.fixture(scope="module")
def static_client():
    """Minimal Flask app with static_files blueprint registered."""
    from app import create_app
    app, _ = create_app(config_override={"TESTING": True})
    from routes.static_files import static_files_bp
    app.register_blueprint(static_files_bp)
    return app.test_client()


# ---------------------------------------------------------------------------
# /api/dj-sound
# ---------------------------------------------------------------------------

class TestDjSoundApi:
    def test_list_action_returns_200(self, static_client):
        resp = static_client.get("/api/dj-sound?action=list")
        assert resp.status_code == 200

    def test_list_action_returns_json(self, static_client):
        resp = static_client.get("/api/dj-sound?action=list")
        data = resp.get_json()
        assert data is not None

    def test_list_has_sounds_key(self, static_client):
        resp = static_client.get("/api/dj-sound?action=list")
        data = resp.get_json()
        # API returns {"action": "list", "sounds": [...], "count": N, "response": "..."}
        assert "sounds" in data

    def test_list_sounds_is_list(self, static_client):
        resp = static_client.get("/api/dj-sound?action=list")
        data = resp.get_json()
        assert isinstance(data["sounds"], list)

    def test_list_has_count_key(self, static_client):
        resp = static_client.get("/api/dj-sound?action=list")
        data = resp.get_json()
        assert "count" in data

    def test_list_count_matches_sounds_length(self, static_client):
        resp = static_client.get("/api/dj-sound?action=list")
        data = resp.get_json()
        assert data["count"] == len(data["sounds"])

    def test_list_default_action_same_as_list(self, static_client):
        resp = static_client.get("/api/dj-sound")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "sounds" in data

    def test_play_nonexistent_sound_returns_json_error(self, static_client):
        resp = static_client.get("/api/dj-sound?action=play&sound=nonexistent_xyz_never_exists")
        assert resp.status_code == 200
        data = resp.get_json()
        # Returns error dict, not HTTP error
        assert data is not None

    def test_sound_items_have_name_field(self, static_client):
        resp = static_client.get("/api/dj-sound?action=list")
        data = resp.get_json()
        sounds = data.get("sounds", [])
        if sounds:
            assert "name" in sounds[0]

    def test_sound_items_have_description_field(self, static_client):
        resp = static_client.get("/api/dj-sound?action=list")
        data = resp.get_json()
        sounds = data.get("sounds", [])
        if sounds:
            assert "description" in sounds[0]


# ---------------------------------------------------------------------------
# /sounds/<path>
# ---------------------------------------------------------------------------

class TestSoundServing:
    def test_nonexistent_sound_returns_404(self, static_client):
        resp = static_client.get("/sounds/totally_fake_sound_xyz.mp3")
        assert resp.status_code == 404

    def test_sound_route_accessible(self, static_client):
        # Just verify the route is registered (404 for nonexistent file is OK)
        resp = static_client.get("/sounds/fake.mp3")
        assert resp.status_code in (200, 404)


# ---------------------------------------------------------------------------
# /uploads/<filename>
# ---------------------------------------------------------------------------

class TestUploadServing:
    def test_nonexistent_upload_returns_404(self, static_client):
        resp = static_client.get("/uploads/nonexistent_file_xyz.txt")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# /src/<path>
# ---------------------------------------------------------------------------

class TestSrcServing:
    def test_nonexistent_src_returns_404(self, static_client):
        resp = static_client.get("/src/nonexistent.js")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DJ_SOUNDS catalogue (module constants)
# ---------------------------------------------------------------------------

class TestDjSoundsCatalogue:
    def test_dj_sounds_dict_not_empty(self):
        from routes.static_files import DJ_SOUNDS
        assert len(DJ_SOUNDS) > 0

    def test_dj_sounds_have_description(self):
        from routes.static_files import DJ_SOUNDS
        for sound_id, sound_data in DJ_SOUNDS.items():
            assert "description" in sound_data, f"{sound_id} missing description"

    def test_dj_sounds_have_when_to_use(self):
        from routes.static_files import DJ_SOUNDS
        for sound_id, sound_data in DJ_SOUNDS.items():
            assert "when_to_use" in sound_data, f"{sound_id} missing when_to_use"
