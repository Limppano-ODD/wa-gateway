import { Hono } from "hono";
import { basicAuthMiddleware } from "../middlewares/auth.middleware";
import type { User, WebhookAuthType } from "../database/db";
import * as whatsapp from "wa-multi-session";
import { toDataURL } from "qrcode";
import { HTTPException } from "hono/http-exception";
import { userDb } from "../database/db";
import { requestValidator } from "../middlewares/validation.middleware";
import { z } from "zod";
import {
  requestOAuth2Token,
  requestOAuth2ClientCredentials,
} from "../utils/webhook-auth";


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

  // Get user session info
  app.get("/session-info", async (c) => {
    const user = c.get("user") as User;
    
    if (user.is_admin === 1) {
      throw new HTTPException(400, {
        message: "Admin users do not have sessions",
      });
    }

    const sessionName = user.session_name || user.username;
    const session = whatsapp.getSession(sessionName);
    // Check if session exists AND is authenticated (has user info)
    const isConnected = !!(session?.user);

    return c.json({
      data: {
        session_name: sessionName,
        callback_url: user.callback_url,
        is_connected: isConnected,
        webhook_auth: {
          auth_type: user.webhook_auth_type,
          has_credentials: !!(
            (user.webhook_auth_type === "basic" &&
              user.webhook_auth_username &&
              user.webhook_auth_password) ||
            (user.webhook_auth_type === "bearer" &&
              user.webhook_auth_bearer_token) ||
            (user.webhook_auth_type === "oauth2" &&
              user.webhook_oauth2_client_id &&
              user.webhook_oauth2_client_secret &&
              user.webhook_oauth2_token_url)
          ),
        },
      },
    });
  });

  // Update webhook authentication configuration
  const updateWebhookAuthSchema = z.object({
    auth_type: z.enum(["none", "basic", "bearer", "oauth2"]),
    // Basic auth fields
    auth_username: z.string().optional().nullable(),
    auth_password: z.string().optional().nullable(),
    // Bearer token field
    auth_bearer_token: z.string().optional().nullable(),
    // OAuth2 fields
    oauth2_client_id: z.string().optional().nullable(),
    oauth2_client_secret: z.string().optional().nullable(),
    oauth2_token_url: z.string().url().optional().nullable(),
    oauth2_scope: z.string().optional().nullable(),
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

      // Validate that required fields are provided for the selected auth type
      if (payload.auth_type === "basic") {
        if (!payload.auth_username || !payload.auth_password) {
          throw new HTTPException(400, {
            message: "Username and password are required for basic authentication",
          });
        }
      } else if (payload.auth_type === "bearer") {
        if (!payload.auth_bearer_token) {
          throw new HTTPException(400, {
            message: "Bearer token is required for bearer authentication",
          });
        }
      } else if (payload.auth_type === "oauth2") {
        if (
          !payload.oauth2_client_id ||
          !payload.oauth2_client_secret ||
          !payload.oauth2_token_url
        ) {
          throw new HTTPException(400, {
            message:
              "Client ID, client secret, and token URL are required for OAuth2 authentication",
          });
        }
      }

      userDb.updateWebhookAuth(user.id, {
        auth_type: payload.auth_type as WebhookAuthType,
        auth_username: payload.auth_username,
        auth_password: payload.auth_password,
        auth_bearer_token: payload.auth_bearer_token,
        oauth2_client_id: payload.oauth2_client_id,
        oauth2_client_secret: payload.oauth2_client_secret,
        oauth2_token_url: payload.oauth2_token_url,
        oauth2_scope: payload.oauth2_scope,
        // Clear token data when updating OAuth2 config
        oauth2_access_token: null,
        oauth2_token_expiry: null,
        oauth2_refresh_token: null,
      });

      return c.json({
        data: {
          message: "Webhook authentication configuration updated successfully",
        },
      });
    }
  );

  // Request OAuth2 token using authorization code
  const oauth2TokenRequestSchema = z.object({
    code: z.string(),
    redirect_uri: z.string().url().optional(),
  });

  app.post(
    "/webhook-auth/oauth2-token",
    requestValidator("json", oauth2TokenRequestSchema),
    async (c) => {
      const user = c.get("user") as User;
      const payload = c.req.valid("json");

      if (user.is_admin === 1) {
        throw new HTTPException(400, {
          message: "Admin users cannot configure webhook authentication",
        });
      }

      if (
        user.webhook_auth_type !== "oauth2" ||
        !user.webhook_oauth2_client_id ||
        !user.webhook_oauth2_client_secret ||
        !user.webhook_oauth2_token_url
      ) {
        throw new HTTPException(400, {
          message: "OAuth2 is not configured for this user",
        });
      }

      try {
        const tokenResponse = await requestOAuth2Token(
          user.webhook_oauth2_token_url,
          user.webhook_oauth2_client_id,
          user.webhook_oauth2_client_secret,
          payload.code,
          payload.redirect_uri
        );

        userDb.updateWebhookAuth(user.id, {
          oauth2_access_token: tokenResponse.access_token,
          oauth2_token_expiry: Date.now() + tokenResponse.expires_in * 1000,
          oauth2_refresh_token: tokenResponse.refresh_token,
        });

        return c.json({
          data: {
            message: "OAuth2 token obtained successfully",
          },
        });
      } catch (error: any) {
        throw new HTTPException(400, {
          message: `Failed to obtain OAuth2 token: ${error.message}`,
        });
      }
    }
  );

  // Request OAuth2 token using client credentials
  app.post("/webhook-auth/oauth2-client-credentials", async (c) => {
    const user = c.get("user") as User;

    if (user.is_admin === 1) {
      throw new HTTPException(400, {
        message: "Admin users cannot configure webhook authentication",
      });
    }

    if (
      user.webhook_auth_type !== "oauth2" ||
      !user.webhook_oauth2_client_id ||
      !user.webhook_oauth2_client_secret ||
      !user.webhook_oauth2_token_url
    ) {
      throw new HTTPException(400, {
        message: "OAuth2 is not configured for this user",
      });
    }

    try {
      const tokenResponse = await requestOAuth2ClientCredentials(
        user.webhook_oauth2_token_url,
        user.webhook_oauth2_client_id,
        user.webhook_oauth2_client_secret,
        user.webhook_oauth2_scope || undefined
      );

      userDb.updateWebhookAuth(user.id, {
        oauth2_access_token: tokenResponse.access_token,
        oauth2_token_expiry: Date.now() + tokenResponse.expires_in * 1000,
        oauth2_refresh_token: tokenResponse.refresh_token,
      });

      return c.json({
        data: {
          message: "OAuth2 token obtained successfully using client credentials",
        },
      });
    } catch (error: any) {
      throw new HTTPException(400, {
        message: `Failed to obtain OAuth2 token: ${error.message}`,
      });
    }
  });

  // Get webhook authentication info
  app.get("/webhook-auth", async (c) => {
    const user = c.get("user") as User;

    if (user.is_admin === 1) {
      throw new HTTPException(400, {
        message: "Admin users do not have webhook authentication",
      });
    }

    return c.json({
      data: {
        auth_type: user.webhook_auth_type,
        // Basic auth (don't return password)
        auth_username: user.webhook_auth_username,
        // Bearer token (return masked value)
        auth_bearer_token: user.webhook_auth_bearer_token
          ? "***" + user.webhook_auth_bearer_token.slice(-4)
          : null,
        // OAuth2 (don't return secrets or tokens)
        oauth2_client_id: user.webhook_oauth2_client_id,
        oauth2_token_url: user.webhook_oauth2_token_url,
        oauth2_scope: user.webhook_oauth2_scope,
        oauth2_has_token: !!user.webhook_oauth2_access_token,
        oauth2_token_expiry: user.webhook_oauth2_token_expiry,
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

    const sessionName = user.session_name || user.username;

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

    const sessionName = user.session_name || user.username;
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
