import { createApp } from './app';

// Sem o segredo do JWT, nenhum login funcionaria: melhor não subir do que subir quebrado.
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET não definido');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, () => {
  console.log(`API rodando na porta ${port}`);
});
