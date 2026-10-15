# Decisões técnicas

Registro das decisões de construção: como o sistema é feito, e não o que ele faz (isso está na `docs/spec.md`). Cada entrada diz o que foi decidido, por quê e o que se perde com a escolha.

## TypeScript executado com tsx, sem etapa de build

- **Decisão:** o backend roda os arquivos `.ts` direto com `tsx`, em desenvolvimento e no Docker. O `tsc` só confere os tipos (`npm run typecheck`) e não gera arquivos.
- **Por quê:** um único caminho de execução, sem pasta `dist/` e sem diferença entre o código que roda em desenvolvimento e no container.
- **Custo:** o `tsx` vai para as dependências de produção e a inicialização fica um pouco mais lenta. Em produção real, eu compilaria no build da imagem para subir mais rápido e não levar o compilador no container.

## Variáveis de ambiente sem dotenv

- **Decisão:** o Node 24 lê o `.env` com `--env-file-if-exists`, então não há a dependência `dotenv`. No Docker, as variáveis vêm do `docker-compose.yml`.
- **Por quê:** uma dependência a menos para um recurso que o runtime já oferece.
