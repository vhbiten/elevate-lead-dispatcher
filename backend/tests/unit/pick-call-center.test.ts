import { describe, expect, it } from 'vitest';
import { pickCallCenter, type CallCenterLoad } from '../../src/dispatcher/pick-call-center';

const A = 1;
const B = 2;
const C = 3;

function seed(): CallCenterLoad[] {
  return [
    { id: A, weight: 50, assigned_count: 0 },
    { id: B, weight: 30, assigned_count: 0 },
    { id: C, weight: 20, assigned_count: 0 },
  ];
}

// Distribui n leads um a um, como o banco faria, e devolve a ordem das escolhas.
function simulate(callCenters: CallCenterLoad[], leads: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < leads; i++) {
    const chosen = pickCallCenter(callCenters);
    if (!chosen) throw new Error('nenhum call center elegível');
    chosen.assigned_count += 1;
    order.push(chosen.id);
  }
  return order;
}

function countBy(order: number[], id: number): number {
  return order.filter((chosen) => chosen === id).length;
}

describe('pickCallCenter', () => {
  it('com 50/30/20, os 10 primeiros leads saem na ordem A, B, C, A, B, A, C, A, B, A', () => {
    expect(simulate(seed(), 10)).toEqual([A, B, C, A, B, A, C, A, B, A]);
  });

  it('com 100 leads, divide exatamente 50/30/20', () => {
    const order = simulate(seed(), 100);

    expect([countBy(order, A), countBy(order, B), countBy(order, C)]).toEqual([50, 30, 20]);
  });

  it('nunca manda mais de 2 leads seguidos para o mesmo call center com 50/30/20', () => {
    const order = simulate(seed(), 100);
    let run = 1;
    let longestRun = 1;
    for (let i = 1; i < order.length; i++) {
      run = order[i] === order[i - 1] ? run + 1 : 1;
      longestRun = Math.max(longestRun, run);
    }

    expect(longestRun).toBeLessThanOrEqual(2);
  });

  it('no empate, escolhe o de maior peso e, com o mesmo peso, o de menor id', () => {
    expect(
      pickCallCenter([
        { id: 1, weight: 20, assigned_count: 0 },
        { id: 2, weight: 50, assigned_count: 0 },
      ])?.id,
    ).toBe(2);
    expect(
      pickCallCenter([
        { id: 7, weight: 10, assigned_count: 0 },
        { id: 4, weight: 10, assigned_count: 0 },
      ])?.id,
    ).toBe(4);
  });

  it('continua a partir dos contadores que recebe', () => {
    // A já recebeu 5 de 50 (10%); B e C estão em 0%.
    const callCenters = seed();
    callCenters[0].assigned_count = 5;

    expect(pickCallCenter(callCenters)?.id).toBe(B);
  });

  it('ignora call center com peso zero e divide o resto na proporção dos pesos', () => {
    const order = simulate(
      [
        { id: A, weight: 3, assigned_count: 0 },
        { id: B, weight: 0, assigned_count: 0 },
        { id: C, weight: 1, assigned_count: 0 },
      ],
      40,
    );

    expect([countBy(order, A), countBy(order, B), countBy(order, C)]).toEqual([30, 0, 10]);
  });

  it('devolve null quando não há call center elegível', () => {
    expect(pickCallCenter([])).toBeNull();
    expect(pickCallCenter([{ id: A, weight: 0, assigned_count: 0 }])).toBeNull();
  });
});
