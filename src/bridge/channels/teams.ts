// teams.ts — adapter do canal Microsoft Teams (Bot Framework).
//
// Diferente do WhatsApp: o Teams manda "Activities" e assina cada request com
// um JWT do Bot Connector (emissor https://api.botframework.com). Validamos o
// JWT na entrada; no envio, pegamos um token AAD do App do bot e postamos no
// serviceUrl da conversa.
//
// config do tenant (channel: "teams"):
//   { appId, appPassword, tenantId }   (tenantId = tenant AAD do bot single-tenant)
//
// receive: valida JWT (aud == appId), extrai texto + serviceUrl + conversation.
// send: token AAD (client_credentials) → POST {serviceUrl}/v3/conversations/{id}/activities

import axios from "axios";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { TenantDef } from "../config";
import type { ChannelAdapter, IngestResult, SendResult } from "./types";

// JWKS do Bot Connector (chaves públicas pra validar o JWT que o Teams manda).
// OpenID metadata: https://login.botframework.com/v1/.well-known/openidconfiguration
const BOTFRAMEWORK_JWKS = createRemoteJWKSet(
  new URL("https://login.botframework.com/v1/keys"),
);

export const teamsAdapter: ChannelAdapter = {
  name: "teams",

  // Teams não faz handshake GET (não tem verify). O portal valida uma vez via POST.
  verify: undefined,

  async receive(
    rawBody: string,
    headers: Record<string, string>,
    tenant: TenantDef,
  ): Promise<IngestResult | null> {
    // 1) valida o JWT do Bot Connector (Authorization: Bearer ...)
    const auth = headers["authorization"] || headers["Authorization"] || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      throw new Error("Teams: sem Authorization Bearer");
    }
    try {
      await jwtVerify(token, BOTFRAMEWORK_JWKS, {
        // aud tem que ser o App ID do nosso bot (senão é pra outro bot)
        audience: tenant.config.appId,
        issuer: [
          "https://api.botframework.com",
        ],
      });
    } catch (e) {
      throw new Error(`Teams: JWT inválido — ${(e as Error).message}`);
    }

    // 2) parseia a Activity
    let activity: any;
    try {
      activity = JSON.parse(rawBody);
    } catch {
      return null;
    }
    // só interessa mensagem de texto
    if (activity?.type !== "message") return null;

    return {
      push: {
        source: "teams",
        text: activity.text,
        from: activity.from,               // { id, name, aadObjectId }
        conversation: activity.conversation, // { id }
        serviceUrl: activity.serviceUrl,   // pra responder
        recipient: activity.recipient,
        activityId: activity.id,
        raw: activity,
      },
    };
  },

  // Envia texto de volta pra conversa do Teams.
  // payload = { serviceUrl, conversationId, text }
  async send(payload: Record<string, any>, tenant: TenantDef): Promise<SendResult> {
    const { serviceUrl, conversationId, text } = payload;
    if (!serviceUrl || !conversationId || !text) {
      return { ok: false, error: "serviceUrl, conversationId e text obrigatórios" };
    }
    try {
      const accessToken = await getBotToken(tenant);
      const uri = `${String(serviceUrl).replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
      const resp = await axios.post(
        uri,
        { type: "message", text },
        { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
      );
      return { ok: true, id: resp.data?.id ?? null };
    } catch (error: any) {
      const detail = error?.response?.data?.error?.message || error?.message || "erro desconhecido";
      return { ok: false, error: detail };
    }
  },
};

// Token AAD do App do bot (client_credentials). Single-tenant usa o tenantId;
// multi-tenant usaria "botframework.com". Cache simples em memória por appId.
const tokenCache = new Map<string, { token: string; exp: number }>();

async function getBotToken(tenant: TenantDef): Promise<string> {
  const { appId, appPassword, tenantId } = tenant.config;
  const cached = tokenCache.get(appId);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp > now + 60) return cached.token;

  const tokenUrl = tenantId
    ? `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
    : `https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: appId,
    client_secret: appPassword,
    scope: "https://api.botframework.com/.default",
  });

  const resp = await axios.post(tokenUrl, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const token = resp.data?.access_token;
  const expiresIn = Number(resp.data?.expires_in || 3600);
  tokenCache.set(appId, { token, exp: now + expiresIn });
  return token;
}
