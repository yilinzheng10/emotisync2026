import { NextResponse } from "next/server";
import { getCalendarContext } from "@/utils/calendar-context";

export const runtime = "nodejs";

export async function GET() {
  try {
    const calendarContext = getCalendarContext();
    return NextResponse.json(calendarContext);
  } catch (error) {
    console.error("calendar/context failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown calendar context error",
      },
      { status: 500 }
    );
  }
}