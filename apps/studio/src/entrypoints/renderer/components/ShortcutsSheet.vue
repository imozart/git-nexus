<script setup lang="ts">
// Folha de atalhos (Ctrl+/ ou ?): todos os comandos do app, por área, com o atalho que vale agora. Lê o registro de comandos (o mesmo da paleta e das
// Configurações > Atalhos); busca por nome, área ou tecla. Um diálogo comum: foco preso, Esc fecha e o foco volta a quem o abriu.
import { computed, ref } from 'vue';
import { GnButton, GnDialog } from '@git-nexus/ui-kit';
import { t } from '../i18n';
import { buildSheet, sheetCount } from '../shortcuts-sheet-core';
import { shortcutLabel, useCommandsStore } from '../stores/commands';
import { useSettingsStore } from '../stores/settings';

const emit = defineEmits<{ (e: 'close'): void }>();
const cmds = useCommandsStore();
const settings = useSettingsStore();
const query = ref('');

// `listed()` lê o registro na hora (os comandos do repositório aberto entram junto): o mesmo conjunto que a paleta oferece, sem filtrar por "disponível agora"
const groups = computed(() =>
  buildSheet(cmds.listed(), { shortcutOf: cmds.shortcutOf, isCustom: cmds.isCustom, label: shortcutLabel, query: query.value }),
);
const total = computed(() => sheetCount(groups.value));

/** Esc com texto na busca limpa o texto primeiro (só um segundo Esc fecha a folha). */
function onSearchKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && query.value) {
    e.preventDefault();
    e.stopPropagation();
    query.value = '';
  }
}

function editShortcuts(): void {
  emit('close');
  settings.open('shortcuts');
}
</script>

<template>
  <GnDialog width="min(760px, 94vw)" max-height="86vh" labelledby="sheet-title" initial-focus='[data-testid="sheet-search"]' @close="emit('close')">
    <div class="ss" data-testid="shortcuts-sheet">
      <header class="ss__head">
        <div>
          <h3 id="sheet-title">{{ t('sheet.title') }}</h3>
          <p class="ss__hint">{{ t('sheet.hint') }}</p>
        </div>
        <GnButton size="sm" data-testid="sheet-edit" @click="editShortcuts">{{ t('sheet.edit') }}</GnButton>
      </header>
      <input v-model="query" class="ss__q" type="text" :placeholder="t('sheet.search')" :aria-label="t('sheet.search')" data-testid="sheet-search" :data-dialog-esc="query ? 'own' : undefined" @keydown="onSearchKey" />
      <p class="ss__count" role="status" data-testid="sheet-count">{{ t('sheet.count', { n: total }) }}</p>
      <div class="ss__body" tabindex="0" :aria-label="t('sheet.title')">
        <p v-if="!groups.length" class="ss__empty">{{ t('sheet.empty') }}</p>
        <section v-for="g in groups" :key="g.name" class="ss__group" :aria-label="g.name" :data-group="g.name">
          <h4>{{ g.name }}</h4>
          <ul>
            <li v-for="it in g.items" :key="it.id" class="ss__row" :data-cmd="it.id">
              <span class="ss__title">{{ it.title }}</span>
              <span class="ss__keys">
                <template v-if="it.keys.length">
                  <kbd v-for="k in it.keys" :key="k">{{ k }}</kbd>
                </template>
                <span v-else class="ss__none" aria-label="—">—</span>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </GnDialog>
</template>

<style scoped lang="scss">
.ss {
  display: flex; flex-direction: column; gap: 8px; padding: 16px 18px; min-height: 0;
  &__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; h3 { margin: 0 0 2px; font-size: 15px; } }
  &__hint { margin: 0; font-size: 12px; color: var(--gn-muted); }
  &__q { width: 100%; font-size: 13px; padding: 6px 10px; }
  &__count { margin: 0; font-size: 11px; color: var(--gn-muted); }
  &__body { overflow: auto; max-height: min(58vh, 520px); padding-right: 6px; }
  &__empty { margin: 16px 0; text-align: center; color: var(--gn-muted); }
  &__group {
    margin-bottom: 12px;
    h4 { margin: 0 0 4px; padding-bottom: 3px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--gn-muted); border-bottom: 1px solid var(--gn-border); }
    ul { list-style: none; margin: 0; padding: 0; }
  }
  &__row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 3px 2px; font-size: 12.5px; &:hover { background: var(--gn-surface-2); } }
  &__title { min-width: 0; }
  &__keys { display: inline-flex; gap: 6px; flex-shrink: 0; }
  &__none { color: var(--gn-muted); }
  kbd {
    padding: 1px 7px; font: inherit; font-size: 11.5px; color: var(--gn-text); background: var(--gn-surface-2); border: 1px solid var(--gn-border); border-bottom-width: 2px; border-radius: 5px;
  }
}
</style>
