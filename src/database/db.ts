import Database from "better-sqlite3";
import path from "path";
import bcrypt from "bcrypt";
import { env } from "../env";

const db: Database.Database = new Database(env.DB_PATH);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    session_name TEXT,
    callback_url TEXT,
    webhook_auth_type TEXT DEFAULT 'none',
    webhook_auth_username TEXT,
    webhook_auth_password TEXT,
    webhook_auth_bearer_token TEXT,
    webhook_oauth2_client_id TEXT,
    webhook_oauth2_client_secret TEXT,
    webhook_oauth2_token_url TEXT,
    webhook_oauth2_scope TEXT,
    webhook_oauth2_access_token TEXT,
    webhook_oauth2_token_expiry INTEGER,
    webhook_oauth2_refresh_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Initialize admin user if not exists
const initAdmin = () => {
  const adminUser = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(env.ADMIN_USER);

  if (!adminUser) {
    const hashedPassword = bcrypt.hashSync(env.ADMIN_PASSWORD, 10);
    db.prepare(
      "INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)"
    ).run(env.ADMIN_USER, hashedPassword);
    console.log("Admin user created");
  }
};

initAdmin();

export type WebhookAuthType = 'none' | 'basic' | 'bearer' | 'oauth2';

export interface User {
  id: number;
  username: string;
  password: string;
  is_admin: number;
  session_name: string | null;
  callback_url: string | null;
  webhook_auth_type: WebhookAuthType;
  webhook_auth_username: string | null;
  webhook_auth_password: string | null;
  webhook_auth_bearer_token: string | null;
  webhook_oauth2_client_id: string | null;
  webhook_oauth2_client_secret: string | null;
  webhook_oauth2_token_url: string | null;
  webhook_oauth2_scope: string | null;
  webhook_oauth2_access_token: string | null;
  webhook_oauth2_token_expiry: number | null;
  webhook_oauth2_refresh_token: string | null;
  created_at: string;
}

export const userDb = {
  // Get user by username
  getUserByUsername(username: string): User | undefined {
    return db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username) as User | undefined;
  },

  // Get user by id
  getUserById(id: number): User | undefined {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | User
      | undefined;
  },

  // Get all users
  getAllUsers(): User[] {
    return db.prepare("SELECT * FROM users").all() as User[];
  },

  // Create a new user
  createUser(username: string, password: string): User {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = db
      .prepare("INSERT INTO users (username, password) VALUES (?, ?)")
      .run(username, hashedPassword);

    return this.getUserById(result.lastInsertRowid as number)!;
  },

  // Update user password
  updateUserPassword(userId: number, newPassword: string): void {
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(
      hashedPassword,
      userId
    );
  },

  // Delete user
  deleteUser(userId: number): void {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  },

  // Verify password
  verifyPassword(password: string, hashedPassword: string): boolean {
    return bcrypt.compareSync(password, hashedPassword);
  },

  // Update user session name
  updateUserSessionName(userId: number, sessionName: string): void {
    db.prepare("UPDATE users SET session_name = ? WHERE id = ?").run(
      sessionName,
      userId
    );
  },

  // Update user callback URL
  updateUserCallbackUrl(userId: number, callbackUrl: string | null): void {
    db.prepare("UPDATE users SET callback_url = ? WHERE id = ?").run(
      callbackUrl,
      userId
    );
  },

  // Get user by session name
  getUserBySessionName(sessionName: string): User | undefined {
    return db
      .prepare("SELECT * FROM users WHERE session_name = ?")
      .get(sessionName) as User | undefined;
  },

  // Update webhook authentication configuration
  updateWebhookAuth(
    userId: number,
    config: {
      auth_type?: WebhookAuthType;
      auth_username?: string | null;
      auth_password?: string | null;
      auth_bearer_token?: string | null;
      oauth2_client_id?: string | null;
      oauth2_client_secret?: string | null;
      oauth2_token_url?: string | null;
      oauth2_scope?: string | null;
      oauth2_access_token?: string | null;
      oauth2_token_expiry?: number | null;
      oauth2_refresh_token?: string | null;
    }
  ): void {
    const updates: string[] = [];
    const values: any[] = [];

    if (config.auth_type !== undefined) {
      updates.push("webhook_auth_type = ?");
      values.push(config.auth_type);
    }
    if (config.auth_username !== undefined) {
      updates.push("webhook_auth_username = ?");
      values.push(config.auth_username);
    }
    if (config.auth_password !== undefined) {
      updates.push("webhook_auth_password = ?");
      values.push(config.auth_password);
    }
    if (config.auth_bearer_token !== undefined) {
      updates.push("webhook_auth_bearer_token = ?");
      values.push(config.auth_bearer_token);
    }
    if (config.oauth2_client_id !== undefined) {
      updates.push("webhook_oauth2_client_id = ?");
      values.push(config.oauth2_client_id);
    }
    if (config.oauth2_client_secret !== undefined) {
      updates.push("webhook_oauth2_client_secret = ?");
      values.push(config.oauth2_client_secret);
    }
    if (config.oauth2_token_url !== undefined) {
      updates.push("webhook_oauth2_token_url = ?");
      values.push(config.oauth2_token_url);
    }
    if (config.oauth2_scope !== undefined) {
      updates.push("webhook_oauth2_scope = ?");
      values.push(config.oauth2_scope);
    }
    if (config.oauth2_access_token !== undefined) {
      updates.push("webhook_oauth2_access_token = ?");
      values.push(config.oauth2_access_token);
    }
    if (config.oauth2_token_expiry !== undefined) {
      updates.push("webhook_oauth2_token_expiry = ?");
      values.push(config.oauth2_token_expiry);
    }
    if (config.oauth2_refresh_token !== undefined) {
      updates.push("webhook_oauth2_refresh_token = ?");
      values.push(config.oauth2_refresh_token);
    }

    if (updates.length > 0) {
      values.push(userId);
      const query = `UPDATE users SET ${updates.join(", ")} WHERE id = ?`;
      db.prepare(query).run(...values);
    }
  },
};

export default db;
