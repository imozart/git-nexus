<script setup lang="ts">
// A faixa de operação PERSISTENTE da aba do repositório: aparece em todas as visões (Staging, Grafo, Ferramentas, Conflitos) enquanto há merge, rebase,
// cherry-pick ou revert parado, com o tipo, o progresso, "Abrir conflitos", Continuar, Abortar e (no rebase) Pular. Quem publica o estado é a tela do
// repositório (`ws.ops`); aqui só se mostra e se age. É uma região nomeada; o desfecho ("Merge concluído", "Todos os conflitos foram resolvidos") é anunciado.
import { computed, ref, watch } from 'vue';
import type { RepositoryMeta } from '@git-nexus/git-core/pure';
import { t } from '../i18n';
import { useWorkspaceStore, type RepoViewKind } from '../stores/workspace';
import OperationBanner from './OperationBanner.vue';

const props = defineProps<{ repo: RepositoryMeta; view: RepoViewKind }>();
const ws = useWorkspaceStore();

const op = computed(() => ws.ops[props.repo.id]);
const kind = computed(() => op.value?.kind ?? null);
const conflicts = computed(() => op.value?.conflicts ?? 0);
/** Na visão de conflitos, sem conflito sobrando, quem oferece "Continuar" é o painel "tudo resolvido" da própria visão (um só botão na tela). */
const shown = computed(() => !!kind.value && !(props.view === 'merge' && conflicts.value === 0 && kind.value !== 'rebase'));

/** O aviso do desfecho (região viva) e o erro (alerta). */
const note = ref('');
const failure = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
function say(msg: string): void {
  note.value = msg;
  clearTimeout(timer);
  timer = setTimeout(() => (note.value = ''), 6000);
}

function onDone(message: string): void {
  failure.value = '';
  say(message);
  ws.bump(props.repo.id); // as telas do repositório recarregam (e a tela do repositório publica o novo estado)
}

// o último conflito foi resolvido mas a operação continua: avisa (e a faixa habilita "Continuar")
watch(conflicts, (n, before) => {
  if (n === 0 && before > 0 && kind.value) say(t('ops.allResolved'));
});

// a operação acabou (continuou, abortou, ou foi resolvida fora do app) com a visão "Conflitos" na tela: volta para a visão de antes
watch(
  () => ws.hasConflictView(props.repo.id),
  (has) => {
    if (has) return;
    const tab = ws.tabs.find((x) => x.repo?.id === props.repo.id);
    if (tab?.view === 'merge') ws.open(tab.prev && tab.prev !== 'merge' ? tab.prev : 'repo', props.repo);
  },
);
</script>

<template>
  <div class="opbar">
    <section v-if="shown && kind" :aria-label="t('ops.label')" data-testid="op-bar">
      <OperationBanner
        :repo-path="repo.path"
        :kind="kind"
        :conflicts="conflicts"
        :step="op?.step"
        :total="op?.total"
        :open-conflicts="view !== 'merge'"
        @open="ws.open('merge', repo)"
        @done="onDone"
        @failed="failure = $event"
      />
    </section>
    <div v-if="failure" class="opbar__err" role="alert">{{ failure }}</div>
    <div class="opbar__note" role="status" data-testid="op-note">{{ note }}</div>
  </div>
</template>

<style scoped lang="scss">
.opbar {
  &__err { padding: 6px 14px; color: var(--gn-danger); background: rgba(224, 85, 85, 0.1); border-bottom: 1px solid var(--gn-danger); }
  &__note { padding: 0 14px; font-size: 12px; color: var(--gn-muted); &:empty { display: none; } }
}
</style>
