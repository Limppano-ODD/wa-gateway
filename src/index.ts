import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import moment from "moment";
import { globalErrorMiddleware } from "./middlewares/error.middleware";
import { notFoundMiddleware } from "./middlewares/notfound.middleware";
import { serve } from "@hono/node-server";
import { env } from "./env";
import { createSessionController } from "./controllers/session";
import * as whastapp from "wa-multi-session";
import { createMessageController } from "./controllers/message";
import { CreateWebhookProps } from "./webhooks";
import { createWebhookMessage } from "./webhooks/message";
import { createWebhookSession } from "./webhooks/session";
import { createProfileController } from "./controllers/profile";
import { serveStatic } from "@hono/node-server/serve-static";
import { createAdminController } from "./controllers/admin";
import { createDashboardController } from "./controllers/dashboard";
import { createLogoutController } from "./controllers/logout";
import { createStatusController } from "./controllers/status";
import { createAuthController } from "./controllers/auth";
import { scheduleBackups } from "./utils/db-backup";
import { createBridgeController } from "./bridge/controller";
import { attachBridgeWebSocket } from "./bridge/ws";
import fs from "fs";
import path from "path";
// Initialize database
import "./database/db";



type Variables = {
  user: User;
};

const app = new Hono<{ Variables: Variables }>();

app.use(
  logger((...params) => {
    params.map((e) => console.log(`${moment().toISOString()} | ${e}`));
  })
);
app.use(cors());

app.onError(globalErrorMiddleware);
app.notFound(notFoundMiddleware);

/**
 * Welcome page
 */
app.get("/", (c) => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, "views", "index.html"),
    "utf-8"
  );
  return c.html(indexHtml);
});

/**
 * serve media message static files
 */
app.use(
  "/media/*",
  serveStatic({
    root: "./",
  })
);

/**
 * Health check endpoint for Docker
 */
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * logout route — PÚBLICA, sem basicAuthMiddleware. Ver src/controllers/logout.ts.
 */
app.route("/logout", createLogoutController());
/**
 * status routes — verdade sobre as sessões, para o monitoramento.
 * Separado do /health de propósito: ver src/controllers/status.ts.
 */
app.route("/status", createStatusController());
/**
 * auth routes — login Microsoft (Entra ID) para humano no browser.
 * PUBLICAS: sao elas que concedem a credencial, entao exigi-la aqui seria
 * circular. Ver src/controllers/auth.ts.
 */
app.route("/auth", createAuthController());
/**
 * dashboard routes
 */
app.route("/dashboard", createDashboardController());
/**
 * admin routes
 */
app.route("/admin", createAdminController());
/**
 * session routes
 */
app.route("/session", createSessionController());
/**
 * message routes
 */
app.route("/message", createMessageController());
/**
 * profile routes
 */
app.route("/profile", createProfileController());

/**
 * bridge routes — ponte multi-canal (whatsapp, teams...) via /ingress/:tenant
 */
app.route("/", createBridgeController());

const port = env.PORT;

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);

// Anexa a ponte WebSocket genérica ao mesmo http.Server (path /bridge/agent).
attachBridgeWebSocket(server as unknown as import("node:http").Server);

whastapp.onConnected((session) => {
  console.log(`session: '${session}' connected`);
});

// Implement Per-User Webhook
import { User, userDb, sessionDb } from "./database/db";
import axios from "axios";
import { MessageReceived } from "wa-multi-session";
import { messageStore } from "./utils/message-store";
import { getWebhookAuthHeaders } from "./utils/webhook-auth";

// Helper function to get user for a session
// Since session names now always match usernames, we look up by username
const getUserForSession = (sessionName: string): User | null => {
  const user = userDb.getUserByUsername(sessionName);
  return user || null;
};

// Helper function to send webhook with authentication support
async function sendWebhookWithAuth(
  url: string,
  body: any,
  user: User | null
): Promise<void> {
  try {
    const headers: any = {
      "Content-Type": "application/json",
    };

    // Add authentication headers based on user's webhook auth configuration
    const authHeaders = await getWebhookAuthHeaders(user);
    Object.assign(headers, authHeaders);

    // Send to webhook URL exactly as configured (no modifications)
    await axios.post(url, body, { headers });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`Failed to send webhook to ${url}:`, error.message);
    } else {
      console.error(`Failed to send webhook to ${url}:`, error);
    }
  }
}

// Message webhook with per-user callbacks
whastapp.onMessageReceived(async (message: MessageReceived) => {
  // Store message for later retrieval (for quoting/replying)
  messageStore.storeMessage(message);

  // Marca tráfego ANTES de qualquer filtro (fromMe, broadcast, grupo): o que
  // se mede aqui é o canal estar entregando, não atividade comercial. Sessão
  // conectada que não recebe NADA há muito tempo é o modo de falha que não
  // gera evento de desconexão nenhum — e é o único jeito de enxergá-lo.
  try {
    sessionDb.touchLastMessage(message.sessionId);
  } catch {
    // Nunca deixar contabilidade derrubar a entrega da mensagem.
  }

  if (message.key.fromMe || message.key.remoteJid?.includes("broadcast"))
    return;

  const user = getUserForSession(message.sessionId);
  const callbackUrl = user?.callback_url;
  
  if (!callbackUrl) {
    console.log(`No callback URL configured for session: ${message.sessionId}`);
    return;
  }

  const endpoint = `${callbackUrl}`;

  // Áudio (nota de voz): baixa e manda base64 no payload pro CRM transcrever.
  let audio: { data: string; mimetype: string; seconds: number | null } | null = null;
  const audioMsg = (message.message as any)?.audioMessage;
  if (audioMsg) {
    try {
      const tmp = path.join(
        "/tmp",
        `wa-audio-${(message.key.id || Date.now()).toString().replace(/\W/g, "")}.ogg`,
      );
      await message.saveAudio(tmp);
      const buf = await fs.promises.readFile(tmp);
      audio = {
        data: buf.toString("base64"),
        mimetype: audioMsg.mimetype || "audio/ogg",
        seconds: audioMsg.seconds ?? null,
      };
      await fs.promises.unlink(tmp).catch(() => {});
    } catch (e) {
      console.error("WA audio download failed:", (e as Error).message);
    }
  }

  // Imagem / documento: baixa e manda base64 no payload pro CRM anexar no cliente.
  let media:
    | { kind: "image" | "document"; data: string; mimetype: string; filename: string; caption: string | null }
    | null = null;
  const imgMsg = (message.message as any)?.imageMessage;
  const docMsg = (message.message as any)?.documentMessage;
  if (imgMsg || docMsg) {
    try {
      const isImg = !!imgMsg;
      const ext = isImg ? "jpg" : "bin";
      const tmp = path.join(
        "/tmp",
        `wa-media-${(message.key.id || Date.now()).toString().replace(/\W/g, "")}.${ext}`,
      );
      if (isImg) await message.saveImage(tmp);
      else await message.saveDocument(tmp);
      const buf = await fs.promises.readFile(tmp);
      media = {
        kind: isImg ? "image" : "document",
        data: buf.toString("base64"),
        mimetype: (isImg ? imgMsg.mimetype : docMsg.mimetype) || (isImg ? "image/jpeg" : "application/octet-stream"),
        filename: (!isImg && docMsg.fileName) ? String(docMsg.fileName) : (isImg ? "foto.jpg" : "arquivo.bin"),
        caption: (isImg ? imgMsg.caption : docMsg.caption) || null,
      };
      await fs.promises.unlink(tmp).catch(() => {});
    } catch (e) {
      console.error("WA media download failed:", (e as Error).message);
    }
  }

  const body = {
    session: message.sessionId,
    from: message.key.remoteJid ?? null,
    messageId: message.key.id,
    audio,
    media,
    message:
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      message.message?.imageMessage?.caption ||
      message.message?.videoMessage?.caption ||
      message.message?.documentMessage?.caption ||
      message.message?.contactMessage?.displayName ||
      message.message?.locationMessage?.comment ||
      message.message?.liveLocationMessage?.caption ||
      null,
  };
  console.log(body);
  
  // Send to user's callback URL with OAuth
  await sendWebhookWithAuth(endpoint, body, user);
  
  // Also send to legacy global webhook if configured
  if (env.WEBHOOK_BASE_URL) {
    await sendWebhookWithAuth(env.WEBHOOK_BASE_URL, body, null);
  }

});

// Session webhook with per-user callbacks
const sendSessionWebhook = async (sessionName: string, status: "connected" | "connecting" | "disconnected") => {
  const user = getUserForSession(sessionName);
  const callbackUrl = user?.callback_url;
  
  if (!callbackUrl) {
    return;
  }

  const endpoint = `${callbackUrl}/session`;
  const body = {
    session: sessionName,
    status: status,
  };
  
  // Send to user's callback URL with OAuth
  await sendWebhookWithAuth(endpoint, body, user);
  
  // Also send to legacy global webhook if configured
  if (env.WEBHOOK_BASE_URL) {
    await sendWebhookWithAuth(`${env.WEBHOOK_BASE_URL}/session`, body, null);
  }
};

/**
 * Persiste a transição ANTES de tentar o webhook. O webhook depende de rede e
 * de o destino existir — e não existia: o CRM nunca implementou a rota
 * `${callback_url}/session`, então todo evento de desconexão caía num 404 e
 * sumia. Gravar primeiro garante que o histórico sobreviva mesmo quando o
 * avisado não escuta.
 *
 * Também loga em JSON de uma linha, com o mesmo `tag` do /status, para o log do
 * container ser rastreável junto com o endpoint.
 */
const registrarEstado = (session: string, state: string) => {
  try {
    sessionDb.recordEvent(session, state);
  } catch (err) {
    console.error(
      JSON.stringify({
        tag: "wa_session_event",
        event: "persist_failed",
        session,
        state,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
  console.log(JSON.stringify({ tag: "wa_session_event", session, state }));
};

whastapp.onConnected((session) => {
  registrarEstado(session, "connected");
  sendSessionWebhook(session, "connected");
});

whastapp.onConnecting((session) => {
  registrarEstado(session, "connecting");
  sendSessionWebhook(session, "connecting");
});

whastapp.onDisconnected((session) => {
  registrarEstado(session, "disconnected");
  sendSessionWebhook(session, "disconnected");
});

// Legacy webhook support (if WEBHOOK_BASE_URL is set, also send to that endpoint)
if (env.WEBHOOK_BASE_URL) {
  console.log(`Legacy webhook enabled: ${env.WEBHOOK_BASE_URL}`);
}
// End Implement Per-User Webhook

whastapp.loadSessionsFromStorage();

// Backup do sqlite (usuários, callbacks e tokens de webhook num arquivo só).
// Depois do loadSessions para não competir com o boot das sessões.
scheduleBackups();
