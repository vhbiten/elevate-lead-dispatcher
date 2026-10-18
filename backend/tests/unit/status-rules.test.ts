import { describe, expect, it } from 'vitest';
import type { LeadStatus } from '../../src/generated/prisma/enums';
import { decideStatusChange } from '../../src/leads/status-rules';

const noon = new Date('2026-10-08T12:00:00Z');
const before = new Date('2026-10-08T11:50:00Z');
const after = new Date('2026-10-08T12:10:00Z');

// Lead com o último evento aplicado ao meio-dia.
function lead(status: LeadStatus) {
  return { status, status_updated_at: noon };
}

function decide(from: LeadStatus, to: LeadStatus, occurredAt = after) {
  return decideStatusChange(lead(from), { status: to, occurred_at: occurredAt });
}

const WORKING: LeadStatus[] = ['contacted', 'no_answer', 'callback', 'qualified'];

describe('decideStatusChange', () => {
  it('exemplo do enunciado: contacted das 11h50 depois de uma sale das 12h00 não desfaz a venda', () => {
    expect(decide('sale', 'contacted', before)).toEqual({ applied: false, reason: 'stale' });
  });

  it('contacted com horário depois da venda é barrado pela transição', () => {
    expect(decide('sale', 'contacted', after)).toEqual({ applied: false, reason: 'invalid_transition' });
  });

  it('evento com o mesmo horário do último aplicado não é mais recente', () => {
    expect(decide('contacted', 'qualified', noon)).toEqual({ applied: false, reason: 'stale' });
  });

  it('de new vai para os status de trabalho, sale ou invalid', () => {
    for (const to of [...WORKING, 'sale', 'invalid'] as LeadStatus[]) {
      expect(decide('new', to)).toEqual({ applied: true });
    }
    expect(decide('new', 'refund')).toEqual({ applied: false, reason: 'invalid_transition' });
  });

  it('entre status de trabalho vai e volta, inclusive para o mesmo', () => {
    for (const from of WORKING) {
      for (const to of [...WORKING, 'sale', 'invalid'] as LeadStatus[]) {
        expect(decide(from, to)).toEqual({ applied: true });
      }
      expect(decide(from, 'refund')).toEqual({ applied: false, reason: 'invalid_transition' });
    }
  });

  it('sale só vai para refund', () => {
    expect(decide('sale', 'refund')).toEqual({ applied: true });
    for (const to of [...WORKING, 'new', 'sale', 'invalid'] as LeadStatus[]) {
      expect(decide('sale', to)).toEqual({ applied: false, reason: 'invalid_transition' });
    }
  });

  it('refund e invalid são finais', () => {
    for (const from of ['refund', 'invalid'] as LeadStatus[]) {
      for (const to of [...WORKING, 'new', 'sale', 'refund', 'invalid'] as LeadStatus[]) {
        expect(decide(from, to)).toEqual({ applied: false, reason: 'invalid_transition' });
      }
    }
  });

  it('evento new nunca muda o status', () => {
    for (const from of [...WORKING, 'new', 'sale', 'refund', 'invalid'] as LeadStatus[]) {
      expect(decide(from, 'new')).toEqual({ applied: false, reason: 'invalid_transition' });
    }
  });
});
