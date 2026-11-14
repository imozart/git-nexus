<script setup lang="ts">
import { computed } from 'vue';
import { GnTabs, type GnTab } from '@git-nexus/ui-kit';
import { LOCALES, locale, setLocale, t, type Locale } from './i18n';
import { useCommandsStore, shortcutLabel } from './stores/commands';
import { useUpdateStore } from './stores/update';
import { HOME_TAB, useWorkspaceStore } from './stores/workspace';
import ConnectionInterface from './views/ConnectionInterface.vue';
import RepoView from './views/RepoView.vue';
import GraphView from './views/GraphView.vue';
import MergeView from './views/MergeView.vue';
import ToolsView from './views/ToolsView.vue';

const ws = useWorkspaceStore();
const cmds = useCommandsStore();
const upd = useUpdateStore();

const LABEL = computed(() => ({ repo: t('tab.staging'), graph: t('tab.graph'), merge: t('tab.merge'), tools: t('tab.tools') }));

const tabs = computed<GnTab[]>(() =>
  ws.tabs.map((tab) =>
    tab.kind === 'home'
      ? { id: tab.id, title: t('tab.home') }
      : { id: tab.id, title: tab.repo?.name ?? '?', subtitle: LABEL.value[tab.kind], closable: true },
  ),
);
</script>

<template>
  <div class="core">
    <div class="core__top">
      <GnTabs class="core__tabs" :tabs="tabs" :model-value="ws.activeId" @update:model-value="ws.activeId = $event" @close="ws.close" />
      <select class="core__lang" :value="locale" :title="t('core.language')" :aria-label="t('core.language')" @change="setLocale(($event.target as HTMLSelectElement).value as Locale)">
        <option v-for="l in LOCALES" :key="l.id" :value="l.id">{{ l.label }}</option>
      </select>
      <button type="button" class="core__cmd" :title="t('core.commandsTitle')" @click="cmds.open()">
        {{ t('core.commands') }} <kbd>{{ shortcutLabel('Mod+K') }}</kbd>
      </button>
    </div>
    <div v-if="upd.visible && upd.info" class="upd" role="status">
      <span class="upd__msg">
        ⬆ <strong>{{ t('update.available', { version: upd.info.latest ?? '' }) }}</strong> <span class="upd__cur">{{ t('update.using', { current: upd.info.current }) }}</span>
      </span>
      <button type="button" class="upd__btn upd__btn--primary" :title="upd.info.assetName ?? t('update.openPage')" @click="upd.download()">
        {{ upd.info.assetName ? t('update.download') : t('update.downloadPage') }}
      </button>
      <button type="button" class="upd__btn" @click="upd.openNotes()">{{ t('update.notes') }}</button>
      <span class="upd__sp" />
      <button type="button" class="upd__btn" :title="t('update.laterTitle')" @click="upd.later()">{{ t('update.later') }}</button>
      <button type="button" class="upd__btn" :title="t('update.skipTitle')" @click="upd.skip()">{{ t('update.skip') }}</button>
    </div>
    <div v-else-if="upd.flash" class="upd upd--info" role="status">{{ upd.flash }}</div>
    <div class="core__panes">
      <!-- v-show: mantém o estado (editor, seleção, rascunho do commit) ao alternar entre abas -->
      <section v-for="t in ws.tabs" v-show="t.id === ws.activeId" :key="t.id" class="core__pane">
        <ConnectionInterface v-if="t.id === HOME_TAB" />
        <RepoView v-else-if="t.kind === 'repo' && t.repo" :repo="t.repo" />
        <GraphView v-else-if="t.kind === 'graph' && t.repo" :repo="t.repo" />
        <MergeView v-else-if="t.kind === 'merge' && t.repo" :repo="t.repo" />
        <ToolsView v-else-if="t.kind === 'tools' && t.repo" :repo="t.repo" />
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.core {
  display: flex;
  flex-direction: column;
  height: 100%;
  &__top { display: flex; align-items: stretch; background: var(--gn-bg); }
  &__tabs { flex: 1; min-width: 0; }
  &__lang { margin: 6px 0 6px 10px; padding: 0 6px; font: inherit; font-size: 12px; color: var(--gn-muted); background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); }
  &__cmd { margin: 6px 10px; padding: 0 10px; display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 12px; color: var(--gn-muted); background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); cursor: pointer; &:hover { color: var(--gn-text); border-color: var(--gn-accent); } kbd { font-family: var(--gn-mono); font-size: 11px; } }
  &__panes { flex: 1; min-height: 0; background: var(--gn-surface); }
  &__pane { height: 100%; overflow: auto; }
}
.upd {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
  padding: 7px 14px;
  background: rgba(79, 134, 247, 0.16);
  border-bottom: 1px solid var(--gn-accent);
  font-size: 13px;
  &--info { background: var(--gn-surface-2); border-bottom-color: var(--gn-border); color: var(--gn-muted); }
  &__cur { color: var(--gn-muted); }
  &__sp { flex: 1; }
  &__btn {
    font: inherit; font-size: 12px; padding: 3px 10px; color: var(--gn-text); background: var(--gn-surface);
    border: 1px solid var(--gn-border); border-radius: var(--gn-radius); cursor: pointer;
    &:hover { border-color: var(--gn-accent); }
    &--primary { background: var(--gn-accent); border-color: var(--gn-accent); color: #fff; }
  }
}
</style>
