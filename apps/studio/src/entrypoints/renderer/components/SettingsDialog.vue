<script setup lang="ts">
// Central de Configurações: menu lateral por seção (Geral, Aparência, Git, Conflitos, Atalhos, Avançado), busca ("assinar", "e-mail", "tema escuro" levam ao campo
// certo, em pt-BR e en) e abertura direta numa seção ou campo (`settings.open('git', 'git-sign')`), que é como o resto do app aponta para cá. Os campos leem e
// escrevem nos MESMOS estados dos controles de antes (seletor de idioma da barra, caixa do seletor de branch, comandos da paleta): nada é duplicado. A mudança vale
// na hora e fica guardada; não há "Salvar" nem "Cancelar". O menu é um `tablist` vertical (setas, Home e End; só a seção ativa entra na ordem do Tab).
// O diálogo é um GnDialog (foco preso, Esc, clique fora, foco devolvido).
import { computed, nextTick, onMounted, ref } from 'vue';
import { GnButton, GnDialog } from '@git-nexus/ui-kit';
import { resetFonts } from '../font';
import { t } from '../i18n';
import { SETTINGS_SECTIONS, searchSettings, type SettingMeta, type SettingsSection } from '../settings-core';
import { useSettingsStore } from '../stores/settings';
import SettingsAdvanced from './settings/SettingsAdvanced.vue';
import SettingsAppearance from './settings/SettingsAppearance.vue';
import SettingsConflicts from './settings/SettingsConflicts.vue';
import SettingsGeneral from './settings/SettingsGeneral.vue';
import SettingsGit from './settings/SettingsGit.vue';
import SettingsShortcuts from './settings/SettingsShortcuts.vue';

defineEmits<{ (e: 'close'): void }>();

const settings = useSettingsStore();
const section = ref<SettingsSection>(settings.target?.section ?? 'general');
const query = ref('');
const panel = ref<HTMLElement>();

const sectionLabel = (s: SettingsSection): string => (s === 'general' || s === 'appearance' ? t(`settings.${s}`) : t(`settings.sec.${s}`));
const results = computed(() => searchSettings(query.value, (m) => t(m.label), sectionLabel));

/** Vai à seção e, se houver, ao campo (foco no primeiro controle dele). */
async function go(sec: SettingsSection, field?: string): Promise<void> {
  query.value = '';
  section.value = sec;
  await nextTick();
  if (!field) return;
  const box = panel.value?.querySelector<HTMLElement>(`[data-setting="${field}"]`);
  box?.scrollIntoView?.({ block: 'nearest' });
  box?.querySelector<HTMLElement>('input, select, button, [tabindex="0"]')?.focus();
}
onMounted(() => {
  const target = settings.target;
  settings.target = null; // o pedido vale uma vez
  if (target?.field) void go(target.section, target.field);
});

function onNavKey(e: KeyboardEvent, i: number): void {
  const n = SETTINGS_SECTIONS.length;
  const to = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  section.value = SETTINGS_SECTIONS[to]!;
  ((e.currentTarget as HTMLElement).parentElement?.children[to] as HTMLElement | undefined)?.focus();
}

/** Esc na busca limpa o texto primeiro (e só um segundo Esc fecha o diálogo); Enter vai ao primeiro resultado. */
function onSearchKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && query.value) {
    e.preventDefault();
    e.stopPropagation();
    query.value = '';
  } else if (e.key === 'Enter' && results.value[0]) {
    e.preventDefault();
    void go(results.value[0].section, results.value[0].id);
  }
}
const open = (m: SettingMeta): Promise<void> => go(m.section, m.id);
</script>

<template>
  <GnDialog width="min(880px, 94vw)" labelledby="settings-title" initial-focus='[role="tab"][tabindex="0"]' @close="$emit('close')">
    <div class="sd">
      <div class="sd__top">
        <h3 id="settings-title">{{ t('settings.title') }}</h3>
        <input v-model="query" class="sd__input sd__search" type="text" :placeholder="t('settings.search')" :aria-label="t('settings.search')" data-testid="settings-search" :data-dialog-esc="query ? 'own' : undefined" @keydown="onSearchKey" />
      </div>

      <div class="sd__main">
        <div class="sd__nav" role="tablist" aria-orientation="vertical" :aria-label="t('settings.nav')" data-testid="settings-nav">
          <GnButton
            v-for="(s, i) in SETTINGS_SECTIONS"
            :key="s"
            size="sm"
            variant="ghost"
            role="tab"
            class="sd__tab"
            :class="{ 'sd__tab--on': s === section && !query }"
            :aria-selected="s === section"
            aria-controls="sd-panel"
            :tabindex="s === section ? 0 : -1"
            :data-section="s"
            @click="go(s)"
            @keydown="onNavKey($event, i)"
          >
            {{ sectionLabel(s) }}
          </GnButton>
        </div>

        <div id="sd-panel" ref="panel" class="sd__body" role="tabpanel" :aria-label="query ? t('settings.searchResults') : sectionLabel(section)">
          <template v-if="query.trim()">
            <ul v-if="results.length" class="sd__results" data-testid="settings-results">
              <li v-for="m in results" :key="m.id">
                <GnButton variant="ghost" class="sd__result" :data-result="m.id" @click="open(m)">
                  <span class="sd__resultsec">{{ sectionLabel(m.section) }} ›</span> {{ t(m.label) }}
                </GnButton>
              </li>
            </ul>
            <p v-else class="muted" role="status">{{ t('settings.searchEmpty', { q: query }) }}</p>
          </template>
          <SettingsGeneral v-else-if="section === 'general'" />
          <SettingsAppearance v-else-if="section === 'appearance'" />
          <SettingsGit v-else-if="section === 'git'" />
          <SettingsConflicts v-else-if="section === 'conflicts'" />
          <SettingsShortcuts v-else-if="section === 'shortcuts'" />
          <SettingsAdvanced v-else />
        </div>
      </div>

      <div class="sd__btns">
        <GnButton v-if="section === 'appearance' && !query" type="button" @click="resetFonts()">{{ t('settings.reset') }}</GnButton>
        <GnButton class="sd__close" type="button" @click="$emit('close')">{{ t('home.close') }}</GnButton>
      </div>
    </div>
  </GnDialog>
</template>

<!-- Sem `scoped`: as seções (components/settings/*) usam as mesmas classes `.sd__*`. Título, busca, menu e botões ficam fixos; só o corpo rola (janela baixa, 960x600). -->
<style lang="scss">
.sd {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 18px 20px;
  h3 { margin: 0; font-size: 15px; }
  &__top { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
  &__search { flex: 1; max-width: 320px; margin-left: auto; }
  &__main { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 16px; min-height: 0; }
  &__nav { display: flex; flex-direction: column; gap: 2px; padding-right: 12px; border-right: 1px solid var(--gn-border); }
  // .gn-btn junto: ganha do estilo do botão sem !important
  .sd__tab.gn-btn {
    justify-content: flex-start;
    font: inherit;
    font-size: 12.5px;
    padding: 6px 10px;
    color: var(--gn-muted);
    border: 1px solid transparent;
    border-radius: 6px;
    &:hover { color: var(--gn-text); background: var(--gn-surface-2); }
    &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: -2px; }
  }
  .sd__tab--on.gn-btn { color: var(--gn-text); font-weight: 600; background: var(--gn-surface-2); border-color: var(--gn-border); box-shadow: inset 3px 0 0 var(--gn-accent); }
  // o corpo tem altura própria para o diálogo não pular ao trocar de seção
  &__body { height: min(470px, calc(100vh - 190px)); min-height: 0; overflow: auto; padding: 2px 6px 0 0; }
  &__h { margin: 18px 0 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; color: var(--gn-muted); &:first-child { margin-top: 0; } }
  &__field { display: grid; gap: 4px; margin-bottom: 12px; > span, > label { font-size: 12px; color: var(--gn-muted); } &--gap { margin-top: 10px; } }
  &__input { width: 100%; max-width: 360px; padding: 5px 8px; font: inherit; color: var(--gn-text); background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: 1px; } }
  &__combo { max-width: 280px; &--wide { max-width: 460px; } }
  &__seg { justify-self: start; }
  &__chk { display: flex; align-items: center; gap: 8px; cursor: pointer; &--gap { margin-top: 8px; } }
  &__hint--field { margin: 2px 0 0; }
  &__hint { margin: 4px 0 14px 24px; font-size: 12px; color: var(--gn-muted); }
  &__status { min-height: 1.2em; margin: 8px 0 0; font-size: 12px; &--ok { color: var(--gn-success, #4fb477); } &--err { color: var(--gn-danger); } }
  &__results { list-style: none; margin: 0; padding: 0; }
  .sd__result.gn-btn { width: 100%; justify-content: flex-start; text-align: left; padding: 7px 8px; }
  &__resultsec { color: var(--gn-muted); margin-right: 4px; }
  &__preview { background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); padding: 10px 12px; }
  &__code { margin: 0 0 8px; overflow-x: auto; white-space: pre; }
  &__ui { margin: 0; }
  &__btns { display: flex; gap: 8px; margin-top: 14px; flex: none; }
  &__close { margin-left: auto; }
}
// A lista do combobox está no <body> (Teleport): o nome ocupa o espaço que sobra, empurrando a marca de seleção para a direita.
.cbx__opt .sd__langname { flex: 1; white-space: nowrap; }
</style>
