// This file contains the logic for ranking tasks based on the current model.

import type { CalendarContext } from "@/utils/calendar-context";

export type RankedTask = {
  Subject: string;
  Duration: number;
  "Before Task Emotion": string;
  "After Task Emotion": string;
  Emoji: string;
  "Why Now": string;
  Score: number;
  RelatedEventId: string | null;
};

type RankInput = {
  topEmotion: string;
  stressCategory: string;
  recentMessages: string[];
  calendarContext: CalendarContext;
  candidates: RankedTask[];
  taskCount: number;
};

export async function rankTasksWithCurrentModel(
  input: RankInput
): Promise<RankedTask[]> {
  return [...input.candidates]
    .sort((a, b) => b.Score - a.Score)
    .slice(0, input.taskCount);
}