<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton, GnDialog, GnIconButton, GnTooltip } from '@git-nexus/ui-kit';
import { buildGraph, type CiStatus, type CommitDetail, type CommitInfo, type FileAtRevision, type HistoryHit, type HistoryQuery, type RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { useWorkspaceStore } from '../stores/workspace';
import { dateLocale, t, type MessageKey } from '../i18n';
import { KIND_KEY, KIND_TONE, diffLines, kindNumbers, rangerFor } from '../history-search-core';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import CodeEditor from '../components/CodeEditor.vue';
import HistorySearch from '../components/HistorySearch.vue';

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

const layout = computed(() => buildGraph(commits.value));
const graphW = computed(() => Math.max(1, layout.value.lanes) * COL_W + 8);

// --- busca na história (fase 9 da #233): o painel manda os commits achados, a lista os mostra ------------------------
/** Resultado da busca (sem o desenho do grafo: o conjunto filtrado não forma linhas contínuas). `null` = nenhuma busca na tela. */
const hits = ref<HistoryHit[] | null>(null);
/** O pedido da busca que está na tela: o destaque do diff usa o mesmo texto e as mesmas opções. */
const active = ref<HistoryQuery | null>(null);
const searching = ref(false);
/** Um pedido de fora (janela de pesquisa, editor, paleta) para este repositório. */
const target = computed(() => (ws.historyTarget && ws.historyTarget.repoId === props.repo.id ? ws.historyTarget : null));
const shown = computed<CommitInfo[]>(() => hits.value ?? commits.value);
const selected = computed(() => shown.value.find((c) => c.hash === selectedHash.value));
const hitOf = (c: CommitInfo | undefined): HistoryHit | undefined => (c && 'kind' in c ? (c as HistoryHit) : undefined);
const selectedHit = computed(() => hitOf(selected.value));
const ranger = computed(() => (active.value ? rangerFor(active.value) : null));
/** O selo só aparece quando a busca tem texto (uma busca só por autor ou período não tem "entrou/saiu"). */
const showKind = (h: HistoryHit): boolean => !!active.value?.text || active.value?.mode === 'range' || h.kind === 'message';
const kindText = (h: HistoryHit): string => `${t(KIND_KEY[h.kind])}${kindNumbers(h) ? ' ' + kindNumbers(h) : ''}`;
const rowLabel = (c: CommitInfo): string => {
  const h = hitOf(c);
  return h && showKind(h) ? t('hs.rowLabel', { kind: t(KIND_KEY[h.kind]), nums: kindNumbers(h), subject: c.subject }) : c.subject;
};
const KIND_TIP = { added: 'hs.kindTip.added', removed: 'hs.kindTip.removed', changed: 'hs.kindTip.changed', message: 'hs.kindTip.message', unknown: 'hs.kindTip.unknown' } as const;

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
/** O diff do arquivo escolhido, linha a linha, com o que a busca procurou marcado nas linhas + e −. */
const diffRows = computed(() => diffLines(diffText.value, ranger.value));
const patchRows = computed(() => (selectedHit.value?.patch ? diffLines(selectedHit.value.patch, null) : []));
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
/** O que a busca contou neste arquivo do commit (`null` = a busca não tocou nele). */
const touched = (path: string) => selectedHit.value?.files.find((f) => f.path === path || f.oldPath === path) ?? null;
const countText = (f: { added: number; removed: number }) => [f.removed ? `−${f.removed}` : '', f.added ? `+${f.added}` : ''].filter(Boolean).join(' ');
async function copyHash(): Promise<void> {
  if (selected.value) await api.copyText(selected.value.hash).catch(() => undefined);
}

// --- arquivo nesta versão -----------------------------------------------------------------------
const fileAt = ref<{ hash: string; file: string; data: FileAtRevision | null; error: string } | null>(null);
async function openFileAt(file: string): Promise<void> {
  const hash = selectedHash.value;
  fileAt.value = { hash, file, data: null, error: '' };
  try {
    const data = await api.getFileAtRevision(props.repo.path, hash, file);
    if (fileAt.value?.hash === hash && fileAt.value.file === file) fileAt.value.data = data;
  } catch (e) {
    if (fileAt.value) fileAt.value.error = errMsg(e);
  }
}
/** Onde a busca casa no arquivo daquela versão (o editor marca; no máximo 3000 trechos). */
const fileAtMarks = computed(() => {
  const text = fileAt.value?.data?.text;
  const r = ranger.value;
  if (!text || !r) return [];
  const out: Array<{ line: number; from: number; to: number }> = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < 3000; i++) for (const [from, to] of r.ranges(lines[i]!.replace(/\r$/, ''))) out.push({ line: i + 1, from, to });
  return out;
});
const fileAtMessage = computed(() => {
  const d = fileAt.value?.data;
  if (!d) return '';
  if (!d.exists) return t('hs.fileAtGone');
  return d.tooBig || d.binary ? t('hs.fileAtBig') : '';
});

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
const pick = (hash: string) => (selectedHash.value = hash);

onMounted(load);
watch(() => ws.versions[props.repo.id], load);
</script>

<template>
  <div class="gv">
    <header class="gv__head">
      <strong>{{ repo.name }}</strong>
      <span class="muted">{{ hits ? t('gv.results', { n: hits.length }) : t('gv.commitsAll', { n: commits.length }) }}</span>
      <span class="spacer" />
      <GnButton size="sm" :disabled="loading" @click="load">{{ t('rv.refresh') }}</GnButton>
      <GnButton size="sm" tone="accent" @click="ws.open('repo', repo)">{{ t('gv.backToStaging') }}</GnButton>
    </header>
    <HistorySearch v-model:hits="hits" v-model:active="active" v-model:running="searching" :repo="repo" :target="target" :selected="selectedHash" @select="pick" @consumed="ws.historyTarget = null" />
    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="hits && !hits.length && !searching" class="muted empty" data-testid="gv-nomatch">{{ t('gv.noMatch') }}</p>
    <p v-else-if="!commits.length && !loading && !hits" class="muted empty">{{ t('gv.noCommits') }}</p>

    <div class="gv__body">
      <div class="gv__list" data-testid="gv-list">
        <div
          v-for="(c, i) in shown"
          :key="c.hash"
          class="row"
          :class="{ 'row--on': c.hash === selectedHash }"
          :style="{ height: ROW_H + 'px' }"
          role="button"
          tabindex="0"
          :aria-pressed="c.hash === selectedHash"
          :aria-label="rowLabel(c)"
          data-testid="gv-row"
          @click="selectedHash = c.hash"
          @keydown.enter.prevent="selectedHash = c.hash"
          @keydown.space.prevent="selectedHash = c.hash"
        >
          <svg v-if="!hits" class="row__graph" :width="graphW" :height="ROW_H" aria-hidden="true">
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
            <GnBadge v-if="hitOf(c) && showKind(hitOf(c)!)" :tone="KIND_TONE[hitOf(c)!.kind]" class="row__kind" data-testid="gv-kind" :data-kind="hitOf(c)!.kind">
              {{ kindText(hitOf(c)!) }}<GnTooltip :text="t(KIND_TIP[hitOf(c)!.kind])" />
            </GnBadge>
            <GnBadge v-for="r in c.refs" :key="r" :tone="refTone(r)">{{ r }}</GnBadge>
            <span class="row__subject">{{ c.subject }}</span>
          </div>
          <span class="row__meta muted">{{ c.author }}</span>
          <span class="row__meta muted">{{ c.shortHash }}</span>
        </div>
        <div v-if="!hits && commits.length >= limit" class="more">
          <GnButton size="sm" :disabled="loading" @click="more">{{ t('gv.loadMore') }}</GnButton>
        </div>
      </div>

      <aside v-if="selected" class="gv__detail" data-testid="gv-detail">
        <h3>{{ selected.subject }}</h3>
        <dl>
          <dt>{{ t('gv.hash') }}</dt><dd class="mono">{{ selected.hash }}</dd>
          <dt>{{ t('gv.author') }}</dt><dd>{{ selected.author }}</dd>
          <dt>{{ t('gv.date') }}</dt><dd>{{ fmtDate(selected.date) }}</dd>
          <dt>{{ t('gv.parents') }}</dt><dd class="mono">{{ selected.parents.map((p) => p.slice(0, 7)).join(', ') || '—' }}</dd>
        </dl>
        <div v-if="selectedHit && showKind(selectedHit)" class="gv__hit" data-testid="gv-hit">
          <GnBadge :tone="KIND_TONE[selectedHit.kind]">{{ kindText(selectedHit) }}<GnTooltip :text="t(KIND_TIP[selectedHit.kind])" /></GnBadge>
        </div>
        <GnButton size="sm" class="gv__rb" data-testid="gv-copy-hash" @click="copyHash">{{ t('hs.copyHash') }}</GnButton>
        <div v-if="ci" class="gv__ci">
          <GnBadge :tone="CI_TONE[ci.state]">{{ t(CI_TEXT[ci.state]) }}<GnTooltip :text="ci.checks.map((c) => `${c.name}: ${c.state}`).join('\n')" /></GnBadge>
          <GnButton v-if="failUrl" size="sm" tone="danger" @click="api.hostingOpen(repo.path, failUrl!)">{{ t('gv.seeFailure') }}</GnButton>
        </div>
        <GnButton size="sm" tone="warn" class="gv__rb" @click="ws.openTools(repo, 'rebase', selected.hash)">
          {{ t('gv.rebaseHere') }}
          <GnTooltip :text="t('gv.rebaseTip')" />
        </GnButton>
        <GnButton size="sm" class="gv__rb" data-testid="tag-here" @click="ws.openTools(repo, 'tags', selected.hash)">{{ t('gv.tagHere') }}<GnTooltip :text="t('gv.tagHereTip')" /></GnButton>
        <div class="gv__ops">
          <GnButton size="sm" tone="accent" :disabled="opBusy" data-testid="cherry-pick" @click="ask = { kind: 'cherry-pick', hash: selected.hash, subject: selected.subject }">
            {{ t('gv.cherryPick') }}
            <GnTooltip :text="t('gv.cherryPickTip')" />
          </GnButton>
          <GnButton size="sm" tone="warn" :disabled="opBusy" data-testid="revert" @click="ask = { kind: 'revert', hash: selected.hash, subject: selected.subject }">
            {{ t('gv.revert') }}
            <GnTooltip :text="t('gv.revertTip')" />
          </GnButton>
        </div>
        <p v-if="opNotice" class="gv__opnote" :class="opNotice.ok ? 'gv__opnote--ok' : 'gv__opnote--err'" role="status" data-testid="gv-op-notice">{{ opNotice.text }}</p>
        <pre v-if="detail && detail.message.includes('\n')" class="gv__msg">{{ detail.message }}</pre>
        <template v-if="patchRows.length">
          <h4>{{ t('hs.showPatch') }}</h4>
          <pre class="gv__diff" data-testid="gv-patch"><template v-for="(l, i) in patchRows" :key="i"><span :class="l.kind === 'add' ? 'a' : l.kind === 'del' ? 'd' : l.kind === 'hunk' ? 'h' : ''">{{ l.segments.map((s) => s.text).join('') }}{{ '\n' }}</span></template></pre>
        </template>
        <h4 v-if="detail">{{ t('gv.filesChanged', { n: detail.files.length }) }}</h4>
        <ul v-if="detail" class="gv__files">
          <li v-for="f in detail.files" :key="f.path" :class="{ on: diffFile === f.path, touched: !!touched(f.path) }" data-testid="gv-file" @click="showFile(f.path)">
            <GnBadge :tone="f.status === 'D' ? 'danger' : f.status === 'A' ? 'success' : 'accent'">{{ STATUS[f.status] ? t(STATUS[f.status]!) : f.status }}</GnBadge>
            <span class="gv__fpath">{{ f.path }}<GnTooltip :text="f.path" /></span>
            <span v-if="touched(f.path)" class="gv__cnt" data-testid="gv-file-count">{{ touched(f.path)!.binary ? t('hs.binary') : countText(touched(f.path)!) }}</span>
            <GnIconButton icon="external" :label="t('hs.fileAt')" data-testid="gv-file-at" @click.stop="openFileAt(f.path)" />
            <GnIconButton icon="history" :label="t('gv.fileHistory')" @click.stop="ws.openTools(repo, 'file', f.path, 'history')" />
            <GnIconButton icon="person" :label="t('gv.blame')" @click.stop="ws.openTools(repo, 'file', f.path, 'blame')" />
          </li>
        </ul>
        <pre v-if="diffFile" class="gv__diff" data-testid="gv-diff"><template v-for="(l, i) in diffRows" :key="i"><span :class="l.kind === 'add' ? 'a' : l.kind === 'del' ? 'd' : l.kind === 'hunk' ? 'h' : ''"><template v-for="(s, j) in l.segments" :key="j"><mark v-if="s.hit" class="gv__m">{{ s.text }}</mark><template v-else>{{ s.text }}</template></template>{{ '\n' }}</span></template></pre>
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
    <GnDialog v-if="fileAt" width="min(1100px, 94vw)" max-height="88vh" :label="t('hs.fileAtTitle', { file: fileAt.file, hash: fileAt.hash.slice(0, 7) })" @close="fileAt = null">
      <div class="gv__fa" data-testid="gv-file-at-dialog">
        <header class="gv__fa-head">
          <strong class="mono">{{ t('hs.fileAtTitle', { file: fileAt.file, hash: fileAt.hash.slice(0, 7) }) }}</strong>
          <span class="spacer" />
          <GnButton size="sm" data-testid="gv-file-at-close" @click="fileAt = null">{{ t('hs.close') }}</GnButton>
        </header>
        <p v-if="fileAt.error" class="err" role="alert">{{ fileAt.error }}</p>
        <p v-else-if="fileAtMessage" class="muted empty" role="status">{{ fileAtMessage }}</p>
        <div v-else-if="fileAt.data" class="gv__fa-body">
          <CodeEditor :model-value="fileAt.data.text" read-only :filename="fileAt.file" :marks="fileAtMarks" />
        </div>
      </div>
    </GnDialog>
  </div>
</template>

<style scoped lang="scss">
.gv {
  display: flex; flex-direction: column; height: 100%;
  &__head { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--gn-border); }
  &__body { flex: 1; min-height: 0; display: flex; }
  &__list { flex: 1; overflow: auto; min-width: 0; }
  &__rb { margin-top: 10px; }
  &__hit { margin-top: 10px; }
  &__ci { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  &__msg { white-space: pre-wrap; font-family: var(--gn-mono); font-size: 12px; background: var(--gn-bg); padding: 8px 10px; border-radius: var(--gn-radius); margin: 10px 0 0; }
  &__files { list-style: none; margin: 6px 0 0; padding: 0; li { display: flex; align-items: center; gap: 6px; padding: 3px 4px; cursor: pointer; font-size: 12px; border-radius: 4px; &:hover, &.on { background: var(--gn-surface-2); } &.touched .gv__fpath { font-weight: 600; } } }
  &__fpath { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--gn-mono); }
  &__cnt { font-family: var(--gn-mono); font-size: 11px; color: var(--gn-muted); white-space: nowrap; }
  &__diff { margin: 8px 0 0; padding: 8px 10px; background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); font-family: var(--gn-mono); font-size: 11.5px; overflow: auto; max-height: 340px; .a { color: var(--gn-success); } .d { color: var(--gn-danger); } .h { color: var(--gn-accent); } }
  /* o que a busca procurou: fundo E sublinhado (nunca só cor) */
  &__m { background: color-mix(in srgb, var(--gn-warn) 38%, transparent); color: inherit; text-decoration: underline; text-underline-offset: 2px; border-radius: 2px; }
  &__ops { display: flex; gap: 8px; margin-top: 8px; }
  &__opnote { margin: 8px 0 0; padding: 6px 10px; font-size: 12px; border-radius: var(--gn-radius); border: 1px solid var(--gn-border); &--ok { color: var(--gn-success); border-color: var(--gn-success); } &--err { color: var(--gn-warn); border-color: var(--gn-warn); } }
  &__detail { width: 420px; border-left: 1px solid var(--gn-border); padding: 14px; overflow: auto; h3 { margin: 0 0 10px; font-size: 14px; } }
  &__fa { display: flex; flex-direction: column; height: 76vh; min-height: 0; }
  &__fa-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--gn-border); }
  &__fa-body { flex: 1; min-height: 0; }
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
  &__kind { flex-shrink: 0; font-family: var(--gn-mono); }
  &__subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__meta { font-size: 11px; white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
}
.more { padding: 12px; text-align: center; }
dl { display: grid; grid-template-columns: 60px 1fr; gap: 6px 10px; margin: 0; }
dt { color: var(--gn-muted); }
dd { margin: 0; word-break: break-all; }
.mono { font-family: var(--gn-mono); font-size: 12px; }
</style>
