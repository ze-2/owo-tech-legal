"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  recognitionConstructor,
  requestMicrophoneAccess,
  speechError,
  type Recognition,
} from "@/lib/speech";
import type { Statement } from "@/lib/review";
import type { Observation } from "@/lib/conversation";

const MAX_MESSAGE_CHARS = 10000;
const MICROPHONE_STARTUP_TIMEOUT_MS = 10000;
const MAX_VOICE_NOTE = "up to 60 seconds";

const SPEECH_LANGUAGES = [
  { value: "auto", label: "Detect language automatically" },
  { value: "en-SG", label: "English (Singapore)" },
  { value: "zh-CN", label: "Mandarin Chinese" },
  { value: "ms-MY", label: "Malay" },
  { value: "ta-IN", label: "Tamil" },
] as const;

export function ConversationIntake({
  statements,
  observations,
  prompt,
  onSend,
}: {
  statements: Statement[];
  observations: Observation[];
  prompt: string;
  onSend: (
    text: string,
    language: string,
    input: Statement["input"],
  ) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("auto");
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [message, setMessage] = useState("");
  const [usedVoice, setUsedVoice] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const attempt = useRef(0);
  const startupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearStartupTimer = useCallback(() => {
    if (startupTimer.current) clearTimeout(startupTimer.current);
    startupTimer.current = null;
  }, []);
  const releaseRecognition = useCallback(() => {
    clearStartupTimer();
    const active = recognition.current;
    recognition.current = null;
    if (active) {
      active.onprocessing = null;
      active.onstart = null;
      active.onend = null;
      active.onresult = null;
      active.onerror = null;
      active.abort();
    }
  }, [clearStartupTimer]);
  useEffect(
    () => () => {
      attempt.current++;
      releaseRecognition();
    },
    [releaseRecognition],
  );

  function stopQuietly(message: string) {
    attempt.current++;
    releaseRecognition();
    setStarting(false);
    setListening(false);
    setTranscribing(false);
    setMessage(message);
  }

  function cancel() {
    stopQuietly("Microphone stopped. Your text is retained.");
  }

  async function start() {
    if (!voiceConsent || starting || listening || transcribing) return;
    const currentAttempt = ++attempt.current;
    releaseRecognition();
    setStarting(true);
    setMessage(
      "Requesting microphone access. Check your browser’s permission prompt. If you already allowed access, it may not ask again.",
    );
    try {
      await requestMicrophoneAccess();
      if (attempt.current !== currentAttempt) return;
      const started = attachRecognition();
      if (!started) return;
      armStartupTimeout(currentAttempt);
      recognition.current?.start();
    } catch (error) {
      if (attempt.current !== currentAttempt) return;
      releaseRecognition();
      setStarting(false);
      setListening(false);
      setTranscribing(false);
      setMessage(
        error instanceof Error ? error.message : speechError("unavailable"),
      );
    }
  }

  function attachRecognition(): boolean {
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setStarting(false);
      setMessage(
        "This browser does not support microphone recording. Continue typing or try another browser.",
      );
      return false;
    }
    const active = new Constructor();
    recognition.current = active;
    active.lang = language;
    active.continuous = false;
    active.interimResults = false;

    let receivedSpeech = false;
    let failed = false;

    active.onprocessing = () => {
      setListening(false);
      setTranscribing(true);
      setMessage("Transcribing your recording…");
    };
    active.onstart = () => {
      clearStartupTimer();
      setStarting(false);
      setListening(true);
      setMessage(
        `Listening. Stop when ready (${MAX_VOICE_NOTE}), then check the transcript before adding it.`,
      );
    };
    active.onresult = (event) => {
      receivedSpeech = true;
      const words = Array.from(event.results)
        .map((row) => row[0].transcript)
        .join(" ");
      setText((current) => `${current}${current ? " " : ""}${words}`);
      setUsedVoice(true);
    };
    active.onerror = (event) => {
      failed = true;
      clearStartupTimer();
      setStarting(false);
      setListening(false);
      setTranscribing(false);
      setMessage(
        `Microphone access is allowed, but the speech service failed. ${speechError(event.error)}`,
      );
    };
    active.onend = () => {
      clearStartupTimer();
      setStarting(false);
      setListening(false);
      setTranscribing(false);
      if (failed) return;
      setMessage(
        receivedSpeech
          ? "Microphone stopped. Check the transcript, then add it to your conversation."
          : "No speech was transcribed. Try again or continue typing.",
      );
    };
    setMessage("Microphone access allowed. Starting audio recording…");
    return true;
  }

  function armStartupTimeout(currentAttempt: number) {
    startupTimer.current = setTimeout(() => {
      if (attempt.current !== currentAttempt) return;
      stopQuietly(
        "The microphone recording did not start. Continue typing or try another browser.",
      );
    }, MICROPHONE_STARTUP_TIMEOUT_MS);
  }
  const busy = listening || starting || transcribing;

  async function submitMessage() {
    const sent = await onSend(text, language, usedVoice ? "voice" : "typed");
    if (sent) {
      setText("");
      setUsedVoice(false);
    }
  }

  function stopMicrophone() {
    if (starting || transcribing) cancel();
    else recognition.current?.stop();
  }

  return (
    <section className="form-card conversation">
      <h2>Talk through your claim</h2>
      <p>
        Type or speak in your language. Add one detail at a time; check the
        working interpretation. Translation is not legally authoritative.
      </p>

      <label className="field">
        Speech language
        <select
          value={language}
          disabled={busy}
          onChange={(event) => setLanguage(event.target.value)}
        >
          {SPEECH_LANGUAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="check-label">
        <input
          type="checkbox"
          checked={voiceConsent}
          onChange={(event) => {
            setVoiceConsent(event.target.checked);
            if (!event.target.checked) cancel();
          }}
        />
        I allow OpenRouter and its transcription provider to process microphone
        audio. Audio is sent through this app’s server for transcription. This
        consent is separate from AI organisation and research.
      </label>
      <p>
        {voiceConsent
          ? "Select Start microphone to request browser access. If access was previously blocked, change the site’s microphone setting before trying again."
          : "First allow audio processing above, then select Start microphone."}
      </p>

      <div className="export-actions">
        <button
          type="button"
          className="button secondary"
          disabled={!voiceConsent || busy}
          onClick={() => void start()}
        >
          Start microphone
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={!busy}
          onClick={stopMicrophone}
        >
          Stop microphone
        </button>
      </div>

      <p role="status" aria-live="polite">
        {message}
      </p>

      <label className="field">
        Your next message
        <textarea
          value={text}
          maxLength={MAX_MESSAGE_CHARS}
          onChange={(event) => setText(event.target.value)}
          placeholder="例如：我给装修公司三千块订金，他们说三月开始可是一直没有来。"
        />
      </label>
      <button
        type="button"
        className="button primary"
        disabled={!text.trim() || busy}
        onClick={() => void submitMessage()}
      >
        Add to conversation
      </button>

      {prompt && (
        <p className="conversation-prompt" role="status">
          {prompt}
        </p>
      )}
      {statements.length > 0 && (
        <details open>
          <summary>Original messages ({statements.length})</summary>
          {statements.map((statement) => (
            <blockquote key={statement.id}>
              <small>
                {statement.language} · {statement.input} · original wording
                {statement.input === "voice"
                  ? " (reviewed transcript, no audio retained)"
                  : ""}
              </small>
              <p lang={statement.language}>{statement.text}</p>
            </blockquote>
          ))}
        </details>
      )}
      {observations.length > 0 && (
        <div>
          <h3>Extracted details to check</h3>
          {observations.map((observation, index) => (
            <div className="observation" key={`${observation.kind}-${index}`}>
              <small>
                {observation.kind} · {observation.certainty}
              </small>
              <p>Original: {observation.raw}</p>
              <p>
                Working interpretation:{" "}
                {observation.value ?? "Unknown — exact value unresolved"}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
