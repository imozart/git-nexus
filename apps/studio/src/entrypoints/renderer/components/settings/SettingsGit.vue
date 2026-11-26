<script setup lang="ts">
// Configurações > Git: identidade, assinatura de commits e comportamento (pull, ramo inicial, quebra de linha). Tudo é lido e gravado com `git config`, no escopo
// escolhido (global ou só o repositório da aba ativa), e vale na hora: o campo grava ao confirmar (Enter ou sair do campo). Texto vazio remove o valor do escopo.
// Nunca há arquivo de configuração paralelo: o que se vê aqui é o que o `git config` mostra no terminal.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GnButton, GnSegmented, GnTooltip } from '@git-nexus/ui-kit';
import { GitConfigError, validateGitConfigValue, type GitConfigEntry, type GitConfigKey, type GitConfigScope } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { t } from '../../i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import ComboBox from '../ComboBox.vue';

const ws = useWorkspaceStore();
const repo = computed(() => ws.active?.repo ?? null);
const scope = ref<GitConfigScope>('global');
const entries = ref<Partial<Record<GitConfigKey, GitConfigEntry>>>({});
const error = ref('');
const saved = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

const scopeOptions = computed(() => [
  { value: 'global' as GitConfigScope, label: t('settings.git.scopeGlobal') },
  { value: 'local' as GitConfigScope, label: t('settings.git.scopeLocal', { name: repo.value?.name ?? '—' }), disabled: !repo.value },
]);
const repoPath = computed(() => (scope.value === 'local' ? (repo.value?.path ?? null) : null));

async function load(): Promise<void> {
  try {
    const list = await api.getGitConfig(repo.value?.path ?? null);
    entries.value = Object.fromEntries(list.map((e) => [e.key, e]));
  } catch (e) {
    error.value = errMsg(e);
  }
}
onMounted(load);
watch(() => repo.value?.path, () => {
  if (!repo.value) scope.value = 'global';
  void load();
});
onBeforeUnmount(() => clearTimeout(timer));

/** O valor DESTE escopo (o que o campo mostra e edita). */
const own = (k: GitConfigKey): string | null => (scope.value === 'global' ? entries.value[k]?.global : entries.value[k]?.local) ?? null;
/** O que vale se este escopo não definir (só faz sentido no escopo do repositório: vem do global). */
const inherited = (k: GitConfigKey): string | null => (scope.value === 'local' ? (entries.value[k]?.global ?? null) : null);
/** O que o campo mostra: o do escopo, senão o herdado. */
const shown = (k: GitConfigKey): string | null => own(k) ?? inherited(k);

function problem(e: unknown): string {
  if (e instanceof GitConfigError) {
    if (e.code === 'email') return t('settings.git.errEmail');
    if (e.code === 'branch') return t('settings.git.errBranch');
  }
  return t('settings.git.errGeneric', { msg: errMsg(e) });
}

async function save(k: GitConfigKey, v: string | null): Promise<void> {
  error.value = '';
  try {
    if (v !== null) validateGitConfigValue(k, v);
    await api.setGitConfig(repoPath.value, scope.value, k, v);
    await load();
    saved.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (saved.value = false), 2000);
  } catch (e) {
    error.value = problem(e);
  }
}

const onText = (k: GitConfigKey, ev: Event): void => {
  const v = (ev.target as HTMLInputElement).value.trim();
  if (v === (own(k) ?? '')) return;
  void save(k, v === '' ? null : v);
};
/** Lista: o valor `''` é "padrão do Git" (remove a chave deste escopo). */
const onPick = (k: GitConfigKey, v: string): void => void save(k, v === '' ? null : v);

const identityFields = [
  { id: 'git-name', key: 'user.name', label: 'settings.git.name' },
  { id: 'git-email', key: 'user.email', label: 'settings.git.email' },
] as const;

const formatOptions = computed(() => [
  { value: '', label: t('settings.git.default') },
  { value: 'openpgp', label: 'OpenPGP (GPG)' },
  { value: 'ssh', label: 'SSH' },
  { value: 'x509', label: 'X.509' },
]);
const pullOptions = computed(() => [
  { value: '', label: t('settings.git.default') },
  { value: 'false', label: t('settings.git.pullMerge') },
  { value: 'true', label: t('settings.git.pullRebase') },
  { value: 'merges', label: t('settings.git.pullMerges') },
]);
const crlfOptions = computed(() => [
  { value: '', label: t('settings.git.default') },
  { value: 'true', label: t('settings.git.crlfTrue') },
  { value: 'input', label: t('settings.git.crlfInput') },
  { value: 'false', label: t('settings.git.crlfFalse') },
]);
</script>

<template>
  <div class="sg">
    <div class="sd__field" data-setting="git-scope">
      <span>{{ t('settings.git.scope') }}</span>
      <GnSegmented v-model="scope" class="sd__seg" :options="scopeOptions" :aria-label="t('settings.git.scope')" />
      <small v-if="!repo" class="sd__hint sd__hint--field">{{ t('settings.git.scopeNoRepo') }}</small>
    </div>

    <h4 class="sd__h">{{ t('settings.git.identity') }}</h4>
    <div v-for="f in identityFields" :key="f.id" class="sd__field" :data-setting="f.id">
      <label :for="`sg-${f.id}`">{{ t(f.label) }}</label>
      <div class="sg__row">
        <input :id="`sg-${f.id}`" class="sd__input" type="text" :value="own(f.key) ?? ''" :placeholder="inherited(f.key) ?? t('settings.git.unset')" :data-testid="`settings-${f.id}`" @change="onText(f.key, $event)" />
        <GnButton v-if="own(f.key) !== null" size="sm" variant="ghost" @click="save(f.key, null)">{{ t('settings.git.remove') }}<GnTooltip :text="t('settings.git.removeTitle')" /></GnButton>
      </div>
      <small v-if="own(f.key) === null && inherited(f.key)" class="sd__hint sd__hint--field">{{ t('settings.git.inherited', { value: inherited(f.key) ?? '' }) }}</small>
    </div>

    <h4 class="sd__h">{{ t('settings.git.signing') }}</h4>
    <label class="sd__chk" data-setting="git-sign">
      <input type="checkbox" data-testid="settings-git-sign" :checked="shown('commit.gpgsign') === 'true'" @change="save('commit.gpgsign', ($event.target as HTMLInputElement).checked ? 'true' : 'false')" />
      {{ t('settings.git.sign') }}
    </label>
    <div class="sd__field sd__field--gap" data-setting="git-format">
      <span>{{ t('settings.git.format') }}</span>
      <ComboBox class="sd__combo" block :options="formatOptions" :model-value="shown('gpg.format') ?? ''" :aria-label="t('settings.git.format')" @update:model-value="onPick('gpg.format', $event as string)" />
    </div>
    <div class="sd__field" data-setting="git-key">
      <label for="sg-git-key">{{ t('settings.git.key') }}</label>
      <input id="sg-git-key" class="sd__input" type="text" :value="own('user.signingkey') ?? ''" :placeholder="inherited('user.signingkey') ?? t('settings.git.unset')" data-testid="settings-git-key" @change="onText('user.signingkey', $event)" />
      <small class="sd__hint sd__hint--field">{{ t('settings.git.keyHint') }}</small>
    </div>

    <h4 class="sd__h">{{ t('settings.git.behavior') }}</h4>
    <div class="sd__field" data-setting="git-pull">
      <span>{{ t('settings.git.pull') }}</span>
      <ComboBox class="sd__combo" block :options="pullOptions" :model-value="shown('pull.rebase') ?? ''" :aria-label="t('settings.git.pull')" @update:model-value="onPick('pull.rebase', $event as string)" />
    </div>
    <div class="sd__field" data-setting="git-branch">
      <label for="sg-git-branch">{{ t('settings.git.defaultBranch') }}</label>
      <input id="sg-git-branch" class="sd__input" type="text" :value="own('init.defaultBranch') ?? ''" :placeholder="inherited('init.defaultBranch') ?? 'master'" data-testid="settings-git-branch" @change="onText('init.defaultBranch', $event)" />
      <small class="sd__hint sd__hint--field">{{ t('settings.git.defaultBranchHint') }}</small>
    </div>
    <div class="sd__field" data-setting="git-crlf">
      <span>{{ t('settings.git.crlf') }}</span>
      <ComboBox class="sd__combo sd__combo--wide" block :options="crlfOptions" :model-value="shown('core.autocrlf') ?? ''" :aria-label="t('settings.git.crlf')" @update:model-value="onPick('core.autocrlf', $event as string)" />
      <small class="sd__hint sd__hint--field">{{ t('settings.git.crlfHint') }}</small>
    </div>

    <p class="sd__status sd__status--ok" role="status" data-testid="settings-git-status">{{ saved ? t('settings.git.saved') : '' }}</p>
    <p v-if="error" class="sd__status sd__status--err" role="alert" data-testid="settings-git-error">{{ error }}</p>
  </div>
</template>

<style scoped lang="scss">
.sg__row { display: flex; align-items: center; gap: 8px; }
</style>
