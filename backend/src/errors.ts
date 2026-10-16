import type { ErrorRequestHandler } from 'express';

// Último middleware da aplicação: qualquer erro não tratado vira uma resposta no formato da API.
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  // Corpo que não é JSON válido: o express.json() falha antes de chegar à rota.
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      error: 'validation_error',
      details: [{ field: 'body', message: 'Invalid JSON' }],
    });
    return;
  }

  // Outros erros do cliente apontados pelo leitor do corpo (ex.: corpo grande demais).
  if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
    res.status(error.status).json({ success: false, error: 'bad_request' });
    return;
  }

  // Erro inesperado: o detalhe fica só no log do servidor, nunca na resposta.
  console.error(error);
  res.status(500).json({ success: false, error: 'internal_error' });
};
