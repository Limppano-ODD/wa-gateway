// types.ts — contrato de um ADAPTER de canal.
//
// Cada canal (whatsapp, teams...) implementa esse contrato. A rota genérica
// /ingress/:tenant e a ponte WebSocket chamam o adapter do canal do tenant.
// Assim, adicionar um canal = escrever um adapter, sem rota nova.

import type { TenantDef } from "../config";

export interface VerifyResult {
  status: number;
  body: string;
}

export interface IngestResult {
  // objeto a empurrar pro agente pela ponte (ou undefined pra ignorar).
  push?: unknown;
  // resposta HTTP que a rota /ingress deve devolver ao canal (ex: Teams exige
  // um InvokeResponse pro fileConsent/invoke, senão mostra "ação não suportada").
  // Se presente, a rota devolve isso em vez do "ok" padrão.
  response?: { status: number; json?: unknown; body?: string };
}

export interface SendResult {
  ok: boolean;
  id?: string | null;
  error?: string;
}

export interface ChannelAdapter {
  name: string;

  // GET /ingress/:tenant — handshake de verificação (Meta usa; Teams não).
  // Retorna a resposta HTTP, ou null se o canal não faz handshake.
  verify?(query: URLSearchParams, tenant: TenantDef): VerifyResult | null;

  // POST /ingress/:tenant — valida a auth de entrada, parseia o payload cru,
  // e retorna o que empurrar pro agente. Retorna null pra ignorar (ex: evento
  // que não é mensagem).
  receive(
    rawBody: string,
    headers: Record<string, string>,
    tenant: TenantDef,
  ): Promise<IngestResult | null>;

  // Envio (agente → canal). payload = { to, text, ... } (varia por canal).
  send(payload: Record<string, any>, tenant: TenantDef): Promise<SendResult>;
}
