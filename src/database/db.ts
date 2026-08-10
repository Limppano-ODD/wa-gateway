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

// For oauth: format type ('oauth2' for standard OAuth 2.0, 'json' for JSON username/password)
try {
  db.exec(`
    ALTER TABLE users ADD COLUMN webhook_oauth_format TEXT DEFAULT 'oauth2';
  `);
} catch (e) {
  // Column already exists, ignore
}

// Note: Admin user is no longer created in the database.
// Admin credentials are validated directly against environment variables (ADMIN_USER and ADMIN_PASSWORD)
// and exist only as a virtual user for accessing the admin interface.

// --- Observabilidade de sessão (Fase 0) ---
//
// `sessions` é a lista do que DEVERIA estar conectado. Sem ela não existe a
// pergunta "quantas sessões faltam?": o processo só sabe o que está no ar, e
// zero sessões no ar é indistinguível de zero sessões esperadas. Foi por isso
// que 20 dias de queda passaram com /health devolvendo 200.
//
// `monitored` existe porque "esperada" é decisão de negócio, não de código: uma
// sessão pode estar cadastrada e deliberadamente fora do alerta (dono mudou de
// área, integração descontinuada). Sem esse flag a alternativa seria apagar a
// linha — e aí se perde o histórico junto.
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    name TEXT PRIMARY KEY,
    monitored INTEGER NOT NULL DEFAULT 1,
    last_message_at DATETIME,
    last_state TEXT,
    last_state_reason TEXT,
    last_state_change_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_name TEXT NOT NULL,
    state TEXT NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_session_events_lookup
    ON session_events (session_name, created_at DESC);
`);

// Popula a partir dos usuários existentes: hoje sessão e usuário são a mesma
// coisa (sessionName = user.username em ~20 pontos do código). Quando a Fase 2
// desacoplar os dois, esta tabela já é a fonte da verdade e o seed sai daqui.
// INSERT OR IGNORE = idempotente, roda a cada boot sem duplicar nem sobrescrever.
db.exec(`
  INSERT OR IGNORE INTO sessions (name)
  SELECT username FROM users WHERE is_admin = 0;
`);

export interface SessionRow {
  name: string;
  monitored: number;
  last_message_at: string | null;
  last_state: string | null;
  last_state_reason: string | null;
  last_state_change_at: string | null;
  created_at: string;
}

export const sessionDb = {
  getAll(): SessionRow[] {
    return db
      .prepare("SELECT * FROM sessions ORDER BY name")
      .all() as SessionRow[];
  },

  getByName(name: string): SessionRow | undefined {
    return db.prepare("SELECT * FROM sessions WHERE name = ?").get(name) as
      | SessionRow
      | undefined;
  },

  /**
   * Grava a transição de estado E atualiza o retrato atual, numa transação só.
   * O histórico responde "desde quando" — pergunta que hoje só o `docker logs`
   * respondia, e que se perde quando o container é recriado.
   *
   * `reason` fica quase sempre null: a wa-multi-session não repassa o
   * DisconnectReason nos callbacks. O sinal prático de logout é
   * `credentials_present: false` no /status, não este campo.
   */
  recordEvent(name: string, state: string, reason: string | null = null): void {
    const tx = db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO sessions (name) VALUES (?)").run(name);
      db.prepare(
        "INSERT INTO session_events (session_name, state, reason) VALUES (?, ?, ?)"
      ).run(name, state, reason);
      db.prepare(
        `UPDATE sessions
            SET last_state = ?, last_state_reason = ?, last_state_change_at = CURRENT_TIMESTAMP
          WHERE name = ?`
      ).run(state, reason, name);
    });
    tx();
  },

  /**
   * Marca que chegou tráfego. Conta QUALQUER mensagem recebida, inclusive
   * `fromMe` e broadcast: a métrica mede o canal estar vivo, não atividade
   * comercial. Sessão conectada que não recebe nada há muito tempo é o modo de
   * falha que não gera evento de desconexão.
   */
  touchLastMessage(name: string): void {
    db.prepare(
      "UPDATE sessions SET last_message_at = CURRENT_TIMESTAMP WHERE name = ?"
    ).run(name);
  },

  setMonitored(name: string, monitored: boolean): void {
    db.prepare("UPDATE sessions SET monitored = ? WHERE name = ?").run(
      monitored ? 1 : 0,
      name
    );
  },
};

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
  webhook_oauth_format: string | null;
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

  // Update user callback URL
  updateUserCallbackUrl(userId: number, callbackUrl: string | null): void {
    db.prepare("UPDATE users SET callback_url = ? WHERE id = ?").run(
      callbackUrl,
      userId
    );
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
      webhook_oauth_format?: string | null;
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
    if (authConfig.webhook_oauth_format !== undefined) {
      updates.push("webhook_oauth_format = ?");
      values.push(authConfig.webhook_oauth_format);
    }

    if (updates.length > 0) {
      values.push(userId);
      db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }
  },
};

export default db;
