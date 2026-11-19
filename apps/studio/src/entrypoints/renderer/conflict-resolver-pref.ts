// Preferência "Novo resolvedor de conflitos" (desligada por padrão): a tela nova (MergeResolver.vue) convive com a atual até ser homologada na beta.
import { ref, watch } from 'vue';

const KEY = 'gitnexus.newConflictResolver';

/** Fica no localStorage (no diretório portátil do app), como as demais preferências. */
export const newConflictResolver = ref(localStorage.getItem(KEY) === '1');
watch(newConflictResolver, (v) => localStorage.setItem(KEY, v ? '1' : '0'));
