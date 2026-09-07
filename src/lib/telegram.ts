import type { Draft, Research } from "./claim";
import { finishConversation } from "./conversation";
import { organiseConversationWithOpenAI, conversationQuestionWithOpenAI } from "./openai";
import { researchClaim } from "./exa";
import { approvedPackage, initialReviews } from "./review";
import { filingFields, validField } from "../../cjts-prefiling/transfer.mjs";
import { sctOptionsForClaimType } from "../../cjts-prefiling/claim-type.mjs";
import { transcribeRecording } from "./transcription";
import { MAX_AUDIO_BYTES } from "./speech";

export type Session = {
	consent: boolean; original: string; updatedAt: number;
	draft?: Draft; research?: Research; question?: string;
	revision: number; reviewedRevision?: number; subtype?: number;
};
export type TelegramMessage = {
	chat: { id: number; type: string }; from?: { id: number; is_bot?: boolean };
	text?: string; voice?: { file_id: string; file_size?: number; duration: number };
};
export type BotIO = {
	say(text: string): Promise<void>;
	document(name: string, text: string): Promise<void>;
	voice(fileId: string): Promise<File>;
};
export const newSession = (): Session => ({ consent: false, original: "", updatedAt: Date.now(), revision: 0 });
const help = "Clearclaim prepares a working draft, not a filed claim. Text goes to the configured AI provider; voice also goes to OpenRouter for transcription. /research sends a minimised query to Exa and retrieved sources to AI. Bot drafts are stored on the operator’s server for up to 24 hours. Telegram/provider retention is separate.\n\n/consent to begin, then send text or a voice note (up to 60 seconds / 10 MB).\n/review — view fields and subtype choices\n/subtype NUMBER — select a dispute subtype\n/approve — approve the displayed revision and download extension JSON\n/json — unreviewed draft with research\n/research — official guidance with footnotes\n/new or /delete — clear the server draft and consent\n/help — these instructions";

export function researchFootnotes(research: Research): string {
	const urls: string[] = [];
	const titles: string[] = [];
	const sections = research.sections.map(section => {
		const fields = (["guidance", "counterpoint", "missingInfo"] as const).map(key => {
			const marks = (section.fieldSources[key] || []).map(source => {
				let index = urls.indexOf(source.url);
				if (index < 0) { index = urls.push(source.url) - 1; titles.push(source.title); }
				return `[${index + 1}]`;
			}).join("");
			return `${key}: ${section[key]} ${marks}`;
		});
		return `${section.title} (${section.status})\n${section.error || ""}\n${fields.join("\n")}`;
	});
	return `Research: ${research.mode}; ${research.retrievedAt}\n\n${sections.join("\n\n")}\n\nSources\n${urls.map((url, i) => `[${i + 1}] ${titles[i]}: ${url}`).join("\n")}`;
}

export async function handleTelegramMessage(session: Session, message: TelegramMessage, io: BotIO) {
	const text = message.text?.trim() || "";
	const command = text.split(/\s/)[0].split("@")[0].toLowerCase();
	if (["/start", "/help"].includes(command)) { await io.say(help); return; }
	if (["/new", "/delete"].includes(command)) {
		for (const key of Object.keys(session)) delete (session as unknown as Record<string, unknown>)[key];
		Object.assign(session, newSession());
		await io.say("Server draft cleared. /consent to start again. Existing Telegram messages and downloads are not deleted."); return;
	}
	if (command === "/consent") { session.consent = true; await io.say("Send your account by text or voice. Include what happened and the outcome you want."); return; }
	if (!session.consent) { await io.say(help); return; }
	if (command === "/json") {
		await io.document("clearclaim-draft.json", JSON.stringify({ version: 1, userReviewed: false, ...session }, null, 2)); return;
	}
	if (["/review", "/subtype", "/approve", "/research"].includes(command)) {
		if (!session.draft) { await io.say("Send your account first."); return; }
		const options = sctOptionsForClaimType(session.draft.claimType);
		if (command === "/review") {
			const fields = Object.entries(filingFields).map(([key, label]) => {
				const value = session.draft![key as keyof Draft];
				return `${label}: ${value || "[not supplied]"}${validField(key, value) ? "" : " (excluded from export)"}`;
			});
			await io.say(`Review revision ${session.revision}. Reply with corrections before approving.\n\n${fields.join("\n\n")}\n\nChoose /subtype NUMBER:\n${options.map((o, i) => `${i + 1}. ${o.groupId}: ${o.label}`).join("\n")}\n\nThen /approve to confirm the displayed valid fields and subtype.`);
			session.reviewedRevision = session.revision; return;
		}
		if (command === "/subtype") {
			const arg = text.split(/\s+/)[1] || "";
			const index = Number(arg) - 1;
			if (!/^\d+$/.test(arg) || !options[index]) { await io.say("Use /review to see valid subtype numbers."); return; }
			session.subtype = index; await io.say(`Selected ${options[index].groupId}: ${options[index].label}. /approve confirms this subtype and the reviewed fields.`); return;
		}
		if (command === "/approve") {
			if (session.reviewedRevision !== session.revision || session.subtype === undefined || !options[session.subtype]) {
				await io.say("Use /review and /subtype NUMBER before approving the current draft."); return;
			}
			const reviews = initialReviews(session.draft, "ai-organised");
			for (const review of Object.values(reviews)) if (review) review.review = "approved";
			const pack = approvedPackage(session.draft, reviews, [options[session.subtype]]);
			await io.document("clearclaim-cjts.json", JSON.stringify(pack, null, 2));
			await io.say("Download clearclaim-cjts.json on your computer, open the Clearclaim Chrome extension, and import the file. Review the populated CJTS fields before submitting. Research and original evidence are separate from this filing package."); return;
		}
		if (!process.env.EXA_API_KEY) { await io.say("Exa research is not configured on this server."); return; }
		session.research = await researchClaim(session.draft, []);
		const report = researchFootnotes(session.research);
		await io.say(report);
		await io.document("clearclaim-research.txt", report); return;
	}
	if (command.startsWith("/")) { await io.say("Unknown command. Use /help."); return; }
	let account = text;
	if (message.voice) {
		// if (message.voice.duration > 60 || (message.voice.file_size || 0) > MAX_AUDIO_BYTES) { await io.say("Send a voice note of up to 60 seconds and 10 MB."); return; }
		const audio = await io.voice(message.voice.file_id);
		account = (await transcribeRecording(audio, "ogg")).trim();
		if (account) await io.say(`Transcript — correct any mistakes in your next message:\n${account}`);
	}
	if (!account) { await io.say("Send text or a Telegram voice note."); return; }
	const original = [session.original, session.question ? `Question: ${session.question}\nAnswer: ${account}` : account].filter(Boolean).join("\n\n");
	if (original.length > 30000) { await io.say("This conversation has reached 30,000 characters. Export with /json, then /new to start another draft."); return; }
	const result = finishConversation(await organiseConversationWithOpenAI(original, "", []), original);
	session.original = original; session.draft = result.draft;
	session.revision++; delete session.reviewedRevision; delete session.subtype; delete session.research;
	let question = result.followUp;
	try { question = await conversationQuestionWithOpenAI(result.draft, original, question); } catch { /* Keep the shared deterministic follow-up when generation fails. */ }
	session.question = question;
	await io.say(`Draft updated (revision ${session.revision}).\n\n${result.draft.summary}\n\n${question}\n\nReply with details, or /review, /research, /json.`);
}
