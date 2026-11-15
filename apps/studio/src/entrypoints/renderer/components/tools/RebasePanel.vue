<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import type { RebaseAction, RebasePlan, RebaseState, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { useWorkspaceStore } from '../../stores/workspace';
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

const ACTIONS: Array<{ id: RebaseAction; label: string; hint: string }> = [
  { id: 'pick', label: 'Manter', hint: 'Mantém o commit como está' },
  { id: 'reword', label: 'Editar mensagem', hint: 'Troca a mensagem do commit' },
  { id: 'squash', label: 'Juntar (squash)', hint: 'Junta ao commit de cima e combina as mensagens' },
  { id: 'fixup', label: 'Juntar (fixup)', hint: 'Junta ao commit de cima e descarta esta mensagem' },
  { id: 'drop', label: 'Descartar', hint: 'Remove o commit e as alterações dele' },
];

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
    if (!p.commits.length) throw new Error('Não há commits depois desse ponto.');
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
  if (!firstKept.value) return 'Todos os commits estão marcados para descarte.';
  if (firstKept.value.action === 'squash' || firstKept.value.action === 'fixup') return 'O primeiro commit mantido não pode ser "juntar": não há commit de cima.';
  const bad = rows.value.find((r) => r.action === 'reword' && !r.message.trim());
  return bad ? `Escreva a nova mensagem do commit ${bad.shortHash}.` : '';
});
const resultCount = computed(() => rows.value.filter((r) => r.action === 'pick' || r.action === 'reword').length);
const changed = computed(() => rows.value.some((r, i) => r.action !== 'pick' || r.hash !== plan.value?.commits[i]?.hash));
const publishedCount = computed(() => rows.value.filter((r) => r.published).length);

function askRun(): void {
  const lines = [
    `${rows.value.length} commit(s) serão reescritos e passarão a ser ${resultCount.value}.`,
    'Um backup do estado atual é guardado antes de começar, e a operação aparece em Operações para você desfazer.',
  ];
  if (publishedCount.value) lines.push(`⚠ ${publishedCount.value} commit(s) já foram publicados: depois do rebase será preciso um push forçado (--force-with-lease).`);
  confirm.value = { title: 'Executar o rebase?', lines, label: 'Executar rebase', danger: publishedCount.value > 0, run };
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
      info.value = `${r.message} Backup: ${r.backup}`;
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
    title: 'Abortar o rebase?',
    lines: ['Todos os commits voltam ao estado de antes do rebase. As resoluções de conflito feitas até aqui serão perdidas.'],
    label: 'Abortar rebase',
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
  const t = ws.toolsTarget;
  if (t && t.repoId === props.repo.id && t.section === 'rebase' && t.file) void loadPlan(t.file);
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
      <h2>Rebase interativo</h2>
      <p class="muted">
        Reescreva os últimos commits: <b>reordene</b> (arraste), <b>edite mensagens</b>, <b>junte</b> commits ou <b>descarte</b> alguns.
        O resultado vira um histórico mais limpo antes de publicar.
      </p>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="info" :class="infoWarn ? 'warn' : 'ok'">{{ infoWarn ? '⚠' : '✔' }} {{ info }}</p>

    <!-- rebase em andamento -->
    <section v-if="state?.inProgress" class="box box--warn">
      <h3>⇅ Rebase em andamento — passo {{ state.step }}/{{ state.total }} <span class="muted">({{ state.branch }})</span></h3>
      <template v-if="state.conflicted.length">
        <p>Há conflito em:</p>
        <ul class="conf">
          <li v-for="f in state.conflicted" :key="f">{{ f }}</li>
        </ul>
        <p class="muted">Resolva cada arquivo na aba Conflitos (isso o inclui no commit) e depois clique em Continuar.</p>
      </template>
      <p v-else class="muted">Sem conflitos pendentes. Clique em Continuar para seguir.</p>
      <div class="rb__btns">
        <GnButton size="sm" variant="primary" :disabled="busy" @click="ws.open('merge', repo)">Resolver conflitos</GnButton>
        <GnButton size="sm" :disabled="busy || state.conflicted.length > 0" @click="proceed('continue')">Continuar</GnButton>
        <GnButton size="sm" :disabled="busy" title="Descarta o commit deste passo" @click="proceed('skip')">Pular este commit</GnButton>
        <GnButton size="sm" variant="danger" :disabled="busy" @click="askAbort">Abortar rebase</GnButton>
      </div>
    </section>

    <!-- escolher o trecho -->
    <section v-else class="box">
      <form class="pick" @submit.prevent="loadLast">
        <label>
          Reescrever os últimos
          <input v-model.number="count" type="number" min="2" max="50" />
          commits da branch atual
        </label>
        <GnButton type="submit" variant="primary" :disabled="busy">Carregar commits</GnButton>
        <span class="muted">ou use "Rebase interativo a partir daqui" no detalhe de um commit do grafo.</span>
      </form>
    </section>

    <!-- lista editável -->
    <section v-if="plan && !state?.inProgress" class="box">
      <div class="rb__top">
        <strong>{{ rows.length }} commit(s) → {{ resultCount }}</strong>
        <span class="muted">do mais antigo (em cima) ao mais novo · branch {{ plan.branch }}</span>
        <span class="spacer" />
        <GnButton size="sm" :disabled="!changed" @click="reset">Restaurar ordem original</GnButton>
      </div>
      <p v-if="publishedCount" class="warn">⚠ {{ publishedCount }} commit(s) já estão publicados em um remoto: reescrevê-los exige push forçado e afeta quem já os baixou.</p>
      <p v-if="plan.hasMerges" class="err">Este trecho tem commits de merge; o rebase interativo só funciona em histórico linear.</p>

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
          <span class="row__grip" title="Arraste para reordenar">⠿</span>
          <span class="row__mv">
            <button type="button" :disabled="i === 0" title="Subir" aria-label="Subir" @click="move(i, i - 1)">▲</button>
            <button type="button" :disabled="i === rows.length - 1" title="Descer" aria-label="Descer" @click="move(i, i + 1)">▼</button>
          </span>
          <select :value="r.action" :title="ACTIONS.find((a) => a.id === r.action)?.hint" @change="setAction(r, ($event.target as HTMLSelectElement).value as RebaseAction)">
            <option v-for="a in ACTIONS" :key="a.id" :value="a.id" :title="a.hint">{{ a.label }}</option>
          </select>
          <span class="row__hash mono">{{ r.shortHash }}</span>
          <div class="row__main">
            <span class="row__sub" :title="r.subject">{{ r.subject }}</span>
            <textarea
              v-if="r.action === 'reword'"
              v-model="r.message"
              class="row__msg"
              rows="3"
              placeholder="Nova mensagem do commit"
              @mousedown.stop
              @dragstart.prevent.stop
            />
          </div>
          <GnBadge v-if="r.published" tone="warn" title="Já publicado em um remoto">publicado</GnBadge>
        </li>
      </ol>

      <p v-if="problem" class="err">{{ problem }}</p>
      <div class="rb__btns">
        <GnButton variant="primary" :disabled="busy || !!problem || !changed || plan.hasMerges" @click="askRun">Executar rebase…</GnButton>
        <span v-if="!changed" class="muted">Altere a ordem ou as ações para habilitar.</span>
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
  &__mv { display: flex; flex-direction: column; button { background: none; border: none; color: var(--gn-muted); font-size: 9px; line-height: 1.1; padding: 0 3px; cursor: pointer; &:hover:not(:disabled) { color: var(--gn-text); } &:disabled { opacity: 0.25; cursor: default; } } }
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
