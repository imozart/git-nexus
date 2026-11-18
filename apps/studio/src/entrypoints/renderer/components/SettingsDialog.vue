<script setup lang="ts">
// Configurações do app. Hoje: Aparência (fonte da interface, fonte do código e ligaduras), com pré-visualização. A mudança vale na hora e fica guardada
// (font.ts); não há "Salvar" nem "Cancelar". O diálogo é um GnDialog (foco preso, Esc, clique fora, foco devolvido).
import { computed } from 'vue';
import { GnButton, GnDialog, GnSegmented } from '@git-nexus/ui-kit';
import { FONT_PREFS, fontCode, fontUi, ligatures, resetFonts, setFontCode, setFontUi, setLigatures } from '../font';
import { t } from '../i18n';

defineEmits<{ (e: 'close'): void }>();

const fontOptions = computed(() => FONT_PREFS.map((p) => ({ value: p, label: t(`font.${p}`) })));
/** Texto da pré-visualização do código: as sequências que as ligaduras transformam em um símbolo. */
const SAMPLE = 'const ok = a !== b && c >= d;  // -> => != <=';
</script>

<template>
  <GnDialog width="min(560px, 94vw)" labelledby="settings-title" initial-focus='.gn-seg__opt[tabindex="0"]' @close="$emit('close')">
    <div class="sd">
      <h3 id="settings-title">{{ t('settings.title') }}</h3>

      <h4>{{ t('settings.appearance') }}</h4>
      <div class="sd__field">
        <span>{{ t('settings.fontUi') }}</span>
        <GnSegmented class="sd__seg" :model-value="fontUi" :options="fontOptions" :aria-label="t('settings.fontUi')" @update:model-value="setFontUi" />
      </div>
      <div class="sd__field">
        <span>{{ t('settings.fontCode') }}</span>
        <GnSegmented class="sd__seg" :model-value="fontCode" :options="fontOptions" :aria-label="t('settings.fontCode')" @update:model-value="setFontCode" />
      </div>
      <label class="sd__chk">
        <input type="checkbox" :checked="ligatures === 'on'" @change="setLigatures(($event.target as HTMLInputElement).checked ? 'on' : 'off')" />
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

      <div class="sd__btns">
        <GnButton type="button" @click="resetFonts()">{{ t('settings.reset') }}</GnButton>
        <GnButton type="button" @click="$emit('close')">{{ t('home.close') }}</GnButton>
      </div>
    </div>
  </GnDialog>
</template>

<style scoped lang="scss">
.sd {
  padding: 18px 20px;
  overflow: auto;
  min-height: 0;
  h3 { margin: 0 0 12px; font-size: 15px; }
  h4 { margin: 0 0 10px; font-size: 13px; }
  &__field { display: grid; gap: 4px; margin-bottom: 12px; > span { font-size: 12px; color: var(--gn-muted); } }
  &__seg { justify-self: start; }
  &__chk { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  &__hint { margin: 4px 0 14px 24px; font-size: 12px; color: var(--gn-muted); }
  &__preview { background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); padding: 10px 12px; }
  &__code { margin: 0 0 8px; overflow-x: auto; white-space: pre; }
  &__ui { margin: 0; }
  &__btns { display: flex; justify-content: space-between; gap: 8px; margin-top: 16px; }
}
</style>
