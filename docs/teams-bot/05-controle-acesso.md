# 05 — Controle de acesso

Regra: **fechado por padrão**. Bot novo não fala com ninguém até liberar. Duas
camadas independentes:

## Camada 1 — quem o bot RESPONDE (a que importa)

Travada no **lado do agente**, pelo `aadObjectId` de cada pessoa (id estável do
usuário no Entra, vem em toda mensagem do Teams em `from.aadObjectId`).

- No shim de teste: constante `WESLAN = "5ef79d00-..."`; qualquer outro `from` é
  ignorado (loga "BLOQUEADO").
- Na plataforma: campo `teams.allowFrom` (lista de aadObjectIds) do agente. Vazio
  = ninguém. Vira env `TEAMS_ALLOW_FROM` (lista separada por vírgula) que o agente
  usa pra filtrar antes de processar.

Essa é a trava **de verdade**: mesmo que o app esteja visível/instalado pra
alguém, o bot só processa mensagem de quem está na lista.

## Camada 2 — quem VÊ/INSTALA o app (cosmético/perímetro)

Controlada no **Teams**:

- **Sideload** (upload do zip): só instala na conta de quem subiu.
- **Catálogo da org + política de permissão**: publica e libera o app só pra um
  usuário/grupo. Exige Teams Admin. Ver [02](02-manifest-teams.md).

Isso controla **visibilidade**, não resposta. Sozinha, não basta — a trava real é
a camada 1.

## Por que aadObjectId e não e-mail/nome

- `aadObjectId` é **imutável** e único por pessoa no tenant. E-mail muda, nome
  repete. (Mesma lição do CRM: resolver por id estável, nunca por e-mail.)
- Pega o teu: manda uma mensagem pro bot e olha o `from.aadObjectId` no log do
  wa-gateway/shim; ou no Entra (Usuários → o usuário → Object ID).

## Grupos (futuro)

Pra liberar por **grupo do Microsoft** (ex "Tecnologia") em vez de pessoa a
pessoa: o agente resolve o grupo via Graph `checkMemberGroups` no `aadObjectId` do
remetente e compara com uma allowlist de grupos. Mesmo padrão já usado no acordo
comercial. Ainda não implementado no fluxo Teams — anotado no roadmap.

## Resumo

| Quero… | Onde |
|--------|------|
| Bot só responde pra mim | `teams.allowFrom` = [meu aadObjectId] (camada 1) |
| App só aparece pra mim | sideload OU política Teams Admin (camada 2) |
| Liberar um grupo inteiro | Graph checkMemberGroups (futuro) |
