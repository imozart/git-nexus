<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { GnBadge, GnButton, GnIconButton } from '@git-nexus/ui-kit';
import { buildGraph, type CiStatus, type CommitDetail, type CommitInfo, type HistorySearchMode, type RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { useWorkspaceStore } from '../stores/workspace';
import { dateLocale, t, type MessageKey } from '../i18n';
import ComboBox from '../components/ComboBox.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const ROW_H = 28;
const COL_W = 16;
const COLORS = ['#4f86f7', '#4fb56a', '#e0a93b', '#c678dd', '#ef6a62', '#2bb5c9', '#e58f4a', '#8bc34a'];

const commits = ref<CommitInfo[]>([]);
const limit = ref(300);
const error = ref('');
const loading = ref(false);
const selectedHash = ref('');
const searchModes = computed(() => [
  { value: 'message', label: t('gv.modeMessage') },
  { value: 'content', label: t('gv.modeContent') },
  { value: 'regex', label: t('gv.modeRegex') },
]);

const layout = computed(() => buildGraph(commits.value));
const graphW = computed(() => Math.max(1, layout.value.lanes) * COL_W + 8);
// --- busca no histórico ---------------------------------------------------------------------
const q = reactive({ text: '', mode: 'message' as HistorySearchMode, author: '', path: '', since: '' });
/** Resultado da busca (sem o desenho do grafo: o conjunto filtrado não forma linhas contínuas). */
const results = ref<CommitInfo[] | null>(null);
const searching = ref(false);
const hasFilter = computed(() => !!(q.text.trim() || q.author.trim() || q.path.trim() || q.since.trim()));
const shown = computed(() => results.value ?? commits.value);
const selected = computed(() => shown.value.find((c) => c.hash === selectedHash.value));

async function runSearch(): Promise<void> {
  if (!hasFilter.value) return clearSearch();
  searching.value = true;
  error.value = '';
  try {
    results.value = await api.searchHistory(props.repo.path, { ...q }, 500);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    searching.value = false;
  }
}
function clearSearch(): void {
  Object.assign(q, { text: '', author: '', path: '', since: '' });
  results.value = null;
}

// --- detalhe do commit: mensagem completa, arquivos e diff ---------------------------------------
const detail = ref<CommitDetail | null>(null);
/** Status de CI do commit selecionado (só aparece com uma conta GitHub/GitLab conectada em Ferramentas). */
const ci = ref<CiStatus | null>(null);
const CI_TEXT: Record<CiStatus['state'], MessageKey> = { success: 'gv.ci.success', failure: 'gv.ci.failure', pending: 'gv.ci.pending', none: 'gv.ci.none' };
const CI_TONE = { success: 'success', failure: 'danger', pending: 'warn', none: 'neutral' } as const;
let hostingReady: Promise<boolean> | null = null;
const canCi = () => (hostingReady ??= api.hostingInfo(props.repo.path).then((i) => i.supported && i.hasToken).catch(() => false));
const failUrl = computed(() => ci.value?.checks.find((c) => c.state === 'failure')?.url);
const diffFile = ref('');
const diffText = ref('');
watch(selectedHash, async (h) => {
  ci.value = null;
  if (h && (await canCi())) api.getCiStatus(props.repo.path, h).then((s) => h === selectedHash.value && (ci.value = s)).catch(() => undefined);
  detail.value = null;
  diffFile.value = '';
  diffText.value = '';
  if (!h) return;
  try {
    const d = await api.getCommitDetail(props.repo.path, h);
    if (h === selectedHash.value) detail.value = d;
  } catch (e) {
    error.value = errMsg(e);
  }
});
async function showFile(f: string): Promise<void> {
  diffFile.value = f;
  diffText.value = await api.getCommitFileDiff(props.repo.path, selectedHash.value, f);
}
const STATUS: Record<string, MessageKey> = { A: 'gv.st.A', M: 'gv.st.M', D: 'gv.st.D', T: 'gv.st.T' };

const x = (lane: number) => lane * COL_W + COL_W / 2 + 2;
const color = (lane: number) => COLORS[lane % COLORS.length]!;

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    commits.value = await api.getHistory(props.repo.path, limit.value);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

function more(): void {
  limit.value += 300;
  void load();
}

// --- cherry-pick e revert do commit selecionado ---------------------------------------------
const ask = ref<{ kind: 'cherry-pick' | 'revert'; hash: string; subject: string } | null>(null);
const opBusy = ref(false);
const opNotice = ref<{ ok: boolean; text: string } | null>(null);

async function runCommitOp(): Promise<void> {
  const a = ask.value;
  ask.value = null;
  if (!a) return;
  opBusy.value = true;
  opNotice.value = null;
  try {
    const r = await (a.kind === 'cherry-pick' ? api.cherryPickCommit : api.revertCommit)(props.repo.path, a.hash);
    opNotice.value = { ok: r.ok, text: r.message };
    ws.bump(props.repo.id); // a tela do repositório e o grafo recarregam
    if (r.conflicted) ws.open('merge', props.repo); // parou por conflitos: leva a pessoa até eles
  } catch (e) {
    opNotice.value = { ok: false, text: errMsg(e) };
  } finally {
    opBusy.value = false;
  }
}

const fmtDate = (s: number) => new Date(s * 1000).toLocaleString(dateLocale.value);
const refTone = (r: string) => (r.startsWith('HEAD') ? 'accent' : r.startsWith('tag:') ? 'warn' : r.includes('/') ? 'neutral' : 'success');

onMounted(load);
watch(() => ws.versions[props.repo.id], load);
</script>

<template>
  <div class="gv">
    <header class="gv__head">
      <strong>{{ repo.name }}</strong>
      <span class="muted">{{ results ? t('gv.results', { n: results.length }) : t('gv.commitsAll', { n: commits.length }) }}</span>
      <span class="spacer" />
      <GnButton size="sm" :disabled="loading" @click="load">{{ t('rv.refresh') }}</GnButton>
      <GnButton size="sm" tone="accent" @click="ws.open('repo', repo)">{{ t('gv.backToStaging') }}</GnButton>
    </header>
    <form class="gv__search" @submit.prevent="runSearch">
      <ComboBox v-model="q.mode" :options="searchModes" :title="t('gv.whereToSearch')" />
      <input v-model="q.text" class="gv__q" :placeholder="t('gv.textPh')" spellcheck="false" />
      <input v-model="q.author" :placeholder="t('gv.authorPh')" spellcheck="false" />
      <input v-model="q.path" :placeholder="t('gv.pathPh')" spellcheck="false" />
      <input v-model="q.since" :placeholder="t('gv.sincePh')" spellcheck="false" />
      <GnButton size="sm" tone="accent" type="submit" :disabled="searching || !hasFilter">{{ t('gv.search') }}</GnButton>
      <GnButton v-if="results" size="sm" type="button" @click="clearSearch">{{ t('gv.clear') }}</GnButton>
    </form>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="results && !results.length" class="muted empty">{{ t('gv.noMatch') }}</p>
    <p v-else-if="!commits.length && !loading" class="muted empty">{{ t('gv.noCommits') }}</p>

    <div class="gv__body">
      <div class="gv__list">
        <div
          v-for="(c, i) in shown"
          :key="c.hash"
          class="row"
          :class="{ 'row--on': c.hash === selectedHash }"
          :style="{ height: ROW_H + 'px' }"
          @click="selectedHash = c.hash"
        >
          <svg v-if="!results" class="row__graph" :width="graphW" :height="ROW_H">
            <g v-if="layout.rows[i]" fill="none" stroke-width="2">
              <line
                v-for="lane in layout.rows[i]!.through"
                :key="'t' + lane"
                :x1="x(lane)" :y1="0" :x2="x(lane)" :y2="ROW_H"
                :stroke="color(lane)"
              />
              <line
                v-for="(s, k) in layout.rows[i]!.incoming"
                :key="'i' + k"
                :x1="x(s.from)" :y1="0" :x2="x(s.to)" :y2="ROW_H / 2"
                :stroke="color(s.from)"
              />
              <line
                v-for="(s, k) in layout.rows[i]!.outgoing"
                :key="'o' + k"
                :x1="x(s.from)" :y1="ROW_H / 2" :x2="x(s.to)" :y2="ROW_H"
                :stroke="color(s.to)"
              />
            </g>
            <circle
              v-if="layout.rows[i]"
              :cx="x(layout.rows[i]!.lane)" :cy="ROW_H / 2" r="4.5"
              :fill="color(layout.rows[i]!.lane)" stroke="var(--gn-surface)" stroke-width="1.5"
            />
          </svg>
          <div class="row__text">
            <GnBadge v-for="r in c.refs" :key="r" :tone="refTone(r)">{{ r }}</GnBadge>
            <span class="row__subject">{{ c.subject }}</span>
          </div>
          <span class="row__meta muted">{{ c.author }}</span>
          <span class="row__meta muted">{{ c.shortHash }}</span>
        </div>
        <div v-if="!results && commits.length >= limit" class="more">
          <GnButton size="sm" :disabled="loading" @click="more">{{ t('gv.loadMore') }}</GnButton>
        </div>
      </div>

      <aside v-if="selected" class="gv__detail">
        <h3>{{ selected.subject }}</h3>
        <dl>
          <dt>{{ t('gv.hash') }}</dt><dd class="mono">{{ selected.hash }}</dd>
          <dt>{{ t('gv.author') }}</dt><dd>{{ selected.author }}</dd>
          <dt>{{ t('gv.date') }}</dt><dd>{{ fmtDate(selected.date) }}</dd>
          <dt>{{ t('gv.parents') }}</dt><dd class="mono">{{ selected.parents.map((p) => p.slice(0, 7)).join(', ') || '—' }}</dd>
        </dl>
        <div v-if="ci" class="gv__ci">
          <GnBadge :tone="CI_TONE[ci.state]" :title="ci.checks.map((c) => `${c.name}: ${c.state}`).join('\n')">{{ t(CI_TEXT[ci.state]) }}</GnBadge>
          <GnButton v-if="failUrl" size="sm" tone="danger" @click="api.hostingOpen(repo.path, failUrl!)">{{ t('gv.seeFailure') }}</GnButton>
        </div>
        <GnButton size="sm" tone="warn" class="gv__rb" :title="t('gv.rebaseTip')" @click="ws.openTools(repo, 'rebase', selected.hash)">
          {{ t('gv.rebaseHere') }}
        </GnButton>
        <div class="gv__ops">
          <GnButton size="sm" tone="accent" :disabled="opBusy" :title="t('gv.cherryPickTip')" data-testid="cherry-pick" @click="ask = { kind: 'cherry-pick', hash: selected.hash, subject: selected.subject }">
            {{ t('gv.cherryPick') }}
          </GnButton>
          <GnButton size="sm" tone="warn" :disabled="opBusy" :title="t('gv.revertTip')" data-testid="revert" @click="ask = { kind: 'revert', hash: selected.hash, subject: selected.subject }">
            {{ t('gv.revert') }}
          </GnButton>
        </div>
        <p v-if="opNotice" class="gv__opnote" :class="opNotice.ok ? 'gv__opnote--ok' : 'gv__opnote--err'" role="status" data-testid="gv-op-notice">{{ opNotice.text }}</p>
        <pre v-if="detail && detail.message.includes('\n')" class="gv__msg">{{ detail.message }}</pre>
        <h4 v-if="detail">{{ t('gv.filesChanged', { n: detail.files.length }) }}</h4>
        <ul v-if="detail" class="gv__files">
          <li v-for="f in detail.files" :key="f.path" :class="{ on: diffFile === f.path }" @click="showFile(f.path)">
            <GnBadge :tone="f.status === 'D' ? 'danger' : f.status === 'A' ? 'success' : 'accent'">{{ STATUS[f.status] ? t(STATUS[f.status]!) : f.status }}</GnBadge>
            <span class="gv__fpath" :title="f.path">{{ f.path }}</span>
            <GnIconButton icon="history" :label="t('gv.fileHistory')" @click.stop="ws.openTools(repo, 'file', f.path, 'history')" />
            <GnIconButton icon="person" :label="t('gv.blame')" @click.stop="ws.openTools(repo, 'file', f.path, 'blame')" />
          </li>
        </ul>
        <pre v-if="diffFile" class="gv__diff"><template v-for="(l, i) in diffText.split('\n')" :key="i"><span :class="l.startsWith('+') && !l.startsWith('+++') ? 'a' : l.startsWith('-') && !l.startsWith('---') ? 'd' : l.startsWith('@@') ? 'h' : ''">{{ l }}
</span></template></pre>
      </aside>
    </div>
    <ConfirmDialog
      v-if="ask"
      :title="t(ask.kind === 'cherry-pick' ? 'gv.cherryPickTitle' : 'gv.revertTitle')"
      :lines="[`${ask.hash.slice(0, 7)} — ${ask.subject}`, t(ask.kind === 'cherry-pick' ? 'gv.cherryPickBody' : 'gv.revertBody')]"
      :confirm-label="t(ask.kind === 'cherry-pick' ? 'gv.cherryPick' : 'gv.revert')"
      @confirm="runCommitOp"
      @cancel="ask = null"
    />
  </div>
</template>

<style scoped lang="scss">
.gv {
  display: flex; flex-direction: column; height: 100%;
  &__head { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--gn-border); }
  &__body { flex: 1; min-height: 0; display: flex; }
  &__list { flex: 1; overflow: auto; min-width: 0; }
  &__search { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--gn-border); input, select { min-width: 0; } }
  &__q { flex: 1; min-width: 160px; }
  &__rb { margin-top: 10px; }
  &__ci { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  &__msg { white-space: pre-wrap; font-family: var(--gn-mono); font-size: 12px; background: var(--gn-bg); padding: 8px 10px; border-radius: var(--gn-radius); margin: 10px 0 0; }
  &__files { list-style: none; margin: 6px 0 0; padding: 0; li { display: flex; align-items: center; gap: 6px; padding: 3px 4px; cursor: pointer; font-size: 12px; border-radius: 4px; &:hover, &.on { background: var(--gn-surface-2); } } }
  &__fpath { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--gn-mono); }
  &__diff { margin: 8px 0 0; padding: 8px 10px; background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); font-family: var(--gn-mono); font-size: 11.5px; overflow: auto; max-height: 340px; .a { color: var(--gn-success); } .d { color: var(--gn-danger); } .h { color: var(--gn-accent); } }
  &__ops { display: flex; gap: 8px; margin-top: 8px; }
  &__opnote { margin: 8px 0 0; padding: 6px 10px; font-size: 12px; border-radius: var(--gn-radius); border: 1px solid var(--gn-border); &--ok { color: var(--gn-success); border-color: var(--gn-success); } &--err { color: var(--gn-warn); border-color: var(--gn-warn); } }
  &__detail { width: 420px; border-left: 1px solid var(--gn-border); padding: 14px; overflow: auto; h3 { margin: 0 0 10px; font-size: 14px; } }
}
.spacer { flex: 1; }
.muted { color: var(--gn-muted); }
.err { color: var(--gn-danger); padding: 8px 14px; margin: 0; }
.empty { padding: 30px; text-align: center; }
.row {
  display: flex; align-items: center; gap: 8px; padding-right: 12px; cursor: pointer;
  &:hover { background: var(--gn-surface-2); }
  &--on { background: rgba(79, 134, 247, 0.18); }
  &__graph { flex-shrink: 0; }
  &__text { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; }
  &__subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__meta { font-size: 11px; white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
}
.more { padding: 12px; text-align: center; }
dl { display: grid; grid-template-columns: 60px 1fr; gap: 6px 10px; margin: 0; }
dt { color: var(--gn-muted); }
dd { margin: 0; word-break: break-all; }
.mono { font-family: var(--gn-mono); font-size: 12px; }
</style>
