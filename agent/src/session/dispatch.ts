import type { AgentBehavior, CustomAgentRegistry } from "../agents/definition.js";

/**
 * Resolve a spawned role label to the primitive behavior that runs it. Custom
 * agents are looked up in the registry (their behavior is explicit); built-in
 * roles map by their conventional label prefix (the planner emits e.g.
 * "pricer-uniswap", "executor", "monitor", "comms"). Returns `undefined` for a
 * role with no known runtime — the session records it as undispatched rather than
 * guessing.
 */
export function resolveBehavior(
  role: string,
  registry?: CustomAgentRegistry,
): AgentBehavior | undefined {
  const custom = registry?.get(role);
  if (custom) return custom.behavior;
  if (/^pricer(-|$)/.test(role)) return "pricer";
  if (/^monitor(-|$)/.test(role)) return "monitor";
  if (/^executor(-|$)/.test(role)) return "executor";
  if (/^comms(-|$)/.test(role)) return "comms";
  if (/^inference(-|$)/.test(role)) return "inference";
  return undefined;
}
