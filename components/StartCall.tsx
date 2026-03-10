"use client";

import { useVoice } from "@humeai/voice-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "./ui/button";
import { Phone } from "lucide-react";
import { useEffect, useState } from "react";

export default function StartCall() {
  const { status, connect, setVolume } = useVoice();
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    console.log("voice status changed:", status.value, status);
  }, [status]);

  const handleConnect = async () => {
    if (isConnecting || status.value === "connecting" || status.value === "error") {
      return;
    }

    setIsConnecting(true);
    setErrorMessage(null);
    console.log("Start Call button clicked...");

    try {
      console.log("Attempting to connect to EVI model...");

      const connection = await connect();

      setVolume(0);

      const audios = document.querySelectorAll("audio");
      audios.forEach((audio) => {
        audio.muted = true;
      });

      console.log("Voice connection successful!", connection);
    } catch (err) {
      const error = err as Error;
      console.error("Call connection failed:", error);
      setErrorMessage(error.message || "Failed to start the call.");
      alert(`Failed to start the call. Error: ${error.message}`);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <AnimatePresence>
      {status.value !== "connected" && status.value !== "error" && (
        <motion.div
          className="fixed inset-0 flex items-center justify-center bg-background p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ scale: 0.5 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.5 }}
            className="flex flex-col items-center gap-3"
          >
            <Button
              className="z-50 flex items-center gap-1.5 px-4 py-2 bg-blue-500 text-white font-bold rounded-md hover:bg-blue-600 transition"
              onClick={handleConnect}
              disabled={isConnecting}
            >
              <Phone className="size-4 opacity-50" strokeWidth={2} stroke="currentColor" />
              <span>{isConnecting ? "Connecting..." : "Start Call"}</span>
            </Button>

            {errorMessage && (
              <div className="max-w-md rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 text-center">
                {errorMessage}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}

      {status.value === "connected" ? "Connected!" : "not connected"}
    </AnimatePresence>
  );
}