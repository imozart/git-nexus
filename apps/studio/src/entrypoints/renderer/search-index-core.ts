// Índice de busca (fase 10 da #233): as contas da interface (sem Vue, para testar).

/** "agora há pouco", "há 3 minutos", "há 2 horas", "há 4 dias": a idade do índice no idioma da interface. */
export function ageText(then: number, now: number, locale: string): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (s < 45) return rtf.format(0, 'second');
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), 'minute');
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86_400), 'day');
}
