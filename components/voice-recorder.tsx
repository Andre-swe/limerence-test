"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

// Waveform visualization component
function Waveform({ analyser, isActive }: { analyser: AnalyserNode | null; isActive: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!analyser || !isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isActive) return;
      
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = "rgba(122, 63, 58, 0.08)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(122, 63, 58, 0.7)";
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyser, isActive]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={32}
      className="rounded-lg"
    />
  );
}

// Duration display component - only rendered when recording
function RecordingDuration({ startTime }: { startTime: number }) {
  // Initialize with calculated elapsed time
  const [seconds, setSeconds] = useState(() => 
    Math.floor((Date.now() - startTime) / 1000)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return (
    <span className="font-mono text-xs text-[var(--danger)]">
      {mins}:{secs.toString().padStart(2, "0")}
    </span>
  );
}

export function VoiceRecorder({
  onRecorded,
  onError,
  disabled = false,
}: {
  onRecorded: (file: File) => Promise<void> | void;
  onError?: (message: string) => void;
  disabled?: boolean;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (recorderRef.current) {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    
    // Close AudioContext (important for mobile Safari)
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    setAnalyser(null);
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Get supported MIME type for recording
  const getSupportedMimeType = () => {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "audio/wav",
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return "audio/webm"; // fallback
  };

  const startRecording = async () => {
    try {
      // Request microphone access - this is the user gesture that enables AudioContext on iOS
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      streamRef.current = stream;

      // Create AudioContext for waveform visualization
      // Must be created after user gesture on iOS Safari
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      // Resume AudioContext if suspended (required for iOS Safari)
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Set up analyser for waveform
      const analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 256;
      analyserRef.current = analyserNode;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyserNode);
      setAnalyser(analyserNode);

      // Create MediaRecorder with supported MIME type
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setIsUploading(true);
        try {
          const mimeType = recorder.mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type: mimeType });
          
          // Determine file extension based on MIME type
          const ext = mimeType.includes("mp4") ? "m4a" : 
                      mimeType.includes("ogg") ? "ogg" : 
                      mimeType.includes("wav") ? "wav" : "webm";
          
          const file = new File([blob], `voice-note-${Date.now()}.${ext}`, {
            type: mimeType,
          });
          await onRecorded(file);
        } catch (error) {
          onError?.(
            error instanceof Error ? error.message : "Unable to process the recorded audio.",
          );
        } finally {
          cleanup();
          setIsUploading(false);
        }
      };

      recorder.start(100); // Collect data every 100ms for smoother waveform
      setIsRecording(true);
      setRecordingStartTime(Date.now());
    } catch (error) {
      cleanup();
      setIsRecording(false);
      
      // Provide user-friendly error messages
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Permission denied") || errorMessage.includes("NotAllowedError")) {
        onError?.("Microphone access was denied. Please allow microphone access in your browser settings.");
      } else if (errorMessage.includes("NotFoundError")) {
        onError?.("No microphone found. Please connect a microphone and try again.");
      } else {
        onError?.(errorMessage || "Microphone access was not available.");
      }
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleClick = async () => {
    if (disabled || isUploading) return;

    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  };

  return (
    <div className="inline-flex items-center gap-2">
      {/* Waveform visualization */}
      <Waveform analyser={analyser} isActive={isRecording} />
      
      {/* Duration display */}
      {isRecording && recordingStartTime && (
        <RecordingDuration startTime={recordingStartTime} />
      )}

      {/* Record button */}
      <button
        type="button"
        onClick={handleClick}
        className={`touch-target inline-flex h-12 w-12 items-center justify-center rounded-full border transition-all ${
          isRecording
            ? "rec-pulse border-[rgba(122,63,58,0.3)] bg-[rgba(122,63,58,0.15)] text-[var(--danger)]"
            : isUploading
              ? "border-[var(--border)] bg-[rgba(255,255,255,0.82)] text-[var(--sage-muted)]"
              : "border-[var(--border)] bg-[rgba(255,255,255,0.82)] text-[var(--sage-deep)] active:scale-95"
        }`}
        aria-label={isRecording ? "Stop recording" : "Record voice note"}
        disabled={disabled || isUploading}
      >
        {isUploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isRecording ? (
          <Square className="h-4 w-4 fill-current" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
