<script setup lang="ts">
// Configurações > Aparência: tema, movimento, fonte da interface, fonte do código e ligaduras, com pré-visualização. Vale na hora e fica guardado.
import { computed } from 'vue';
import { GnSegmented } from '@git-nexus/ui-kit';
import { FONT_PREFS, fontCode, fontUi, ligatures, setFontCode, setFontUi, setLigatures } from '../../font';
import { t } from '../../i18n';
import { MOTION_PREFS, motionPref, setMotionPref } from '../../motion';
import { THEME_PREFS, setThemePref, themePref, type ThemePref } from '../../theme';
import ComboBox from '../ComboBox.vue';

const themeOptions = computed(() => THEME_PREFS.map((p) => ({ value: p, label: t(`theme.${p}`) })));
const motionOptions = computed(() => MOTION_PREFS.map((p) => ({ value: p, label: t(`motion.${p}`) })));
const fontOptions = computed(() => FONT_PREFS.map((p) => ({ value: p, label: t(`font.${p}`) })));
/** Texto da pré-visualização do código: as sequências que as ligaduras transformam em um símbolo. */
const SAMPLE = 'const ok = a !== b && c >= d;  // -> => != <=';
</script>

<template>
  <div>
    <div class="sd__field" data-setting="theme">
      <span>{{ t('settings.theme') }}</span>
      <ComboBox class="sd__combo" block :options="themeOptions" :model-value="themePref" :aria-label="t('settings.theme')" @update:model-value="setThemePref($event as ThemePref)" />
    </div>
    <div class="sd__field" data-setting="motion">
      <span>{{ t('settings.motion') }}</span>
      <GnSegmented class="sd__seg" :model-value="motionPref" :options="motionOptions" :aria-label="t('settings.motion')" @update:model-value="setMotionPref" />
      <small class="sd__hint sd__hint--field">{{ t('settings.motionHint') }}</small>
    </div>
    <div class="sd__field" data-setting="font-ui">
      <span>{{ t('settings.fontUi') }}</span>
      <GnSegmented class="sd__seg" :model-value="fontUi" :options="fontOptions" :aria-label="t('settings.fontUi')" @update:model-value="setFontUi" />
    </div>
    <div class="sd__field" data-setting="font-code">
      <span>{{ t('settings.fontCode') }}</span>
      <GnSegmented class="sd__seg" :model-value="fontCode" :options="fontOptions" :aria-label="t('settings.fontCode')" @update:model-value="setFontCode" />
    </div>
    <label class="sd__chk" data-setting="ligatures">
      <input type="checkbox" data-testid="settings-ligatures" :checked="ligatures === 'on'" @change="setLigatures(($event.target as HTMLInputElement).checked ? 'on' : 'off')" />
      {{ t('settings.ligatures') }}
    </label>
    <p class="sd__hint">{{ t('settings.ligaturesHint') }}</p>

    <div class="sd__field">
      <span>{{ t('settings.preview') }}</span>
      <div class="sd__preview" data-testid="settings-preview">
        <pre class="sd__code">{{ SAMPLE }}</pre>
        <p class="sd__ui">{{ t('settings.previewText') }}</p>
      </div>
    </div>
  </div>
</template>
