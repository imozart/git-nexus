// Conflitos que não são "linha contra linha" (apagado, binário, modo, submódulo, ponteiro do LFS): o que a tela mostra e que escolhas oferece.
// Tudo aqui é puro (sem Vue nem IPC), para testar sem abrir a tela.
import { MODE_EXEC, MODE_FILE, MODE_SUBMODULE, MODE_SYMLINK, type ConflictKind, type ConflictSide, type MergeConflictBlock } from '@git-nexus/git-core/pure';

/** Tipos que a tela de escolha resolve (os de texto vão para o resolvedor linha a linha). */
export const isChoiceKind = (k: ConflictKind | undefined): boolean => k !== undefined && k !== 'text' && k !== 'both-added';

export type SideName = 'mine' | 'theirs';
/** Estágio do índice de cada lado: no merge "mine" é o estágio 2; no rebase o Git inverte (a "ours" é o branch de destino). */
export type Stage = 'ours' | 'theirs';

export interface ChoiceSide {
  side: SideName;
  stage: Stage;
  /** O que aquele lado guarda; `undefined` = o lado não tem o arquivo (apagou ou nunca teve). */
  info?: ConflictSide;
  /** Texto da versão (só em "apagado × alterado" e quando é texto pequeno). */
  text: string;
}

export interface ChoiceOption {
  /** Lado cuja versão fica. */
  side: SideName;
  stage: Stage;
  /** O que acontece com o arquivo: ficar com o conteúdo daquele lado ou ser removido. */
  effect: 'keep' | 'remove';
}

export interface ChoiceView {
  kind: ConflictKind;
  mine: ChoiceSide;
  theirs: ChoiceSide;
  base?: ConflictSide;
  /** Em "apagado": quem apagou (e, por consequência, quem manteve). */
  deletedBy?: SideName;
  /** O caminho só existe de um lado e não tem base (rastro de renomeação/movimento para nomes diferentes). */
  oneSide: boolean;
  /** A versão mantida é idêntica à da base (o arquivo só foi apagado ou movido do outro lado, ninguém mexeu no conteúdo). */
  keptUnchanged: boolean;
  options: ChoiceOption[];
}

export function choiceView(block: MergeConflictBlock, rebase: boolean): ChoiceView {
  const kind = block.kind ?? 'text';
  const stageOf = (side: SideName): Stage => ((side === 'mine') !== rebase ? 'ours' : 'theirs');
  const make = (side: SideName): ChoiceSide => {
    const stage = stageOf(side);
    return { side, stage, info: block.sides?.[stage], text: stage === 'ours' ? block.ours : block.theirs };
  };
  const mine = make('mine');
  const theirs = make('theirs');
  const base = block.sides?.base;
  const deletedBy: SideName | undefined = kind === 'deleted' ? (!mine.info ? 'mine' : !theirs.info ? 'theirs' : undefined) : undefined;
  const kept = deletedBy === 'mine' ? theirs : deletedBy === 'theirs' ? mine : undefined;
  const options: ChoiceOption[] =
    kind === 'both-deleted'
      ? [{ side: 'mine', stage: mine.stage, effect: 'remove' }]
      : kind === 'deleted'
        ? [mine, theirs].map((s) => ({ side: s.side, stage: s.stage, effect: s.info ? 'keep' : 'remove' }) as ChoiceOption)
        : [mine, theirs].map((s) => ({ side: s.side, stage: s.stage, effect: 'keep' }) as ChoiceOption);
  return { kind, mine, theirs, base, deletedBy, oneSide: kind === 'deleted' && !base, keptUnchanged: !!kept?.info && !!base && kept.info.sha === base.sha && kept.info.mode === base.mode, options };
}

export type ModeKind = 'file' | 'exec' | 'link' | 'submodule' | 'other';

export function modeKind(mode: string): ModeKind {
  if (mode === MODE_FILE) return 'file';
  if (mode === MODE_EXEC) return 'exec';
  if (mode === MODE_SYMLINK) return 'link';
  if (mode === MODE_SUBMODULE) return 'submodule';
  return 'other';
}

/** Tamanho legível ("1,5 KB"); `undefined` para o que não tem tamanho. */
export function formatSize(bytes: number | undefined, locale = 'pt-BR'): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toLocaleString(locale, { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[u]}`;
}

/** Os primeiros 7 caracteres de um commit/blob. */
export const shortSha = (sha: string): string => sha.slice(0, 7);

/** Texto da versão mantida limitado a algumas linhas (a prévia de "apagado × alterado"). */
export function previewLines(text: string, max = 40): { lines: string[]; more: number } {
  const all = text.replace(/\r\n/g, '\n').split('\n');
  if (all.at(-1) === '') all.pop();
  return { lines: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/** Arquivo de imagem pela extensão (as mesmas que o núcleo sabe entregar como prévia). */
export const isImagePath = (path: string): boolean => /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(path);

/** Chave do texto curto que a lista de arquivos mostra para o tipo do conflito. */
export function kindShortKey(block: MergeConflictBlock): 'mc.short.deleted' | 'mc.short.oneSide' | 'mc.short.bothDeleted' | 'mc.short.binary' | 'mc.short.lfs' | 'mc.short.mode' | 'mc.short.submodule' {
  switch (block.kind) {
    case 'deleted':
      return block.sides?.base ? 'mc.short.deleted' : 'mc.short.oneSide';
    case 'both-deleted':
      return 'mc.short.bothDeleted';
    case 'lfs':
      return 'mc.short.lfs';
    case 'mode':
      return 'mc.short.mode';
    case 'submodule':
      return 'mc.short.submodule';
    default:
      return 'mc.short.binary';
  }
}
