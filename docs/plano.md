# Plano de implementação

O plano segue a prioridade da spec: primeiro o núcleo (fases 1 a 4), depois acesso e painel. Cada item vira um ou mais commits, e uma fase só fecha com os testes dela passando. As caixas são marcadas no commit que fecha cada item.

## Fase 0: planejamento

- [x] Especificação (`docs/spec.md`)
- [x] Plano (este arquivo)
- [x] `CLAUDE.md` com as regras do projeto e registro do uso de IA (`docs/ia.md`)

## Fase 1: base

- [x] Backend Express com TypeScript e rota `GET /api/health`
- [x] Docker Compose com Postgres e backend
- [x] Schema do banco e primeira migration, com o modelo explicado em `docs/decisoes.md`
- [x] Seed: produtos e funis fictícios, call centers A, B e C (com segredos de desenvolvimento) e usuários

**Pronto quando:** `docker compose up` sobe banco e backend, `/api/health` responde e o banco tem os dados do seed.

## Fase 2: recebimento de leads

- [x] Validação do payload com Zod, com testes unitários
- [x] `POST /api/leads` grava o lead com produto, funil, afiliado e origem, com teste de integração
- [x] Lead repetido devolve o original (chave de duplicidade), com testes

**Pronto quando:** lead válido gera `201`, repetido gera `200` com o mesmo id, inválido gera `400` ou `422`.

## Fase 3: dispatcher

- [x] Função que escolhe o call center (sem banco), com testes unitários
- [x] Distribuição dentro da transação do lead, com `SELECT ... FOR UPDATE`
- [x] Teste de concorrência: 100 leads simultâneos

**Pronto quando:** 100 requisições simultâneas geram 100 leads, nenhum duplicado, divididos exatamente 50/30/20.

## Fase 4: webhook do call center

- [x] Regras de transição de status (sem banco), com testes unitários
- [ ] `POST /api/webhooks/callcenter` atualiza o lead e grava o histórico, com teste de integração
- [ ] Assinatura HMAC e script que assina e envia webhooks de teste (`scripts/`)
- [ ] Webhook repetido e evento fora de ordem, com testes (inclusive o mesmo webhook 10 vezes ao mesmo tempo)

**Pronto quando:** assinatura errada gera `401`, repetido não duplica o histórico, `contacted` antigo não desfaz uma `sale`.

## Fase 5: acesso

- [ ] Login, logout e `GET /api/auth/me` (bcrypt, JWT em cookie `httpOnly`)
- [ ] Rotas de leads (lista, detalhe e mudança de status) com escopo por perfil e call center, com testes de autorização
- [ ] Rotas do ADMIN: métricas e distribuição (ver e editar pesos)
- [ ] Limite de tentativas no login e limite por IP no recebimento de leads

**Pronto quando:** OPERATOR recebe `403` em rota de ADMIN e `404` em lead de outro call center, testado pela API e não pela tela.

## Fase 6: frontend

- [ ] React com Vite e tela de login
- [ ] Painel com os números
- [ ] Tabela de leads com filtros, paginação e detalhe do lead
- [ ] Tela de distribuição (ADMIN)
- [ ] Frontend no Docker Compose (nginx serve o front e repassa `/api` para o backend)

**Pronto quando:** ADMIN e OPERATOR fazem login pelo navegador e cada um vê só o que pode.

## Fase 7: fechamento

- [ ] README completo (as seções pedidas no enunciado, índices e escalabilidade)
- [ ] Teste do zero: clonar, `docker compose up`, rodar os testes
- [ ] Revisão do `docs/ia.md` e da seção "Como usei IA"
- [ ] Repositório público e link enviado

## Cronograma

| Dia | Fases |
|---|---|
| Qui 15/10 | 0, 1 e 2 |
| Sex 16/10 | 3 e 4 |
| Sáb 17/10 | 5 e 6 |
| Dom 18/10 | 7 |
| Seg 19/10 | folga e entrega |

## Se faltar tempo

O núcleo (fases 1 a 4) não entra no corte. Fora dele, corto nesta ordem:

1. A tela de distribuição vira só leitura (a edição de pesos continua disponível pela API).
2. O detalhe do lead na tela perde o histórico (que continua disponível pela API).
3. Os filtros da tabela ficam só em período, status e call center.

O que for cortado vai para a seção "Limitações" do README, com a explicação de como seria feito.
