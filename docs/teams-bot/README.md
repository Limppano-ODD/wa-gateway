# Teams Bot via wa-gateway

Como conectar um **bot do Microsoft Teams** a um agente da plataforma usando o
**wa-gateway** como ponte (mesmo padrão que já usamos pro WhatsApp/Meta Cloud).

Objetivo final: criar/gerenciar bots de Teams **pela interface** (agents.odd.com.br),
com controle de acesso (quem pode falar, quais grupos), do mesmo jeito que os bots
de Telegram — sem tocar em Azure na mão a cada bot novo.

## Estado atual (2026-07-28)

Fase de **prova de conceito local**: um bot de teste (`agent-teams-teste`) roda
100% na máquina do Weslan (wa-gateway local + túnel), com acesso travado só nele.
Ainda usando um **shim de teste** no lugar do agente real — o próximo passo é
plugar o agente de verdade e expor tudo na interface.

## Índice

| Doc | Assunto |
|-----|---------|
| [00-visao-geral.md](00-visao-geral.md) | Arquitetura ponta a ponta, o "cano" |
| [01-azure-setup.md](01-azure-setup.md) | O que se cria no Azure (app, bot, canal) |
| [02-manifest-teams.md](02-manifest-teams.md) | Pacote do app Teams (manifest + zip), instalar |
| [03-wa-gateway-bridge.md](03-wa-gateway-bridge.md) | Como o wa-gateway faz a ponte (ingress → bridge) |
| [04-rodar-local.md](04-rodar-local.md) | Subir tudo local (wa-gateway, túnel, shim) |
| [05-controle-acesso.md](05-controle-acesso.md) | Travar acesso a 1 pessoa / grupo |
| [06-integrar-plataforma.md](06-integrar-plataforma.md) | Trocar o shim pelo agente real na interface |
| [07-virar-prd.md](07-virar-prd.md) | Checklist pra ir pra produção |
| [08-glossario.md](08-glossario.md) | Termos (Bot Framework, serviceUrl, aadObjectId…) |

## Regra de ouro

- **Local primeiro.** Nada disso encosta no prd do wa-gateway (que recebe os
  WhatsApp de verdade) nem na plataforma de prd sem OK explícito.
- **Acesso fechado por padrão.** Bot novo nasce restrito; libera-se depois.
- Segredos (bot password, tokens) vão pro **AWS Secrets Manager** quando virar
  prd — nunca no git.
