<script setup lang="ts">
// "Clonar repositório" e "Novo repositório" (git clone / git init): pasta de destino (digitada ou escolhida), nome da pasta, branch e, no novo,
// o modelo de .gitignore. Mostra onde o repositório será criado antes de confirmar e o andamento do clone (porcentagem que o git informa).
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import { GITIGNORE_TEMPLATES, isValidBranchName, isValidFolderName, repoNameFromUrl, type GitProgressEvent, type RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { t } from '../i18n';
import ComboBox from './ComboBox.vue';

const props = defineProps<{ mode: 'clone' | 'init' }>();
const emit = defineEmits<{ (e: 'done', v: { repo: RepositoryMeta; note?: string }): void; (e: 'cancel'): void }>();

const url = ref('');
const parent = ref('');
const name = ref('');
const branch = ref(props.mode === 'init' ? 'main' : '');
const gitignore = ref('none');
/** Modelos de .gitignore para o ComboBox (o "nenhum" tem texto traduzido). */
const gitignoreOptions = computed(() => GITIGNORE_TEMPLATES.map((g) => ({ value: g.id, label: g.id === 'none' ? t('create.gitignoreNone') : g.label })));
const busy = ref(false);
const error = ref('');
const progress = ref<{ phase: string; percent: number | null } | null>(null);
const urlInput = ref<HTMLInputElement | null>(null);
const parentInput = ref<HTMLInputElement | null>(null);

/** Nome da pasta que será usada: o digitado ou, no clone, o que vem da URL. */
const folder = computed(() => name.value.trim() || (props.mode === 'clone' ? repoNameFromUrl(url.value) : ''));
const sep = computed(() => (parent.value.includes('\\') ? '\\' : '/'));
/** Onde o repositório vai ficar (confere antes de clicar). */
const target = computed(() => {
  const p = parent.value.trim().replace(/[\\/]+$/, '');
  if (!p) return '';
  return folder.value ? `${p}${sep.value}${folder.value}` : p;
});
const nameBad = computed(() => !!name.value.trim() && !isValidFolderName(name.value.trim()));
const branchBad = computed(() => !!branch.value.trim() && !isValidBranchName(branch.value.trim()));
const canSubmit = computed(
  () => !busy.value && !!parent.value.trim() && !nameBad.value && !branchBad.value && (props.mode === 'init' || (!!url.value.trim() && !!folder.value)),
);

const phaseLabel = (p: string): string => {
  const known: Record<string, string> = { 'Receiving objects': 'clone.receiving', 'Resolving deltas': 'clone.resolving', 'Counting objects': 'clone.counting', 'Compressing objects': 'clone.compressing', 'Updating files': 'clone.updating' };
  const key = known[p];
  return key ? t(key as 'clone.receiving') : p;
};
const progressText = computed(() => (progress.value ? `${phaseLabel(progress.value.phase)}${progress.value.percent === null ? '' : ` ${progress.value.percent}%`}` : ''));

async function pickParent(): Promise<void> {
  const dirs = await api.pickDirectories();
  if (dirs[0]) parent.value = dirs[0];
}

let off: (() => void) | undefined;
async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  busy.value = true;
  error.value = '';
  progress.value = null;
  try {
    if (props.mode === 'clone') {
      off = api.onGitProgress((e: GitProgressEvent) => {
        if (e.op === 'clone') progress.value = { phase: e.phase, percent: e.percent };
      });
      const repo = await api.cloneRepository({ url: url.value.trim(), parentDir: parent.value.trim(), name: name.value.trim(), branch: branch.value.trim() });
      emit('done', { repo });
    } else {
      const r = await api.initRepository({ parentDir: parent.value.trim(), name: name.value.trim(), branch: branch.value.trim(), gitignore: gitignore.value });
      emit('done', { repo: r.repo, note: r.gitignore === 'exists' ? t('create.gitignoreKept') : undefined });
    }
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    off?.();
    busy.value = false;
  }
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && !busy.value) emit('cancel');
}
onMounted(async () => {
  document.addEventListener('keydown', onKey);
  await nextTick();
  (props.mode === 'clone' ? urlInput : parentInput).value?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  off?.();
});
</script>

<template>
  <Teleport to="body">
    <div class="rc" @mousedown.self="!busy && emit('cancel')">
      <form class="rc__box" role="dialog" aria-modal="true" :aria-label="mode === 'clone' ? t('clone.title') : t('create.title')" :data-testid="`create-${mode}`" @submit.prevent="submit">
        <h3>{{ mode === 'clone' ? t('clone.title') : t('create.title') }}</h3>

        <label v-if="mode === 'clone'" class="rc__field">
          <span>{{ t('clone.url') }}</span>
          <input ref="urlInput" v-model="url" data-testid="create-url" :placeholder="t('clone.urlPh')" spellcheck="false" autocomplete="off" :disabled="busy" />
        </label>

        <div class="rc__field">
          <span>{{ mode === 'clone' ? t('clone.parent') : t('create.parent') }}</span>
          <div class="rc__row">
            <input ref="parentInput" v-model="parent" data-testid="create-parent" :placeholder="t('clone.parentPh')" spellcheck="false" autocomplete="off" :disabled="busy" />
            <GnButton type="button" :disabled="busy" @click="pickParent">{{ t('clone.choose') }}</GnButton>
          </div>
        </div>

        <label class="rc__field">
          <span>{{ mode === 'clone' ? t('clone.name') : t('create.name') }}</span>
          <input v-model="name" data-testid="create-name" :placeholder="mode === 'clone' ? repoNameFromUrl(url) || t('clone.namePh') : t('create.namePh')" spellcheck="false" autocomplete="off" :disabled="busy" />
          <small v-if="nameBad" class="rc__bad">{{ t('create.nameBad') }}</small>
        </label>

        <label class="rc__field">
          <span>{{ mode === 'clone' ? t('clone.branch') : t('create.branch') }}</span>
          <input v-model="branch" data-testid="create-branch" :placeholder="mode === 'clone' ? t('clone.branchPh') : 'main'" spellcheck="false" autocomplete="off" :disabled="busy" />
          <small v-if="branchBad" class="rc__bad">{{ t('create.branchBad') }}</small>
        </label>

        <div v-if="mode === 'init'" class="rc__field">
          <span>{{ t('create.gitignore') }}</span>
          <ComboBox v-model="gitignore" block :options="gitignoreOptions" :aria-label="t('create.gitignore')" data-testid="create-gitignore" :disabled="busy" />
        </div>

        <p v-if="target" class="rc__target" data-testid="create-target">{{ t('create.target') }} <code>{{ target }}</code></p>

        <div v-if="busy && mode === 'clone'" class="rc__progress" data-testid="create-progress">
          <div class="rc__bar" :class="{ 'rc__bar--ind': !progress || progress.percent === null }"><i :style="{ width: (progress?.percent ?? 0) + '%' }" /></div>
          <span class="rc__ptext">{{ progressText || t('clone.starting') }}</span>
        </div>

        <p v-if="error" class="rc__err" role="alert" data-testid="create-error">{{ error }}</p>
        <div class="rc__btns">
          <GnButton type="button" :disabled="busy" @click="emit('cancel')">{{ t('dlg.cancel') }}</GnButton>
          <GnButton type="submit" variant="primary" data-testid="create-submit" :disabled="!canSubmit">
            {{ mode === 'clone' ? (busy ? t('clone.running') : t('clone.go')) : busy ? t('create.running') : t('create.go') }}
          </GnButton>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.rc {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
  &__box {
    width: min(560px, 94vw);
    padding: 18px 20px;
    background: var(--gn-surface);
    border: 1px solid var(--gn-border);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    h3 { margin: 0 0 12px; font-size: 15px; }
  }
  &__field { display: grid; gap: 4px; margin-bottom: 12px; > span { font-size: 12px; color: var(--gn-muted); } select, input { width: 100%; } }
  &__row { display: flex; gap: 8px; input { flex: 1; } }
  &__bad { color: var(--gn-danger); }
  &__target { margin: 0 0 10px; font-size: 12px; color: var(--gn-muted); word-break: break-all; code { font-family: var(--gn-mono); color: var(--gn-text); } }
  &__progress { margin: 4px 0 8px; }
  &__bar {
    height: 6px; border-radius: 3px; background: var(--gn-surface-2); overflow: hidden;
    i { display: block; height: 100%; background: var(--gn-accent); transition: width 0.15s; }
    &--ind i { width: 35% !important; animation: rc-slide 1.1s ease-in-out infinite alternate; }
  }
  &__ptext { display: block; margin-top: 4px; font-size: 12px; color: var(--gn-muted); }
  &__err { margin: 8px 0 0; color: var(--gn-danger); word-break: break-word; white-space: pre-wrap; }
  &__btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
}
@keyframes rc-slide { from { margin-left: 0; } to { margin-left: 65%; } }
</style>
