// controller.ts — rotas HTTP genéricas da ponte (uma rota, todos os canais).
//
//   GET  /ingress/:tenant → handshake (o canal decide; WhatsApp usa, Teams não)
//   POST /ingress/:tenant → mensagem chega do canal → valida+parseia via adapter
//                           → empurra pra ponte WebSocket do tenant
//   POST /ingress/:tenant/send → app envia por HTTP (alternativa ao WS) → adapter.send
//   GET  /bridge/status   → tenants conectados (debug)
//
// Roteia pelo :tenant (config diz qual canal) — adicionar app/canal = só config.

import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import {
  listarTenants,
  origemDoTenant,
  registrarTenant,
  removerTenant,
  tenant as tenantDef,
  tenantByWsToken,
} from "./config";
import { adapterFor } from "./channels";
import { bridgeHub } from "./hub";
import { env } from "../env";

// Teto do corpo das rotas admin, em bytes. A config de um tenant tem meia dúzia
// de campos curtos — 16 KB é ~100x o tamanho real.
const LIMITE_CORPO = 16_384;

// Freio de força-bruta nas rotas admin.
//
// Sem isso, quem alcança a rede pode tentar o BRIDGE_ADMIN_TOKEN indefinidamente
// sem ser bloqueado nem deixar rastro — e acertar dá controle sobre criar,
// rotacionar e remover qualquer tenant de runtime. O piso de entropia no env
// (24 chars) torna a busca inviável; este freio garante que ela também seja
// LENTA e VISÍVEL no log.
//
// Janela deslizante simples em memória, por IP. Não é rate limit distribuído —
// o gateway sobe como instância única (ver compose/deploy) e o objetivo aqui é
// freio + rastro, não cota precisa.
const TENTATIVAS_MAX = 10;
const JANELA_MS = 60_000;
const tentativas = new Map<string, number[]>();

function ipDaRequisicao(c: any): string {
  const xff = c.req.header("x-forwarded-for") || "";
  return (xff.split(",")[0] || "").trim() || c.req.header("x-real-ip") || "desconhecido";
}

// Só conta FALHA. Um cliente legítimo (o control-plane) nunca acumula.
function registrarFalha(ip: string, agora: number): number {
  const recentes = (tentativas.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  recentes.push(agora);
  tentativas.set(ip, recentes);
  // Poda preguiçosa: sem isso o Map cresce indefinidamente com IPs que tentaram
  // uma vez e nunca voltaram.
  if (tentativas.size > 1000) {
    for (const [k, v] of tentativas) {
      if (v.every((t) => agora - t >= JANELA_MS)) tentativas.delete(k);
    }
  }
  return recentes.length;
}

function bloqueado(ip: string, agora: number): boolean {
  const recentes = (tentativas.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  return recentes.length >= TENTATIVAS_MAX;
}

// tokenAdminConfere compara o token da requisição, SEM contar tentativa nem
// logar. Usado por rota onde "sem token" é caso legítimo (o /bridge/status, que
// é health check) — ali um token ausente não é ataque e não pode consumir o
// orçamento de tentativas de quem monitora.
function tokenAdminConfere(c: any): boolean {
  const esperado = env.BRIDGE_ADMIN_TOKEN;
  if (!esperado) return false;
  const bearer = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  const recebido = bearer || c.req.header("x-bridge-admin-token") || "";
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Guarda das rotas de administração de tenant. Fail-closed: sem
// BRIDGE_ADMIN_TOKEN configurado a rota não existe pra ninguém. Aqui um token
// errado É tentativa, então conta e loga.
function adminAutorizado(c: any): { ok: true } | { ok: false; status: number; erro: string } {
  if (!env.BRIDGE_ADMIN_TOKEN) {
    return { ok: false, status: 503, erro: "registro de tenant em runtime desabilitado (BRIDGE_ADMIN_TOKEN não configurado)" };
  }

  // Confere o token ANTES de olhar o bloqueio, e deixa passar quem acertou mesmo
  // que o IP esteja bloqueado.
  //
  // Ordem importa: o freio existe pra atrasar quem está ADIVINHANDO, e quem tem
  // o token certo não está. Checando o bloqueio primeiro, alguém errando de
  // propósito 10 vezes travaria o control-plane por 1 minuto — e, atrás de um
  // proxy/NAT compartilhado, todo mundo vem do mesmo IP. Isso transformaria a
  // proteção contra força-bruta numa negação de serviço fácil sobre criar bot.
  // Como força-bruta por definição nunca chega a acertar, liberar o acerto não
  // enfraquece nada.
  if (tokenAdminConfere(c)) return { ok: true };

  const ip = ipDaRequisicao(c);
  const agora = Date.now();
  if (bloqueado(ip, agora)) {
    console.warn(`[bridge.admin] BLOQUEADO por excesso de tentativas: ip=${ip}`);
    return { ok: false, status: 429, erro: "muitas tentativas — tente novamente em 1 minuto" };
  }
  const n = registrarFalha(ip, agora);
  console.warn(`[bridge.admin] token inválido: ip=${ip} tentativa=${n}/${TENTATIVAS_MAX}`);
  return { ok: false, status: 401, erro: "token inválido" };
}

export const createBridgeController = () => {
  const app = new Hono();

  // GET /ingress/:tenant — handshake (se o canal tiver)
  app.get("/ingress/:tenant", (c) => {
    const t = tenantDef(c.req.param("tenant"));
    if (!t) return c.text("tenant desconhecido", 404);
    const adapter = adapterFor(t.channel);
    if (!adapter?.verify) return c.text("canal não faz handshake", 404);
    const url = new URL(c.req.url);
    const r = adapter.verify(url.searchParams, t);
    if (!r) return c.text("forbidden", 403);
    return c.text(r.body, r.status as any);
  });

  // POST /ingress/:tenant — mensagem entrando
  app.post("/ingress/:tenant", async (c) => {
    const name = c.req.param("tenant");
    const t = tenantDef(name);
    if (!t) return c.text("tenant desconhecido", 404);
    const adapter = adapterFor(t.channel);
    if (!adapter) return c.text("canal sem adapter", 404);

    const rawBody = await c.req.text();
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => (headers[k] = v));

    // receive() é rápido (valida/parseia); o trabalho pesado (o agente) roda do
    // outro lado da ponte. Alguns eventos exigem uma resposta HTTP específica
    // (ex: Teams fileConsent/invoke → InvokeResponse) — por isso aguardamos aqui.
    let result: Awaited<ReturnType<typeof adapter.receive>> = null;
    try {
      result = await adapter.receive(rawBody, headers, t);
    } catch (e: any) {
      console.error(`[bridge] erro processando entrada de ${name}:`, e?.message || e);
      return c.text("ok"); // não vaza erro pro canal
    }

    if (result?.response) {
      const r = result.response;
      if (r.json !== undefined) return c.json(r.json as any, r.status as any);
      return c.body(r.body ?? "", r.status as any);
    }
    if (result?.push) {
      // Entrega protegida: antes isto rodava em background com .catch(), então
      // exceção aqui NUNCA podia afetar a resposta HTTP. Ao trazer pro caminho
      // síncrono (necessário pro InvokeResponse do Teams), uma exceção subiria
      // pro middleware de erro e devolveria 500 ao webhook — e 500 pra Meta
      // significa RETRY, ou seja, mensagem de WhatsApp entregue duas vezes ao
      // app e possivelmente resposta duplicada pro cliente. O canal já recebeu a
      // mensagem; falha na ponte é problema nosso, não motivo pra pedir reenvio.
      try {
        const n = bridgeHub.entregar(name, { type: "message", ...(result.push as object) });
        console.log(`[bridge] ${adapter.name} → tenant "${name}" (${n} ponte(s))`);
      } catch (e: any) {
        console.error(`[bridge] falha entregando na ponte de ${name}:`, e?.message || e);
      }
    }
    return c.text("ok");
  });

  // POST /ingress/:tenant/send — envio por HTTP (auth pelo wsToken do tenant)
  app.post("/ingress/:tenant/send", async (c) => {
    const name = c.req.param("tenant");
    const t = tenantDef(name);
    if (!t) return c.json({ success: false, error: "tenant desconhecido" }, 404);
    const token = c.req.query("token") || c.req.header("x-app-token");
    if (tenantByWsToken(token) !== name) {
      return c.json({ success: false, error: "token inválido" }, 401);
    }
    const adapter = adapterFor(t.channel);
    if (!adapter) return c.json({ success: false, error: "canal sem adapter" }, 404);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "corpo inválido" }, 400);
    }
    const r = await adapter.send(body, t);
    return c.json({ success: r.ok, id: r.id ?? null, error: r.error ?? null }, r.ok ? 200 : 502);
  });

  // GET /bridge/status — health da ponte.
  //
  // Sem token devolve só a CONTAGEM. Antes devolvia o mapa nome→conexões sem
  // auth nenhuma, e com o registro em runtime isso piorou: a população de
  // tenants passou a ser dinâmica e vinda de fora, então a rota entregava de
  // graça os nomes dos bots criados pela plataforma. Nome de tenant é o que
  // compõe /ingress/:tenant, que é webhook público — dar a lista é entregar o
  // alvo.
  //
  // Com token, o detalhe por tenant continua disponível (é o uso real de debug).
  app.get("/bridge/status", (c) => {
    const detalhe = bridgeHub.status();
    // tokenAdminConfere (e não adminAutorizado): sem token é uso legítimo aqui,
    // não tentativa de invasão — não pode consumir o orçamento de tentativas de
    // quem só está monitorando.
    if (tokenAdminConfere(c)) {
      return c.json({ tenants_online: detalhe });
    }
    const nomes = Object.keys(detalhe);
    return c.json({
      tenants_conectados: nomes.length,
      pontes_abertas: nomes.reduce((n, k) => n + (detalhe[k] ?? 0), 0),
    });
  });

  // ── Administração de tenants em RUNTIME ────────────────────────────────────
  // Quem chama é o control-plane da plataforma de agentes, ao provisionar um bot.
  // Antes disso, um bot novo só passava a existir editando BRIDGE_TENANTS e
  // REINICIANDO o gateway — o que derruba a ponte de todos os bots no ar.

  // GET /bridge/tenants — nome, canal e origem. Sem segredo no corpo.
  app.get("/bridge/tenants", (c) => {
    const auth = adminAutorizado(c);
    if (!auth.ok) return c.json({ success: false, error: auth.erro }, auth.status as any);
    return c.json({ success: true, tenants: listarTenants(), online: bridgeHub.status() });
  });

  // PUT /bridge/tenants/:name — cria ou atualiza. Idempotente.
  app.put("/bridge/tenants/:name", async (c) => {
    const auth = adminAutorizado(c);
    if (!auth.ok) return c.json({ success: false, error: auth.erro }, auth.status as any);

    const name = c.req.param("name");

    // Teto de corpo: a config de um tenant tem meia dúzia de campos curtos, e
    // ler JSON sem limite deixa a rota servir de vetor de memória. 16 KB é ~100x
    // o tamanho real.
    //
    // Duas checagens de propósito. O header é o atalho — corta antes de ler
    // qualquer byte quando o cliente é honesto sobre o tamanho. Mas ele é
    // OPCIONAL: requisição com transfer-encoding chunked não manda
    // content-length, e confiar só nele deixava o limite ser contornado com uma
    // flag de cliente. A segunda checagem é sobre os bytes que realmente
    // chegaram.
    const declarado = Number(c.req.header("content-length") || 0);
    if (declarado > LIMITE_CORPO) {
      return c.json({ success: false, error: "corpo grande demais (máximo 16KB)" }, 413);
    }

    let bruto: string;
    try {
      bruto = await c.req.text();
    } catch {
      return c.json({ success: false, error: "não foi possível ler o corpo" }, 400);
    }
    if (bruto.length > LIMITE_CORPO) {
      return c.json({ success: false, error: "corpo grande demais (máximo 16KB)" }, 413);
    }

    let body: any;
    try {
      body = JSON.parse(bruto);
    } catch {
      return c.json({ success: false, error: "corpo inválido (esperado JSON)" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ success: false, error: "corpo precisa ser um objeto JSON" }, 400);
    }
    const r = registrarTenant(name, body.channel, body.wsToken, body.config || {});
    if (!r.ok) return c.json({ success: false, error: r.erro }, r.status as any);
    return c.json({ success: true, name, criado: r.criado === true }, r.status as any);
  });

  // DELETE /bridge/tenants/:name
  app.delete("/bridge/tenants/:name", (c) => {
    const auth = adminAutorizado(c);
    if (!auth.ok) return c.json({ success: false, error: auth.erro }, auth.status as any);

    const name = c.req.param("name");
    const r = removerTenant(name);
    if (!r.ok) return c.json({ success: false, error: r.erro }, r.status as any);
    return c.json({ success: true, name });
  });

  // GET /bridge/tenants/:name — existe? de onde vem? está online?
  app.get("/bridge/tenants/:name", (c) => {
    const auth = adminAutorizado(c);
    if (!auth.ok) return c.json({ success: false, error: auth.erro }, auth.status as any);

    const name = c.req.param("name");
    const origem = origemDoTenant(name);
    if (!origem) return c.json({ success: false, error: "tenant não encontrado" }, 404);
    const t = tenantDef(name)!;
    return c.json({
      success: true,
      name,
      channel: t.channel,
      origem,
      pontes: bridgeHub.status()[name] || 0,
    });
  });

  return app;
};
