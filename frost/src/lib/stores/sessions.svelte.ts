import { browser } from "$app/environment";
import type { CompiledSpec } from "@frost/agent/browser";
import type { SessionSnapshot } from "./agent-session.svelte";

/**
 * Persisted workflow sessions. Each compiled workflow is saved here so the user can
 * re-run it directly from the Runtime "Sessions" panel without going back to chat,
 * and the last run's full audit trail (the {@link SessionSnapshot}) is stored with it
 * so the tree / activity / usage / receipt survive navigation and reload — backing
 * Frost's "permanent audit trail" guarantee. localStorage-backed; cloud-sync later.
 */
export type StoredSession = {
  id: string;
  title: string;
  workflow: string;
  spec: CompiledSpec;
  createdAt: number;
  updatedAt: number;
  /** The audit trail of the most recent run, if any. */
  run?: { at: number; snapshot: SessionSnapshot };
};

const STORAGE_KEY = "frost.sessions";
const MAX_SESSIONS = 20;

// CompiledSpec and the snapshot carry bigints (USDC base units), which JSON drops —
// tag them on write and revive them on read.
function replacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? { $bigint: v.toString() } : v;
}
function reviver(_k: string, v: unknown): unknown {
  if (v && typeof v === "object" && typeof (v as { $bigint?: unknown }).$bigint === "string") {
    return BigInt((v as { $bigint: string }).$bigint);
  }
  return v;
}

function load(): StoredSession[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw, reviver);
    return Array.isArray(parsed) ? (parsed as StoredSession[]) : [];
  } catch {
    return [];
  }
}

function titleOf(workflow: string, spec: CompiledSpec): string {
  const src = (workflow || spec.description || "Untitled workflow").trim();
  return src.length > 64 ? src.slice(0, 61) + "…" : src;
}

function createSessions() {
  let items = $state<StoredSession[]>(load());

  function persist(): void {
    if (!browser) return;
    try {
      const newest = [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newest, replacer));
    } catch {
      /* quota / serialization — keep the in-memory copy */
    }
  }

  return {
    /** Newest first. */
    get list(): StoredSession[] {
      return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    get(id: string): StoredSession | undefined {
      return items.find((s) => s.id === id);
    },
    /** Create or update a session's spec/workflow. Returns its (stable) id. */
    upsert(input: { id?: string; workflow: string; spec: CompiledSpec }): string {
      const now = Date.now();
      const existing = input.id ? items.find((s) => s.id === input.id) : undefined;
      if (existing) {
        existing.workflow = input.workflow;
        existing.spec = input.spec;
        existing.title = titleOf(input.workflow, input.spec);
        existing.updatedAt = now;
        persist();
        return existing.id;
      }
      const id = globalThis.crypto?.randomUUID?.() ?? `s_${now}_${Math.random().toString(36).slice(2)}`;
      items.push({
        id,
        title: titleOf(input.workflow, input.spec),
        workflow: input.workflow,
        spec: input.spec,
        createdAt: now,
        updatedAt: now,
      });
      if (items.length > MAX_SESSIONS) {
        items = [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
      }
      persist();
      return id;
    },
    /** Persist a finished run's audit snapshot against a session. */
    saveRun(id: string, snapshot: SessionSnapshot): void {
      const s = items.find((x) => x.id === id);
      if (!s) return;
      s.run = { at: Date.now(), snapshot };
      s.updatedAt = Date.now();
      persist();
    },
    remove(id: string): void {
      items = items.filter((s) => s.id !== id);
      persist();
    },
  };
}

export const sessions = createSessions();
