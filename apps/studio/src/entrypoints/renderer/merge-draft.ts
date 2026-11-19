// Rascunho das escolhas do resolvedor de conflitos, guardado no localStorage (ou seja, na pasta de dados do app, também no modo portátil).
// Chave: repositório + arquivo; dentro, a identidade das três versões (assinatura). Se o arquivo mudar por baixo, o rascunho é descartado com aviso.
import type { MergeChoices, MergeModel } from '@git-nexus/git-core/pure';
import { parseDraft, serializeDraft, type DraftLoad } from './merge-resolver-core';

const PREFIX = 'gitnexus.mergeDraft:';
const INDEX_KEY = 'gitnexus.mergeDraft.index';
/** Quantos rascunhos ficam guardados (os mais antigos saem primeiro): a pasta de dados não cresce sem fim. */
export const MAX_DRAFTS = 40;

export const draftKey = (repoId: string, file: string): string => `${PREFIX}${repoId}:${file}`;

function readIndex(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function loadDraft(key: string, sig: string, model: MergeModel): DraftLoad {
  try {
    return parseDraft(localStorage.getItem(key), sig, model);
  } catch {
    return { status: 'none' };
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
    localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((k) => k !== key)));
  } catch {
    /* sem armazenamento: o rascunho é só uma conveniência */
  }
}

/** Guarda (ou, sem nenhuma escolha, apaga) o rascunho. Falha de armazenamento nunca atrapalha a tela. */
export function saveDraft(key: string, sig: string, choices: MergeChoices): void {
  const raw = serializeDraft(sig, choices);
  if (raw === null) return clearDraft(key);
  try {
    localStorage.setItem(key, raw);
    const index = [key, ...readIndex().filter((k) => k !== key)];
    for (const old of index.splice(MAX_DRAFTS)) localStorage.removeItem(old);
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    /* cheio ou bloqueado: segue sem rascunho */
  }
}
