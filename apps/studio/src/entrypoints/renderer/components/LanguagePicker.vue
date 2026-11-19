<script setup lang="ts">
// Seletor de idioma: o ComboBox padrão do app (botão arredondado + lista flutuante). O botão mostra o código curto do idioma em vigor (PT, EN)
// e a lista, o nome de cada idioma nele mesmo; sem bandeiras (bandeira é país, não idioma). O catálogo é `SUPPORTED_LOCALES` (i18n/core.ts).
import { computed } from 'vue';
import { LOCALES, locale, setLocale, t, type Locale } from '../i18n';
import ComboBox from './ComboBox.vue';

const options = LOCALES.map((l) => ({ value: l.id, label: l.label }));
const current = computed(() => LOCALES.find((l) => l.id === locale.value)!);
</script>

<template>
  <ComboBox
    class="lang"
    pill
    align="right"
    :options="options"
    :model-value="locale"
    :title="t('core.language')"
    :aria-label="`${t('core.language')}: ${current.label}`"
    @update:model-value="setLocale($event as Locale)"
  >
    <template #value>
      <span class="lang__code">{{ current.short }}</span>
    </template>
    <template #option="{ option }">
      <span class="lang__name">{{ option.label }}</span>
    </template>
  </ComboBox>
</template>

<style scoped lang="scss">
.lang {
  margin: 6px 0 6px 10px;
}
</style>

<!-- A lista está no <body> (Teleport): o nome ocupa o espaço que sobra, empurrando a marca de seleção para a direita. -->
<style lang="scss">
.cbx__opt .lang__name { flex: 1; white-space: nowrap; }
</style>
