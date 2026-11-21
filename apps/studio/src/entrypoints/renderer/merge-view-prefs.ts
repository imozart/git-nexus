// Como o usuário prefere ver o resolvedor de conflitos (lembrado por usuário, no localStorage como as demais preferências):
// a visão lado a lado, ignorar diferença de espaços e mostrar caracteres invisíveis.
import { ref, watch } from 'vue';

const flag = (key: string) => {
  const r = ref(localStorage.getItem(key) === '1');
  watch(r, (v) => localStorage.setItem(key, v ? '1' : '0'));
  return r;
};

/** Três colunas (minha | resultado | a que chega) em vez do arquivo com os cartões. */
export const mergeSideBySide = flag('gitnexus.mergeView.sideBySide');
/** Espaços não contam na comparação: reclassifica os conflitos que só diferem neles. */
export const mergeIgnoreSpace = flag('gitnexus.mergeView.ignoreSpace');
/** Desenha espaço, tab e fim de linha. */
export const mergeShowInvisibles = flag('gitnexus.mergeView.invisibles');
