// index.ts — registro de adapters de canal. Adicionar canal = 1 linha aqui.

import type { ChannelAdapter } from "./types";
import { whatsappAdapter } from "./whatsapp";
import { teamsAdapter } from "./teams";

const adapters: Record<string, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  teams: teamsAdapter,
};

// Object.hasOwn: o `channel` vem do def do tenant, que em runtime vem do corpo
// de uma requisição. `adapters["__proto__"]` resolveria pela cadeia de protótipo
// e devolveria algo que não é adapter. (CWE-1321)
export function adapterFor(channel: string | undefined): ChannelAdapter | null {
  if (!channel || !Object.hasOwn(adapters, channel)) return null;
  return adapters[channel] ?? null;
}
