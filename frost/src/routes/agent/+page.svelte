<script lang="ts">
  import { createEmbeddedSession } from "$lib/agent/session";
  import { eoaProvisioner, simulatedIssuer } from "$lib/agent/holders";
  import { createLiveRootMandate, liveSdkIssuer } from "$lib/agent/live";
  import { TauriKeyStore } from "$lib/key-store";
  import type { CompiledSpec, SubMandateIssuer } from "@frost/agent/browser";
  import * as Card from "$lib/components/ui/card";
  import * as Alert from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

  // The embedded runtime runs the OpenRouter thinking path + Venice reads + Discord
  // comms live over the webview fetch. Sub-mandate ISSUANCE is simulated here
  // (`simulatedIssuer`) — the live chain write is gated on the wallet bridge.
  let openRouterApiKey = $state("");
  let veniceApiKey = $state("");
  let discordWebhookUrl = $state("");
  let model = $state("openai/gpt-4o-mini");

  // Optional LIVE issuance on Base Sepolia: paste a funded session key to create a
  // real root mandate and issue real sub-mandates. Empty ⇒ simulated issuance.
  let sessionKey = $state("");
  let rpcUrl = $state("https://base-sepolia.publicnode.com");

  let pending = $state(false);
  let resultText = $state("");
  let errorText = $state("");

  // A sample signed session spec — compares quotes and reports to Discord.
  const spec: CompiledSpec = {
    description: "Compare WETH→USDC quotes across DEXes and report the best rate to Discord.",
    spendCapTotal: 50_000_000n,
    hitlThreshold: 5_000_000n,
    slippageBps: 50,
    expiryUnixSeconds: BigInt(Math.floor(Date.now() / 1000) + 86_400),
    redelegationBounds: { maxSubMandates: 6, maxAggregateBudget: 50_000_000n },
    rateLimit: { capacity: 10, refillRatePerSec: 1 },
    commsTemplate: { text: "Best WETH→USDC route reported (sample).", variables: [] },
  };

  async function runCycle() {
    pending = true;
    resultText = "";
    errorText = "";
    try {
      let issue: SubMandateIssuer;
      let rootMandateId = ("0x" + "b".repeat(64)) as `0x${string}`;
      let header = "";

      if (sessionKey.trim()) {
        // LIVE: create the root mandate on-chain, then issue sub-mandates under it.
        const pk = (sessionKey.startsWith("0x") ? sessionKey : "0x" + sessionKey) as `0x${string}`;
        const root = await createLiveRootMandate({ sessionPrivateKey: pk, rpcUrl, spec });
        rootMandateId = root.rootMandateId;
        issue = liveSdkIssuer({ sessionPrivateKey: pk, rpcUrl });
        header = `LIVE root mandate ${root.rootMandateId}\n  tx ${root.txHash}\n\n`;
      } else {
        issue = simulatedIssuer();
        header = "Simulated issuance (no session key).\n\n";
      }

      const { session } = createEmbeddedSession({
        spec,
        sessionId: ("0x" + "a".repeat(64)) as `0x${string}`,
        rootMandateId,
        openRouterApiKey,
        model,
        veniceApiKey,
        discordWebhookUrl: discordWebhookUrl || undefined,
        issue,
        provisionHolder: eoaProvisioner(new TauriKeyStore()),
      });

      const res = await session.runCycle({ kind: "session-start" });
      // BigInt-safe stringify for the audit/outcome view.
      resultText =
        header +
        JSON.stringify(res, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
    } catch (e) {
      errorText = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    } finally {
      pending = false;
    }
  }
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-4 p-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>Master-agent session (embedded)</Card.Title>
      <Card.Description>
        Runs one planning cycle of the embedded <code>@frost/agent</code> runtime: OpenRouter
        plans the sub-agents, the runtime issues them (simulated), and the pricer/comms
        runtimes run live. Issuance is simulated pending the wallet bridge.
      </Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
      <div class="grid gap-1.5">
        <Label for="or">OpenRouter API key</Label>
        <Input id="or" type="password" bind:value={openRouterApiKey} placeholder="sk-or-…" />
      </div>
      <div class="grid gap-1.5">
        <Label for="model">Model</Label>
        <Input id="model" bind:value={model} />
      </div>
      <div class="grid gap-1.5">
        <Label for="venice">Venice API key</Label>
        <Input id="venice" type="password" bind:value={veniceApiKey} placeholder="for pricer/monitor reads" />
      </div>
      <div class="grid gap-1.5">
        <Label for="discord">Discord webhook URL (optional)</Label>
        <Input id="discord" bind:value={discordWebhookUrl} placeholder="https://discord.com/api/webhooks/…" />
      </div>
      <div class="grid gap-1.5">
        <Label for="sk">Session key — LIVE issuance on Base Sepolia (optional)</Label>
        <Input id="sk" type="password" bind:value={sessionKey} placeholder="empty ⇒ simulated; funded key ⇒ real root + sub mandates" />
      </div>
      {#if sessionKey.trim()}
        <div class="grid gap-1.5">
          <Label for="rpc">Base Sepolia RPC</Label>
          <Input id="rpc" bind:value={rpcUrl} />
        </div>
      {/if}
      <Button onclick={runCycle} disabled={pending || !openRouterApiKey || !veniceApiKey}>
        {#if pending}<Loader2 class="mr-2 size-4 animate-spin" />{/if}
        Run planning cycle
      </Button>
    </Card.Content>
  </Card.Root>

  {#if errorText}
    <Alert.Root variant="destructive">
      <TriangleAlert class="size-4" />
      <Alert.Title>Cycle failed</Alert.Title>
      <Alert.Description>{errorText}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if resultText}
    <Card.Root>
      <Card.Header><Card.Title>Cycle result</Card.Title></Card.Header>
      <Card.Content>
        <Textarea class="font-mono text-xs" rows={20} readonly value={resultText} />
      </Card.Content>
    </Card.Root>
  {/if}
</div>
