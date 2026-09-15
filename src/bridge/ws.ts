// ws.ts — ponte WebSocket genérica. O app/agente disca em /bridge/agent?token=,
// autentica pelo wsToken (→ tenant), e mantém aberto. Recebe mensagens do canal
// empurradas pelo hub; envia com {type:"send", ...} → adapter.send do canal do tenant.

import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import { tenant as tenantDef, tenantByWsToken } from "./config";
import { adapterFor } from "./channels";
import { bridgeHub } from "./hub";

export function attachBridgeWebSocket(server: Server): void {
  // noServer + upgrade manual (o @hono/node-server engoliria o upgrade → 404).
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "", `http://${req.headers.host}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== "/bridge/agent") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (socket: WebSocket, req) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const token = url.searchParams.get("token") ?? undefined;
    const name = tenantByWsToken(token);
    if (!name) {
      socket.close(4001, "token invalido");
      return;
    }

    bridgeHub.registrar(name, socket);
    socket.send(JSON.stringify({ type: "welcome", tenant: name }));

    const pingTimer = iniciarHeartbeat(socket);

    socket.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg?.type === "send") void enviar(name, msg, socket);
    });

    const cleanup = () => {
      clearInterval(pingTimer);
      bridgeHub.remover(name, socket);
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });

  console.log("[bridge.ws] ponte WebSocket em /bridge/agent");
}

// Mínimo do que iniciarHeartbeat precisa de um socket — assim o teste usa um
// fake em vez de subir um servidor WebSocket real só pra testar timer.
export interface SocketComPingPong {
  readyState: number;
  on(evento: "pong", cb: () => void): unknown;
  ping(): void;
  terminate(): void;
}

// Keepalive + detecção de socket morto. Duas coisas numa: (1) ping periódico
// pra não deixar o ALB derrubar a conexão idle (idle timeout ~60s, daí os 30s
// default); (2) se o PONG não voltou desde o último ping, o socket é zumbi —
// terminate() força o 'close' e o hub esquece dele.
//
// Sem (2), um agente que morre abrupto (kill -9, OOM, crash de container)
// nunca dispara 'close'/'error' do lado do servidor — o TCP FIN não chega. O
// socket fica pra sempre no Set do hub contando como "ponte aberta", e
// `entregar()` manda mensagem pra ele como se fosse real (ela simplesmente vai
// pro vazio, sem erro nenhum). Visto ao vivo 15/09/2026: agent-industrial
// reiniciou várias vezes (instabilidade do Secrets Manager) e acabou com 3
// "pontes abertas" quando só devia ter 1 — as outras 2 eram exatamente isso.
//
// `intervaloMs` é parâmetro (não constante fixa) só pra o teste rodar sem
// esperar 30s de verdade — produção sempre usa o default.
export function iniciarHeartbeat(socket: SocketComPingPong, intervaloMs = 30_000): NodeJS.Timeout {
  let vivo = true;
  socket.on("pong", () => {
    vivo = true;
  });
  return setInterval(() => {
    if (socket.readyState !== 1 /* OPEN */) return;
    if (!vivo) {
      socket.terminate(); // dispara 'close' -> cleanup() de quem chamou
      return;
    }
    vivo = false;
    try {
      socket.ping();
    } catch {
      /* socket morrendo — o close handler limpa */
    }
  }, intervaloMs);
}

async function enviar(name: string, msg: any, socket: WebSocket): Promise<void> {
  const t = tenantDef(name);
  const adapter = adapterFor(t?.channel);
  const responder = (ok: boolean, extra: Record<string, unknown>) => {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({ type: "send_result", ok, ref: msg.ref ?? null, ...extra }));
    }
  };
  if (!t || !adapter) {
    responder(false, { error: "tenant/canal inválido" });
    return;
  }
  const r = await adapter.send(msg, t);
  responder(r.ok, { id: r.id ?? null, error: r.error ?? null });
  console.log(`[bridge.ws] tenant "${name}" enviou via ${adapter.name}: ${r.ok ? "ok" : r.error}`);
}
