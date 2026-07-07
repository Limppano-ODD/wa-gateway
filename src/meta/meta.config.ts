// meta.config.ts — config multi-tenant do relay Meta (modelo WebSocket).
//
// O app interno (SAC) NÃO é público: ele DISCA pro wa-gateway via WebSocket e
// mantém a ponte aberta. O gateway recebe do Meta e empurra a mensagem pela ponte.
//
// 3 mapas (env, JSON):
//   META_APP_TOKENS  — token secreto de conexão -> nome do app. Um app só abre
//                      o WebSocket se mandar um token daqui. Ex: {"tok-sac":"sac"}
//   META_ROUTES      — phone_number_id -> { app, token }. Qual app é dono do número
//                      (pra rotear a mensagem) + o access token Meta (pra ENVIAR).
//                      Ex: {"1202173422979697":{"app":"sac","token":"EAA..."}}
//   META_VERIFY_TOKEN— handshake do webhook (string inventada, mesma no painel Meta).

import { env } from "../env";

export interface MetaRoute {
  app: string;
  token: string;
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? (p as T) : fallback;
  } catch (e) {
    console.error("[meta.config] JSON inválido:", (e as Error).message);
    return fallback;
  }
}

const routes = parseJson<Record<string, MetaRoute>>(env.META_ROUTES, {});
const appTokens = parseJson<Record<string, string>>(env.META_APP_TOKENS, {});

export const metaConfig = {
  verifyToken: env.META_VERIFY_TOKEN || "",
  apiVersion: env.META_API_VERSION || "v20.0",
  routes,
  appTokens,
};

// phone_number_id -> { app, token } (ou null se número não configurado).
export function routeForNumber(phoneNumberId: string | undefined): MetaRoute | null {
  if (!phoneNumberId) return null;
  return routes[String(phoneNumberId)] || null;
}

// token de conexão -> nome do app (ou null se token inválido).
export function appForToken(token: string | undefined): string | null {
  if (!token) return null;
  return appTokens[token] || null;
}
