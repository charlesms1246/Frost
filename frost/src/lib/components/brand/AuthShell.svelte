<script lang="ts" module>
  import type { Snippet } from "svelte";

  export type AuthShellProps = {
    /** Big headline on the art panel. */
    quote?: string;
    /** Supporting line under the headline. */
    subquote?: string;
    /** Optional theme image behind the gradient on the art panel. */
    image?: string;
    children: Snippet;
  };
</script>

<script lang="ts">
  import GradientBackdrop from "./GradientBackdrop.svelte";
  import Logo from "./Logo.svelte";

  let {
    quote = "Web3 Native Agent Ecosystem",
    subquote = "Describe the workflow. Frost runs it on a leash you control.",
    image,
    children,
  }: AuthShellProps = $props();
</script>

<div class="grid h-[calc(100vh-36px)] w-full overflow-hidden lg:grid-cols-2">
  <!-- Art panel (hidden on small screens) — fixed; only the form panel scrolls. -->
  <aside class="relative hidden overflow-hidden lg:block">
    <GradientBackdrop intensity="vivid" {image} />
    <div class="relative z-10 flex h-full flex-col justify-between p-10">
      <Logo size={28} mono />
      <div class="max-w-md">
        <h2
          class="text-balance text-4xl font-semibold leading-tight tracking-tight text-foreground drop-shadow"
        >
          {quote}
        </h2>
        <p class="mt-4 text-sm text-muted-foreground">{subquote}</p>
      </div>
    </div>
  </aside>

  <!-- Form panel (scroll-safe: centers short content, scrolls tall content) -->
  <main class="overflow-y-auto bg-background">
    <div class="flex min-h-full items-center justify-center px-6 py-12">
      <div class="w-full max-w-sm">
        <div class="mb-8 lg:hidden">
          <Logo size={28} />
        </div>
        {@render children()}
      </div>
    </div>
  </main>
</div>
