# 09 — Go-Live: bots Teams na plataforma (ecommerce primeiro)

Mapa do que falta pra sair do teste local e colocar em produção um bot Teams —
começando pelo **ecommerce**, que é **grupo** (várias pessoas, mesmo chat).

## 1. O que já temos (local/teste) ✅

- Interface (control-plane): seletor de canal Telegram/Teams + dropdown que lista
  os bots reais do Azure (identidade manager).
- Sidecar do agente (`teams-agent.mjs`, na imagem): conecta na ponte, roda o Claude
  real por mensagem, sabe com quem fala (nome + aadObjectId), acesso travado
  (`allowFrom`), envia arquivo (via link `/files`).
- wa-gateway (branch `feat/meta-cloud-relay`): ponte + adaptador Teams (valida JWT,
  responde no serviceUrl) + servir arquivo.
- Bot de teste `agent-teams-teste` funcionando 1:1 só com o Weslan.

Tudo isso é **comportamento padrão da imagem/sidecar** → todo bot Teams novo herda.
Só os identificadores (appId, tenant, wsToken, acesso) variam por bot, na interface.

## 2. Gaps pra produção (checklist)

### Infra / deploy
- [ ] **wa-gateway prod**: registrar o tenant do bot **sem reboot**. Hoje
  `BRIDGE_TENANTS` é config boot-only; em prd o serviço processa WhatsApp real —
  não pode reiniciar à toa. → criar endpoint admin de "registrar tenant".
- [ ] **URL pública fixa**: trocar o túnel cloudflared (teste) por
  `https://wa-gateway.odd.com.br`. Atualizar o **endpoint do Azure Bot** e o
  `validDomains` do manifest.
- [ ] **Secrets → AWS Secrets Manager**: `appPassword` do bot + `wsToken` da ponte.
  O def guarda só as refs. Nada no git/cofre local.
- [ ] **Imagem do agente com sidecar Teams em prd**: deploy pela pipeline do
  agent-platform (o sidecar já está na imagem; falta buildar/deployar em prd).
- [ ] **Onde roda o agente ecommerce**: server .89 (agents-host) ou outro. Definir.
- [ ] **Creds Azure manager no CP de prd** (pra o dropdown de bots): via env seguro
  (não commitar).
- [ ] **FILES_BASE_URL** = `https://wa-gateway.odd.com.br` em prd.

### Segurança
- [ ] **Link de arquivo com token** (hoje o `/files/:id` é aberto por 1h). Em prd:
  assinar o link (token curto) pra não vazar arquivo por URL adivinhável.
- [ ] **Acesso fechado por padrão**: `allowFrom` (pessoas) ou grupo AAD conferido
  ANTES de publicar.
- [ ] Revisar o que o agente pode fazer (tools/repos) — ecommerce mexe em quê?

### Bot ecommerce (Azure + Teams)
- [ ] Criar **Azure Bot** `agent-ecommerce` + canal Teams + endpoint prd.
- [ ] **Manifest** do app ecommerce com os **scopes certos** (grupo → `team` e/ou
  `groupChat`, não só `personal`).
- [ ] **Publicar** no Teams: catálogo da org (Teams Admin) restrito ao grupo do
  ecommerce, OU sideload. (Ver [02](02-manifest-teams.md).)

## 3. Migração local → prd (ordem)

1. Secrets pro AWS SM (appPassword, wsToken) → refs no def.
2. wa-gateway prd: endpoint de registrar tenant + registrar o tenant do ecommerce.
3. Azure Bot ecommerce com endpoint `wa-gateway.odd.com.br/ingress/<tenant>`.
4. Deploy da imagem do agente (com sidecar) pela pipeline.
5. Criar o agente `ecommerce` na interface (channel=teams, os campos + acesso).
6. Manifest + publicar o app restrito ao grupo.
7. Teste E2E com uma pessoa do grupo → depois liberar o grupo.

## 4. "Pegar todo o contexto que temos"

O bot de teste é **genérico** — não tem contexto de negócio. "Contexto" de um bot
vem de 3 lugares (tudo configurável pela interface / def, sem código):

- **Persona** (`CLAUDE.md` do agente): quem ele é, o que faz, tom, regras. É aqui
  que entra o conhecimento do ecommerce.
- **Repos** clonados no boot: o código/projeto que o agente enxerga (ex: repo do
  ecommerce).
- **Integrações MCP** (ex: `mcp-tools`/memória, um Postgres, uma API): dão dados e
  memória. Token próprio de `mcp-tools` = memória escopada do bot.

Pro ecommerce: definir a **persona**, os **repos** e as **integrações** que ele
precisa. Isso NÃO se migra do bot de teste (que é vazio) — se **monta** pro
ecommerce. O que se reaproveita é a **plataforma** (imagem, sidecar, ponte).

## 5. Grupo: várias pessoas no mesmo chat

O ecommerce é um **grupo**. Hoje o sidecar assume **1:1**. O que muda:

| Tema | 1:1 (hoje) | Grupo (ecommerce) |
|------|------------|-------------------|
| Quando responde | toda mensagem | **só quando @mencionado** (senão responde tudo e vira spam) |
| Identidade | injeta o nome 1x na 1ª msg | **por mensagem** — em grupo cada msg é de uma pessoa diferente |
| Sessão/contexto | 1 sessão por conversa | 1 sessão **compartilhada** do grupo (todos veem o mesmo fio) — a decidir |
| Acesso | `allowFrom` (pessoa) | por **grupo AAD** (checkMemberGroups) ou liberar a conversa |
| Manifest | scope `personal` | scope `team`/`groupChat` |

Mudanças no sidecar/adaptador pra grupo:
- **Detecção de @menção**: o Teams manda as menções em `activity.entities`; o bot
  tira o próprio @nome do texto e só age se foi mencionado.
- **Identidade por mensagem**: passar `from.name` de CADA mensagem pro Claude (não
  só na 1ª), pra ele saber quem falou o quê no grupo.
- **Acesso por grupo**: liberar quem é do grupo AAD do ecommerce (Graph
  `checkMemberGroups`) em vez de listar pessoa a pessoa.

## 6. Tópicos pra decidir (traz pra conversa)

1. **Grupo — sessão compartilhada ou por pessoa?** Um fio só que todos veem
   (assistente do grupo) vs cada um com seu contexto. (Recomendo compartilhada.)
2. **Acesso do ecommerce**: qual grupo AAD / quais pessoas? Fechado por padrão.
3. **Publicação**: catálogo da org restrito (precisa Teams Admin) vs sideload por
   pessoa.
4. **Arquivo**: link com token (rápido) — ok pra prd? Ou investir no anexo nativo
   (mais frágil por client)?
5. **Onde roda o agente ecommerce** (server .89 ou outro) + recursos.
6. **Persona/escopo do bot ecommerce**: o que ele faz, quais repos e integrações
   (tools/dados/memória) ele precisa? É o que dá "contexto" a ele.
7. **wa-gateway prd**: topa a gente adicionar o endpoint de registrar tenant (pra
   não reiniciar o serviço que roda o WhatsApp real)?

## 7. Guardrails (não esquecer)

- ⛔ Nada sobe no wa-gateway prd sem OK + janela (ele recebe WhatsApp real).
- ⛔ Secrets só no AWS SM em prd.
- ⛔ Deploy só pela pipeline do agent-platform.
- Acesso fechado por padrão; conferir antes de publicar.
