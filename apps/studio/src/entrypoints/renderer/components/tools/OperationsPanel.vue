<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import type { GitOperation, OperationKind, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { useWorkspaceStore } from '../../stores/workspace';
import { dateLocale, t } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog.vue';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const ops = ref<GitOperation[]>([]);
const loading = ref(false);
const error = ref('');
const done = ref('');
const confirm = ref<GitOperation | null>(null);

const ICON: Record<OperationKind, string> = {
  commit: '●', amend: '✎', checkout: '⎇', merge: '⑂', pull: '⇣', reset: '↶', rebase: '⇅', 'cherry-pick': '🍒', revert: '↺', other: '•',
};
type Tone = 'warn' | 'accent' | 'danger' | 'neutral' | 'success';
const TONE: Record<OperationKind, Tone> = {
  commit: 'accent', amend: 'accent', checkout: 'neutral', merge: 'success', pull: 'success', reset: 'warn', rebase: 'warn', 'cherry-pick': 'accent', revert: 'warn', other: 'neutral',
};

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    ops.value = await api.getOperations(props.repo.path, 80);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

/** Operações que seriam desfeitas junto (a escolhida e todas as mais novas). */
const affected = computed(() => {
  const i = ops.value.findIndex((o) => o.id === confirm.value?.id);
  return i < 0 ? [] : ops.value.slice(0, i + 1);
});

const explain = computed(() => {
  const k = confirm.value?.kind;
  if (k === 'commit' || k === 'amend') return t('ops.explainCommit');
  if (k === 'checkout') return t('ops.explainCheckout');
  return t('ops.explainOther');
});

async function run(): Promise<void> {
  const op = confirm.value;
  confirm.value = null;
  if (!op) return;
  error.value = '';
  done.value = '';
  try {
    const r = await api.undoOperation(props.repo.path, op.id);
    done.value = r.message;
    ws.bump(props.repo.id); // atualiza staging e grafo
  } catch (e) {
    error.value = errMsg(e);
  }
  await load();
}

const when = (s: number) => new Date(s * 1000).toLocaleString(dateLocale.value);
onMounted(load);
watch(() => ws.versions[props.repo.id], load);
</script>

<template>
  <div class="ops">
    <header class="ops__head">
      <div>
        <h2>{{ t('ops.title') }}</h2>
        <p class="muted">{{ t('ops.intro') }}</p>
      </div>
      <GnButton size="sm" :disabled="loading" @click="load">{{ t('rv.refresh') }}</GnButton>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="done" class="ok">✔ {{ done }}</p>
    <p v-if="!ops.length && !loading && !error" class="muted empty">{{ t('ops.empty') }}</p>

    <ol class="ops__list">
      <li v-for="(o, i) in ops" :key="o.id" class="op" :class="{ 'op--first': i === 0 }">
        <span class="op__icon">{{ ICON[o.kind] }}</span>
        <div class="op__main">
          <div class="op__sum">
            <GnBadge :tone="TONE[o.kind]">{{ o.kind }}</GnBadge>
            <span class="op__text" :title="o.summary">{{ o.summary }}</span>
          </div>
          <div class="muted op__meta">
            {{ when(o.date) }} · {{ o.shortHash }}<template v-if="o.prevHash"> ← {{ o.prevHash.slice(0, 7) }}</template>
          </div>
        </div>
        <GnButton
          size="sm"
          :variant="i === 0 ? 'primary' : 'ghost'"
          :disabled="!o.undoable"
          :title="o.undoable ? t('ops.undoTip') : o.undoReason"
          @click="confirm = o"
        >
          {{ i === 0 ? t('rv.undo') : t('ops.backBefore') }}
        </GnButton>
      </li>
    </ol>

    <ConfirmDialog
      v-if="confirm"
      :title="affected.length > 1 ? t('ops.confirmMany', { n: affected.length }) : t('ops.confirmOne')"
      :lines="[...affected.map((a) => `• ${a.summary}`), explain, t('ops.redoHint')]"
      :confirm-label="t('rv.undo')"
      danger
      @confirm="run"
      @cancel="confirm = null"
    />
  </div>
</template>

<style scoped lang="scss">
.ops {
  padding: 16px 22px;
  max-width: 980px;
  &__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; h2 { margin: 0 0 4px; font-size: 16px; } p { margin: 0; max-width: 720px; } }
  &__list { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 6px; }
}
.op {
  display: flex; align-items: center; gap: 12px; padding: 8px 12px;
  border: 1px solid var(--gn-border); border-radius: var(--gn-radius); background: var(--gn-bg);
  &--first { border-color: var(--gn-accent); }
  &__icon { width: 20px; text-align: center; color: var(--gn-muted); }
  &__main { flex: 1; min-width: 0; }
  &__sum { display: flex; align-items: center; gap: 8px; }
  &__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__meta { font-size: 11px; margin-top: 2px; }
}
.muted { color: var(--gn-muted); }
.err { color: var(--gn-danger); }
.ok { color: var(--gn-success); }
.empty { padding: 30px; text-align: center; }
</style>
