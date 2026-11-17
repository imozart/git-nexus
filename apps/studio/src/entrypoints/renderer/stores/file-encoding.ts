import { defineStore } from 'pinia';
import { ref } from 'vue';
import { isFileEncoding, type EncodingChoice, type FileEncodingInfo } from '@git-nexus/git-core/pure';

const KEY = 'gitnexus.fileEncodings';
/** Quantas escolhas ficam guardadas (as mais antigas saem primeiro). */
const MAX_REMEMBERED = 500;

/** O arquivo aberto no diff de um repositório, com a codificação em uso (é o que o rodapé do app mostra). */
export interface OpenFileEncoding extends FileEncodingInfo {
  repoPath: string;
  path: string;
}

function load(): Record<string, EncodingChoice> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => isFileEncoding(v))) as Record<string, EncodingChoice>;
  } catch {
    return {};
  }
}

const keyOf = (repoPath: string, file: string) => `${repoPath}\n${file}`;

/**
 * Codificação dos arquivos. Duas coisas separadas:
 *  - `choices`: o que a pessoa escolheu para cada arquivo (lembrado entre sessões; ausente = automática, a detectada);
 *  - `open`: o arquivo que está aberto no diff de cada repositório (o rodapé mostra o do repositório da aba ativa).
 * Escolher uma codificação só muda COMO o arquivo é lido e regravado: o arquivo em disco não é convertido.
 */
export const useFileEncodingStore = defineStore('fileEncoding', () => {
  const choices = ref<Record<string, EncodingChoice>>(load());
  const open = ref<Record<string, OpenFileEncoding | null>>({});

  function choiceFor(repoPath: string, file: string): EncodingChoice {
    return choices.value[keyOf(repoPath, file)] ?? 'auto';
  }

  function choose(repoPath: string, file: string, choice: EncodingChoice): void {
    const next = { ...choices.value };
    const k = keyOf(repoPath, file);
    delete next[k]; // reinsere no fim: o mais recente é o último a sair
    if (choice !== 'auto') next[k] = choice;
    const keys = Object.keys(next);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete next[old];
    choices.value = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
  }

  function setOpen(repoId: string, info: OpenFileEncoding | null): void {
    open.value[repoId] = info;
  }

  return { choices, open, choiceFor, choose, setOpen };
});
