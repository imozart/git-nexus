<script setup lang="ts">
// Faixa "operação em andamento" (merge, cherry-pick, revert ou rebase parados): Continuar (só depois de resolver os conflitos), Abortar (confirma e volta ao
// estado de antes) e, no rebase, Pular. Quem a usa recarrega a tela quando ela avisa `done`.
import { computed, ref } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import type { InProgressKind } from '@git-nexus/git-core/pure';
import type { RebaseResult } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { t, type MessageKey } from '../i18n';
import ConfirmDialog from './ConfirmDialog.vue';

type Kind = InProgressKind | 'rebase';
const props = defineProps<{ repoPath: string; kind: Kind; conflicts: number; step?: number; total?: number; /** Mostra "Abrir conflitos" (a faixa persistente das visões que não são a de conflitos). */ openConflicts?: boolean }>();
const emit = defineEmits<{ (e: 'done', message: string): void; (e: 'failed', message: string): void; (e: 'open'): void }>();

const busy = ref(false);
const asking = ref<'abort' | 'skip' | null>(null);

const TEXT: Record<InProgressKind, MessageKey> = { merge: 'rv.opMerge', 'cherry-pick': 'rv.opCherryPick', revert: 'rv.opRevert' };
const ABORT_TITLE: Record<Kind, MessageKey> = { merge: 'rv.opAbortTitleMerge', 'cherry-pick': 'rv.opAbortTitleCherry', revert: 'rv.opAbortTitleRevert', rebase: 'ops.abortRebaseTitle' };
/** "Merge em andamento.", "Rebase 3 de 7" … */
const title = computed(() => (props.kind === 'rebase' ? t('ops.rebaseStep', { step: props.step ?? 0, total: props.total ?? 0 }) : t(TEXT[props.kind])));
const blocked = computed(() => props.conflicts > 0);

async function run(action: 'continue' | 'abort' | 'skip'): Promise<void> {
  busy.value = true;
  asking.value = null;
  try {
    if (props.kind === 'rebase') {
      const r: RebaseResult = await (action === 'continue' ? api.continueRebase : action === 'skip' ? api.skipRebase : api.abortRebase)(props.repoPath);
      emit('done', r.message); // parou de novo (conflitos no passo seguinte) também é um desfecho: a tela recarrega e mostra o que falta
      return;
    }
    const r = await (action === 'continue' ? api.continueOperation : api.abortOperation)(props.repoPath);
    if (r.ok) emit('done', r.message);
    else emit('failed', r.message);
  } catch (e) {
    emit('failed', errMsg(e));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="opb" role="status" data-testid="op-banner" :data-kind="kind">
    <span class="opb__msg">⇅ {{ title }}{{ conflicts ? t(kind === 'rebase' ? 'rv.rebaseConflicts' : 'rv.opConflicts', { n: conflicts }) : '' }}</span>
    <GnButton v-if="openConflicts && conflicts" size="sm" tone="warn" data-testid="op-open" @click="emit('open')">{{ t('ops.openConflicts') }}</GnButton>
    <GnButton size="sm" variant="primary" tone="success" :disabled="blocked || busy" :title="blocked ? t('rv.opContinueNeedsResolve') : ''" data-testid="op-continue" @click="run('continue')">
      {{ t('rv.opContinue') }}
    </GnButton>
    <GnButton v-if="kind === 'rebase'" size="sm" :disabled="busy" data-testid="op-skip" @click="asking = 'skip'">{{ t('ops.skip') }}</GnButton>
    <GnButton size="sm" tone="danger" :disabled="busy" data-testid="op-abort" @click="asking = 'abort'">{{ t('rv.opAbort') }}</GnButton>
    <ConfirmDialog v-if="asking === 'abort'" :title="t(ABORT_TITLE[kind])" :lines="[t('rv.opAbortBody')]" :confirm-label="t('rv.opAbort')" danger @confirm="run('abort')" @cancel="asking = null" />
    <ConfirmDialog v-if="asking === 'skip'" :title="t('ops.skipTitle')" :lines="[t('ops.skipBody')]" :confirm-label="t('ops.skip')" danger @confirm="run('skip')" @cancel="asking = null" />
  </div>
</template>

<style scoped lang="scss">
.opb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 7px 14px;
  background: rgba(224, 169, 59, 0.14);
  border-bottom: 1px solid var(--gn-warn);
  color: var(--gn-warn);
  &__msg { flex: 1 1 220px; }
}
</style>
