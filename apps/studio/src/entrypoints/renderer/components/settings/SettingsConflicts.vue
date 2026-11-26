<script setup lang="ts">
// Configurações > Conflitos: o resolvedor padrão (atual ou o novo, experimental), lembrar resoluções (`rerere`) e o estilo dos marcadores (`merge.conflictStyle`).
// As duas últimas são do `git config` (global); o resolvedor é uma preferência do app.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { newConflictResolver } from '../../conflict-resolver-pref';
import { api, errMsg } from '../../api';
import { t } from '../../i18n';
import ComboBox from '../ComboBox.vue';

const rerere = ref(false);
const style = ref('');
const error = ref('');
const saved = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function load(): Promise<void> {
  try {
    const list = await api.getGitConfig(null);
    rerere.value = list.find((e) => e.key === 'rerere.enabled')?.global === 'true';
    style.value = list.find((e) => e.key === 'merge.conflictStyle')?.global ?? '';
  } catch (e) {
    error.value = errMsg(e);
  }
}
onMounted(load);
onBeforeUnmount(() => clearTimeout(timer));

async function set(key: 'rerere.enabled' | 'merge.conflictStyle', value: string | null): Promise<void> {
  error.value = '';
  try {
    await api.setGitConfig(null, 'global', key, value);
    await load();
    saved.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (saved.value = false), 2000);
  } catch (e) {
    error.value = t('settings.git.errGeneric', { msg: errMsg(e) });
  }
}

const styleOptions = computed(() => [
  { value: '', label: t('settings.git.default') + ' — ' + t('settings.conflicts.styleMerge') },
  { value: 'diff3', label: t('settings.conflicts.styleDiff3') },
  { value: 'zdiff3', label: t('settings.conflicts.styleZdiff3') },
]);
</script>

<template>
  <div>
    <label class="sd__chk" data-setting="new-resolver">
      <input v-model="newConflictResolver" type="checkbox" data-testid="settings-new-resolver" />
      {{ t('settings.newResolver') }}
    </label>
    <p class="sd__hint">{{ t('settings.newResolverHint') }}</p>

    <label class="sd__chk sd__chk--gap" data-setting="rerere">
      <input type="checkbox" data-testid="settings-rerere" :checked="rerere" @change="set('rerere.enabled', ($event.target as HTMLInputElement).checked ? 'true' : null)" />
      {{ t('settings.conflicts.rerere') }}
    </label>
    <p class="sd__hint">{{ t('settings.conflicts.rerereHint') }}</p>

    <div class="sd__field" data-setting="conflict-style">
      <span>{{ t('settings.conflicts.style') }}</span>
      <ComboBox class="sd__combo sd__combo--wide" block :options="styleOptions" :model-value="style" :aria-label="t('settings.conflicts.style')" @update:model-value="set('merge.conflictStyle', ($event as string) || null)" />
      <small class="sd__hint sd__hint--field">{{ t('settings.conflicts.styleHint') }}</small>
    </div>

    <p class="sd__status sd__status--ok" role="status">{{ saved ? t('settings.git.saved') : '' }}</p>
    <p v-if="error" class="sd__status sd__status--err" role="alert">{{ error }}</p>
  </div>
</template>
