<script setup lang="ts">
// Faixa "operação em andamento" (merge, cherry-pick ou revert parados): Continuar (só depois de resolver os conflitos) e Abortar (confirma e volta ao
// estado de antes). Quem a usa recarrega a tela quando ela avisa `done`. O rebase tem o painel próprio.
import { computed, ref } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import type { InProgressKind } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { t, type MessageKey } from '../i18n';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps<{ repoPath: string; kind: InProgressKind; conflicts: number }>();
const emit = defineEmits<{ (e: 'done', message: string): void; (e: 'failed', message: string): void }>();

const busy = ref(false);
const asking = ref(false);

const TEXT: Record<InProgressKind, MessageKey> = { merge: 'rv.opMerge', 'cherry-pick': 'rv.opCherryPick', revert: 'rv.opRevert' };
const ABORT_TITLE: Record<InProgressKind, MessageKey> = { merge: 'rv.opAbortTitleMerge', 'cherry-pick': 'rv.opAbortTitleCherry', revert: 'rv.opAbortTitleRevert' };
const blocked = computed(() => props.conflicts > 0);

async function run(action: 'continue' | 'abort'): Promise<void> {
  busy.value = true;
  asking.value = false;
  try {
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
  <div class="opb" role="status" data-testid="op-banner">
    <span class="opb__msg">⇅ {{ t(TEXT[kind]) }}{{ conflicts ? t('rv.opConflicts', { n: conflicts }) : '' }}</span>
    <GnButton size="sm" variant="primary" tone="success" :disabled="blocked || busy" :title="blocked ? t('rv.opContinueNeedsResolve') : ''" data-testid="op-continue" @click="run('continue')">
      {{ t('rv.opContinue') }}
    </GnButton>
    <GnButton size="sm" tone="danger" :disabled="busy" data-testid="op-abort" @click="asking = true">{{ t('rv.opAbort') }}</GnButton>
    <ConfirmDialog v-if="asking" :title="t(ABORT_TITLE[kind])" :lines="[t('rv.opAbortBody')]" :confirm-label="t('rv.opAbort')" danger @confirm="run('abort')" @cancel="asking = false" />
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
