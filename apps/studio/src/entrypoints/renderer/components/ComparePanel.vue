<script setup lang="ts">
// Comparar duas revisões (#295): base e alvo (branch, tag, hash ou HEAD~3, validados no núcleo), "desde o ancestral comum" ou "entre os dois estados", e o resultado em três abas:
// Commits (o que o alvo tem a mais e a menos, cada um abrindo o detalhe), Arquivos (estado, renomeação e contagem) e Diff (o do arquivo escolhido). Revisão inválida vira texto, sem lançar.
import { computed, onMounted, ref, watch } from 'vue';
import { GnButton, GnSegmented, GnTabs, GnTooltip } from '@git-nexus/ui-kit';
import type { CommitInfo, CompareMode, CompareResult, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { t } from '../i18n';
import { commitsMarkdown, swapped } from '../commit-detail-core';
import { agoText } from '../sync';
import ComboBox from './ComboBox.vue';
import CommitDetailPane from './CommitDetailPane.vue';
import CommitFiles from './CommitFiles.vue';
import DiffPre from './DiffPre.vue';

const props = defineProps<{ repo: RepositoryMeta; base: string; target: string }>();
const emit = defineEmits<{ close: []; 'cherry-pick': [hash: string, subject: string]; revert: [hash: string, subject: string]; 'file-at': [hash: string, path: string]; 'file-history': [path: string]; blame: [path: string] }>();

const base = ref(props.base);
const target = ref(props.target);
const mode = ref<CompareMode>('three');
const result = ref<Extract<CompareResult, { ok: true }> | null>(null);
const error = ref('');
const busy = ref(false);
const tab = ref<'commits' | 'files' | 'diff'>('commits');
const picked = ref<CommitInfo | null>(null);
const file = ref('');
const diffText = ref('');
const note = ref('');
let gen = 0;

const options = ref<string[]>([]);
onMounted(async () => {
  try {
    const l = await api.listBranches(props.repo.path);
    options.value = [...new Set(['HEAD', ...l.locals.map((x) => x.name), ...l.remotes.map((x) => x.name), ...l.tags])];
  } catch {
    options.value = ['HEAD'];
  }
  if (base.value && target.value) void run();
});

const modeOptions = computed(() => [
  { value: 'three', label: t('cmp.mode.three') },
  { value: 'two', label: t('cmp.mode.two') },
]);
const modeHelp = computed(() => t(mode.value === 'three' ? 'cmp.help.three' : 'cmp.help.two'));
const tabs = computed(() => [
  { id: 'commits', title: result.value ? t('cmp.tab.commitsN', { a: result.value.aheadCount, b: result.value.behindCount }) : t('cmp.tab.commits') },
  { id: 'files', title: result.value ? t('cmp.tab.filesN', { n: result.value.filesTotal }) : t('cmp.tab.files') },
  { id: 'diff', title: t('cmp.tab.diff') },
]);

async function run(): Promise<void> {
  const mine = ++gen;
  error.value = '';
  note.value = '';
  busy.value = true;
  try {
    const r = await api.compareRevisions(props.repo.path, base.value, target.value, mode.value);
    if (mine !== gen) return;
    if (!r.ok) {
      result.value = null;
      error.value = t(r.error.code === 'notFound' ? 'cmp.err.notFound' : 'cmp.err.bad', { v: r.error.value });
      return;
    }
    result.value = r;
    picked.value = null;
    file.value = '';
    diffText.value = '';
    if (tab.value === 'diff') tab.value = 'files';
  } catch (e) {
    if (mine === gen) error.value = errMsg(e);
  } finally {
    if (mine === gen) busy.value = false;
  }
}
watch(mode, () => result.value && void run());

function swap(): void {
  const s = swapped(base.value, target.value);
  base.value = s.base;
  target.value = s.target;
  if (base.value && target.value) void run();
}

async function openFile(path: string): Promise<void> {
  const r = result.value;
  if (!r) return;
  file.value = path;
  tab.value = 'diff';
  const f = r.files.find((x) => x.path === path);
  diffText.value = '';
  try {
    const text = await api.getCompareFileDiff(props.repo.path, r.baseHash, r.targetHash, r.mode, path, f?.oldPath);
    if (file.value === path) diffText.value = text;
  } catch (e) {
    error.value = errMsg(e);
  }
}
function navFile(dir: 1 | -1): void {
  const list = result.value?.files.map((f) => f.path) ?? [];
  const i = list.indexOf(file.value);
  const to = list[i < 0 ? (dir === 1 ? 0 : list.length - 1) : i + dir];
  if (to) void openFile(to);
}

async function copyList(): Promise<void> {
  const r = result.value;
  if (!r) return;
  await api.copyText(commitsMarkdown(r.ahead));
  note.value = t('cmp.copied');
  setTimeout(() => (note.value = ''), 2500);
}
const same = computed(() => !!result.value && !result.value.aheadCount && !result.value.behindCount && !result.value.filesTotal);
</script>

<template>
  <section class="cmp" :aria-label="t('cmp.title')" data-testid="cmp">
    <header class="cmp__head">
      <strong>{{ t('cmp.title') }}</strong>
      <span class="spacer" />
      <GnButton size="sm" data-testid="cmp-close" @click="emit('close')">{{ t('cmp.close') }}</GnButton>
    </header>
    <form class="cmp__form" @submit.prevent="run">
      <label class="cmp__f"><span>{{ t('cmp.base') }}</span>
        <ComboBox v-model="base" searchable :options="options" :placeholder="t('cmp.ph')" :aria-label="t('cmp.base')" mono data-testid="cmp-base" @commit="run" />
      </label>
      <GnButton type="button" size="sm" data-testid="cmp-swap" @click="swap">⇄ {{ t('cmp.swap') }}<GnTooltip :text="t('cmp.swapTip')" /></GnButton>
      <label class="cmp__f"><span>{{ t('cmp.target') }}</span>
        <ComboBox v-model="target" searchable :options="options" :placeholder="t('cmp.ph')" :aria-label="t('cmp.target')" mono data-testid="cmp-target" @commit="run" />
      </label>
      <GnButton type="submit" size="sm" tone="accent" :disabled="busy || !base.trim() || !target.trim()" data-testid="cmp-go">{{ t('cmp.go') }}</GnButton>
    </form>
    <div class="cmp__mode">
      <GnSegmented v-model="mode" :options="modeOptions" :aria-label="t('cmp.mode')" data-testid="cmp-mode" />
      <span class="muted" data-testid="cmp-help">{{ modeHelp }}</span>
    </div>
    <p v-if="error" class="err" role="alert" data-testid="cmp-error">{{ error }}</p>
    <p v-if="busy" class="muted" role="status">{{ t('cd.loading') }}</p>

    <template v-if="result">
      <div class="cmp__sum" role="status" data-testid="cmp-summary">
        <strong>↑ {{ result.aheadCount }} · ↓ {{ result.behindCount }}</strong>
        <span class="muted">{{ result.mergeBase ? t('cmp.mergeBase', { hash: result.mergeBase.slice(0, 7) }) : t('cmp.noBase') }}</span>
        <GnButton size="sm" data-testid="cmp-copy" @click="copyList">{{ t('cmp.copy') }}</GnButton>
        <span v-if="note" class="ok">{{ note }}</span>
      </div>
      <p v-if="same" class="muted" data-testid="cmp-same">{{ t('cmp.same') }}</p>
      <GnTabs v-model="tab" :tabs="tabs" data-testid="cmp-tabs" />

      <div v-if="tab === 'commits'" class="cmp__commits" role="tabpanel">
        <div class="cmp__lists">
          <template v-for="g in [{ id: 'ahead', list: result.ahead, n: result.aheadCount }, { id: 'behind', list: result.behind, n: result.behindCount }]" :key="g.id">
            <h4 :data-testid="`cmp-${g.id}-title`">{{ t(g.id === 'ahead' ? 'cmp.ahead' : 'cmp.behind', { n: g.n }) }}</h4>
            <p v-if="g.n > g.list.length" class="muted">{{ t('cmp.commitsCut', { n: g.list.length, total: g.n }) }}</p>
            <p v-if="!g.list.length" class="muted">{{ t('cmp.noCommits') }}</p>
            <ul class="cmp__ul" :aria-label="t(g.id === 'ahead' ? 'cmp.ahead' : 'cmp.behind', { n: g.n })">
              <li v-for="c in g.list" :key="c.hash" :class="{ on: picked?.hash === c.hash }" :data-testid="`cmp-${g.id}-row`" :data-hash="c.hash" tabindex="0" @click="picked = c" @keydown.enter="picked = c">
                <span class="mono">{{ c.shortHash }}</span>
                <span class="cmp__sub">{{ c.subject }}</span>
                <span class="muted cmp__who">{{ c.author }} · {{ agoText(c.date * 1000) }}</span>
              </li>
            </ul>
          </template>
        </div>
        <CommitDetailPane
          v-if="picked"
          :repo="repo"
          :commit="picked"
          class="cmp__detail"
          @jump="(h: string) => (picked = [...result!.ahead, ...result!.behind].find((c) => c.hash === h) ?? picked)"
          @cherry-pick="emit('cherry-pick', picked!.hash, picked!.subject)"
          @revert="emit('revert', picked!.hash, picked!.subject)"
          @rebase="() => undefined"
          @tag="() => undefined"
          @file-at="(p: string) => emit('file-at', picked!.hash, p)"
          @file-history="(p: string) => emit('file-history', p)"
          @blame="(p: string) => emit('blame', p)"
          @error="(m: string) => (error = m)"
          @copy-hash="api.copyText(picked!.hash)"
        />
      </div>

      <div v-else-if="tab === 'files'" class="cmp__files" role="tabpanel">
        <p v-if="result.filesTruncated" class="muted" role="status">{{ t('cmp.filesCut', { n: result.files.length, total: result.filesTotal }) }}</p>
        <CommitFiles :files="result.files" :selected="file" @select="openFile" />
      </div>

      <div v-else class="cmp__diff" role="tabpanel">
        <p v-if="!file" class="muted">{{ t('cmp.pickFile') }}</p>
        <template v-else>
          <div class="cmp__nav">
            <GnButton size="sm" data-testid="cmp-back" @click="tab = 'files'">{{ t('cmp.backFiles') }}</GnButton>
            <strong class="mono">{{ file }}</strong>
          </div>
          <DiffPre :text="diffText" :label="t('cd.diffOf', { file })" testid="cmp-diff" @nav-file="navFile" />
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss">
.cmp {
  display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 12px 14px;
  &__head { display: flex; align-items: center; gap: 10px; }
  &__form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
  &__f { display: grid; gap: 2px; font-size: 12px; color: var(--gn-muted); min-width: 220px; flex: 1; }
  &__mode { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 12px; }
  &__sum { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 13px; }
  &__commits { display: flex; flex-wrap: wrap; gap: 14px; min-height: 0; }
  &__lists { flex: 1; min-width: 320px; h4 { margin: 10px 0 4px; font-size: 12px; } }
  &__detail { flex: 1; min-width: 320px; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); max-height: 70vh; }
  &__ul { list-style: none; margin: 0; padding: 0; li { display: grid; grid-template-columns: 70px 1fr auto; gap: 8px; align-items: center; padding: 3px 6px; font-size: 12.5px; border-radius: 4px; cursor: pointer; outline: none; &:hover, &.on { background: var(--gn-surface-2); } &.on { box-shadow: inset 3px 0 0 var(--gn-accent); } &:focus-visible { box-shadow: inset 0 0 0 2px var(--gn-accent); } } }
  &__sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__who { font-size: 11px; white-space: nowrap; }
  &__nav { display: flex; align-items: center; gap: 10px; }
}
.spacer { flex: 1; }
.muted { color: var(--gn-muted); }
.ok { color: var(--gn-success); font-size: 12px; }
.err { color: var(--gn-danger); margin: 0; font-size: 12.5px; }
.mono { font-family: var(--gn-mono); font-size: 12px; }
</style>
