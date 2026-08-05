# 01 — Setup no Azure

O que precisa existir no Azure pra um bot de Teams funcionar. Feito **uma vez** por
bot (depois automatizamos pela plataforma — ver [06](06-integrar-plataforma.md)).

## Os 4 artefatos

1. **App registration (Entra ID / Azure AD)** — a identidade do bot.
   - Gera um **App ID** (client id). É o `botId` que vai no manifest.
   - Precisa de um **client secret** (senha) → usado pra pegar token AAD e postar
     a resposta de volta no Teams.
   - Tipo: `Multi-tenant` ou `Single-tenant` (usamos single, tenant Limppano
     `6fdfcb68-...`).

2. **Service Principal** — a materialização do app no tenant (criado junto/consent).

3. **Azure Bot resource** (recurso "Azure Bot" no portal / `az bot create`).
   - Amarra o App ID ao bot.
   - Define o **messaging endpoint** = a URL pública que recebe as Activities:
     `https://<host-publico>/ingress/teams-teste`.

4. **Canal Microsoft Teams** habilitado no Azure Bot (`az bot msteams create`).
   - Sem isso o Teams não fala com o bot.

## Identidade "manager" (provisionamento)

Pra criar esses artefatos por API (e no futuro, automaticamente pela plataforma),
usamos um **app de provisionamento** dedicado:

- App `agent-platform-manager` (App ID `47014211-...`), criado no Cloud Shell.
- Permissões Graph/ARM pra criar app registrations e recursos de bot.
- **Limitação achada:** app-only **não** tem cargo de admin do Teams → **não**
  consegue publicar app no catálogo da org (`POST /appCatalogs/teamsApps` → 403
  Forbidden). Publicar no catálogo exige um humano com cargo Teams Admin, ou
  atribuir esse cargo à identidade. Ver [02](02-manifest-teams.md).

## Valores do bot de teste (2026-07-28)

> Segredos reais NÃO ficam aqui. Guardar no AWS Secrets Manager quando virar prd.

| Campo | Valor |
|-------|-------|
| Nome do Azure Bot | `agent-teams-teste` |
| botId / App ID | `62d5251f-...` |
| Tenant | `6fdfcb68-bdb6-4b67-ae6a-2356458c73d0` |
| Messaging endpoint | `https://<tunel>.trycloudflare.com/ingress/teams-teste` |
| Canal | MsTeams habilitado |
| client secret | no cofre (não versionar) |

## Ordem prática (az cli)

```bash
# 1. app registration + secret
az ad app create --display-name agent-teams-teste
az ad app credential reset --id <appId>        # anota a senha

# 2. azure bot + endpoint
az bot create --resource-group <rg> --name agent-teams-teste \
  --app-type SingleTenant --appid <appId> --tenant-id <tenant> \
  --endpoint "https://<host>/ingress/teams-teste"

# 3. canal teams
az bot msteams create --resource-group <rg> --name agent-teams-teste
```

## Pegadinhas

- **Endpoint muda quando o túnel muda.** Túnel `cloudflared` gratuito gera URL
  nova a cada restart. Se reiniciar o túnel, tem que atualizar o endpoint do Azure
  Bot (`az bot update --endpoint ...`). Em prd isso some (URL fixa do wa-gateway).
- **Single vs multi-tenant** precisa bater no `az bot create` (`--app-type`) e no
  jeito de pegar o token AAD depois.
- Consentimento das permissões do manager teve que ser dado por admin ("já dei as
  permissões") — app-only não auto-consente.
