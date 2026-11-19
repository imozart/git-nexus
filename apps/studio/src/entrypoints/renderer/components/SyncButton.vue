<script setup lang="ts">
// Botão de sincronização com o remoto, no cabeçalho do repositório (no modelo do "Fetch/Pull/Push origin" do GitHub Desktop): o rótulo muda com o
// estado da branch (Buscar, Atualizar ↓N, Enviar ↑N, Publicar branch, Sincronizar ↑N ↓M) e o clique faz a ação certa. A seta ao lado abre o painel
// com os commits que chegam e os que saem e as opções (merge ou rebase quando divergiu). Enquanto a operação roda, o botão fica ocupado
// ("Atualizando… 45%") e uma barra mostra o andamento (porcentagem quando o git informa; indeterminada quando não).
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { GnButton, GnButtonGroup, GnIcon, GnTooltip } from '@git-nexus/ui-kit';
import { syncState, type BaseComparison, type BranchActionResult, type RepoSummary, type RepositoryMeta, type SyncCommits, type UpdateMethod } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { t } from '../i18n';
import { agoText, baseText, lastFetchText, phaseLabel, syncText } from '../sync';
import { remoteName, syncAction } from '../sync-action';
import { opOf, runSyncOp, type SyncKind } from '../sync-ops';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps<{ repo: RepositoryMeta; sync: RepoSummary | null; base?: BaseComparison | null }>();
const emit = defineEmits<{
  (e: 'changed'): void;
  (e: 'notice', text: string): void;
  /** Merge, rebase ou atualização parou por conflitos: a tela leva a pessoa até eles. */
  (e: 'conflict'): void;
}>();

const path = computed(() => props.repo.path);
const op = computed(() => opOf(path.value));
/** Operação do usuário em andamento (a busca automática, `silent`, não bloqueia nada). */
const busy = computed(() => !!op.value && !op.value.silent);
const action = computed(() => (props.sync ? syncAction(props.sync) : 'fetch'));
const remote = computed(() => remoteName(props.sync, props.base));
const upstream = computed(() => props.sync?.upstream ?? '');
const dirty = computed(() => !!props.sync && props.sync.staged + props.sync.unstaged > 0);

const RUNNING: Record<SyncKind, 'ss.fetching' | 'ss.updating' | 'ss.pushing'> = { fetch: 'ss.fetching', update: 'ss.updating', push: 'ss.pushing' };

const label = computed(() => {
  const s = props.sync;
  if (op.value && !op.value.silent) {
    const base = t(RUNNING[op.value.kind]);
    return op.value.percent === null ? base : t('ss.withPct', { label: base, pct: op.value.percent });
  }
  if (!s) return t('ss.fetch', { remote: remote.value });
  switch (action.value) {
    case 'update':
      return t('ss.update', { remote: remote.value, n: s.behind });
    case 'push':
      return t('ss.push', { remote: remote.value, n: s.ahead });
    case 'publish':
      return t('ss.publish');
    case 'choose':
      return t('ss.choose', { ahead: s.ahead, behind: s.behind });
    default:
      return t('ss.fetch', { remote: remote.value });
  }
});
const tone = computed(() => ({ fetch: 'neutral', update: 'accent', push: 'success', publish: 'success', choose: 'warn' })[action.value] as 'neutral' | 'accent' | 'success' | 'warn');
const tip = computed(() => {
  if (op.value?.silent) return t('ss.bgFetch');
  const what = { fetch: t('ss.tipFetch'), update: t('ss.tipUpdate'), push: t('ss.tipPush'), publish: t('ss.tipPublish'), choose: t('ss.tipChoose') }[action.value];
  return [what, syncText(props.sync), lastFetchText(props.sync)].filter(Boolean).join('\n');
});
const phase = computed(() => (op.value ? phaseLabel(op.value.phase) : ''));
const barTitle = computed(() => (op.value?.silent ? t('ss.bgFetch') : [label.value, phase.value].filter(Boolean).join(' · ')));

// ---------------------------------------------------------------- operações
function finish(r: BranchActionResult): void {
  emit('notice', r.message + (r.warning ? ` ${r.warning}` : ''));
  if (r.conflicted) {
    emit('conflict');
    return;
  }
  emit('changed');
}

async function guarded<T>(fn: () => Promise<T | undefined>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    emit('notice', errMsg(e));
    return undefined;
  }
}

async function doFetch(): Promise<void> {
  const r = await guarded(() => runSyncOp(path.value, 'fetch', () => api.fetchRepo(path.value)));
  if (!r) return;
  emit('notice', r.ok ? t('ss.fetched', { remote: remote.value }) : r.message);
  if (r.ok) emit('changed');
}
async function doUpdate(method: UpdateMethod = 'ff'): Promise<void> {
  const r = await guarded(() => runSyncOp(path.value, 'update', () => api.updateRepo(path.value, method)));
  if (r) finish(r);
}
/** Envio forçado SEGURO (--force-with-lease): para depois de reescrever o histórico (rebase, amend). O git recusa se o remoto andou. */
async function doPushLease(): Promise<void> {
  const r = await guarded(() => runSyncOp(path.value, 'push', () => api.pushWithLease(path.value)));
  if (r) finish(r);
}

async function doPush(): Promise<void> {
  const r = await guarded(() => runSyncOp(path.value, 'push', () => api.pushRepo(path.value)));
  if (r) finish(r);
}

function onMain(): void {
  switch (action.value) {
    case 'update':
      return void doUpdate('ff');
    case 'push':
    case 'publish':
      return void doPush();
    case 'choose':
      return void openPanel();
    default:
      return void doFetch();
  }
}

// ---------------------------------------------------------------- painel
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const open = ref(false);
const loading = ref(false);
const commits = ref<SyncCommits | null>(null);
const pos = ref({ left: 0, top: 0, maxHeight: 480 });
const confirmRebase = ref(false);
const confirmLease = ref(false);
/** Branches em que o envio forçado nem é oferecido (o núcleo também as recusa). */
const PROTECTED = /^(main|master|develop|development|trunk|release\/.+)$/;
const leaseAllowed = computed(() => !!props.sync?.branch && !PROTECTED.test(props.sync.branch));

async function loadCommits(): Promise<void> {
  loading.value = true;
  try {
    commits.value = await api.getSyncCommits(path.value);
  } catch {
    commits.value = { incoming: [], outgoing: [] };
  } finally {
    loading.value = false;
  }
}

async function openPanel(): Promise<void> {
  const r = root.value?.getBoundingClientRect();
  if (r) pos.value = { left: Math.max(8, Math.min(r.left, window.innerWidth - 448)), top: r.bottom + 6, maxHeight: Math.max(240, window.innerHeight - r.bottom - 20) };
  commits.value = null; // nada de lista velha enquanto a nova carrega
  open.value = true;
  await loadCommits();
  await nextTick();
  panel.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
}
function closePanel(refocus = true): void {
  open.value = false;
  if (refocus) root.value?.querySelector<HTMLElement>('[data-testid="sync-details"]')?.focus();
}
const togglePanel = () => (open.value ? closePanel() : void openPanel());

function onDocKey(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape' || ev.defaultPrevented || confirmRebase.value || confirmLease.value) return;
  ev.preventDefault();
  closePanel();
}
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('keydown', onDocKey);
  else document.removeEventListener('keydown', onDocKey);
});
// com o estado mudando por baixo (depois de uma operação, ou do fetch automático), a lista aberta se refaz
watch(
  () => [props.sync?.ahead, props.sync?.behind, props.sync?.upstream],
  () => {
    if (open.value && !busy.value) void loadCommits();
  },
);
onBeforeUnmount(() => document.removeEventListener('keydown', onDocKey));

/** Roda a ação do painel: o painel fecha para o botão principal mostrar o andamento. */
function fromPanel(fn: () => Promise<void>): void {
  closePanel(false);
  void fn();
}
const askRebase = () => {
  open.value = false;
  confirmRebase.value = true;
};
const askLease = () => {
  open.value = false;
  confirmLease.value = true;
};
function doLease(): void {
  confirmLease.value = false;
  void doPushLease();
}
function doRebase(): void {
  confirmRebase.value = false;
  void doUpdate('rebase');
}

const state = computed(() => (props.sync ? syncState(props.sync) : 'detached'));
const headerLines = computed(() => [syncText(props.sync), baseText(props.base), lastFetchText(props.sync)].filter(Boolean));
const incomingMore = computed(() => Math.max(0, (props.sync?.behind ?? 0) - (commits.value?.incoming.length ?? 0)));
const outgoingMore = computed(() => {
  const total = state.value === 'no-upstream' || state.value === 'gone' ? 0 : (props.sync?.ahead ?? 0);
  return Math.max(0, total - (commits.value?.outgoing.length ?? 0));
});
const unpublished = computed(() => state.value === 'no-upstream' || state.value === 'gone');
const nothing = computed(() => !loading.value && !!commits.value && !commits.value.incoming.length && !commits.value.outgoing.length);
const rebaseVars = computed(() => ({ ref: upstream.value || remote.value, cur: props.sync?.branch ?? '' }));

defineExpose({ doFetch, doUpdate, doPush, doPushLease });
</script>

<template>
  <span v-if="sync" ref="root" class="ss" data-testid="sync-button" :data-busy="busy ? 'true' : 'false'">
    <GnButtonGroup :label="t('ss.group')">
      <GnButton size="sm" :tone="tone" :disabled="busy" :aria-busy="busy" data-testid="sync-main" @click="onMain">{{ label }}<GnTooltip :text="tip" /></GnButton>
      <GnButton size="sm" :tone="tone" :disabled="busy" :aria-label="t('ss.details')" aria-haspopup="dialog" :aria-expanded="open" data-testid="sync-details" @click="togglePanel">
        <GnIcon name="chevron-down" />
        <GnTooltip :text="t('ss.details')" />
      </GnButton>
    </GnButtonGroup>
    <span
      v-if="op"
      class="ss__bar"
      :class="{ 'ss__bar--indeterminate': op.percent === null, 'ss__bar--silent': op.silent }"
      role="progressbar"
      :aria-label="barTitle"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="op.percent ?? undefined"
      data-testid="sync-progress"
    >
      <span class="ss__fill" :style="op.percent === null ? undefined : { width: op.percent + '%' }" />
      <GnTooltip :text="barTitle" />
    </span>
  </span>

  <Teleport to="body">
    <div v-if="open" class="ss__layer" @mousedown.self="closePanel()">
      <div ref="panel" class="ss__panel" role="dialog" :aria-label="t('ss.details')" data-testid="sync-panel" :style="{ left: pos.left + 'px', top: pos.top + 'px', maxHeight: pos.maxHeight + 'px' }">
        <div class="ss__head">
          <p v-for="l in headerLines" :key="l">{{ l }}</p>
        </div>

        <div class="ss__scroll">
          <p v-if="loading && !commits" class="ss__muted">{{ t('ss.loading') }}</p>
          <p v-else-if="nothing" class="ss__muted">{{ t('ss.nothing') }}</p>

          <section v-if="commits?.incoming.length" data-testid="sync-incoming">
            <h4>{{ t('ss.incoming', { n: sync?.behind ?? commits.incoming.length }) }}</h4>
            <ul>
              <li v-for="c in commits.incoming" :key="c.hash"><code>{{ c.hash }}</code> <span class="ss__subj">{{ c.subject }}</span> <span class="ss__meta">{{ c.author }} · {{ agoText(c.date * 1000) }}</span></li>
            </ul>
            <p v-if="incomingMore" class="ss__muted">{{ t('ss.more', { n: incomingMore }) }}</p>
          </section>

          <section v-if="commits?.outgoing.length" data-testid="sync-outgoing">
            <h4>{{ unpublished ? t('ss.unpublished', { n: commits.outgoing.length + outgoingMore }) : t('ss.outgoing', { n: sync?.ahead ?? commits.outgoing.length }) }}</h4>
            <ul>
              <li v-for="c in commits.outgoing" :key="c.hash"><code>{{ c.hash }}</code> <span class="ss__subj">{{ c.subject }}</span> <span class="ss__meta">{{ c.author }} · {{ agoText(c.date * 1000) }}</span></li>
            </ul>
            <p v-if="outgoingMore" class="ss__muted">{{ t('ss.more', { n: outgoingMore }) }}</p>
          </section>

          <p v-if="state === 'diverged'" class="ss__warn" data-testid="sync-diverged">{{ t('ss.divergedHelp') }}</p>
          <p v-if="dirty && (state === 'behind' || state === 'diverged')" class="ss__note" data-testid="sync-stash-note">{{ t('ss.stashNote') }}</p>
        </div>

        <div class="ss__actions">
          <GnButton size="sm" :disabled="busy" data-testid="sync-fetch" @click="fromPanel(doFetch)">{{ t('ss.fetchNow') }}</GnButton>
          <GnButton v-if="state === 'behind'" size="sm" tone="accent" :disabled="busy" data-testid="sync-update-ff" @click="fromPanel(() => doUpdate('ff'))">{{ t('ss.updateFf') }}</GnButton>
          <template v-if="state === 'diverged'">
            <GnButton size="sm" tone="accent" :disabled="busy" data-testid="sync-update-merge" @click="fromPanel(() => doUpdate('merge'))">{{ t('ss.updateMerge') }}</GnButton>
            <GnButton size="sm" tone="warn" :disabled="busy" data-testid="sync-update-rebase" @click="askRebase()">{{ t('ss.updateRebase') }}</GnButton>
            <GnButton v-if="leaseAllowed" size="sm" variant="ghost" tone="danger" :disabled="busy" data-testid="sync-push-lease" @click="askLease()">{{ t('ss.pushLease') }}<GnTooltip :text="t('ss.pushLeaseTip')" /></GnButton>
          </template>
          <GnButton v-if="state === 'ahead'" size="sm" tone="success" :disabled="busy" data-testid="sync-push" @click="fromPanel(doPush)">{{ t('ss.pushNow') }}</GnButton>
          <GnButton v-if="unpublished" size="sm" tone="success" :disabled="busy" data-testid="sync-publish" @click="fromPanel(doPush)">{{ t('ss.publishNow') }}</GnButton>
        </div>
      </div>
    </div>
  </Teleport>

  <ConfirmDialog
    v-if="confirmLease"
    :title="t('ss.leaseTitle', { cur: sync?.branch ?? '' })"
    :lines="[t('ss.leaseLine1', { n: sync?.behind ?? 0, cur: sync?.branch ?? '' }), t('ss.leaseLine2')]"
    :confirm-label="t('ss.pushLease')"
    danger
    @confirm="doLease"
    @cancel="confirmLease = false"
  />
  <ConfirmDialog
    v-if="confirmRebase"
    :title="t('bp.rebaseTitle', rebaseVars)"
    :lines="[t('bp.rebaseLine1', rebaseVars), t('bp.rebaseLine2')]"
    :confirm-label="t('bp.rebaseConfirm')"
    danger
    @confirm="doRebase"
    @cancel="confirmRebase = false"
  />
</template>

<style scoped lang="scss">
.ss { position: relative; display: inline-flex; }
// barra de andamento colada na base do botão: porcentagem quando o git informa; indeterminada (vai e volta) quando não
.ss__bar {
  position: absolute; left: 0; right: 0; bottom: -3px; height: 3px; overflow: hidden; border-radius: 2px; background: color-mix(in srgb, var(--gn-accent) 22%, transparent);
  &--silent { opacity: 0.55; height: 2px; bottom: -2px; }
}
.ss__fill { display: block; height: 100%; background: var(--gn-accent); transition: width var(--gn-motion-base) linear; }
.ss__bar--indeterminate .ss__fill { width: var(--gn-ind-width, 40%); opacity: var(--gn-ind-opacity, 1); animation: ss-slide var(--gn-motion-loop) ease-in-out infinite alternate; }
@keyframes ss-slide { from { transform: translateX(-10%); } to { transform: translateX(160%); } }
.ss__layer { position: fixed; inset: 0; z-index: var(--gn-z-popover); }
.ss__panel {
  position: fixed; width: 440px; display: flex; flex-direction: column; background: var(--gn-surface); border: 1px solid var(--gn-border);
  border-radius: var(--gn-radius-lg); box-shadow: var(--gn-shadow-md); overflow: hidden; animation: gn-fade-in var(--gn-enter) ease-out;
}
.ss__head { padding: 10px 14px 8px; border-bottom: 1px solid var(--gn-border); p { margin: 0 0 2px; font-size: 12.5px; color: var(--gn-muted); &:first-child { color: var(--gn-text); font-weight: 600; } } }
.ss__scroll {
  overflow: auto; padding: 6px 14px 10px;
  h4 { margin: 10px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--gn-muted); }
  ul { margin: 0; padding: 0; list-style: none; }
  li { display: flex; gap: 8px; align-items: baseline; padding: 2px 0; font-size: 12.5px; min-width: 0; }
  code { color: var(--gn-accent); font-size: 12px; }
}
.ss__subj { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ss__meta { color: var(--gn-muted); font-size: 11.5px; white-space: nowrap; }
.ss__muted { margin: 8px 0; color: var(--gn-muted); font-size: 12.5px; }
.ss__warn { margin: 10px 0 0; padding: 6px 8px; font-size: 12.5px; color: var(--gn-warn); background: color-mix(in srgb, var(--gn-warn) 12%, transparent); border-radius: var(--gn-radius); }
.ss__note { margin: 8px 0 0; font-size: 12.5px; color: var(--gn-muted); }
.ss__actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--gn-border); }
</style>
