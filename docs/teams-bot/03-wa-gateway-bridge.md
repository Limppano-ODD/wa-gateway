# 03 — Como o wa-gateway faz a ponte

Branch: `feat/meta-cloud-relay`. O wa-gateway é um **relay genérico**: recebe
webhook de um canal, valida/traduz, e entrega pro agente por uma ponte WebSocket.

## Rotas (src/bridge/controller.ts)

```
GET  /ingress/:tenant        → handshake (canal decide se usa; Teams NÃO usa)
POST /ingress/:tenant        → mensagem do canal → adapter valida+parseia → empurra pro WS
POST /ingress/:tenant/send   → envio por HTTP (auth pelo wsToken) — alternativa ao WS
GET  /bridge/agent?token=... → o agente conecta aqui (WebSocket) e "puxa" as mensagens
GET  /bridge/status          → tenants conectados (debug)
```

Roteia por `:tenant`. **Adicionar um bot/canal = só adicionar config** — o código
não muda.

## Config: BRIDGE_TENANTS

Um JSON (lido no boot) que mapeia tenant → canal + credenciais + wsToken:

```jsonc
BRIDGE_TENANTS='[
  {
    "name": "teams-teste",
    "channel": "teams",
    "wsToken": "<tok-gerado>",            // segredo do agente pra conectar no bridge
    "config": {
      "appId":       "62d5251f-...",       // App ID do bot (doc 01)
      "appPassword": "<secret>",            // client secret do bot
      "tenantId":    "6fdfcb68-..."         // tenant AAD (single-tenant)
    }
  }
]'
```

- `wsToken` = como o agente **prova** que pode escutar aquele tenant (fica na URL
  `/bridge/agent?token=<wsToken>`).
- `config` = o que o adaptador precisa. Cada canal tem o seu shape.
- **Boot-only:** mudou o JSON → reinicia o wa-gateway.

## Adaptador Teams (src/bridge/channels/teams.ts)

Implementa `ChannelAdapter` (`receive` / `send`). Diferenças do WhatsApp:

- **receive:** o Teams manda "Activities" e **assina cada POST com um JWT** do Bot
  Connector (emissor `https://api.botframework.com`). O adaptador:
  1. Valida o JWT contra o JWKS `https://login.botframework.com/v1/keys`.
  2. Confere `aud == appId` (senão é pra outro bot).
  3. Parseia a Activity → extrai `text`, `serviceUrl`, `conversation.id`, `from`
     (com `aadObjectId`, `name`).
- **send:** pega um token AAD via `client_credentials` (appId + appPassword) e faz
  `POST {serviceUrl}/v3/conversations/{id}/activities` com a resposta.
- `verify: undefined` — Teams não faz handshake GET (o portal valida uma vez no POST).

## Protocolo do WebSocket (bridge ↔ agente)

O agente conecta em `/bridge/agent?token=<wsToken>` e troca JSON:

| Direção | msg | conteúdo |
|---------|-----|----------|
| bridge → agente | `welcome` | `{ tenant }` — confirma conexão |
| bridge → agente | `message` | `{ text, serviceUrl, conversation, from:{aadObjectId,name} }` |
| agente → bridge | `send` | `{ serviceUrl, conversationId, text }` — resposta |
| bridge → agente | `send_result` | `{ ok, error? }` |

Isso é tudo que o agente precisa saber. O agente **não** fala com o Azure direto —
só com o bridge. Quem posta no Teams é o wa-gateway (adapter.send).

## Por que isolar por tenant

Um wa-gateway atende N bots. Cada `wsToken` só enxerga o seu tenant. Um bot
comprometido não lê mensagem de outro. WhatsApp real e Teams de teste convivem no
mesmo processo sem se misturar.
