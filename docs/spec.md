# Elevate Lead Dispatcher: especificação

Este documento é a minha leitura do teste técnico, escrita antes do código. Ele diz o que o sistema faz, como cada parte se comporta e como resolvi os pontos que o enunciado deixa em aberto. O que mudar durante o desenvolvimento é atualizado aqui, e o histórico do Git mostra quando e por quê.

## 1. Objetivo

Receber leads das páginas de vendas, validar, guardar, distribuir entre call centers na proporção configurada e acompanhar o status de cada lead a partir das atualizações que o call center envia. Um painel mostra os números e a lista de leads, com acesso diferente para administrador e operador.

## 2. Prioridade

O núcleo, que precisa estar completo e testado:

1. Recebimento de leads (`POST /api/leads`), com validação e sem duplicidade.
2. Banco de dados com migrations e índices justificados.
3. Distribuição entre call centers, correta com requisições simultâneas.
4. Webhook do call center, com assinatura, sem processar evento repetido e tratando evento fora de ordem.

Depois do núcleo, nesta ordem: login e permissões, painel, filtros. Se faltar tempo, a parte final sai menor e o que ficou de fora é documentado no README.

## 3. Quem usa o sistema

| Quem | O que faz |
|---|---|
| Página de vendas | Envia o lead para `POST /api/leads`. Não faz login. |
| Call center | Envia atualizações de status para `POST /api/webhooks/callcenter`, assinando cada requisição. |
| ADMIN | Vê todos os leads e os números, vê a distribuição e muda os pesos dos call centers. |
| OPERATOR | Pertence a um call center. Vê e atualiza só os leads do seu call center. |

## 4. Caminho de um lead

1. A página envia o lead.
2. A API valida o formato e confere se o produto existe e se o funil pertence a ele.
3. Se o mesmo lead já foi recebido, a API devolve o lead existente e para aqui.
4. Numa única transação: grava o lead com status `new`, escolhe o call center e registra a distribuição.
5. A API responde com o `lead_id`.
6. O call center trabalha o lead e envia eventos pelo webhook (`contacted`, `sale` etc.).
7. Cada evento entra no histórico. O status atual do lead só muda se o evento fizer sentido para o momento do lead.
8. ADMIN e OPERATOR acompanham pelo painel.

## 5. Recebimento de leads

### Campos

| Campo | Obrigatório | Regra |
|---|---|---|
| `name` | sim | texto de 2 a 120 caracteres, sem espaços sobrando nas pontas |
| `email` | sim | e-mail válido, guardado em minúsculas |
| `phone` | sim | formato internacional (E.164), ex. `+5511999999999`. Espaços, traços e parênteses são removidos antes de validar. Não conferimos se o número existe. |
| `product` | sim | identificador (slug) de um produto cadastrado e ativo |
| `funnel` | sim | identificador de um funil cadastrado **desse** produto |
| `source` | não | texto até 50 caracteres. Se não vier, usa `utm.source`. |
| `campaign` | não | texto até 120. Se não vier, usa `utm.campaign`. |
| `affiliate_id` | não | texto até 64 (o exemplo manda `"999"` como texto) |
| `utm` | não | objeto com `source`, `medium`, `campaign`, `content` e `term`, todos texto opcional até 255 |

Campos fora da lista são ignorados. Campo opcional vazio (`""`), só com espaços ou `null` conta como não enviado: formulários costumam mandar campos escondidos vazios, e um `affiliate_id` vazio não pode virar um afiliado. O lead recebe um UUID e a data e hora de criação, gravados pelo banco.

### Respostas

| Situação | Status | Corpo |
|---|---|---|
| Lead novo | `201` | `{ "success": true, "lead_id": "..." }` |
| Lead repetido (seção 6) | `200` | `{ "success": true, "lead_id": "<o original>", "duplicate": true }` |
| JSON quebrado, campo faltando ou tipo errado | `400` | `{ "success": false, "error": "validation_error", "details": [{ "field": "email", "message": "..." }] }` |
| Formato certo, mas produto não existe ou funil não é do produto | `422` | `{ "success": false, "error": "unknown_product" }` ou `"unknown_funnel"` |
| Excesso de requisições do mesmo IP | `429` | `{ "success": false, "error": "rate_limited" }` |
| Erro interno | `500` | mensagem genérica, sem detalhe técnico |

A diferença entre 400 e 422: 400 é "não entendi o que você mandou"; 422 é "entendi, mas não posso aceitar".

### Afiliado

Se o `affiliate_id` ainda não existe no banco, ele é criado na hora. Os afiliados nascem em outra plataforma; recusar o lead porque o afiliado não está cadastrado aqui seria perder uma venda por um problema de cadastro.

## 6. Lead repetido (idempotência)

A mesma requisição pode chegar mais de uma vez: clique duplo, página recarregada, nova tentativa depois de uma falha de rede. Cada lead tem uma **chave de duplicidade**, guardada numa coluna com restrição de unicidade (unique) no banco:

- Se a página manda o cabeçalho `Idempotency-Key`, a chave é esse valor.
- Se não manda, a chave é calculada: e-mail + produto + funil + data do dia (UTC).

Na gravação, o banco recusa a segunda chave igual (`INSERT ... ON CONFLICT DO NOTHING`). Quando isso acontece, a API busca o lead que já existe e devolve o mesmo `lead_id`. Como quem decide é o banco, duas requisições iguais chegando ao mesmo tempo não criam dois leads.

Limites aceitos:

- A mesma pessoa que preenche o mesmo funil em outro dia vira lead novo. Tratamos isso como novo interesse, e não como repetição.
- Duas requisições iguais, uma às 23h59 e outra às 00h01 (UTC), viram dois leads.
- A mesma `Idempotency-Key` com conteúdo diferente devolve o lead original, sem comparar o conteúdo.

## 7. Distribuição (dispatcher)

### Regra

Cada call center tem um peso (inicialmente A = 50, B = 30, C = 20) e um contador de leads recebidos. A cada lead novo, recebe o call center que está **mais atrasado em relação à sua parte**, ou seja, o de menor `recebidos / peso`. Em caso de empate, vence o de maior peso.

Com 50/30/20, os 10 primeiros leads saem na ordem A, B, C, A, B, A, C, A, B, A: A recebe 5, B recebe 3 e C recebe 2, intercalados, sem 5 seguidos para A. Depois de 10 leads os três estão exatamente na sua parte e o ciclo se repete. É uma forma de weighted round robin: o resultado é exato e previsível, e a regra cabe numa função pequena, testada sem banco.

### Concorrência

O risco é duas requisições lerem os mesmos contadores ao mesmo tempo e escolherem com base no mesmo estado. Para evitar isso, dentro da transação do lead:

1. `SELECT ... FOR UPDATE` nos call centers ativos, sempre na mesma ordem (por id). A segunda requisição espera a primeira terminar.
2. Escolhe o call center com a regra acima.
3. Soma 1 no contador dele e grava a distribuição.
4. Fim da transação: o bloqueio é liberado, e a próxima requisição lê os contadores já atualizados.

Com 100 leads simultâneos, as escolhas acontecem uma de cada vez, e o resultado final é exatamente 50/30/20. O bloqueio dura só o tempo de gravar o lead (milissegundos). O custo é que as distribuições não acontecem em paralelo, o que é aceitável neste volume. O README discute o que fazer com volume muito maior.

### Configuração

- O ADMIN muda pesos e ativa ou pausa call centers.
- Ao salvar, os contadores voltam a zero, e a nova proporção passa a valer dali em diante. Sem isso, um call center que ficou para trás antes da mudança receberia uma rajada de leads depois dela.
- A configuração exige pelo menos um call center ativo com peso maior que zero. Por isso todo lead é distribuído no momento em que chega.
- O envio para o sistema do call center não é simulado: registrar a distribuição no banco é suficiente (o enunciado permite).

## 8. Webhook do call center

### Autenticação (HMAC)

Cada call center tem um segredo próprio. Cada requisição traz três cabeçalhos:

| Cabeçalho | Conteúdo |
|---|---|
| `X-Call-Center` | identificador do call center (ex. `cc-a`) |
| `X-Timestamp` | momento do envio, em segundos (Unix) |
| `X-Signature` | `sha256=` + HMAC-SHA256 de `"<timestamp>.<corpo bruto>"` com o segredo |

A API recalcula a assinatura e compara em tempo constante (`crypto.timingSafeEqual`). Se o `X-Timestamp` tiver mais de 5 minutos de diferença do relógio do servidor, a requisição é recusada: quem copiar uma requisição verdadeira não consegue reenviá-la depois.

HMAC em vez de uma chave fixa no cabeçalho porque a assinatura prova que o corpo não foi alterado no caminho e o segredo nunca trafega. É o padrão de Stripe, GitHub e Shopify.

O segredo fica no banco, na tabela do call center, e nunca é devolvido pela API. Um script em `scripts/` assina e envia webhooks de teste, para a demonstração e para quem for avaliar.

### Corpo

| Campo | Regra |
|---|---|
| `lead_id` | UUID de um lead distribuído para **este** call center |
| `external_id` | id do lead no sistema do call center; texto opcional até 100. Guardado no evento e na distribuição, para referência. |
| `status` | um de: `new`, `contacted`, `no_answer`, `callback`, `qualified`, `sale`, `refund`, `invalid` |
| `timestamp` | data e hora do evento (ISO 8601, ex. `2026-10-08T12:30:00Z`); não pode estar mais de 5 minutos no futuro |

O limite no futuro existe porque um evento com data adiantada passaria a ser "o mais recente" e travaria o lead: todos os eventos verdadeiros seguintes seriam considerados antigos.

### Processamento

1. Confere a assinatura. Falhou: `401`.
2. Valida o corpo. Inválido: `400`.
3. Busca o lead. Não existe ou é de outro call center: `404`. A resposta é a mesma nos dois casos, para não revelar que o lead existe.
4. Grava o evento no histórico. Se o mesmo evento já existe: `200` com `"duplicate": true`, sem mudar nada.
5. Decide se o evento muda o status atual (seção 9) e responde `200` com `"applied": true` ou `false` e o motivo.

Evento barrado pelas regras de status também responde `200`, porque ele foi recebido e registrado. Se a API respondesse erro, o call center reenviaria o mesmo evento indefinidamente.

### Webhook repetido

Um evento é identificado por lead + status + `timestamp` do evento. Essa combinação tem restrição de unicidade na tabela de histórico, e a gravação usa `INSERT ... ON CONFLICT DO NOTHING`. O mesmo webhook recebido várias vezes, inclusive ao mesmo tempo, gera um único registro e muda o status uma única vez.

## 9. Status e eventos fora de ordem

### Transições permitidas

| De | Pode ir para |
|---|---|
| `new` | `contacted`, `no_answer`, `callback`, `qualified`, `sale`, `invalid` |
| `contacted`, `no_answer`, `callback`, `qualified` | qualquer um desses quatro (inclusive o mesmo, ex. uma segunda tentativa sem resposta), `sale` ou `invalid` |
| `sale` | só `refund` |
| `refund`, `invalid` | nenhum (são finais) |

Um evento `new` nunca muda o status. Ele só é registrado, como confirmação de recebimento.

### Fora de ordem

Todo evento é guardado no histórico com o `timestamp` que o call center informou. O status atual só muda quando as duas condições são verdadeiras:

1. O evento é **mais recente** que o último evento aplicado ao lead.
2. A transição é **permitida** pela tabela acima.

Exemplo do enunciado: `sale` às 12h00 e depois chega um `contacted` das 11h50. O `contacted` é mais antigo, então entra no histórico com `applied = false` e o motivo `stale`, e o lead continua `sale`. Se o `contacted` viesse com horário depois da venda, seria barrado pela regra 2 (`sale` só vai para `refund`), com o motivo `invalid_transition`.

O histórico guarda tudo, aplicado ou não. Isso cobre a auditoria: sempre dá para ver o que chegou, quando chegou e por que mudou ou não mudou o lead.

O OPERATOR também muda status pelo painel. Essa mudança passa pelas mesmas regras e entra no mesmo histórico, marcada como vinda do painel e com o usuário que fez.

## 10. Login e permissões

- Login com e-mail e senha. A senha é guardada com bcrypt.
- A sessão é um JWT de 8 horas num cookie `httpOnly` e `SameSite=Strict`. O JavaScript da página não lê o cookie, o que protege a sessão contra roubo por XSS.
- O ADMIN não tem call center. O OPERATOR tem exatamente um.
- **Toda checagem acontece no backend.** As rotas administrativas exigem ADMIN. Toda consulta de leads feita por OPERATOR recebe o filtro do call center dele dentro do próprio serviço, e não na tela.
- Um OPERATOR que tenta abrir um lead de outro call center recebe `404`, igual a um lead que não existe. Um OPERATOR que chama uma rota de ADMIN recebe `403`.
- O login tem limite de tentativas: 5 a cada 15 minutos para o mesmo IP e e-mail.

## 11. Painel

### Números (só ADMIN)

| Número | Definição |
|---|---|
| Total de leads | todos os leads |
| Leads hoje | criados desde 00h00 de hoje no fuso `APP_TIMEZONE` (padrão `America/Sao_Paulo`) |
| Distribuídos | leads com call center atribuído |
| Pendentes | leads com status `new`: ninguém trabalhou ainda |
| Vendas | leads com status atual `sale` (um `refund` sai da conta) |
| Taxa de conversão | vendas ÷ total de leads |

"Pendente" ficou como "ainda não trabalhado" porque a distribuição é imediata, e "aguardando distribuição" seria sempre zero.

### Tabela de leads (ADMIN e OPERATOR)

- Colunas: nome, produto, funil, origem, call center, status e data.
- Filtros: período, produto, funil, origem, call center e status. O OPERATOR não escolhe call center: o dele é fixo.
- Paginação no servidor: 20 por página, no máximo 100. O navegador nunca recebe todos os leads.
- Ao abrir um lead: dados de contato, rastreamento (UTM, afiliado) e o histórico de status.

### Distribuição (só ADMIN)

Lista os call centers com peso, ativo ou pausado, quantos leads cada um recebeu e a parte real de cada um. Permite editar pesos e ativar ou pausar.

## 12. API

| Método e rota | Quem | Para quê |
|---|---|---|
| `POST /api/leads` | público, com limite por IP | receber lead |
| `POST /api/webhooks/callcenter` | call center, com HMAC | atualizar status |
| `POST /api/auth/login` | público, com limite de tentativas | entrar |
| `POST /api/auth/logout` | logado | sair |
| `GET /api/auth/me` | logado | quem sou eu |
| `GET /api/leads` | ADMIN; OPERATOR só os seus | lista com filtros e paginação |
| `GET /api/leads/:id` | ADMIN; OPERATOR só os seus | detalhe com histórico |
| `PATCH /api/leads/:id/status` | ADMIN; OPERATOR só os seus | mudar status pelo painel |
| `GET /api/metrics` | ADMIN | números do painel |
| `GET /api/dispatcher` | ADMIN | ver a distribuição |
| `PUT /api/dispatcher` | ADMIN | mudar pesos e ativar ou pausar |
| `GET /api/options` | logado | produtos, funis e call centers para os filtros |

`POST /api/leads` aceita requisições de qualquer origem (CORS aberto só nessa rota), porque as páginas de vendas ficam em outros domínios. Ela não usa cookie, então isso não abre brecha de CSRF. Os limites de requisição são configuráveis por variável de ambiente (os testes de concorrência precisam desligá-los).

## 13. Segurança

| Risco | Como é tratado |
|---|---|
| SQL injection | Prisma e consultas parametrizadas; nenhum SQL montado concatenando texto |
| XSS | o React escapa o que exibe; a API não devolve HTML; cabeçalhos do `helmet` |
| CSRF | cookie `SameSite=Strict`, front e API na mesma origem, API só aceita JSON |
| Força bruta | limite de tentativas no login |
| Abuso do recebimento | limite por IP em `POST /api/leads` |
| Webhook falso | HMAC com segredo por call center e janela de 5 minutos |
| Acesso indevido | perfil e call center conferidos no backend em toda rota |
| Exposição de dados | a API nunca devolve hash de senha nem segredo de webhook; erros sem stack trace; logs não registram o corpo das requisições |
| Segredos no repositório | `.env` fora do Git; só o `.env.example`, com valores de desenvolvimento |

Ficam para depois (registrado no README): captcha ou honeypot no formulário, limite de requisições compartilhado entre várias instâncias, segredos criptografados no banco, 2FA.

## 14. Testes

| Tipo | O que cobre |
|---|---|
| Unitário | validação do lead; escolha do call center; tabela de transições de status |
| Integração | `POST /api/leads` (novo, repetido, inválido, produto desconhecido); webhook (assinatura, repetido, fora de ordem, lead de outro call center); OPERATOR barrado em rota de ADMIN e em lead de outro call center |
| Concorrência | 100 `POST /api/leads` simultâneos: 100 leads, nenhum duplicado e exatamente 50/30/20; o mesmo webhook enviado 10 vezes ao mesmo tempo gera um único evento |

Os testes de integração rodam contra um Postgres de verdade (o do docker compose, num banco separado para testes), porque o comportamento sob concorrência depende do banco.

## 15. Fora do escopo

- Envio real do lead para o sistema do call center.
- Redistribuir um lead para outro call center (ex.: quando ninguém atende).
- Telas de cadastro de produtos, funis, afiliados e usuários: os dados entram pelo seed.
- Recuperação de senha e 2FA.

## 16. Stack

| Parte | Escolha | Por quê |
|---|---|---|
| Backend | Node.js, Express e TypeScript | código explícito: cada etapa da requisição está escrita no arquivo; é a stack da vaga |
| Banco | PostgreSQL e Prisma | transações e bloqueio de linha resolvem a concorrência sem peça extra; o Prisma deixa as consultas comuns legíveis e versiona as migrations |
| Validação | Zod | as regras de cada campo ficam num lugar só e se leem como uma lista |
| Frontend | React e Vite | painel atrás de login, sem necessidade de renderizar no servidor |
| Testes | Vitest e supertest | testam a API sem subir servidor |
| Execução | Docker Compose | `docker compose up` sobe banco, backend e frontend |

Não há Redis, fila nem worker. A concorrência se resolve com transação e bloqueio no Postgres, e cada peça a mais seria algo para operar e manter sem ganho neste volume.
