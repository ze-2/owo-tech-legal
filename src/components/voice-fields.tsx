"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Dropdown } from "./dropdown";
import { Mic, Square, X } from "lucide-react";
import { recognitionConstructor, speechError, type Recognition } from "@/lib/speech";

const languages = [
  ["auto", "Detect language automatically"], ["en-SG", "English (Singapore)"],
  ["zh-CN", "Mandarin Chinese"], ["ms-MY", "Malay"], ["ta-IN", "Tamil"],
];
type Preferences = {
  consent: boolean; language: string;
  setConsent: (value: boolean) => void; setLanguage: (value: string) => void;
  register: (cancel: () => void) => () => void;
};
const VoiceContext = createContext<Preferences | null>(null);

/** Share explicit consent and language, but render recording controls inside each field. */
export function VoiceFieldsProvider({ children }: { children: ReactNode }) {
  const [consent, setConsent] = useState(false);
  const [language, setLanguage] = useState("auto");
  const active = useRef<(() => void) | null>(null);
  const register = useCallback((cancel: () => void) => {
    active.current?.(); active.current = cancel;
    return () => { if (active.current === cancel) active.current = null; };
  }, []);
  return <VoiceContext.Provider value={{
    consent, language, register,
    setConsent(value) { if (!value) active.current?.(); setConsent(value); },
    setLanguage(value) { active.current?.(); setLanguage(value); },
  }}>{children}</VoiceContext.Provider>;
}

type VoiceProps = {
  onValueChange: (value: string) => void;
  onTranscribed?: (language: string) => void;
};
type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & VoiceProps;
type AreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & VoiceProps;

export function VoiceInput(props: NativeProps) { return <VoiceField kind="input" {...props} />; }
export function VoiceTextarea(props: AreaProps) { return <VoiceField kind="textarea" {...props} />; }

function VoiceField({ kind, onValueChange, onTranscribed, ...props }: (NativeProps | AreaProps) & { kind: "input" | "textarea" }) {
  const preferences = useContext(VoiceContext);
  if (!preferences) throw new Error("Voice fields require VoiceFieldsProvider.");
  const generatedId = useId();
  const id = props.id || generatedId;
  const element = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const recording = useRef<Recognition | null>(null);
  const unregister = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "listening" | "transcribing">("idle");
  const [settings, setSettings] = useState(false);
  const [message, setMessage] = useState("");
  const latest = useRef({ onValueChange, onTranscribed, value: props.value });
  useEffect(() => { latest.current = { onValueChange, onTranscribed, value: props.value }; }, [onValueChange, onTranscribed, props.value]);
  const release = useCallback(() => {
    const current = recording.current; recording.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unregister.current?.(); unregister.current = null;
    if (current) {
      current.onresult = current.onerror = current.onend = current.onstart = null;
      current.onprocessing = null; current.abort();
    }
  }, []);
  useEffect(() => release, [release]);
  function cancel() { release(); setPhase("idle"); setMessage("Recording cancelled. Your text is retained."); }
  function start() {
    if (!preferences!.consent) { setSettings(true); return; }
    if (phase !== "idle" || element.current?.matches(":disabled") || props.readOnly) return;
    const Constructor = recognitionConstructor();
    if (!Constructor) { setMessage("This browser does not support microphone recording. Continue typing or try another browser."); return; }
    release();
    unregister.current = preferences!.register(cancel);
    const current = new Constructor(); recording.current = current;
    const language = preferences!.language;
    current.lang = language;
    current.continuous = false; current.interimResults = false;
    setPhase("starting"); setMessage("Requesting microphone access…");
    current.onstart = () => {
      if (timer.current) clearTimeout(timer.current);
      setPhase("listening"); setMessage("Listening. Stop when ready (up to 60 seconds).");
    };
    current.onprocessing = () => { setPhase("transcribing"); setMessage("Transcribing your recording…"); };
    current.onresult = event => {
      if (recording.current !== current || !element.current?.isConnected || element.current.matches(":disabled") || element.current.readOnly) return;
      const text = Array.from(event.results).map(row => row[0].transcript).join(" ").trim();
      if (!text) { setMessage("No speech was transcribed. Try again or type instead."); return; }
      const previous = String(latest.current.value ?? "");
      const next = element.current.type === "date" ? text : `${previous}${previous && !/\s$/.test(previous) ? " " : ""}${text}`;
      if (element.current.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text)) {
        setMessage(`Please enter the date as YYYY-MM-DD. Your date is unchanged. Transcript: ${text}`); return;
      }
      if (element.current.maxLength >= 0 && next.length > element.current.maxLength) {
        setMessage(`The transcript exceeds this field’s character limit. Your text is unchanged. Transcript: ${text}`); return;
      }
      latest.current.onValueChange(next); latest.current.onTranscribed?.(language);
      setMessage("Transcript added. Check and edit the text before continuing.");
    };
    current.onerror = event => { setMessage(speechError(event.error)); release(); setPhase("idle"); };
    current.onend = () => { release(); setPhase("idle"); };
    timer.current = setTimeout(() => { release(); setPhase("idle"); setMessage("Microphone did not start. Try again or type instead."); }, 10000);
    try { current.start(); } catch { release(); setPhase("idle"); setMessage(speechError("unavailable")); }
  }
  const busy = phase !== "idle";
  const describedBy = [props["aria-describedby"], message ? `${id}-voice-status` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`voice-field voice-field-${kind}`}>
      <div className="voice-field-control">
        {kind === "textarea" ? (
          <textarea {...props as AreaProps} id={id} ref={node => { element.current = node; }} aria-describedby={describedBy}
            onChange={event => onValueChange(event.target.value)} />
        ) : (
          <input {...props as NativeProps} id={id} ref={node => { element.current = node; }} aria-describedby={describedBy}
            onChange={event => onValueChange(event.target.value)} />
        )}
        <button type="button" className={`voice-mic ${busy ? "active" : ""}`} aria-label={phase === "listening" ? "Stop microphone" : busy ? "Cancel recording" : "Start microphone"}
          title={phase === "listening" ? "Stop and transcribe" : "Voice input"} disabled={props.disabled || props.readOnly}
          onClick={() => phase === "listening" ? recording.current?.stop() : busy ? cancel() : start()}>
          {phase === "listening" ? <Square size={17} /> : busy ? <X size={17} /> : <Mic size={18} />}
        </button>
      </div>
      <button type="button" className="voice-settings-toggle" aria-expanded={settings} aria-controls={`${id}-voice-settings`}
        onClick={() => setSettings(!settings)}>Voice settings</button>
      {settings && <div className="voice-settings" id={`${id}-voice-settings`}>
        <label className="check-label"><input type="checkbox" checked={preferences.consent}
          onChange={event => preferences.setConsent(event.target.checked)} />
          I allow OpenRouter and its transcription provider to process microphone audio. This consent is separate from AI organisation and research.
        </label>
        <label htmlFor={`${id}-language`}>Speech language</label>
        <Dropdown id={`${id}-language`} value={preferences.language} onValueChange={preferences.setLanguage}
          options={languages.map(([value, label]) => ({ value, label }))} />
        <small>Audio is sent through this app’s server. Consent and language apply to all fields in this tab. After allowing audio, press the mic to record.</small>
      </div>}
      {message && <p id={`${id}-voice-status`} className="voice-status" role="status">{message}</p>}
    </div>
  );
}
