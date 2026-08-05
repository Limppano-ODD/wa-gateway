# 06 — Integrar na plataforma (trocar o shim pelo agente real)

Objetivo: criar/gerenciar bot de Teams **pela interface** (agents.odd.com.br),
como já se faz com Telegram — e o agente real (Claude) responder, não o shim.

## O que JÁ foi feito (camada de config na UI) — 2026-07-28

Control-plane (repo `agent-platform`), rodando em **modo teste local**:

- **Modelo** (`core/types.go`): `AgentDef.Channel` ("telegram"|"teams", default
  telegram) + struct `TeamsConfig` (`AppID`, `TenantID`, `WaGatewayURL`,
  `WaTenant`, `AppPasswordRef`, `WsTokenRef`, `AllowFrom`). Validação exige os
  campos quando `channel=teams`.
- **specbuild**: quando `channel=teams`, injeta no container as envs
  `CHANNEL=teams`, `TEAMS_APP_ID`, `TEAMS_TENANT_ID`, `WA_GATEWAY_URL`,
  `WA_TENANT`, `TEAMS_ALLOW_FROM`, e resolve os 2 segredos
  (`TEAMS_APP_PASSWORD`, `WA_WS_TOKEN`) do Secrets Manager. Tudo entra no
  `hashDef` → trocar config recria o container (igual Telegram).
- **API** (`teams_azure.go`): `GET /api/teams/bots` lista os bots reais do Azure
  (ARM `botServices`) usando a identidade **manager** (client_credentials, escopo
  ARM). Só leitura.
- **UI** (`ui/index.html`): seletor "Canal" (Telegram/Teams). Em Teams, um
  dropdown puxa os bots do Azure e preenche botId/tenant; mais os campos do
  wa-gateway e o Acesso (aadObjectIds). Segredos vão como **ref** do cofre.

Config: `AZURE_MANAGER_APP_ID/SECRET/TENANT/SUBSCRIPTION` (env do CP). Vazio →
`/api/teams/bots` responde 503 e a UI cai pro preenchimento manual.

## O que FALTA (o runtime do agente falar com a ponte)

Hoje quem responde é o `teams-shim.mjs`. Falta o **agente de verdade** (container
Claude Code da plataforma) conectar no bridge. Passos:

1. **entrypoint.sh do agente**: se `CHANNEL=teams`, em vez de subir o canal
   Telegram, subir um cliente que:
   - conecta em `${WA_GATEWAY_URL}/bridge/agent?token=${WA_WS_TOKEN}`;
   - ao receber `message`, filtra por `TEAMS_ALLOW_FROM`;
   - passa o texto pro Claude Code (mesmo ponto de entrada que o canal Telegram
     usa hoje) e devolve a resposta pelo `send` do WS.
   Ou seja: portar a lógica do shim pra dentro do canal do agente — reaproveitando
   o processamento que o plugin de Telegram já faz.
2. **Provisionar o tenant no wa-gateway**: a plataforma precisa registrar o tenant
   (`BRIDGE_TENANTS`) no wa-gateway com appId/appPassword/wsToken. Hoje é config
   boot-only (JSON) → ou vira endpoint de admin no wa-gateway, ou um passo do
   provisionamento.
3. **Criar o bot no Azure automaticamente** (opcional, pra bot novo pela UI):
   `az bot create` + canal Teams + endpoint apontando pro wa-gateway — via a
   identidade manager (ARM). Publicar o app no Teams ainda esbarra no cargo Teams
   Admin (ver [02](02-manifest-teams.md), 403).

## Ordem recomendada

1. ✅ Config na UI (feito, local).
2. Portar o shim pro entrypoint (agente real responde). ← **próximo**
3. Endpoint de registro de tenant no wa-gateway (sem reboot).
4. Provisionamento Azure automático (bot novo pela UI).
5. Publicação do app no Teams (resolver cargo admin).

## Princípio

O agente **nunca** abre porta nem fala com o Azure direto. Ele só disca pro bridge
(igual Telegram long-poll disca pro Telegram). Todo o peso público/auth fica no
wa-gateway. Isso mantém o modelo de segurança da plataforma intacto.
