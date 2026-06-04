/**
 * Browser-safe public surface of `@frost/agent` — everything the runtime exposes
 * EXCEPT the two Node-only 1Shot-backed modules (`wallet/oneshot.ts`,
 * `executor/oneshot-submitter.ts`), which import `@1shotapi/client-sdk` and so must
 * not enter a Vite/webview bundle. The webview embedding imports from
 * `@frost/agent/browser`; Node consumers use the default barrel (`index.ts`), which
 * re-exports this plus the 1Shot impls.
 *
 * The executor's logic (`Executor`, `preflightExecution`) and the
 * `TransactionSubmitter` SEAM are here — only the concrete 1Shot submitter is held
 * back (it is the deferred live-write path).
 */
export * from "./types.js";
export * from "./inference/openrouter.js";
export * from "./inference/venice-inference.js";
export * from "./inference/switching.js";
export {
  buildReceipt,
  hashLeaf,
  canonicalEntryJson,
  merkleRoot,
  merkleProof,
  verifyMerkleProof,
  type ReceiptEntry,
  type ReceiptEntryKind,
  type ReceiptInput,
  type SessionReceipt,
} from "./audit/receipt.js";
export {
  buildPlanningPrompt,
  parsePlannerOutput,
  PLANNING_PROMPT_VERSION,
  type PlannerOutput,
  type PromptInput,
} from "./planner/prompt.js";
export { Planner, type PlanInput, type PlannerConfig } from "./planner/planner.js";
export {
  translatePlan,
  nonceCounter,
  makeSdkIssuer,
  type CaveatEncoder,
  type DecisionEnricher,
  type HolderProvisioner,
  type NonceSource,
  type SubMandateIssuer,
  type TranslateDeps,
  type SpawnStatus,
  type SpawnOutcome,
  type TranslateResult,
} from "./translate/translate.js";
export {
  enrichDecision,
  makeEnricher,
  type SessionContext,
} from "./orchestrate/enrich.js";
export {
  sessionContextFrom,
  type DeploymentConfig,
} from "./orchestrate/session-context.js";
export {
  BASE_SEPOLIA_DEPLOYMENT,
  BASE_SEPOLIA_PROVIDERS,
  BASE_SEPOLIA_SWAP_ROUTER_02,
  BASE_MAINNET_SWAP_ROUTER_02,
  DEFAULT_PER_CALL_CAP_USDC,
  deploymentConfigFor,
  surfaceFrom,
  type RouterCall,
} from "./orchestrate/deployment.js";
export {
  VeniceRpcClient,
  type RpcCall,
  type RpcResult,
  type RpcTransport,
  type VeniceRpcConfig,
} from "./pricer/venice-rpc.js";
export {
  Pricer,
  type QuoteRequest,
  type QuoteSource,
  type Quote,
  type FailedQuote,
  type QuoteResult,
} from "./pricer/pricer.js";
export {
  uniswapV3Source,
  type UniswapV3SourceOptions,
} from "./pricer/sources/uniswap-v3.js";
export {
  Monitor,
  type MonitorCondition,
  type MonitorResult,
  type MonitorOptions,
  type BlockTag,
} from "./monitor/monitor.js";
export {
  CommsAgent,
  type CommsRequest,
  type CommsResult,
  type CommsAgentDeps,
  type CommsPoster,
  type PostReceipt,
} from "./comms/comms.js";
export {
  AGENT_BEHAVIORS,
  BEHAVIOR_CAPABILITY,
  KNOWN_CAPABILITIES,
  validateDefinition,
  toSpawnCandidate,
  CustomAgentRegistry,
  type AgentBehavior,
  type CustomAgentDefinition,
} from "./agents/definition.js";
export {
  AgentDesigner,
  type DesignerConfig,
  type DesignResult,
} from "./agents/designer.js";
export {
  Session,
  type SessionState,
  type SessionConfig,
  type SpawnCycleResult,
  type RunOutcome,
  type RunContext,
  type SubAgentRunner,
  type SessionEvent,
  type SessionObserver,
} from "./session/session.js";
export { resolveBehavior } from "./session/dispatch.js";
export {
  buildDesignPrompt,
  parseDesignerOutput,
  DESIGN_PROMPT_VERSION,
  type DesignInput,
  type DesignerOutput,
} from "./agents/prompt.js";
export {
  escapeForSource,
  escapeUntrustedText,
  MAX_UNTRUSTED_LEN,
  type Resolved,
} from "./comms/escape.js";
export { DiscordWebhookPoster, type FetchLike as DiscordFetchLike } from "./comms/discord.js";
export {
  priceThresholdCondition,
  type PriceThresholdOptions,
} from "./monitor/conditions/price-threshold.js";
export {
  preflightExecution,
  type ProposedExecution,
  type Preflight,
} from "./executor/preflight.js";
export {
  Executor,
  type ExecutorMandate,
  type ExecutionRequest,
  type ExecutionResult,
  type ExecutorDeps,
  type RevocationGuard,
  type HitlApprovalRequest,
} from "./executor/executor.js";
export {
  type TransactionSubmitter,
  type OnchainCall,
  type SubmittedTx,
} from "./executor/submitter.js";
export {
  OneShotTransactionSubmitter,
  type OneShotContractMethodsApi,
} from "./executor/oneshot-submitter.js";
export {
  OneShotRestMethods,
  OneShotRestDelegations,
  type OneShotRestConfig,
  type OneShotFetch,
  type RedelegateResult,
} from "./executor/oneshot-rest.js";
export {
  encodeProposedCaveats,
  defaultCaveatEncoder,
} from "./translate/caveat-encoder.js";
export { type KeyStore, InMemoryKeyStore } from "./wallet/key-store.js";
export {
  WalletProvisioner,
  type WalletKind,
  type WalletHandle,
  type ServerWalletProvider,
  type WalletProvisionerOptions,
} from "./wallet/provisioner.js";
export { Compiler, type CompilerConfig } from "./compile/compiler.js";
export {
  buildCompilePrompt,
  parseCompilerOutput,
  COMPILE_PROMPT_VERSION,
  type CompilerOutput,
} from "./compile/prompt.js";
export {
  encodeRootCaveats,
  encodeCommsTemplate,
  canonicalCommsJson,
} from "./compile/encode.js";
export { renderCaveats, renderSpec } from "./compile/render.js";
export {
  PARANOID_DEFAULTS,
  DEFAULT_EXPIRY_SECS,
  HIGH_RISK_CEILINGS,
} from "./compile/defaults.js";
export {
  VARIABLE_SOURCES,
  type VariableSource,
  type CommsVariable,
  type CommsTemplate,
  type CompiledSpec,
  type Clarification,
  type Assumption,
  type CompileInput,
  type CompileResult,
} from "./compile/types.js";
