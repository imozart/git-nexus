// Validação do título de um PR (Conventional Commits). Núcleo PURO, sem dependências.
// Como o merge é feito com "merge commit", o título do PR vira a mensagem que o pipeline de release lê:
// um título fora do padrão gera versão errada (ou nenhuma) e entra em "Outras alterações" nas notas.

/** Tipos aceitos (os mesmos das seções das notas, mais `revert`). */
export const PR_TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'style', 'chore', 'revert'];

export const MAX_TITLE = 100;

const FORMAT = /^([A-Za-z]+)(?:\(([^()]*)\))?(!)?:( ?)(.*)$/;

/** Devolve `{ ok, errors }`; cada erro é uma frase pronta para mostrar ao autor do PR. */
export function checkPrTitle(title) {
  const errors = [];
  const t = (title ?? '').trim();
  if (!t) return { ok: false, errors: ['O título do PR está vazio.'] };

  const m = FORMAT.exec(t);
  if (!m) {
    errors.push('Use o formato "tipo(escopo): descrição" (o escopo é opcional), por exemplo "feat(log): painel de comandos do git".');
  } else {
    const [, type, scope, , space, description] = m;
    if (!PR_TYPES.includes(type)) errors.push(`Tipo "${type}" não é aceito. Use um destes: ${PR_TYPES.join(', ')} (em minúsculas).`);
    if (scope !== undefined && scope.trim() === '') errors.push('O escopo entre parênteses está vazio: remova os parênteses ou escreva o escopo.');
    if (scope !== undefined && /\s/.test(scope)) errors.push('O escopo não pode ter espaços (ex.: "feat(painel-log): …").');
    if (space !== ' ') errors.push('Falta um espaço depois dos dois-pontos ("tipo: descrição").');
    if (description.trim().length < 3) errors.push('A descrição depois dos dois-pontos está vazia ou curta demais.');
  }
  if (t.length > MAX_TITLE) errors.push(`O título tem ${t.length} caracteres; o máximo é ${MAX_TITLE}.`);
  return { ok: errors.length === 0, errors };
}
