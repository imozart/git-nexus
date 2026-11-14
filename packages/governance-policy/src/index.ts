import type { CommitPolicy, ConventionalCommitInput, ConventionalCommitType, SecretsConfig } from '@git-nexus/git-core/pure';

export type { CommitPolicy, SecretsConfig };

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
  ticketFromBranch: true,
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
  else if (policy.types?.length && !policy.types.includes(input.type))
    errors.push(`O tipo "${input.type}" não é permitido neste repositório (use: ${policy.types.join(', ')}).`);

  if (policy.scopeRequired && !scope) errors.push('O escopo é obrigatório.');
  else if (scope && !SCOPE_RE.test(scope)) errors.push('Escopo inválido (use letras, números, ".", "_", "-" ou "/").');
  else if (scope && policy.scopes?.length && !policy.scopes.includes(scope))
    errors.push(`Escopo "${scope}" não permitido neste repositório (use: ${policy.scopes.join(', ')}).`);

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

// ---------------------------------------------------------------------------------------
// Política do time: .gitnexus.json versionado no repositório
// ---------------------------------------------------------------------------------------

export const REPO_CONFIG_FILE = '.gitnexus.json';

export const DEFAULT_SECRETS: SecretsConfig = { mode: 'warn', ignorePaths: [], maxFileSizeMb: 5 };

export interface ParsedRepoConfig {
  commit: Partial<CommitPolicy>;
  secrets: SecretsConfig;
  errors: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Lê e valida o texto de um `.gitnexus.json`. Nunca lança: campos inválidos são ignorados e
 * descritos em `errors`, para o app mostrar o problema sem travar o repositório.
 */
export function parseRepoConfig(text: string): ParsedRepoConfig {
  const out: ParsedRepoConfig = { commit: {}, secrets: { ...DEFAULT_SECRETS, ignorePaths: [] }, errors: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    out.errors.push(`${REPO_CONFIG_FILE}: JSON inválido (${(e as Error).message}).`);
    return out;
  }
  if (!isObj(raw)) {
    out.errors.push(`${REPO_CONFIG_FILE}: o conteúdo deve ser um objeto JSON.`);
    return out;
  }

  const c = raw.commit;
  if (c !== undefined) {
    if (!isObj(c)) out.errors.push('"commit" deve ser um objeto.');
    else {
      const p = out.commit;
      if (c.maxSubjectLength !== undefined) {
        if (Number.isInteger(c.maxSubjectLength) && (c.maxSubjectLength as number) >= 10 && (c.maxSubjectLength as number) <= 200)
          p.maxSubjectLength = c.maxSubjectLength as number;
        else out.errors.push('"commit.maxSubjectLength" deve ser um inteiro entre 10 e 200.');
      }
      for (const k of ['scopeRequired', 'ticketRequired', 'ticketFromBranch'] as const) {
        if (c[k] === undefined) continue;
        if (typeof c[k] === 'boolean') p[k] = c[k] as boolean;
        else out.errors.push(`"commit.${k}" deve ser true ou false.`);
      }
      if (c.ticketPattern !== undefined) {
        if (typeof c.ticketPattern === 'string' && compileTicketPattern(c.ticketPattern)) p.ticketPattern = c.ticketPattern;
        else out.errors.push('"commit.ticketPattern" deve ser uma regex válida.');
      }
      if (c.types !== undefined) {
        if (!isStrArr(c.types) || c.types.length === 0) out.errors.push('"commit.types" deve ser uma lista não vazia.');
        else {
          const known = c.types.filter((t): t is ConventionalCommitType => (COMMIT_TYPES as readonly string[]).includes(t));
          const unknown = c.types.filter((t) => !(COMMIT_TYPES as readonly string[]).includes(t));
          if (unknown.length) out.errors.push(`"commit.types" tem tipos desconhecidos: ${unknown.join(', ')}.`);
          if (known.length) p.types = known;
        }
      }
      if (c.scopes !== undefined) {
        if (!isStrArr(c.scopes) || c.scopes.some((s) => !SCOPE_RE.test(s))) out.errors.push('"commit.scopes" deve ser uma lista de escopos válidos.');
        else if (c.scopes.length) p.scopes = c.scopes;
      }
    }
  }

  const s = raw.secrets;
  if (s !== undefined) {
    if (!isObj(s)) out.errors.push('"secrets" deve ser um objeto.');
    else {
      if (s.mode !== undefined) {
        if (s.mode === 'warn' || s.mode === 'block' || s.mode === 'off') out.secrets.mode = s.mode;
        else out.errors.push('"secrets.mode" deve ser "warn", "block" ou "off".');
      }
      if (s.ignorePaths !== undefined) {
        if (isStrArr(s.ignorePaths)) out.secrets.ignorePaths = s.ignorePaths;
        else out.errors.push('"secrets.ignorePaths" deve ser uma lista de globs.');
      }
      if (s.maxFileSizeMb !== undefined) {
        if (typeof s.maxFileSizeMb === 'number' && s.maxFileSizeMb >= 0) out.secrets.maxFileSizeMb = s.maxFileSizeMb;
        else out.errors.push('"secrets.maxFileSizeMb" deve ser um número maior ou igual a 0.');
      }
    }
  }

  for (const k of Object.keys(raw)) if (!['commit', 'secrets', '$schema'].includes(k)) out.errors.push(`Campo desconhecido: "${k}".`);
  return out;
}

/** Política efetiva: a do time (repositório) sobrepõe a configuração local do usuário. */
export function mergePolicy(local: CommitPolicy, team: Partial<CommitPolicy>): CommitPolicy {
  return { ...local, ...team };
}

const BRANCH_TYPE: Record<string, ConventionalCommitType> = {
  feat: 'feat',
  feature: 'feat',
  fix: 'fix',
  bugfix: 'fix',
  hotfix: 'fix',
  docs: 'docs',
  doc: 'docs',
  style: 'style',
  refactor: 'refactor',
  perf: 'perf',
  test: 'test',
  tests: 'test',
  build: 'build',
  ci: 'ci',
  chore: 'chore',
};

/** Tipo de commit sugerido pelo prefixo da branch (`feature/x` → feat). `null` se não reconhecer. */
export function typeFromBranch(branch: string): ConventionalCommitType | null {
  const prefix = branch.split('/')[0]?.toLowerCase() ?? '';
  return branch.includes('/') ? (BRANCH_TYPE[prefix] ?? null) : null;
}

/**
 * Extrai o ticket do nome da branch usando o padrão da política (ex.: `feat/proj-123-login` → `PROJ-123`).
 * Aceita minúsculas na branch e devolve no formato que o padrão exige. `null` se não achar.
 */
export function ticketFromBranch(branch: string, pattern: string): string | null {
  const full = compileTicketPattern(pattern);
  if (!full) return null;
  let search: RegExp;
  try {
    search = new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
  for (const m of branch.matchAll(search)) {
    for (const cand of [m[0], m[0].toUpperCase(), m[0].toLowerCase()]) if (full.test(cand)) return cand;
  }
  return null;
}
