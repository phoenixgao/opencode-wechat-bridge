import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface SessionRow {
	id: string;
	parentID: string | null;
	directory: string;
	title: string;
	time: { created: number; updated: number };
}

export function defaultDbPath(): string {
	if (process.env.OPENCODE_WECHAT_DB_PATH)
		return process.env.OPENCODE_WECHAT_DB_PATH;

	const dataDir = path.join(
		process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
		"opencode",
	);

	const opencodeDb = process.env.OPENCODE_DB;
	if (opencodeDb) {
		if (opencodeDb === ":memory:" || path.isAbsolute(opencodeDb))
			return opencodeDb;
		return path.join(dataDir, opencodeDb);
	}

	return path.join(dataDir, "opencode.db");
}

export function loadAllSessionsFromDisk(
	dbPath: string = defaultDbPath(),
	limit = 100,
): SessionRow[] {
	if (!fs.existsSync(dbPath)) return [];
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const rows = db
			.prepare(
				`SELECT id, parent_id AS parentID, directory, title, time_created, time_updated
         FROM session
         WHERE parent_id IS NULL AND time_archived IS NULL
         ORDER BY time_updated DESC
         LIMIT ?`,
			)
			.all(limit) as Array<{
			id: string;
			parentID: string | null;
			directory: string;
			title: string;
			time_created: number;
			time_updated: number;
		}>;
		return rows.map((r) => ({
			id: r.id,
			parentID: r.parentID,
			directory: r.directory,
			title: r.title,
			time: {
				created: Number(r.time_created),
				updated: Number(r.time_updated),
			},
		}));
	} finally {
		db.close();
	}
}

export function findSessionById(
	sessions: SessionRow[],
	id: string,
): SessionRow | null {
	return sessions.find((s) => s.id === id) ?? null;
}

export function newestSession(sessions: SessionRow[]): SessionRow | null {
	if (sessions.length === 0) return null;
	return (
		[...sessions].sort(
			(a, b) =>
				(b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created),
		)[0] ?? null
	);
}

export function formatGroupedSessions(
	sessions: SessionRow[],
	currentId: string | null,
	limit = 10,
	home: string = os.homedir(),
): { text: string; ids: string[] } {
	const top = sessions.slice(0, limit);
	const byDir = new Map<string, SessionRow[]>();
	for (const s of top) {
		const arr = byDir.get(s.directory) ?? [];
		arr.push(s);
		byDir.set(s.directory, arr);
	}
	const lines: string[] = [];
	const ids: string[] = [];
	let n = 0;
	for (const [dir, group] of byDir) {
		const short = dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
		lines.push(`📁 ${short}`);
		for (const s of group) {
			n++;
			ids.push(s.id);
			const marker = s.id === currentId ? "▶" : " ";
			const updated = new Date(s.time.updated ?? s.time.created)
				.toISOString()
				.replace("T", " ")
				.slice(0, 19);
			lines.push(`${marker} ${n}. ${s.title || "(untitled)"}`);
			lines.push(`     ${s.id} | ${updated}`);
		}
		lines.push("");
	}
	return { text: lines.join("\n").trimEnd(), ids };
}

export function parseSwitchArg(
	arg: string | undefined,
	listIds: string[],
): { sessionId: string } | { error: string } {
	if (!arg) return { error: "usage: /switch <num|ses_xxx>" };
	if (arg.startsWith("ses_")) return { sessionId: arg };
	const n = Number(arg);
	if (!Number.isInteger(n) || n < 1) return { error: `invalid index: ${arg}` };
	const id = listIds[n - 1];
	if (!id) return { error: `index ${n} out of range (have ${listIds.length})` };
	return { sessionId: id };
}

const ROUTING_PREFIX = /^\s*opencode\s*[:：]\s*/i;
export function stripRoutingPrefix(text: string): string {
	return text.replace(ROUTING_PREFIX, "");
}

export function extractText(message: {
	item_list?: Array<{ type?: number; text_item?: { text?: string } }>;
}): string {
	if (!message?.item_list) return "";
	return message.item_list
		.filter((it) => it.type === 1)
		.map((it) => it.text_item?.text ?? "")
		.join("")
		.trim();
}
