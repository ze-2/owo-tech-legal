# Clearclaim Telegram interface

The bot shares `openai.ts` extraction and prompting, OpenRouter Whisper transcription, Exa research, and the Chrome extension’s version 2 transfer validator with the web app. It runs separately from Next.js using Telegram long polling; no public webhook or new dependencies are required.

## Run

1. Create a bot with Telegram’s @BotFather and put its token in `TELEGRAM_BOT_TOKEN` in `.env.local`.
2. Configure `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, and `OPENAI_BASE_URL` as for the webpage. Set `OPENROUTER_API_KEY` for voice and `EXA_API_KEY` for research.
3. Optionally restrict access using comma-separated numeric `TELEGRAM_ALLOWED_USER_IDS`. Otherwise any private user can use the bot and incur provider usage.
4. Run `npm run bot:telegram` on Node 22+ in a continuously running process with persistent disk. Run exactly one worker per token. If the bot previously used a webhook, remove that webhook before polling. The worker does not change webhook settings automatically.
5. Open your bot in Telegram and send `/start`.

Bot API transport follows the official [Telegram Bot API](https://core.telegram.org/bots/api#getupdates), including `getUpdates`, `getFile`, `sendMessage`, and multipart `sendDocument`.

## User flow

- `/consent` allows AI processing after the bot explains data handling.
- Send text or Telegram voice notes (OGG/Opus, maximum 60 seconds and 10 MB). Transcripts are echoed for correction. Answers to follow-up questions are appended to the account and reorganised into the shared draft schema.
- `/json` downloads a structured, **unreviewed** draft, original account, and any research. This is an archive, not an extension import.
- `/research` performs the same official-source Exa retrieval and AI synthesis as the web app. Messages and a downloadable text report include numbered field-level source footnotes. Failed sections remain visibly unavailable. Research is cleared whenever the account changes.
- `/review` displays all filing fields and numbered SCT subtype choices. Send corrections as text or voice; any change requires a fresh review.
- `/subtype NUMBER` selects the exact dispute subtype. `/approve` confirms the displayed current revision and subtype, then sends `clearclaim-cjts.json`.
- Open the same Telegram conversation on your computer, download that JSON attachment, and import it using the existing Clearclaim Chrome extension’s JSON file picker. It uses the same reviewed version 2 contract as webpage exports; no extension changes are needed. No public claim URL is created.
- `/delete` or `/new` deletes the server-side draft and resets consent. Previously sent Telegram messages, files and provider records are not deleted.

## Storage and deployment

`TELEGRAM_STATE_PATH` defaults to `.telegram/state.json` (Git-ignored). It holds private chat drafts and the polling offset, with owner-only permissions and atomic replacement. Inactive drafts expire after 24 hours while the worker runs; startup also removes expired drafts. Use a protected persistent volume and keep it out of backups if deletion must extend to backup copies. Group chats, edited messages, bots, and non-allowlisted users are ignored. Audio is downloaded with a byte cap and held in memory only.

The lock file prevents two local workers sharing the same state file. After an unclean shutdown, verify the previous process is stopped before removing the `.lock` file. Do not deploy this polling worker as a short-lived serverless function or launch workers with different state files for the same token.

Updates run sequentially and the offset is saved after handling each update. Normal restarts do not repeat completed updates. A crash between a Telegram reply and the state write can repeat that reply; Telegram sends and local state cannot be committed atomically. Provider failures retain the previous saved draft and ask the user to resend. Logs omit private message contents and provider errors that could contain token URLs.

Verification: `npm test`, `npm run typecheck`, and `npm run lint`. Live delivery requires configured credentials and a running worker; automated tests use local fixtures and do not send Telegram messages.
