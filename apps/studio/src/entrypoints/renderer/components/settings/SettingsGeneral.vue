<script setup lang="ts">
// Configurações > Geral: idioma, atualização automática e busca automática. Os campos leem e escrevem nos MESMOS estados dos controles de antes (seletor de
// idioma da barra, caixa do seletor de branch, comandos da paleta): nada é duplicado.
import { computed } from 'vue';
import { autoFetchEnabled } from '../../auto-fetch';
import { LOCALES, locale, localePref, setLocalePref, t, type LocalePref } from '../../i18n';
import { useUpdateStore } from '../../stores/update';
import ComboBox from '../ComboBox.vue';

const upd = useUpdateStore();
// "Sistema" segue o idioma do sistema a cada abertura (o idioma que vale agora aparece como texto auxiliar); os outros são o catálogo, com o nome nativo
const localeOptions = computed(() => [
  { value: 'system', label: t('lang.system'), hint: LOCALES.find((l) => l.id === locale.value)?.label },
  ...LOCALES.map((l) => ({ value: l.id, label: l.label })),
]);
</script>

<template>
  <div>
    <div class="sd__field" data-setting="language">
      <span>{{ t('settings.language') }}</span>
      <ComboBox class="sd__combo" block :options="localeOptions" :model-value="localePref" :aria-label="t('settings.language')" @update:model-value="setLocalePref($event as LocalePref)" />
    </div>
    <label class="sd__chk" data-setting="auto-update">
      <input type="checkbox" data-testid="settings-auto-update" :checked="upd.enabled" @change="upd.setEnabled(($event.target as HTMLInputElement).checked)" />
      {{ t('settings.autoUpdate') }}
    </label>
    <label class="sd__chk sd__chk--gap" data-setting="auto-fetch">
      <input type="checkbox" data-testid="settings-auto-fetch" :checked="autoFetchEnabled" @change="autoFetchEnabled = ($event.target as HTMLInputElement).checked" />
      {{ t('settings.autoFetch') }}
    </label>
    <p class="sd__hint">{{ t('settings.autoFetchHint') }}</p>
  </div>
</template>
