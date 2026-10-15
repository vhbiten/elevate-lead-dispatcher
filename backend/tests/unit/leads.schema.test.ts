import { describe, expect, it } from 'vitest';
import { leadSchema } from '../../src/leads/leads.schema';
import { formatValidationError } from '../../src/validation';

// Payload do exemplo do enunciado.
function validLead(): Record<string, unknown> {
  return {
    name: 'João Silva',
    email: 'joao@email.com',
    phone: '+5511999999999',
    product: 'nutralean',
    funnel: 'vsl-01',
    source: 'facebook',
    campaign: 'campaign-123',
    affiliate_id: '999',
    utm: { source: 'facebook', medium: 'cpc', campaign: 'campaign-123', content: 'ad-01' },
  };
}

// Campos apontados como inválidos, no formato da resposta da API.
function invalidFields(payload: unknown): string[] {
  const result = leadSchema.safeParse(payload);
  if (result.success) return [];
  return formatValidationError(result.error).map((detail) => detail.field);
}

describe('leadSchema', () => {
  it('aceita o payload do enunciado', () => {
    const result = leadSchema.safeParse(validLead());

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      name: 'João Silva',
      email: 'joao@email.com',
      phone: '+5511999999999',
      affiliate_id: '999',
      utm: { source: 'facebook', medium: 'cpc', campaign: 'campaign-123', content: 'ad-01' },
    });
  });

  it('normaliza nome, e-mail e telefone', () => {
    const result = leadSchema.parse({
      ...validLead(),
      name: '  João Silva  ',
      email: ' JOAO@Email.COM ',
      phone: '+55 (11) 99999-9999',
    });

    expect(result.name).toBe('João Silva');
    expect(result.email).toBe('joao@email.com');
    expect(result.phone).toBe('+5511999999999');
  });

  it.each(['name', 'email', 'phone', 'product', 'funnel'])('recusa sem o campo obrigatório %s', (field) => {
    const payload = validLead();
    delete payload[field];

    expect(invalidFields(payload)).toEqual([field]);
  });

  it.each(['joao', 'joao@', '@email.com'])('recusa o e-mail %s', (email) => {
    expect(invalidFields({ ...validLead(), email })).toEqual(['email']);
  });

  it.each(['11999999999', '+0511999999999', '+55119', '+55119999999999999', '+55 11 9999-ABCD'])(
    'recusa o telefone %s',
    (phone) => {
      expect(invalidFields({ ...validLead(), phone })).toEqual(['phone']);
    },
  );

  it('recusa nome com menos de 2 caracteres depois de tirar os espaços', () => {
    expect(invalidFields({ ...validLead(), name: '  J ' })).toEqual(['name']);
  });

  it('recusa tipo errado: affiliate_id numérico', () => {
    expect(invalidFields({ ...validLead(), affiliate_id: 999 })).toEqual(['affiliate_id']);
  });

  it('recusa utm que não é objeto e aponta o campo errado dentro da utm', () => {
    expect(invalidFields({ ...validLead(), utm: 'facebook' })).toEqual(['utm']);
    expect(invalidFields({ ...validLead(), utm: { source: 123 } })).toEqual(['utm.source']);
  });

  it('recusa corpo que não é objeto', () => {
    expect(invalidFields(null)).toEqual(['body']);
    expect(invalidFields([])).toEqual(['body']);
  });

  it('ignora campos fora da lista', () => {
    const result = leadSchema.parse({ ...validLead(), is_admin: true });

    expect(result).not.toHaveProperty('is_admin');
  });

  it('trata campo opcional vazio ou null como não enviado', () => {
    const result = leadSchema.parse({ ...validLead(), affiliate_id: '', campaign: '   ', utm: null });

    expect(result.affiliate_id).toBeUndefined();
    expect(result.utm).toBeUndefined();
  });

  it('usa source e campaign da utm quando não vêm no corpo', () => {
    const payload = validLead();
    delete payload.source;
    delete payload.campaign;

    const result = leadSchema.parse(payload);

    expect(result.source).toBe('facebook');
    expect(result.campaign).toBe('campaign-123');
  });

  it('prefere source e campaign do corpo aos da utm', () => {
    const result = leadSchema.parse({ ...validLead(), source: 'google', campaign: 'outra' });

    expect(result.source).toBe('google');
    expect(result.campaign).toBe('outra');
  });
});
