export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onprocessing?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export function recognitionConstructor(): (new () => Recognition) | undefined {
  if (
    typeof window === "undefined" ||
    typeof MediaRecorder === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  )
    return undefined;
  return WhisperRecognition;
}

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

// Voice notes are capped so provider latency and memory stay bounded.
export const MAX_RECORDING_MS = 60_000;
export const RECORDER_TIMESLICE_MS = 1000;
export const TRANSCRIBE_TIMEOUT_MS = 60_000;

// ISO-639-1 with optional region (e.g. "en", "en-SG", "zh-CN").
const LANGUAGE_HINT_PATTERN = /^[a-z]{2}(?:-[a-z0-9]{2,8})*$/;

/** Whisper accepts ISO-639-1 hints; omit the hint for automatic detection. */
export function transcriptionLanguage(language = "auto"): string | undefined {
  const value = language.trim().toLowerCase();
  if (!value || value === "auto") return undefined;
  if (!LANGUAGE_HINT_PATTERN.test(value))
    throw new Error("language-not-supported");
  return value.split("-")[0];
}

export async function transcribeAudio(
  audio: Blob,
  language = "auto",
  signal?: AbortSignal,
): Promise<string> {
  if (!audio.size) throw new Error("no-speech");
  if (audio.size > MAX_AUDIO_BYTES) throw new Error("audio-too-large");
  const body = new FormData();
  body.set("audio", audio, "recording");
  const hint = transcriptionLanguage(language);
  if (hint) body.set("language", hint);
  const response = await fetch("/api/transcribe", {
    method: "POST",
    body,
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result?.error === "string" ? result.error : "network",
    );
  if (typeof result?.text !== "string") throw new Error("network");
  if (!result.text.trim()) throw new Error("no-speech");
  return result.text.trim();
}

/** One complete recording per request: container fragments cannot be transcribed independently. */
function pickSupportedMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function toRecordErrorCode(error: unknown): string {
  if (
    error instanceof DOMException &&
    ["NotAllowedError", "SecurityError"].includes(error.name)
  ) {
    return "not-allowed";
  }
  if (error instanceof Error) return error.message;
  return "audio-capture";
}

class WhisperRecognition implements Recognition {
  lang = "auto";
  continuous = false;
  interimResults = false;
  onresult: Recognition["onresult"] = null;
  onerror: Recognition["onerror"] = null;
  onend: Recognition["onend"] = null;
  onstart: Recognition["onstart"] = null;
  onprocessing: Recognition["onprocessing"] = null;
  private controller: AbortController | null = null;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  start() {
    if (this.controller)
      throw new DOMException(
        "Recording is already active.",
        "InvalidStateError",
      );
    const controller = new AbortController();
    this.controller = controller;
    void this.record(controller, this.lang);
  }

  private async record(controller: AbortController, language: string) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (controller.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const mimeType = pickSupportedMimeType();
      if (!mimeType) throw new Error("audio-format-not-supported");
      const recorder = new MediaRecorder(stream, { mimeType });
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = (event) => {
        if (controller.signal.aborted) return;
        bytes += event.data.size;
        if (bytes > MAX_AUDIO_BYTES) {
          this.fail(controller, "audio-too-large");
          return;
        }
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => this.fail(controller, "audio-capture");
      recorder.onstart = () => {
        if (!controller.signal.aborted) this.onstart?.();
      };
      recorder.onstop = () => {
        this.stopTracks(stream);
        this.clearTimer();
        if (controller.signal.aborted) return;
        this.onprocessing?.();
        void this.transcribeChunks(
          controller,
          chunks,
          recorder.mimeType,
          language,
        );
      };
      recorder.start(RECORDER_TIMESLICE_MS);
      // Short voice notes keep provider latency and memory bounded.
      this.timer = setTimeout(() => this.stop(), MAX_RECORDING_MS);
    } catch (error) {
      this.fail(controller, toRecordErrorCode(error));
    }
  }

  private transcribeChunks(
    controller: AbortController,
    chunks: Blob[],
    mimeType: string,
    language: string,
  ) {
    const timeout = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    ]);
    void transcribeAudio(
      new Blob(chunks, { type: mimeType }),
      language,
      timeout,
    )
      .then((text) => {
        if (controller.signal.aborted) return;
        this.onresult?.({ results: [[{ transcript: text }]] });
        this.finish(controller);
      })
      .catch((error) =>
        this.fail(
          controller,
          error instanceof Error ? error.message : "network",
        ),
      );
  }

  private stopTracks(stream: MediaStream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  stop() {
    if (this.recorder?.state === "recording") this.recorder.stop();
    else if (this.controller && !this.recorder) this.abort();
  }

  abort() {
    const active = Boolean(this.controller);
    this.controller?.abort();
    this.controller = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.recorder) {
      this.recorder.onstop = null;
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      this.recorder.onstart = null;
      if (this.recorder.state !== "inactive") this.recorder.stop();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    if (active) this.onend?.();
  }

  private finish(controller: AbortController) {
    if (this.controller === controller) this.abort();
  }

  private fail(controller: AbortController, error: string) {
    if (controller.signal.aborted) return;
    this.onerror?.({ error });
    this.finish(controller);
  }
}
const SPEECH_MESSAGES: Record<string, string> = {
  "not-allowed":
    "Speech recognition permission was denied. You can keep typing, or check speech and microphone permissions in your browser and try again.",
  "service-not-allowed":
    "The browser’s speech service is not permitted. Microphone access alone does not enable transcription. Continue typing or use a browser with a working speech service.",
  "language-not-supported":
    "This speech service does not support the selected language. Choose another language or type your message.",
  "no-speech": "No speech was detected. Try again or type your message.",
  "not-configured":
    "Voice transcription is not configured. Continue typing or ask the operator to configure OpenRouter.",
  "audio-too-large":
    "The recording is too large. Record a shorter message or continue typing.",
  "audio-format-not-supported":
    "This browser cannot record a supported audio format. Try another browser or continue typing.",
  "rate-limited":
    "Voice transcription is busy. Try again shortly or continue typing.",
};

const SPEECH_FALLBACK_MESSAGE =
  "Speech recognition is unavailable or interrupted. Your text is retained; continue by typing.";

export function speechError(code: string) {
  return SPEECH_MESSAGES[code] ?? SPEECH_FALLBACK_MESSAGE;
}

/** Ask for microphone permission explicitly; release the probe before recognition opens it. */
export async function requestMicrophoneAccess(): Promise<void> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Microphone access needs HTTPS or localhost and a browser with microphone support. Open this page directly in your browser, not an embedded preview.",
    );
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError")
      throw new Error(
        "Microphone permission was denied or blocked. Allow microphone access for this site in the browser’s site settings and for this browser in your system privacy settings, then try again. You can keep typing.",
      );
    if (name === "NotFoundError")
      throw new Error(
        "No microphone was found. Connect or enable a microphone, then try again. You can keep typing.",
      );
    if (name === "NotReadableError")
      throw new Error(
        "The microphone could not be opened. Check whether another app or your system privacy settings are blocking it. You can keep typing.",
      );
    throw new Error(
      "Microphone access could not be started. Your text is retained; continue by typing.",
    );
  }
}
