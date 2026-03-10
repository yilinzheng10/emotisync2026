from __future__ import annotations

import datetime as dt
import os
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from sqlalchemy import create_engine, Column, String, DateTime, Integer
from sqlalchemy.orm import declarative_base, sessionmaker

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

def get_creds(credentials_path="credentials.json", token_path="token.json") -> Credentials:
    creds: Optional[Credentials] = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_path, "w") as f:
            f.write(creds.to_json())
    return creds

def fetch_next_30_days(calendar_id="primary") -> List[Dict[str, Any]]:
    creds = get_creds()
    service = build("calendar", "v3", credentials=creds)

    now = dt.datetime.now(dt.timezone.utc)
    time_min = now.isoformat()
    time_max = (now + dt.timedelta(days=30)).isoformat()

    resp = service.events().list(
        calendarId=calendar_id,
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy="startTime",
        showDeleted=True,
        maxResults=2500,
    ).execute()

    return resp.get("items", [])

Base = declarative_base()

class Event(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, autoincrement=True)
    calendar_id = Column(String, nullable=False)
    event_id = Column(String, nullable=False)
    summary = Column(String, nullable=True)
    status = Column(String, nullable=True)
    start_time = Column(DateTime(timezone=True), nullable=True)
    end_time = Column(DateTime(timezone=True), nullable=True)

engine = create_engine("sqlite:///calendar.db", future=True)
SessionLocal = sessionmaker(bind=engine, future=True)
Base.metadata.create_all(engine)

def parse_dt(d: Dict[str, Any]) -> Optional[dt.datetime]:
    if "dateTime" in d:
        return dt.datetime.fromisoformat(d["dateTime"])
    if "date" in d:
        return dt.datetime.fromisoformat(d["date"] + "T00:00:00+00:00")
    return None

def upsert_events(calendar_id: str, items: List[Dict[str, Any]]) -> int:
    with SessionLocal() as db:
        count = 0
        for e in items:
            eid = e.get("id")
            if not eid:
                continue
            row = db.query(Event).filter_by(calendar_id=calendar_id, event_id=eid).one_or_none()
            if row is None:
                row = Event(calendar_id=calendar_id, event_id=eid)
                db.add(row)

            row.summary = e.get("summary")
            row.status = e.get("status")
            row.start_time = parse_dt(e.get("start", {}))
            row.end_time = parse_dt(e.get("end", {}))
            count += 1
        db.commit()
        return count

app = FastAPI(title="Calendar Minimal Backend")

@app.get("/")
def root():
    return {"ok": True, "hint": "Try POST /sync then GET /events"}

@app.post("/sync")
def sync(calendar_id: str = "primary"):
    items = fetch_next_30_days(calendar_id)
    n = upsert_events(calendar_id, items)
    return {"fetched": len(items), "upserted": n}

@app.get("/events")
def events(calendar_id: str = "primary"):
    with SessionLocal() as db:
        rows = db.query(Event).filter_by(calendar_id=calendar_id).order_by(Event.start_time.asc()).all()
        return [
            {
                "event_id": r.event_id,
                "summary": r.summary,
                "status": r.status,
                "start_time": r.start_time.isoformat() if r.start_time else None,
                "end_time": r.end_time.isoformat() if r.end_time else None,
            }
            for r in rows
        ]
