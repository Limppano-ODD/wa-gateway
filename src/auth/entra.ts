import { createHash, randomBytes } from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../env";

/**
 * Cliente OpenID Connect do Entra ID — Authorization Code + PKCE.
 *
 * Escopo desta camada: montar a URL de autorização, trocar o code por token e
 * VALIDAR o id_token. Quem decide o que fazer com as claims é `roles.ts`.
 */

const issuer = () =>
  `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/v2.0`;

const authorizeUrl = () =>
  `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/oauth2/v2.0/authorize`;

const tokenUrl = () =>
  `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`;

// Cache do JWKS: `createRemoteJWKSet` guarda as chaves e só rebusca quando
// aparece um `kid` desconhecido (rotação). Criar um por request derrubaria
// isso e bateria no Entra a cada login.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function chaves() {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(
        `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/discovery/v2.0/keys`
      )
    );
  }
  return jwks;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export type PkcePar = { verifier: string; challenge: string };

export function gerarPkce(): PkcePar {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function gerarState(): string {
  return base64url(randomBytes(24));
}

export function montarUrlDeLogin(
  redirectUri: string,
  state: string,
  challenge: string
): string {
  const q = new URLSearchParams({
    client_id: env.AZURE_AD_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    // `openid` para ter id_token; `profile`/`email` para nome e e-mail. Nada
    // além disso: o app não chama Graph, então não pede permissão que não usa.
    scope: "openid profile email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${authorizeUrl()}?${q.toString()}`;
}

export type ClaimsDoUsuario = {
  oid: string;
  email: string | null;
  name: string | null;
  groups: unknown;
  wids: unknown;
  bruto: Record<string, unknown>;
};

/**
 * Troca o code pelo token e valida o id_token.
 *
 * A validação é o ponto em que este código impede que alguém entre com um
 * token que não é nosso: assinatura conferida contra o JWKS do tenant, issuer
 * e audience exigidos, e `tid` conferido explicitamente. Sem o `tid`, um token
 * legítimo de OUTRO tenant com o mesmo formato passaria pela verificação de
 * assinatura — o app é single-tenant, então isso nunca pode acontecer.
 */
export async function trocarCodePorClaims(
  code: string,
  redirectUri: string,
  verifier: string
): Promise<ClaimsDoUsuario> {
  const corpo = new URLSearchParams({
    client_id: env.AZURE_AD_CLIENT_ID,
    client_secret: env.AZURE_AD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: "openid profile email",
  });

  const resposta = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  const dados = (await resposta.json().catch(() => null)) as {
    id_token?: string;
    error_description?: string;
  } | null;

  if (!resposta.ok || !dados?.id_token) {
    // Mensagem do Entra ajuda no diagnóstico (redirect_uri errada, secret
    // vencida) e não contém segredo nosso.
    throw new Error(
      `troca de code falhou (${resposta.status}): ${dados?.error_description ?? "sem id_token"}`
    );
  }

  const { payload } = await jwtVerify(dados.id_token, chaves(), {
    issuer: issuer(),
    audience: env.AZURE_AD_CLIENT_ID,
  });

  if (payload.tid !== env.AZURE_AD_TENANT_ID) {
    throw new Error("id_token de outro tenant");
  }

  const oid = typeof payload.oid === "string" ? payload.oid : null;
  if (!oid) {
    throw new Error("id_token sem oid");
  }

  const email =
    (typeof payload.email === "string" && payload.email) ||
    (typeof payload.preferred_username === "string" &&
      payload.preferred_username) ||
    null;

  return {
    oid,
    email,
    name: typeof payload.name === "string" ? payload.name : null,
    groups: payload.groups,
    wids: payload.wids,
    bruto: payload as Record<string, unknown>,
  };
}
