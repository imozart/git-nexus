import { describe, expect, it } from 'vitest';
import type { GitCommandEvent } from '@git-nexus/git-core/pure';
import { MAX_ENTRIES, appendEvents, exportText, filterEntries, isError, isMine, maskPaths, parseFilter, parseMax, repoKey } from '../src/entrypoints/renderer/gitlog-core';

const ev = (id: number, o: Partial<GitCommandEvent> = {}): GitCommandEvent => ({ id, origin: 'user', repoPath: 'C:\\r', command: `git x${id}`, readOnly: true, startedAt: id, durationMs: 1, code: 0, ...o });

describe('log do git (store)', () => {
  it('repoKey ignora barras, maiúsculas e barra final', () => {
    expect(repoKey('C:\\Dev\\Proj\\')).toBe(repoKey('c:/dev/proj'));
    expect(repoKey('/home/u/a')).not.toBe(repoKey('/home/u/b'));
  });

  it('appendEvents mantém a ordem e descarta os mais antigos além do limite', () => {
    expect(appendEvents([ev(1)], [ev(2), ev(3)]).map((e) => e.id)).toEqual([1, 2, 3]);
    const full = Array.from({ length: MAX_ENTRIES }, (_, i) => ev(i));
    const out = appendEvents(full, [ev(1000)]);
    expect(out).toHaveLength(MAX_ENTRIES);
    expect(out[0]!.id).toBe(1);
    expect(out[out.length - 1]!.id).toBe(1000);
  });

  it('o limite é configurável (e só valores da lista valem; o resto volta a 500)', () => {
    expect(appendEvents(Array.from({ length: 5 }, (_, i) => ev(i)), [ev(9)], 3).map((e) => e.id)).toEqual([3, 4, 9]);
    expect(parseMax('1000')).toBe(1000);
    for (const bad of [null, undefined, '', 'abc', '7', '-1', '999999']) expect(parseMax(bad)).toBe(500);
  });

  it('não altera a lista original', () => {
    const base = [ev(1)];
    appendEvents(base, [ev(2)]);
    expect(base).toHaveLength(1);
  });
});

describe('o que é "minha ação"', () => {
  it('é minha se a pessoa pediu, ou se o comando altera o repositório (mesmo em segundo plano, como um fetch)', () => {
    expect(isMine(ev(1, { origin: 'user', readOnly: true }))).toBe(true);
    expect(isMine(ev(2, { origin: 'background', readOnly: true }))).toBe(false);
    expect(isMine(ev(3, { origin: 'background', readOnly: false }))).toBe(true);
  });

  it('erro = falhou E é meu; sonda de segundo plano que "falha" e comando cancelado não são erro', () => {
    expect(isError(ev(1, { code: 1, readOnly: false, origin: 'user' }))).toBe(true);
    expect(isError(ev(2, { code: 128, origin: 'user', output: 'fatal: x' }))).toBe(true);
    expect(isError(ev(3, { code: 1, origin: 'background', readOnly: true }))).toBe(false); // git config --get de uma chave que não existe
    expect(isError(ev(4, { code: 1, origin: 'background', readOnly: false }))).toBe(true); // um fetch automático que falhou importa
    expect(isError(ev(5, { code: -1, origin: 'user' }))).toBe(false); // cancelado
    expect(isError(ev(6, { code: -1, origin: 'user', output: 'spawn git ENOENT' }))).toBe(true); // o git nem iniciou
    expect(isError(ev(7, { code: 0 }))).toBe(false);
  });
});

describe('filtros e busca', () => {
  const list = [
    ev(1, { origin: 'background', command: 'git status --porcelain=v2' }),
    ev(2, { origin: 'user', command: 'git commit -m "feat: x"', readOnly: false }),
    ev(3, { origin: 'background', command: 'git fetch --all --prune', readOnly: false }),
    ev(4, { origin: 'user', command: 'git diff -- a.txt' }),
    ev(5, { origin: 'user', command: 'git add nao-existe.txt', readOnly: false, code: 128, output: "fatal: pathspec 'nao-existe.txt' did not match any files" }),
    ev(6, { origin: 'background', command: 'git config --get x', code: 1 }),
  ];
  const ids = (f: Parameters<typeof filterEntries>[1], q = '') => filterEntries(list, f, q).map((e) => e.id);

  it('"Minhas ações": o que a pessoa pediu e o que altera o repositório; as consultas de segundo plano ficam de fora', () => expect(ids('mine')).toEqual([2, 3, 4, 5]));
  it('"Tudo" mostra tudo', () => expect(ids('all')).toEqual([1, 2, 3, 4, 5, 6]));
  it('"Só leitura" mostra as consultas, de quem for', () => expect(ids('read')).toEqual([1, 4, 6]));
  it('"Erros" mostra só o que falhou e importa', () => expect(ids('errors')).toEqual([5]));
  it('a busca olha o comando e a saída, sem diferenciar maiúsculas, e vale junto com o filtro', () => {
    expect(ids('all', 'FETCH')).toEqual([3]);
    expect(ids('all', 'pathspec')).toEqual([5]);
    expect(ids('mine', 'status')).toEqual([]);
    expect(ids('mine', '  ')).toEqual([2, 3, 4, 5]);
  });
  it('o filtro lembrado só aceita valores da lista (o resto volta a "Minhas ações")', () => {
    expect(parseFilter('errors')).toBe('errors');
    for (const bad of [null, undefined, '', '1', 'tudo']) expect(parseFilter(bad)).toBe('mine');
  });
});

describe('exportar e mascarar', () => {
  it('mascara a pasta do repositório e a pasta pessoal, em Windows, Linux e macOS, com barra de qualquer lado', () => {
    expect(maskPaths("git -C 'C:\\Users\\Maria\\proj' log", 'C:\\Users\\Maria\\proj')).toBe("git -C '<repo>' log");
    expect(maskPaths('erro em C:/Users/Maria/Documents/x.txt e D:\\users\\joao\\y')).toBe('erro em ~/Documents/x.txt e ~\\y');
    expect(maskPaths('/home/maria/p/.git e /Users/joao/q', '/home/maria/p')).toBe('<repo>/.git e ~/q');
    expect(maskPaths('nada pessoal aqui: git status')).toBe('nada pessoal aqui: git status');
  });

  it('o texto exportado leva o cabeçalho, uma linha por comando (origem, resultado, duração) e a saída recuada; com máscara, sem caminhos pessoais', () => {
    const e = [
      ev(1, { origin: 'background', command: 'git status', startedAt: new Date(2026, 10, 26, 14, 5, 9).getTime(), durationMs: 12 }),
      ev(2, { code: 128, command: 'git add x', readOnly: false, output: 'fatal: a\nfatal: b' }),
    ];
    const txt = exportText(e, { version: '1.27.0' });
    expect(txt.split('\n').slice(0, 2)).toEqual(['# Log do Git do GitNexus 1.27.0', '# 2 comandos']);
    expect(txt).toContain('[2026-11-26 14:05:09] segundo plano ok 12ms  git status');
    expect(txt).toContain('usuário exit 128');
    expect(txt).toContain('    fatal: a\n    fatal: b');
    const masked = exportText([ev(3, { command: "git -C 'C:\\Users\\Maria\\proj' status" })], { mask: true, repoPath: 'C:\\Users\\Maria\\proj' });
    expect(masked).toContain("git -C '<repo>' status");
    expect(masked).not.toContain('Maria');
    expect(exportText([ev(4, { command: "git -C 'C:\\Users\\Maria\\proj' status" })])).toContain('Maria');
  });
});
