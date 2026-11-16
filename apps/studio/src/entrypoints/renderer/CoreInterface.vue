<script setup lang="ts">
import { computed } from 'vue';
import { GnTabs, type GnTab } from '@git-nexus/ui-kit';
import { t } from './i18n';
import LanguagePicker from './components/LanguagePicker.vue';
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

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

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
      <LanguagePicker />
      <button type="button" class="core__cmd" :title="t('core.commandsTitle')" @click="cmds.open()">
        {{ t('core.commands') }} <kbd>{{ shortcutLabel('Mod+K') }}</kbd>
      </button>
    </div>
    <div v-if="upd.visible && upd.info" class="upd" role="status">
      <span class="upd__msg">
        ⬆ <strong>{{ t('update.available', { version: upd.info.latest ?? '' }) }}</strong> <span class="upd__cur">{{ t('update.using', { current: upd.info.current }) }}</span>
      </span>
      <template v-if="upd.canInstall && upd.phase === 'idle'">
        <button type="button" class="upd__btn upd__btn--primary" :title="t('update.installTitle')" @click="upd.downloadAndVerify()">
          {{ upd.failed ? t('update.retry') : t('update.install') }}
        </button>
        <!-- a página da release só aparece como saída quando a atualização dentro do app falhou -->
        <button v-if="upd.failed" type="button" class="upd__btn" :title="upd.info.assetName ?? t('update.openPage')" @click="upd.download()">{{ t('update.manual') }}</button>
      </template>
      <span v-else-if="upd.phase === 'downloading' && upd.preparing" class="upd__prog" role="progressbar" :aria-label="t('update.preparing')">
        {{ t('update.preparing') }}
        <span class="upd__bar upd__bar--busy"><span class="upd__fill" /></span>
      </span>
      <span v-else-if="upd.phase === 'downloading'" class="upd__prog" role="progressbar" :aria-valuenow="upd.percent" aria-valuemin="0" aria-valuemax="100">
        {{ upd.percent > 0 ? t('update.downloadingPct', { pct: upd.percent }) : t('update.downloading') }}
        <span class="upd__bar"><span class="upd__fill" :style="{ width: (upd.percent || 5) + '%' }" /></span>
        <span v-if="upd.progress.total > 0" class="upd__cur">{{ t('update.size', { done: mb(upd.progress.done), total: mb(upd.progress.total) }) }}</span>
      </span>
      <template v-else-if="upd.phase === 'ready' || upd.phase === 'installing'">
        <span class="upd__ok">✔ {{ t('update.ready', { version: upd.info.latest ?? '' }) }}</span>
        <button type="button" class="upd__btn upd__btn--primary" :disabled="upd.phase === 'installing'" :title="t('update.restartTitle')" @click="upd.installAndRestart()">
          {{ upd.phase === 'installing' ? t('update.installing') : t('update.restart') }}
        </button>
        <button v-if="upd.failed" type="button" class="upd__btn" :title="upd.info.assetName ?? t('update.openPage')" @click="upd.download()">{{ t('update.manual') }}</button>
      </template>
      <button v-else type="button" class="upd__btn upd__btn--primary" :title="upd.info.assetName ?? t('update.openPage')" @click="upd.download()">
        {{ upd.info.assetName ? t('update.download') : t('update.downloadPage') }}
      </button>
      <span v-if="upd.flash" class="upd__err">{{ upd.flash }}</span>
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
  &__cmd { margin: 6px 10px; padding: 0 10px; display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 12px; color: var(--gn-muted); background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); cursor: pointer; &:hover { color: var(--gn-text); border-color: var(--gn-accent); } kbd { font-family: var(--gn-mono); font-size: 11px; } }
  &__panes { flex: 1; min-height: 0; background: var(--gn-surface); }
  &__pane { height: 100%; overflow: auto; }
}
@keyframes upd-busy { from { margin-left: 0; } to { margin-left: 65%; } }
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
  &__err { color: var(--gn-danger, #e5646b); }
  &__ok { color: var(--gn-success, #4fb477); }
  &__prog { display: inline-flex; align-items: center; gap: 8px; }
  &__bar { display: inline-block; width: 140px; height: 6px; background: var(--gn-border); border-radius: 3px; overflow: hidden; }
  &__fill { display: block; height: 100%; background: var(--gn-accent); transition: width 0.2s; }
  &__bar--busy &__fill { width: 35%; animation: upd-busy 1.1s ease-in-out infinite alternate; }
  &__btn {
    font: inherit; font-size: 12px; padding: 3px 10px; color: var(--gn-text); background: var(--gn-surface);
    border: 1px solid var(--gn-border); border-radius: var(--gn-radius); cursor: pointer;
    &:hover { border-color: var(--gn-accent); }
    &--primary { background: var(--gn-accent); border-color: var(--gn-accent); color: #fff; }
  }
}
</style>
