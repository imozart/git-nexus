import { describe, expect, it } from 'vitest';
import type { ConventionalCommitInput } from '@git-nexus/git-core/pure';
import { DEFAULT_POLICY, formatCommitMessage, validateCommitMessage } from '../src/index.js';

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
