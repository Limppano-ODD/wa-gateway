// roles.test.ts — esta e a regra que separa "administra o WhatsApp da empresa"
// de "nao administra". Errar para o lado permissivo entrega o painel a
// qualquer pessoa do tenant; errar para o restritivo tranca todo mundo do lado
// de fora, inclusive quem precisaria consertar. Por isso a decisao e pura e
// testada sem rede, sem banco e sem env.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirAdmin, temOverageDeGrupos } from "./roles";

const GRUPO_ADMIN = "d1f20fe8-acfd-4a5d-a3d3-c5deb5d944b4";
const GLOBAL_ADMIN = "62e90394-69f5-4237-9190-012177145e10";
const PRIV_ROLE_ADMIN = "e8611ab8-c189-46e8-94e1-60213ab1f814";
const BREAKGLASS = [GLOBAL_ADMIN, PRIV_ROLE_ADMIN];

test("quem esta no grupo dedicado e admin pelo caminho normal", () => {
  const d = decidirAdmin({ groups: ["outro-grupo", GRUPO_ADMIN] }, GRUPO_ADMIN, BREAKGLASS);

  assert.equal(d.isAdmin, true);
  assert.equal(d.via, "group");
});

test("Global Admin do tenant entra por break-glass mesmo fora do grupo", () => {
  const d = decidirAdmin({ groups: [], wids: [GLOBAL_ADMIN] }, GRUPO_ADMIN, BREAKGLASS);

  assert.equal(d.isAdmin, true);
  assert.equal(d.via, "breakglass");
  assert.equal(d.wid, GLOBAL_ADMIN);
});

test("grupo tem precedencia sobre break-glass — senao a auditoria de porta dos fundos vira ruido", () => {
  // Rodrigo esta no grupo E e Global Admin. Registrar isso como break-glass
  // faria o evento perder o significado de "alguem entrou por fora".
  const d = decidirAdmin(
    { groups: [GRUPO_ADMIN], wids: [GLOBAL_ADMIN] },
    GRUPO_ADMIN,
    BREAKGLASS
  );

  assert.equal(d.via, "group");
  assert.equal(d.wid, null);
});

test("papel administrativo fora da allowlist NAO entra — Helpdesk Admin nao administra este servico", () => {
  const helpdesk = "729827e3-9c14-49f7-bb1b-9608f156bbb8";
  const d = decidirAdmin({ groups: [], wids: [helpdesk] }, GRUPO_ADMIN, BREAKGLASS);

  assert.equal(d.isAdmin, false);
  assert.equal(d.via, null);
});

test("sem grupo e sem papel: nao e admin", () => {
  const d = decidirAdmin({ groups: ["grupo-qualquer"] }, GRUPO_ADMIN, BREAKGLASS);

  assert.equal(d.isAdmin, false);
});

test("token sem claim nenhuma nao vira admin por acidente", () => {
  assert.equal(decidirAdmin({}, GRUPO_ADMIN, BREAKGLASS).isAdmin, false);
});

test("comparacao de guid ignora caixa — o Entra nao promete o mesmo casing sempre", () => {
  const d = decidirAdmin(
    { groups: [GRUPO_ADMIN.toUpperCase()] },
    GRUPO_ADMIN,
    BREAKGLASS
  );

  assert.equal(d.isAdmin, true);
  assert.equal(d.via, "group");
});

test("grupo admin vazio na config nao libera geral", () => {
  // Config faltando nao pode virar "todo mundo e admin". `groups` com string
  // vazia nao pode casar com adminGroupId vazio.
  const d = decidirAdmin({ groups: [""] }, "", BREAKGLASS);

  assert.equal(d.isAdmin, false);
});

test("claims que nao sao array sao ignoradas em vez de estourar", () => {
  const d = decidirAdmin(
    { groups: "nao-e-array", wids: 42 },
    GRUPO_ADMIN,
    BREAKGLASS
  );

  assert.equal(d.isAdmin, false);
});

test("detecta overage de grupos — admin legitimo rebaixado sem ninguem ter mudado nada", () => {
  const comOverage = {
    _claim_names: { groups: "src1" },
    _claim_sources: { src1: { endpoint: "https://graph.microsoft.com/..." } },
  };

  assert.equal(temOverageDeGrupos(comOverage), true);
  assert.equal(temOverageDeGrupos({ groups: [GRUPO_ADMIN] }), false);
  assert.equal(temOverageDeGrupos({}), false);
});
