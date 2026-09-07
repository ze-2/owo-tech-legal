import { createRequire } from "node:module";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  handleTelegramMessage,
  newSession,
  type BotIO,
  type Session,
  type TelegramMessage,
} from "../src/lib/telegram";
import { MAX_AUDIO_BYTES } from "../src/lib/speech";

const nodeRequire = createRequire(import.meta.url);
const { loadEnvConfig } = nodeRequire(
  "@next/env",
) as typeof import("@next/env");

loadEnvConfig(process.cwd());

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token || !process.env.OPENAI_API_KEY) {
  throw new Error("Configure TELEGRAM_BOT_TOKEN and OPENAI_API_KEY first.");
}

// --- Configuration ---------------------------------------------------------

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const POLL_TIMEOUT_SECONDS = 30;
const POLL_RETRY_MS = 5_000;
const API_TIMEOUT_MS = 65_000;
const VOICE_DOWNLOAD_TIMEOUT_MS = 30_000;
const MESSAGE_CHUNK_SIZE = 1_800;
const VOICE_PATH_PATTERN = /^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/;

const statePath = resolve(
  process.env.TELEGRAM_STATE_PATH || ".telegram/state.json",
);
const allowedUserIds = new Set(
  (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

type State = { offset: number; sessions: Record<string, Session> };
type TelegramUpdate = { update_id: number; message?: TelegramMessage };

const state: State = { offset: 0, sessions: {} };
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

// --- Telegram API ----------------------------------------------------------

async function api<T>(
  method: string,
  body: Record<string, unknown> | FormData,
): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      body: isForm ? body : JSON.stringify(body),
      headers: isForm ? undefined : { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    },
  );
  const data = await response.json();
  console.log(data)
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed (${response.status}).`);
  }
  return data.result as T;
}

// --- State -----------------------------------------------------------------

async function saveState(): Promise<void> {
  for (const [id, session] of Object.entries(state.sessions)) {
    if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
      delete state.sessions[id];
    }
  }
  await writeFile(`${statePath}.tmp`, JSON.stringify(state), { mode: 0o600 });
  await rename(`${statePath}.tmp`, statePath);
}

async function loadState(): Promise<void> {
  try {
    Object.assign(state, JSON.parse(await readFile(statePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        "Cannot read Telegram state; repair it before restarting.",
      );
    }
  }
}

function getSession(chatId: string): Session {
  const cached = state.sessions[chatId];
  const fresh = cached && Date.now() - cached.updatedAt <= SESSION_TTL_MS;
  return structuredClone(fresh ? cached : newSession());
}

// --- Message helpers -------------------------------------------------------

function isAllowedMessage(
  message: TelegramMessage | undefined,
): message is TelegramMessage {
  return (
    message?.chat.type === "private" &&
    !!message.from &&
    !message.from.is_bot &&
    (!allowedUserIds.size || allowedUserIds.has(String(message.from.id)))
  );
}

function extractCommand(message: TelegramMessage): string {
  return (message.text || "").split(/\s/)[0].split("@")[0].toLowerCase();
}

function clearsSession(message: TelegramMessage): boolean {
  return ["/delete", "/new"].includes(extractCommand(message));
}

async function downloadVoice(fileId: string): Promise<File> {
  const file = await api<{ file_path?: string; file_size?: number }>(
    "getFile",
    { file_id: fileId },
  );
  if (
    !file.file_path ||
    !VOICE_PATH_PATTERN.test(file.file_path) ||
    file.file_path.includes("..") ||
    (file.file_size || 0) > MAX_AUDIO_BYTES
  ) {
    throw new Error("Invalid voice file.");
  }
  const response = await fetch(
    `https://api.telegram.org/file/bot${token}/${file.file_path}`,
    {
      signal: AbortSignal.timeout(VOICE_DOWNLOAD_TIMEOUT_MS),
      redirect: "error",
    },
  );
  if (!response.ok || !response.body) {
    throw new Error("Voice download failed.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) throw new Error("Voice too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  if (!size) throw new Error("Empty voice file.");
  return new File(chunks, "voice.ogg", { type: "audio/ogg" });
}

function createBotIo(message: TelegramMessage): BotIO {
  const chatId = String(message.chat.id);
  return {
    async say(text: string) {
      // Plain text avoids interpreting user content as Telegram markup.
      const chars = Array.from(text);
      for (let i = 0; i < chars.length; i += MESSAGE_CHUNK_SIZE) {
        await api("sendMessage", {
          chat_id: message.chat.id,
          text: chars.slice(i, i + MESSAGE_CHUNK_SIZE).join(""),
          link_preview_options: { is_disabled: true },
        });
      }
    },
    async document(name: string, text: string) {
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set(
        "document",
        new Blob([text], {
          type: name.endsWith(".json") ? "application/json" : "text/plain",
        }),
        name,
      );
      await api("sendDocument", form);
    },
    async voice(fileId: string) {
      return downloadVoice(fileId);
    },
  };
}

// --- Update handling -------------------------------------------------------

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!stopping && isAllowedMessage(message)) {
    const chatId = String(message.chat.id);
    const session = getSession(chatId);
    const io = createBotIo(message);
    try {
      await handleTelegramMessage(session, message, io);
      session.updatedAt = Date.now();
      state.sessions[chatId] = session;
      if (clearsSession(message)) delete state.sessions[chatId];
    } catch (e) {
      // Do not print provider errors: they may contain token URLs or claim text.
      console.error(`Telegram message processing failed. ${e}`);
      try {
        await io.say(
          "This request could not be completed. Your previous saved draft is retained. Please resend the message or command; voice requires OpenRouter configuration.",
        );
      } catch {
        /* A later user message can retry. */
      }
    }
  }
  state.offset = update.update_id + 1;
  await saveState();
}

async function pollOnce(): Promise<void> {
  let updates: TelegramUpdate[];
  try {
    updates = await api("getUpdates", {
      offset: state.offset,
      timeout: POLL_TIMEOUT_SECONDS,
      allowed_updates: ["message"],
      limit: 10,
    });
  } catch {
    console.error(
      "Telegram polling failed; retrying in 5 seconds. Check connectivity, token and webhook configuration.",
    );
    await new Promise((resolve) => setTimeout(resolve, POLL_RETRY_MS));
    return;
  }
  for (const update of updates) {
    if (stopping) break;
    await handleUpdate(update);
  }
  await saveState();
}

// --- Entry point -----------------------------------------------------------

async function main(): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  // const lockPath = `${statePath}.lock`;
  // const lock = await open(lockPath, "wx", 0o600).catch(() => {
  //   throw new Error(
  //     "Telegram worker lock exists. Stop the other worker, or remove the stale lock after confirming it is stopped.",
  //   );
  // });
  // await lock.writeFile(String(process.pid));
  try {
    await loadState();
    await saveState();
    console.log("Clearclaim Telegram polling worker started.");
    while (!stopping) {
      await pollOnce();
    }
  } finally {
    // await lock.close();
    // await unlink(lockPath);
  }
}

await main();
