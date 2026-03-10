#!/usr/bin/env python3
"""
preview_sqlite_db.py
Usage:
  python preview_sqlite_db.py /path/to/your.db
  python previecw_sqlite_db.py /path/to/your.db --table your_table --limit 20
"""

import argparse
import os
import sqlite3
import pandas as pd

print(sqlite3.sqlite_version)

DEFAULT_DB = "output/calendar_RA.db"

# --- replace your existing db_path argument with these two lines ---
parser = argparse.ArgumentParser(description="Preview a SQLite .db file with pandas.")
parser.add_argument(
    "db_path",
    nargs="?",
    default=DEFAULT_DB,
    help=f"Path to the .db / .sqlite file (default: {DEFAULT_DB})",
)
parser.add_argument("--table", help="Table name to preview (optional)")
parser.add_argument("--limit", type=int, default=10, help="Number of rows to preview (default: 10)")
parser.add_argument("--csv", help="Path to save preview as CSV (optional). If provided, preview is written to this file.")


def list_tables(conn: sqlite3.Connection) -> list[str]:
    q = """
    SELECT name
    FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name;
    """
    return [r[0] for r in conn.execute(q).fetchall()]


def table_row_count(conn: sqlite3.Connection, table: str) -> int:
    try:
        return conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    except sqlite3.Error:
        return -1


def table_schema(conn: sqlite3.Connection, table: str) -> pd.DataFrame:
    # PRAGMA table_info gives columns, types, nullability, defaults, PK
    return pd.read_sql_query(f'PRAGMA table_info("{table}")', conn)


def preview_table(conn: sqlite3.Connection, table: str, limit: int) -> pd.DataFrame:
    return pd.read_sql_query(f'SELECT * FROM "{table}" LIMIT {int(limit)}', conn)


def main():
    args = parser.parse_args()

    db_path = os.path.expanduser(args.db_path)
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"DB not found: {db_path}")

    try:
        # Attempt read-only connection with URI mode
        uri = f"file:{db_path}?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
    except sqlite3.OperationalError as e:
        print(f"URI mode connection failed: {e}. Falling back to standard connection.")
        conn = sqlite3.connect(db_path)

    with conn:
        tables = list_tables(conn)
        if not tables:
            print("No user tables found (or this may not be a SQLite database).")
            return

        # choose table: explicit or first available
        table = args.table if args.table else tables[0]
        print(f"Previewing table: {table}")

        df = preview_table(conn, table, args.limit)
        print(df)

        # export to CSV: use provided path or default to same folder as DB
        if args.csv:
            out_path = os.path.expanduser(args.csv)
        else:
            db_dir = os.path.dirname(db_path) or "."
            db_base = os.path.splitext(os.path.basename(db_path))[0]
            out_filename = f"{db_base}__{table}_preview.csv"
            out_path = os.path.join(db_dir, out_filename)

        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        df.to_csv(out_path, index=False)
        print(f"Preview exported to CSV: {out_path}")


if __name__ == "__main__":
    main()