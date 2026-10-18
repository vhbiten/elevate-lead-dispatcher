// "Hoje" e os filtros de período seguem o fuso do negócio, e não o UTC (docs/spec.md, seção 11):
// às 22h em São Paulo já é o dia seguinte em UTC, e o lead não pode mudar de dia por isso.
export function appTimezone(): string {
  return process.env.APP_TIMEZONE ?? 'America/Sao_Paulo';
}

// Data (AAAA-MM-DD) de um instante, no fuso informado.
export function dateIn(timeZone: string, instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

// Instante em que o dia começa (00h00) no fuso. Ex.: 2026-10-18 em São Paulo começa em 2026-10-18T03:00:00Z.
// Usa a diferença do fuso à meia-noite UTC daquele dia; em fusos com horário de verão, o dia da troca
// pode sair com uma hora de diferença (o Brasil não tem horário de verão desde 2019).
export function startOfDay(date: string, timeZone: string): Date {
  const midnightUtc = new Date(`${date}T00:00:00Z`);
  return new Date(midnightUtc.getTime() - offsetMs(midnightUtc, timeZone));
}

export function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

// Quanto o relógio do fuso está à frente do UTC num instante (São Paulo: -3 h).
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return wallClockAsUtc - instant.getTime();
}
