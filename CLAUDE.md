# CLAUDE.md

Regras para a IA que trabalha neste repositório.

## Contexto

- Projeto: Elevate Lead Dispatcher (teste técnico).
- `docs/spec.md` é a fonte da verdade do comportamento. Se o código precisar fugir dela, pare e pergunte antes.
- `docs/plano.md` define a ordem do trabalho. Faça um item por vez, sem adiantar fases.

## Princípios

- **Simplicidade é requisito.** Cada peça nova (dependência, camada, serviço) precisa justificar o custo de manter e operar. Enquanto o Postgres resolver, não entra Redis, fila nem worker.
- **Controle explícito.** O fluxo da requisição e o controle de concorrência ficam visíveis no código, e não escondidos em abstração de framework.
- **Claro antes de esperto.** Entre uma solução engenhosa e uma direta que resolvem o mesmo problema, fica a direta.
- **Nada entra sem dono.** Todo código gerado é revisado antes do commit e precisa poder ser explicado e alterado por quem mantém o projeto.

## Código

- TypeScript simples: funções, tipos explícitos nas entradas e saídas, sem classes, sem decorators, sem genéricos elaborados.
- Organização por assunto (`src/leads/`, `src/dispatcher/`, `src/webhooks/`, `src/auth/`):
  - `*.routes.ts` lê a requisição, chama o serviço e devolve a resposta. Sem regra de negócio.
  - `*.service.ts` tem a regra de negócio e acessa o banco pelo Prisma.
  - `*.schema.ts` tem a validação com Zod.
  - Regras puras (escolha do call center, transições de status) ficam em arquivos próprios, sem banco e sem Express, para serem testadas sozinhas.
- SQL escrito à mão só onde a concorrência exige (`ON CONFLICT`, `FOR UPDATE`), sempre com `$queryRaw` ou `$executeRaw` em template literal. Nunca as versões `Unsafe`, nunca concatenar texto em SQL.
- Garantia de concorrência (unique, `ON CONFLICT`, `FOR UPDATE`) só vale com teste que dispara as requisições ao mesmo tempo. Não presuma o SQL que o ORM gera: confira no log.
- Nomes no código em inglês; comentários e documentação em português.
- Comentário explica o porquê, não o quê. Código óbvio não leva comentário.
- Respostas de erro no formato da spec (`success`, `error`, `details`).
- Não adicione dependência sem dizer para que serve e esperar aprovação.

## Processo

1. Implemente um item do plano.
2. Rode os testes. Nada vai para commit com teste falhando.
3. Mostre o diff resumido e o porquê das escolhas, e espere a aprovação.
4. Só então faça o commit.

Commits:

- Tags: `feat:`, `fix:`, `refactor:`, `add:`, `update:`, `remove:`, `test:`, `docs:`.
- Uma linha em português, dizendo o que mudou. Corpo curto (o porquê) só nos commits de decisão importante.
- Nunca `--amend`, rebase ou force push. Erro em código já commitado vira um commit `fix:`.

Documentação que anda junto com o código:

- Decisão técnica importante: atualizar `docs/decisoes.md` no mesmo commit.
- Mudança de comportamento: atualizar `docs/spec.md` no mesmo commit.
- Fim de um item do plano: marcar a caixa em `docs/plano.md`.
- Quando a IA errar, ou quando uma sugestão dela for rejeitada ou corrigida: registrar em `docs/ia.md` na hora.
