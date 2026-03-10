#!/usr/bin/env python3
"""
Google Calendar -> SQLite exporter + test event creator (MacOS-friendly)

What it does:
1) OAuth-authenticates to ONE Google account (Desktop app flow).
2) Lists events for a 1-month window (default: last 30 days) and upserts into SQLite.
3) Inserts a new event:
   - March 3, 2026, 5:00 PM America/Los_Angeles
   - Title: "testing add event"
4) Upserts the newly created event into the same SQLite DB.

Editable areas are clearly marked with "EDIT ME".
"""

from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build


# =========================
# EDIT ME: CONFIG
# =========================
SCOPES = ["https://www.googleapis.com/auth/calendar"]  # read+write scope needed to insert events
CALENDAR_ID = "primary"  # EDIT ME if you want a specific calendar ID instead of primary
DB_PATH = "output/calendar_RA.db"  # EDIT ME to change DB location/name
CREDENTIALS_FILE = "config/client_credential.json"  # downloaded OAuth client JSON
TOKEN_FILE = "config/token.json"  # cached user token after auth

# Export window
EXPORT_DAYS_BACK = 15  # EDIT ME if you want exactly a month boundary
EXPORT_DAYS_FORWARD = 15  # EDIT ME if you also want to include future days

# EDIT ME: Event to add (current manually add)
ADD_EVENT_TITLE = "testing add event"
ADD_EVENT_TZ = "America/Los_Angeles"
ADD_EVENT_START_LOCAL = "2026-03-03 17:00:00"  # March 3, 2026 5pm in America/Los_Angeles
ADD_EVENT_DURATION_MIN = 60  


# =========================
# DATABASE: SCHEMA + UPSERT
# =========================
CREATE_EVENTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL,
    summary TEXT,
    description TEXT,
    location TEXT,
    status TEXT,
    html_link TEXT,

    start_type TEXT,         -- "dateTime" or "date"
    start_value TEXT,        -- RFC3339 dateTime or yyyy-mm-dd
    start_time_zone TEXT,

    end_type TEXT,           -- "dateTime" or "date"
    end_value TEXT,          -- RFC3339 dateTime or yyyy-mm-dd
    end_time_zone TEXT,

    created TEXT,
    updated TEXT,
    organizer_email TEXT,
    creator_email TEXT,
    raw_json TEXT,

    synced_at_utc TEXT NOT NULL
);
"""

UPSERT_EVENT_SQL = """
INSERT INTO events (
    id, calendar_id, summary, description, location, status, html_link,
    start_type, start_value, start_time_zone,
    end_type, end_value, end_time_zone,
    created, updated, organizer_email, creator_email, raw_json, synced_at_utc
) VALUES (
    :id, :calendar_id, :summary, :description, :location, :status, :html_link,
    :start_type, :start_value, :start_time_zone,
    :end_type, :end_value, :end_time_zone,
    :created, :updated, :organizer_email, :creator_email, :raw_json, :synced_at_utc
)
ON CONFLICT(id) DO UPDATE SET
    calendar_id=excluded.calendar_id,
    summary=excluded.summary,
    description=excluded.description,
    location=excluded.location,
    status=excluded.status,
    html_link=excluded.html_link,
    start_type=excluded.start_type,
    start_value=excluded.start_value,
    start_time_zone=excluded.start_time_zone,
    end_type=excluded.end_type,
    end_value=excluded.end_value,
    end_time_zone=excluded.end_time_zone,
    created=excluded.created,
    updated=excluded.updated,
    organizer_email=excluded.organizer_email,
    creator_email=excluded.creator_email,
    raw_json=excluded.raw_json,
    synced_at_utc=excluded.synced_at_utc;
"""


def ensure_db(db_path: str) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.execute(CREATE_EVENTS_TABLE_SQL)
        conn.commit()


def upsert_events(db_path: str, calendar_id: str, events: Iterable[Dict[str, Any]]) -> int:
    """
    Upsert a list of Google Calendar event resources into SQLite.
    Returns number of rows attempted (same as events count).
    """
    now_utc = datetime.now(timezone.utc).isoformat()

    def normalize(e: Dict[str, Any]) -> Dict[str, Any]:
        # Start/end can be either {"dateTime": "...", "timeZone": "..."} or {"date": "..."}
        start = e.get("start", {}) or {}
        end = e.get("end", {}) or {}

        start_type = "dateTime" if "dateTime" in start else ("date" if "date" in start else None)
        end_type = "dateTime" if "dateTime" in end else ("date" if "date" in end else None)

        organizer = (e.get("organizer") or {}).get("email")
        creator = (e.get("creator") or {}).get("email")

        # Store the raw JSON as a compact-ish string (no external deps)
        raw_json = str(e)

        return {
            "id": e.get("id"),
            "calendar_id": calendar_id,
            "summary": e.get("summary"),
            "description": e.get("description"),
            "location": e.get("location"),
            "status": e.get("status"),
            "html_link": e.get("htmlLink"),

            "start_type": start_type,
            "start_value": start.get("dateTime") or start.get("date"),
            "start_time_zone": start.get("timeZone"),

            "end_type": end_type,
            "end_value": end.get("dateTime") or end.get("date"),
            "end_time_zone": end.get("timeZone"),

            "created": e.get("created"),
            "updated": e.get("updated"),
            "organizer_email": organizer,
            "creator_email": creator,
            "raw_json": raw_json,
            "synced_at_utc": now_utc,
        }

    rows = [normalize(e) for e in events if e.get("id")]
    if not rows:
        return 0

    with sqlite3.connect(db_path) as conn:
        conn.executemany(UPSERT_EVENT_SQL, rows)
        conn.commit()

    return len(rows)


# =========================
# GOOGLE AUTH + API CLIENT
# =========================
def get_calendar_service() -> Any:
    """
    Creates an authenticated Calendar API service using OAuth desktop flow.
    - credentials.json is required (downloaded from Google Cloud Console)
    - token.json is created/updated automatically after first auth
    """
    creds: Optional[Credentials] = None

    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w", encoding="utf-8") as token:
            token.write(creds.to_json())

    # Calendar API v3
    return build("calendar", "v3", credentials=creds)


# =========================
# EXPORT 1 MONTH EVENTS
# =========================
def export_one_month(service: Any, calendar_id: str, db_path: str) -> int:
    """
    Exports events within [now - EXPORT_DAYS_BACK, now + EXPORT_DAYS_FORWARD] into SQLite.

    Uses events.list with:
    - timeMin/timeMax RFC3339
    - singleEvents=True to expand recurring events
    - orderBy="startTime" (requires singleEvents=True)
    """
    now = datetime.now(timezone.utc)
    time_min = (now - timedelta(days=EXPORT_DAYS_BACK)).isoformat()
    time_max = (now + timedelta(days=EXPORT_DAYS_FORWARD)).isoformat()

    all_items: list[Dict[str, Any]] = []
    page_token: Optional[str] = None

    while True:
        resp = (
            service.events()
            .list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
                maxResults=2500,
                pageToken=page_token,
            )
            .execute()
        )
        items = resp.get("items", []) or []
        all_items.extend(items)

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    count = upsert_events(db_path, calendar_id, all_items)
    return count


# =========================
# ADD THE TEST EVENT
# =========================
def add_test_event(service: Any, calendar_id: str) -> Dict[str, Any]:
    """
    Adds a timed event using start.dateTime/end.dateTime + timeZone.
    """
    # Local naive string -> keep it as local time and explicitly attach timeZone in the payload.
    # Google Calendar API accepts RFC3339 dateTime strings; when providing a separate timeZone,
    # it's common to send a local dateTime without offset plus timeZone.
    # (Alternatively you could convert to offset-aware RFC3339; timeZone field still fine.)

    start_dt = datetime.strptime(ADD_EVENT_START_LOCAL, "%Y-%m-%d %H:%M:%S")
    end_dt = start_dt + timedelta(minutes=ADD_EVENT_DURATION_MIN)

    event_body = {
        "summary": ADD_EVENT_TITLE,
        "start": {
            "dateTime": start_dt.strftime("%Y-%m-%dT%H:%M:%S"),
            "timeZone": ADD_EVENT_TZ,
        },
        "end": {
            "dateTime": end_dt.strftime("%Y-%m-%dT%H:%M:%S"),
            "timeZone": ADD_EVENT_TZ,
        },
    }

    created = service.events().insert(calendarId=calendar_id, body=event_body).execute()
    return created


def main() -> None:
    # 1) Ensure DB exists
    ensure_db(DB_PATH)

    # 2) Auth + API client
    if not os.path.exists(CREDENTIALS_FILE):
        raise FileNotFoundError(
            f"Missing {CREDENTIALS_FILE}. Download OAuth Desktop credentials and save as {CREDENTIALS_FILE}."
        )

    service = get_calendar_service()

    # 3) Export window to DB
    exported_count = export_one_month(service, CALENDAR_ID, DB_PATH)
    print(f"[OK] Exported/upserted {exported_count} events into {DB_PATH} (calendarId={CALENDAR_ID}).")

    # 4) Add event
    created = add_test_event(service, CALENDAR_ID)
    print(f"[OK] Created event: id={created.get('id')} summary={created.get('summary')}")
    print(f"     htmlLink={created.get('htmlLink')}")

    # 5) Upsert created event into DB (so DB reflects the insertion immediately)
    upserted_created = upsert_events(DB_PATH, CALENDAR_ID, [created])
    print(f"[OK] Upserted created event into DB ({upserted_created} row).")


if __name__ == "__main__":
    main()