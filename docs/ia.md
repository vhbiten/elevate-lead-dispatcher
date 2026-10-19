# Uso de IA

Registro de como a IA foi usada neste projeto, escrito durante o desenvolvimento, e não reconstruído no final. É a base da seção "Como usei IA" do README.

## Ferramenta

Claude Code (modelo Claude Opus 5.5), no terminal, com acesso ao repositório.

## Como trabalho com a IA

- **Especificação antes do código.** O comportamento do sistema é decidido na `docs/spec.md` e aprovado antes de qualquer implementação. A IA implementa a partir da spec, e não direto do enunciado.
- **Passos pequenos, com escopo fechado.** O `docs/plano.md` divide o trabalho em itens. A IA executa um item por vez, e cada item vira um commit revisável.
- **Regras explícitas.** O `CLAUDE.md` fixa os princípios de arquitetura, a organização do código e o processo de revisão, para que a IA não redecida essas questões a cada passo.
- **Revisão humana obrigatória.** Leio o diff e a justificativa de cada passo antes do commit. Nenhum código entra sem que eu consiga explicá-lo e alterá-lo.
- **Testes como critério de aceite.** Cada fase do plano termina com um "pronto quando" verificável por teste automatizado.

## Divisão do trabalho

| Delego à IA | Fica comigo |
|---|---|
| leitura e resumo do enunciado | prioridades e escopo |
| levantamento de alternativas e trade-offs | decisões de arquitetura e de regra de negócio |
| escrita do código e dos testes de cada passo | revisão de cada passo e aprovação do commit |
| simulações para conferir uma regra | o que entra e o que fica fora da entrega |

## Registro

Tipos de entrada: **decisão minha**, **IA errou**, **rejeitei**, **IA revisou a própria proposta**.

### 2026-10-15

**Leitura do enunciado (delegado).** A IA leu o PDF e devolveu um resumo com o núcleo do teste, os pesos de avaliação, os pontos críticos (concorrência, webhook repetido, eventos fora de ordem) e as ambiguidades do enunciado.

**Stack (decisão minha).** A IA comparou duas opções, com os trade-offs de cada uma: Next.js com front e back no mesmo projeto, ou Express e React separados. Escolhi a segunda:

- segue o desenho que o enunciado pede, com frontend, backend e banco como partes separadas;
- o fluxo da requisição fica explícito (middleware, validação, serviço, banco), sem convenções implícitas de framework;
- a API é testada com supertest sem subir servidor, o que simplifica os testes de integração e de concorrência;
- a concorrência se resolve com transação e bloqueio de linha no Postgres, sem Redis, fila ou worker: cada peça a mais seria custo de operação sem ganho neste volume.

**Ambiguidades do enunciado (decisão minha).** A IA levantou os pontos em aberto (o que é lead repetido, o que é lead pendente, afiliado desconhecido, eventos fora de ordem, quem vê os números) e propôs uma resposta para cada um. Revisei e aprovei cada decisão na spec antes de qualquer código.

**Algoritmo do dispatcher (IA revisou a própria proposta).** A primeira proposta foi um contador atômico apontando para uma sequência fixa de 10 posições (A, B, A, C, ...). Ao escrever a spec, a própria IA trocou por "o próximo lead vai para o call center mais atrasado em relação à sua parte", com `SELECT ... FOR UPDATE`. Motivos: a regra cabe numa função pequena testável sem banco, não exige montar e intercalar a sequência e se ajusta sozinha quando um call center é pausado ou muda de peso. Antes de escrever, a IA simulou 100 leads: ordem A, B, C, A, B, A, C, A, B, A e resultado exato de 50/30/20. Aprovei a troca junto com a spec; a regra vai ser coberta por teste unitário na fase 3.

### 2026-10-18

**Upsert do afiliado (IA errou; correção aprovada por mim).** No passo do `POST /api/leads`, a IA usou o `upsert` do Prisma e escreveu no comentário que ele virava `INSERT ... ON CONFLICT`. Ao preparar a idempotência, a IA conferiu o SQL no log: era um SELECT seguido de um INSERT, e 200 gravações simultâneas do mesmo afiliado novo deram 180 erros de unique.

Aprovei a correção (`INSERT ... ON CONFLICT DO NOTHING`, com um teste de 10 leads simultâneos que falha no código antigo) num commit `fix:` separado, sem reescrever o histórico. O erro virou regra no `CLAUDE.md`: garantia de concorrência só vale com teste que dispara as requisições ao mesmo tempo.

**Teste de corrida do webhook (IA revisou a própria proposta).** O primeiro teste com `sale` e `contacted` antigo chegando ao mesmo tempo repetia o cenário 5 vezes. Com o bloqueio do lead removido de propósito, ele falhou em só 2 de 3 execuções, ou seja, deixaria o defeito passar às vezes. A IA subiu para 20 repetições e mediu de novo: o defeito passou a ser pego em 5 de 5 execuções, e o código certo passou em 5 de 5.

**Dependências da fase 5 (decisão minha).** A IA listou as cinco dependências de sessão e segurança (`jsonwebtoken`, `cookie-parser`, `express-rate-limit`, `helmet`, `cors`), com o papel de cada uma, e a alternativa de escrever à mão a leitura do cookie e o CORS. Aprovei as cinco: são o padrão do Express, e o código escrito à mão seria mais uma coisa para manter.

**Escopo do frontend (decisão minha).** A IA ofereceu duas opções: o conjunto mínimo (React e Vite, navegação por abas) ou o mínimo com `react-router`. Escolhi o mínimo: são quatro telas atrás de login. O custo, telas sem URL própria, está nas limitações do README.

**Verificação dos commits.** Cada fase foi dividida em commits por item do plano. Antes do push, cada commit foi conferido isolado num `git worktree` (typecheck e testes), para o histórico não ter nenhum passo quebrado.
