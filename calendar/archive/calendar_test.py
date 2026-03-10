from __future__ import annotations

import datetime as dt
import os.path
from typing import List, Dict, Any

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# Read-only is safest for testing
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

def get_creds(
    #json path
    credentials_path: str = "/Users/yilinzheng/Downloads/client_credential.json",
    token_path: str = "token.json",
) -> Credentials:
    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            # Opens browser, returns OAuth tokens; saves refresh token on first consent
            creds = flow.run_local_server(port=0)
        with open(token_path, "w") as f:
            f.write(creds.to_json())
    return creds

def list_next_30_days(calendar_id: str = "primary") -> List[Dict[str, Any]]:
    creds = get_creds()
    service = build("calendar", "v3", credentials=creds)

    now = dt.datetime.now(dt.timezone.utc)
    time_min = now.isoformat()
    time_max = (now + dt.timedelta(days=30)).isoformat()

    resp = (
        service.events()
        .list(
            calendarId=calendar_id,
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,     # expand recurring into instances
            orderBy="startTime",
            maxResults=2500,
        )
        .execute()
    )
    return resp.get("items", [])

def main() -> None:
    events = list_next_30_days("primary")
    print(f"Fetched {len(events)} events in next 30 days.\n")

    for e in events[:50]:  # print first 50
        summary = e.get("summary", "(no title)")
        start = e.get("start", {}).get("dateTime") or e.get("start", {}).get("date")
        end = e.get("end", {}).get("dateTime") or e.get("end", {}).get("date")
        print(f"- {summary}\n  {start} → {end}\n")

if __name__ == "__main__":
    main()