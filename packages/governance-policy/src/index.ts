import type { CommitPolicy, ConventionalCommitInput, ConventionalCommitType } from '@git-nexus/git-core/pure';

export type { CommitPolicy };

export const COMMIT_TYPES: readonly ConventionalCommitType[] = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
];

export const DEFAULT_POLICY: CommitPolicy = {
  maxSubjectLength: 50,
  scopeRequired: false,
  ticketRequired: true,
  ticketPattern: '[A-Z]+-\\d+',
};

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

const SCOPE_RE = /^[a-z0-9][a-z0-9._/-]*$/i;

/** Compila o padrão de ticket como correspondência total; `null` se a regex for inválida. */
export function compileTicketPattern(pattern: string): RegExp | null {
  try {
    return new RegExp(`^(?:${pattern})$`);
  } catch {
    return null;
  }
}

export function validateCommitMessage(
  input: ConventionalCommitInput,
  policy: CommitPolicy = DEFAULT_POLICY,
): ValidationResult {
  const errors: string[] = [];
  const subject = input.subject?.trim() ?? '';
  const scope = input.scope?.trim() ?? '';
  const ticket = input.ticketNumber?.trim() ?? '';

  if (!COMMIT_TYPES.includes(input.type)) errors.push(`Tipo inválido: "${input.type}".`);

  if (policy.scopeRequired && !scope) errors.push('O escopo é obrigatório.');
  else if (scope && !SCOPE_RE.test(scope)) errors.push('Escopo inválido (use letras, números, ".", "_", "-" ou "/").');

  if (!subject) errors.push('O título é obrigatório.');
  else {
    if (subject.length > policy.maxSubjectLength)
      errors.push(`O título excede ${policy.maxSubjectLength} caracteres (${subject.length}).`);
    if (subject.endsWith('.')) errors.push('O título não deve terminar com ponto.');
  }

  if (!ticket) {
    if (policy.ticketRequired) errors.push('O número do ticket é obrigatório.');
  } else {
    const re = compileTicketPattern(policy.ticketPattern);
    if (!re) errors.push(`A regex de ticket da política é inválida: ${policy.ticketPattern}`);
    else if (!re.test(ticket)) errors.push(`Ticket fora do padrão (${policy.ticketPattern}), ex.: ABC-123.`);
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Monta a mensagem final:
 *   type(scope)!: subject
 *
 *   body
 *
 *   BREAKING CHANGE: ...
 *   Refs: TICKET
 */
export function formatCommitMessage(input: ConventionalCommitInput): string {
  const scope = input.scope?.trim();
  const breaking = input.breakingChanges?.trim();
  const header = `${input.type}${scope ? `(${scope})` : ''}${breaking ? '!' : ''}: ${input.subject.trim()}`;

  const sections = [header];
  const body = input.body?.trim();
  if (body) sections.push(body);

  const footer: string[] = [];
  if (breaking) footer.push(`BREAKING CHANGE: ${breaking}`);
  const ticket = input.ticketNumber?.trim();
  if (ticket) footer.push(`Refs: ${ticket}`);
  if (footer.length) sections.push(footer.join('\n'));

  return sections.join('\n\n') + '\n';
}
