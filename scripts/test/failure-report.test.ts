import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { buildReport, cleanLog, excerpt } from '../failure-report.mjs';

describe('failure-report', () => {
  it('remove cores ANSI, carimbo de data e marcadores de grupo', () => {
    const lines = cleanLog('2026-11-13T10:00:00.1234567Z \x1b[31m⨯ falhou\x1b[0m\n2026-11-13T10:00:01Z ##[group]Run x\nok');
    expect(lines).toEqual(['⨯ falhou', 'ok']);
  });

  it('o trecho traz as linhas de erro e o final do log, separados por […]', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `linha ${i}`);
    lines[50] = '⨯ failed to build AppImage';
    const text = excerpt(lines, { errors: 5, tail: 3 });
    expect(text).toContain('⨯ failed to build AppImage');
    expect(text).toContain('linha 49'); // contexto anterior
    expect(text).toContain('linha 199');
    expect(text).toContain('[…]');
    expect(text).not.toContain('linha 120');
  });

  it('o relatório lista job, passo, commit, link e jobs cancelados', () => {
    const report = buildReport({
      run: {
        name: 'Release',
        run_number: 7,
        event: 'push',
        head_branch: 'main',
        head_sha: 'abcdef1234567',
        head_commit: { message: 'fix: algo\n\ncorpo' },
        html_url: 'https://github.com/o/r/actions/runs/1',
        repository: { full_name: 'o/r' },
      },
      jobs: [
        { id: 1, name: 'Build Linux x64', conclusion: 'failure', html_url: 'https://j/1', steps: [{ name: 'Empacotar', conclusion: 'failure' }] },
        { id: 2, name: 'Build Windows x64', conclusion: 'cancelled', steps: [] },
        { id: 3, name: 'Calcular versão', conclusion: 'success', steps: [] },
      ],
      logs: { 1: '2026-11-13T10:00:00Z ⨯ failed to build AppImage error=x' },
    });
    expect(report).toContain('Jobs com falha (1)');
    expect(report).toContain('Build Linux x64');
    expect(report).toContain('Passo que falhou: Empacotar');
    expect(report).toContain('abcdef1 fix: algo');
    expect(report).toContain('failed to build AppImage');
    expect(report).toContain('cancelados em consequência (1): Build Windows x64');
    expect(report).not.toContain('Calcular versão');
  });
});
