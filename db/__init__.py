"""Database module — SQLite connection pool with WAL mode."""
from .pool import SQLitePool

__all__ = ["SQLitePool"]
