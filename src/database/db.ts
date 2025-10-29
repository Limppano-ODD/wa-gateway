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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add webhook authentication columns if they don't exist (migration)
// webhook_auth_type: 'none', 'basic', 'oauth', 'bearer'
try {
  db.exec(`
    ALTER TABLE users ADD COLUMN webhook_auth_type TEXT DEFAULT 'none';
  `);
} catch (e) {
  // Column already exists, ignore
}

// For basic/oauth: username or client_id
try {
  db.exec(`
    ALTER TABLE users ADD COLUMN webhook_auth_username TEXT;
  `);
} catch (e) {
  // Column already exists, ignore
}

// For basic/oauth: password or client_secret
try {
  db.exec(`
    ALTER TABLE users ADD COLUMN webhook_auth_password TEXT;
  `);
} catch (e) {
  // Column already exists, ignore
}

// For oauth: token endpoint URL
try {
  db.exec(`
    ALTER TABLE users ADD COLUMN webhook_auth_token_url TEXT;
  `);
} catch (e) {
  // Column already exists, ignore
}

// For oauth/bearer: cached token
try {
  db.exec(`
    ALTER TABLE users ADD COLUMN webhook_auth_token TEXT;
  `);
} catch (e) {
  // Column already exists, ignore
}

// For oauth: token expiration
try {
  db.exec(`
    ALTER TABLE users ADD COLUMN webhook_auth_token_expiration DATETIME;
  `);
} catch (e) {
  // Column already exists, ignore
}

// Note: Admin user is no longer created in the database.
// Admin credentials are validated directly against environment variables (ADMIN_USER and ADMIN_PASSWORD)
// and exist only as a virtual user for accessing the admin interface.

export interface User {
  id: number;
  username: string;
  password: string;
  is_admin: number;
  session_name: string | null;
  callback_url: string | null;
  webhook_auth_type: string | null;
  webhook_auth_username: string | null;
  webhook_auth_password: string | null;
  webhook_auth_token_url: string | null;
  webhook_auth_token: string | null;
  webhook_auth_token_expiration: string | null;
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

  // Update user webhook authentication configuration
  updateUserWebhookAuth(
    userId: number,
    authConfig: {
      webhook_auth_type?: string | null;
      webhook_auth_username?: string | null;
      webhook_auth_password?: string | null;
      webhook_auth_token_url?: string | null;
      webhook_auth_token?: string | null;
      webhook_auth_token_expiration?: string | null;
    }
  ): void {
    const updates: string[] = [];
    const values: any[] = [];

    if (authConfig.webhook_auth_type !== undefined) {
      updates.push("webhook_auth_type = ?");
      values.push(authConfig.webhook_auth_type);
    }
    if (authConfig.webhook_auth_username !== undefined) {
      updates.push("webhook_auth_username = ?");
      values.push(authConfig.webhook_auth_username);
    }
    if (authConfig.webhook_auth_password !== undefined) {
      updates.push("webhook_auth_password = ?");
      values.push(authConfig.webhook_auth_password);
    }
    if (authConfig.webhook_auth_token_url !== undefined) {
      updates.push("webhook_auth_token_url = ?");
      values.push(authConfig.webhook_auth_token_url);
    }
    if (authConfig.webhook_auth_token !== undefined) {
      updates.push("webhook_auth_token = ?");
      values.push(authConfig.webhook_auth_token);
    }
    if (authConfig.webhook_auth_token_expiration !== undefined) {
      updates.push("webhook_auth_token_expiration = ?");
      values.push(authConfig.webhook_auth_token_expiration);
    }

    if (updates.length > 0) {
      values.push(userId);
      db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }
  },
};

export default db;
