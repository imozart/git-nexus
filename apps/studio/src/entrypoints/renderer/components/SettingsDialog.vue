<script setup lang="ts">
// Configurações do app, em abas por grupo: Geral (idioma, atualização automática, busca automática) e Aparência (tema, fonte da interface, fonte do código e
// ligaduras, com pré-visualização). Os campos leem e escrevem nos MESMOS estados dos controles de antes (seletor de idioma da barra, caixa do seletor de branch,
// comandos da paleta): nada é duplicado nem removido. A mudança vale na hora e fica guardada; não há "Salvar" nem "Cancelar".
// O diálogo é um GnDialog (foco preso, Esc, clique fora, foco devolvido). Idioma e tema são ComboBox (o mesmo componente dos outros seletores).
import { computed, ref } from 'vue';
import { GnButton, GnDialog, GnSegmented, GnTabs, type GnTab } from '@git-nexus/ui-kit';
import { autoFetchEnabled } from '../auto-fetch';
import { FONT_PREFS, fontCode, fontUi, ligatures, resetFonts, setFontCode, setFontUi, setLigatures } from '../font';
import { LOCALES, locale, setLocale, t, type Locale } from '../i18n';
import { THEME_PREFS, setThemePref, themePref, type ThemePref } from '../theme';
import { useUpdateStore } from '../stores/update';
import ComboBox from './ComboBox.vue';
import FlagIcon from './FlagIcon.vue';

defineEmits<{ (e: 'close'): void }>();

const upd = useUpdateStore();
const tab = ref<'general' | 'appearance'>('general');
const tabs = computed<GnTab[]>(() => [
  { id: 'general', title: t('settings.general') },
  { id: 'appearance', title: t('settings.appearance') },
]);

const localeOptions = LOCALES.map((l) => ({ value: l.id, label: l.label }));
const flagOf = (id: string) => LOCALES.find((l) => l.id === id)?.flag;
const themeOptions = computed(() => THEME_PREFS.map((p) => ({ value: p, label: t(`theme.${p}`) })));
const fontOptions = computed(() => FONT_PREFS.map((p) => ({ value: p, label: t(`font.${p}`) })));
/** Texto da pré-visualização do código: as sequências que as ligaduras transformam em um símbolo. */
const SAMPLE = 'const ok = a !== b && c >= d;  // -> => != <=';
</script>

<template>
  <GnDialog width="min(560px, 94vw)" labelledby="settings-title" initial-focus='[role="tab"][tabindex="0"]' @close="$emit('close')">
    <div class="sd">
      <h3 id="settings-title">{{ t('settings.title') }}</h3>
      <GnTabs class="sd__tabs" :tabs="tabs" :model-value="tab" @update:model-value="tab = $event as typeof tab" />

      <div class="sd__body" role="tabpanel" :aria-label="tab === 'general' ? t('settings.general') : t('settings.appearance')">
        <template v-if="tab === 'general'">
          <div class="sd__field">
            <span>{{ t('settings.language') }}</span>
            <ComboBox class="sd__combo" block :options="localeOptions" :model-value="locale" :aria-label="t('settings.language')" @update:model-value="setLocale($event as Locale)">
              <template #value>
                <span class="sd__lang"><FlagIcon v-if="flagOf(locale)" :code="flagOf(locale)!" />{{ LOCALES.find((l) => l.id === locale)?.label }}</span>
              </template>
              <template #option="{ option }">
                <FlagIcon v-if="flagOf(option.value)" :code="flagOf(option.value)!" />
                <span class="sd__langname">{{ option.label }}</span>
              </template>
            </ComboBox>
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
        </template>

        <template v-else>
          <div class="sd__field">
            <span>{{ t('settings.theme') }}</span>
            <ComboBox class="sd__combo" block :options="themeOptions" :model-value="themePref" :aria-label="t('settings.theme')" @update:model-value="setThemePref($event as ThemePref)" />
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
        </template>
      </div>

      <div class="sd__btns">
        <GnButton v-if="tab === 'appearance'" type="button" @click="resetFonts()">{{ t('settings.reset') }}</GnButton>
        <GnButton class="sd__close" type="button" @click="$emit('close')">{{ t('home.close') }}</GnButton>
      </div>
    </div>
  </GnDialog>
</template>

<style scoped lang="scss">
// título, abas e botões ficam fixos; só o corpo rola (janela baixa, como 960x600). O corpo tem altura própria para o diálogo não pular ao trocar de aba.
.sd {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 18px 20px;
  h3 { margin: 0 0 10px; font-size: 15px; }
  // as abas do kit são as do cabeçalho (fundo da página); aqui ficam sobre o fundo do diálogo
  &__tabs.gn-tabs { background: transparent; padding: 0; }
  &__body { flex: 0 1 380px; min-height: 0; overflow: auto; padding: 16px 4px 0 0; }
  &__field { display: grid; gap: 4px; margin-bottom: 12px; > span { font-size: 12px; color: var(--gn-muted); } }
  &__combo { max-width: 280px; }
  &__lang { display: inline-flex; align-items: center; gap: 7px; }
  &__seg { justify-self: start; }
  &__chk { display: flex; align-items: center; gap: 8px; cursor: pointer; &--gap { margin-top: 8px; } }
  &__hint { margin: 4px 0 14px 24px; font-size: 12px; color: var(--gn-muted); }
  &__preview { background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); padding: 10px 12px; }
  &__code { margin: 0 0 8px; overflow-x: auto; white-space: pre; }
  &__ui { margin: 0; }
  &__btns { display: flex; gap: 8px; margin-top: 14px; flex: none; }
  &__close { margin-left: auto; }
}
</style>

<!-- A lista do combobox está no <body> (Teleport): o nome ocupa o espaço que sobra, empurrando a marca de seleção para a direita. -->
<style lang="scss">
.cbx__opt .sd__langname { flex: 1; white-space: nowrap; }
</style>
