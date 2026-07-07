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
    // --- Meta WhatsApp Cloud API relay (módulo /meta) ---
    // Token do handshake do webhook (string que você inventa, vai no painel do Meta).
    META_VERIFY_TOKEN: z.string().default(""),
    // Tokens de conexão da ponte WebSocket: token secreto -> nome do app.
    // O app (SAC) só abre o WebSocket se mandar um token daqui. Ex: {"tok-sac":"sac"}
    META_APP_TOKENS: z.string().default("{}"),
    // Roteamento multi-tenant: phone_number_id -> { app, token }. Qual app é dono
    // do número (roteia a mensagem) + access token Meta (pra ENVIAR de volta). JSON.
    // Ex: {"1202173422979697":{"app":"sac","token":"EAA..."}}
    META_ROUTES: z.string().default("{}"),
    META_API_VERSION: z.string().default("v20.0"),
  })
  .parse(process.env);
