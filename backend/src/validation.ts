import type { z } from 'zod';

export type ValidationDetail = { field: string; message: string };

// Converte o erro do Zod no formato de resposta da API: [{ field: "utm.source", message: "..." }].
export function formatValidationError(error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    // Caminho vazio significa que o problema é o corpo inteiro (ex.: não é um objeto JSON).
    field: issue.path.length > 0 ? issue.path.join('.') : 'body',
    message: issue.message,
  }));
}
