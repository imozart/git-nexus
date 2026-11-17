<script setup lang="ts">
// Seletor de tema: o mesmo ComboBox do seletor de idioma, ao lado dele.
import { computed } from 'vue';
import { t } from '../i18n';
import { THEME_PREFS, setThemePref, themePref, type ThemePref } from '../theme';
import ComboBox from './ComboBox.vue';

const label = (p: ThemePref) => t(`theme.${p}`);
const options = computed(() => THEME_PREFS.map((p) => ({ value: p, label: label(p) })));
</script>

<template>
  <ComboBox
    class="theme"
    pill
    align="right"
    data-testid="theme-picker"
    :options="options"
    :model-value="themePref"
    :title="t('theme.title')"
    :aria-label="`${t('theme.title')}: ${label(themePref)}`"
    @update:model-value="setThemePref($event as ThemePref)"
  >
    <template #value>{{ label(themePref) }}</template>
  </ComboBox>
</template>

<style scoped lang="scss">
.theme { margin: 6px 0 6px 10px; }
</style>
