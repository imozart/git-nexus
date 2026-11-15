<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import type { FileEntry } from '@git-nexus/git-core/pure';
import { checkState, groupEntries, hasStaged, splitPath, statusLabel, statusLetter, type CheckState } from '../changes';
import { t } from '../i18n';

type GroupId = 'changes' | 'unversioned';

const props = defineProps<{ entries: FileEntry[]; conflicted: string[]; activePath: string | null }>();
const emit = defineEmits<{
  (e: 'open', path: string): void;
  /** Incluir (true) ou remover (false) do commit. */
  (e: 'toggle', paths: string[], include: boolean): void;
  /** Arquivos soltos sobre um grupo (arrastar e soltar). */
  (e: 'move', paths: string[], target: GroupId): void;
  (e: 'menu', p: { x: number; y: number; paths: string[] }): void;
  (e: 'resolve'): void;
}>();

// Filtro de arquivos (útil com milhares de alterações): vale para o que se vê, inclusive o checkbox do grupo.
const filter = ref('');
const visibleEntries = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return q ? props.entries.filter((e) => e.path.toLowerCase().includes(q)) : props.entries;
});
const groups = computed(() => groupEntries(visibleEntries.value));
const flat = computed(() => [...groups.value.changes, ...groups.value.unversioned]);
const byPath = computed(() => new Map(props.entries.map((e) => [e.path, e])));

// ---------------------------------------------------------------- seleção (independente do checkbox)
const selection = ref(new Set<string>());
let anchor: string | null = null;
watch(
  () => props.entries,
  (list) => {
    const alive = new Set(list.map((e) => e.path));
    const next = new Set([...selection.value].filter((p) => alive.has(p)));
    if (next.size !== selection.value.size) selection.value = next;
  },
);

function onRowClick(ev: MouseEvent, e: FileEntry) {
  const additive = ev.ctrlKey || ev.metaKey;
  if (ev.shiftKey && anchor) {
    const a = flat.value.findIndex((x) => x.path === anchor);
    const b = flat.value.findIndex((x) => x.path === e.path);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const range = flat.value.slice(lo, hi + 1).map((x) => x.path);
    selection.value = new Set(additive ? [...selection.value, ...range] : range);
  } else if (additive) {
    const next = new Set(selection.value);
    if (!next.delete(e.path)) next.add(e.path);
    selection.value = next;
    anchor = e.path;
  } else {
    selection.value = new Set([e.path]);
    anchor = e.path;
  }
  emit('open', e.path);
}

const selectGroup = (g: GroupId) => (selection.value = new Set(groups.value[g].map((e) => e.path)));

// ---------------------------------------------------------------- checkbox
function groupState(list: FileEntry[]): CheckState {
  if (!list.length) return 'unchecked';
  const states = list.map(checkState);
  if (states.every((s) => s === 'checked')) return 'checked';
  return states.every((s) => s === 'unchecked') ? 'unchecked' : 'partial';
}

/** Linha dentro de uma seleção múltipla: o checkbox vale para todos os selecionados. */
function toggleRow(e: FileEntry) {
  const include = checkState(e) !== 'checked';
  const paths = selection.value.has(e.path) && selection.value.size > 1 ? [...selection.value] : [e.path];
  emit('toggle', paths, include);
}
function toggleGroup(g: GroupId) {
  const list = groups.value[g];
  emit('toggle', list.map((e) => e.path), groupState(list) !== 'checked');
}

// ---------------------------------------------------------------- menu
function openMenu(ev: MouseEvent, e: FileEntry) {
  if (!selection.value.has(e.path)) {
    selection.value = new Set([e.path]);
    anchor = e.path;
  }
  emit('menu', { x: ev.clientX, y: ev.clientY, paths: [...selection.value] });
}
function openGroupMenu(ev: MouseEvent, g: GroupId) {
  const paths = groups.value[g].map((e) => e.path);
  if (!paths.length) return;
  selection.value = new Set(paths);
  emit('menu', { x: ev.clientX, y: ev.clientY, paths });
}

// ---------------------------------------------------------------- arrastar e soltar
const MIME = 'application/x-gitnexus-files';
const dropOver = ref<GroupId | null>(null);

function onDragStart(ev: DragEvent, e: FileEntry) {
  if (!selection.value.has(e.path)) selection.value = new Set([e.path]);
  const paths = [...selection.value];
  ev.dataTransfer?.setData(MIME, JSON.stringify(paths));
  ev.dataTransfer?.setData('text/plain', paths.join('\n'));
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
}
const isOurs = (ev: DragEvent) => ev.dataTransfer?.types.includes(MIME) ?? false;
function onDragOver(ev: DragEvent, g: GroupId) {
  if (!isOurs(ev)) return;
  ev.preventDefault();
  dropOver.value = g;
}
function onDragLeave(ev: DragEvent, g: GroupId) {
  const to = ev.relatedTarget as Node | null;
  if (!to || !(ev.currentTarget as HTMLElement).contains(to)) if (dropOver.value === g) dropOver.value = null;
}
function onDrop(ev: DragEvent, g: GroupId) {
  dropOver.value = null;
  const raw = ev.dataTransfer?.getData(MIME);
  if (!raw) return;
  ev.preventDefault();
  emit('move', JSON.parse(raw) as string[], g);
}

// ---------------------------------------------------------------- seleção por retângulo (arrastar no espaço vazio)
const root = ref<HTMLElement>();
const band = ref<{ left: number; top: number; width: number; height: number } | null>(null);
let bandOrigin: { x: number; y: number; base: Set<string> } | null = null;

function onBandStart(ev: MouseEvent) {
  if (ev.button !== 0) return;
  if ((ev.target as HTMLElement).closest('.file, .grp__head, button, input, .summary')) return;
  bandOrigin = { x: ev.clientX, y: ev.clientY, base: ev.ctrlKey || ev.metaKey ? new Set(selection.value) : new Set() };
  window.addEventListener('mousemove', onBandMove);
  window.addEventListener('mouseup', onBandEnd);
}
function onBandMove(ev: MouseEvent) {
  if (!bandOrigin) return;
  const left = Math.min(bandOrigin.x, ev.clientX);
  const top = Math.min(bandOrigin.y, ev.clientY);
  const width = Math.abs(ev.clientX - bandOrigin.x);
  const height = Math.abs(ev.clientY - bandOrigin.y);
  if (width < 4 && height < 4) return;
  band.value = { left, top, width, height };
  const next = new Set(bandOrigin.base);
  root.value?.querySelectorAll<HTMLElement>('.file[data-path]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.bottom >= top && r.top <= top + height && r.right >= left && r.left <= left + width) next.add(el.dataset.path!);
  });
  selection.value = next;
}
function onBandEnd() {
  bandOrigin = null;
  band.value = null;
  window.removeEventListener('mousemove', onBandMove);
  window.removeEventListener('mouseup', onBandEnd);
}
onBeforeUnmount(onBandEnd);

// ---------------------------------------------------------------- teclado
function onKey(ev: KeyboardEvent) {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') {
    ev.preventDefault();
    selection.value = new Set(flat.value.map((e) => e.path));
  } else if (ev.key === ' ' && selection.value.size) {
    ev.preventDefault();
    const first = byPath.value.get([...selection.value][0]!);
    if (first) emit('toggle', [...selection.value], checkState(first) !== 'checked');
  } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const i = flat.value.findIndex((e) => e.path === props.activePath);
    const next = flat.value[Math.max(0, Math.min(flat.value.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      selection.value = new Set([next.path]);
      anchor = next.path;
      emit('open', next.path);
    }
  }
}

// ---------------------------------------------------------------- apresentação
const collapsed = ref<Record<GroupId, boolean>>({ changes: false, unversioned: false });
const included = computed(() => props.entries.filter(hasStaged).length);
const pending = computed(() => props.entries.length - included.value);
// Só desenha uma janela de linhas por grupo: com milhares de arquivos, desenhar todos custava segundos (e dezenas de
// milhares de nós no DOM). "Mostrar mais" amplia; o filtro e as ações do grupo continuam valendo para TODOS.
const PAGE = 500;
const limit = ref<Record<GroupId, number>>({ changes: PAGE, unversioned: PAGE });
const rows = (g: GroupId) =>
  groups.value[g].slice(0, limit.value[g]).map((e) => ({ e, ...splitPath(e.path), letter: statusLetter(e), state: checkState(e) }));
const hidden = (g: GroupId) => Math.max(0, groups.value[g].length - limit.value[g]);
const showMore = (g: GroupId, all = false) => (limit.value[g] = all ? Number.MAX_SAFE_INTEGER : limit.value[g] + PAGE);
watch(filter, () => (limit.value = { changes: PAGE, unversioned: PAGE }));
// navegar (setas) ou abrir um arquivo além da janela amplia o grupo para ele aparecer
watch(
  () => props.activePath,
  (p) => {
    if (!p) return;
    for (const g of ['changes', 'unversioned'] as GroupId[]) {
      const i = groups.value[g].findIndex((e) => e.path === p);
      if (i >= limit.value[g]) limit.value[g] = i + PAGE;
    }
  },
);

</script>

<template>
  <div ref="root" class="tree" tabindex="0" @mousedown="onBandStart" @keydown="onKey">
    <div class="summary">
      <span :title="t('tree.stagedTitle')"><b>{{ included }}</b> {{ t('tree.inCommit') }}</span>
      <span class="sep">·</span>
      <span :title="t('tree.pendingTitle')"><b>{{ pending }}</b> {{ t('tree.pending', { n: pending }) }}</span>
      <span v-if="selection.size > 1" class="sel">{{ t('tree.selected', { n: selection.size }) }}</span>
    </div>
    <input
      v-if="entries.length > 30 || filter"
      v-model="filter"
      class="filter"
      :placeholder="t('tree.filter')"
      spellcheck="false"
      @mousedown.stop
      @keydown.stop
    />

    <section v-if="conflicted.length" class="grp">
      <div class="grp__head grp__head--warn">
        <span class="grp__title">{{ t('tree.conflicted') }}</span>
        <span class="grp__count">{{ t('tree.files', { n: conflicted.length }) }}</span>
        <GnButton size="sm" variant="primary" @click="emit('resolve')">{{ t('tree.resolve') }}</GnButton>
      </div>
      <div v-for="f in conflicted" :key="f" class="file file--conflict">
        <span class="st st--U">!</span>
        <span class="file__name">{{ splitPath(f).name }}</span>
        <span class="file__dir">{{ splitPath(f).dir }}</span>
      </div>
    </section>

    <section
      v-for="g in (['changes', 'unversioned'] as GroupId[])"
      :key="g"
      class="grp"
      :class="{ 'grp--drop': dropOver === g }"
      @dragover="onDragOver($event, g)"
      @dragleave="onDragLeave($event, g)"
      @drop="onDrop($event, g)"
    >
      <div
        class="grp__head"
        @mousedown.middle.prevent
        @auxclick.middle.prevent="openGroupMenu($event, g)"
        @contextmenu.prevent="openGroupMenu($event, g)"
      >
        <button class="chev" type="button" :class="{ 'chev--closed': collapsed[g] }" :aria-label="collapsed[g] ? t('tree.expand') : t('tree.collapse')" @click="collapsed[g] = !collapsed[g]">▾</button>
        <input
          type="checkbox"
          class="cb"
          :checked="groupState(groups[g]) === 'checked'"
          :indeterminate="groupState(groups[g]) === 'partial'"
          :disabled="!groups[g].length"
          :title="groupState(groups[g]) === 'checked' ? t('tree.removeAll') : t('tree.includeAll')"
          @change="toggleGroup(g)"
        />
        <span class="grp__title" @click="selectGroup(g)">{{ g === 'changes' ? t('tree.changes') : t('tree.unversioned') }}</span>
        <span class="grp__count">{{ t('tree.files', { n: groups[g].length }) }}</span>
      </div>

      <div v-show="!collapsed[g]">
        <div
          v-for="r in rows(g)"
          :key="r.e.path"
          class="file"
          :class="{ 'file--sel': selection.has(r.e.path), 'file--active': activePath === r.e.path }"
          :data-path="r.e.path"
          draggable="true"
          :title="`${statusLabel(r.letter)} · ${r.state === 'checked' ? t('tree.stateChecked') : r.state === 'partial' ? t('tree.statePartial') : t('tree.statePending')}\n${r.e.path}`"
          @click="onRowClick($event, r.e)"
          @dragstart="onDragStart($event, r.e)"
          @mousedown.middle.prevent
          @auxclick.middle.prevent="openMenu($event, r.e)"
          @contextmenu.prevent="openMenu($event, r.e)"
        >
          <input
            type="checkbox"
            class="cb"
            :checked="r.state === 'checked'"
            :indeterminate="r.state === 'partial'"
            @click.stop
            @change="toggleRow(r.e)"
          />
          <span class="st" :class="`st--${r.letter === '?' ? 'N' : r.letter}`">{{ r.letter === '?' ? '+' : r.letter }}</span>
          <span class="file__name" :class="`name--${r.letter === '?' ? 'N' : r.letter}`">{{ r.name }}</span>
          <span class="file__dir">{{ r.dir }}</span>
          <span v-if="r.state === 'partial'" class="tag">{{ t('tree.partialTag') }}</span>
        </div>
        <div v-if="hidden(g)" class="more">
          <GnButton size="sm" @click="showMore(g)">{{ t('tree.showMore', { n: Math.min(PAGE, hidden(g)) }) }}</GnButton>
          <GnButton v-if="hidden(g) > PAGE" size="sm" @click="showMore(g, true)">{{ t('tree.showAll', { n: hidden(g) }) }}</GnButton>
        </div>
        <p v-if="!groups[g].length" class="empty">{{ filter ? t('tree.emptyFilter') : g === 'changes' ? t('tree.emptyChanges') : t('tree.emptyNew') }}</p>
      </div>
    </section>

    <p class="hint">{{ t('tree.hint') }}</p>
    <div v-if="band" class="band" :style="{ left: band.left + 'px', top: band.top + 'px', width: band.width + 'px', height: band.height + 'px' }" />
  </div>
</template>

<style scoped lang="scss">
.tree {
  height: 100%;
  overflow: auto;
  outline: none;
  user-select: none;
  position: relative;
}
.summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  font-size: 12px;
  color: var(--gn-muted);
  border-bottom: 1px solid var(--gn-border);
  b { color: var(--gn-text); }
  .sep { opacity: 0.5; }
  .sel { margin-left: auto; color: var(--gn-accent); }
}
.grp {
  border-bottom: 1px solid var(--gn-border);
  &--drop { background: rgba(79, 134, 247, 0.12); outline: 2px dashed var(--gn-accent); outline-offset: -3px; }
  &__head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    &--warn .grp__title { color: var(--gn-warn); }
  }
  &__title { font-weight: 600; cursor: default; }
  &__count { color: var(--gn-muted); font-size: 12px; flex: 1; }
}
.chev {
  width: 16px;
  padding: 0;
  background: none;
  border: none;
  color: var(--gn-muted);
  cursor: pointer;
  transition: transform 0.12s;
  &--closed { transform: rotate(-90deg); }
}
.cb { margin: 0; accent-color: var(--gn-accent); cursor: pointer; flex-shrink: 0; }
.file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 28px;
  cursor: default;
  white-space: nowrap;
  &:hover { background: var(--gn-surface-2); }
  &--sel { background: rgba(79, 134, 247, 0.16); }
  &--active { background: rgba(79, 134, 247, 0.34); }
  &--conflict { color: var(--gn-warn); padding-left: 12px; }
  &__name { overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; max-width: 60%; }
  &__dir { color: var(--gn-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
}
.st {
  width: 16px;
  height: 16px;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: 4px;
  font: 700 10px/1 var(--gn-mono);
  border: 1px solid currentColor;
  &--M { color: var(--gn-accent); }
  &--A, &--N { color: var(--gn-success); }
  &--D { color: var(--gn-muted); }
  &--R, &--C { color: #c678dd; }
  &--T { color: var(--gn-warn); }
  &--U { color: var(--gn-warn); }
}
.name--M { color: var(--gn-accent); }
.name--A { color: var(--gn-success); }
.name--N { color: #d99a54; }
.name--D { color: var(--gn-muted); text-decoration: line-through; }
.name--R, .name--C { color: #c678dd; }
.tag { font-size: 10px; color: var(--gn-warn); border: 1px solid var(--gn-warn); border-radius: 999px; padding: 0 6px; }
.empty { margin: 0; padding: 2px 28px 8px; font-size: 12px; color: var(--gn-muted); }
.hint { margin: 0; padding: 10px 12px; font-size: 11px; color: var(--gn-muted); }
.band { position: fixed; z-index: 50; pointer-events: none; background: rgba(79, 134, 247, 0.15); border: 1px solid var(--gn-accent); }
.filter { display: block; width: calc(100% - 16px); margin: 6px 8px; }
.more { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 10px; }
</style>
