<script setup lang="ts">
// Diálogo do seletor de branch: "Nova branch" (nome + de onde criar) e "Ir para tag ou commit". A criação pode nascer da versão MAIS RECENTE
// do remoto (origin/main): nesse caso o app busca a base antes de criar, para não partir de uma cópia local velha.
import { computed, ref } from 'vue';
import { GnButton, GnDialog } from '@git-nexus/ui-kit';
import type { BranchList } from '@git-nexus/git-core/pure';
import { t } from '../i18n';
import ComboBox from './ComboBox.vue';

export interface NewBranchSubmit {
  name: string;
  /** Referência da base: branch local, remota (origin/x) ou HEAD. */
  base: string;
  /** A base é remota: buscar antes de criar. */
  fetch: boolean;
  checkout: boolean;
}

const props = defineProps<{
  mode: 'new' | 'revision';
  data: BranchList;
  /** Base escolhida de início: "latest" (mais recente do remoto), "head", "local:x" ou "remote:origin/x". */
  initialBase?: string;
  busy?: boolean;
  error?: string;
}>();
const emit = defineEmits<{ (e: 'new', v: NewBranchSubmit): void; (e: 'revision', rev: string): void; (e: 'cancel'): void }>();

const name = ref('');
const rev = ref('');
const checkout = ref(true);
const hasLatest = computed(() => !!props.data.defaultRemoteBranch);
const base = ref(props.initialBase ?? (hasLatest.value ? 'latest' : 'head'));

/** Bases possíveis no ComboBox: a mais recente do remoto e a branch atual (sem grupo, no topo), depois as branches agrupadas em Local (só as locais) e Remoto (só as do remoto). */
const baseOptions = computed(() => [
  ...(hasLatest.value ? [{ value: 'latest', label: t('bd.latest', { ref: props.data.defaultRemoteBranch ?? '' }) }] : []),
  { value: 'head', label: props.data.detached ? t('bd.headDetached') : t('bd.head', { name: props.data.current }) },
  ...props.data.locals.map((b) => ({ value: 'local:' + b.name, label: b.name, group: t('bd.groupLocal') })),
  ...props.data.remotes.map((b) => ({ value: 'remote:' + b.name, label: b.name, group: t('bd.groupRemote'), hint: t('bd.fetchFirst') })),
]);

/** O que será criado, em uma frase (confere o que o app vai fazer antes de clicar em Criar). */
const baseRef = computed(() => {
  if (base.value === 'latest') return props.data.defaultRemoteBranch ?? 'HEAD';
  if (base.value === 'head') return 'HEAD';
  return base.value.slice(base.value.indexOf(':') + 1);
});
const needsFetch = computed(() => base.value === 'latest' || base.value.startsWith('remote:'));
const canSubmit = computed(() => !props.busy && (props.mode === 'new' ? !!name.value.trim() : !!rev.value.trim()));

function submit(): void {
  if (!canSubmit.value) return;
  if (props.mode === 'revision') emit('revision', rev.value.trim());
  else emit('new', { name: name.value.trim(), base: baseRef.value, fetch: needsFetch.value, checkout: checkout.value });
}

const title = computed(() => (props.mode === 'new' ? t('bd.newTitle') : t('bd.revTitle')));
</script>

<template>
  <GnDialog width="min(460px, 92vw)" :label="title" initial-focus="input" @close="emit('cancel')">
      <form class="bd__form" @submit.prevent="submit">
        <h3>{{ title }}</h3>

        <template v-if="mode === 'new'">
          <label class="bd__field">
            <span>{{ t('bd.name') }}</span>
            <input v-model="name" :placeholder="t('bd.namePh')" spellcheck="false" autocomplete="off" />
          </label>
          <div class="bd__field">
            <span>{{ t('bd.from') }}</span>
            <ComboBox v-model="base" block filterable collapsible-groups :collapsed-groups="[t('bd.groupRemote')]" :options="baseOptions" :aria-label="t('bd.from')" data-testid="bd-base" />
          </div>
          <label class="bd__chk"><input v-model="checkout" type="checkbox" /> {{ t('bd.checkout') }}</label>
        </template>

        <template v-else>
          <div class="bd__field">
            <span>{{ t('bd.revLabel') }}</span>
            <ComboBox v-model="rev" searchable block mono :options="data.tags" :aria-label="t('bd.revLabel')" data-testid="bd-rev" />
          </div>
          <p class="bd__hint">{{ t('bd.revHint') }}</p>
        </template>

        <p v-if="error" class="bd__err" role="alert">{{ error }}</p>
        <div class="bd__btns">
          <GnButton type="button" @click="emit('cancel')">{{ t('dlg.cancel') }}</GnButton>
          <GnButton type="submit" variant="primary" :disabled="!canSubmit">
            {{ mode === 'new' ? (busy ? t('bd.creating') : t('bd.create')) : t('bd.go') }}
          </GnButton>
        </div>
      </form>
  </GnDialog>
</template>

<style scoped lang="scss">
.bd {
  &__form {
    padding: 18px 20px;
    h3 { margin: 0 0 12px; font-size: 15px; }
  }
  &__field { display: grid; gap: 4px; margin-bottom: 12px; > span { font-size: 12px; color: var(--gn-muted); } select, input { width: 100%; } }
  &__chk { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; cursor: pointer; }
  &__hint { margin: 0 0 4px; font-size: 12px; color: var(--gn-muted); }
  &__err { margin: 8px 0 0; color: var(--gn-danger); word-break: break-word; }
  &__btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
}
</style>
