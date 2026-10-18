# Decisões técnicas

Registro das decisões de construção: como o sistema é feito, e não o que ele faz (isso está na `docs/spec.md`). Cada entrada diz o que foi decidido, por quê e o que se perde com a escolha.

## TypeScript executado com tsx, sem etapa de build

- **Decisão:** o backend roda os arquivos `.ts` direto com `tsx`, em desenvolvimento e no Docker. O `tsc` só confere os tipos (`npm run typecheck`) e não gera arquivos.
- **Por quê:** um único caminho de execução, sem pasta `dist/` e sem diferença entre o código que roda em desenvolvimento e no container.
- **Custo:** o `tsx` vai para as dependências de produção e a inicialização fica um pouco mais lenta. Em produção real, eu compilaria no build da imagem para subir mais rápido e não levar o compilador no container.

## Variáveis de ambiente sem dotenv

- **Decisão:** o Node 24 lê o `.env` com `--env-file-if-exists`, então não há a dependência `dotenv`. No Docker, as variáveis vêm do `docker-compose.yml`.
- **Por quê:** uma dependência a menos para um recurso que o runtime já oferece.

## Prisma 7 com o adapter do Postgres

- **Decisão:** Prisma 7.10, fixado na versão exata (a tag `latest` do npm aponta para o 8.0, ainda em release candidate), com o cliente gerado em `src/generated/prisma` (fora do Git) e o adapter `@prisma/adapter-pg`. A migration roda na subida do container (`prisma migrate deploy`).
- **Por quê:** o schema documenta o modelo num arquivo só, as migrations ficam versionadas em SQL e as consultas comuns ficam legíveis. Os pontos de concorrência usam SQL escrito à mão, via `$queryRaw`.
- **Custo:** o `npm audit` aponta alertas em `mysql2` e `deepmerge-ts`, dependências internas do CLI do Prisma. Eles não chegam à API: o `mysql2` só é usado com MySQL, e o `deepmerge-ts` só processa o arquivo de configuração do próprio projeto. A correção sugerida pelo npm rebaixaria para o Prisma 6. Migration na subida do container serve para uma instância; com várias réplicas, ela viraria uma etapa separada do deploy.

## Modelo do banco

O schema está em `backend/prisma/schema.prisma`, e a migration em `backend/prisma/migrations/`.

| Tabela | Papel |
|---|---|
| `products`, `funnels` | produtos e seus funis; o mesmo slug de funil pode existir em produtos diferentes |
| `affiliates` | afiliados, identificados pelo código da plataforma de origem |
| `call_centers` | operações de atendimento, com peso, contador do dispatcher e segredo do webhook |
| `leads` | o lead, com rastreamento, status atual e call center atual |
| `distributions` | cada distribuição de um lead para um call center |
| `lead_status_events` | histórico de status, aplicado ou não |
| `users` | login, com perfil e call center |

### Decisões

1. **O lead usa UUID v7, gerado pelo Postgres 18. As outras tabelas usam inteiro.** O id do lead sai para sistemas externos, então não pode ser um contador, que revelaria o volume de leads e deixaria adivinhar outros ids. O v7 tem 74 bits aleatórios e começa pelo horário de criação: com milhões de linhas, o índice da chave primária recebe as inserções sempre no fim, em vez de espalhadas como no UUID v4. Nas tabelas de cadastro, o inteiro deixa as chaves estrangeiras dentro de `leads` com 4 bytes em vez de 16.
2. **O call center atual fica no lead, e `distributions` guarda o histórico.** Filtrar por call center é a consulta mais frequente (todo OPERATOR faz isso em toda tela), então `leads.call_center_id` tem índice e dispensa join. A tabela `distributions` registra cada distribuição e já comporta uma redistribuição futura.
3. **O status atual é uma coluna do lead, e o histórico só recebe inserções.** O status é um `enum` do Postgres porque a lista faz parte do contrato com o call center. `status_updated_at` guarda o horário do último evento aplicado, que é a referência para reconhecer evento fora de ordem. A criação do lead também gera um evento (`source = system`), então o histórico começa com o lead.
4. **Integridade no banco, e não só no código.** Restrições `CHECK` garantem peso e contador não negativos e que OPERATOR sempre tem call center e ADMIN nunca tem. O Prisma não declara `CHECK`, então elas foram escritas à mão no fim da migration. As chaves estrangeiras bloqueiam exclusões (`ON DELETE RESTRICT`): call centers e afiliados são desativados, nunca apagados, para não perder o histórico.
5. **Um nome só para cada campo.** As colunas usam snake_case, que é o mesmo nome no banco, no código e na API (que já usa snake_case, como no exemplo do enunciado). Não há tradução entre camadas, e o SQL escrito à mão fica legível.

### Índices

Cada índice acelera uma consulta, mas deixa a inserção de leads mais lenta, e a inserção é o caminho crítico do sistema. Por isso só entram índices ligados a uma consulta real.

| Índice | Consulta que atende |
|---|---|
| `leads(dedup_key)` único | detectar lead repetido |
| `leads(created_at)` | lista padrão ordenada por data, filtro por período, "leads hoje" |
| `leads(call_center_id, created_at)` | lista do OPERATOR e filtro por call center, já na ordem de data |
| `leads(status, created_at)` | filtro por status e contagem de pendentes e vendas |
| `leads(product_id, created_at)` | filtro por produto (o funil é sempre escolhido dentro de um produto) |
| `lead_status_events(lead_id, status, occurred_at)` único | descartar webhook repetido e listar o histórico de um lead |
| `distributions(lead_id)` | distribuições de um lead, no detalhe |

Ficam sem índice, de propósito:

- `leads.source`: poucos valores distintos, sempre filtrado junto com o período.
- `leads.email`: a duplicidade é resolvida pela `dedup_key`.
- `leads.affiliate_id`: nenhuma tela consulta por afiliado.

## Seed na subida do container

- **Decisão:** o seed cria produtos, funis, call centers e usuários fictícios e roda em toda subida do container, logo depois das migrations. Todo `upsert` usa `update: {}`, então rodar de novo não altera o que já existe (como pesos mudados pelo ADMIN).
- **Por quê:** quem for avaliar roda `docker compose up` e já encontra dados e usuários para entrar, sem nenhum passo manual.
- **Senhas:** `bcryptjs` (bcrypt implementado em JavaScript) em vez do pacote nativo `bcrypt`, que exige compilação na imagem Alpine e um script de instalação que o npm 11 bloqueia por padrão. O algoritmo e o formato do hash são os mesmos.

## Testes de integração contra o Postgres real

- **Decisão:** os testes de integração chamam a API com supertest e gravam num Postgres de verdade: o banco `elevate_test`, no mesmo container do compose, criado por `backend/prisma/create-test-db.sql` quando o volume nasce. Antes da suíte, as migrations e o seed são aplicados nele. Cada teste começa com as tabelas de lead vazias (`TRUNCATE`), e os arquivos rodam um de cada vez, porque dividem o banco.
- **Por quê:** o que mais importa testar aqui (unicidade, transações, concorrência) é comportamento do banco. Um mock ou um banco em memória aprovaria código que falha no Postgres.
- **Organização:** o Vitest tem dois projetos. `unit` cobre regras puras e roda sem Docker (`npm run test:unit`); `integration` precisa do banco no ar (`npm test` roda os dois).

## Corridas na gravação do lead: quem resolve é o banco

- **Lead repetido:** a `dedup_key` tem restrição unique. Duas requisições iguais ao mesmo tempo tentam gravar, o Postgres faz a segunda esperar a primeira e então recusa a segunda (erro `P2002` no Prisma). A API desfaz a transação e devolve o lead que já existe. Não há "consulta antes de gravar", que deixaria uma janela entre a consulta e o INSERT.
- **Afiliado novo:** é criado com `INSERT ... ON CONFLICT (code) DO NOTHING`, seguido de uma busca pelo código. O `upsert` do Prisma não serve aqui: ele faz um SELECT e depois um INSERT, e num teste com 200 gravações simultâneas do mesmo afiliado novo, 180 falharam com erro de unique.
- **Custo:** o caso repetido gasta uma transação desfeita e uma consulta a mais. É o caso raro, e o caminho comum (lead novo) não paga nada por isso.

## Dispatcher: bloqueio de linha no Postgres

- **Decisão:** a escolha do call center acontece dentro da transação do lead, com `SELECT ... FOR UPDATE` nos call centers ativos, em ordem de id (`src/dispatcher/dispatcher.service.ts`). A regra em si é uma função pura (`pick-call-center.ts`), testada sem banco.
- **Por quê:** o estado que importa (os contadores) já está no Postgres, e o bloqueio de linha resolve a corrida sem outra peça na arquitetura. A gravação do lead, o contador e a distribuição entram ou saem juntos: um lead repetido desfaz a transação e não conta para a proporção. A ordem fixa por id impede deadlock entre duas transações.
- **Como foi verificado:** 100 requisições simultâneas resultam em exatamente 50/30/20. Sem o `FOR UPDATE`, o mesmo teste falha (numa rodada deu 48/32/20).
- **Custo:** as distribuições acontecem uma de cada vez. No container, 100 leads simultâneos levam cerca de 0,6 s, ou seja, uns 6 ms por lead. O pool tem 10 conexões e o Prisma espera até 2 s por uma conexão livre, então um pico bem maior que esse começaria a dar erro. O README discute o caminho para volume alto.

## Webhook: corpo bruto, bloqueio do lead e evento único

- **Corpo bruto:** a rota do webhook usa `express.raw()` e é montada antes do `express.json()`. A assinatura é conferida sobre os bytes exatos que o call center enviou; ler o JSON e serializar de novo poderia mudar espaços ou a ordem dos campos e invalidar uma assinatura correta. O JSON só é lido depois da assinatura.
- **Bloqueio do lead:** o processamento faz `SELECT ... FOR UPDATE` na linha do lead. Sem isso, uma `sale` e um `contacted` antigo chegando juntos leriam o mesmo status, os dois seriam aplicados e o último a gravar venceria, podendo desfazer a venda. Com o bloqueio, cada webhook decide a partir do status que o anterior deixou. O bloqueio vale só para aquele lead: webhooks de leads diferentes continuam em paralelo.
- **Evento único:** o evento é gravado com `INSERT ... ON CONFLICT (lead_id, status, occurred_at) DO NOTHING RETURNING id`. Sem linha de volta, o evento é repetido e nada muda.
- **Como foi verificado:** sem o `FOR UPDATE`, o teste de eventos simultâneos falha; sem o `ON CONFLICT`, os testes de webhook repetido falham.
- **Custo:** o segredo de cada call center fica em texto no banco, porque o HMAC precisa dele para recalcular a assinatura. Em produção, ele ficaria criptografado no banco, ou num cofre de segredos.

## Sessão: JWT em cookie, sem tabela de sessões

- **Decisão:** o login gera um JWT (HS256, 8 horas) com o id, o perfil e o call center do usuário, gravado num cookie `httpOnly` e `SameSite=Strict`. As rotas conferem a assinatura e usam o perfil do token, sem consultar o banco. O algoritmo é fixo na verificação, então um token que declare outro algoritmo é recusado.
- **Por quê:** é o que a spec pede, e dispensa uma tabela de sessões. O cookie `httpOnly` deixa o token fora do alcance do JavaScript da página; o `SameSite=Strict` impede que outro site use a sessão.
- **Custo:** não dá para derrubar uma sessão antes de ela expirar. Se um usuário for removido ou mudar de perfil, o token antigo continua valendo até 8 horas (só o `GET /api/auth/me` confere o usuário no banco). Para revogação imediata, entraria uma lista de tokens revogados ou uma tabela de sessões.
- **E-mail inexistente:** o login roda o bcrypt mesmo quando o e-mail não existe, contra um hash qualquer, para o tempo de resposta não revelar quais e-mails estão cadastrados.
