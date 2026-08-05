# 07 — Checklist pra virar produção

Tudo hoje é **local**. Nada encosta no prd do wa-gateway (que recebe WhatsApp real)
nem no prd da plataforma sem OK explícito. Este é o caminho pra promover.

## Diferenças local → prd

| Item | Local (teste) | Produção |
|------|---------------|----------|
| Ingress público | cloudflared quick tunnel (URL muda) | `https://wa-gateway.odd.com.br` (fixo, ECS) |
| Segredos | cofre JSON local (`SECRETS_FILE`) | AWS Secrets Manager |
| Endpoint do Azure Bot | URL do túnel | `https://wa-gateway.odd.com.br/ingress/<tenant>` |
| Agente | shim (`teams-shim.mjs`) | container Claude da plataforma |
| Tenant no wa-gateway | `.env` local | config do serviço prd (ver abaixo) |
| CP | `cp-local` :8090 | control-plane em agents.odd.com.br |

## Passos

1. **Segredos → AWS SM.** `TEAMS_APP_PASSWORD` (client secret do bot) e o `wsToken`
   do bridge viram secrets no SM. O def guarda só as **refs**
   (`teams.appPasswordRef`, `teams.wsTokenRef`). Nunca no git.
2. **Endpoint fixo do Azure Bot.** `az bot update --endpoint
   https://wa-gateway.odd.com.br/ingress/<tenant>`. Some a dor de URL trocando.
3. **validDomains do manifest** = `wa-gateway.odd.com.br`. Regerar o zip.
4. **Registrar o tenant no wa-gateway prd.** Adicionar em `BRIDGE_TENANTS` (ou via
   o endpoint de admin, quando existir — ver [06](06-integrar-plataforma.md)).
   ⚠️ Mexer na config do wa-gateway prd = tocar no serviço que processa WhatsApp
   real. **Só com OK explícito** e janela combinada. Preferir endpoint que adiciona
   tenant sem reboot, pra não derrubar os canais de WhatsApp.
5. **Agente real na plataforma.** entrypoint com `CHANNEL=teams` conectando no
   bridge (etapa 2 do doc 06). Deploy pelo pipeline normal do agent-platform, nunca
   docker manual.
6. **Publicar o app no Teams.** Sideload não escala; publicar no catálogo da org
   (Teams Admin) e liberar por política pra quem deve. Resolver o cargo Teams Admin
   da identidade se for automatizar.
7. **Acesso conferido.** `teams.allowFrom` com os aadObjectIds certos ANTES de
   liberar o app. Fechado por padrão.

## Guardrails (não esquecer)

- ⛔ Não subir nada no wa-gateway prd por conta própria — ele recebe WhatsApp de
  verdade. Config de tenant só com OK + janela.
- ⛔ Segredos só no AWS SM em prd; cofre local é só teste.
- ⛔ Deploy do agent-platform só pelo pipeline (release/webhook), nunca `docker
  run`/`compose` manual no host.
- Túnel cloudflared é **só teste** — não vai pra prd.

## Pré-flight (antes de anunciar "tá no ar")

- [ ] endpoint do Azure Bot = domínio prd, responde 200 no `/ingress/<tenant>`
- [ ] tenant registrado no wa-gateway prd, `/bridge/status` mostra o agente online
- [ ] `teams.allowFrom` conferido
- [ ] app publicado/instalado só pra quem deve
- [ ] mensagem de teste ponta a ponta respondida pelo agente REAL (não shim)
