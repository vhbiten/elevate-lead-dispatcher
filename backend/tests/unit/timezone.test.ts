import { describe, expect, it } from 'vitest';
import { addDays, dateIn, startOfDay } from '../../src/timezone';

describe('fuso horário', () => {
  it('o dia em São Paulo começa às 03h00 UTC', () => {
    expect(startOfDay('2026-10-18', 'America/Sao_Paulo').toISOString()).toBe('2026-10-18T03:00:00.000Z');
  });

  it('funciona para fusos à frente do UTC e para o próprio UTC', () => {
    expect(startOfDay('2026-10-18', 'Asia/Tokyo').toISOString()).toBe('2026-10-17T15:00:00.000Z');
    expect(startOfDay('2026-10-18', 'UTC').toISOString()).toBe('2026-10-18T00:00:00.000Z');
  });

  it('às 23h de São Paulo ainda é o mesmo dia, mesmo já sendo o dia seguinte em UTC', () => {
    const instant = new Date('2026-10-19T02:00:00Z');

    expect(dateIn('America/Sao_Paulo', instant)).toBe('2026-10-18');
    expect(dateIn('UTC', instant)).toBe('2026-10-19');
  });

  it('soma dias atravessando o fim do mês', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});
