import "dotenv/config";
import { z } from "zod";

export const env = z
  .object({
    NODE_ENV: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
    KEY: z.string().default(""),
    PORT: z
      .string()
      .default("5001")
      .transform((e) => Number(e)),
    WEBHOOK_BASE_URL: z.string().optional(),
    ADMIN_USER: z.string(),
    ADMIN_PASSWORD: z.string(),
    DB_PATH: z.string().default("./wa_gateway.db"),
    // --- Bridge multi-canal (ponte /ingress/:tenant + WebSocket /bridge/agent) ---
    // Cada tenant = um app/agente interno. JSON: nome -> { wsToken, channel, config }.
    // channel = "whatsapp" | "teams". config varia por canal (ver src/bridge/config.ts).
    // Ex: {"sac":{"wsToken":"tok-sac","channel":"whatsapp","config":{"verifyToken":"...","phoneNumberId":"1202...","metaToken":"EAA..."}}}
    BRIDGE_TENANTS: z.string().default("{}"),
  })
  .parse(process.env);
