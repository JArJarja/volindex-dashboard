// lib/wsClient.ts
import { useEffect, useRef, useState } from "react";
import type { TopRow } from "./api";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws";

export function useTopWS(onUpdate: (rows: TopRow[]) => void) {
  const ws = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    function connect() {
      ws.current = new WebSocket(WS_URL);

      ws.current.onopen = () => setConnected(true);
      ws.current.onclose = () => {
        setConnected(false);
        timer = setTimeout(connect, 3000); // reconnect
      };
      ws.current.onerror = () => ws.current?.close();
      ws.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "top_update" && Array.isArray(msg.data)) {
            onUpdate(msg.data);
          }
        } catch {}
      };
    }

    connect();
    return () => {
      clearTimeout(timer);
      ws.current?.close();
    };
  }, [onUpdate]);

  return connected;
}
