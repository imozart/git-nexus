import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ConflictSide, MergeConflictBlock } from './types/ipc.js';
import { hasConflictMarkers } from './conflict-markers.js';
import { classifyConflict, looksBinary, MODE_EXEC, MODE_FILE, MODE_SUBMODULE, mergedMode, parseUnmerged, type IndexEntry, type KindInput } from './conflict-kinds.js';
import { parseLfsPointer } from './lfs.js';
import { operationInProgress } from './operations.js';
import { runGit } from './runner.js';
import { tm } from './messages.js';
import { decodeText, detectEncodingOf, encodeText } from './encoding.js';

async function stage(repoPath: string, n: 1 | 2 | 3, file: string): Promise<Buffer | null> {
  // Estágios do índice: 1 = base (ancestral), 2 = ours, 3 = theirs. Ausente => add/delete.
  const r = await runGit(repoPath, ['show', `:${n}:${file}`], { check: false });
  return r.code === 0 ? r.bytes : null;
}

/**
 * Arquivos em conflito, lidos direto do índice (entradas "unmerged"). É bem mais rápido que `git diff --diff-filter=U`,
 * que compara o conteúdo de todos os arquivos alterados: em um repositório com milhares de alterações, isso custava
 * ~3x o próprio `git status` a cada atualização da tela.
 */
export async function unmergedFiles(repoPath: string): Promise<string[]> {
  const r = await runGit(repoPath, ['ls-files', '--unmerged', '-z'], { check: false });
  // cada registro: "<modo> <sha> <estágio>\t<caminho>"
  return [...new Set(r.stdout.split('\0').filter(Boolean).map((rec) => rec.slice(rec.indexOf('\t') + 1)))];
}

/** Os estágios do índice agrupados por caminho. */
async function indexEntries(repoPath: string, file?: string): Promise<Map<string, KindInput>> {
  const r = await runGit(repoPath, ['ls-files', '--unmerged', '-z', ...(file ? ['--', file] : [])], { check: false });
  const map = new Map<string, KindInput>();
  for (const e of parseUnmerged(r.stdout)) {
    const k = map.get(e.path) ?? {};
    k[e.stage === 1 ? 'base' : e.stage === 2 ? 'ours' : 'theirs'] = e;
    map.set(e.path, k);
  }
  return map;
}

/** Referência do lado "ours" (HEAD) e do lado "theirs" (o commit que está sendo aplicado), para a data de cada versão. */
async function sideRefs(repoPath: string): Promise<{ ours: string; theirs?: string }> {
  for (const ref of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD']) {
    const r = await runGit(repoPath, ['rev-parse', '-q', '--verify', ref], { check: false });
    if (r.code === 0) return { ours: 'HEAD', theirs: ref };
  }
  return { ours: 'HEAD' };
}

/** Tamanho acima do qual a versão de um arquivo apagado × alterado não é carregada para mostrar o texto. */
const PREVIEW_MAX_BYTES = 1_000_000;

async function describeSide(repoPath: string, file: string, e: IndexEntry, buf: Buffer | null, ref: string | undefined): Promise<ConflictSide> {
  const side: ConflictSide = { mode: e.mode, sha: e.sha };
  if (e.mode === MODE_SUBMODULE) {
    // o commit no repositório do submódulo (se ele estiver baixado): data e assunto, para reconhecer a versão
    const r = await runGit(join(repoPath, file), ['log', '-1', '--format=%cI%x09%s', e.sha], { check: false }).catch(() => null);
    const [date, ...subject] = (r?.code === 0 ? r.stdout.trim() : '').split('\t');
    if (date) side.date = date;
    if (subject.length) side.detail = subject.join('\t');
    return side;
  }
  if (buf) {
    side.size = buf.length;
    const lfs = buf.length < 1024 ? parseLfsPointer(buf.toString('utf8')) : null;
    if (lfs) {
      side.size = lfs.size;
      side.detail = `sha256:${lfs.oid}`;
    }
  }
  if (ref) {
    const r = await runGit(repoPath, ['log', '-1', '--format=%cI', ref, '--', file], { check: false });
    if (r.code === 0 && r.stdout.trim()) side.date = r.stdout.trim();
  }
  return side;
}

export async function getMergeConflicts(repoPath: string): Promise<MergeConflictBlock[]> {
  const entries = await indexEntries(repoPath);
  let refs: Promise<{ ours: string; theirs?: string }> | undefined;
  const blocks = await Promise.all(
    [...entries].map(async ([filePath, k]): Promise<MergeConflictBlock> => {
      const gitlink = [k.base, k.ours, k.theirs].some((e) => e?.mode === MODE_SUBMODULE);
      const [baseB, oursB, theirsB, workingB] = await Promise.all([
        k.base && !gitlink ? stage(repoPath, 1, filePath) : null,
        k.ours && !gitlink ? stage(repoPath, 2, filePath) : null,
        k.theirs && !gitlink ? stage(repoPath, 3, filePath) : null,
        gitlink ? undefined : readFile(join(repoPath, filePath)).catch(() => undefined),
      ]);
      const kind = classifyConflict(k, {
        binary: () => [baseB, oursB, theirsB].some((b) => b && looksBinary(b)),
        lfs: () => [oursB, theirsB].some((b) => b && b.length < 1024 && parseLfsPointer(b.toString('utf8'))),
      });
      if (kind === 'text' || kind === 'both-added') {
        // uma codificação para as quatro versões (a do arquivo em conflito), para o merge não misturar UTF-8 com Windows-1252
        const enc = detectEncodingOf(workingB, oursB, theirsB, baseB);
        const text = (b: Buffer | null | undefined) => (b ? decodeText(b, enc).text : '');
        const working = workingB ? decodeText(workingB, enc).text : undefined;
        return {
          filePath,
          kind,
          ours: text(oursB),
          base: text(baseB),
          theirs: text(theirsB),
          workingContent: working,
          hasUnresolvedMarkers: working === undefined ? true : hasConflictMarkers(working),
        };
      }
      // os demais tipos não têm "linha contra linha": a tela mostra o que cada lado guarda (modo, tamanho, data) e pede uma escolha
      refs ??= sideRefs(repoPath);
      const r = await refs;
      const sides: NonNullable<MergeConflictBlock['sides']> = {};
      if (k.base) sides.base = await describeSide(repoPath, filePath, k.base, baseB, undefined);
      if (k.ours) sides.ours = await describeSide(repoPath, filePath, k.ours, oursB, r.ours);
      if (k.theirs) sides.theirs = await describeSide(repoPath, filePath, k.theirs, theirsB, r.theirs);
      // "apagado × alterado": mostra o texto da versão que sobrou (e a base, para ver o que mudou), se for texto pequeno
      const showText = (b: Buffer | null) => (kind === 'deleted' && b && b.length <= PREVIEW_MAX_BYTES && !looksBinary(b) ? decodeText(b, detectEncodingOf(b)).text : '');
      return {
        filePath,
        kind,
        sides,
        ours: showText(oursB),
        base: showText(baseB),
        theirs: showText(theirsB),
        hasUnresolvedMarkers: true,
      };
    }),
  );
  // renomeado/movido nos dois lados para nomes diferentes: o Git deixa o nome antigo (só a base) e um nome novo de cada lado, todos em conflito
  for (const gone of blocks.filter((b) => b.kind === 'both-deleted')) {
    const origin = entries.get(gone.filePath)?.base?.sha;
    const heirs = blocks.filter((b) => {
      if (b === gone || b.kind !== 'deleted') return false;
      const e = entries.get(b.filePath)!;
      return !e.base && (e.ours ?? e.theirs)?.sha === origin;
    });
    if (heirs.length) {
      gone.relatedPaths = heirs.map((b) => b.filePath);
      for (const h of heirs) h.relatedPaths = [gone.filePath, ...heirs.filter((o) => o !== h).map((o) => o.filePath)];
    }
  }
  return blocks;
}

/** Impede escrita fora do repositório (ex.: `../../x`). */
export function resolveInsideRepo(repoPath: string, filePath: string): string {
  const abs = isAbsolute(filePath) ? resolve(filePath) : resolve(repoPath, filePath);
  const rel = relative(resolve(repoPath), abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(tm('Caminho fora do repositório.', 'Path outside the repository.'));
  return abs;
}

/** Grava o conteúdo resolvido e faz `git add`. Recusa se ainda houver marcadores. */
export async function resolveConflictFile(
  repoPath: string,
  filePath: string,
  mergedContent: string,
): Promise<boolean> {
  if (hasConflictMarkers(mergedContent)) return false;
  const abs = resolveInsideRepo(repoPath, filePath);
  // regrava na codificação do arquivo em conflito (e recusa, sem tocar nele, se um caractere não existir nela)
  const [current, ours, theirs, k] = await Promise.all([
    readFile(abs).catch(() => null),
    stage(repoPath, 2, filePath),
    stage(repoPath, 3, filePath),
    indexEntries(repoPath, filePath),
  ]);
  await writeFile(abs, encodeText(mergedContent, detectEncodingOf(current, ours, theirs)));
  await runGit(repoPath, ['add', '--', filePath]);
  // se um lado só tornou o arquivo executável (ou deixou de ser), o resultado leva essa mudança: sem isso, no Windows (sem bit de execução
  // no disco), o `git add` gravaria o modo comum e a mudança do lado que mexeu só no modo se perderia
  const e = k.get(filePath);
  if (e?.ours && e.theirs) {
    const want = mergedMode(e.base?.mode, e.ours.mode, e.theirs.mode);
    if (want === MODE_EXEC || want === MODE_FILE) {
      const have = (await runGit(repoPath, ['ls-files', '-s', '--', filePath], { check: false })).stdout.split(' ')[0];
      if ((have === MODE_EXEC || have === MODE_FILE) && have !== want) await runGit(repoPath, ['update-index', want === MODE_EXEC ? '--chmod=+x' : '--chmod=-x', '--', filePath]);
    }
  }
  return true;
}

/**
 * Resolve o arquivo ficando com um dos lados, do jeito que o índice o guarda: o conteúdo e o modo daquele lado ou, se aquele lado
 * não tem o arquivo (apagou ou nunca teve), a remoção. Para submódulo só o índice muda (a pasta do submódulo não é tocada).
 * Devolve false se o arquivo não está em conflito.
 */
export async function resolveConflictSide(repoPath: string, filePath: string, side: 'ours' | 'theirs'): Promise<boolean> {
  const abs = resolveInsideRepo(repoPath, filePath);
  const k = (await indexEntries(repoPath, filePath)).get(filePath);
  if (!k) return false;
  const chosen = side === 'ours' ? k.ours : k.theirs;
  const gitlink = [k.base, k.ours, k.theirs].some((e) => e?.mode === MODE_SUBMODULE);
  if (!chosen) {
    // aquele lado apagou: remove do índice; no disco só o arquivo (nunca a pasta de um submódulo)
    await runGit(repoPath, ['rm', '--cached', '-f', '-q', '--', filePath], { check: false });
    if ((await indexEntries(repoPath, filePath)).has(filePath)) await runGit(repoPath, ['update-index', '--force-remove', '--', filePath]);
    if (!gitlink) await rm(abs, { force: true });
    return true;
  }
  if (!gitlink) await runGit(repoPath, ['checkout', side === 'ours' ? '--ours' : '--theirs', '--', filePath]);
  await runGit(repoPath, ['update-index', '--add', '--cacheinfo', `${chosen.mode},${chosen.sha},${filePath}`]);
  return true;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Imagem de um lado do conflito como `data:` URL (só pela extensão conhecida e até 5 MB); `null` se não for imagem ou o lado não existir. */
export async function getConflictImage(repoPath: string, filePath: string, side: 'base' | 'ours' | 'theirs'): Promise<string | null> {
  resolveInsideRepo(repoPath, filePath);
  const mime = IMAGE_MIME[filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()];
  if (!mime) return null;
  const spec = `:${side === 'base' ? 1 : side === 'ours' ? 2 : 3}:${filePath}`;
  const size = await runGit(repoPath, ['cat-file', '-s', spec], { check: false });
  if (size.code !== 0 || Number(size.stdout.trim()) > IMAGE_MAX_BYTES) return null;
  const blob = await runGit(repoPath, ['cat-file', 'blob', spec], { check: false });
  return blob.code === 0 && blob.bytes.length ? `data:${mime};base64,${blob.bytes.toString('base64')}` : null;
}

/**
 * Arquivos de conflito já marcados como resolvidos (`git add`) cuja informação de desfazer o Git ainda guarda no índice
 * (`ls-files --resolve-undo`): dá para reabri-los enquanto a operação (merge, rebase, cherry-pick) não terminou.
 */
export async function resolvedConflictFiles(repoPath: string): Promise<string[]> {
  // o Git guarda a informação de desfazer no índice mesmo depois do commit: fora de uma operação em andamento não há o que reabrir
  if (!(await operationInProgress(repoPath))) return [];
  const r = await runGit(repoPath, ['ls-files', '--resolve-undo', '-z'], { check: false });
  if (r.code !== 0) return [];
  // cada registro: "<modo> <sha> <estágio>\t<caminho>"
  return [...new Set(r.stdout.split('\0').filter(Boolean).map((rec) => rec.slice(rec.indexOf('\t') + 1)))];
}

/**
 * Recria o conflito original de um arquivo já resolvido (`git checkout -m`), com os marcadores no disco. Devolve false se não havia o que reabrir.
 * `checkout -m` não serve quando um lado apagou o arquivo (o Git responde "does not have all necessary versions"): aí só se restauram as
 * entradas do índice (`update-index --unresolve`) e o arquivo no disco volta a ser a versão do lado que o mantém.
 */
export async function reopenConflict(repoPath: string, filePath: string): Promise<boolean> {
  resolveInsideRepo(repoPath, filePath);
  if (!(await resolvedConflictFiles(repoPath)).includes(filePath)) return false;
  const r = await runGit(repoPath, ['checkout', '-m', '--', filePath], { check: false });
  if (r.code === 0 && (await unmergedFiles(repoPath)).includes(filePath)) return true;
  if ((await runGit(repoPath, ['update-index', '--unresolve', '--', filePath], { check: false })).code !== 0) return false;
  const k = (await indexEntries(repoPath, filePath)).get(filePath);
  if (!k) return false;
  if (!existsSync(resolveInsideRepo(repoPath, filePath)) && !(k.ours?.mode === MODE_SUBMODULE || k.theirs?.mode === MODE_SUBMODULE)) {
    await runGit(repoPath, ['checkout', k.ours ? '--ours' : '--theirs', '--', filePath], { check: false });
  }
  return true;
}
