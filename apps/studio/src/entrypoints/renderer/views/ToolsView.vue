<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type Component } from 'vue';
import { GnBadge, GnButton, GnIcon, GnTooltip } from '@git-nexus/ui-kit';
import type { RepositoryMeta, ToolsUsage } from '@git-nexus/git-core/pure';
import OperationsPanel from '../components/tools/OperationsPanel.vue';
import StashPanel from '../components/tools/StashPanel.vue';
import FilePanel from '../components/tools/FilePanel.vue';
import RebasePanel from '../components/tools/RebasePanel.vue';
import TagsPanel from '../components/tools/TagsPanel.vue';
import SubmodulesPanel from '../components/tools/SubmodulesPanel.vue';
import LfsPanel from '../components/tools/LfsPanel.vue';
import VersionPanel from '../components/tools/VersionPanel.vue';
import HostingPanel from '../components/tools/HostingPanel.vue';
import { api } from '../api';
import { t, type MessageKey } from '../i18n';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

/** As ferramentas da aba. Cada painel recebe `repo` e se atualiza sozinho ao ficar visível. `optional`: só aparece de cara em quem usa (veja `usage`). */
const TOOLS: Record<string, { title: MessageKey; component: Component; optional?: 'lfs' | 'submodules' }> = {
  ops: { title: 'tools.ops', component: OperationsPanel },
  stash: { title: 'tools.stash', component: StashPanel },
  file: { title: 'tools.file', component: FilePanel },
  rebase: { title: 'tools.rebase', component: RebasePanel },
  tags: { title: 'tools.tags', component: TagsPanel },
  hosting: { title: 'tools.hosting', component: HostingPanel },
  submodules: { title: 'tools.submodules', component: SubmodulesPanel, optional: 'submodules' },
  lfs: { title: 'tools.lfs', component: LfsPanel, optional: 'lfs' },
  version: { title: 'tools.version', component: VersionPanel },
};
/** Grupos por natureza (desfazer, inspecionar, reescrever, integrar, publicar), sempre nesta ordem. */
const GROUPS: Array<{ id: string; title: MessageKey; tools: string[] }> = [
  { id: 'undo', title: 'tools.g.undo', tools: ['ops', 'stash'] },
  { id: 'inspect', title: 'tools.g.inspect', tools: ['file'] },
  { id: 'rewrite', title: 'tools.g.rewrite', tools: ['rebase', 'tags'] },
  { id: 'integration', title: 'tools.g.integration', tools: ['hosting', 'submodules', 'lfs'] },
  { id: 'publish', title: 'tools.g.publish', tools: ['version'] },
];

// --- o que o repositório usa --------------------------------------------------------------------------------------------------------------------------------
const usage = ref<ToolsUsage | null>(null);
async function loadUsage(): Promise<void> {
  try {
    usage.value = await api.getToolsUsage(props.repo.path);
  } catch {
    usage.value = null; // sem a informação, LFS e submódulos ficam em "Mais ferramentas" (continuam ao alcance)
  }
}
onMounted(loadUsage);
watch(() => ws.versions[props.repo.id], loadUsage);
const used = (id: string): boolean => {
  const o = TOOLS[id]!.optional;
  return !o || !!usage.value?.[o];
};

// --- ferramenta atual (lembrada por repositório) ----------------------------------------------------------------------------------------------------------------------
const KEY = `gitnexus.toolsSection.${props.repo.id}`;
const OLD_KEY = 'gitnexus.toolsSection'; // antes era uma só para todos os repositórios
const stored = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
const current = ref(stored && TOOLS[stored] ? stored : 'ops');
/** "Mais ferramentas" aberto (lembrado). Abre sozinho quando a ferramenta escolhida mora lá. */
const MORE_KEY = 'gitnexus.toolsMore';
const moreOpen = ref(localStorage.getItem(MORE_KEY) === '1');
watch(moreOpen, (v) => localStorage.setItem(MORE_KEY, v ? '1' : '0'));

const groups = computed(() =>
  GROUPS.map((g) => ({ ...g, tools: g.tools.filter(used) })).filter((g) => g.tools.length),
);
/** O que este repositório não usa: LFS e submódulos recolhidos (a pessoa que quer começar a usar abre o grupo). */
const more = computed(() => Object.keys(TOOLS).filter((id) => !used(id)));
// a ferramenta atual mora em "Mais ferramentas": o grupo fica aberto para ela aparecer
watch([current, more], () => { if (more.value.includes(current.value)) moreOpen.value = true; }, { immediate: true });

const counter = (id: string): { n: number; tip: string } | null => {
  const u = usage.value;
  if (id === 'stash' && u?.stash) return { n: u.stash, tip: t('tools.cnt.stash', { n: u.stash }) };
  if (id === 'submodules' && u?.submodulesPending) return { n: u.submodulesPending, tip: t('tools.cnt.submodules', { n: u.submodulesPending }) };
  return null;
};

function select(id: string): void {
  current.value = id;
  localStorage.setItem(KEY, id);
}
// pedido externo (menu "Histórico do arquivo" / "Blame", paleta, grafo): troca de ferramenta
watch(
  () => ws.toolsTarget,
  (tg) => {
    if (tg && tg.repoId === props.repo.id && TOOLS[tg.section]) select(tg.section);
  },
  { immediate: true },
);

/** Setas, Home e End percorrem as ferramentas visíveis (e o botão "Mais ferramentas"); a ferramenta muda junto com o foco. */
async function onNavKey(e: KeyboardEvent): Promise<void> {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const nav = (e.currentTarget as HTMLElement).closest('[data-testid="tools-nav"]')!;
  const items = [...nav.querySelectorAll<HTMLElement>('[data-nav]')];
  const i = items.indexOf(e.currentTarget as HTMLElement);
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
  e.preventDefault();
  const el = items[to]!;
  if (el.dataset.tool) select(el.dataset.tool);
  await nextTick();
  el.focus();
}
</script>

<template>
  <div class="tools">
    <nav class="tools__nav" :aria-label="t('tools.nav')">
      <div role="tablist" aria-orientation="vertical" :aria-label="t('tools.nav')" data-testid="tools-nav">
        <div v-for="g in groups" :key="g.id" role="group" class="tools__group" :aria-label="t(g.title)" :data-group="g.id">
          <div class="tools__gtitle" aria-hidden="true">{{ t(g.title) }}</div>
          <GnButton
            v-for="id in g.tools"
            :key="id"
            size="sm"
            variant="ghost"
            role="tab"
            class="tools__tab"
            :class="{ 'tools__tab--on': id === current }"
            :aria-selected="id === current"
            aria-controls="tools-panel"
            :tabindex="id === current ? 0 : -1"
            :data-tool="id"
            data-nav
            @click="select(id)"
            @keydown="onNavKey"
          >
            <span class="tools__name">{{ t(TOOLS[id]!.title) }}</span>
            <GnBadge v-if="counter(id)" tone="neutral" class="tools__count" :data-count="id">{{ counter(id)!.n }}<GnTooltip :text="counter(id)!.tip" /></GnBadge>
          </GnButton>
        </div>

        <div v-if="more.length" role="group" class="tools__group tools__group--more" :aria-label="t('tools.g.more')" data-group="more">
          <GnButton
            size="sm"
            variant="ghost"
            class="tools__morebtn"
            :aria-expanded="moreOpen"
            aria-controls="tools-more"
            :tabindex="more.includes(current) ? -1 : 0"
            data-testid="tools-more-toggle"
            data-nav
            @click="moreOpen = !moreOpen"
            @keydown="onNavKey"
          >
            <GnIcon :name="moreOpen ? 'down' : 'right'" />
            <span class="tools__name">{{ t('tools.g.more') }}</span>
            <GnTooltip :text="t('tools.moreTip')" />
          </GnButton>
          <div v-show="moreOpen" id="tools-more">
            <GnButton
              v-for="id in more"
              :key="id"
              size="sm"
              variant="ghost"
              role="tab"
              class="tools__tab"
              :class="{ 'tools__tab--on': id === current }"
              :aria-selected="id === current"
              aria-controls="tools-panel"
              :tabindex="id === current ? 0 : -1"
              :data-tool="id"
              :data-nav="moreOpen ? '' : undefined"
              @click="select(id)"
              @keydown="onNavKey"
            >
              <span class="tools__name">{{ t(TOOLS[id]!.title) }}</span>
            </GnButton>
          </div>
        </div>
      </div>
    </nav>
    <div id="tools-panel" class="tools__body" role="tabpanel" :aria-label="t(TOOLS[current]!.title)">
      <div class="tools__panel">
        <component :is="TOOLS[current]!.component" :key="current" :repo="repo" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tools {
  display: grid;
  grid-template-columns: 238px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  &__nav { overflow: auto; padding: 12px 8px 12px 12px; border-right: 1px solid var(--gn-border); }
  &__group { display: flex; flex-direction: column; gap: 1px; margin-bottom: 12px; }
  &__gtitle { padding: 0 10px 3px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--gn-muted); }
  &__group--more { margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--gn-border); }
  // .gn-btn junto: ganha do estilo do botão sem !important (mesmo desenho do menu das Configurações)
  .tools__tab.gn-btn, .tools__morebtn.gn-btn {
    justify-content: flex-start;
    width: 100%;
    font: inherit;
    font-size: 12.5px;
    padding: 5px 10px;
    color: var(--gn-muted);
    border: 1px solid transparent;
    border-radius: 6px;
    text-align: left;
    &:hover { color: var(--gn-text); background: var(--gn-surface-2); }
    &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: -2px; }
  }
  .tools__tab--on.gn-btn { color: var(--gn-text); font-weight: 600; background: var(--gn-surface-2); border-color: var(--gn-border); box-shadow: inset 3px 0 0 var(--gn-accent); }
  // nomes longos quebram em duas linhas (nada de reticências: "Arquivo (histórico e …" não diz o que é)
  &__name { flex: 1; min-width: 0; overflow-wrap: anywhere; line-height: 1.3; }
  &__count { flex-shrink: 0; }
  &__body { min-height: 0; overflow: auto; }
  // largura de leitura: em tela larga o painel não se estica até a borda, e o resto da tela não fica um deserto sem fim
  &__panel { max-width: 1280px; }
}
</style>
