import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import IORedis from "ioredis";
import { setProBotBroadcaster } from "./services/botEngineService.js";

const botSubscribers = new Map<number, Set<WebSocket>>();

function sendToSubscribers(proBotId: number, payload: any) {
  const clients = botSubscribers.get(proBotId);
  if (!clients) return;
  const message = JSON.stringify(payload);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  // Redis subscriber — receives ALL broadcasts (both from API process and worker process)
  const redisSub = new IORedis({
    host: process.env.REDIS_HOST || "redis",
    port: 6379,
  });

  redisSub.psubscribe("probot:*", (err) => {
    if (err) console.error("[Redis] psubscribe error:", err);
    else console.log("[Redis] Subscribed to probot:* channel");
  });

  redisSub.on("pmessage", (_pattern, channel, message) => {
    const proBotId = parseInt(channel.split(":")[1]);
    if (isNaN(proBotId)) return;
    try {
      sendToSubscribers(proBotId, JSON.parse(message));
    } catch {}
  });

  // Set localBroadcast to no-op — Redis is the single delivery path.
  setProBotBroadcaster(() => {});

  // ── Ping/Pong Heartbeat to keep connections alive through proxies ──────────
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) {
        // Cleanup dead connection map entries manually
        if (ws.currentSubscribedBotId && botSubscribers.has(ws.currentSubscribedBotId)) {
          botSubscribers.get(ws.currentSubscribedBotId)?.delete(ws);
        }
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  wss.on("connection", (ws: any) => {
    ws.isAlive = true;
    ws.currentSubscribedBotId = null;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "subscribe_bot" && msg.proBotId) {
          const botId = Number(msg.proBotId);
          if (ws.currentSubscribedBotId && botSubscribers.has(ws.currentSubscribedBotId)) {
            botSubscribers.get(ws.currentSubscribedBotId)?.delete(ws);
          }
          ws.currentSubscribedBotId = botId;
          if (!botSubscribers.has(botId)) botSubscribers.set(botId, new Set());
          botSubscribers.get(botId)?.add(ws);
        }
      } catch {}
    });

    ws.on("close", () => {
      if (ws.currentSubscribedBotId && botSubscribers.has(ws.currentSubscribedBotId)) {
        botSubscribers.get(ws.currentSubscribedBotId)?.delete(ws);
      }
    });
  });
}