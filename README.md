# Elevate Lead Dispatcher

Recebe leads das páginas de vendas, distribui cada um entre os call centers na proporção configurada (50/30/20), acompanha o status pelo webhook do call center e mostra tudo num painel com dois perfis (ADMIN e OPERATOR).

O núcleo (recebimento, banco, dispatcher com concorrência e webhook) está coberto por testes contra um Postgres de verdade, inclusive com requisições simultâneas.

**Demonstração em vídeo (2min30s):** [`demonstracao-painel.mp4`](https://github.com/vhbiten/elevate-lead-dispatcher/releases/download/v1.0/demonstracao-painel.mp4), anexo da release [v1.0](https://github.com/vhbiten/elevate-lead-dispatcher/releases/tag/v1.0). Mostra o painel com os dois perfis, leads e webhooks chegando ao vivo pela API (inclusive fora de ordem e repetidos), a mudança de status e a distribuição por peso.

| Documento | Conteúdo |
|---|---|
| [`docs/spec.md`](docs/spec.md) | o comportamento do sistema: regras, respostas da API e decisões das ambiguidades do enunciado |
| [`docs/decisoes.md`](docs/decisoes.md) | cada decisão técnica, com o porquê e o custo |
| [`docs/plano.md`](docs/plano.md) | o plano por fases, seguido item a item |
| [`docs/ia.md`](docs/ia.md) | o registro do uso de IA, escrito durante o desenvolvimento |
| [`CLAUDE.md`](CLAUDE.md) | as regras que a IA seguiu neste repositório |

## Sumário

1. [Instalação e execução](#1-instalação-e-execução)
2. [Arquitetura](#2-arquitetura)
3. [Decisões técnicas](#3-decisões-técnicas)
4. [Segurança](#4-segurança)
5. [Escalabilidade](#5-escalabilidade)
6. [Limitações](#6-limitações)
7. [Melhorias futuras](#7-melhorias-futuras)
8. [Como usei IA](#8-como-usei-ia)

## 1. Instalação e execução

Pré-requisito: Docker com Docker Compose.

```bash
docker compose up --build
```

Na subida, o backend aplica as migrations e o seed (produtos, funis, call centers e usuários fictícios). Depois disso:

| O quê | Onde |
|---|---|
| Painel | http://localhost:8080 |
| API | http://localhost:3000 (e também em http://localhost:8080/api, pelo nginx) |

Usuários de teste, todos com a senha `elevate123`:

| E-mail | Perfil |
|---|---|
| `admin@elevate.test` | ADMIN |
| `operador.a@elevate.test` | OPERATOR do Call Center A |
| `operador.b@elevate.test` | OPERATOR do Call Center B |
| `operador.c@elevate.test` | OPERATOR do Call Center C |

### Dados de demonstração

O banco começa sem leads. Este comando envia 40 leads pela API (eles passam pelo dispatcher) e 70 atualizações de status por webhooks assinados:

```bash
docker compose exec backend npm run demo
```

### Enviar um lead e um webhook à mão

```bash
curl -X POST http://localhost:3000/api/leads \
  -H 'Content-Type: application/json' \
  -d '{"name":"João Silva","email":"joao@email.com","phone":"+5511999999999","product":"nutralean","funnel":"vsl-01","source":"facebook","campaign":"campaign-123","affiliate_id":"999","utm":{"source":"facebook","medium":"cpc","campaign":"campaign-123","content":"ad-01"}}'
```

O webhook precisa de assinatura HMAC. O script lê o call center e o segredo do banco, assina e envia:

```bash
docker compose exec backend npm run webhook -- <lead_id> contacted
docker compose exec backend npm run webhook -- <lead_id> sale --external-id CC-123
docker compose exec backend npm run webhook -- <lead_id> contacted --at 2026-10-18T10:00:00Z   # evento antigo: "stale"
docker compose exec backend npm run webhook -- <lead_id> refund --times 10                     # 10 iguais ao mesmo tempo
```

### Testes

São 122: 53 unitários (regras puras, sem banco) e 69 de integração (a API de verdade, contra o banco `elevate_test` do mesmo Postgres).

```bash
docker compose exec backend npm test
```

Fora do Docker (Node 24), com o banco do compose no ar:

```bash
cd backend
npm ci
npm run test:unit    # só os unitários, não precisa de banco
npm test             # unitários e integração
```

### Desenvolvimento sem Docker

```bash
docker compose up -d db
cd backend && cp .env.example .env && npm ci && npx prisma migrate deploy && npx prisma db seed && npm run dev
cd frontend && npm ci && npm run dev    # http://localhost:5173, com proxy de /api para a porta 3000
```

## 2. Arquitetura

```
Página de vendas ── POST /api/leads ─────────────────────┐
                                                         ▼
Call center ─────── POST /api/webhooks/callcenter ──▶  Backend  ──▶  PostgreSQL
                    (assinado com HMAC)                (Express)
                                                         ▲
Navegador ──▶ nginx :8080 ── serve o React ──  /api ─────┘
```

Três serviços no `docker compose`: `db` (Postgres 18), `backend` (Node 24, Express 5, TypeScript, Prisma 7) e `frontend` (build do React servido pelo nginx, que repassa `/api` para o backend). Não há Redis, fila nem worker: a concorrência se resolve com transação e bloqueio de linha no Postgres, e cada peça a mais seria algo para operar sem ganho neste volume.

```
backend/src/
  leads/        recebimento, chave de duplicidade, painel de leads, regras de status
  dispatcher/   regra de escolha (função pura), distribuição e configuração
  webhooks/     assinatura HMAC e recebimento de status
  auth/         login, sessão e permissões
  metrics/      números do painel
backend/prisma/ schema, migrations e seed
backend/scripts/ envio de webhook assinado e dados de demonstração
frontend/src/   painel React
```

Em cada assunto, `*.routes.ts` lê a requisição e responde, `*.service.ts` tem a regra e o acesso ao banco, e `*.schema.ts` tem a validação com Zod. As regras que decidem algo (escolha do call center, transições de status, chave de duplicidade, assinatura) são funções puras, testadas sem banco.

### O caminho de um lead

**1. Recebimento: `POST /api/leads`**

1. O Zod valida e normaliza o corpo (e-mail em minúsculas, telefone em E.164, campo vazio conta como não enviado). Inválido: `400` com os campos.
2. O produto e o funil daquele produto precisam existir e estar ativos. Senão: `422`.
3. Numa transação:
   - o afiliado é criado se ainda não existe (`INSERT ... ON CONFLICT DO NOTHING`);
   - `SELECT ... FOR UPDATE` nos call centers ativos, em ordem de id;
   - a função pura `pickCallCenter` escolhe o call center mais atrasado em relação à sua parte;
   - o contador dele soma 1, e o lead é gravado com o call center, o primeiro evento do histórico (`new`) e a distribuição.
4. Resposta `201` com o `lead_id`. Se a chave de duplicidade já existe, o banco recusa, a transação inteira é desfeita (o contador volta) e a resposta é `200` com o `lead_id` original e `duplicate: true`.

**2. Atendimento: o painel**

O OPERATOR vê e atualiza só os leads do seu call center; o ADMIN vê tudo, os números e a distribuição. A mudança de status pelo painel passa pelas mesmas regras do webhook.

**3. Atualização: `POST /api/webhooks/callcenter`**

1. Confere o call center, o horário de envio (até 5 minutos) e a assinatura HMAC do corpo bruto. Falhou: `401`.
2. Valida o corpo. Inválido: `400`.
3. Numa transação, `SELECT ... FOR UPDATE` no lead. Lead inexistente ou de outro call center: `404`.
4. A função pura `decideStatusChange` decide se o evento muda o status: ele precisa ser mais recente que o último aplicado e a transição precisa ser permitida.
5. O evento é gravado no histórico, aplicado ou não (`INSERT ... ON CONFLICT DO NOTHING`). Se ele já existia, a resposta é `200` com `duplicate: true` e nada muda.
6. Se aplicado, o status do lead muda. Resposta `200` com `applied`, o motivo quando não aplica (`stale` ou `invalid_transition`) e o status atual.

## 3. Decisões técnicas

Aqui estão as respostas às perguntas do enunciado. Todas as decisões, com o custo de cada uma, estão em [`docs/decisoes.md`](docs/decisoes.md).

### Stack

Express e TypeScript no backend, Prisma com PostgreSQL, React com Vite no frontend, Vitest e supertest nos testes. O fluxo de cada requisição fica escrito no arquivo (middleware, validação, serviço, banco), sem convenção implícita de framework, e a API é testada sem subir servidor. Next.js foi considerado e descartado: o enunciado pede front, back e banco separados, e um backend Express explícito fica mais fácil de testar e de explicar. O TypeScript roda direto com `tsx`, sem etapa de build.

### Banco de dados

| Tabela | Papel |
|---|---|
| `products`, `funnels` | produtos e seus funis (o mesmo slug de funil pode existir em produtos diferentes) |
| `affiliates` | afiliados, criados na hora quando chegam num lead |
| `call_centers` | peso, ativo ou pausado, contador do dispatcher e segredo do webhook |
| `leads` | o lead, com rastreamento (UTM em colunas), status atual e call center atual |
| `distributions` | cada distribuição de um lead, com o id externo do call center |
| `lead_status_events` | histórico de status, aplicado ou não, com a origem (sistema, webhook ou painel) |
| `users` | login, perfil e call center |

O lead usa UUID v7 gerado pelo Postgres: não revela volume nem permite adivinhar ids, e por começar pelo horário mantém as inserções no fim do índice. Restrições `CHECK` garantem pesos e contadores não negativos e que todo OPERATOR tem call center. As exclusões que apagariam histórico são bloqueadas (`ON DELETE RESTRICT`). As migrations ficam em `backend/prisma/migrations`.

### Duplicidade e idempotência

Cada lead tem uma `dedup_key` com restrição unique:

- com o cabeçalho `Idempotency-Key`, a chave é o hash dele;
- sem o cabeçalho, é o hash de e-mail + produto + funil + dia (UTC).

A gravação tenta inserir. Se a chave já existe, o Postgres recusa (e, se a outra requisição ainda está em andamento, espera por ela antes de recusar), a transação é desfeita e a API devolve o lead original com `200`. Como quem decide é o banco, não há janela entre "consultar" e "gravar". O teste manda 10 requisições iguais ao mesmo tempo e confere um lead só. Limites aceitos e explicados na spec: a mesma pessoa em outro dia vira lead novo.

### Índices

Cada índice deixa a inserção de leads mais lenta, e a inserção é o caminho crítico. Só entraram índices ligados a uma consulta real:

| Índice | Consulta que atende |
|---|---|
| `leads(dedup_key)` único | detectar lead repetido |
| `leads(created_at)` | lista padrão ordenada por data, filtro por período, "leads hoje" |
| `leads(call_center_id, created_at)` | lista do OPERATOR e filtro por call center, já na ordem de data |
| `leads(status, created_at)` | filtro por status e contagem de pendentes e vendas |
| `leads(product_id, created_at)` | filtro por produto |
| `lead_status_events(lead_id, status, occurred_at)` único | descartar webhook repetido e listar o histórico de um lead |
| `distributions(lead_id)` | distribuições de um lead, no detalhe |

Sem índice, de propósito: `leads.source` (poucos valores, sempre junto com o período), `leads.email` (a duplicidade usa a `dedup_key`) e `leads.affiliate_id` (nenhuma tela consulta por afiliado).

### Dispatcher

Weighted round robin pela regra do **mais atrasado**: cada call center tem um peso e um contador, e o lead vai para o de menor `recebidos / peso` (empate: maior peso, depois menor id). Com 50/30/20, os 10 primeiros saem A, B, C, A, B, A, C, A, B, A, e a cada 10 leads a divisão é exata, intercalada, sem rajadas. A regra é uma função pura de poucas linhas, testada sem banco, e se ajusta sozinha quando um call center é pausado ou muda de peso. Salvar uma configuração zera os contadores, para a nova proporção valer dali em diante. O envio para o sistema do call center não é simulado: registrar a distribuição basta, como o enunciado permite.

### Concorrência

A corrida possível é duas requisições lerem os mesmos contadores e escolherem com base no mesmo estado. A escolha acontece dentro da transação do lead, depois de um `SELECT ... FOR UPDATE` nos call centers ativos: a segunda requisição espera a primeira terminar e lê os contadores já atualizados. A ordem fixa por id impede deadlock, e a mudança de configuração usa o mesmo bloqueio. O teste dispara 100 `POST /api/leads` ao mesmo tempo e confere 100 leads, nenhum duplicado e exatamente 50/30/20. Sem o `FOR UPDATE`, o mesmo teste falha (numa rodada deu 48/32/20).

### Webhook duplicado

O evento é identificado por lead + status + horário do evento, com restrição unique no histórico, e gravado com `INSERT ... ON CONFLICT DO NOTHING`. O mesmo webhook recebido de novo, inclusive ao mesmo tempo, não grava nada e responde `200` com `duplicate: true`. O teste manda o mesmo webhook 10 vezes ao mesmo tempo: um evento, um aplicado e nove repetidos.

### Eventos fora de ordem

Todo evento entra no histórico com o horário informado pelo call center. O status só muda se o evento for **mais recente** que o último aplicado e se a **transição for permitida** (`new` vai para os status de trabalho, `sale` ou `invalid`; os de trabalho vão e voltam entre si; `sale` só vai para `refund`; `refund` e `invalid` são finais). Um `contacted` das 11h50 que chega depois de uma `sale` das 12h00 é registrado com `applied = false` e motivo `stale`, e o lead continua `sale`. Barrado também responde `200`, porque foi recebido: com erro, o call center reenviaria para sempre. Webhooks do mesmo lead que chegam juntos são processados um de cada vez (`FOR UPDATE` na linha do lead).

### Segurança do webhook

HMAC-SHA256 com segredo por call center: os cabeçalhos `X-Call-Center`, `X-Timestamp` e `X-Signature` (assinatura de `"<timestamp>.<corpo bruto>"`). A assinatura prova quem enviou e que o corpo não mudou no caminho, e o segredo nunca trafega. O horário de envio precisa estar a até 5 minutos do relógio do servidor, o que impede reenviar uma requisição copiada. A comparação é em tempo constante. É o padrão de Stripe, GitHub e Shopify.

## 4. Segurança

| Risco | O que foi feito |
|---|---|
| Autenticação | senha com bcrypt; sessão em JWT HS256 de 8 horas, com o algoritmo fixo na verificação; o login roda o bcrypt mesmo para e-mail inexistente, para o tempo de resposta não revelar quem tem conta |
| Autorização | perfil e call center conferidos no backend em toda rota: OPERATOR recebe `403` nas rotas do ADMIN e `404` num lead de outro call center (o filtro fica no serviço, e não na tela); testado direto pela API |
| SQL injection | Prisma e consultas parametrizadas; o SQL escrito à mão usa `$queryRaw` em template, nunca concatenação |
| XSS | o React escapa o que exibe; a API só devolve JSON; cookie `httpOnly` (o JavaScript da página não lê a sessão); cabeçalhos do `helmet` |
| CSRF | cookie `SameSite=Strict`, painel e API na mesma origem (nginx), API só aceita JSON; o CORS aberto existe só no `POST /api/leads`, que não usa cookie |
| Força bruta | 5 tentativas de login erradas a cada 15 minutos por IP e e-mail |
| Rate limiting | 120 leads por minuto por IP no recebimento (folgado por causa do CGNAT das operadoras móveis), configurável |
| Webhook falso | HMAC por call center, janela de 5 minutos, comparação em tempo constante |
| Exposição de dados | a API nunca devolve hash de senha, segredo de webhook nem a chave de duplicidade; a lista de leads não traz e-mail nem telefone; erros sem stack trace; a mesma resposta para senha errada e e-mail inexistente |
| Validação de entrada | Zod em todo corpo e query string; limite de tamanho no corpo do webhook; ids que não são UUID respondem `404` |
| Segredos | `.env` fora do Git; o repositório só tem valores de desenvolvimento (`.env.example`, `docker-compose.yml` e seed) |

## 5. Escalabilidade

O cenário do enunciado: 100 mil leads no início, podendo chegar a 1 milhão e a mais de 10 milhões.

**100 mil.** O modelo atual atende sem mudança. Os filtros do painel usam os índices compostos que começam pela coluna filtrada e terminam em `created_at`, então a página vem na ordem certa sem ordenar a tabela. As cinco contagens das métricas levam milissegundos.

**1 milhão.** A gravação continua igual (o UUID v7 mantém as inserções no fim do índice). O que pesa primeiro é o painel:

- a paginação por `OFFSET` fica lenta nas páginas distantes, porque o banco percorre tudo o que pula. Trocaria por paginação por cursor (`WHERE (created_at, id) < (...)`), que usa o mesmo índice;
- o `COUNT` exato do total filtrado e das métricas passa a ser a consulta mais cara de cada abertura. As métricas iriam para uma tabela de totais por dia (produto, call center e status), atualizada na mesma transação da gravação e da mudança de status, ou recalculada a cada minuto.

**10 milhões ou mais.**

- **Particionamento de `leads` por mês de `created_at`.** Quase toda consulta do painel é por período, e partições antigas podem ir para armazenamento mais barato. Um detalhe importa aqui: no Postgres, uma restrição unique numa tabela particionada precisa incluir a chave de partição, e a `dedup_key` sozinha deixaria de ser única no banco. Ela iria para uma tabela própria e pequena (`dedup_key` → `lead_id`), que pode ser limpa depois de alguns dias, já que a chave automática vale por dia. O `lead_status_events`, que só cresce, seria particionado do mesmo jeito.
- **Leituras separadas da escrita:** o painel e as métricas numa réplica de leitura, para não disputar com o recebimento.
- **Várias instâncias da API:** a sessão em JWT já não depende de memória; o limite de requisições iria para um armazenamento compartilhado (Redis), as migrations virariam uma etapa do deploy e as conexões passariam por um PgBouncer.
- **Vazão do dispatcher:** o bloqueio deixa as distribuições em fila, cerca de 6 ms por lead no ambiente de teste, ou seja, da ordem de 150 leads por segundo. É folga grande para o volume de páginas de vendas. Se um pico medido chegar perto disso, os caminhos, do mais simples ao mais complexo, são: encurtar o trecho bloqueado; trocar por um contador numa única linha com `UPDATE ... RETURNING` e uma sequência pré-calculada; ou aceitar o lead na hora e distribuir de forma assíncrona, com uma fila e um único consumidor. Webhooks não têm esse limite, porque o bloqueio é por lead.

## 6. Limitações

O que ficou de fora pelo tempo, e como seria feito:

- **Sem testes automatizados do frontend.** A cobertura está na API, onde ficam as regras e as permissões. Entraria um teste ponta a ponta com Playwright (login de cada perfil, filtros e mudança de status).
- **Sessão sem revogação.** O logout apaga o cookie, mas um token copiado vale até expirar (8 horas). Seria resolvido com uma versão de sessão no usuário, conferida a cada requisição.
- **Limite de requisições na memória.** Com mais de uma instância, cada uma conta separado.
- **Segredo do webhook em texto no banco e sem rotação.** O HMAC precisa do segredo original; em produção ele ficaria criptografado ou num cofre de segredos.
- **Sem auditoria da configuração do dispatcher.** Não fica registrado quem mudou os pesos nem quando.
- **Envio ao call center não simulado e sem redistribuição.** O lead fica com o call center escolhido na chegada.
- **Paginação por `OFFSET` e contagens exatas.** Suficiente agora; a seção de escalabilidade diz o que muda com volume.
- **Telas sem URL própria.** Recarregar volta para a aba inicial, e não dá para mandar o link de um lead.
- **Fuso horário.** Em fusos com horário de verão, o dia da troca pode sair com uma hora de diferença (o Brasil não tem horário de verão desde 2019).
- **A porta 3000 da API fica exposta no compose**, para o recebimento de leads e os scripts. Quem chama essa porta direto pode forjar o `X-Forwarded-For` e escapar do limite por IP; em produção, só o proxy ficaria exposto.

## 7. Melhorias futuras

Numa segunda versão:

1. **Envio real ao call center** com uma tabela de saída (outbox) e novas tentativas, e **redistribuição** quando o call center não atende dentro de um prazo.
2. **Integração contínua:** os testes rodando a cada push, com um Postgres de serviço.
3. **Observabilidade:** logs estruturados com id da requisição e métricas de latência e de tempo de bloqueio do dispatcher, para decidir mudanças de escala com dados.
4. **Paginação por cursor e métricas pré-agregadas.**
5. **Rotação de segredos do webhook** (dois segredos válidos durante a troca) e segredos criptografados.
6. **Auditoria das ações do ADMIN**, a começar pela configuração do dispatcher.
7. **Painel:** URLs por tela com `react-router`, testes ponta a ponta e cadastros de produtos, funis e usuários, que hoje entram pelo seed.

## 8. Como usei IA

**Ferramenta:** Claude Code (modelo Claude Opus 5.5), no terminal, com acesso ao repositório.

**Como conduzi.** Nada de código antes de a especificação estar decidida. Primeiro a IA leu o enunciado e levantou as ambiguidades; decidi cada uma e o resultado virou a [`docs/spec.md`](docs/spec.md). Depois veio o [`docs/plano.md`](docs/plano.md), dividido em itens pequenos, e o [`CLAUDE.md`](CLAUDE.md), com os princípios de arquitetura, a organização do código e o processo. A partir daí, cada item do plano seguiu o mesmo ciclo: a IA implementa e roda os testes, mostra o diff resumido com o porquê das escolhas, e eu reviso e aprovo antes do commit. O registro em [`docs/ia.md`](docs/ia.md) foi escrito durante o trabalho, e não reconstruído no final.

| Deleguei à IA | Ficou comigo |
|---|---|
| leitura e resumo do enunciado | prioridades e escopo |
| levantamento de alternativas e trade-offs | decisões de arquitetura e de regra de negócio |
| escrita do código e dos testes de cada passo | revisão de cada passo e aprovação do commit |
| simulações para conferir uma regra | o que entra e o que fica fora da entrega |

**O que a IA errou ou mudou, e o que decidi.** Os casos estão no `docs/ia.md`; os principais:

- **IA errou:** usou o `upsert` do Prisma para criar o afiliado, afirmando que ele virava `INSERT ... ON CONFLICT`. Na verificação, o log de SQL mostrou um SELECT seguido de um INSERT, e 200 gravações simultâneas do mesmo afiliado novo deram 180 erros. A correção entrou num commit `fix:` com um teste que falha no código antigo, e o caso virou regra no `CLAUDE.md`: garantia de concorrência só vale com teste simultâneo.
- **IA revisou a própria proposta:** o dispatcher começou como uma sequência fixa de 10 posições com contador; virou a regra do "mais atrasado", menor e que se ajusta sozinha a pausas e mudanças de peso. Um teste de corrida que só pegava o defeito em 2 de 3 execuções foi reforçado até pegar em todas.
- **Decisões minhas entre as opções levantadas:** a stack (Express e React separados, e não Next.js), cada ambiguidade da spec, as dependências de segurança e o frontend sem roteador.

**Como validei o que foi gerado.**

- **Testes como critério de aceite.** Cada fase do plano tem um "pronto quando" verificável por teste. São 122, e os de integração rodam contra o Postgres de verdade, porque unicidade, transação e bloqueio são comportamento do banco.
- **Testes de mutação nos pontos críticos.** Cada proteção foi removida de propósito, para confirmar que o teste correspondente falha sem ela: o `FOR UPDATE` do dispatcher, o `FOR UPDATE` do lead no webhook, o `ON CONFLICT` do evento, o `ON CONFLICT` do afiliado, o escopo do OPERATOR e o desempate da regra de distribuição.
- **O comportamento real do ORM.** Onde a concorrência importa, o SQL gerado foi conferido no log, em vez de presumido.
- **A aplicação rodando.** Os testes também rodam dentro do container, e o painel foi conferido no navegador com os dois perfis. O vídeo de demonstração foi gravado por um roteiro do Playwright escrito pela IA, com os leads e webhooks passando pela API de verdade durante a gravação.
- **Histórico sem passo quebrado.** Cada commit foi conferido isolado (typecheck e testes) antes do push.
