import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { forgetRecordedResolution, getMergeConflicts, getRerereState, recordResolutions, resolveConflictFile, runGit, setRerereEnabled } from '../src/index.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const g = (cwd: string, ...a: string[]) => runGit(cwd, a, { check: false });
const lines = (...l: string[]) => l.join('\n') + '\n';

/** Repositório com um merge em conflito (f.txt) e outro arquivo qualquer; `autocrlf` como no Windows (true) ou sem conversão (false). */
async function setup(autocrlf: 'true' | 'false'): Promise<string> {
  const r = mkdtempSync(join(tmpdir(), 'gitnexus-rr-'));
  dirs.push(r);
  await g(r, 'init', '-b', 'main');
  for (const [k, v] of [['user.email', 't@e.com'], ['user.name', 'T'], ['commit.gpgsign', 'false'], ['core.autocrlf', autocrlf]]) await g(r, 'config', k!, v!);
  const save = async (msg: string, content: string) => {
    writeFileSync(join(r, 'f.txt'), content);
    await g(r, 'add', '-A');
    await g(r, 'commit', '-m', msg);
  };
  await save('base', lines('a', 'b', 'c', 'd'));
  await g(r, 'checkout', '-b', 'outro');
  await save('origin', lines('a', 'b', 'C-da-origin', 'd'));
  await g(r, 'checkout', 'main');
  await save('main', lines('a', 'b', 'c-da-main', 'd'));
  return r;
}

/** Recomeça o merge do zero (o que um rebase repetido faz): o Git aplica a resolução gravada, se houver. */
async function again(r: string): Promise<void> {
  await g(r, 'merge', '--abort');
  await g(r, 'reset', '--hard');
  await g(r, 'merge', 'outro');
}

describe.each(['false', 'true'] as const)('rerere (autocrlf=%s)', (autocrlf) => {
  it('desligado por padrão; ligar e desligar mexe só na configuração do próprio repositório', async () => {
    const r = await setup(autocrlf);
    expect((await getRerereState(r)).local).toBe(false);
    expect(await setRerereEnabled(r, true)).toEqual({ enabled: true, local: true });
    expect((await g(r, 'config', '--local', 'rerere.enabled')).stdout.trim()).toBe('true');
    expect(await setRerereEnabled(r, false)).toEqual({ enabled: false, local: true });
  });

  it('o arquivo que o Git preencheu com a resolução gravada é reconhecido (com a data); o editado à mão não', async () => {
    const r = await setup(autocrlf);
    await setRerereEnabled(r, true);
    await g(r, 'merge', 'outro');
    // 1ª vez: resolvido pelo usuário e gravado
    expect(await resolveConflictFile(r, 'f.txt', lines('a', 'b', 'decidido', 'd'))).toBe(true);
    expect(await recordResolutions(r)).toEqual(['f.txt']);
    await again(r);
    const [block] = await getMergeConflicts(r);
    expect(block!.hasUnresolvedMarkers).toBe(false);
    expect(block!.rerere?.recordedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(block!.workingContent?.replace(/\r\n/g, '\n')).toBe(lines('a', 'b', 'decidido', 'd'));
    // o usuário mexe no arquivo depois do Git: já não é "a resolução gravada"
    writeFileSync(join(r, 'f.txt'), lines('a', 'b', 'mexi depois', 'd'));
    const [edited] = await getMergeConflicts(r);
    expect(edited!.hasUnresolvedMarkers).toBe(false);
    expect(edited!.rerere).toBeUndefined();
  });

  it('sem o rerere ligado, um arquivo sem marcador (editado à mão) nunca é tratado como resolução gravada', async () => {
    const r = await setup(autocrlf);
    await g(r, 'merge', 'outro');
    writeFileSync(join(r, 'f.txt'), lines('a', 'b', 'na mão', 'd'));
    const [block] = await getMergeConflicts(r);
    expect(block!.hasUnresolvedMarkers).toBe(false);
    expect(block!.rerere).toBeUndefined();
    expect(await recordResolutions(r)).toEqual([]); // desligado: nada é gravado
  });

  it('esquecer devolve o conflito original, e a resolução nova é a que o Git passa a aplicar', async () => {
    const r = await setup(autocrlf);
    await setRerereEnabled(r, true);
    await g(r, 'merge', 'outro');
    await resolveConflictFile(r, 'f.txt', lines('a', 'b', 'velha', 'd'));
    await recordResolutions(r);
    await again(r);
    expect((await getMergeConflicts(r))[0]!.rerere).toBeDefined();

    expect(await forgetRecordedResolution(r, 'f.txt')).toBe(true);
    const [back] = await getMergeConflicts(r);
    expect(back!.hasUnresolvedMarkers).toBe(true);
    expect(back!.rerere).toBeUndefined();
    expect(readFileSync(join(r, 'f.txt'), 'utf8')).toContain('<<<<<<<');
    expect(await forgetRecordedResolution(r, 'f.txt')).toBe(false); // nada mais a esquecer

    await resolveConflictFile(r, 'f.txt', lines('a', 'b', 'nova', 'd'));
    expect(await recordResolutions(r)).toEqual(['f.txt']);
    await again(r);
    const [replayed] = await getMergeConflicts(r);
    expect(replayed!.rerere).toBeDefined();
    expect(replayed!.workingContent?.replace(/\r\n/g, '\n')).toBe(lines('a', 'b', 'nova', 'd'));
  });

  it('caminho fora do repositório é recusado', async () => {
    const r = await setup(autocrlf);
    await expect(forgetRecordedResolution(r, '../fora.txt')).rejects.toThrow();
  });
});
