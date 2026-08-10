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
    //
    // Piso de 24 chars quando presente: comprometer esse token dá controle sobre
    // criar/rotacionar/remover qualquer tenant de runtime, e sem piso um valor
    // curto escolhido às pressas passaria calado. Falhar no boot é melhor que
    // subir com uma credencial fraca guardando essa porta — e o wsToken, que é
    // menos poderoso, já exigia 16.
    BRIDGE_ADMIN_TOKEN: z
      .string()
      .default("")
      .refine((v) => v === "" || v.length >= 24, {
        message: "BRIDGE_ADMIN_TOKEN muito curto (mínimo 24 caracteres) — use algo como `openssl rand -hex 24`",
      }),
    // --- Observabilidade (Fase 0) ---
    // Token do Gatus para ler /status e /status/:session. O payload expõe nome
    // de sessão, estado e telefone conectado — pouco, mas sem contrapartida em
    // deixar aberto. VAZIO = rotas devolvem 503 (e o monitoramento alerta, que
    // é o comportamento correto: melhor gritar do que ficar verde à toa).
    STATUS_TOKEN: z
      .string()
      .default("")
      .refine((v) => v === "" || v.length >= 24, {
        message: "STATUS_TOKEN muito curto (mínimo 24 caracteres) — use algo como `openssl rand -hex 24`",
      }),
    // Backup do sqlite. O banco guarda usuários, callbacks e tokens de webhook
    // num arquivo só, num volume só — perder custa re-parear tudo e
    // reconfigurar os webhooks na mão. 0 desliga.
    DB_BACKUP_INTERVAL_HOURS: z
      .string()
      .default("24")
      .transform((e) => Number(e)),
    DB_BACKUP_KEEP: z
      .string()
      .default("7")
      .transform((e) => Number(e)),
  })
  .parse(process.env);
