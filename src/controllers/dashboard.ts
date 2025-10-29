import { Hono } from "hono";
import { basicAuthMiddleware } from "../middlewares/auth.middleware";
import type { User } from "../database/db";
import * as whatsapp from "wa-multi-session";
import { toDataURL } from "qrcode";
import { HTTPException } from "hono/http-exception";
import { userDb } from "../database/db";
import { requestValidator } from "../middlewares/validation.middleware";
import { z } from "zod";


type Variables = {
  user: User;
};

export const createDashboardController = () => {
  const app = new Hono<{ Variables: Variables }>();

  // Apply basic auth to all dashboard routes
  app.use("*", basicAuthMiddleware());

  // Update callback URL for current user
  const updateCallbackSchema = z.object({
    callback_url: z.string().url().nullable(),
  });

  app.put(
    "/callback",
    requestValidator("json", updateCallbackSchema),
    async (c) => {
      const user = c.get("user") as User;
      const payload = c.req.valid("json");

      if (user.is_admin === 1) {
        throw new HTTPException(400, {
          message: "Admin users cannot configure callbacks",
        });
      }

      userDb.updateUserCallbackUrl(user.id, payload.callback_url);

      return c.json({
        data: {
          message: "Callback URL updated successfully",
        },
      });
    }
  );

  // Update webhook authentication configuration for current user
  const updateWebhookAuthSchema = z.object({
    webhook_auth_type: z.enum(["none", "basic", "oauth", "bearer"]),
    webhook_auth_username: z.string().nullable().optional(),
    webhook_auth_password: z.string().nullable().optional(),
    webhook_auth_token_url: z.string().url().nullable().optional(),
    webhook_auth_token: z.string().nullable().optional(),
    webhook_oauth_format: z.enum(["oauth2", "json"]).nullable().optional(),
  });

  app.put(
    "/webhook-auth",
    requestValidator("json", updateWebhookAuthSchema),
    async (c) => {
      const user = c.get("user") as User;
      const payload = c.req.valid("json");

      if (user.is_admin === 1) {
        throw new HTTPException(400, {
          message: "Admin users cannot configure webhook authentication",
        });
      }

      const updates: any = {
        webhook_auth_type: payload.webhook_auth_type,
      };

      // Reset token when changing auth type or credentials
      updates.webhook_auth_token = null;
      updates.webhook_auth_token_expiration = null;

      if (payload.webhook_auth_username !== undefined) {
        updates.webhook_auth_username = payload.webhook_auth_username;
      }
      if (payload.webhook_auth_password !== undefined) {
        updates.webhook_auth_password = payload.webhook_auth_password;
      }
      if (payload.webhook_auth_token_url !== undefined) {
        updates.webhook_auth_token_url = payload.webhook_auth_token_url;
      }
      if (payload.webhook_auth_token !== undefined) {
        updates.webhook_auth_token = payload.webhook_auth_token;
      }
      if (payload.webhook_oauth_format !== undefined) {
        updates.webhook_oauth_format = payload.webhook_oauth_format;
      }

      userDb.updateUserWebhookAuth(user.id, updates);

      return c.json({
        data: {
          message: "Webhook authentication configuration updated successfully",
        },
      });
    }
  );

  // Get user session info
  app.get("/session-info", async (c) => {
    const user = c.get("user") as User;
    
    if (user.is_admin === 1) {
      throw new HTTPException(400, {
        message: "Admin users do not have sessions",
      });
    }

    const sessionName = user.username;
    const session = whatsapp.getSession(sessionName);
    // Check if session exists AND is authenticated (has user info)
    const isConnected = !!(session?.user);

    return c.json({
      data: {
        session_name: sessionName,
        callback_url: user.callback_url,
        webhook_auth_type: user.webhook_auth_type || "none",
        webhook_auth_username: user.webhook_auth_username,
        webhook_auth_token_url: user.webhook_auth_token_url,
        webhook_oauth_format: user.webhook_oauth_format || "oauth2",
        webhook_auth_configured: !!(user.webhook_auth_type && user.webhook_auth_type !== "none"),
        is_connected: isConnected,
      },
    });
  });

  // Start/restart session
  app.post("/start-session", async (c) => {
    const user = c.get("user") as User;

    if (user.is_admin === 1) {
      throw new HTTPException(400, {
        message: "Admin users cannot create sessions",
      });
    }

    const sessionName = user.username;

    // Check if session already exists
    const existingSession = whatsapp.getSession(sessionName);
    if (existingSession) {
      return c.json({
        data: {
          message: "Session already connected",
          session_name: sessionName,
        },
      });
    }

    // Start new session and get QR code
    const qr = await new Promise<string | null>(async (r) => {
      await whatsapp.startSession(sessionName, {
        onConnected() {
          r(null);
        },
        onQRUpdated(qr) {
          r(qr);
        },
      });
    });

    if (qr) {
      const qrDataUrl = await toDataURL(qr);
      return c.json({
        data: {
          qr: qrDataUrl,
          session_name: sessionName,
        },
      });
    }

    return c.json({
      data: {
        message: "Session connected",
        session_name: sessionName,
      },
    });
  });

  // Disconnect session
  app.post("/disconnect-session", async (c) => {
    const user = c.get("user") as User;

    if (user.is_admin === 1) {
      throw new HTTPException(400, {
        message: "Admin users cannot disconnect sessions",
      });
    }

    const sessionName = user.username;
    await whatsapp.deleteSession(sessionName);

    return c.json({
      data: {
        message: "Session disconnected successfully",
      },
    });
  });

  // User dashboard home
  app.get("/", async (c) => {
    const user = c.get("user") as User;
    
    if (user.is_admin === 1) {
      return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Dashboard - WA Gateway</title>
</head>
<body style="font-family: system-ui; text-align: center; padding: 50px;">
    <h1>👋 Welcome Admin</h1>
    <p>As an administrator, you don't have a personal session.</p>
    <p><a href="/admin" style="color: #667eea; text-decoration: none; font-weight: 600;">Go to Admin Panel →</a></p>
</body>
</html>
      `);
    }
    
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const htmlPath = join(__dirname, "../views/dashboard.html");
    let htmlContent = readFileSync(htmlPath, "utf-8");
    
    // Replace username placeholder
    htmlContent = htmlContent.replace(/__USERNAME__/g, user.username);
    
    return c.html(htmlContent);
  });

  return app;
};
