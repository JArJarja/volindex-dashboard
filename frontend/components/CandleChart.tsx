// components/CandleChart.tsx
import { useEffect, useRef } from "react";
import type { Candle, Indicators } from "../lib/api";

// Dynamic import guard for SSR
let LC: typeof import("lightweight-charts") | null = null;
if (typeof window !== "undefined") {
  LC = require("lightweight-charts");
}

interface Props {
  candles: Candle[];
  indicators: Indicators;
  symbol: string;
}

export default function CandleChart({ candles, indicators, symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || !LC || candles.length === 0) return;

    // Cleanup previous chart
    if (chartRef.current) {
      try { chartRef.current.remove(); } catch {}
      chartRef.current = null;
    }

    const chart = LC.createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 380,
      layout: {
        background: { type: LC.ColorType.Solid, color: "#0f1117" },
        textColor: "#7a8098",
      },
      grid: {
        vertLines: { color: "#1e2130" },
        horzLines: { color: "#1e2130" },
      },
      crosshair: {
        mode: LC.CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "#1e2130",
      },
      timeScale: {
        borderColor: "#1e2130",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Candle series
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#00e5b4",
      downColor: "#ff4d6d",
      borderUpColor: "#00e5b4",
      borderDownColor: "#ff4d6d",
      wickUpColor: "#00e5b4",
      wickDownColor: "#ff4d6d",
    });

    const candleData = candles.map((c) => ({
      time: c.t as any,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));
    candleSeries.setData(candleData);

    // Volume histogram
    const volumeSeries = chart.addHistogramSeries({
      color: "#1e2130",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(
      candles.map((c) => ({
        time: c.t as any,
        value: c.v,
        color: c.c >= c.o ? "rgba(0,229,180,0.3)" : "rgba(255,77,109,0.3)",
      }))
    );

    // MA20 line
    if (indicators.ma20 && candles.length > 0) {
      const maSeries = chart.addLineSeries({
        color: "#f0a500",
        lineWidth: 1,
        title: "MA20",
      });
      // Simple last-point display (full MA would require series data)
      const lastIdx = candles.length - 1;
      maSeries.setData([{ time: candles[lastIdx].t as any, value: indicators.ma20 }]);
    }

    // EMA20 line
    if (indicators.ema20 && candles.length > 0) {
      const emaSeries = chart.addLineSeries({
        color: "#a78bfa",
        lineWidth: 1,
        title: "EMA20",
      });
      const lastIdx = candles.length - 1;
      emaSeries.setData([{ time: candles[lastIdx].t as any, value: indicators.ema20 }]);
    }

    // Resize observer
    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(containerRef.current);

    chart.timeScale().fitContent();

    return () => {
      observer.disconnect();
      try { chart.remove(); } catch {}
    };
  }, [candles, indicators]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg border overflow-hidden"
      style={{ borderColor: "var(--border)", minHeight: 380 }}
    />
  );
}
