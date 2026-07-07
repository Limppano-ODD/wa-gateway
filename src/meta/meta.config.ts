// meta.config.ts — parse e resolve o roteamento multi-tenant do relay Meta.
//
// META_ROUTES (env, JSON) mapeia cada número de WhatsApp (phone_number_id) para:
//   - webhook: URL do app interno que RECEBE as mensagens (ex: SAC)
//   - token:   access token Meta pra ENVIAR mensagem de volta por aquele número
//
// Assim um único wa-gateway serve vários números e vários apps (SAC, CRM...).

import { env } from "../env";

export interface MetaRoute {
  webhook: string;
  token: string;
}

type MetaRoutesMap = Record<string, MetaRoute>;

function parseRoutes(): MetaRoutesMap {
  try {
    const parsed = JSON.parse(env.META_ROUTES || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.error("[meta.config] META_ROUTES não é JSON válido:", (e as Error).message);
    return {};
  }
}

const routes = parseRoutes();

export const metaConfig = {
  verifyToken: env.META_VERIFY_TOKEN || "",
  apiVersion: env.META_API_VERSION || "v20.0",
  routes,
};

// Resolve a rota (webhook + token) de um phone_number_id, ou null se não configurado.
export function routeForNumber(phoneNumberId: string | undefined): MetaRoute | null {
  if (!phoneNumberId) return null;
  return routes[String(phoneNumberId)] || null;
}
