<script setup lang="ts">
// Configurações > Avançado: abrir a pasta de dados e a dos logs, exportar e importar as preferências do app (JSON versionado, `settings-core.ts`) e redefinir.
// Exportar não inclui repositórios, credenciais nem a configuração do Git (essa é do `git config`).
import { computed, ref } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import { api, errMsg } from '../../api';
import { dateLocale, t } from '../../i18n';
import { PREF_KEYS, buildExport, collectPrefs, parseImport } from '../../settings-core';
import { MAX_ENTRIES_CHOICES, parseMax } from '../../gitlog-core';
import { MAX_KEY } from '../../stores/gitlog';
import ComboBox from '../ComboBox.vue';
import ConfirmDialog from '../ConfirmDialog.vue';

const error = ref('');
const info = ref('');
const fileEl = ref<HTMLInputElement>();
const askReset = ref(false);
// quantos comandos o Log do Git guarda por repositório (vale a partir dos próximos comandos)
const logMax = ref(String(parseMax(localStorage.getItem(MAX_KEY))));
const logMaxOptions = computed(() => MAX_ENTRIES_CHOICES.map((n) => ({ value: String(n), label: n.toLocaleString(dateLocale.value) })));
function setLogMax(v: string): void {
  logMax.value = String(parseMax(v));
  localStorage.setItem(MAX_KEY, logMax.value);
}

async function openFolder(which: 'data' | 'logs'): Promise<void> {
  error.value = '';
  try {
    const err = await api.openAppFolder(which);
    if (err) error.value = t('settings.adv.openFailed', { msg: err });
  } catch (e) {
    error.value = t('settings.adv.openFailed', { msg: errMsg(e) });
  }
}

function exportPrefs(): void {
  error.value = '';
  const blob = new Blob([JSON.stringify(buildExport(collectPrefs(localStorage)), null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gitnexus-configuracoes.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Troca TODAS as preferências pelas do arquivo (as que ele não traz voltam ao padrão) e recarrega para o app inteiro as ler de novo. */
function applyPrefs(prefs: Record<string, string>): void {
  for (const k of PREF_KEYS) {
    if (k in prefs) localStorage.setItem(k, prefs[k]!);
    else localStorage.removeItem(k);
  }
  setTimeout(() => location.reload(), 700);
}

async function onFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // permite escolher o mesmo arquivo de novo
  if (!file) return;
  error.value = info.value = '';
  const r = parseImport(await file.text());
  if (!r.ok) {
    error.value = t(r.reason === 'json' ? 'settings.adv.errJson' : r.reason === 'newer' ? 'settings.adv.errNewer' : 'settings.adv.errFormat');
    return;
  }
  info.value = t('settings.adv.importOk');
  applyPrefs(r.prefs);
}

function reset(): void {
  askReset.value = false;
  applyPrefs({});
}
</script>

<template>
  <div class="sa">
    <div class="sd__field" data-setting="data-folder">
      <span>{{ t('settings.adv.data') }}</span>
      <div><GnButton size="sm" data-testid="settings-open-data" @click="openFolder('data')">{{ t('settings.adv.open') }}</GnButton></div>
      <small class="sd__hint sd__hint--field">{{ t('settings.adv.dataHint') }}</small>
    </div>
    <div class="sd__field" data-setting="gitlog-max">
      <span>{{ t('settings.adv.logMax') }}</span>
      <ComboBox class="sd__combo" :options="logMaxOptions" :model-value="logMax" :aria-label="t('settings.adv.logMax')" data-testid="settings-log-max" @update:model-value="setLogMax" />
      <small class="sd__hint sd__hint--field">{{ t('settings.adv.logMaxHint') }}</small>
    </div>
    <div class="sd__field" data-setting="logs">
      <span>{{ t('settings.adv.logs') }}</span>
      <div><GnButton size="sm" data-testid="settings-open-logs" @click="openFolder('logs')">{{ t('settings.adv.open') }}</GnButton></div>
      <small class="sd__hint sd__hint--field">{{ t('settings.adv.logsHint') }}</small>
    </div>
    <div class="sd__field" data-setting="export">
      <span>{{ t('settings.adv.export') }}</span>
      <div><GnButton size="sm" data-testid="settings-export" @click="exportPrefs">{{ t('settings.adv.exportBtn') }}</GnButton></div>
      <small class="sd__hint sd__hint--field">{{ t('settings.adv.exportHint') }}</small>
    </div>
    <div class="sd__field" data-setting="import">
      <span>{{ t('settings.adv.import') }}</span>
      <div>
        <GnButton size="sm" data-testid="settings-import" @click="fileEl?.click()">{{ t('settings.adv.importBtn') }}</GnButton>
        <input ref="fileEl" class="sa__file" type="file" accept="application/json,.json" tabindex="-1" aria-hidden="true" data-testid="settings-import-file" @change="onFile" />
      </div>
      <small class="sd__hint sd__hint--field">{{ t('settings.adv.importHint') }}</small>
    </div>
    <div class="sd__field" data-setting="reset">
      <span>{{ t('settings.adv.reset') }}</span>
      <div><GnButton size="sm" tone="danger" data-testid="settings-reset-all" @click="askReset = true">{{ t('settings.adv.resetBtn') }}</GnButton></div>
      <small class="sd__hint sd__hint--field">{{ t('settings.adv.resetHint') }}</small>
    </div>

    <p class="sd__status sd__status--ok" role="status" data-testid="settings-adv-status">{{ info }}</p>
    <p v-if="error" class="sd__status sd__status--err" role="alert" data-testid="settings-adv-error">{{ error }}</p>
    <ConfirmDialog v-if="askReset" :title="t('settings.adv.resetTitle')" :lines="[t('settings.adv.resetBody')]" :confirm-label="t('settings.adv.resetBtn').replace('…', '')" danger @confirm="reset" @cancel="askReset = false" />
  </div>
</template>

<style scoped lang="scss">
.sa__file { display: none; }
</style>
