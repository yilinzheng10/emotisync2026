import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getCalendarContext } from "@/utils/calendar-context";

export const runtime = "nodejs";

type SuggestRequest = {
  topEmotion: string;
  stressCategory: string;
  taskCount?: number;
  recentMessages?: string[];
};

export async function POST(req: NextRequest) {
  try {
    console.log("suggest-tasks called");

    const body = (await req.json()) as SuggestRequest;
    const {
      topEmotion,
      stressCategory,
      taskCount = 3,
      recentMessages = [],
    } = body;

    if (!topEmotion || !stressCategory) {
      return NextResponse.json(
        { error: "Missing topEmotion or stressCategory" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    console.log("ANTHROPIC_API_KEY exists:", Boolean(apiKey));

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "Missing ANTHROPIC_API_KEY in .env.local",
          hint: "Add ANTHROPIC_API_KEY=... to .env.local and restart npm run dev",
        },
        { status: 500 }
      );
    }

    let calendarContext;
    try {
      calendarContext = getCalendarContext();
    } catch (calendarError) {
      console.error("calendarContext failed:", calendarError);
      return NextResponse.json(
        {
          error: "Failed to load calendar context",
          detail:
            calendarError instanceof Error
              ? calendarError.message
              : "Unknown calendar error",
        },
        { status: 500 }
      );
    }

    console.log("calendarContext referenced successfully", {
      nowIso: calendarContext.nowIso,
      lastSyncedAt: calendarContext.lastSyncedAt ?? null,
      currentEvent: calendarContext.currentEvent?.title ?? null,
      nextEvent: calendarContext.nextEvent?.title ?? null,
      upcomingCount: calendarContext.upcomingEvents.length,
    });

    const recentMessagesBlock = recentMessages.length
      ? `Recent user messages:
${recentMessages.map((m) => `- "${m}"`).join("\n")}`
      : `Recent user messages:
- none`;

    const currentEventBlock = calendarContext.currentEvent
      ? `Current event:
- title: "${calendarContext.currentEvent.title}"
- type: ${calendarContext.currentEvent.type}
- start: ${calendarContext.currentEvent.start ?? "null"}
- end: ${calendarContext.currentEvent.end ?? "null"}
- durationMinutes: ${calendarContext.currentEvent.durationMinutes ?? "null"}`
      : `Current event:
- none`;

    const nextEventBlock = calendarContext.nextEvent
      ? `Next event:
- eventId: "${calendarContext.nextEvent.eventId}"
- title: "${calendarContext.nextEvent.title}"
- type: ${calendarContext.nextEvent.type}
- start: ${calendarContext.nextEvent.start ?? "null"}
- end: ${calendarContext.nextEvent.end ?? "null"}
- durationMinutes: ${calendarContext.nextEvent.durationMinutes ?? "null"}`
      : `Next event:
- none`;

    const upcomingEventsBlock = calendarContext.upcomingEvents.length
      ? `Upcoming events:
${calendarContext.upcomingEvents
  .map(
    (e, i) =>
      `${i + 1}. eventId="${e.eventId}", title="${e.title}", type=${e.type}, start=${e.start ?? "null"}, end=${e.end ?? "null"}, durationMinutes=${e.durationMinutes ?? "null"}`
  )
  .join("\n")}`
      : `Upcoming events:
- none`;

    const prompt = `You are a calendar-aware emotional wellness assistant.

The user is currently feeling "${topEmotion}".
Stress category: "${stressCategory}".

${recentMessagesBlock}

Calendar context:
- nowIso: ${calendarContext.nowIso}
- lastSyncedAt: ${calendarContext.lastSyncedAt ?? "null"}

${currentEventBlock}

${nextEventBlock}

${upcomingEventsBlock}

Your job:
Suggest exactly ${taskCount} practical, specific tasks that help the user transition to a healthier emotional state while respecting their actual calendar.

Rules:
1. Use the calendar context. Prefer suggestions that fit the user's current or next event.
2. Do not invent fake calendar events.
3. If there is an event within the next 60 minutes, prefer prep, transition, or grounding tasks.
4. If the user appears overloaded, prefer shorter tasks.
5. Make the tasks concrete and realistic.
6. Return ONLY a valid JSON array with no extra text, markdown, or code fences.
7. Each item must have exactly these fields:
   - "Subject": string, concise, 3-8 words
   - "Before Task Emotion": string, exactly "${topEmotion}"
   - "After Task Emotion": string, one realistic Hume-style emotion label such as "calmness", "joy", "relief", "satisfaction", "contentment", "concentration", "interest", "gratitude"
   - "Duration": number in minutes
   - "Emoji": a single emoji
   - "Why Now": one sentence explaining why this task fits the user's current schedule and emotional state
   - "RelatedEventId": the related calendar eventId if relevant, otherwise null

Example:
[
  {
    "Subject": "Review studio meeting notes",
    "Before Task Emotion": "${topEmotion}",
    "After Task Emotion": "concentration",
    "Duration": 15,
    "Emoji": "📝",
    "Why Now": "Why this now: your next calendar item is a studio meeting soon, so a short prep task fits both your schedule and current state.",
    "RelatedEventId": "abc123"
  }
]`;

    console.log("calling anthropic...");

    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 900,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((block) => block.type === "text");

    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        {
          error: "Unexpected response from Claude",
          raw: message.content,
        },
        { status: 500 }
      );
    }

    const text = textBlock.text
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    console.log("claude raw block:", text);

    let tasks: any;
    try {
      tasks = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          error: "Failed to parse Claude response",
          raw: text,
        },
        { status: 500 }
      );
    }

    if (!Array.isArray(tasks)) {
      return NextResponse.json(
        {
          error: "Claude response was not an array",
          raw: text,
        },
        { status: 500 }
      );
    }

    const normalizedTasks = tasks.slice(0, taskCount).map((task) => ({
      Subject: String(task.Subject ?? "").trim(),
      "Before Task Emotion": topEmotion,
      "After Task Emotion": String(
        task["After Task Emotion"] ?? "contentment"
      ).trim(),
      Duration: Number(task.Duration ?? 15),
      Emoji: String(task.Emoji ?? "✨").trim().slice(0, 2),
      "Why Now": String(
        task["Why Now"] ??
          "Why this now: it fits your current emotional state and schedule."
      ).trim(),
      RelatedEventId:
        task.RelatedEventId === null || task.RelatedEventId === undefined
          ? null
          : String(task.RelatedEventId),
    }));

    console.log("normalized task count:", normalizedTasks.length);

    return NextResponse.json(normalizedTasks);
  } catch (error) {
    console.error("suggest-tasks failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown suggest-tasks error",
        detail:
          error && typeof error === "object" && "stack" in error
            ? String((error as Error).stack)
            : null,
      },
      { status: 500 }
    );
  }
}