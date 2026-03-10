import path from "path";
import Database from "better-sqlite3";

export type CalendarEventSummary = {
  eventId: string;
  title: string;
  type: "timed" | "all_day" | "cancelled";
  start: string | null;
  end: string | null;
  date: string | null;
  durationMinutes: number | null;
  status: string | null;
  location: string | null;
  description: string | null;
};

export type CalendarContext = {
  nowIso: string;
  currentEvent: CalendarEventSummary | null;
  nextEvent: CalendarEventSummary | null;
  upcomingEvents: CalendarEventSummary[];
  lastSyncedAt: string | null;
};

function openDb() {
  const dbPath =
    process.env.CALENDAR_DB_PATH ||
    path.join(process.cwd(), "calendar", "output", "calendar_RA.db");

  return new Database(dbPath, { readonly: true });
}

function deriveDurationMinutes(
  startType: string | null,
  startValue: string | null,
  endType: string | null,
  endValue: string | null
): number | null {
  if (startType === "date" && startValue) return 1440;

  if (
    startType === "dateTime" &&
    endType === "dateTime" &&
    startValue &&
    endValue
  ) {
    const start = new Date(startValue).getTime();
    const end = new Date(endValue).getTime();

    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return Math.max(0, Math.round((end - start) / 60000));
  }

  return null;
}

function normalizeRow(row: any): CalendarEventSummary {
  const title = row.summary?.trim() || "(untitled)";
  const type =
    row.status === "cancelled"
      ? "cancelled"
      : row.start_type === "date"
      ? "all_day"
      : "timed";

  const date =
    row.start_type === "dateTime" && row.start_value
      ? String(row.start_value).slice(0, 10)
      : row.start_value ?? null;

  return {
    eventId: row.id,
    title,
    type,
    start: row.start_type === "dateTime" ? row.start_value ?? null : null,
    end: row.end_type === "dateTime" ? row.end_value ?? null : null,
    date,
    durationMinutes: deriveDurationMinutes(
      row.start_type,
      row.start_value,
      row.end_type,
      row.end_value
    ),
    status: row.status ?? null,
    location: row.location ?? null,
    description: row.description ?? null,
  };
}

export function getCalendarContext(): CalendarContext {
  const db = openDb();
  const now = new Date();
  const nowIso = now.toISOString();

  const rows = db
    .prepare(
      `
      SELECT
        id,
        summary,
        description,
        location,
        status,
        start_type,
        start_value,
        end_type,
        end_value,
        synced_at_utc
      FROM events
      ORDER BY start_value ASC
      `
    )
    .all();

  const events = rows.map(normalizeRow).filter((e) => e.type !== "cancelled");

  const currentEvent =
    events.find((e) => {
      if (!e.start || !e.end) return false;
      return nowIso >= e.start && nowIso <= e.end;
    }) ?? null;

  const nextEvent =
    events.find((e) => e.start && e.start > nowIso) ?? null;

  const upcomingEvents = events
    .filter((e) => !e.start || e.start >= nowIso)
    .slice(0, 8);

  const lastSyncedRow = db
    .prepare(`SELECT MAX(synced_at_utc) AS lastSyncedAt FROM events`)
    .get() as { lastSyncedAt: string | null };

  db.close();

  return {
    nowIso,
    currentEvent,
    nextEvent,
    upcomingEvents,
    lastSyncedAt: lastSyncedRow?.lastSyncedAt ?? null,
  };
}