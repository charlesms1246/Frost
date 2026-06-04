<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { TauriKeyStore } from "$lib/key-store";
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";
  import * as Alert from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Separator } from "$lib/components/ui/separator";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

  type Operation = "echo" | "login" | "grant_permissions" | "revoke" | "commit";

  const OPERATION_LABELS: Record<Operation, string> = {
    echo: "echo (spike 7)",
    login: "login (spike 9 manual)",
    grant_permissions: "grant_permissions (spike 8)",
    revoke: "revoke",
    commit: "commit",
  };

  let operation = $state<Operation>("echo");
  let paramsText = $state("{}");
  let timeoutSecs = $state(120);

  let pending = $state(false);
  let resultText = $state("");
  let errorText = $state("");

  // Quick spec presets — call into the Rust permission_spec builders so the
  // Tauri side stays the single source of truth for the Flask 13.32 schema.
  async function loadSamplePermissionSpec() {
    errorText = "";
    try {
      const spec = await invoke("build_native_token_stream_permission", {
        args: {
          session_account: "0x0000000000000000000000000000000000000001",
          amount_per_second_hex: "0x1",
          max_amount_hex: "0x1",
          expiry_secs: 1800,
          justification: "Sample spec from /bridge harness",
        },
      });
      operation = "grant_permissions";
      paramsText = JSON.stringify(spec, null, 2);
    } catch (e) {
      errorText = "preset build failed: " + (typeof e === "string" ? e : JSON.stringify(e));
    }
  }

  async function run() {
    pending = true;
    resultText = "";
    errorText = "";
    try {
      let params: unknown = {};
      try {
        params = JSON.parse(paramsText);
      } catch (e) {
        errorText = "params is not valid JSON: " + String(e);
        pending = false;
        return;
      }
      const res = await invoke("wallet_bridge_perform", {
        args: { operation, params, timeout_secs: timeoutSecs },
      });
      resultText = JSON.stringify(res, null, 2);
    } catch (e) {
      errorText = typeof e === "string" ? e : JSON.stringify(e, null, 2);
    } finally {
      pending = false;
    }
  }

  // Exercises the OS-vault roundtrip through TauriKeyStore (set/has/get/delete)
  // against a throwaway key id. This is the only frontend check of the keyring
  // commands; run it under `npm run tauri dev`, not the browser-only dev server.
  let keyStoreResult = $state("");
  async function testKeyStore() {
    keyStoreResult = "running…";
    const ks = new TauriKeyStore();
    const id = `selftest:${crypto.randomUUID()}`;
    const secret = "0x" + "ab".repeat(32);
    const steps: string[] = [];
    try {
      await ks.set(id, secret);
      steps.push("set → ok");
      const has1 = await ks.has(id);
      steps.push(`has → ${has1}`);
      const got = await ks.get(id);
      steps.push(`get matches → ${got === secret}`);
      await ks.delete(id);
      const has2 = await ks.has(id);
      steps.push(`has after delete → ${has2}`);
      const gone = await ks.get(id);
      steps.push(`get after delete → ${gone === null ? "null" : "UNEXPECTED"}`);
      const pass = has1 && got === secret && !has2 && gone === null;
      keyStoreResult = `${pass ? "PASS" : "FAIL"}\n${steps.join("\n")}`;
    } catch (e) {
      keyStoreResult = `ERROR: ${e instanceof Error ? e.message : String(e)}\n${steps.join("\n")}`;
    }
  }
</script>

<main class="mx-auto max-w-2xl px-6 py-8 space-y-6">
  <a href="/" class="text-primary hover:underline inline-flex items-center gap-1 text-sm">
    <ArrowLeft class="size-4" /> Home
  </a>

  <div class="space-y-1">
    <h1 class="text-2xl font-semibold tracking-tight">Frost wallet bridge</h1>
    <p class="text-muted-foreground text-sm">
      Spike harness for Day-1 spikes 7, 8, 10. Pick an operation and click <span class="font-medium">Run</span>;
      the system browser will open to the hosted bridge page. Once the callback POSTs back, the
      result shows below.
    </p>
  </div>

  <Card.Root>
    <Card.Header>
      <Card.Title>Request</Card.Title>
      <Card.Description>JSON params are forwarded verbatim to the hosted page via <code class="text-xs">?params=</code>.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          run();
        }}
        class="space-y-4"
      >
        <div class="space-y-1.5">
          <Label for="operation">Operation</Label>
          <Select.Root type="single" bind:value={operation as string}>
            <Select.Trigger id="operation" class="w-full">
              {OPERATION_LABELS[operation]}
            </Select.Trigger>
            <Select.Content>
              {#each Object.entries(OPERATION_LABELS) as [value, label] (value)}
                <Select.Item {value}>{label}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <div class="space-y-1.5">
          <Label for="params">Params (JSON)</Label>
          <Textarea
            id="params"
            bind:value={paramsText}
            rows={8}
            class="font-mono text-xs"
            spellcheck={false}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onclick={loadSamplePermissionSpec}
            class="gap-1.5"
          >
            <Sparkles class="size-3.5" />
            Load sample native-token-stream permission
          </Button>
        </div>

        <Separator />

        <div class="space-y-1.5">
          <Label for="timeout">Timeout (s)</Label>
          <Input
            id="timeout"
            type="number"
            bind:value={timeoutSecs}
            min={10}
            max={600}
            class="w-32"
          />
        </div>

        <Button type="submit" disabled={pending} class="gap-1.5">
          {#if pending}
            <Loader2 class="size-4 animate-spin" />
            Waiting for browser…
          {:else}
            Run
          {/if}
        </Button>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>KeyStore self-test</Card.Title>
      <Card.Description>
        Roundtrips a throwaway key through the OS vault via <code class="text-xs">TauriKeyStore</code>
        (the <code class="text-xs">key_store_*</code> commands). Requires <code class="text-xs">npm run tauri dev</code>.
      </Card.Description>
    </Card.Header>
    <Card.Content class="space-y-3">
      <Button type="button" variant="secondary" size="sm" onclick={testKeyStore}>
        Run KeyStore roundtrip
      </Button>
      {#if keyStoreResult}
        <pre
          class="bg-muted text-muted-foreground overflow-auto rounded-md p-3 text-xs">{keyStoreResult}</pre>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if resultText}
    <Card.Root>
      <Card.Header>
        <Card.Title>Result</Card.Title>
      </Card.Header>
      <Card.Content>
        <pre
          class="bg-muted text-muted-foreground overflow-auto rounded-md p-3 text-xs">{resultText}</pre>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if errorText}
    <Alert.Root variant="destructive">
      <TriangleAlert />
      <Alert.Title>Error</Alert.Title>
      <Alert.Description>
        <pre class="text-xs whitespace-pre-wrap break-words">{errorText}</pre>
      </Alert.Description>
    </Alert.Root>
  {/if}
</main>
