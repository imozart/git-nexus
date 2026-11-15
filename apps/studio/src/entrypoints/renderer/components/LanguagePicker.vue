<script setup lang="ts">
// Seletor de idioma: o ComboBox padrão do app (botão arredondado + lista flutuante) com a bandeira no botão e em cada opção.
// Antes tinha lista e teclado próprios; agora o visual e o comportamento são os mesmos de todos os outros combobox.
import { computed } from 'vue';
import { LOCALES, locale, setLocale, t, type Locale } from '../i18n';
import ComboBox from './ComboBox.vue';
import FlagIcon from './FlagIcon.vue';

const options = LOCALES.map((l) => ({ value: l.id, label: l.label }));
const current = computed(() => LOCALES.find((l) => l.id === locale.value)!);
const byId = (id: string) => LOCALES.find((l) => l.id === id);
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
      <span class="lang__value"><FlagIcon :code="current.flag" /><span class="lang__code">{{ current.short }}</span></span>
    </template>
    <template #option="{ option }">
      <FlagIcon v-if="byId(option.value)" :code="byId(option.value)!.flag" />
      <span class="lang__name">{{ option.label }}</span>
    </template>
  </ComboBox>
</template>

<style scoped lang="scss">
.lang {
  margin: 6px 0 6px 10px;
  &__value { display: inline-flex; align-items: center; gap: 7px; }
}
</style>

<!-- A lista está no <body> (Teleport): o nome ocupa o espaço que sobra, empurrando a marca de seleção para a direita. -->
<style lang="scss">
.cbx__opt .lang__name { flex: 1; white-space: nowrap; }
</style>
