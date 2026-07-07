// index.ts — registro de adapters de canal. Adicionar canal = 1 linha aqui.

import type { ChannelAdapter } from "./types";
import { whatsappAdapter } from "./whatsapp";
import { teamsAdapter } from "./teams";

const adapters: Record<string, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  teams: teamsAdapter,
};

export function adapterFor(channel: string | undefined): ChannelAdapter | null {
  if (!channel) return null;
  return adapters[channel] || null;
}
