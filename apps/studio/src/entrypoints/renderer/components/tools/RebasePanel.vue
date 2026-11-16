<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton, GnButtonGroup, GnIcon, GnIconButton } from '@git-nexus/ui-kit';
import type { RebaseAction, RebasePlan, RebaseState, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { useWorkspaceStore } from '../../stores/workspace';
import { t, type MessageKey } from '../../i18n';
import ComboBox from '../ComboBox.vue';
import ConfirmDialog from '../ConfirmDialog.vue';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

interface Row {
  hash: string;
  shortHash: string;
  subject: string;
  published: boolean;
  action: RebaseAction;
  /** Mensagem completa do reword (carregada quando a ação é "editar mensagem"). */
  message: string;
}

const count = ref(5);
const plan = ref<RebasePlan | null>(null);
const rows = ref<Row[]>([]);
const state = ref<RebaseState | null>(null);
const error = ref('');
const info = ref('');
/** A última mensagem é um aviso (rebase parado), não um sucesso. */
const infoWarn = ref(false);
const busy = ref(false);
const dragFrom = ref(-1);
const dragOver = ref(-1);
const confirm = ref<{ title: string; lines: string[]; label: string; danger?: boolean; run: () => Promise<void> } | null>(null);

const ACTIONS: Array<{ id: RebaseAction; label: MessageKey; hint: MessageKey }> = [
  { id: 'pick', label: 'rb.pick', hint: 'rb.pickHint' },
  { id: 'reword', label: 'rb.reword', hint: 'rb.rewordHint' },
  { id: 'squash', label: 'rb.squash', hint: 'rb.squashHint' },
  { id: 'fixup', label: 'rb.fixup', hint: 'rb.fixupHint' },
  { id: 'drop', label: 'rb.drop', hint: 'rb.dropHint' },
];
const actionHint = (id: RebaseAction): string => t(ACTIONS.find((a) => a.id === id)!.hint);
/** Opções do combobox de ação: rótulo + a dica de cada ação ao lado. */
const actionOptions = computed(() => ACTIONS.map((a) => ({ value: a.id, label: t(a.label), hint: t(a.hint) })));

async function loadState(): Promise<void> {
  try {
    state.value = await api.getRebaseState(props.repo.path);
  } catch {
    state.value = null;
  }
}

async function loadPlan(baseSpec: string): Promise<void> {
  error.value = '';
  info.value = '';
  infoWarn.value = false;
  busy.value = true;
  try {
    const p = await api.getRebasePlan(props.repo.path, baseSpec);
    if (!p.commits.length) throw new Error(t('rb.noCommits'));
    plan.value = p;
    rows.value = p.commits.map((c) => ({ hash: c.hash, shortHash: c.shortHash, subject: c.subject, published: c.published, action: 'pick', message: '' }));
  } catch (e) {
    plan.value = null;
    rows.value = [];
    error.value = errMsg(e);
  } finally {
    busy.value = false;
  }
}

const loadLast = () => loadPlan(`HEAD~${count.value}`);

// --- edição da lista ---------------------------------------------------------------------------
function move(from: number, to: number): void {
  if (to < 0 || to >= rows.value.length || from === to) return;
  const next = [...rows.value];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  rows.value = next;
}
function onDragStart(i: number, ev: DragEvent): void {
  dragFrom.value = i;
  ev.dataTransfer?.setData('text/plain', String(i));
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
}
function onDrop(i: number): void {
  move(dragFrom.value, i);
  dragFrom.value = dragOver.value = -1;
}
async function setAction(r: Row, action: RebaseAction): Promise<void> {
  r.action = action;
  // ao editar a mensagem, parte da mensagem completa atual (assunto + corpo)
  if (action === 'reword' && !r.message) {
    r.message = await api.getCommitDetail(props.repo.path, r.hash).then((d) => d.message).catch(() => r.subject);
  }
}
function reset(): void {
  if (!plan.value) return;
  rows.value = plan.value.commits.map((c) => ({ hash: c.hash, shortHash: c.shortHash, subject: c.subject, published: c.published, action: 'pick', message: '' }));
}

// --- validações e resumo -------------------------------------------------------------------------
const firstKept = computed(() => rows.value.find((r) => r.action !== 'drop'));
const problem = computed(() => {
  if (!rows.value.length) return '';
  if (!firstKept.value) return t('rb.allDropped');
  if (firstKept.value.action === 'squash' || firstKept.value.action === 'fixup') return t('rb.firstCantSquash');
  const bad = rows.value.find((r) => r.action === 'reword' && !r.message.trim());
  return bad ? t('rb.writeMessage', { hash: bad.shortHash }) : '';
});
const resultCount = computed(() => rows.value.filter((r) => r.action === 'pick' || r.action === 'reword').length);
const changed = computed(() => rows.value.some((r, i) => r.action !== 'pick' || r.hash !== plan.value?.commits[i]?.hash));
const publishedCount = computed(() => rows.value.filter((r) => r.published).length);

function askRun(): void {
  const lines = [
    t('rb.willRewrite', { n: rows.value.length, result: resultCount.value }),
    t('rb.backupNote'),
  ];
  if (publishedCount.value) lines.push(t('rb.publishedForce', { n: publishedCount.value }));
  confirm.value = { title: t('rb.runTitle'), lines, label: t('rb.runLabel'), danger: publishedCount.value > 0, run };
}

async function run(): Promise<void> {
  if (!plan.value) return;
  busy.value = true;
  error.value = '';
  try {
    const r = await api.startRebase(
      props.repo.path,
      plan.value.base,
      rows.value.map((x) => ({ hash: x.hash, action: x.action, ...(x.action === 'reword' ? { message: x.message } : {}) })),
    );
    state.value = r.state;
    infoWarn.value = r.status === 'stopped';
    if (r.status === 'done') {
      info.value = t('rb.doneBackup', { message: r.message, backup: r.backup ?? '' });
      plan.value = null;
      rows.value = [];
    } else info.value = r.message;
    ws.bump(props.repo.id);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    busy.value = false;
    await loadState();
  }
}

// --- rebase em andamento ---------------------------------------------------------------------------
async function proceed(kind: 'continue' | 'skip' | 'abort'): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const r = await (kind === 'continue' ? api.continueRebase : kind === 'skip' ? api.skipRebase : api.abortRebase)(props.repo.path);
    info.value = r.message;
    infoWarn.value = r.status === 'stopped';
    state.value = r.state;
    ws.bump(props.repo.id);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    busy.value = false;
    await loadState();
  }
}
function askAbort(): void {
  confirm.value = {
    title: t('rb.abortTitle'),
    lines: [t('rb.abortBody')],
    label: t('rb.abort'),
    danger: true,
    run: () => proceed('abort'),
  };
}
async function runConfirm(): Promise<void> {
  const c = confirm.value;
  confirm.value = null;
  await c?.run();
}

function applyTarget(): void {
  const tg = ws.toolsTarget;
  if (tg && tg.repoId === props.repo.id && tg.section === 'rebase' && tg.file) void loadPlan(tg.file);
}

watch(() => ws.toolsTarget, applyTarget);
watch(() => ws.versions[props.repo.id], loadState);
onMounted(async () => {
  await loadState();
  if (!state.value?.inProgress) applyTarget();
});
</script>

<template>
  <div class="rb">
    <header class="rb__head">
      <h2>{{ t('rb.title') }}</h2>
      <p class="muted">{{ t('rb.intro') }}</p>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="info" :class="infoWarn ? 'warn' : 'ok'">{{ infoWarn ? '⚠' : '✔' }} {{ info }}</p>

    <!-- rebase em andamento -->
    <section v-if="state?.inProgress" class="box box--warn">
      <h3>⇅ {{ t('rb.running', { step: state.step, total: state.total }) }} <span class="muted">({{ state.branch }})</span></h3>
      <template v-if="state.conflicted.length">
        <p>{{ t('rb.conflictIn') }}</p>
        <ul class="conf">
          <li v-for="f in state.conflicted" :key="f">{{ f }}</li>
        </ul>
        <p class="muted">{{ t('rb.resolveHint') }}</p>
      </template>
      <p v-else class="muted">{{ t('rb.noConflicts') }}</p>
      <div class="rb__btns">
        <GnButton size="sm" variant="primary" tone="warn" :disabled="busy" @click="ws.open('merge', repo)">{{ t('rb.resolveConflicts') }}</GnButton>
        <GnButton size="sm" tone="success" :disabled="busy || state.conflicted.length > 0" @click="proceed('continue')">
          <GnIcon name="check" />{{ t('rb.continue') }}
        </GnButton>
        <GnButton size="sm" tone="warn" :disabled="busy" :title="t('rb.skipTip')" @click="proceed('skip')">{{ t('rb.skip') }}</GnButton>
        <GnButton size="sm" variant="danger" :disabled="busy" @click="askAbort"><GnIcon name="x" />{{ t('rb.abort') }}</GnButton>
      </div>
    </section>

    <!-- escolher o trecho -->
    <section v-else class="box">
      <form class="pick" @submit.prevent="loadLast">
        <label>
          {{ t('rb.rewriteLast') }}
          <input v-model.number="count" type="number" min="2" max="50" />
          {{ t('rb.commitsOfBranch') }}
        </label>
        <GnButton type="submit" variant="primary" :disabled="busy">{{ t('rb.loadCommits') }}</GnButton>
        <span class="muted">{{ t('rb.orUseGraph') }}</span>
      </form>
    </section>

    <!-- lista editável -->
    <section v-if="plan && !state?.inProgress" class="box">
      <div class="rb__top">
        <strong>{{ t('rb.nToN', { n: rows.length, result: resultCount }) }}</strong>
        <span class="muted">{{ t('rb.orderNote', { branch: plan.branch }) }}</span>
        <span class="spacer" />
        <GnButton size="sm" :disabled="!changed" @click="reset">{{ t('rb.restoreOrder') }}</GnButton>
      </div>
      <p v-if="publishedCount" class="warn">⚠ {{ t('rb.publishedWarn', { n: publishedCount }) }}</p>
      <p v-if="plan.hasMerges" class="err">{{ t('rb.hasMerges') }}</p>

      <ol class="rows">
        <li
          v-for="(r, i) in rows"
          :key="r.hash"
          class="row"
          :class="{ 'row--drop': r.action === 'drop', 'row--sq': r.action === 'squash' || r.action === 'fixup', 'row--over': dragOver === i && dragFrom !== i }"
          draggable="true"
          @dragstart="onDragStart(i, $event)"
          @dragover.prevent="dragOver = i"
          @dragleave="dragOver = -1"
          @drop.prevent="onDrop(i)"
          @dragend="dragFrom = dragOver = -1"
        >
          <span class="row__grip" :title="t('rb.dragTip')">⠿</span>
          <GnButtonGroup class="row__mv">
            <GnIconButton icon="up" :disabled="i === 0" :label="t('rb.up')" @click="move(i, i - 1)" />
            <GnIconButton icon="down" :disabled="i === rows.length - 1" :label="t('rb.down')" @click="move(i, i + 1)" />
          </GnButtonGroup>
          <ComboBox :model-value="r.action" :options="actionOptions" :title="actionHint(r.action)" :aria-label="actionHint(r.action)" @update:model-value="setAction(r, $event as RebaseAction)" />
          <span class="row__hash mono">{{ r.shortHash }}</span>
          <div class="row__main">
            <span class="row__sub" :title="r.subject">{{ r.subject }}</span>
            <textarea
              v-if="r.action === 'reword'"
              v-model="r.message"
              class="row__msg"
              rows="3"
              :placeholder="t('rb.newMessage')"
              @mousedown.stop
              @dragstart.prevent.stop
            />
          </div>
          <GnBadge v-if="r.published" tone="warn" :title="t('rb.publishedTip')">{{ t('rb.published') }}</GnBadge>
        </li>
      </ol>

      <p v-if="problem" class="err">{{ problem }}</p>
      <div class="rb__btns">
        <GnButton variant="primary" tone="warn" :disabled="busy || !!problem || !changed || plan.hasMerges" @click="askRun">
          <GnIcon name="alert" />{{ t('rb.runEllipsis') }}
        </GnButton>
        <span v-if="!changed" class="muted">{{ t('rb.changeToEnable') }}</span>
      </div>
    </section>

    <ConfirmDialog
      v-if="confirm"
      :title="confirm.title"
      :lines="confirm.lines"
      :confirm-label="confirm.label"
      :danger="confirm.danger"
      @confirm="runConfirm"
      @cancel="confirm = null"
    />
  </div>
</template>

<style scoped lang="scss">
.rb {
  padding: 16px 22px;
  max-width: 1000px;
  display: grid;
  gap: 12px;
  &__head { h2 { margin: 0 0 4px; font-size: 16px; } p { margin: 0; } }
  &__top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  &__btns { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
}
.box { border: 1px solid var(--gn-border); border-radius: var(--gn-radius); padding: 12px 14px; h3 { margin: 0 0 8px; font-size: 14px; } p { margin: 4px 0; } &--warn { border-color: var(--gn-warn); } }
.pick { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; input[type='number'] { width: 70px; } }
.conf { margin: 0 0 6px; padding-left: 18px; font-family: var(--gn-mono); font-size: 12px; color: var(--gn-danger); }
.rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.row {
  display: flex; align-items: flex-start; gap: 10px; padding: 6px 10px; background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); cursor: grab;
  &--drop { opacity: 0.55; .row__sub { text-decoration: line-through; } }
  &--sq { margin-left: 28px; border-left: 3px solid var(--gn-accent); }
  &--over { border-color: var(--gn-accent); box-shadow: 0 -2px 0 var(--gn-accent); }
  &__grip { color: var(--gn-muted); user-select: none; padding-top: 3px; }
  &__mv { align-self: flex-start; }
  &__hash { color: var(--gn-muted); padding-top: 3px; }
  &__main { flex: 1; min-width: 0; display: grid; gap: 6px; }
  &__sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-top: 3px; }
  &__msg { width: 100%; font-family: var(--gn-mono); font-size: 12px; cursor: text; }
}
.mono { font-family: var(--gn-mono); font-size: 12px; }
.muted { color: var(--gn-muted); font-size: 12px; }
.spacer { flex: 1; }
.err { color: var(--gn-danger); margin: 0; }
.ok { color: var(--gn-success); margin: 0; word-break: break-all; }
.warn { color: var(--gn-warn); }
</style>
