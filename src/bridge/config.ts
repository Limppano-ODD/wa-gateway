// config.ts — configuração multi-tenant, multi-canal da ponte.
//
// Um tenant = um app/agente interno que DISCA pro gateway (WebSocket) e recebe
// as mensagens de UM canal (whatsapp, teams...).
//
// Duas fontes, nesta ordem de precedência:
//
//   1. ENV (`BRIDGE_TENANTS`) — base fixa, lida no boot. É onde vivem os tenants
//      de produção (sac, crm...). NUNCA pode ser sobrescrita em runtime.
//   2. BANCO (tabela bridge_tenants) — tenants criados pela plataforma de
//      agentes em runtime, sem reiniciar o gateway.
//
// A precedência do env é uma garantia de segurança, não estética: a rota de
// registro é autenticada por um token só, e se ela pudesse regravar o tenant
// "sac" um bot novo herdaria o WhatsApp de produção do SAC.
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

import { timingSafeEqual } from "node:crypto";
import { env } from "../env";
import { storeDisponivel, tenantStore } from "./store";
import { bridgeHub } from "./hub";

export interface TenantDef {
  wsToken: string;
  channel: string; // "whatsapp" | "teams" | ...
  config: Record<string, any>;
}

export type Origem = "env" | "runtime";

// O nome vira segmento de URL (/ingress/:tenant). Restringir aqui evita que um
// nome com "/", ".." ou espaço produza rota estranha ou log confuso.
const NOME_VALIDO = /^[a-z0-9][a-z0-9._-]{1,62}$/;

// Teto de tenants criados em runtime. Guarda-corpo contra laço com bug ou token
// comprometido enchendo a tabela — não é limite de negócio.
const MAX_TENANTS_RUNTIME = 200;

// Campos que cada canal precisa ter pra funcionar. Validar no registro impede
// gravar um tenant que só falharia na primeira mensagem real.
const OBRIGATORIOS: Record<string, string[]> = {
  teams: ["appId", "appPassword", "tenantId"],
  whatsapp: ["verifyToken", "phoneNumberId", "metaToken"],
};

// Campo que IDENTIFICA de quem é o tenant, por canal. Um tenant pertence a UMA
// identidade: no Teams, ao app registration (appId); no WhatsApp, ao número
// (phoneNumberId).
//
// Serve pra distinguir dois casos que o PUT idempotente confundia:
//
//   mesma identidade  → é o MESMO bot repetindo o registro (retry de rede, ou
//                       rotação de segredo). Legítimo, atualiza.
//   identidade outra  → é OUTRO bot tentando ocupar um nome de tenant que já
//                       tem dono. Recusa.
//
// Sem isso, criar um bot novo com o nome de tenant de um bot existente
// sobrescrevia as credenciais dele e derrubava a conexão viva: o bot antigo
// emudecia em produção e a criação do novo reportava sucesso.
const IDENTIDADE: Record<string, string> = {
  teams: "appId",
  whatsapp: "phoneNumberId",
};

function parseEnvTenants(): Record<string, TenantDef> {
  try {
    const p = JSON.parse(env.BRIDGE_TENANTS || "{}");
    return p && typeof p === "object" ? p : {};
  } catch (e) {
    console.error("[bridge.config] BRIDGE_TENANTS não é JSON válido:", (e as Error).message);
    return {};
  }
}

const envTenants: Record<string, TenantDef> = parseEnvTenants();
const runtimeTenants = new Map<string, TenantDef>();

// Carrega o que já estava gravado. Um tenant de runtime com nome de tenant do
// env é IGNORADO (o env ganha) — pode acontecer se alguém promoveu pro env
// depois. Não apaga a linha: promoção pode ser revertida.
function carregarDoBanco(): void {
  runtimeTenants.clear();
  let ignorados = 0;
  for (const row of tenantStore.listar()) {
    if (envTenants[row.name]) {
      ignorados++;
      continue;
    }
    runtimeTenants.set(row.name, { wsToken: row.wsToken, channel: row.channel, config: row.config });
  }
  const n = runtimeTenants.size;
  console.log(
    `[bridge.config] tenants: ${Object.keys(envTenants).length} do env, ${n} do banco` +
      (ignorados ? ` (${ignorados} ignorado(s): nome já existe no env)` : ""),
  );
}
carregarDoBanco();

// nome do tenant -> def. Env primeiro.
export function tenant(name: string | undefined): TenantDef | null {
  if (!name) return null;
  return envTenants[name] || runtimeTenants.get(name) || null;
}

export function origemDoTenant(name: string): Origem | null {
  if (envTenants[name]) return "env";
  if (runtimeTenants.has(name)) return "runtime";
  return null;
}

// Comparação de segredo em tempo constante. `===` em string vaza o tamanho do
// prefixo comum pelo tempo — irrelevante isolado, mas isto é o caminho de auth
// da ponte e o custo de fazer certo é zero.
function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// wsToken -> nome do tenant (pra autenticar a conexão WebSocket)
export function tenantByWsToken(token: string | undefined): string | null {
  if (!token) return null;
  for (const [name, def] of Object.entries(envTenants)) {
    if (def.wsToken && tokensIguais(def.wsToken, token)) return name;
  }
  for (const [name, def] of runtimeTenants) {
    if (def.wsToken && tokensIguais(def.wsToken, token)) return name;
  }
  return null;
}

export interface ResultadoRegistro {
  ok: boolean;
  status: number;
  erro?: string;
  criado?: boolean;
}

// registrarTenant grava/atualiza um tenant de runtime. Idempotente: repetir com
// os mesmos valores devolve ok sem efeito colateral (a plataforma de agentes
// pode ter retry).
export function registrarTenant(
  name: string,
  channel: string,
  wsToken: string,
  config: Record<string, any>,
): ResultadoRegistro {
  // Sem a tabela, registrar em runtime não é possível — responde 503 explícito em
  // vez de estourar no INSERT e virar 500.
  if (!storeDisponivel()) {
    return { ok: false, status: 503, erro: "armazenamento de tenants indisponível (ver log do boot)" };
  }
  if (typeof name !== "string" || !NOME_VALIDO.test(name)) {
    return { ok: false, status: 400, erro: "nome inválido (use a-z, 0-9, . _ -, 2 a 63 chars)" };
  }
  // Teto no número de tenants de runtime: sem isso um token comprometido (ou um
  // laço com bug do lado do control-plane) enche a tabela e o Map em memória
  // indefinidamente. O número é folgado — a Limppano tem 10 empresas.
  if (runtimeTenants.size >= MAX_TENANTS_RUNTIME && !runtimeTenants.has(name)) {
    return {
      ok: false,
      status: 507,
      erro: `limite de ${MAX_TENANTS_RUNTIME} tenants de runtime atingido — remova algum antes de criar outro`,
    };
  }
  if (envTenants[name]) {
    // 409 e não 403: o nome existe, só não é gravável por aqui.
    return { ok: false, status: 409, erro: `tenant "${name}" vem do env e não pode ser alterado em runtime` };
  }
  // Object.hasOwn e não `!OBRIGATORIOS[channel]`: a chave vem do corpo da
  // requisição, e `OBRIGATORIOS["__proto__"]` ou `["constructor"]` resolve pela
  // cadeia de protótipo pra algo truthy — a checagem de "canal desconhecido"
  // não disparava. Hoje o efeito era só um 500 na linha seguinte (Object não
  // tem .filter), mas depender de um crash acidental pra barrar entrada não é
  // barreira. (CWE-1321)
  if (!channel || !Object.hasOwn(OBRIGATORIOS, channel)) {
    return { ok: false, status: 400, erro: `canal desconhecido: ${channel || "(vazio)"}` };
  }
  // typeof antes de .length: se wsToken vier como número no JSON, `.length` é
  // undefined e `undefined < 16` é false — a validação PASSAVA com um valor que
  // não é string, e o erro só aparecia depois, no bind do sqlite, como 500.
  if (typeof wsToken !== "string" || wsToken.length < 16) {
    return { ok: false, status: 400, erro: "wsToken ausente, não-texto, ou curto demais (mínimo 16 chars)" };
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, status: 400, erro: "config precisa ser um objeto" };
  }
  const obrigatorios = OBRIGATORIOS[channel] ?? [];
  const faltando = obrigatorios.filter((k) => typeof config[k] !== "string" || !config[k]);
  if (faltando.length) {
    return { ok: false, status: 400, erro: `config do canal ${channel} sem: ${faltando.join(", ")}` };
  }

  // Colisão de wsToken com OUTRO tenant tornaria ambíguo quem está discando.
  const donoEnv = Object.entries(envTenants).find(([, d]) => d.wsToken === wsToken)?.[0];
  if (donoEnv) return { ok: false, status: 409, erro: "wsToken já pertence a um tenant do env" };
  const donoBanco = tenantStore.donoDoToken(wsToken);
  if (donoBanco && donoBanco !== name) {
    return { ok: false, status: 409, erro: `wsToken já pertence ao tenant "${donoBanco}"` };
  }

  const anterior = runtimeTenants.get(name);

  // O tenant já existe: só o MESMO dono pode reescrever. Outro bot tentando
  // ocupar o nome é recusado, não atendido silenciosamente.
  if (anterior) {
    if (anterior.channel !== channel) {
      return { ok: false, status: 409, erro: `tenant "${name}" já existe no canal ${anterior.channel}` };
    }
    const campo = IDENTIDADE[channel];
    const donoAtual = campo ? anterior.config?.[campo] : undefined;
    const donoNovo = campo ? config?.[campo] : undefined;
    if (campo && donoAtual && donoAtual !== donoNovo) {
      return {
        ok: false,
        status: 409,
        erro:
          `tenant "${name}" já pertence a outro ${campo} (${donoAtual}) — ` +
          `sobrescrever derrubaria a ponte dele. Use outro nome de tenant.`,
      };
    }
  }

  tenantStore.gravar(name, channel, wsToken, config);
  runtimeTenants.set(name, { wsToken, channel, config });

  // Se o token MUDOU, quem estava conectado com o antigo tem que cair. Sem isso
  // "trocar a credencial" não revogaria nada: a conexão velha segue aberta e
  // recebendo mensagens até o processo reiniciar.
  if (anterior && anterior.wsToken !== wsToken) {
    const n = bridgeHub.derrubar(name, "credencial trocada");
    console.log(`[bridge.config] tenant "${name}": wsToken trocado, ${n} conexão(ões) derrubada(s)`);
  }

  console.log(`[bridge.config] tenant "${name}" (${channel}) ${anterior ? "atualizado" : "registrado"}`);
  return { ok: true, status: anterior ? 200 : 201, criado: !anterior };
}

export function removerTenant(name: string): ResultadoRegistro {
  if (envTenants[name]) {
    return { ok: false, status: 409, erro: `tenant "${name}" vem do env e não pode ser removido em runtime` };
  }
  const existia = tenantStore.remover(name);
  runtimeTenants.delete(name);
  // Remover sem derrubar deixaria a ponte aberta entregando mensagens de um
  // tenant que "não existe mais" — revogação tem que ser efetiva.
  const n = bridgeHub.derrubar(name, "tenant removido");
  if (!existia) return { ok: false, status: 404, erro: "tenant não encontrado" };
  console.log(`[bridge.config] tenant "${name}" removido (${n} conexão(ões) derrubada(s))`);
  return { ok: true, status: 200 };
}

// Listagem SEM segredo: nome, canal e origem. wsToken e config (que carrega
// appPassword/metaToken) nunca saem por aqui.
export function listarTenants(): Array<{ name: string; channel: string; origem: Origem }> {
  const out: Array<{ name: string; channel: string; origem: Origem }> = [];
  for (const [name, def] of Object.entries(envTenants)) out.push({ name, channel: def.channel, origem: "env" });
  for (const [name, def] of runtimeTenants) out.push({ name, channel: def.channel, origem: "runtime" });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Só pra teste: recarrega o estado em memória a partir do banco.
export function _recarregar(): void {
  carregarDoBanco();
}
