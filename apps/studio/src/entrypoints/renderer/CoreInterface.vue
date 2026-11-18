<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { encodingLabel, type EncodingChoice } from '@git-nexus/git-core/pure';
import { GnButton, GnIconButton, GnTabs, type GnTab } from '@git-nexus/ui-kit';
import { t } from './i18n';
import EncodingMenu from './components/EncodingMenu.vue';
import LanguagePicker from './components/LanguagePicker.vue';
import ThemePicker from './components/ThemePicker.vue';
import { useAppErrorsStore } from './stores/app-errors';
import { useFileEncodingStore } from './stores/file-encoding';
import { useCommandsStore, shortcutLabel } from './stores/commands';
import { useSettingsStore } from './stores/settings';
import { useUpdateStore } from './stores/update';
import { HOME_TAB, useWorkspaceStore } from './stores/workspace';
import ConnectionInterface from './views/ConnectionInterface.vue';
import RepoView from './views/RepoView.vue';
import GraphView from './views/GraphView.vue';
import MergeView from './views/MergeView.vue';
import ToolsView from './views/ToolsView.vue';

const ws = useWorkspaceStore();
const cmds = useCommandsStore();
const settings = useSettingsStore();
const upd = useUpdateStore();
const fileEnc = useFileEncodingStore();
const appErrors = useAppErrorsStore();

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

const LABEL = computed(() => ({ repo: t('tab.staging'), graph: t('tab.graph'), merge: t('tab.merge'), tools: t('tab.tools') }));

// --- rodapé: codificação do arquivo aberto no diff da aba ativa (clicar abre a lista para escolher outra) ---
const openFile = computed(() => (ws.active?.kind === 'repo' && ws.active.repo ? fileEnc.open[ws.active.repo.id] ?? null : null));
const isAuto = computed(() => !openFile.value || fileEnc.choiceFor(openFile.value.repoPath, openFile.value.path) === 'auto');
const encTip = computed(() => {
  const f = openFile.value;
  if (!f) return '';
  if (f.invalid) return t('enc.invalid', { name: encodingLabel(f.encoding) });
  return isAuto.value
    ? t('enc.tipAuto', { name: encodingLabel(f.encoding) })
    : t('enc.tipChosen', { name: encodingLabel(f.encoding), detected: encodingLabel(f.detected) });
});
const encOpen = ref<{ left: number; top: number } | null>(null);
function toggleEnc(ev: MouseEvent): void {
  if (encOpen.value) return void (encOpen.value = null);
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  encOpen.value = { left: r.left, top: r.top };
}
function pickEnc(choice: EncodingChoice): void {
  const f = openFile.value;
  encOpen.value = null;
  if (f) fileEnc.choose(f.repoPath, f.path, choice); // a tela do repositório relê o arquivo sozinha
}
watch(openFile, (f) => f || (encOpen.value = null)); // trocou de aba ou fechou o arquivo: a lista fecha

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
      <ThemePicker />
      <LanguagePicker />
      <button type="button" class="core__cmd" :title="t('core.commandsTitle')" @click="cmds.open()">
        {{ t('core.commands') }} <kbd>{{ shortcutLabel('Mod+K') }}</kbd>
      </button>
      <GnIconButton class="core__gear" icon="settings" :label="t('core.settings')" :title="`${t('core.settings')} (${shortcutLabel('Mod+,')})`" data-testid="settings-open" @click="settings.open()" />
    </div>
    <div v-if="upd.visible && upd.info" class="upd" role="status">
      <span class="upd__msg">
        ⬆ <strong>{{ t('update.available', { version: upd.info.latest ?? '' }) }}</strong> <span class="upd__cur">{{ t('update.using', { current: upd.info.current }) }}</span>
      </span>
      <template v-if="upd.canInstall && upd.phase === 'idle'">
        <!-- ação principal da faixa (azul sólido); depois de uma falha vira "Tentar de novo", em âmbar (estado de atenção) -->
        <GnButton size="sm" :variant="upd.failed ? undefined : 'primary'" :tone="upd.failed ? 'warn' : undefined" :title="t('update.installTitle')" @click="upd.downloadAndVerify()">
          {{ upd.failed ? t('update.retry') : t('update.install') }}
        </GnButton>
        <!-- a página da release só aparece como saída quando a atualização dentro do app falhou -->
        <GnButton v-if="upd.failed" size="sm" :title="upd.info.assetName ?? t('update.openPage')" @click="upd.download()">{{ t('update.manual') }}</GnButton>
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
        <!-- conclui a atualização (confirmação da pessoa): verde, como os outros "concluir" -->
        <GnButton size="sm" variant="primary" tone="success" :disabled="upd.phase === 'installing'" :title="t('update.restartTitle')" @click="upd.installAndRestart()">
          {{ upd.phase === 'installing' ? t('update.installing') : t('update.restart') }}
        </GnButton>
        <GnButton v-if="upd.failed" size="sm" :title="upd.info.assetName ?? t('update.openPage')" @click="upd.download()">{{ t('update.manual') }}</GnButton>
      </template>
      <GnButton v-else size="sm" variant="primary" :title="upd.info.assetName ?? t('update.openPage')" @click="upd.download()">
        {{ upd.info.assetName ? t('update.download') : t('update.downloadPage') }}
      </GnButton>
      <span v-if="upd.flash" class="upd__err">{{ upd.flash }}</span>
      <GnButton size="sm" tone="accent" @click="upd.openNotes()">{{ t('update.notes') }}</GnButton>
      <span class="upd__sp" />
      <GnButton size="sm" variant="ghost" :title="t('update.laterTitle')" @click="upd.later()">{{ t('update.later') }}</GnButton>
      <GnButton size="sm" variant="ghost" :title="t('update.skipTitle')" @click="upd.skip()">{{ t('update.skip') }}</GnButton>
    </div>
    <div v-else-if="upd.flash" class="upd upd--info" role="status">{{ upd.flash }}</div>
    <div v-if="appErrors.shown && appErrors.logFile" class="upd upd--error" role="alert" data-testid="app-error">
      <span class="upd__msg">{{ t('err.unexpected', { file: appErrors.logFile }) }}</span>
      <span class="upd__sp" />
      <GnButton size="sm" variant="ghost" data-testid="app-error-close" @click="appErrors.dismiss()">{{ t('err.dismiss') }}</GnButton>
    </div>
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
    <footer v-if="openFile" class="core__foot" data-testid="statusbar">
      <span class="core__file" :title="openFile.path">{{ openFile.path }}</span>
      <span v-if="openFile.invalid" class="core__encwarn" role="alert" data-testid="encoding-warning">{{ t('enc.invalidShort') }}</span>
      <GnButton size="sm" :tone="openFile.invalid ? 'warn' : 'neutral'" :title="encTip" :aria-label="encTip" aria-haspopup="dialog" :aria-expanded="encOpen !== null" data-testid="encoding-btn" @click="toggleEnc">{{ encodingLabel(openFile.encoding) }}</GnButton>
    </footer>
    <EncodingMenu v-if="encOpen && openFile" :anchor="encOpen" :current="openFile.encoding" :detected="openFile.detected" :auto="isAuto" @select="pickEnc" @close="encOpen = null" />
  </div>
</template>

<style scoped lang="scss">
.core {
  display: flex;
  flex-direction: column;
  height: 100%;
  // 43px: a altura que a barra sempre teve (antes vinha da bandeira do seletor de idioma, que saiu); os seletores e o botão Comandos esticam até ela
  &__top { display: flex; align-items: stretch; min-height: 43px; background: var(--gn-bg); }
  &__tabs { flex: 1; min-width: 0; }
  // engrenagem: mesma altura, borda e fundo do botão Comandos (e dos seletores de tema e idioma), com o mesmo respiro
  &__gear.gn-btn { align-self: center; flex: none; width: 31px; height: 31px; margin: 0 10px 0 -4px; padding: 0; color: var(--gn-muted); background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); &:hover:not(:disabled) { color: var(--gn-text); border-color: var(--gn-accent); background: var(--gn-surface); } }
  &__cmd { margin: 6px 10px; padding: 0 10px; display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 12px; color: var(--gn-muted); background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); cursor: pointer; &:hover { color: var(--gn-text); border-color: var(--gn-accent); } kbd { font-family: var(--gn-mono); font-size: 11px; } }
  &__panes { flex: 1; min-height: 0; background: var(--gn-surface); }
  &__pane { height: 100%; overflow: auto; }
  &__foot { display: flex; align-items: center; gap: 10px; padding: 3px 10px; background: var(--gn-bg); border-top: 1px solid var(--gn-border); font-size: 12px; color: var(--gn-muted); }
  &__file { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  &__encwarn { color: var(--gn-warn, #d6a23a); }
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
  &--error { background: rgba(229, 100, 107, 0.14); border-bottom-color: var(--gn-danger, #e5646b); word-break: break-all; }
  &__cur { color: var(--gn-muted); }
  &__sp { flex: 1; }
  &__err { color: var(--gn-danger, #e5646b); }
  &__ok { color: var(--gn-success, #4fb477); }
  &__prog { display: inline-flex; align-items: center; gap: 8px; }
  &__bar { display: inline-block; width: 140px; height: 6px; background: var(--gn-border); border-radius: 3px; overflow: hidden; }
  &__fill { display: block; height: 100%; background: var(--gn-accent); transition: width 0.2s; }
  &__bar--busy &__fill { width: 35%; animation: upd-busy 1.1s ease-in-out infinite alternate; }
}
</style>
