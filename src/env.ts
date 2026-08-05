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
    // Token que autoriza CRIAR/REMOVER tenant em runtime (rotas
    // /bridge/tenants/*). Quem chama é o control-plane da plataforma de agentes,
    // ao provisionar um bot novo. VAZIO = rotas desligadas (fail-closed): sem
    // token não existe registro em runtime, só o que vem do BRIDGE_TENANTS.
    BRIDGE_ADMIN_TOKEN: z.string().default(""),
  })
  .parse(process.env);
