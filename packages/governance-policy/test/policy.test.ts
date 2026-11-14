import { describe, expect, it } from 'vitest';
import type { ConventionalCommitInput } from '@git-nexus/git-core/pure';
import {
  DEFAULT_POLICY,
  formatCommitMessage,
  mergePolicy,
  parseRepoConfig,
  ticketFromBranch,
  typeFromBranch,
  validateCommitMessage,
} from '../src/index.js';

const ok: ConventionalCommitInput = { type: 'feat', scope: 'auth', ticketNumber: 'ABC-123', subject: 'adiciona login' };

describe('validateCommitMessage', () => {
  it('aceita mensagem conforme', () => {
    expect(validateCommitMessage(ok)).toEqual({ isValid: true, errors: [] });
  });

  it('exige título e respeita o limite de 50 caracteres', () => {
    expect(validateCommitMessage({ ...ok, subject: '' }).isValid).toBe(false);
    expect(validateCommitMessage({ ...ok, subject: 'x'.repeat(50) }).isValid).toBe(true);
    expect(validateCommitMessage({ ...ok, subject: 'x'.repeat(51) }).isValid).toBe(false);
  });

  it('valida o ticket como correspondência total', () => {
    expect(validateCommitMessage({ ...ok, ticketNumber: 'abc-1' }).isValid).toBe(false);
    expect(validateCommitMessage({ ...ok, ticketNumber: 'xABC-1' }).isValid).toBe(false);
    expect(validateCommitMessage({ ...ok, ticketNumber: 'ABC-1x' }).isValid).toBe(false);
  });

  it('ticket e escopo seguem a política', () => {
    const { ticketNumber: _t, ...semTicket } = ok;
    expect(validateCommitMessage(semTicket).isValid).toBe(false);
    expect(validateCommitMessage(semTicket, { ...DEFAULT_POLICY, ticketRequired: false }).isValid).toBe(true);
    const { scope: _s, ...semEscopo } = ok;
    expect(validateCommitMessage(semEscopo, { ...DEFAULT_POLICY, scopeRequired: true }).isValid).toBe(false);
  });

  it('não explode com regex inválida na política', () => {
    const r = validateCommitMessage(ok, { ...DEFAULT_POLICY, ticketPattern: '[' });
    expect(r.isValid).toBe(false);
  });

  it('rejeita tipo desconhecido', () => {
    expect(validateCommitMessage({ ...ok, type: 'oops' as never }).isValid).toBe(false);
  });
});

describe('formatCommitMessage', () => {
  it('formata cabeçalho, corpo e rodapé', () => {
    const msg = formatCommitMessage({ ...ok, body: 'detalhe', breakingChanges: 'remove /v1' });
    expect(msg).toBe('feat(auth)!: adiciona login\n\ndetalhe\n\nBREAKING CHANGE: remove /v1\nRefs: ABC-123\n');
  });

  it('omite partes vazias', () => {
    expect(formatCommitMessage({ type: 'fix', subject: 'corrige' })).toBe('fix: corrige\n');
  });
});

describe('política do time (.gitnexus.json)', () => {
  const base = { type: 'feat', subject: 'algo', ticketNumber: 'PROJ-1' } as const;

  it('restringe tipos e escopos', () => {
    const p = { ...DEFAULT_POLICY, types: ['feat', 'fix'], scopes: ['auth', 'ui'] } as typeof DEFAULT_POLICY;
    expect(validateCommitMessage({ ...base, scope: 'auth' }, p).isValid).toBe(true);
    expect(validateCommitMessage({ ...base, type: 'chore' }, p).errors[0]).toContain('não é permitido');
    expect(validateCommitMessage({ ...base, scope: 'db' }, p).errors[0]).toContain('não permitido');
  });

  it('parseRepoConfig lê o arquivo e relata problemas sem lançar', () => {
    const ok = parseRepoConfig(
      JSON.stringify({
        commit: { types: ['feat', 'fix'], scopes: ['auth'], ticketPattern: 'PROJ-\\d+', ticketFromBranch: true, maxSubjectLength: 72 },
        secrets: { mode: 'block', ignorePaths: ['x/**'] },
      }),
    );
    expect(ok.errors).toEqual([]);
    expect(ok.commit).toMatchObject({ types: ['feat', 'fix'], scopes: ['auth'], ticketFromBranch: true, maxSubjectLength: 72 });
    expect(ok.secrets).toMatchObject({ mode: 'block', ignorePaths: ['x/**'], maxFileSizeMb: 5 });

    expect(parseRepoConfig('{ invalido').errors[0]).toContain('JSON inválido');
    const bad = parseRepoConfig(
      JSON.stringify({ commit: { types: ['feat', 'xyz'], ticketPattern: '(', maxSubjectLength: 5 }, secrets: { mode: 'x' }, extra: 1 }),
    );
    const msgs = bad.errors.join('|');
    expect(msgs).toMatch(/desconhecidos: xyz/);
    expect(msgs).toMatch(/ticketPattern/);
    expect(msgs).toMatch(/maxSubjectLength/);
    expect(msgs).toMatch(/secrets\.mode/);
    expect(msgs).toMatch(/Campo desconhecido: "extra"/);
    expect(bad.commit.types).toEqual(['feat']); // o válido é mantido
  });

  it('mergePolicy: a política do time sobrepõe a local', () => {
    expect(mergePolicy(DEFAULT_POLICY, { maxSubjectLength: 72, ticketRequired: false })).toMatchObject({
      maxSubjectLength: 72,
      ticketRequired: false,
      scopeRequired: false,
    });
  });

  it('ticket e tipo a partir da branch', () => {
    expect(ticketFromBranch('feat/PROJ-123-login', 'PROJ-\\d+')).toBe('PROJ-123');
    expect(ticketFromBranch('feature/proj-45_ajuste', '[A-Z]+-\\d+')).toBe('PROJ-45');
    expect(ticketFromBranch('main', '[A-Z]+-\\d+')).toBeNull();
    expect(ticketFromBranch('x/ABC-1', '(')).toBeNull();
    expect(typeFromBranch('feature/PROJ-1-x')).toBe('feat');
    expect(typeFromBranch('hotfix/crash')).toBe('fix');
    expect(typeFromBranch('main')).toBeNull();
    expect(typeFromBranch('minha/coisa')).toBeNull();
  });
});
