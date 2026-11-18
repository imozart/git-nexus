<script setup lang="ts">
// Configurações do app: Geral (idioma, atualização automática, busca automática) e Aparência (tema, fonte da interface, fonte do código e ligaduras,
// com pré-visualização). Os campos leem e escrevem nos MESMOS estados dos controles de antes (seletor de idioma da barra, caixa do seletor de branch,
// comandos da paleta): nada é duplicado nem removido. A mudança vale na hora e fica guardada; não há "Salvar" nem "Cancelar".
// O diálogo é um GnDialog (foco preso, Esc, clique fora, foco devolvido).
import { computed } from 'vue';
import { GnButton, GnDialog, GnSegmented } from '@git-nexus/ui-kit';
import { autoFetchEnabled } from '../auto-fetch';
import { FONT_PREFS, fontCode, fontUi, ligatures, resetFonts, setFontCode, setFontUi, setLigatures } from '../font';
import { LOCALES, locale, setLocale, t, type Locale } from '../i18n';
import { THEME_PREFS, setThemePref, themePref } from '../theme';
import { useUpdateStore } from '../stores/update';

defineEmits<{ (e: 'close'): void }>();

const upd = useUpdateStore();
const localeOptions = LOCALES.map((l) => ({ value: l.id, label: l.label }));
const themeOptions = computed(() => THEME_PREFS.map((p) => ({ value: p, label: t(`theme.${p}`) })));
const fontOptions = computed(() => FONT_PREFS.map((p) => ({ value: p, label: t(`font.${p}`) })));
/** Texto da pré-visualização do código: as sequências que as ligaduras transformam em um símbolo. */
const SAMPLE = 'const ok = a !== b && c >= d;  // -> => != <=';
</script>

<template>
  <GnDialog width="min(560px, 94vw)" labelledby="settings-title" initial-focus='.gn-seg__opt[tabindex="0"]' @close="$emit('close')">
    <div class="sd">
      <h3 id="settings-title">{{ t('settings.title') }}</h3>

      <div class="sd__body">
      <h4>{{ t('settings.general') }}</h4>
      <div class="sd__field">
        <span>{{ t('settings.language') }}</span>
        <GnSegmented class="sd__seg" :model-value="locale" :options="localeOptions" :aria-label="t('settings.language')" @update:model-value="setLocale($event as Locale)" />
      </div>
      <label class="sd__chk">
        <input type="checkbox" data-testid="settings-auto-update" :checked="upd.enabled" @change="upd.setEnabled(($event.target as HTMLInputElement).checked)" />
        {{ t('settings.autoUpdate') }}
      </label>
      <label class="sd__chk sd__chk--gap">
        <input type="checkbox" data-testid="settings-auto-fetch" :checked="autoFetchEnabled" @change="autoFetchEnabled = ($event.target as HTMLInputElement).checked" />
        {{ t('settings.autoFetch') }}
      </label>
      <p class="sd__hint">{{ t('settings.autoFetchHint') }}</p>

      <h4>{{ t('settings.appearance') }}</h4>
      <div class="sd__field">
        <span>{{ t('settings.theme') }}</span>
        <GnSegmented class="sd__seg" :model-value="themePref" :options="themeOptions" :aria-label="t('settings.theme')" @update:model-value="setThemePref" />
      </div>
      <div class="sd__field">
        <span>{{ t('settings.fontUi') }}</span>
        <GnSegmented class="sd__seg" :model-value="fontUi" :options="fontOptions" :aria-label="t('settings.fontUi')" @update:model-value="setFontUi" />
      </div>
      <div class="sd__field">
        <span>{{ t('settings.fontCode') }}</span>
        <GnSegmented class="sd__seg" :model-value="fontCode" :options="fontOptions" :aria-label="t('settings.fontCode')" @update:model-value="setFontCode" />
      </div>
      <label class="sd__chk">
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

      <div class="sd__btns">
        <GnButton type="button" @click="resetFonts()">{{ t('settings.reset') }}</GnButton>
        <GnButton type="button" @click="$emit('close')">{{ t('home.close') }}</GnButton>
      </div>
    </div>
  </GnDialog>
</template>

<style scoped lang="scss">
// título e botões ficam fixos; só o corpo rola (janela baixa, como 960x600)
.sd {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 18px 20px;
  h3 { margin: 0 0 12px; font-size: 15px; }
  h4 { margin: 0 0 10px; font-size: 13px; &:not(:first-child) { margin-top: 16px; } }
  &__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding-right: 4px; }
  &__field { display: grid; gap: 4px; margin-bottom: 12px; > span { font-size: 12px; color: var(--gn-muted); } }
  &__seg { justify-self: start; }
  &__chk { display: flex; align-items: center; gap: 8px; cursor: pointer; &--gap { margin-top: 8px; } }
  &__hint { margin: 4px 0 14px 24px; font-size: 12px; color: var(--gn-muted); }
  &__preview { background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); padding: 10px 12px; }
  &__code { margin: 0 0 8px; overflow-x: auto; white-space: pre; }
  &__ui { margin: 0; }
  &__btns { display: flex; justify-content: space-between; gap: 8px; margin-top: 14px; flex: none; }
}
</style>
