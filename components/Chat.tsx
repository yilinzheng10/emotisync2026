"use client";

import { VoiceProvider } from "@humeai/voice-react";
import { useMemo, useRef, useState } from "react";
import Messages from "./Messages";
import Controls from "./Controls";
import StartCall from "./StartCall";
import { expressionColors } from "@/utils/expressionColors";

const fallbackColor = "#fde68a";

type Task = {
  task: string;
  duration: number;
  beforeColor: string;
  afterColor: string;
  before: string | null;
  after: string | null;
  emoji: string;
  whyNow: string | null;
  relatedEventId: string | null;
};

type StressCategory =
  | "Low-Stress or Relaxing Emotions"
  | "Moderate-Stress Emotions"
  | "High-Stress Emotions";

export default function ClientComponent({ accessToken }: { accessToken: string }) {
  const timeout = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const lastTopEmotionRef = useRef<string | null>(null);
  const recentMessagesRef = useRef<string[]>([]);

  const [emotionScores, setEmotionScores] = useState<Record<string, number> | undefined>(
    undefined
  );
  const [suggestedTasks, setSuggestedTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [chainedTasks, setChainedTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const hasAccessToken = useMemo(() => Boolean(accessToken), [accessToken]);

  const getStressCategory = (emotion: string): StressCategory => {
    const e = emotion.toLowerCase();

    const low = [
      "calmness",
      "joy",
      "aestheticappreciation",
      "tiredness",
      "amusement",
      "sympathy",
      "satisfaction",
      "nostalgia",
      "gratitude",
      "pride",
      "entrancement",
      "admiration",
      "relief",
      "adoration",
      "love",
      "contemplation",
      "excitement",
      "interest",
      "awe",
      "triumph",
    ];

    const moderate = [
      "concentration",
      "romance",
      "sexualdesire",
      "annoyance",
      "embarrassment",
      "realization",
      "boredom",
      "determination",
      "clarity",
      "contentment",
      "surprise",
      "awkwardness",
      "confusion",
      "ecstasy",
      "enthusiasm",
      "sadness",
      "sarcasm",
      "surprisenegative",
      "surprisepositive",
    ];

    const high = [
      "shame",
      "empathicpain",
      "pain",
      "anxiety",
      "distress",
      "guilt",
      "disappointment",
      "contempt",
      "fear",
      "disgust",
      "envy",
      "craving",
      "anger",
      "disapproval",
      "doubt",
      "horror",
    ];

    if (low.includes(e)) return "Low-Stress or Relaxing Emotions";
    if (high.includes(e)) return "High-Stress Emotions";
    if (moderate.includes(e)) return "Moderate-Stress Emotions";
    return "Moderate-Stress Emotions";
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hrs = minutes / 60;
    return hrs === Math.floor(hrs) ? `${hrs} hr` : `${hrs.toFixed(1)} hr`;
  };

  const cardWidth = (minutes: number) => Math.max(200, 150 + minutes * 10);

  const mapApiTasks = (items: any[]): Task[] =>
    items.map((item) => ({
      task: item["Subject"],
      duration: item["Duration"] || 30,
      beforeColor:
        expressionColors[item["Before Task Emotion"] as keyof typeof expressionColors] ||
        fallbackColor,
      afterColor:
        expressionColors[item["After Task Emotion"] as keyof typeof expressionColors] ||
        fallbackColor,
      before: item["Before Task Emotion"] ?? null,
      after: item["After Task Emotion"] ?? null,
      emoji: item["Emoji"] || "✨",
      whyNow: item["Why Now"] ?? null,
      relatedEventId:
        item["RelatedEventId"] === undefined || item["RelatedEventId"] === null
          ? null
          : String(item["RelatedEventId"]),
    }));

  const fetchTasksForEmotion = async (topEmotion: string) => {
    const stressCategory = getStressCategory(topEmotion);

    const response = await fetch("/api/suggest-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topEmotion,
        stressCategory,
        taskCount: 3,
        recentMessages: recentMessagesRef.current,
      }),
    });

    const rawText = await response.text();
    console.log("suggest-tasks status:", response.status);
    console.log("suggest-tasks raw response:", rawText);

    let data: any = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      throw new Error(`API returned non-JSON response: ${rawText || "(empty body)"}`);
    }

    if (!response.ok) {
      throw new Error(data?.error || `suggest-tasks failed with status ${response.status}`);
    }

    return mapApiTasks(data);
  };

  if (!hasAccessToken) {
    return (
      <div className="flex items-center justify-center w-screen h-screen bg-black text-white">
        Missing Hume access token.
      </div>
    );
  }

  return (
    <div className="relative flex flex-col justify-between items-center w-screen h-screen overflow-hidden">
      <VoiceProvider
        auth={{ type: "accessToken", value: accessToken }}
        onMessage={(message: any) => {
          try {
            console.log("FULL HUME MESSAGE:", message);

            const role = message?.message?.role;
            const text = message?.message?.content;
            const scores = message?.models?.prosody?.scores;

            console.log("role:", role);
            console.log("text:", text);
            console.log("scores:", scores);

            if (text && role === "user") {
              recentMessagesRef.current = [...recentMessagesRef.current, text].slice(-8);
            }

            if (scores && typeof scores === "object") {
              setEmotionScores(scores);

              const sortedEmotions = Object.entries(scores).sort(
                (a, b) => (b[1] as number) - (a[1] as number)
              );
              const topEmotion = sortedEmotions[0]?.[0];

              console.log("topEmotion:", topEmotion);

              if (topEmotion && topEmotion !== lastTopEmotionRef.current) {
                lastTopEmotionRef.current = topEmotion;
                setLoadingTasks(true);

                fetchTasksForEmotion(topEmotion)
                  .then((tasks) => {
                    console.log("tasks:", tasks);
                    setSuggestedTasks(tasks);
                  })
                  .catch((err) => console.error("Error fetching tasks:", err))
                  .finally(() => setLoadingTasks(false));
              }
            } else {
              console.log("No prosody scores found on this message");
            }
          } catch (error) {
            console.error("Error parsing emotion scores:", error);
          }

          if (timeout.current) clearTimeout(timeout.current);
          timeout.current = window.setTimeout(() => {
            if (ref.current) {
              ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
            }
          }, 200);
        }}
      >
        <div ref={ref} className="h-screen w-full overflow-y-auto">
          <div className="flex flex-col items-center justify-center min-h-screen w-full max-w-[900px] mx-auto px-4">
            <Messages values={emotionScores} />

            <div className="flex flex-col items-center justify-center space-y-6 mt-6">
              {selectedTask === null ? (
                <div className="flex flex-col items-center space-y-8">
                  {loadingTasks && (
                    <div className="text-white text-lg opacity-70 animate-pulse">
                      Finding tasks for you…
                    </div>
                  )}

                  {!loadingTasks &&
                    suggestedTasks.map((task, idx) => (
                      <div
                        key={idx}
                        onClick={async () => {
                          setSelectedTask(task);
                          setChainedTasks([]);

                          if (!task.after) return;

                          const [chained] = await Promise.all([
                            fetchTasksForEmotion(task.after),
                            new Promise<void>((resolve) => setTimeout(resolve, 500)),
                          ]);

                          setChainedTasks(chained);
                        }}
                        className="relative cursor-pointer p-4 rounded-2xl text-white shadow-md flex flex-col items-center justify-center overflow-hidden break-words transition-all duration-500 z-10"
                        style={{
                          width: cardWidth(task.duration || 30),
                          maxWidth: "calc(100vw - 2rem)",
                          background: `linear-gradient(135deg, ${task.beforeColor}, ${task.afterColor})`,
                        }}
                      >
                        <div
                          className="absolute inset-0 flex items-center overflow-hidden pointer-events-none z-10"
                          style={{ padding: "0 24px" }}
                        >
                          <span
                            style={{
                              display: "flex",
                              alignItems: "baseline",
                              gap: "6px",
                              whiteSpace: "nowrap",
                              lineHeight: 1,
                              color: "rgba(255,255,255,0.55)",
                              letterSpacing: "-2px",
                            }}
                          >
                            <span
                              style={{
                                fontFamily: "'Playfair Display', serif",
                                fontSize: "clamp(70px, 20vw, 130px)",
                                fontWeight: 400,
                              }}
                            >
                              {formatDuration(task.duration || 30).split(" ")[0]}
                            </span>
                            <span
                              style={{
                                fontFamily: "'Playfair Display', serif",
                                fontSize: "clamp(20px, 6vw, 44px)",
                                fontWeight: 300,
                              }}
                            >
                              {formatDuration(task.duration || 30).split(" ")[1]}
                            </span>
                          </span>
                        </div>

                        <div className="z-30 flex flex-col items-center gap-3 px-4">
                          <span style={{ fontSize: "40px", lineHeight: 1 }}>{task.emoji}</span>
                          <div
                            className="text-center leading-snug break-words"
                            style={{
                              color: "black",
                              fontSize: "24px",
                              fontWeight: 600,
                              lineHeight: "1.2",
                            }}
                          >
                            {task.task}
                          </div>
                          {task.whyNow && (
                            <div
                              className="text-center max-w-[420px]"
                              style={{
                                color: "rgba(0,0,0,0.72)",
                                fontSize: "14px",
                                lineHeight: "1.45",
                              }}
                            >
                              {task.whyNow}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="flex flex-col md:flex-row items-center md:items-start justify-center gap-8 md:gap-16 w-full">
                  <div className="flex flex-col items-center w-full md:w-auto">
                    <div
                      key={selectedTask.task}
                      className="relative cursor-pointer p-6 rounded-2xl text-white shadow-lg flex flex-col items-center justify-center overflow-hidden break-words transition-all duration-500 z-10 w-full md:w-auto"
                      style={{
                        width: cardWidth(selectedTask.duration || 30),
                        maxWidth: "calc(100vw - 2rem)",
                        background: `linear-gradient(135deg, ${selectedTask.beforeColor}, ${selectedTask.afterColor})`,
                      }}
                    >
                      <div className="absolute inset-0 rounded-2xl pointer-events-none z-20">
                        <div className="absolute top-0 left-0 h-1 bg-white rounded-t-2xl origin-left animate-grow-width" />
                        <div
                          className="absolute top-0 right-0 w-1 bg-white rounded-tr-2xl origin-top animate-grow-height"
                          style={{ animationDelay: "12.5s" }}
                        />
                        <div
                          className="absolute bottom-0 right-0 h-1 bg-white rounded-b-2xl origin-right animate-grow-width"
                          style={{ animationDelay: "25s" }}
                        />
                        <div
                          className="absolute bottom-0 left-0 w-1 bg-white rounded-bl-2xl origin-bottom animate-grow-height"
                          style={{ animationDelay: "37.5s" }}
                        />
                      </div>

                      <div
                        className="absolute inset-0 flex items-center overflow-hidden pointer-events-none z-10"
                        style={{ padding: "0 24px" }}
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: "6px",
                            whiteSpace: "nowrap",
                            lineHeight: 1,
                            color: "rgba(255,255,255,0.55)",
                            letterSpacing: "-2px",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "'Playfair Display', serif",
                              fontSize: "clamp(70px, 20vw, 130px)",
                              fontWeight: 400,
                            }}
                          >
                            {formatDuration(selectedTask.duration || 30).split(" ")[0]}
                          </span>
                          <span
                            style={{
                              fontFamily: "'Playfair Display', serif",
                              fontSize: "clamp(20px, 6vw, 44px)",
                              fontWeight: 300,
                            }}
                          >
                            {formatDuration(selectedTask.duration || 30).split(" ")[1]}
                          </span>
                        </span>
                      </div>

                      <div className="z-30 flex flex-col items-center gap-3 px-4">
                        <span style={{ fontSize: "48px", lineHeight: 1 }}>
                          {selectedTask.emoji}
                        </span>
                        <div
                          className="text-center leading-snug break-words"
                          style={{
                            color: "black",
                            fontSize: "26px",
                            fontWeight: 700,
                            lineHeight: "1.2",
                          }}
                        >
                          {selectedTask.task}
                        </div>
                        {selectedTask.whyNow && (
                          <div
                            className="text-center max-w-[420px]"
                            style={{
                              color: "rgba(0,0,0,0.72)",
                              fontSize: "14px",
                              lineHeight: "1.45",
                            }}
                          >
                            {selectedTask.whyNow}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-center md:items-start gap-6 w-full md:w-auto">
                    {chainedTasks.map((task, idx) => (
                      <div
                        key={`chained-${idx}`}
                        onClick={async () => {
                          setSelectedTask(task);
                          setChainedTasks([]);
                          if (!task.after) return;
                          const newChained = await fetchTasksForEmotion(task.after);
                          setChainedTasks(newChained);
                        }}
                        className="relative cursor-pointer p-4 rounded-2xl text-white shadow-md flex flex-col items-center justify-center overflow-hidden break-words transition-all duration-500 z-10"
                        style={{
                          opacity: 0.5,
                          width: cardWidth(task.duration || 30),
                          maxWidth: "calc(100vw - 2rem)",
                          background: `linear-gradient(135deg, ${task.beforeColor}, ${task.afterColor})`,
                        }}
                      >
                        <div
                          className="absolute inset-0 flex items-center overflow-hidden pointer-events-none z-10"
                          style={{ padding: "0 24px" }}
                        >
                          <span
                            style={{
                              display: "flex",
                              alignItems: "baseline",
                              gap: "6px",
                              whiteSpace: "nowrap",
                              lineHeight: 1,
                              color: "rgba(255,255,255,0.55)",
                              letterSpacing: "-2px",
                            }}
                          >
                            <span
                              style={{
                                fontFamily: "'Playfair Display', serif",
                                fontSize: "clamp(70px, 20vw, 130px)",
                                fontWeight: 400,
                              }}
                            >
                              {formatDuration(task.duration || 30).split(" ")[0]}
                            </span>
                            <span
                              style={{
                                fontFamily: "'Playfair Display', serif",
                                fontSize: "clamp(20px, 6vw, 44px)",
                                fontWeight: 300,
                              }}
                            >
                              {formatDuration(task.duration || 30).split(" ")[1]}
                            </span>
                          </span>
                        </div>

                        <div className="z-30 flex flex-col items-center gap-3 px-4">
                          <span style={{ fontSize: "36px", lineHeight: 1 }}>{task.emoji}</span>
                          <div
                            className="text-center leading-snug break-words"
                            style={{
                              color: "black",
                              fontSize: "24px",
                              fontWeight: 600,
                              lineHeight: "1.2",
                            }}
                          >
                            {task.task}
                          </div>
                          {task.whyNow && (
                            <div
                              className="text-center max-w-[420px]"
                              style={{
                                color: "rgba(0,0,0,0.72)",
                                fontSize: "14px",
                                lineHeight: "1.45",
                              }}
                            >
                              {task.whyNow}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <Controls />
        <StartCall />
      </VoiceProvider>
    </div>
  );
}