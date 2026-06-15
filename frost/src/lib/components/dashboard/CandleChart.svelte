<script lang="ts">
  import { onMount } from "svelte";
  import {
    createChart,
    CandlestickSeries,
    type IChartApi,
    type ISeriesApi,
    type CandlestickData,
    type UTCTimestamp,
  } from "lightweight-charts";
  import type { Candle } from "$lib/agent/token-prices";

  let { candles }: { candles: Candle[] } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let chart: IChartApi | undefined;
  let series: ISeriesApi<"Candlestick"> | undefined;

  function isDark() {
    return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  }

  function applyTheme() {
    if (!chart) return;
    const dark = isDark();
    const text = dark ? "rgba(228,228,231,0.7)" : "rgba(63,63,70,0.7)";
    const grid = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
    chart.applyOptions({
      layout: { background: { color: "transparent" }, textColor: text, attributionLogo: false },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: grid },
      timeScale: { borderColor: grid },
    });
  }

  onMount(() => {
    if (!container) return;
    chart = createChart(container, { autoSize: true, handleScale: false, handleScroll: false });
    series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });
    applyTheme();

    // Re-theme when the app toggles the `.dark` class.
    const obs = new MutationObserver(applyTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      obs.disconnect();
      chart?.remove();
      chart = undefined;
      series = undefined;
    };
  });

  // Push new data whenever the candles change.
  $effect(() => {
    if (!series || candles.length === 0) return;
    series.setData(candles as unknown as CandlestickData<UTCTimestamp>[]);
    chart?.timeScale().fitContent();
  });
</script>

<div bind:this={container} class="h-full w-full"></div>
