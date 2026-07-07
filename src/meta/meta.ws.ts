// meta.ws.ts — servidor WebSocket da ponte com os apps internos.
//
// Anexa um WebSocketServer ao MESMO http.Server do Hono (path /meta/agent).
// O app (SAC) conecta em ws://<gateway>/meta/agent?token=<APP_TOKEN>, se autentica,
// e fica escutando. Recebe mensagens do Meta empurradas pelo hub e pode pedir
// ENVIO mandando {type:"send", phone_number_id, to, text} pela mesma ponte.

import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import axios from "axios";
import { metaConfig, appForToken, routeForNumber } from "./meta.config";
import { metaHub } from "./meta.hub";

export function attachMetaWebSocket(server: Server): void {
  // noServer + upgrade manual: o @hono/node-server responde os requests pelo
  // fetch adapter e engoliria o upgrade (404). Interceptamos o 'upgrade' do
  // http.Server ANTES, e só damos handshake no path /meta/agent.
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "", `http://${req.headers.host}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== "/meta/agent") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (socket: WebSocket, req) => {
    // Autentica pelo ?token= da URL de conexão.
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const token = url.searchParams.get("token") ?? undefined;
    const app = appForToken(token);

    if (!app) {
      console.warn("[meta.ws] conexão recusada — token inválido");
      socket.close(4001, "token invalido");
      return;
    }

    metaHub.registrar(app, socket);
    socket.send(JSON.stringify({ type: "welcome", app }));

    socket.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg?.type === "send") {
        void enviarParaMeta(msg, app, socket);
      }
    });

    socket.on("close", () => metaHub.remover(app, socket));
    socket.on("error", () => metaHub.remover(app, socket));
  });

  console.log("[meta.ws] ponte WebSocket em /meta/agent");
}

// App pediu envio pela ponte → relay pra Graph API do Meta. Devolve resultado
// pela mesma ponte (type:"send_result", com ref pra o app casar a resposta).
async function enviarParaMeta(
  msg: { phone_number_id?: string; to?: string; text?: string; ref?: string },
  app: string,
  socket: WebSocket,
): Promise<void> {
  const { phone_number_id, to, text, ref } = msg;
  const route = routeForNumber(String(phone_number_id));
  const responder = (ok: boolean, extra: Record<string, unknown>) => {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({ type: "send_result", ok, ref: ref ?? null, ...extra }));
    }
  };

  if (!route?.token) {
    responder(false, { error: `sem token Meta pro número ${phone_number_id}` });
    return;
  }
  if (!to || !text) {
    responder(false, { error: "to e text são obrigatórios" });
    return;
  }

  try {
    const uri = `https://graph.facebook.com/${metaConfig.apiVersion}/${phone_number_id}/messages`;
    const resp = await axios.post(
      uri,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text, preview_url: false },
      },
      {
        headers: {
          Authorization: `Bearer ${route.token}`,
          "Content-Type": "application/json",
        },
      },
    );
    const waId = resp.data?.messages?.[0]?.id ?? null;
    responder(true, { wa_message_id: waId });
    console.log(`[meta.ws] app "${app}" enviou → ${phone_number_id} → ${to}: ok`);
  } catch (error: any) {
    const detail =
      error?.response?.data?.error?.message || error?.message || "erro desconhecido";
    responder(false, { error: detail });
    console.error(`[meta.ws] envio falhou (${phone_number_id} → ${to}):`, detail);
  }
}
