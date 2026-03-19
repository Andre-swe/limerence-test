"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Mic, Square, Trash2, Upload } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AudioQualityMetrics {
  /** Average volume level 0-1 */
  averageVolume: number;
  /** Peak volume level 0-1 */
  peakVolume: number;
  /** Duration in seconds */
  duration: number;
  /** Whether audio has clipping (too loud) */
  hasClipping: boolean;
  /** Whether audio is too quiet */
  isTooQuiet: boolean;
  /** Overall quality score 0-100 */
  qualityScore: number;
}

export interface VoiceCloneConsent {
  /** Whether consent was given */
  granted: boolean;
  /** ISO timestamp when consent was granted */
  timestamp: string;
  /** Client IP address (captured server-side) */
  ipAddress?: string;
  /** User agent string */
  userAgent: string;
  /** The specific consent text the user agreed to */
  consentText: string;
}

type RecordingState = "idle" | "recording" | "paused" | "recorded";

interface VoiceCloneRecorderProps {
  /** Minimum recording duration in seconds (default: 30) */
  minDuration?: number;
  /** Maximum recording duration in seconds (default: 60) */
  maxDuration?: number;
  /** Called when recording is complete and ready for upload */
  onRecordingComplete: (
    file: File,
    metrics: AudioQualityMetrics,
    consent: VoiceCloneConsent,
  ) => Promise<void> | void;
  /** Called on error */
  onError?: (message: string) => void;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Whether consent has already been given (skip consent gate) */
  consentAlreadyGiven?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIN_DURATION = 30;
const DEFAULT_MAX_DURATION = 60;
const VOLUME_QUIET_THRESHOLD = 0.05;
const VOLUME_CLIPPING_THRESHOLD = 0.95;
const FFT_SIZE = 256;

const CONSENT_TEXT = `I confirm that:
• I am the person speaking in this recording, OR
• I have explicit permission from the person whose voice is being recorded
• I understand this voice sample will be used to create a synthetic voice clone
• I have the legal right to authorize this voice cloning`;

// ---------------------------------------------------------------------------
// Consent Gate Component
// ---------------------------------------------------------------------------

function ConsentGate({
  onConsentGranted,
  onCancel,
}: {
  onConsentGranted: (consent: VoiceCloneConsent) => void;
  onCancel: () => void;
}) {
  const [agreed, setAgreed] = useState(false);

  const handleConfirm = () => {
    if (!agreed) return;

    const consent: VoiceCloneConsent = {
      granted: true,
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      consentText: CONSENT_TEXT,
    };

    onConsentGranted(consent);
  };

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border)] bg-white p-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-amber-100 p-2">
          <AlertCircle className="h-5 w-5 text-amber-600" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-[var(--sage-deep)]">
            Voice Cloning Consent Required
          </h3>
          <p className="mt-1 text-sm text-[var(--sage-muted)]">
            Before recording, please confirm you have the rights to clone this voice.
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-[var(--sage-light)] p-4">
        <p className="whitespace-pre-line text-sm text-[var(--sage-deep)]">{CONSENT_TEXT}</p>
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
        />
        <span className="text-sm text-[var(--sage-deep)]">
          I have read and agree to the above consent terms
        </span>
      </label>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm text-[var(--sage-deep)] transition-colors hover:bg-[var(--sage-light)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!agreed}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          I Confirm & Agree
        </button>
      </div>

      <p className="text-xs text-[var(--sage-muted)]">
        Your consent will be recorded with a timestamp for our audit trail.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quality Assessment
// ---------------------------------------------------------------------------

function assessQuality(
  volumeSamples: number[],
  duration: number,
  minDuration: number,
): AudioQualityMetrics {
  if (volumeSamples.length === 0) {
    return {
      averageVolume: 0,
      peakVolume: 0,
      duration,
      hasClipping: false,
      isTooQuiet: true,
      qualityScore: 0,
    };
  }

  const averageVolume = volumeSamples.reduce((a, b) => a + b, 0) / volumeSamples.length;
  const peakVolume = Math.max(...volumeSamples);
  const hasClipping = volumeSamples.some((v) => v > VOLUME_CLIPPING_THRESHOLD);
  const isTooQuiet = averageVolume < VOLUME_QUIET_THRESHOLD;

  // Calculate quality score (0-100)
  let qualityScore = 100;

  // Penalize for duration issues
  if (duration < minDuration) {
    qualityScore -= Math.min(40, (minDuration - duration) * 2);
  }

  // Penalize for volume issues
  if (isTooQuiet) {
    qualityScore -= 30;
  }
  if (hasClipping) {
    qualityScore -= 20;
  }

  // Reward good average volume (0.1-0.5 is ideal)
  if (averageVolume >= 0.1 && averageVolume <= 0.5) {
    qualityScore = Math.min(100, qualityScore + 10);
  }

  return {
    averageVolume,
    peakVolume,
    duration,
    hasClipping,
    isTooQuiet,
    qualityScore: Math.max(0, Math.min(100, qualityScore)),
  };
}

function getQualityLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Excellent", color: "text-green-600" };
  if (score >= 60) return { label: "Good", color: "text-emerald-600" };
  if (score >= 40) return { label: "Fair", color: "text-yellow-600" };
  return { label: "Poor", color: "text-red-600" };
}

// ---------------------------------------------------------------------------
// Waveform Visualization Component
// ---------------------------------------------------------------------------

function WaveformVisualizer({
  analyser,
  isRecording,
  waveformData,
}: {
  analyser: AnalyserNode | null;
  isRecording: boolean;
  waveformData: number[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;

      ctx.fillStyle = "rgba(245, 243, 240, 1)";
      ctx.fillRect(0, 0, width, height);

      if (isRecording && analyser) {
        // Live waveform during recording
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);

        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(122, 63, 58, 0.8)";
        ctx.beginPath();

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();

        animationRef.current = requestAnimationFrame(draw);
      } else if (waveformData.length > 0) {
        // Static waveform for recorded audio
        const barWidth = Math.max(2, width / waveformData.length);
        const gap = 1;

        ctx.fillStyle = "rgba(122, 63, 58, 0.6)";

        for (let i = 0; i < waveformData.length; i++) {
          const barHeight = Math.max(2, waveformData[i] * height * 0.8);
          const x = i * (barWidth + gap);
          const y = (height - barHeight) / 2;
          ctx.fillRect(x, y, barWidth, barHeight);
        }
      } else {
        // Empty state - draw center line
        ctx.strokeStyle = "rgba(122, 63, 58, 0.2)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
      }
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyser, isRecording, waveformData]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={80}
      className="w-full rounded-lg border border-[var(--border)]"
    />
  );
}

// ---------------------------------------------------------------------------
// Quality Indicator Component
// ---------------------------------------------------------------------------

function QualityIndicator({
  metrics,
  minDuration,
  isRecording,
  currentDuration,
}: {
  metrics: AudioQualityMetrics | null;
  minDuration: number;
  isRecording: boolean;
  currentDuration: number;
}) {
  if (isRecording) {
    const progress = Math.min(100, (currentDuration / minDuration) * 100);
    const remaining = Math.max(0, minDuration - currentDuration);

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--sage-deep)]">Recording...</span>
          <span className="font-mono text-[var(--sage-muted)]">
            {Math.floor(currentDuration)}s / {minDuration}s min
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
          <div
            className={`h-full transition-all duration-300 ${
              progress >= 100 ? "bg-green-500" : "bg-[var(--accent)]"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        {remaining > 0 && (
          <p className="text-xs text-[var(--sage-muted)]">
            {Math.ceil(remaining)} more seconds needed for voice cloning
          </p>
        )}
      </div>
    );
  }

  if (!metrics) {
    return (
      <p className="text-sm text-[var(--sage-muted)]">
        Record at least {minDuration} seconds of clear speech for best results
      </p>
    );
  }

  const { label, color } = getQualityLabel(metrics.qualityScore);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {metrics.qualityScore >= 60 ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <AlertCircle className="h-4 w-4 text-yellow-600" />
          )}
          <span className={`text-sm font-medium ${color}`}>
            Quality: {label} ({metrics.qualityScore}%)
          </span>
        </div>
        <span className="font-mono text-sm text-[var(--sage-muted)]">
          {metrics.duration.toFixed(1)}s
        </span>
      </div>

      {/* Quality issues */}
      <div className="space-y-1 text-xs">
        {metrics.isTooQuiet && (
          <p className="text-yellow-600">⚠ Audio is too quiet — speak closer to the microphone</p>
        )}
        {metrics.hasClipping && (
          <p className="text-yellow-600">⚠ Audio is clipping — speak a bit softer</p>
        )}
        {metrics.duration < minDuration && (
          <p className="text-yellow-600">
            ⚠ Recording too short — need at least {minDuration} seconds
          </p>
        )}
        {metrics.qualityScore >= 80 && (
          <p className="text-green-600">✓ Great recording quality for voice cloning!</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function VoiceCloneRecorder({
  minDuration = DEFAULT_MIN_DURATION,
  maxDuration = DEFAULT_MAX_DURATION,
  onRecordingComplete,
  onError,
  disabled = false,
  consentAlreadyGiven = false,
}: VoiceCloneRecorderProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [metrics, setMetrics] = useState<AudioQualityMetrics | null>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [consent, setConsent] = useState<VoiceCloneConsent | null>(
    consentAlreadyGiven
      ? {
          granted: true,
          timestamp: new Date().toISOString(),
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
          consentText: CONSENT_TEXT,
        }
      : null,
  );
  const [showConsentGate, setShowConsentGate] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const volumeSamplesRef = useRef<number[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    try {
      cleanup();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Set up audio analysis
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Set up MediaRecorder
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      volumeSamplesRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setRecordedBlob(blob);

        // Generate static waveform from volume samples
        const samples = volumeSamplesRef.current;
        const targetBars = 100;
        const step = Math.max(1, Math.floor(samples.length / targetBars));
        const waveform: number[] = [];
        for (let i = 0; i < samples.length; i += step) {
          const slice = samples.slice(i, i + step);
          const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
          waveform.push(avg);
        }
        setWaveformData(waveform);

        // Calculate quality metrics
        const finalDuration = (Date.now() - startTimeRef.current) / 1000;
        const quality = assessQuality(samples, finalDuration, minDuration);
        setMetrics(quality);
        setDuration(finalDuration);
        setState("recorded");
      };

      // Start recording
      recorder.start(100); // Collect data every 100ms
      startTimeRef.current = Date.now();
      setState("recording");
      setDuration(0);
      setMetrics(null);
      setWaveformData([]);

      // Timer for duration and volume sampling
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setDuration(elapsed);

        // Sample volume
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255;
          volumeSamplesRef.current.push(average);
        }

        // Auto-stop at max duration
        if (elapsed >= maxDuration) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
          }
          streamRef.current?.getTracks().forEach((track) => track.stop());
        }
      }, 100);
    } catch (error) {
      cleanup();
      setState("idle");
      onError?.(
        error instanceof Error ? error.message : "Could not access microphone. Please check permissions.",
      );
    }
  }, [cleanup, maxDuration, minDuration, onError]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const discardRecording = useCallback(() => {
    cleanup();
    setRecordedBlob(null);
    setMetrics(null);
    setWaveformData([]);
    setDuration(0);
    setState("idle");
  }, [cleanup]);

  const submitRecording = useCallback(async () => {
    if (!recordedBlob || !metrics || !consent) return;

    setIsUploading(true);
    try {
      const file = new File([recordedBlob], `voice-clone-${Date.now()}.webm`, {
        type: "audio/webm",
      });
      await onRecordingComplete(file, metrics, consent);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Failed to upload recording.");
    } finally {
      setIsUploading(false);
    }
  }, [recordedBlob, metrics, consent, onRecordingComplete, onError]);

  const canSubmit = metrics && metrics.duration >= minDuration && metrics.qualityScore >= 40 && consent;

  // Handle consent flow
  const handleStartRecording = useCallback(() => {
    if (!consent) {
      setShowConsentGate(true);
    } else {
      startRecording();
    }
  }, [consent, startRecording]);

  const handleConsentGranted = useCallback((grantedConsent: VoiceCloneConsent) => {
    setConsent(grantedConsent);
    setShowConsentGate(false);
    // Automatically start recording after consent
    startRecording();
  }, [startRecording]);

  const handleConsentCancel = useCallback(() => {
    setShowConsentGate(false);
  }, []);

  // Show consent gate if needed
  if (showConsentGate) {
    return (
      <ConsentGate
        onConsentGranted={handleConsentGranted}
        onCancel={handleConsentCancel}
      />
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border)] bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--sage-deep)]">Voice Sample Recording</h3>
        {state === "recorded" && (
          <button
            type="button"
            onClick={discardRecording}
            className="flex items-center gap-1 text-sm text-[var(--sage-muted)] hover:text-[var(--danger)]"
            disabled={isUploading}
          >
            <Trash2 className="h-4 w-4" />
            Discard
          </button>
        )}
      </div>

      {/* Waveform */}
      <WaveformVisualizer
        analyser={analyserRef.current}
        isRecording={state === "recording"}
        waveformData={waveformData}
      />

      {/* Quality Indicator */}
      <QualityIndicator
        metrics={metrics}
        minDuration={minDuration}
        isRecording={state === "recording"}
        currentDuration={duration}
      />

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        {state === "idle" && (
          <button
            type="button"
            onClick={handleStartRecording}
            disabled={disabled}
            className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            <Mic className="h-5 w-5" />
            Start Recording
          </button>
        )}

        {state === "recording" && (
          <button
            type="button"
            onClick={stopRecording}
            className="flex items-center gap-2 rounded-full bg-[var(--danger)] px-6 py-3 text-white transition-colors hover:opacity-90"
          >
            <Square className="h-5 w-5 fill-current" />
            Stop Recording
          </button>
        )}

        {state === "recorded" && (
          <>
            <button
              type="button"
              onClick={handleStartRecording}
              disabled={isUploading}
              className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-6 py-3 text-[var(--sage-deep)] transition-colors hover:bg-[var(--sage-light)] disabled:opacity-50"
            >
              <Mic className="h-5 w-5" />
              Re-record
            </button>
            <button
              type="button"
              onClick={submitRecording}
              disabled={!canSubmit || isUploading}
              className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              <Upload className="h-5 w-5" />
              {isUploading ? "Uploading..." : "Use This Recording"}
            </button>
          </>
        )}
      </div>

      {/* Instructions */}
      {state === "idle" && (
        <div className="rounded-lg bg-[var(--sage-light)] p-4 text-sm text-[var(--sage-deep)]">
          <p className="font-medium">Tips for best results:</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-[var(--sage-muted)]">
            <li>Find a quiet environment with minimal background noise</li>
            <li>Speak naturally at a consistent volume</li>
            <li>Read a passage or speak freely for {minDuration}–{maxDuration} seconds</li>
            <li>Keep the microphone at a consistent distance</li>
          </ul>
        </div>
      )}
    </div>
  );
}
