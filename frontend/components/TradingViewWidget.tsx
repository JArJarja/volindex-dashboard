// components/TradingViewWidget.tsx
import { useEffect, useRef } from "react";

interface Props {
  symbol: string;
  height?: number;
}

export default function TradingViewWidget({ symbol, height = 340 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Vider le conteneur avant chaque changement de symbole
    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: symbol,
      interval: "15",
      timezone: "Europe/Paris",
      theme: "dark",
      style: "1",
      locale: "fr",
      allow_symbol_change: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
      backgroundColor: "#0f1117",
      gridColor: "#1e2130",
    });

    containerRef.current.appendChild(script);
    scriptRef.current = script;

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [symbol]);

  return (
    <div className="tradingview-widget-container" ref={containerRef}
      style={{ height, width: "100%" }}>
      <div className="tradingview-widget-container__widget"
        style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
