<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { profile } from "$lib/stores/profile.svelte";
  import { config } from "$lib/stores/config.svelte";
  import GradientBackdrop from "$lib/components/brand/GradientBackdrop.svelte";

  // Both Tauri windows load "/". We branch on the window LABEL:
  //  • "splashscreen" → show the preloader, then reveal the main window.
  //  • "main" (or a plain browser) → entry gate: redirect by saved profile.
  // The main window loads hidden, so its redirect happens before the splash
  // reveals it — the user lands straight on dashboard (returning) or signup.
  let mode = $state<"gate" | "splash">("gate");
  let progress = $state(0);

  async function finishSplash() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("finish_splash");
    } catch {
      /* not under Tauri — nothing to reveal */
    }
  }

  function runPreloader() {
    const DURATION = 1700;
    let raf = 0;
    let start = 0;
    let finished = false;
    const tick = (t: number) => {
      if (!start) start = t;
      progress = Math.min(100, ((t - start) / DURATION) * 100);
      if (progress < 100) raf = requestAnimationFrame(tick);
      else if (!finished) {
        finished = true;
        finishSplash();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }

  function redirect() {
    const dest = profile.signedIn ? (config.onboarded ? "/chat" : "/setup") : "/signup";
    goto(dest, { replaceState: true });
  }

  onMount(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      let label = "main";
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        label = getCurrentWindow().label;
      } catch {
        label = "main"; // plain browser (no Tauri) → behave as the gate
      }
      if (label === "splashscreen") {
        mode = "splash";
        cleanup = runPreloader();
      } else {
        mode = "gate";
        redirect();
      }
    })();
    return () => cleanup?.();
  });
</script>

{#if mode === "splash"}
  <div class="splash">
    <GradientBackdrop intensity="vivid" />
    <div class="content">
      <img src="/frost-logo.svg" alt="Frost" class="mark" draggable="false" />
      <h1 class="wordmark">FROST</h1>
      <p class="tagline">Agentic web3 automation</p>
    </div>
    <div class="loader" aria-label="Loading">
      <div class="bar" style={`width:${progress}%`}></div>
    </div>
  </div>
{:else}
  <!-- Entry gate: invisible (main window is hidden), just redirects. -->
  <div class="gate"><GradientBackdrop intensity="subtle" /></div>
{/if}

<style>
  .gate {
    position: relative;
    height: 100vh;
    width: 100%;
  }
  .splash {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--background);
    -webkit-user-select: none;
    user-select: none;
  }
  .content {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
  .mark {
    width: 72px;
    height: 72px;
    filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.35));
    animation: rise 600ms ease-out both;
  }
  .wordmark {
    margin-top: 14px;
    font-family: "Frost Display", var(--font-sans);
    font-size: 40px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--foreground);
    animation: rise 600ms 80ms ease-out both;
  }
  .tagline {
    margin-top: 2px;
    font-size: 12px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted-foreground);
    animation: rise 600ms 160ms ease-out both;
  }
  .loader {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
    height: 4px;
    background: color-mix(in oklab, var(--foreground) 8%, transparent);
  }
  .bar {
    height: 100%;
    background: linear-gradient(90deg, #b7f4ff, #7694e6, #6377df);
    box-shadow: 0 0 12px color-mix(in oklab, #7694e6 60%, transparent);
    transition: width 80ms linear;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mark,
    .wordmark,
    .tagline {
      animation: none;
    }
  }
</style>
