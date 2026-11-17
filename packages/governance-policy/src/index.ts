import { getMessageLocale, type CommitPolicy, type ConventionalCommitInput, type ConventionalCommitType, type MessageLocale, type SecretsConfig } from '@git-nexus/git-core/pure';

/** Texto no idioma pedido (padrão: o idioma atual do processo). */
const tl = (loc: MessageLocale, pt: string, en: string): string => (loc === 'en' ? en : pt);

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
  locale: MessageLocale = getMessageLocale(),
): ValidationResult {
  const tm = (pt: string, en: string) => tl(locale, pt, en);
  const errors: string[] = [];
  const subject = input.subject?.trim() ?? '';
  const scope = input.scope?.trim() ?? '';
  const ticket = input.ticketNumber?.trim() ?? '';

  if (!COMMIT_TYPES.includes(input.type)) errors.push(tm(`Tipo inválido: "${input.type}".`, `Invalid type: "${input.type}".`));
  else if (policy.types?.length && !policy.types.includes(input.type))
    errors.push(tm(`O tipo "${input.type}" não é permitido neste repositório (use: ${policy.types.join(', ')}).`, `The type "${input.type}" is not allowed in this repository (use: ${policy.types.join(', ')}).`));

  if (policy.scopeRequired && !scope) errors.push(tm('O escopo é obrigatório.', 'The scope is required.'));
  else if (scope && !SCOPE_RE.test(scope)) errors.push(tm('Escopo inválido (use letras, números, ".", "_", "-" ou "/").', 'Invalid scope (use letters, numbers, ".", "_", "-" or "/").'));
  else if (scope && policy.scopes?.length && !policy.scopes.includes(scope))
    errors.push(tm(`Escopo "${scope}" não permitido neste repositório (use: ${policy.scopes.join(', ')}).`, `Scope "${scope}" is not allowed in this repository (use: ${policy.scopes.join(', ')}).`));

  if (!subject) errors.push(tm('O título é obrigatório.', 'The title is required.'));
  else {
    if (subject.length > policy.maxSubjectLength)
      errors.push(tm(`O título excede ${policy.maxSubjectLength} caracteres (${subject.length}).`, `The title exceeds ${policy.maxSubjectLength} characters (${subject.length}).`));
    if (subject.endsWith('.')) errors.push(tm('O título não deve terminar com ponto.', 'The title must not end with a period.'));
  }

  if (!ticket) {
    if (policy.ticketRequired) errors.push(tm('O número do ticket é obrigatório.', 'The ticket number is required.'));
  } else {
    const re = compileTicketPattern(policy.ticketPattern);
    if (!re) errors.push(tm(`A regex de ticket da política é inválida: ${policy.ticketPattern}`, `The policy ticket regex is invalid: ${policy.ticketPattern}`));
    else if (!re.test(ticket)) errors.push(tm(`Ticket fora do padrão (${policy.ticketPattern}), ex.: ABC-123.`, `Ticket does not match the pattern (${policy.ticketPattern}), e.g. ABC-123.`));
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

/**
 * Inverso de `formatCommitMessage`: lê uma mensagem existente (a do último commit, para emendar) e devolve os campos do formulário.
 * Mensagem que não segue `tipo(escopo): título` vira só título (a primeira linha) + corpo, com `parsed: false`: o linter diz o que corrigir.
 */
export function parseCommitMessage(message: string): { input: ConventionalCommitInput; parsed: boolean } {
  const text = message.replace(/\r\n/g, '\n').trim();
  const [header = '', ...rest] = text.split('\n');
  const m = /^([A-Za-z]+)(?:\(([^()]*)\))?(!)?:\s*(.*)$/.exec(header);
  const type = m?.[1]?.toLowerCase() as ConventionalCommitType | undefined;
  const restText = rest.join('\n').replace(/^\n+/, '');
  if (!m || !type || !COMMIT_TYPES.includes(type)) {
    return { input: { type: 'feat', subject: header.trim(), ...(restText.trim() ? { body: restText.trim() } : {}) }, parsed: false };
  }
  // rodapé: o último parágrafo, se TODAS as linhas forem "BREAKING CHANGE: …" ou "Refs: …"
  const paragraphs = restText.split(/\n{2,}/).filter((p) => p.trim() !== '');
  let breaking: string | undefined;
  let ticket: string | undefined;
  const last = paragraphs[paragraphs.length - 1];
  const footerLines = last?.split('\n') ?? [];
  if (last && footerLines.every((l) => /^(BREAKING[ -]CHANGE|Refs?):\s*\S/i.test(l))) {
    for (const l of footerLines) {
      const f = /^(BREAKING[ -]CHANGE|Refs?):\s*(.*)$/i.exec(l)!;
      if (/^breaking/i.test(f[1]!)) breaking = f[2]!.trim();
      else ticket = f[2]!.trim();
    }
    paragraphs.pop();
  }
  if (m[3] && !breaking) breaking = 'Mudança incompatível.'; // o "!" do título sem descrição: mantém o "!" ao reformatar
  const body = paragraphs.join('\n\n').trim();
  return {
    input: {
      type,
      ...(m[2]?.trim() ? { scope: m[2].trim() } : {}),
      ...(ticket ? { ticketNumber: ticket } : {}),
      subject: m[4]!.trim(),
      ...(body ? { body } : {}),
      ...(breaking ? { breakingChanges: breaking } : {}),
    },
    parsed: true,
  };
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
  const tm = (pt: string, en: string) => tl(getMessageLocale(), pt, en);
  const out: ParsedRepoConfig = { commit: {}, secrets: { ...DEFAULT_SECRETS, ignorePaths: [] }, errors: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    out.errors.push(tm(`${REPO_CONFIG_FILE}: JSON inválido (${(e as Error).message}).`, `${REPO_CONFIG_FILE}: invalid JSON (${(e as Error).message}).`));
    return out;
  }
  if (!isObj(raw)) {
    out.errors.push(tm(`${REPO_CONFIG_FILE}: o conteúdo deve ser um objeto JSON.`, `${REPO_CONFIG_FILE}: the content must be a JSON object.`));
    return out;
  }

  const c = raw.commit;
  if (c !== undefined) {
    if (!isObj(c)) out.errors.push(tm('"commit" deve ser um objeto.', '"commit" must be an object.'));
    else {
      const p = out.commit;
      if (c.maxSubjectLength !== undefined) {
        if (Number.isInteger(c.maxSubjectLength) && (c.maxSubjectLength as number) >= 10 && (c.maxSubjectLength as number) <= 200)
          p.maxSubjectLength = c.maxSubjectLength as number;
        else out.errors.push(tm('"commit.maxSubjectLength" deve ser um inteiro entre 10 e 200.', '"commit.maxSubjectLength" must be an integer between 10 and 200.'));
      }
      for (const k of ['scopeRequired', 'ticketRequired', 'ticketFromBranch'] as const) {
        if (c[k] === undefined) continue;
        if (typeof c[k] === 'boolean') p[k] = c[k] as boolean;
        else out.errors.push(tm(`"commit.${k}" deve ser true ou false.`, `"commit.${k}" must be true or false.`));
      }
      if (c.ticketPattern !== undefined) {
        if (typeof c.ticketPattern === 'string' && compileTicketPattern(c.ticketPattern)) p.ticketPattern = c.ticketPattern;
        else out.errors.push(tm('"commit.ticketPattern" deve ser uma regex válida.', '"commit.ticketPattern" must be a valid regex.'));
      }
      if (c.types !== undefined) {
        if (!isStrArr(c.types) || c.types.length === 0) out.errors.push(tm('"commit.types" deve ser uma lista não vazia.', '"commit.types" must be a non-empty list.'));
        else {
          const known = c.types.filter((t): t is ConventionalCommitType => (COMMIT_TYPES as readonly string[]).includes(t));
          const unknown = c.types.filter((t) => !(COMMIT_TYPES as readonly string[]).includes(t));
          if (unknown.length) out.errors.push(tm(`"commit.types" tem tipos desconhecidos: ${unknown.join(', ')}.`, `"commit.types" has unknown types: ${unknown.join(', ')}.`));
          if (known.length) p.types = known;
        }
      }
      if (c.scopes !== undefined) {
        if (!isStrArr(c.scopes) || c.scopes.some((s) => !SCOPE_RE.test(s))) out.errors.push(tm('"commit.scopes" deve ser uma lista de escopos válidos.', '"commit.scopes" must be a list of valid scopes.'));
        else if (c.scopes.length) p.scopes = c.scopes;
      }
    }
  }

  const s = raw.secrets;
  if (s !== undefined) {
    if (!isObj(s)) out.errors.push(tm('"secrets" deve ser um objeto.', '"secrets" must be an object.'));
    else {
      if (s.mode !== undefined) {
        if (s.mode === 'warn' || s.mode === 'block' || s.mode === 'off') out.secrets.mode = s.mode;
        else out.errors.push(tm('"secrets.mode" deve ser "warn", "block" ou "off".', '"secrets.mode" must be "warn", "block" or "off".'));
      }
      if (s.ignorePaths !== undefined) {
        if (isStrArr(s.ignorePaths)) out.secrets.ignorePaths = s.ignorePaths;
        else out.errors.push(tm('"secrets.ignorePaths" deve ser uma lista de globs.', '"secrets.ignorePaths" must be a list of globs.'));
      }
      if (s.maxFileSizeMb !== undefined) {
        if (typeof s.maxFileSizeMb === 'number' && s.maxFileSizeMb >= 0) out.secrets.maxFileSizeMb = s.maxFileSizeMb;
        else out.errors.push(tm('"secrets.maxFileSizeMb" deve ser um número maior ou igual a 0.', '"secrets.maxFileSizeMb" must be a number greater than or equal to 0.'));
      }
    }
  }

  for (const k of Object.keys(raw)) if (!['commit', 'secrets', '$schema'].includes(k)) out.errors.push(tm(`Campo desconhecido: "${k}".`, `Unknown field: "${k}".`));
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
