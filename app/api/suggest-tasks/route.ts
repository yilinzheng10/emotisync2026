import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { topEmotion, stressCategory, taskCount, recentMessages } = await req.json();

  const contextBlock = recentMessages?.length
    ? `\nHere is what the user has been talking about recently:\n${recentMessages.map((m: string) => `- "${m}"`).join("\n")}\n\nUse this context to make your task suggestions specific and relevant to their actual situation.`
    : "";

  const prompt = `You are an emotional wellness assistant. A user is currently feeling "${topEmotion}" (stress level: ${stressCategory}).${contextBlock}

Suggest exactly ${taskCount} practical, specific task(s) that would genuinely help them transition to a healthier emotional state.

Return ONLY a valid JSON array with no extra text, markdown, or code fences. Each item must have exactly these fields:
- "Subject": the task name (string, concise, 3–8 words)
- "Before Task Emotion": "${topEmotion}" (string, exactly as given)
- "After Task Emotion": the expected emotion after completing this task (string — one Hume AI emotion label such as "calmness", "joy", "relief", "satisfaction", "contentment", "excitement", "gratitude", "amusement", "interest", "concentration")
- "Duration": realistic estimated time in minutes (number — choose naturally, e.g. 10, 15, 20, 30, 45, 60, 90, 120, 180. A quick meditation might be 10 min; a gym session 60 min; a long walk 30 min. Do NOT round to arbitrary increments — pick what actually fits the task)
- "Emoji": a single emoji that visually represents the task activity (e.g. 🚶 for walking, 🎵 for music, 📖 for reading, 🧘 for meditation)

Example for 1 task:
[
  {
    "Subject": "Take a short walk outside",
    "Before Task Emotion": "${topEmotion}",
    "After Task Emotion": "calmness",
    "Duration": 30,
    "Emoji": "🚶"
  }
]`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== "text") {
    return NextResponse.json({ error: "Unexpected response from Claude" }, { status: 500 });
  }

  // Strip accidental markdown fences Claude sometimes adds
  const text = block.text.replace(/^```(?:json)?\n?|\n?```$/g, "").trim();

  try {
    const tasks = JSON.parse(text);
    return NextResponse.json(tasks);
  } catch {
    return NextResponse.json({ error: "Failed to parse Claude response", raw: text }, { status: 500 });
  }
}
