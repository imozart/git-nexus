<script setup lang="ts">
// Diálogo do seletor de branch: "Nova branch" (nome + de onde criar) e "Ir para tag ou commit". A criação pode nascer da versão MAIS RECENTE
// do remoto (origin/main): nesse caso o app busca a base antes de criar, para não partir de uma cópia local velha.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
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
const input = ref<HTMLInputElement | null>(null);
const formEl = ref<HTMLFormElement | null>(null);

/** Bases possíveis no ComboBox: a mais recente do remoto, o HEAD e as branches (o "Locais/Remotas" do antigo optgroup vira o texto auxiliar de cada item). */
const baseOptions = computed(() => [
  ...(hasLatest.value ? [{ value: 'latest', label: t('bd.latest', { ref: props.data.defaultRemoteBranch ?? '' }) }] : []),
  { value: 'head', label: props.data.detached ? t('bd.headDetached') : t('bd.head', { name: props.data.current }) },
  ...props.data.locals.map((b) => ({ value: 'local:' + b.name, label: b.name, hint: t('bd.groupLocal') })),
  ...props.data.remotes.map((b) => ({ value: 'remote:' + b.name, label: b.name, hint: t('bd.groupRemote') })),
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

function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') emit('cancel');
}
onMounted(async () => {
  document.addEventListener('keydown', onKey);
  await nextTick();
  (input.value ?? formEl.value?.querySelector('input'))?.focus();
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="bd" @mousedown.self="emit('cancel')">
      <form ref="formEl" class="bd__box" role="dialog" aria-modal="true" :aria-label="mode === 'new' ? t('bd.newTitle') : t('bd.revTitle')" @submit.prevent="submit">
        <h3>{{ mode === 'new' ? t('bd.newTitle') : t('bd.revTitle') }}</h3>

        <template v-if="mode === 'new'">
          <label class="bd__field">
            <span>{{ t('bd.name') }}</span>
            <input ref="input" v-model="name" :placeholder="t('bd.namePh')" spellcheck="false" autocomplete="off" />
          </label>
          <div class="bd__field">
            <span>{{ t('bd.from') }}</span>
            <ComboBox v-model="base" block :options="baseOptions" :aria-label="t('bd.from')" data-testid="bd-base" />
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
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.bd {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
  &__box {
    width: min(460px, 92vw);
    padding: 18px 20px;
    background: var(--gn-surface);
    border: 1px solid var(--gn-border);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    h3 { margin: 0 0 12px; font-size: 15px; }
  }
  &__field { display: grid; gap: 4px; margin-bottom: 12px; > span { font-size: 12px; color: var(--gn-muted); } select, input { width: 100%; } }
  &__chk { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; cursor: pointer; }
  &__hint { margin: 0 0 4px; font-size: 12px; color: var(--gn-muted); }
  &__err { margin: 8px 0 0; color: var(--gn-danger); word-break: break-word; }
  &__btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
}
</style>
