import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { LABEL, MAX_BODY, failureBody, fenceFor, issueTitle, planIssue } from '../lib/failure-issue.mjs';

const base = { runUrl: 'https://github.com/o/r/actions/runs/9', runNumber: 42, sha: 'abcdef1234567890' };

describe('failureBody', () => {
  it('traz o link da execução, o commit curto e o relatório', () => {
    const b = failureBody({ ...base, report: 'Job: Build Windows\nPasso: Empacotar\nErro: ENOSPC' });
    expect(b).toContain('[#42](https://github.com/o/r/actions/runs/9)');
    expect(b).toContain('`abcdef1`');
    expect(b).toContain('Nada foi publicado');
    expect(b).toContain('Erro: ENOSPC');
    expect(b).toMatch(/```text\nJob: Build Windows/);
  });

  it('corta um relatório enorme mantendo o FINAL (onde está o erro) e respeitando o limite', () => {
    const report = `INICIO\n${'x'.repeat(100_000)}\nERRO-FINAL`;
    const b = failureBody({ ...base, report });
    expect(b.length).toBeLessThanOrEqual(MAX_BODY + 200);
    expect(b).toContain('ERRO-FINAL');
    expect(b).not.toContain('INICIO');
    expect(b).toContain('relatório cortado');
  });

  it('a cerca de código nunca é fechada pelo próprio relatório', () => {
    const report = 'saída:\n```\nalgo\n```\nfim';
    expect(fenceFor(report)).toBe('````');
    const b = failureBody({ ...base, report });
    expect(b).toContain('````text\n');
    expect(b.trimEnd().endsWith('````')).toBe(true);
    expect(fenceFor('sem crases')).toBe('```');
  });

  it('funciona sem o commit', () => {
    expect(failureBody({ runUrl: base.runUrl, runNumber: 1, report: 'x' })).not.toContain('commit `');
  });
});

describe('planIssue e título', () => {
  it('comenta na issue aberta mais recente; sem nenhuma, abre uma nova', () => {
    expect(planIssue([17, 12])).toEqual({ action: 'comment', number: 17 });
    expect(planIssue([])).toEqual({ action: 'create' });
    expect(planIssue(undefined)).toEqual({ action: 'create' });
  });
  it('título e rótulo', () => {
    expect(issueTitle(42)).toBe('Falha na release (execução #42)');
    expect(LABEL).toBe('release-failure');
  });
});
