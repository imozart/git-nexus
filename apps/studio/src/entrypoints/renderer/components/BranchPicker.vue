<script setup lang="ts">
// Seletor de branch do cabeçalho do repositório: mostra a branch atual e, ao clicar, abre a busca (locais E remotas), as ações do projeto
// (atualizar, nova branch, ir para tag ou commit) e as listas Recentes, Locais e Remotas. Clicar numa branch abre o menu dela (checkout,
// nova branch a partir dela, merge, rebase, pull, excluir). Todas as operações passam por git-core/branches.ts; aqui só há interface.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton, GnIcon, GnIconButton } from '@git-nexus/ui-kit';
import type { BaseComparison, BranchActionResult, BranchInfo, BranchList, PullMode, RepositoryMeta, SyncInfo } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { autoFetchEnabled } from '../auto-fetch';
import { t } from '../i18n';
import { baseChip, baseText, lastFetchText, syncText } from '../sync';
import { runSyncOp } from '../sync-ops';
import BranchDialog, { type NewBranchSubmit } from './BranchDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import SyncIndicator from './SyncIndicator.vue';

/** `sync`: estado da branch atual com o remoto (adiante/atrás); `base`: o mesmo em relação à branch principal (origin/main). Sem eles o botão mostra só o nome. */
const props = defineProps<{ repo: RepositoryMeta; branch: string; sync?: SyncInfo | null; base?: BaseComparison | null }>();
const emit = defineEmits<{
  (e: 'changed'): void;
  (e: 'notice', text: string): void;
  /** Merge, rebase ou pull parou por conflitos: a tela leva a pessoa até eles. */
  (e: 'conflict'): void;
}>();

const EXPANDED_KEY = 'gitnexus.branchPicker.expanded';
type SectionId = 'recent' | 'local' | 'remote';

const open = ref(false);
const loading = ref(false);
const busy = ref(false);
const data = ref<BranchList | null>(null);
const q = ref('');
/** Filtro "Só desatualizadas": locais atrás do remoto, divergidas ou com a remota apagada. */
const onlyStale = ref(false);
const isStale = (b: BranchInfo) => b.kind === 'local' && (b.gone || b.behind > 0);
const error = ref('');
const trigger = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const panelPos = ref({ left: 0, top: 0, maxHeight: 480 });

const expanded = ref<Record<SectionId, boolean>>({ recent: true, local: true, remote: false });
try {
  const saved = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? 'null') as Partial<Record<SectionId, boolean>> | null;
  if (saved) expanded.value = { ...expanded.value, ...saved };
} catch {
  /* preferência corrompida: usa o padrão */
}

/** Antes de o status chegar a branch vem vazia: mostra reticências (como o cabeçalho sempre fez), não "desanexado". */
const label = computed(() => props.branch || '…');
const syncLine = computed(() => syncText(props.sync));
const baseLine = computed(() => baseText(props.base));
const baseChipText = computed(() => baseChip(props.base));
/** Relógio do tooltip ("há 4 min" precisa andar sozinho): um tique por minuto, só enquanto o botão existe. */
const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  nowTimer = setInterval(() => (now.value = Date.now()), 60_000);
});
/** Tooltip: o que o botão faz, em que pé a branch está com o remoto e quando foi a última busca. */
const triggerTitle = computed(() => [t('bp.triggerTip'), syncLine.value, baseLine.value, lastFetchText(props.sync, now.value)].filter(Boolean).join('\n'));
/** O nome acessível do botão leva o estado por extenso (as setas ficam escondidas dos leitores de tela). */
const triggerLabel = computed(() => [label.value, syncLine.value, baseLine.value].filter(Boolean).join('. '));
const cur = computed(() => data.value?.current ?? props.branch);
const curLabel = computed(() => cur.value || data.value?.head || t('bp.detached'));
const needle = computed(() => q.value.trim().toLowerCase());
const matches = (b: BranchInfo) => !needle.value || b.name.toLowerCase().includes(needle.value);

interface Group { key: string; title?: string; rows: BranchInfo[] }
interface Section { id: SectionId; title: string; count: number; groups: Group[] }

/** Recentes, Locais e Remotas (estas agrupadas por remoto). Com a pesquisa, só entram as que combinam e as seções ficam abertas. */
const sections = computed<Section[]>(() => {
  const d = data.value;
  if (!d) return [];
  const byName = new Map(d.locals.map((b) => [b.name, b]));
  const out: Section[] = [];
  const recent = needle.value ? [] : d.recent.map((n) => byName.get(n)).filter((b): b is BranchInfo => !!b && (!onlyStale.value || isStale(b)));
  if (recent.length) out.push({ id: 'recent', title: t('bp.recent'), count: recent.length, groups: [{ key: 'recent', rows: recent }] });
  const locals = d.locals.filter((b) => matches(b) && (!onlyStale.value || isStale(b)));
  if (locals.length) out.push({ id: 'local', title: t('bp.local'), count: locals.length, groups: [{ key: 'local', rows: locals }] });
  const remoteGroups = onlyStale.value
    ? [] // "desatualizada" só faz sentido numa branch local
    : d.remoteNames
    .map((remote) => ({ key: `remote:${remote}`, title: remote, rows: d.remotes.filter((b) => b.remote === remote && matches(b)) }))
    .filter((g) => g.rows.length);
  if (remoteGroups.length) out.push({ id: 'remote', title: t('bp.remote'), count: remoteGroups.reduce((n, g) => n + g.rows.length, 0), groups: remoteGroups });
  return out;
});
const isOpen = (id: SectionId) => !!needle.value || onlyStale.value || expanded.value[id];
function toggleSection(id: SectionId): void {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] };
  localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded.value));
}

/** Parte do nome que combina com a pesquisa, para realçar. */
function parts(name: string): [string, string, string] {
  const i = needle.value ? name.toLowerCase().indexOf(needle.value) : -1;
  return i < 0 ? [name, '', ''] : [name.slice(0, i), name.slice(i, i + needle.value.length), name.slice(i + needle.value.length)];
}

// ---------------------------------------------------------------- abrir e fechar
async function load(): Promise<void> {
  loading.value = true;
  try {
    data.value = await api.listBranches(props.repo.path);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

function placePanel(): void {
  const r = trigger.value?.getBoundingClientRect();
  if (!r) return;
  const width = 380;
  panelPos.value = { left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 6, maxHeight: Math.max(240, window.innerHeight - r.bottom - 20) };
}

async function toggle(): Promise<void> {
  if (open.value) return closeAll();
  q.value = '';
  onlyStale.value = false;
  error.value = '';
  fly.value = null;
  placePanel();
  open.value = true;
  await load();
  await nextTick();
  search.value?.focus();
}

function closeAll(): void {
  open.value = false;
  fly.value = null;
  (trigger.value?.querySelector('button') ?? trigger.value)?.focus?.();
}

// ---------------------------------------------------------------- menu de uma branch
interface Fly { info: BranchInfo; left: number; top: number; from: HTMLElement }
const fly = ref<Fly | null>(null);
const flyEl = ref<HTMLElement | null>(null);

function openFly(info: BranchInfo, ev: Event | HTMLElement, focusFirst = false): void {
  const from = ev instanceof HTMLElement ? ev : (ev.currentTarget as HTMLElement);
  const r = from.getBoundingClientRect();
  const width = 320;
  const left = r.right + 6 + width > window.innerWidth ? Math.max(8, r.left - width - 6) : r.right + 6;
  fly.value = { info, left, top: Math.max(8, Math.min(r.top - 6, window.innerHeight - 330)), from };
  if (focusFirst) void nextTick(() => flyEl.value?.querySelector<HTMLElement>('[data-fly]:not(:disabled)')?.focus());
}
function closeFly(refocus = true): void {
  const from = fly.value?.from;
  fly.value = null;
  if (refocus) from?.focus();
}

interface FlyAction { id: string; label: string; disabled?: boolean; danger?: boolean; sepBefore?: boolean; run: () => void }
const flyActions = computed<FlyAction[]>(() => {
  const f = fly.value;
  if (!f) return [];
  const b = f.info;
  const ref = b.name;
  const here = b.current;
  const detached = !cur.value;
  const out: FlyAction[] = [
    { id: 'checkout', label: t('bp.checkout'), disabled: here, run: () => void doCheckout(b) },
    { id: 'new', label: t('bp.newFrom', { ref }), run: () => startNew(`${b.kind}:${ref}`) },
    { id: 'merge', label: t('bp.merge', { ref, cur: curLabel.value }), disabled: here || detached, sepBefore: true, run: () => void doMerge(b) },
    { id: 'rebase', label: t('bp.rebase', { ref, cur: curLabel.value }), disabled: here || detached, run: () => askRebase(b) },
  ];
  if (b.kind === 'remote') {
    out.push({ id: 'pull-rebase', label: t('bp.pullRebase', { cur: curLabel.value }), disabled: detached, sepBefore: true, run: () => void doPull(b, 'rebase') });
    out.push({ id: 'pull-merge', label: t('bp.pullMerge', { cur: curLabel.value }), disabled: detached, run: () => void doPull(b, 'merge') });
  }
  if (b.kind === 'local') out.push({ id: 'delete', label: t('bp.delete'), disabled: here, danger: true, sepBefore: true, run: () => askDelete(b) });
  return out;
});

// ---------------------------------------------------------------- operações
function finish(r: BranchActionResult): void {
  open.value = false;
  fly.value = null;
  emit('notice', r.warning ? `${r.message} ${r.warning}` : r.message);
  emit('changed');
}

/** Executa uma operação do painel: sucesso fecha e avisa; conflito fecha e leva aos conflitos; outro erro fica visível dentro do painel. */
async function run(fn: () => Promise<BranchActionResult>): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  error.value = '';
  try {
    const r = await fn();
    if (r.ok) {
      finish(r);
      return true;
    }
    if (r.conflicted) {
      open.value = false;
      fly.value = null;
      emit('notice', r.message);
      emit('conflict');
      return false;
    }
    error.value = r.message;
    fly.value = null;
    return false;
  } catch (e) {
    error.value = errMsg(e);
    return false;
  } finally {
    busy.value = false;
  }
}

const doCheckout = (b: BranchInfo) => run(() => api.checkoutBranch(props.repo.path, b.name, b.kind));
const doMerge = (b: { name: string }) => run(() => api.mergeBranch(props.repo.path, b.name));
const doPull = (b: BranchInfo, mode: PullMode) => run(() => api.pullBranch(props.repo.path, b.name, mode));
const doUpdate = () => run(async () => (await runSyncOp(props.repo.path, 'update', () => api.updateRepo(props.repo.path, 'ff'))) ?? { ok: false, message: t('ss.updating') });

// ---------------------------------------------------------------- confirmações (rebase e exclusão)
type Confirm = { kind: 'rebase'; b: { name: string } } | { kind: 'delete'; b: BranchInfo; force: boolean };
const confirm = ref<Confirm | null>(null);
const askRebase = (b: { name: string }) => {
  fly.value = null;
  open.value = false;
  confirm.value = { kind: 'rebase', b };
};
const askDelete = (b: BranchInfo) => {
  fly.value = null;
  open.value = false;
  confirm.value = { kind: 'delete', b, force: false };
};

const confirmView = computed(() => {
  const c = confirm.value;
  if (!c) return null;
  if (c.kind === 'rebase') {
    const p = { ref: c.b.name, cur: curLabel.value };
    return { title: t('bp.rebaseTitle', p), lines: [t('bp.rebaseLine1', p), t('bp.rebaseLine2')], label: t('bp.rebaseConfirm'), danger: true };
  }
  return c.force
    ? { title: t('bp.deleteForceTitle', { name: c.b.name }), lines: [t('bp.deleteForceLine')], label: t('bp.deleteForceConfirm'), danger: true }
    : { title: t('bp.deleteTitle', { name: c.b.name }), lines: [t('bp.deleteLine')], label: t('bp.delete'), danger: true };
});

async function doConfirm(): Promise<void> {
  const c = confirm.value;
  if (!c || busy.value) return;
  busy.value = true;
  try {
    const r = c.kind === 'rebase' ? await api.rebaseOntoBranch(props.repo.path, c.b.name) : await api.deleteBranch(props.repo.path, c.b.name, c.force);
    if (r.needsForce && c.kind === 'delete') {
      confirm.value = { ...c, force: true }; // tem commits que só existem nela: pede a segunda confirmação
      return;
    }
    confirm.value = null;
    emit('notice', r.message);
    if (r.conflicted) emit('conflict');
    else if (r.ok) emit('changed');
  } catch (e) {
    confirm.value = null;
    emit('notice', errMsg(e));
  } finally {
    busy.value = false;
  }
}

// ---------------------------------------------------------------- diálogos (nova branch, ir para tag ou commit)
const dialog = ref<{ mode: 'new' | 'revision'; initialBase?: string } | null>(null);
const dlgBusy = ref(false);
const dlgError = ref('');

function startNew(initialBase?: string): void {
  fly.value = null;
  open.value = false;
  dlgError.value = '';
  dialog.value = { mode: 'new', ...(initialBase ? { initialBase } : {}) };
}
function startRevision(): void {
  open.value = false;
  dlgError.value = '';
  dialog.value = { mode: 'revision' };
}
async function runDialog(fn: () => Promise<BranchActionResult>): Promise<void> {
  if (dlgBusy.value) return;
  dlgBusy.value = true;
  dlgError.value = '';
  try {
    const r = await fn();
    if (r.ok) {
      dialog.value = null;
      emit('notice', r.warning ? `${r.message} ${r.warning}` : r.message);
      emit('changed');
    } else dlgError.value = r.message;
  } catch (e) {
    dlgError.value = errMsg(e);
  } finally {
    dlgBusy.value = false;
  }
}
const submitNew = (v: NewBranchSubmit) => runDialog(() => api.createBranch(props.repo.path, v));
const submitRevision = (rev: string) => runDialog(() => api.checkoutRevision(props.repo.path, rev));
function closeDialog(): void {
  dialog.value = null;
  (trigger.value?.querySelector('button') ?? trigger.value)?.focus?.();
}

// ---------------------------------------------------------------- teclado
function navItems(): HTMLElement[] {
  return [...(panel.value?.querySelectorAll<HTMLElement>('[data-nav]:not(:disabled)') ?? [])];
}
/** Esc vale em qualquer lugar enquanto o painel está aberto (mesmo com o foco fora dele): fecha primeiro o menu da branch, depois o painel. */
function onDocKey(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape' || ev.defaultPrevented) return;
  ev.preventDefault();
  if (fly.value) closeFly();
  else closeAll();
}
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('keydown', onDocKey);
  else document.removeEventListener('keydown', onDocKey);
});

function onPanelKey(ev: KeyboardEvent): void {
  const items = navItems();
  const active = document.activeElement as HTMLElement | null;
  const i = active ? items.indexOf(active) : -1;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const next = ev.key === 'ArrowDown' ? items[i + 1] ?? items[0] : i <= 0 ? search.value : items[i - 1];
    next?.focus();
  } else if (ev.key === 'ArrowRight' && active?.dataset.branch) {
    const info = rowInfo(active.dataset.branch);
    if (info) {
      ev.preventDefault();
      openFly(info, active, true);
    }
  }
}
function onFlyKey(ev: KeyboardEvent): void {
  const items = [...(flyEl.value?.querySelectorAll<HTMLElement>('[data-fly]:not(:disabled)') ?? [])];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (ev.key === 'Escape' || ev.key === 'ArrowLeft') {
    ev.preventDefault();
    ev.stopPropagation();
    closeFly();
  } else if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    (items[i + 1] ?? items[0])?.focus();
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    (items[i - 1] ?? items[items.length - 1])?.focus();
  }
}
function rowInfo(key: string): BranchInfo | undefined {
  const d = data.value;
  return d ? [...d.locals, ...d.remotes].find((b) => `${b.kind}:${b.name}` === key) : undefined;
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKey);
  clearInterval(nowTimer);
});
</script>

<template>
  <span ref="trigger" class="bp">
    <GnButton size="sm" tone="accent" class="bp__btn" aria-haspopup="dialog" :aria-expanded="open" :aria-label="triggerLabel" :title="triggerTitle" @click="toggle">
      <GnIcon name="git-branch" />
      <span class="bp__name">{{ label }}</span>
      <SyncIndicator :sync="sync ?? null" />
      <GnBadge v-if="baseChipText" class="bp__basechip" :title="baseLine" aria-hidden="true">{{ baseChipText }}</GnBadge>
      <GnIcon name="chevron-down" />
    </GnButton>
  </span>

  <Teleport to="body">
    <div v-if="open" class="bp__layer" @mousedown.self="closeAll">
      <div
        ref="panel"
        class="bp__panel"
        role="dialog"
        :aria-label="t('bp.title')"
        :style="{ left: panelPos.left + 'px', top: panelPos.top + 'px', maxHeight: panelPos.maxHeight + 'px' }"
        @keydown="onPanelKey"
      >
        <div class="bp__search">
          <GnIcon name="search" />
          <input ref="search" v-model="q" type="search" :placeholder="t('bp.search')" :aria-label="t('bp.search')" spellcheck="false" autocomplete="off" />
          <GnIconButton v-if="q" icon="x" variant="ghost" :label="t('bp.clear')" @click="q = ''" />
        </div>
        <p v-if="error" class="bp__err" role="alert">{{ error }}</p>

        <label class="bp__opt" :title="t('bp.onlyStaleTip')"><input v-model="onlyStale" type="checkbox" data-nav data-testid="stale-filter" /> {{ t('bp.onlyStale') }}</label>
        <div class="bp__scroll">
          <template v-if="!needle">
            <button type="button" class="bp__item" data-nav :disabled="busy || loading" :title="t('bp.updateTip')" @click="doUpdate()">
              <GnIcon name="update" /> {{ t('bp.update') }}
            </button>
            <button type="button" class="bp__item" data-nav :disabled="!data" @click="startNew()"><GnIcon name="plus" /> {{ t('bp.new') }}</button>
            <button type="button" class="bp__item" data-nav :disabled="!data" @click="startRevision()"><GnIcon name="tag" /> {{ t('bp.revision') }}</button>
            <template v-if="base">
              <p class="bp__baseinfo" data-testid="base-info" :title="baseLine">{{ t('bp.baseInfo', { base: base.base, ahead: base.ahead, behind: base.behind }) }}</p>
              <template v-if="base.behind > 0">
                <button type="button" class="bp__item" data-nav data-testid="base-merge" :disabled="busy || !cur" @click="doMerge({ name: base.base })">{{ t('bp.merge', { ref: base.base, cur: curLabel }) }}</button>
                <button type="button" class="bp__item" data-nav data-testid="base-rebase" :disabled="busy || !cur" @click="askRebase({ name: base.base })">{{ t('bp.rebase', { ref: base.base, cur: curLabel }) }}</button>
              </template>
            </template>
            <label class="bp__opt" :title="t('bp.autoFetchTip')"><input v-model="autoFetchEnabled" type="checkbox" data-nav data-testid="auto-fetch" /> {{ t('bp.autoFetch') }}</label>
            <hr />
          </template>

          <p v-if="loading && !data" class="bp__muted">{{ t('bp.loading') }}</p>
          <p v-else-if="needle && !sections.length" class="bp__muted">{{ t('bp.noMatch', { q: q.trim() }) }}</p>
          <p v-else-if="onlyStale && !sections.length" class="bp__muted" data-testid="stale-none">{{ t('bp.noStale') }}</p>

          <section v-for="s in sections" :key="s.id">
            <button type="button" class="bp__sec" data-nav :aria-expanded="isOpen(s.id)" @click="toggleSection(s.id)">
              <GnIcon :name="isOpen(s.id) ? 'chevron-down' : 'chevron-right'" /> {{ s.title }}
              <GnBadge>{{ s.count }}</GnBadge>
            </button>
            <template v-if="isOpen(s.id)">
              <div v-for="g in s.groups" :key="g.key" class="bp__group">
                <div v-if="g.title" class="bp__remote"><GnIcon name="folder" /> {{ g.title }}</div>
                <button
                  v-for="b in g.rows"
                  :key="b.kind + ':' + b.name"
                  type="button"
                  class="bp__row"
                  :class="{ 'bp__row--cur': b.current, 'bp__row--open': fly?.info === b }"
                  :style="g.title ? { paddingLeft: '34px' } : undefined"
                  data-nav
                  :data-branch="b.kind + ':' + b.name"
                  aria-haspopup="menu"
                  :aria-expanded="fly?.info === b"
                  :title="`${b.subject} · ${b.hash}`"
                  @click="openFly(b, $event)"
                  @dblclick="!b.current && doCheckout(b)"
                  @keydown.enter.prevent="!b.current && doCheckout(b)"
                >
                  <GnIcon :name="b.current ? 'check' : 'git-branch'" />
                  <span class="bp__label">
                    <template v-for="(p, i) in parts(g.title ? b.short : b.name)" :key="i">
                      <mark v-if="i === 1 && p">{{ p }}</mark>
                      <template v-else>{{ p }}</template>
                    </template>
                  </span>
                  <SyncIndicator v-if="b.kind === 'local'" :sync="b" hide-no-upstream />
                  <GnIcon class="bp__more" name="chevron-right" />
                </button>
              </div>
            </template>
          </section>
        </div>
      </div>

      <div v-if="fly" ref="flyEl" class="bp__fly" role="menu" :aria-label="fly.info.name" :style="{ left: fly.left + 'px', top: fly.top + 'px' }" @keydown="onFlyKey">
        <template v-for="a in flyActions" :key="a.id">
          <hr v-if="a.sepBefore" />
          <button type="button" role="menuitem" class="bp__fitem" :class="{ 'bp__fitem--danger': a.danger }" data-fly :disabled="a.disabled || busy" @click="a.run()">
            {{ a.label }}
          </button>
        </template>
      </div>
    </div>
  </Teleport>

  <BranchDialog
    v-if="dialog && data"
    :mode="dialog.mode"
    :data="data"
    :initial-base="dialog.initialBase"
    :busy="dlgBusy"
    :error="dlgError"
    @new="submitNew"
    @revision="submitRevision"
    @cancel="closeDialog"
  />
  <ConfirmDialog v-if="confirmView" :title="confirmView.title" :lines="confirmView.lines" :confirm-label="confirmView.label" :danger="confirmView.danger" @confirm="doConfirm" @cancel="confirm = null" />
</template>

<style scoped lang="scss">
.bp { display: inline-flex; min-width: 130px; } /* sem isto o chip da branch não encolhe e empurra os botões do cabeçalho */
.bp__btn { min-width: 0; max-width: 100%; }
.bp__name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp__layer { position: fixed; inset: 0; z-index: 1000; }
.bp__panel,
.bp__fly {
  position: fixed;
  display: flex;
  flex-direction: column;
  background: var(--gn-surface);
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
}
.bp__panel { width: 380px; overflow: hidden; }
.bp__fly { width: 320px; padding: 6px; z-index: 1001; hr { margin: 4px 0; } }
.bp__search {
  display: flex; align-items: center; gap: 8px; margin: 10px 10px 6px; padding: 2px 6px 2px 10px;
  background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); color: var(--gn-muted);
  &:focus-within { border-color: var(--gn-accent); box-shadow: var(--gn-ring); }
  input { flex: 1; min-width: 0; padding: 4px 0; background: none; border: none; color: var(--gn-text); &:focus { outline: none; } &:focus-visible { box-shadow: none; } }
}
.bp__err { margin: 0 10px 6px; padding: 6px 8px; font-size: 12px; color: var(--gn-danger); background: color-mix(in srgb, var(--gn-danger) 12%, transparent); border-radius: var(--gn-radius); word-break: break-word; }
.bp__scroll { overflow: auto; padding: 4px 6px 8px; hr { margin: 6px 0; border: none; border-top: 1px solid var(--gn-border); } }
.bp__muted { margin: 8px; color: var(--gn-muted); font-size: 12px; }
.bp__item, .bp__sec, .bp__row, .bp__fitem {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 10px; font: inherit; text-align: left;
  color: var(--gn-text); background: none; border: none; border-radius: 6px; cursor: pointer;
  &:hover:not(:disabled) { background: var(--gn-surface-2); }
  &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: -2px; }
  &:disabled { opacity: 0.45; cursor: default; }
}
.bp__baseinfo { margin: 6px 10px 2px; color: var(--gn-muted); font-size: 12.5px; }
.bp__opt { display: flex; align-items: center; gap: 8px; padding: 5px 10px; color: var(--gn-muted); font-size: 12.5px; cursor: pointer; input { margin: 0; } }
.bp__sec { color: var(--gn-muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.bp__remote { display: flex; align-items: center; gap: 8px; padding: 4px 10px 4px 22px; color: var(--gn-muted); font-size: 12.5px; }
.bp__row {
  min-height: 28px;
  &--cur { font-weight: 600; color: color-mix(in srgb, var(--gn-accent) 70%, #fff); }
  &--open { background: color-mix(in srgb, var(--gn-accent) 22%, var(--gn-surface-2)); }
}
.bp__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; mark { background: color-mix(in srgb, var(--gn-warn) 45%, transparent); color: inherit; border-radius: 2px; } }
.bp__more { color: var(--gn-muted); }
.bp__fitem { white-space: nowrap; &--danger { color: var(--gn-danger); } }
</style>
