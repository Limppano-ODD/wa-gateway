# 00 — Visão geral (o "cano")

## Diferença que confunde: Azure ≠ instalar no Teams

Duas coisas separadas, ambas necessárias:

1. **Registro no Azure** = o "cérebro/motor" do bot. É a identidade, a credencial
   e o **endereço** (endpoint) pra onde o Teams manda as mensagens. Criado uma vez.
2. **Pacote do app no Teams** (manifest zip) = o "atalho de instalação". Faz o bot
   **aparecer** no cliente Teams de alguém pra poder conversar. Sem instalar, o bot
   existe no Azure mas ninguém tem onde clicar pra falar com ele.

Analogia: Azure é o motor do carro (pronto). O zip é a chave que dá acesso. É o
**mesmo carro** — o zip só aponta pro bot que já existe no Azure.

## O fluxo ponta a ponta

```
Usuário no Teams
      │  (manda "oi")
      ▼
Microsoft Bot Framework (nuvem MS)
      │  POST pro endpoint do bot (Activity JSON, assinado com JWT)
      ▼
Endpoint público  ──►  https://<tunel>/ingress/teams-teste
      │                (em local: cloudflared; em prd: wa-gateway.odd.com.br)
      ▼
wa-gateway
      │  1. adaptador teams.ts valida o JWT e traduz a Activity
      │  2. hub roteia pro tenant "teams-teste"
      ▼
Bridge WebSocket  ──►  /bridge/agent?token=<wsToken>
      │                (o agente/shim está conectado aqui, "puxando" mensagens)
      ▼
Agente (hoje: shim de teste; amanhã: Claude da plataforma)
      │  decide a resposta
      ▼
volta pelo mesmo WS  ──►  wa-gateway  ──►  serviceUrl do Teams
      │                (token AAD client_credentials pra postar de volta)
      ▼
Usuário vê a resposta no Teams
```

## Por que wa-gateway e não Teams "direto"?

- O Teams (Bot Framework) exige **rota pública** pra empurrar mensagens (webhook).
  A plataforma de agentes roda os bots em containers **sem porta inbound** (Telegram
  funciona por long-poll, que não precisa de rota pública).
- O wa-gateway **já resolve isso** pro WhatsApp: recebe o webhook público, valida,
  e entrega pro agente por uma **ponte WebSocket** (o agente disca pra fora). Mesmo
  padrão serve pro Teams — só trocamos o adaptador de entrada.
- Ganho: um único ponto público (wa-gateway) atende N bots (WhatsApp, Teams…), cada
  um isolado por "tenant". O agente continua sem abrir porta.

## Peças

| Peça | Papel | Onde roda |
|------|-------|-----------|
| App registration (Entra) | identidade + credencial do bot | Azure |
| Azure Bot + canal MsTeams | registra o endpoint, liga o canal Teams | Azure |
| Manifest zip | app do Teams (torna o bot instalável/visível) | subido no Teams |
| wa-gateway | recebe webhook, valida, faz a ponte | local agora / ECS prd |
| Túnel (cloudflared) | expõe o wa-gateway local numa URL pública | local (só teste) |
| Agente/shim | decide a resposta | WS client → bridge |

Detalhe de cada uma nos docs seguintes.
