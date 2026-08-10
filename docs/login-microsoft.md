# Login Microsoft (Entra ID)

## Escopo: humano sim, máquina não

O login Microsoft vale **apenas para pessoa no browser**. As rotas chamadas por outros sistemas continuam em HTTP Basic com credencial de serviço:

| Superfície | Quem usa | Autenticação |
|---|---|---|
| `/admin` | pessoa | **Entra** (fallback Basic durante a transição) |
| `/dashboard` | pessoa | Basic — ver limitação abaixo |
| `/message/*`, `/profile/*`, `/session/*` | CRM, data-gateway | Basic (credencial de serviço) |
| `/ingress/:tenant`, `/bridge/agent` | agent-platform | `wsToken` por tenant |
| `/status`, `/status/:session` | Gatus | bearer `STATUS_TOKEN` |

Trocar a autenticação das rotas de máquina exigiria deploy coordenado de CRM, data-gateway e agent-platform ao mesmo tempo. É outro projeto, e não é o que este passo resolve.

## Limitação conhecida: `/dashboard` ainda não aceita Entra

O `/dashboard` usa `user.username` **como nome da sessão do WhatsApp** — em cinco lugares (`dashboard.ts:117,146,203,232,269`). Uma pessoa do Entra não tem sessão chamada `fulano@limppano.com.br`, então a tela quebraria.

Desacoplar sessão de usuário é a **Fase 2**. Até lá, `/dashboard` continua em Basic e o Entra vale no `/admin`.

## Fluxo

Authorization Code + PKCE.

```
GET /auth/login     -> redireciona ao Entra (state + code_challenge em cookie HttpOnly)
GET /auth/callback  -> valida state, troca code, valida id_token, cria sessão
GET /auth/logout    -> APAGA a sessão do banco e limpa o cookie
GET /auth/me        -> introspecção ("por que não sou admin?")
```

A sessão vive **no banco** (`web_sessions`), não dentro de um JWT no cookie. A diferença aparece no dia em que alguém sai da empresa: derrubar a sessão vira um `DELETE`, em vez de esperar o token expirar sozinho.

O cookie é `HttpOnly`, `SameSite=Lax`, e `Secure` em produção.

## Validação do token

Quatro checagens, todas obrigatórias:

1. **Assinatura** contra o JWKS do tenant (`jose`, com cache de chaves)
2. **Issuer** = `https://login.microsoftonline.com/<tid>/v2.0`
3. **Audience** = o client id deste app
4. **`tid`** conferido explicitamente contra `AZURE_AD_TENANT_ID`

A quarta não é redundante: sem ela, um token legítimo de **outro** tenant passaria pela verificação de assinatura. O app é single-tenant, então isso nunca pode acontecer.

## Quem é admin

```
grupo dedicado  ->  via: "group"       (caminho normal)
papel de diretório -> via: "breakglass" (exceção, auditada e logada alto)
nenhum dos dois -> 403 com a página "sem acesso"
```

O grupo tem **precedência**. Quem está no grupo e também é Global Admin entra como `group`, não como `breakglass` — senão a auditoria de porta dos fundos enche de ruído e para de significar alguma coisa.

Break-glass padrão: **Global Administrator** (`62e90394-…`) e **Privileged Role Administrator** (`e8611ab8-…`). Ambos já podem se conceder qualquer coisa no tenant, então barrá-los seria teatro. Ampliável por `ENTRA_BREAKGLASS_WIDS` sem deploy de código — por exemplo para incluir Application Administrator, deixado de fora do default por ser um grupo normalmente grande e operacional.

Toda entrada por break-glass grava `login_breakglass` em `auth_events` **e** loga em stdout. Caminho privilegiado silencioso é backdoor.

## Primeiro login não concede acesso

Login identifica, não autoriza. O primeiro acesso cria a linha em `people` (oid, e-mail, nome) e para aí, com 403 e a página explicando. Auto-provisionar significaria que qualquer pessoa do tenant entra e opera o WhatsApp corporativo.

## Modo de falha que morde: overage de grupos

Quando a pessoa está em grupos demais, o Entra **remove** o claim `groups` do token e o substitui por `_claim_names`/`_claim_sources`, mandando consultar o Graph. O sintoma é perverso: um admin legítimo é rebaixado sem ninguém ter mudado nada.

Não consultamos o Graph (ainda). O caso é **detectado e registrado** como `grupos_em_overage` em `auth_events`, para o diagnóstico não começar do zero — e o break-glass continua sendo a saída, porque papel de diretório vem em `wids`, que não sofre o mesmo overage.

## Fallback Basic

`AUTH_ALLOW_BASIC_FALLBACK=true` (padrão) mantém o Basic valendo nas rotas humanas. É rede de segurança deliberada: se o Entra ficar fora do ar ou a secret vencer, o painel não pode ficar inacessível justamente quando alguém precisa re-parear uma sessão do WhatsApp.

Vira `false` na Fase 4, depois que o login Microsoft estiver provado em uso real.

Com `false` **e** Entra não configurado, as rotas humanas devolvem 503 com a mensagem dizendo que ninguém consegue entrar — falha explícita em vez de porta destrancada.

## Configuração no tenant (já feita)

| Item | Valor |
|---|---|
| App registration | `wa-gateway` — `f71f9220-37fc-405f-afd7-c5ca5e3f66b9` |
| Tenant | `6fdfcb68-bdb6-4b67-ae6a-2356458c73d0` |
| Grupo admin | `WaGateway_admin` — `d1f20fe8-acfd-4a5d-a3d3-c5deb5d944b4` |
| Redirect URIs | `https://wa-gateway.odd.com.br/auth/callback`, `http://localhost:3002/auth/callback` |
| Claims | `groupMembershipClaims: SecurityGroup`, single-tenant |

App registration **dedicada**, não a compartilhada do parque (`24f015ec`, o `user api`). Naquela, o `aud` não isola nada: um token emitido para qualquer um dos apps que a usam é aceito pelos outros. Aceitável como dívida herdada; injustificável num app novo.

## Auditoria

```sql
SELECT ts, email, event, method, detail FROM auth_events ORDER BY ts DESC LIMIT 50;
```

Eventos: `login_ok`, `login_breakglass`, `login_sem_acesso`, `login_falhou`, `grupos_em_overage`.

Derrubar todas as sessões de uma pessoa:

```sql
DELETE FROM web_sessions WHERE person_oid = '<oid>';
```
