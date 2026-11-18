// Núcleo puro do GnDialog (sem Vue e sem DOM, para testar): seletor dos elementos focáveis, circulação do foco e pilha de diálogos abertos.

/** Elementos que recebem foco pelo teclado. O componente ainda filtra os visíveis (por exemplo com getClientRects().length). */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Índice do próximo elemento ao apertar Tab (ou Shift+Tab) numa lista de `count` focáveis, circulando nas pontas.
 * `current` é o índice de quem tem o foco, ou -1 quando o foco está fora da lista: Tab vai ao primeiro e Shift+Tab ao último.
 * Lista vazia devolve -1 (quem chama leva o foco para a própria caixa).
 */
export function nextFocusIndex(count: number, current: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return shift ? count - 1 : 0;
  return shift ? (current - 1 + count) % count : (current + 1) % count;
}

export interface DialogStack {
  /** Põe o diálogo no topo (se já estiver na pilha, vai para o topo). */
  push(id: number): void;
  /** Tira o diálogo de qualquer posição (um diálogo do meio pode fechar antes do topo). */
  remove(id: number): void;
  /** Só o diálogo do topo trata Esc e Tab. */
  isTop(id: number): boolean;
  size(): number;
}

/** Pilha de diálogos abertos: o do topo é o único que reage ao teclado quando há diálogo aberto dentro de outro. */
export function createDialogStack(): DialogStack {
  let ids: number[] = [];
  return {
    push(id) {
      ids = ids.filter((x) => x !== id);
      ids.push(id);
    },
    remove(id) {
      ids = ids.filter((x) => x !== id);
    },
    isTop: (id) => ids.length > 0 && ids[ids.length - 1] === id,
    size: () => ids.length,
  };
}

let seq = 0;
/** Identificador de cada GnDialog montado (a pilha guarda números). */
export const newDialogId = (): number => ++seq;

/** A pilha única do app: todo GnDialog montado entra aqui. */
export const dialogStack = createDialogStack();

/** Há algum diálogo aberto? O app usa para ignorar os atalhos globais enquanto houver um. */
export function isDialogOpen(): boolean {
  return dialogStack.size() > 0;
}
