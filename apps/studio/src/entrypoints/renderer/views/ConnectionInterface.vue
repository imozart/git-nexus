<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton, GnIconButton, GnSegmented, GnTooltip } from '@git-nexus/ui-kit';
import { syncState, type RepoSummary, type RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { HOME_DENSITIES, HOME_FILTERS, HOME_SORTS, changesOf, defaultDir, type HomeDensity, type HomeFilter, type HomeSort } from '../home-core';
import { dateLocale, t, type MessageKey } from '../i18n';
import { agoText, lastFetchText } from '../sync';
import { useRepositoriesStore } from '../stores/repositories';
import { useWorkspaceStore } from '../stores/workspace';
import ChangelogDialog from '../components/ChangelogDialog.vue';
import ComboBox from '../components/ComboBox.vue';
import ContextMenu, { type MenuItem } from '../components/ContextMenu.vue';
import RepoCreateDialog from '../components/RepoCreateDialog.vue';
import SyncIndicator from '../components/SyncIndicator.vue';

const store = useRepositoriesStore();
const ws = useWorkspaceStore();
const manualPath = ref('');
const showChangelog = ref(false);

onMounted(() => store.load());

async function open(repo: RepositoryMeta): Promise<void> {
  ws.openRepo(repo);
  await store.touch(repo.id);
}

/** Clonou ou criou: atualiza a lista, abre o repositório numa aba e avisa (com a observação, se houver). */
async function created(v: { repo: RepositoryMeta; note?: string }, mode: 'clone' | 'init'): Promise<void> {
  store.createDialog = null;
  await store.load();
  store.message = { kind: 'info', text: [t(mode === 'clone' ? 'clone.done' : 'create.done', { name: v.repo.name }), v.note].filter(Boolean).join(' ') };
  await open(v.repo);
}

async function remove(repo: RepositoryMeta): Promise<void> {
  ws.closeRepo(repo.id);
  await store.remove(repo.id);
}

/** Buscar de um repositório: mostra o resultado (antes a falha, por exemplo de autenticação, ficava muda; só o Pull avisava). */
async function fetchOne(r: RepositoryMeta): Promise<void> {
  const res = await store.syncOne(r, 'fetch');
  store.message = { kind: res.ok ? 'info' : 'error', text: `${r.name}: ${res.message}` };
}

async function pullOne(r: RepositoryMeta): Promise<void> {
  const res = await store.syncOne(r, 'pull');
  store.message = { kind: res.ok ? 'info' : 'error', text: `${r.name}: ${res.message}` };
}

async function addManual(): Promise<void> {
  const p = manualPath.value.trim();
  if (!p) return;
  await store.addPath(p);
  if (store.message?.kind === 'info') manualPath.value = '';
}

/** Resumo pronto do repositório (ou `null` enquanto carrega / se deu erro). */
const sum = (r: RepositoryMeta): RepoSummary | null => {
  const s = store.summaries[r.id];
  return s && !('error' in s) ? s : null;
};
const sumError = (r: RepositoryMeta): string => {
  const s = store.summaries[r.id];
  return s && 'error' in s ? s.error : '';
};

const fmt = (ts: number) => (ts ? new Date(ts).toLocaleString(dateLocale.value) : t('home.neverOpened'));
/** "Última busca…: há 12 min · 25/11/2026 14:30": a linha discreta do pé do cartão. */
const footText = (r: RepositoryMeta): string => [lastFetchText(sum(r)), fmt(r.lastOpenedAt)].filter(Boolean).join(' · ');
const commitTip = (s: RepoSummary): string => (s.lastCommit ? `${s.lastCommit.subject}\n${s.lastCommit.author} · ${new Date(s.lastCommit.date).toLocaleString(dateLocale.value)}` : '');

// --- ordem, filtros e densidade ----------------------------------------------------------------------------------------------------------------
const SORT_KEYS: Record<HomeSort, MessageKey> = {
  opened: 'home.sort.opened',
  name: 'home.sort.name',
  branch: 'home.sort.branch',
  changes: 'home.sort.changes',
  behind: 'home.sort.behind',
  activity: 'home.sort.activity',
};
const FILTER_KEYS: Record<HomeFilter, MessageKey> = {
  pending: 'home.onlyPending',
  behind: 'home.f.behind',
  'no-upstream': 'home.f.noUpstream',
  conflict: 'home.f.conflict',
};
const DENSITY_KEYS: Record<HomeDensity, MessageKey> = { comfortable: 'home.density.comfortable', compact: 'home.density.compact', table: 'home.density.table' };
const sortOptions = computed(() => HOME_SORTS.map((s) => ({ value: s, label: t(SORT_KEYS[s]) })));
const densityOptions = computed(() => HOME_DENSITIES.map((d) => ({ value: d, label: t(DENSITY_KEYS[d]) })));
const dirLabel = computed(() => t(store.dir === 'asc' ? 'home.dir.asc' : 'home.dir.desc'));
/** Outra ordenação pelo seletor: começa na direção natural dela (nomes de A a Z; o resto, o maior primeiro). */
function pickSort(v: string): void {
  store.sort = v as HomeSort;
  store.dir = defaultDir(store.sort);
}

/** Colunas do modo Tabela: o cabeçalho de cada uma que dá para ordenar é um botão. */
const COLUMNS: { key: string; sort?: HomeSort; label: MessageKey; cls: string }[] = [
  { key: 'name', sort: 'name', label: 'home.col.name', cls: 'name' },
  { key: 'branch', sort: 'branch', label: 'home.col.branch', cls: 'branch' },
  { key: 'changes', sort: 'changes', label: 'home.col.changes', cls: 'state' },
  { key: 'remote', sort: 'behind', label: 'home.col.remote', cls: 'sync' },
  { key: 'commit', label: 'home.col.commit', cls: 'commit' },
  { key: 'activity', sort: 'activity', label: 'home.col.activity', cls: 'age' },
];
const ariaSort = (c: { sort?: HomeSort }): string => (c.sort && c.sort === store.sort ? (store.dir === 'asc' ? 'ascending' : 'descending') : 'none');

// Com centenas de repositórios, montar todos os cartões de uma vez trava a tela por meio segundo: monta os primeiros já e o resto em fatias, uma por vez.
const CHUNK = 40;
const shown = ref(CHUNK);
const rows = computed(() => store.filtered.slice(0, shown.value));
let timer: ReturnType<typeof setTimeout> | undefined;
function grow(): void {
  clearTimeout(timer);
  if (shown.value >= store.filtered.length) return;
  timer = setTimeout(() => {
    shown.value += CHUNK;
    grow();
  }, 16);
}
watch(() => store.filtered.length, grow, { immediate: true });
onBeforeUnmount(() => clearTimeout(timer));

const countText = computed(() => t('home.count', { n: store.filtered.length, total: store.repos.length }));

// --- menu "mais" de cada repositório ---------------------------------------------------------------------------------------------------------------
const menu = ref<{ x: number; y: number; repo: RepositoryMeta } | null>(null);
const menuItems = computed<MenuItem[]>(() => [
  { id: 'folder', label: t('home.openFolder') },
  { id: 'terminal', label: t('home.openTerminal') },
  { id: 'copy', label: t('home.copyPath') },
  { id: 'sep', separator: true },
  { id: 'remove', label: t('home.removeMenu'), danger: true },
]);
function openMenu(e: MouseEvent, repo: RepositoryMeta): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  menu.value = { x: Math.max(8, r.right - 200), y: r.bottom + 4, repo };
}
async function onMenu(id: string): Promise<void> {
  const r = menu.value?.repo;
  menu.value = null;
  if (!r) return;
  try {
    if (id === 'folder') await api.showItemInFolder(r.path, '');
    else if (id === 'terminal') await api.openInTerminal(r.path);
    else if (id === 'copy') {
      await api.copyText(r.path);
      store.message = { kind: 'info', text: t('home.pathCopied') };
    } else if (id === 'remove') await remove(r);
  } catch (e) {
    store.message = { kind: 'error', text: `${r.name}: ${errMsg(e)}` };
  }
}
</script>

<template>
  <div class="conn">
    <header class="conn__head">
      <div>
        <h1>{{ t('home.title') }}</h1>
        <p class="muted">{{ t('home.subtitle') }}</p>
      </div>
      <div class="conn__actions" data-tour="repos">
        <GnButton variant="primary" :disabled="store.busy" @click="store.addRepository()">{{ t('home.add') }}</GnButton>
        <GnButton :disabled="store.busy" data-testid="home-clone" @click="store.createDialog = 'clone'">{{ t('home.clone') }}<GnTooltip :text="t('clone.tip')" /></GnButton>
        <GnButton :disabled="store.busy" data-testid="home-new" @click="store.createDialog = 'init'">{{ t('home.new') }}<GnTooltip :text="t('create.tip')" /></GnButton>
        <GnButton :disabled="store.busy" @click="store.scanRoots()">{{ t('home.scan') }}</GnButton>
        <GnButton @click="showChangelog = true">{{ t('home.changelog') }}<GnTooltip :text="t('home.changelogTitle')" /></GnButton>
      </div>
    </header>

    <form class="conn__manual" @submit.prevent="addManual">
      <input v-model="manualPath" :placeholder="t('home.pathPlaceholder')" />
      <GnButton type="submit" :disabled="store.busy || !manualPath.trim()">{{ t('home.addPath') }}</GnButton>
    </form>

    <div v-if="store.repos.length" class="conn__bar">
      <input v-model="store.query" class="conn__search" :placeholder="t('home.search')" :aria-label="t('home.search')" />
      <div class="conn__sort" data-testid="home-sort">
        <span class="muted conn__lbl">{{ t('home.sortBy') }}</span>
        <ComboBox class="conn__sortbox" :options="sortOptions" :model-value="store.sort" :aria-label="t('home.sortBy')" @update:model-value="pickSort" />
        <GnIconButton :icon="store.dir === 'asc' ? 'up' : 'down'" :label="dirLabel" :title="t('home.dirToggle', { dir: dirLabel })" data-testid="home-dir" @click="store.dir = store.dir === 'asc' ? 'desc' : 'asc'" />
      </div>
      <GnSegmented :model-value="store.density" :options="densityOptions" :aria-label="t('home.density')" :title="t('home.density')" data-testid="home-density" @update:model-value="store.density = $event as HomeDensity" />
    </div>
    <div v-if="store.repos.length" class="conn__bar conn__bar--filters">
      <div class="conn__chips" role="group" :aria-label="t('home.filter')">
        <GnButton v-for="f in HOME_FILTERS" :key="f" size="sm" :tone="store.filters.includes(f) ? 'accent' : 'neutral'" :aria-pressed="store.filters.includes(f)" :data-filter="f" @click="store.toggleFilter(f)">{{ t(FILTER_KEYS[f]) }}</GnButton>
      </div>
      <span class="muted conn__count" role="status" data-testid="home-count">{{ countText }}</span>
      <span class="conn__grow" />
      <GnButton size="sm" :disabled="!!store.progress" @click="store.refreshSummaries()">{{ t('home.refreshStatus') }}</GnButton>
      <GnButton size="sm" tone="accent" :disabled="!!store.progress" @click="store.fetchAll()">{{ t('home.fetchAll') }}<GnTooltip :text="t('home.fetchAllTitle')" /></GnButton>
      <GnButton size="sm" variant="primary" :disabled="!!store.progress" @click="store.pullSafe()">
        {{ t('home.pullSafe') }}
        <GnTooltip :text="t('home.pullSafeTitle')" />
      </GnButton>
    </div>
    <p v-if="store.progress" class="muted">{{ t('home.progress', { label: store.progress.label, done: store.progress.done, total: store.progress.total }) }}</p>
    <div v-if="store.report" class="report">
      <div class="report__head">
        <strong>{{ store.report.title }}</strong>
        <GnButton size="sm" @click="store.report = null">{{ t('home.close') }}</GnButton>
      </div>
      <p v-if="!store.report.items.length" class="muted">{{ t('home.nothingToDo') }}</p>
      <ul>
        <li v-for="it in store.report.items" :key="it.name" :class="it.ok ? 'ok' : 'bad'">
          {{ it.ok ? '✔' : '✖' }} <strong>{{ it.name }}</strong> — {{ it.text }}
        </li>
      </ul>
    </div>

    <p v-if="store.busy" class="muted">{{ t('home.busy') }}</p>
    <p v-if="store.message" :class="['msg', `msg--${store.message.kind}`]">{{ store.message.text }}</p>

    <!-- catálogo vazio: as três formas de começar (também é a porta do primeiro uso guiado) -->
    <section v-if="store.loaded && !store.repos.length && !store.busy" class="start" data-testid="home-start" :aria-label="t('home.empty')">
      <p class="start__lead">{{ t('home.empty') }} {{ t('home.start.hint') }}</p>
      <div class="start__grid">
        <div class="start__card">
          <strong>{{ t('home.start.add.title') }}</strong>
          <p class="muted">{{ t('home.start.add.desc') }}</p>
          <GnButton variant="primary" :disabled="store.busy" data-testid="home-start-add" @click="store.addRepository()">{{ t('home.add') }}</GnButton>
        </div>
        <div class="start__card">
          <strong>{{ t('home.start.clone.title') }}</strong>
          <p class="muted">{{ t('home.start.clone.desc') }}</p>
          <GnButton data-testid="home-start-clone" @click="store.createDialog = 'clone'">{{ t('home.clone') }}</GnButton>
        </div>
        <div class="start__card">
          <strong>{{ t('home.start.scan.title') }}</strong>
          <p class="muted">{{ t('home.start.scan.desc') }}</p>
          <GnButton data-testid="home-start-scan" @click="store.scanRoots()">{{ t('home.scan') }}</GnButton>
        </div>
      </div>
    </section>
    <p v-else-if="!store.filtered.length && !store.busy" class="muted empty">{{ t('home.noMatch') }}</p>

    <div v-if="store.filtered.length" class="conn__wrap">
      <!-- cabeçalho do modo Tabela: cada coluna ordenável é um botão (a ordem também está no seletor acima, para quem não usa a tabela) -->
      <div v-if="store.density === 'table'" class="conn__thead" data-testid="home-thead">
        <template v-for="c in COLUMNS" :key="c.key">
          <GnButton v-if="c.sort" size="sm" variant="ghost" :class="['th', `th--${c.cls}`]" :aria-label="t('home.sortCol', { col: t(c.label) })" :data-sort-col="c.sort" :aria-description="ariaSort(c)" @click="store.setSort(c.sort)">
            {{ t(c.label) }}<span v-if="c.sort === store.sort" class="th__arrow" aria-hidden="true">{{ store.dir === 'asc' ? '▲' : '▼' }}</span>
          </GnButton>
          <span v-else :class="['th', `th--${c.cls}`]">{{ t(c.label) }}</span>
        </template>
        <span class="th th--btns" />
      </div>

      <ul class="conn__list" :class="`conn__list--${store.density}`" :aria-label="t('home.title')" data-testid="home-list">
        <li v-for="r in rows" :key="r.id" class="repo" :data-repo="r.name" @dblclick="open(r)">
          <div class="repo__main" @click="open(r)">
            <div class="repo__c repo__c--name">
              <strong>{{ r.name }}</strong>
              <GnBadge v-if="r.isWsl" tone="accent">WSL2</GnBadge>
            </div>
            <div class="repo__c repo__c--branch">
              <GnBadge v-if="sum(r)" tone="accent">⎇ {{ sum(r)!.branch }}<GnTooltip :text="sum(r)!.upstream ? t('home.upstream', { name: sum(r)!.upstream ?? '' }) : t('home.noUpstream')" /></GnBadge>
            </div>
            <div class="repo__c repo__c--sync"><SyncIndicator v-if="sum(r)" :sync="sum(r)!" hide-no-upstream /></div>
            <div class="repo__c repo__c--state repo__state">
              <template v-if="sum(r)">
                <GnBadge v-if="changesOf(sum(r)!)" tone="warn">{{ t('home.changes', { n: changesOf(sum(r)!) }) }}<GnTooltip :text="t('home.changesTitle')" /></GnBadge>
                <GnBadge v-if="sum(r)!.conflicted" tone="danger">{{ t('home.conflicts', { n: sum(r)!.conflicted }) }}</GnBadge>
                <GnBadge v-if="sum(r)!.stash" tone="neutral" data-testid="home-stash">{{ t('home.stash', { n: sum(r)!.stash }) }}</GnBadge>
                <GnBadge v-if="!sum(r)!.upstream && !sum(r)!.detached" tone="neutral">{{ t('home.noUpstreamBadge') }}</GnBadge>
                <GnBadge v-if="syncState(sum(r)!) === 'in-sync' && !changesOf(sum(r)!) && !sum(r)!.conflicted" tone="success">{{ t('home.upToDate') }}</GnBadge>
              </template>
              <span v-else-if="sumError(r)" class="state-err">{{ t('home.noStatus') }}<GnTooltip :text="sumError(r)" /></span>
              <span v-else class="muted">{{ t('home.loadingStatus') }}</span>
              <span v-if="store.working[r.id]" class="muted">{{ store.working[r.id] === 'fetch' ? t('home.fetching') : t('home.updating') }}</span>
            </div>
            <div class="repo__c repo__c--commit" data-testid="home-commit">
              <template v-if="sum(r)">
                <template v-if="sum(r)!.lastCommit">
                  <span class="repo__msg">{{ sum(r)!.lastCommit!.subject }}</span>
                  <span class="repo__by">{{ t('home.commitBy', { author: sum(r)!.lastCommit!.author, when: agoText(sum(r)!.lastCommit!.date) }) }}</span>
                  <GnTooltip :text="commitTip(sum(r)!)" />
                </template>
                <span v-else class="muted">{{ t('home.noCommits') }}</span>
              </template>
            </div>
            <div class="repo__c repo__c--age muted" data-testid="home-age">{{ sum(r)?.lastCommit ? agoText(sum(r)!.lastCommit!.date) : '' }}</div>
            <div class="repo__foot">
              <span class="repo__path"><bdi dir="ltr">{{ r.path }}</bdi><GnTooltip :text="r.path" /></span>
              <span class="muted repo__time">{{ footText(r) }}</span>
            </div>
          </div>
          <div class="repo__btns">
            <GnButton size="sm" tone="accent" @click="open(r)">{{ t('home.open') }}</GnButton>
            <GnButton size="sm" :disabled="!!store.working[r.id]" @click="fetchOne(r)">{{ t('home.fetch') }}<GnTooltip :text="t('home.fetchTitle')" /></GnButton>
            <GnButton size="sm" tone="accent" :disabled="!!store.working[r.id] || !sum(r)?.upstream" @click="pullOne(r)">{{ t('home.pull') }}<GnTooltip :text="t('home.pullTitle')" /></GnButton>
            <GnIconButton icon="more" :label="t('home.more')" data-testid="home-more" @click.stop="openMenu($event, r)" />
          </div>
        </li>
      </ul>
    </div>
    <ContextMenu v-if="menu" focus-first :x="menu.x" :y="menu.y" :items="menuItems" @select="onMenu" @close="menu = null" />
    <ChangelogDialog v-if="showChangelog" @close="showChangelog = false" />
    <RepoCreateDialog v-if="store.createDialog" :mode="store.createDialog" @cancel="store.createDialog = null" @done="created($event, store.createDialog!)" />
  </div>
</template>

<style scoped lang="scss">
// A tela cresce com a janela (até ~1400 px): em monitor largo não sobra uma coluna estreita com as laterais vazias.
.conn {
  padding: 20px 28px;
  max-width: 1400px;
  margin: 0 auto;
  h1 { margin: 0 0 4px; font-size: 20px; }
  &__head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
  &__actions { display: flex; flex-wrap: wrap; gap: 8px; }
  &__manual { display: flex; gap: 8px; margin-bottom: 10px; input { flex: 1; } }
  &__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
  &__bar--filters { margin-bottom: 12px; }
  &__search { flex: 1; min-width: 220px; }
  &__sort { display: inline-flex; align-items: center; gap: 6px; }
  &__lbl { font-size: 12px; }
  &__sortbox { min-width: 170px; }
  &__chips { display: inline-flex; flex-wrap: wrap; gap: 6px; }
  &__count { font-size: 12px; }
  &__grow { flex: 1; }
  &__wrap { overflow-x: auto; }
  &__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
}
.muted { color: var(--gn-muted); margin: 0; }
.state-err { color: var(--gn-danger); font-size: 12px; }
.report {
  border: 1px solid var(--gn-border); border-radius: var(--gn-radius); padding: 8px 12px; margin-bottom: 12px; background: var(--gn-bg);
  &__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-size: 12px; max-height: 180px; overflow: auto; }
  .ok { color: var(--gn-success); }
  .bad { color: var(--gn-danger); }
}
.empty { padding: 30px 0; text-align: center; }
.msg {
  padding: 7px 10px;
  border-radius: var(--gn-radius);
  margin: 0 0 10px;
  white-space: pre-wrap;
  &--info { background: rgba(79, 181, 106, 0.12); color: var(--gn-success); }
  &--error { background: rgba(239, 106, 98, 0.12); color: var(--gn-danger); }
}

// --- catálogo vazio ---------------------------------------------------------------------------------------------------------------------------
.start {
  padding: 28px 0;
  &__lead { text-align: center; margin: 0 0 16px; color: var(--gn-muted); }
  &__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  &__card {
    display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 14px 16px;
    background: var(--gn-surface-2); border: 1px solid var(--gn-border); border-radius: var(--gn-radius-lg);
    p { flex: 1; font-size: 12px; margin-bottom: 6px; }
  }
}

// --- um cartão por repositório (as três densidades usam o mesmo HTML; só o CSS muda) ------------------------------------------
.repo {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--gn-surface-2);
  border: 1px solid var(--gn-border);
  border-radius: var(--gn-radius);
  // com centenas de repositórios, o navegador só desenha o que está na tela (o tamanho estimado mantém a barra de rolagem estável)
  content-visibility: auto;
  contain-intrinsic-size: auto 92px;
  &:hover { border-color: var(--gn-accent); }
  &__main { flex: 1; min-width: 0; cursor: pointer; }
  &__btns { display: flex; flex-shrink: 0; gap: 6px; }
  &__c { min-width: 0; }
  &__state { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
  &__msg { color: var(--gn-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  &__by { color: var(--gn-muted); white-space: nowrap; flex-shrink: 0; }
  &__foot { display: flex; align-items: baseline; gap: 12px; }
  // o caminho corta o COMEÇO (o que identifica é o fim: a pasta do projeto); o <bdi dir="ltr"> mantém a ordem certa dos trechos
  &__path { flex: 1; min-width: 0; direction: rtl; text-align: left; font-family: var(--gn-mono); font-size: 12px; color: var(--gn-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__time { font-size: 11px; flex-shrink: 0; white-space: nowrap; }
}

// confortável (padrão): linha 1 nome, branch, sincronização e selos; linha 2 último commit; linha 3 caminho e "última busca"
.conn__list--comfortable .repo__main {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px;
  .repo__c--name { display: inline-flex; align-items: center; gap: 6px; }
  .repo__c--commit { flex: 1 0 100%; display: flex; gap: 6px; font-size: 12px; }
  .repo__c--age { display: none; }
  .repo__foot { flex: 1 0 100%; }
  .repo__c:empty { display: none; }
}

// compacto: uma linha por repositório
.conn__list--compact {
  gap: 4px;
  .repo { padding: 5px 12px; contain-intrinsic-size: auto 38px; }
  .repo__main { display: flex; align-items: center; gap: 4px 10px; }
  .repo__c--name { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 190px; overflow: hidden; strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
  .repo__c--state { flex: 0 1 auto; flex-wrap: nowrap; }
  .repo__c--commit { flex: 1 1 0; display: flex; font-size: 12px; }
  .repo__by, .repo__foot { display: none; }
  .repo__c--age { flex: 0 0 104px; text-align: right; font-size: 12px; white-space: nowrap; }
  .repo__c:empty { display: none; }
}

// tabela: colunas alinhadas, com cabeçalho que ordena. Em janela estreita rola na horizontal em vez de espremer.
$cols: minmax(150px, 1.2fr) minmax(100px, 0.8fr) minmax(210px, 1.5fr) minmax(70px, 0.5fr) minmax(170px, 1.6fr) minmax(100px, 0.6fr);
.conn__thead {
  display: grid; grid-template-columns: $cols 250px; align-items: center; gap: 0 10px; min-width: 1120px;
  padding: 0 15px; margin-bottom: 4px; font-size: 12px; color: var(--gn-muted);
  // o cabeçalho é texto que se clica, não uma fileira de botões com moldura
  .th { text-align: left; justify-content: flex-start; padding: 2px 0; border: none; background: none; color: var(--gn-muted); font-size: 12px; min-width: 0; }
  button.th:hover:not(:disabled) { background: none; color: var(--gn-text); }
  .th__arrow { margin-left: 4px; font-size: 9px; color: var(--gn-accent); }
}
.conn__list--table {
  gap: 2px; min-width: 1120px;
  .repo { padding: 6px 14px; gap: 10px; contain-intrinsic-size: auto 42px; }
  .repo__main { display: grid; grid-template-columns: $cols; align-items: center; gap: 0 10px; }
  .repo__btns { flex: 0 0 250px; }
  // no HTML o selo de sincronização vem antes dos selos de estado (leitura do cartão); a coluna "Alterações" vem antes de "Remoto"
  .repo__c--state { order: 3; }
  .repo__c--sync { order: 4; }
  .repo__c--commit { order: 5; }
  .repo__c--age { order: 6; }
  .repo__c--name { display: inline-flex; align-items: center; gap: 6px; overflow: hidden; strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
  .repo__c--commit { display: flex; font-size: 12px; overflow: hidden; }
  .repo__by, .repo__foot { display: none; }
  .repo__c--age { font-size: 12px; white-space: nowrap; }
  .repo__c--state { flex-wrap: nowrap; overflow: hidden; }
}
</style>
