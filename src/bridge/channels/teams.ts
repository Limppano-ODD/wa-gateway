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

import { randomUUID } from "node:crypto";
import axios from "axios";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { TenantDef } from "../config";
import type { ChannelAdapter, IngestResult, SendResult } from "./types";

// JWKS do Bot Connector (chaves públicas pra validar o JWT que o Teams manda).
// OpenID metadata: https://login.botframework.com/v1/.well-known/openidconfiguration
// → jwks_uri = /v1/.well-known/keys (o /v1/keys dá 404 e derruba a validação).
const BOTFRAMEWORK_JWKS = createRemoteJWKSet(
  new URL("https://login.botframework.com/v1/.well-known/keys"),
);

// Envio de arquivo NATIVO no Teams = "file consent card" (2 passos): o bot manda
// um card pedindo permissão; ao aceitar, o Teams devolve um invoke com uma
// uploadUrl (OneDrive pré-autenticada do usuário — seguro, não é link público) e
// o bot dá PUT dos bytes. Guardamos os bytes entre os passos, por um id no card.
// Obs: renderiza no Teams desktop/web; o mobile não suporta esse card (limitação MS).
type PendingFile = {
  bytes: Buffer;
  name: string;
  serviceUrl: string;
  conversationId: string;
};
const pendingFiles = new Map<string, PendingFile>();

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

    // invoke de consentimento de arquivo: o usuário aceitou/recusou o card. Não vai
    // pra ponte — resolvemos aqui (upload dos bytes na uploadUrl do OneDrive). O
    // Teams EXIGE um InvokeResponse ({status:200}) na resposta HTTP, senão mostra
    // "não há suporte para esta ação de cartão".
    if (activity?.type === "invoke" && activity?.name === "fileConsent/invoke") {
      try {
        await handleFileConsent(activity, tenant);
        return { response: { status: 200, json: { status: 200 } } };
      } catch (e: any) {
        console.error("[teams] file consent:", e?.message || e);
        return { response: { status: 200, json: { status: 502 } } };
      }
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

  // Envio (agente → Teams). Dois modos:
  //   texto:   { serviceUrl, conversationId, text }
  //   arquivo: { serviceUrl, conversationId, file: { name, contentBase64, description? } }
  // Arquivo dispara o "file consent card"; o upload real acontece no invoke de aceite.
  async send(payload: Record<string, any>, tenant: TenantDef): Promise<SendResult> {
    const { serviceUrl, conversationId, text, file } = payload;

    if (file && file.contentBase64) {
      if (!serviceUrl || !conversationId || !file.name) {
        return { ok: false, error: "serviceUrl, conversationId e file.name obrigatórios" };
      }
      // Arquivo nativo: manda o file consent card. O upload real acontece quando o
      // usuário aceita (invoke → handleFileConsent). Guarda os bytes até lá.
      try {
        const bytes = Buffer.from(file.contentBase64, "base64");
        const id = randomUUID();
        pendingFiles.set(id, { bytes, name: file.name, serviceUrl, conversationId });
        setTimeout(() => pendingFiles.delete(id), 10 * 60 * 1000).unref?.();

        const accessToken = await getBotToken(tenant);
        const uri = activitiesUri(serviceUrl, conversationId);
        const resp = await axios.post(
          uri,
          {
            type: "message",
            attachments: [{
              contentType: "application/vnd.microsoft.teams.card.file.consent",
              name: file.name,
              content: {
                description: file.description || `Arquivo: ${file.name}`,
                sizeInBytes: bytes.length,
                acceptContext: { id },
                declineContext: { id },
              },
            }],
          },
          { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
        );
        return { ok: true, id: resp.data?.id ?? null };
      } catch (error: any) {
        const detail = error?.response?.data?.error?.message || error?.message || "erro desconhecido";
        return { ok: false, error: detail };
      }
    }

    if (!serviceUrl || !conversationId || !text) {
      return { ok: false, error: "serviceUrl, conversationId e text (ou file) obrigatórios" };
    }
    try {
      const accessToken = await getBotToken(tenant);
      const uri = activitiesUri(serviceUrl, conversationId);
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

// activitiesUri monta a URL pra postar uma activity numa conversa.
function activitiesUri(serviceUrl: string, conversationId: string): string {
  return `${String(serviceUrl).replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
}

// handleFileConsent trata o invoke de aceite/recusa do card de arquivo. No aceite,
// dá PUT dos bytes na uploadUrl (OneDrive do usuário, já autenticada) e manda um
// "file.info" card, que faz o arquivo aparecer no chat pra download.
async function handleFileConsent(activity: any, tenant: TenantDef): Promise<void> {
  const v = activity?.value || {};
  const id = v?.context?.id;
  const pending = id ? pendingFiles.get(id) : undefined;

  if (v?.action !== "accept" || !pending) {
    if (id) pendingFiles.delete(id); // recusou ou expirou — limpa
    return;
  }
  pendingFiles.delete(id);

  const up = v.uploadInfo || {};
  if (!up.uploadUrl) throw new Error("invoke sem uploadInfo.uploadUrl");

  // Upload dos bytes pro OneDrive do usuário (URL já autenticada; sem Bearer).
  await axios.put(up.uploadUrl, pending.bytes, {
    headers: {
      "Content-Length": String(pending.bytes.length),
      "Content-Range": `bytes 0-${pending.bytes.length - 1}/${pending.bytes.length}`,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  // file.info card → o arquivo aparece no chat.
  const accessToken = await getBotToken(tenant);
  await axios.post(
    activitiesUri(pending.serviceUrl, pending.conversationId),
    {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.teams.card.file.info",
        contentUrl: up.contentUrl,
        name: up.name || pending.name,
        content: { uniqueId: up.uniqueId, fileType: up.fileType },
      }],
    },
    { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
  );
}

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
