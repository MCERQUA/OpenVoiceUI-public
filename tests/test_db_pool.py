"""
Tests for services/db_pool.py — SQLite WAL mode + connection pool (P7-T1, ADR-010)
"""

import sqlite3
import tempfile
import threading
from pathlib import Path

import pytest

from services.db_pool import SQLitePool


@pytest.fixture
def tmp_db(tmp_path):
    """Return a fresh SQLitePool backed by a temp file."""
    db_path = tmp_path / "test.db"
    pool = SQLitePool(str(db_path), pool_size=3)
    yield pool
    pool.close()


# ---------------------------------------------------------------------------
# Pool creation & WAL mode
# ---------------------------------------------------------------------------

class TestPoolCreation:
    def test_pool_creates_file(self, tmp_path):
        db_path = tmp_path / "fresh.db"
        pool = SQLitePool(str(db_path))
        assert db_path.exists()
        pool.close()

    def test_pool_uses_wal_mode(self, tmp_db):
        with tmp_db.get_connection() as conn:
            row = conn.execute("PRAGMA journal_mode").fetchone()
            assert row[0] == "wal"

    def test_custom_pool_size(self, tmp_path):
        db_path = tmp_path / "sized.db"
        pool = SQLitePool(str(db_path), pool_size=2)
        assert pool.pool_size == 2
        pool.close()


# ---------------------------------------------------------------------------
# get_connection context manager
# ---------------------------------------------------------------------------

class TestGetConnection:
    def test_get_connection_yields_sqlite_conn(self, tmp_db):
        with tmp_db.get_connection() as conn:
            assert isinstance(conn, sqlite3.Connection)

    def test_connection_returned_to_pool_after_use(self, tmp_db):
        with tmp_db.get_connection() as conn:
            conn.execute("SELECT 1")
        # Getting another connection should work (pool not exhausted)
        with tmp_db.get_connection() as conn2:
            assert conn2 is not None

    def test_multiple_connections_concurrent(self, tmp_db):
        """Verify pool can handle concurrent reads."""
        results = []

        def read_task():
            with tmp_db.get_connection() as conn:
                row = conn.execute("SELECT 42").fetchone()
                results.append(row[0])

        threads = [threading.Thread(target=read_task) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert results == [42, 42, 42]


# ---------------------------------------------------------------------------
# execute (write)
# ---------------------------------------------------------------------------

class TestExecute:
    def test_execute_creates_table_and_inserts(self, tmp_db):
        tmp_db.execute("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, val TEXT)")
        tmp_db.execute("INSERT INTO items (val) VALUES (?)", ("hello",))
        rows = tmp_db.query("SELECT val FROM items")
        assert rows == [("hello",)]

    def test_execute_returns_cursor(self, tmp_db):
        tmp_db.execute("CREATE TABLE IF NOT EXISTS nums (n INTEGER)")
        cursor = tmp_db.execute("INSERT INTO nums VALUES (?)", (99,))
        assert cursor is not None

    def test_execute_multiple_rows(self, tmp_db):
        tmp_db.execute("CREATE TABLE IF NOT EXISTS log (msg TEXT)")
        for i in range(5):
            tmp_db.execute("INSERT INTO log VALUES (?)", (f"msg{i}",))
        rows = tmp_db.query("SELECT COUNT(*) FROM log")
        assert rows[0][0] == 5


# ---------------------------------------------------------------------------
# query (read)
# ---------------------------------------------------------------------------

class TestQuery:
    def test_query_returns_list(self, tmp_db):
        result = tmp_db.query("SELECT 1, 2, 3")
        assert isinstance(result, list)

    def test_query_empty_table(self, tmp_db):
        tmp_db.execute("CREATE TABLE IF NOT EXISTS empty_t (x INTEGER)")
        rows = tmp_db.query("SELECT * FROM empty_t")
        assert rows == []

    def test_query_with_params(self, tmp_db):
        tmp_db.execute("CREATE TABLE IF NOT EXISTS things (tag TEXT)")
        tmp_db.execute("INSERT INTO things VALUES (?)", ("alpha",))
        tmp_db.execute("INSERT INTO things VALUES (?)", ("beta",))
        rows = tmp_db.query("SELECT tag FROM things WHERE tag = ?", ("alpha",))
        assert len(rows) == 1
        assert rows[0][0] == "alpha"


# ---------------------------------------------------------------------------
# close
# ---------------------------------------------------------------------------

class TestClose:
    def test_close_drains_pool(self, tmp_path):
        db_path = tmp_path / "close_test.db"
        pool = SQLitePool(str(db_path), pool_size=3)
        closed = pool.close()
        assert closed == 3

    def test_close_returns_count(self, tmp_path):
        db_path = tmp_path / "close2.db"
        pool = SQLitePool(str(db_path), pool_size=2)
        assert pool.close() == 2
