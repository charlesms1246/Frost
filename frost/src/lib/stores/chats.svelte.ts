import { browser } from "$app/environment";

/** A message in a master-agent conversation. `content` matches the inference ChatMessage. */
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type Conversation = {
	id: string;
	title: string;
	createdAt: number;
	messages: ChatMessage[];
	/**
	 * The most recent COMPILED workflow sentence from the master agent (not a raw user
	 * message). Persisted so the "Run on Runtime Manager" button survives an app reload.
	 */
	lastWorkflow?: string;
	/**
	 * The most recent COMPILED spec, serialized (bigints as strings). Lets a run after a
	 * reload use the EXACT reviewed spec — caveats + comms template included — instead of
	 * recompiling the sentence (which loses the interactively-built comms binding).
	 */
	lastSpec?: string;
};

const STORAGE_KEY = "frost.chats";

function uid(): string {
	if (browser && "randomUUID" in crypto) return crypto.randomUUID();
	return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function now(): number {
	return browser ? Date.now() : 0;
}

function load(): Conversation[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as Conversation[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function titleFrom(text: string): string {
	const t = text.trim().replace(/\s+/g, " ");
	return t.length > 40 ? t.slice(0, 40) + "…" : t || "New chat";
}

function createChats() {
	const initial = load();
	let conversations = $state<Conversation[]>(initial);
	let currentId = $state<string | undefined>(initial[0]?.id);

	function persist() {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
	}

	return {
		/** Most-recent first. */
		get list() {
			return [...conversations].sort((a, b) => b.createdAt - a.createdAt);
		},
		get currentId() {
			return currentId;
		},
		get current(): Conversation | undefined {
			return conversations.find((c) => c.id === currentId);
		},
		/** Start a fresh (unsaved-until-first-message) conversation. */
		newChat() {
			currentId = undefined;
		},
		select(id: string) {
			currentId = id;
		},
		remove(id: string) {
			conversations = conversations.filter((c) => c.id !== id);
			if (currentId === id) currentId = conversations[0]?.id;
			persist();
		},
		/** Append a message to the current conversation, creating it on the first turn. */
		append(msg: ChatMessage) {
			let conv = conversations.find((c) => c.id === currentId);
			if (!conv) {
				conv = {
					id: uid(),
					title: msg.role === "user" ? titleFrom(msg.content) : "New chat",
					createdAt: now(),
					messages: [],
				};
				conversations = [conv, ...conversations];
				currentId = conv.id;
			}
			conv.messages = [...conv.messages, msg];
			conversations = [...conversations];
			persist();
		},
		/** Persist the compiled workflow sentence (+ optional serialized spec) on the current conversation. */
		setWorkflow(workflow: string, serializedSpec?: string) {
			const conv = conversations.find((c) => c.id === currentId);
			if (!conv) return;
			conv.lastWorkflow = workflow;
			if (serializedSpec !== undefined) conv.lastSpec = serializedSpec;
			conversations = [...conversations];
			persist();
		},
		clearAll() {
			conversations = [];
			currentId = undefined;
			persist();
		},
		/** Replace all conversations (used by cloud-sync restore on sign-in). */
		hydrate(next: Conversation[]) {
			conversations = Array.isArray(next) ? next : [];
			currentId = conversations[0]?.id;
			persist();
		},
	};
}

export const chats = createChats();
