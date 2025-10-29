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

const port = env.PORT;

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);

whastapp.onConnected((session) => {
  console.log(`session: '${session}' connected`);
});

// Implement Per-User Webhook
import { User, userDb } from "./database/db";
import axios from "axios";
import { MessageReceived } from "wa-multi-session";
import { messageStore } from "./utils/message-store";
import { getValidOAuthToken, getOAuthTokenUrl } from "./utils/oauth";

// Helper function to get user for a session
const getUserForSession = (sessionName: string): User | null => {
  const user = userDb.getUserBySessionName(sessionName);
  return user || null;
};

// Helper function to send webhook with OAuth support
async function sendWebhookWithAuth(
  url: string,
  body: any,
  user: User | null
): Promise<void> {
  try {
    const headers: any = {
      "Content-Type": "application/json",
    };

    // Add OAuth token if configured
    if (user?.oauth_login && user?.oauth_password) {
      const tokenUrl = getOAuthTokenUrl(url);
      const token = await getValidOAuthToken(user, tokenUrl);
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

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

  if (message.key.fromMe || message.key.remoteJid?.includes("broadcast"))
    return;

  const user = getUserForSession(message.sessionId);
  const callbackUrl = user?.callback_url;
  
  if (!callbackUrl) {
    console.log(`No callback URL configured for session: ${message.sessionId}`);
    return;
  }

  const endpoint = `${callbackUrl}`;

  
  const body = {
    session: message.sessionId,
    from: message.key.remoteJid ?? null,
    messageId: message.key.id,
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
    media: {
      image: null, // TODO: implement media handling
      video: null,
      document: null,
      audio: null,
    },
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

whastapp.onConnected((session) => {
  console.log(`session: '${session}' connected`);
  sendSessionWebhook(session, "connected");
});

whastapp.onConnecting((session) => {
  console.log(`session: '${session}' connecting`);
  sendSessionWebhook(session, "connecting");
});

whastapp.onDisconnected((session) => {
  console.log(`session: '${session}' disconnected`);
  sendSessionWebhook(session, "disconnected");
});

// Legacy webhook support (if WEBHOOK_BASE_URL is set, also send to that endpoint)
if (env.WEBHOOK_BASE_URL) {
  console.log(`Legacy webhook enabled: ${env.WEBHOOK_BASE_URL}`);
}
// End Implement Per-User Webhook

whastapp.loadSessionsFromStorage();
