# db/pool.py
"""SQLite connection pool with WAL mode enabled.

Recipe R2 — SQLite WAL + Connection Pool
Fixes SQLite write contention under concurrent Flask request handling.

Usage:
    from db.pool import SQLitePool
    db = SQLitePool("usage.db")

    # Write (auto-commit, retries on busy)
    db.execute("INSERT INTO conversation_log VALUES (?)", (message,))

    # Read (concurrent reads via WAL)
    results = db.query("SELECT * FROM conversation_log LIMIT 10")

    # Manual connection (for row_factory etc.)
    with db.get_connection() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM foo").fetchall()
"""
import sqlite3
import threading
from contextlib import contextmanager
from queue import Queue, Empty
import time


class SQLitePool:
    """Thread-safe SQLite connection pool with WAL mode."""

    def __init__(self, db_path: str, pool_size: int = 5):
        self.db_path = str(db_path)
        self.pool_size = pool_size
        self._pool = Queue(maxsize=pool_size)
        self._lock = threading.Lock()

        # Initialize pool with WAL-enabled connections
        for _ in range(pool_size):
            self._pool.put(self._create_connection())

    def _create_connection(self) -> sqlite3.Connection:
        """Create a new connection with WAL mode and optimized settings."""
        conn = sqlite3.connect(
            self.db_path,
            timeout=30.0,
            check_same_thread=False,
        )

        # Enable WAL mode for concurrent reads without blocking writers
        conn.execute("PRAGMA journal_mode=WAL")
        # NORMAL is safe with WAL and much faster than FULL
        conn.execute("PRAGMA synchronous=NORMAL")
        # 64 MB page cache per connection
        conn.execute("PRAGMA cache_size=-64000")
        # 30 s busy timeout (belt-and-suspenders alongside pool timeout)
        conn.execute("PRAGMA busy_timeout=30000")

        return conn

    @contextmanager
    def get_connection(self):
        """Get a connection from the pool (blocks up to 35 s before raising)."""
        try:
            conn = self._pool.get(timeout=35)
        except Empty:
            raise RuntimeError(
                "SQLitePool: timed out waiting for a free connection. "
                f"Pool size is {self.pool_size}."
            )
        try:
            yield conn
        finally:
            self._pool.put(conn)

    def execute(self, query: str, params: tuple = ()):
        """Execute a write query with automatic retry on busy."""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                with self.get_connection() as conn:
                    cursor = conn.execute(query, params)
                    conn.commit()
                    return cursor
            except sqlite3.OperationalError as e:
                if "locked" in str(e) and attempt < max_retries - 1:
                    time.sleep(0.1 * (attempt + 1))
                    continue
                raise

    def query(self, query: str, params: tuple = ()) -> list:
        """Execute a read query and return all rows."""
        with self.get_connection() as conn:
            cursor = conn.execute(query, params)
            return cursor.fetchall()

    def close(self):
        """Drain the pool and close all connections."""
        closed = 0
        while not self._pool.empty():
            try:
                conn = self._pool.get_nowait()
                conn.close()
                closed += 1
            except Empty:
                break
        return closed
