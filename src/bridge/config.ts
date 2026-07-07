// config.ts — configuração multi-tenant, multi-canal da ponte.
//
// Um tenant = um app/agente interno que DISCA pro gateway (WebSocket) e recebe
// as mensagens de UM canal (whatsapp, teams...). Config vem de env em JSON:
//
//   BRIDGE_TENANTS = {
//     "sac": {
//       "wsToken": "tok-sac-abc",          // segredo da conexão WebSocket
//       "channel": "whatsapp",             // qual canal esse tenant usa
//       "config": {                        // config específica do canal
//         "verifyToken": "limppano_...",
//         "phoneNumberId": "1202...",
//         "metaToken": "EAA..."
//       }
//     },
//     "teams-agente": {
//       "wsToken": "tok-teams-xyz",
//       "channel": "teams",
//       "config": { "appId": "...", "appPassword": "...", "tenantId": "..." }
//     }
//   }
//
// Adicionar app novo = adicionar um tenant aqui. Zero rota nova.

import { env } from "../env";

export interface TenantDef {
  wsToken: string;
  channel: string; // "whatsapp" | "teams" | ...
  config: Record<string, any>;
}

function parseTenants(): Record<string, TenantDef> {
  try {
    const p = JSON.parse(env.BRIDGE_TENANTS || "{}");
    return p && typeof p === "object" ? p : {};
  } catch (e) {
    console.error("[bridge.config] BRIDGE_TENANTS não é JSON válido:", (e as Error).message);
    return {};
  }
}

const tenants = parseTenants();

// nome do tenant -> def
export function tenant(name: string | undefined): TenantDef | null {
  if (!name) return null;
  return tenants[name] || null;
}

// wsToken -> nome do tenant (pra autenticar a conexão WebSocket)
export function tenantByWsToken(token: string | undefined): string | null {
  if (!token) return null;
  for (const [name, def] of Object.entries(tenants)) {
    if (def.wsToken && def.wsToken === token) return name;
  }
  return null;
}

export const bridgeConfig = { tenants };
