import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { userDb } from "../database/db";
import { env } from "../env";

export const basicAuthMiddleware = () =>
  createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Basic ")) {
      c.header("WWW-Authenticate", 'Basic realm="WA Gateway"');
      throw new HTTPException(401, {
        message: "Unauthorized",
      });
    }

    const base64Credentials = authHeader.split(" ")[1];
    if (!base64Credentials) {
      c.header("WWW-Authenticate", 'Basic realm="WA Gateway"');
      throw new HTTPException(401, {
        message: "Unauthorized",
      });
    }

    const credentials = Buffer.from(base64Credentials, "base64").toString(
      "ascii"
    );
    const [username, password] = credentials.split(":");

    if (!username || !password) {
      c.header("WWW-Authenticate", 'Basic realm="WA Gateway"');
      throw new HTTPException(401, {
        message: "Invalid credentials",
      });
    }

    // Check if it's admin login - validate against environment variables
    if (username === env.ADMIN_USER) {
      if (password !== env.ADMIN_PASSWORD) {
        c.header("WWW-Authenticate", 'Basic realm="WA Gateway"');
        throw new HTTPException(401, {
          message: "Invalid credentials",
        });
      }

      // Admin is virtual - doesn't exist in database, just for admin interface access
      // Set a virtual admin user in context
      c.set("user", {
        id: -1,
        username: env.ADMIN_USER,
        password: "",
        is_admin: 1,
        session_name: null,
        callback_url: null,
        created_at: new Date().toISOString(),
      });
    } else {
      // Regular user login - validate against database
      const user = userDb.getUserByUsername(username);
      if (!user || !userDb.verifyPassword(password, user.password)) {
        c.header("WWW-Authenticate", 'Basic realm="WA Gateway"');
        throw new HTTPException(401, {
          message: "Invalid credentials",
        });
      }

      // Set user in context
      c.set("user", user);
    }

    await next();
  });

export const adminAuthMiddleware = () =>
  createMiddleware(async (c, next) => {
    const user = c.get("user");

    if (!user || user.is_admin !== 1) {
      throw new HTTPException(403, {
        message: "Admin access required",
      });
    }

    await next();
  });
