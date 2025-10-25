import { Hono } from "hono";
import { basicAuthMiddleware, adminAuthMiddleware } from "../middlewares/auth.middleware";
import { requestValidator } from "../middlewares/validation.middleware";
import { z } from "zod";
import { userDb, User, WebhookAuthType } from "../database/db";
import { HTTPException } from "hono/http-exception";
import { readFileSync } from "fs";
import { join } from "path";


type Variables = {
  user: User;
};

export const createAdminController = () => {
  const app = new Hono<{ Variables: Variables }>();

  // Apply basic auth to all admin routes
  app.use("*", basicAuthMiddleware());
  app.use("*", adminAuthMiddleware());

  // Get all users
  app.get("/users", async (c) => {
    const users = userDb.getAllUsers();
    // Remove password from response
    const sanitizedUsers = users.map(({ password, ...user }) => user);
    return c.json({
      data: sanitizedUsers,
    });
  });

  // Create new user
  const createUserSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(4),
  });

  app.post(
    "/users",
    requestValidator("json", createUserSchema),
    async (c) => {
      const payload = c.req.valid("json");

      // Check if user already exists
      const existingUser = userDb.getUserByUsername(payload.username);
      if (existingUser) {
        throw new HTTPException(400, {
          message: "Username already exists",
        });
      }

      const user = userDb.createUser(payload.username, payload.password);
      const { password, ...sanitizedUser } = user;

      return c.json({
        data: sanitizedUser,
      });
    }
  );

  // Update user password
  const updatePasswordSchema = z.object({
    password: z.string().min(4),
  });

  app.put(
    "/users/:id/password",
    requestValidator("json", updatePasswordSchema),
    async (c) => {
      const userId = parseInt(c.req.param("id"));
      const payload = c.req.valid("json");

      const user = userDb.getUserById(userId);
      if (!user) {
        throw new HTTPException(404, {
          message: "User not found",
        });
      }

      if (user.is_admin === 1) {
        throw new HTTPException(400, {
          message: "Cannot change admin password through this endpoint",
        });
      }

      userDb.updateUserPassword(userId, payload.password);

      return c.json({
        data: {
          message: "Password updated successfully",
        },
      });
    }
  );

  // Update user session configuration
  const updateSessionConfigSchema = z.object({
    session_name: z.string().optional(),
    callback_url: z.string().url().optional().nullable(),
  });

  app.put(
    "/users/:id/session-config",
    requestValidator("json", updateSessionConfigSchema),
    async (c) => {
      const userId = parseInt(c.req.param("id"));
      const payload = c.req.valid("json");

      const user = userDb.getUserById(userId);
      if (!user) {
        throw new HTTPException(404, {
          message: "User not found",
        });
      }

      if (user.is_admin === 1) {
        throw new HTTPException(400, {
          message: "Cannot update admin session configuration",
        });
      }

      if (payload.session_name !== undefined) {
        userDb.updateUserSessionName(userId, payload.session_name);
      }

      if (payload.callback_url !== undefined) {
        userDb.updateUserCallbackUrl(userId, payload.callback_url);
      }

      return c.json({
        data: {
          message: "Session configuration updated successfully",
        },
      });
    }
  );

  // Delete user
  app.delete("/users/:id", async (c) => {
    const userId = parseInt(c.req.param("id"));

    const user = userDb.getUserById(userId);
    if (!user) {
      throw new HTTPException(404, {
        message: "User not found",
      });
    }

    if (user.is_admin === 1) {
      throw new HTTPException(400, {
        message: "Cannot delete admin user",
      });
    }

    userDb.deleteUser(userId);

    return c.json({
      data: {
        message: "User deleted successfully",
      },
    });
  });

  // Update webhook authentication configuration for a user (Admin only)
  const updateWebhookAuthAdminSchema = z.object({
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
    "/users/:id/webhook-auth",
    requestValidator("json", updateWebhookAuthAdminSchema),
    async (c) => {
      const userId = parseInt(c.req.param("id"));
      const payload = c.req.valid("json");

      const user = userDb.getUserById(userId);
      if (!user) {
        throw new HTTPException(404, {
          message: "User not found",
        });
      }

      if (user.is_admin === 1) {
        throw new HTTPException(400, {
          message: "Cannot update admin webhook authentication",
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

      userDb.updateWebhookAuth(userId, {
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

  // Admin UI
  app.get("/", async (c) => {
    const htmlPath = join(__dirname, "../views/admin.html");
    const htmlContent = readFileSync(htmlPath, "utf-8");
    return c.html(htmlContent);
  });

  return app;
};
