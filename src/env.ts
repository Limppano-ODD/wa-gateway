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
    // --- Login Microsoft / Entra ID (Fase 1) ---
    // Vale SÓ para humano no browser. As rotas de máquina (/message, /profile,
    // /session) continuam em Basic com credencial de serviço: trocá-las
    // exigiria deploy coordenado de CRM, data-gateway e agent-platform ao
    // mesmo tempo, e não é o que este passo resolve.
    // URL pública, usada para montar a redirect_uri do Entra. Fixa por env e
    // NÃO derivada do header Host: Host é controlado por quem chama, e uma
    // redirect_uri forjada é o caminho clássico para roubar o code.
    PUBLIC_BASE_URL: z.string().default("https://wa-gateway.odd.com.br"),
    AZURE_AD_TENANT_ID: z.string().default(""),
    AZURE_AD_CLIENT_ID: z.string().default(""),
    AZURE_AD_CLIENT_SECRET: z.string().default(""),
    // Grupo de segurança DEDICADO deste app. Grupo compartilhado entre apps
    // vira permissão acidental — o app `user api` do parque já sofre disso.
    AZURE_AD_ADMIN_GROUP_ID: z.string().default(""),
    // Break-glass: papéis de diretório do Entra que entram como admin mesmo
    // fora do grupo, lidos do claim `wids`. Default = Global Administrator e
    // Privileged Role Administrator, que já podem se conceder qualquer coisa
    // no tenant (barrá-los seria teatro). Ampliável sem deploy de código.
    ENTRA_BREAKGLASS_WIDS: z
      .string()
      .default(
        // Global Administrator, Privileged Role Administrator
        "62e90394-69f5-4237-9190-012177145e10,e8611ab8-c189-46e8-94e1-60213ab1f814"
      )
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      ),
    // Vida da sessão do humano, em horas.
    WEB_SESSION_HOURS: z
      .string()
      .default("12")
      .transform((e) => Number(e)),
    // Enquanto true, o Basic continua valendo nas rotas humanas. É a rede de
    // segurança da transição: se o Entra falhar, o painel não fica inacessível.
    // Vira false na Fase 4, quando o login Microsoft estiver provado.
    AUTH_ALLOW_BASIC_FALLBACK: z
      .string()
      .default("true")
      .transform((v) => v !== "false"),
  })
  .parse(process.env);

/** Entra só entra em ação com as quatro configurações presentes. */
export const entraConfigurado =
  !!env.AZURE_AD_TENANT_ID &&
  !!env.AZURE_AD_CLIENT_ID &&
  !!env.AZURE_AD_CLIENT_SECRET &&
  !!env.AZURE_AD_ADMIN_GROUP_ID;
