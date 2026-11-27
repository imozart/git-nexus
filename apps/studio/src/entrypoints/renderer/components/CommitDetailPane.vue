<script setup lang="ts">
// O detalhe do commit fixo ao lado da lista (#293): cabeçalho (assunto, corpo expansível, autor, data, hash, pais clicáveis, assinatura, onde o commit está), os arquivos com contagem e
// o diff. Quem usa (o Grafo, a comparação) só diz QUAL commit; aqui se carrega o que falta, com o cuidado de não pedir ao Git a cada tecla (120 ms de pausa), de ignorar o carregamento
// que ficou para trás e de guardar os últimos 20 commits vistos.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { GnBadge, GnButton, GnTooltip } from '@git-nexus/ui-kit';
import type { CiStatus, CommitDetail, CommitFile, CommitInfo, CommitRefs, HistoryHit, HistoryQuery, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { dateLocale, t, type MessageKey } from '../i18n';
import { KIND_KEY, KIND_TONE, kindNumbers, rangerFor } from '../history-search-core';
import { Lru } from '../commit-detail-core';
import { agoText } from '../sync';
import { avatarOf } from '../graph-core';
import CommitFiles from './CommitFiles.vue';
import DiffPre from './DiffPre.vue';

const props = defineProps<{
  repo: RepositoryMeta;
  commit: CommitInfo | null;
  /** O commit veio de uma busca na história: o selo e o trecho que casou. */
  hit?: HistoryHit | null;
  active?: HistoryQuery | null;
  /** Sem as ações que mudam o repositório (rebase, tag, cherry-pick, reverter). */
  readonly?: boolean;
  busy?: boolean;
  notice?: { ok: boolean; text: string } | null;
}>();
const emit = defineEmits<{
  jump: [hash: string];
  'cherry-pick': [];
  revert: [];
  rebase: [];
  tag: [];
  'file-at': [path: string];
  'file-history': [path: string];
  blame: [path: string];
  'copy-hash': [];
  error: [message: string];
}>();

const cache = new Lru<CommitDetail>(20);
const detail = ref<CommitDetail | null>(null);
const loading = ref(false);
const ci = ref<CiStatus | null>(null);
const refs = ref<CommitRefs | null>(null);
const refsBusy = ref(false);
const bodyOpen = ref(false);
const diffFile = ref('');
const diffText = ref('');
const diffBusy = ref(false);
let gen = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const hash = computed(() => props.commit?.hash ?? '');
const hit = computed(() => props.hit ?? null);
const showKind = computed(() => !!hit.value && (!!props.active?.text || props.active?.mode === 'range' || hit.value.kind === 'message'));
const kindText = computed(() => (hit.value ? `${t(KIND_KEY[hit.value.kind])}${kindNumbers(hit.value) ? ' ' + kindNumbers(hit.value) : ''}` : ''));
const KIND_TIP = { added: 'hs.kindTip.added', removed: 'hs.kindTip.removed', changed: 'hs.kindTip.changed', message: 'hs.kindTip.message', unknown: 'hs.kindTip.unknown' } as const;
const ranger = computed(() => (props.active ? rangerFor(props.active) : null));
const patchText = computed(() => hit.value?.patch ?? '');
const touched = (path: string) => hit.value?.files.find((f) => f.path === path || f.oldPath === path) ?? null;

const CI_TEXT: Record<CiStatus['state'], MessageKey> = { success: 'gv.ci.success', failure: 'gv.ci.failure', pending: 'gv.ci.pending', none: 'gv.ci.none' };
const CI_TONE = { success: 'success', failure: 'danger', pending: 'warn', none: 'neutral' } as const;
let hostingReady: Promise<boolean> | null = null;
const canCi = () => (hostingReady ??= api.hostingInfo(props.repo.path).then((i) => i.supported && i.hasToken).catch(() => false));
const failUrl = computed(() => ci.value?.checks.find((c) => c.state === 'failure')?.url);

function reset(): void {
  detail.value = null;
  ci.value = null;
  refs.value = null;
  bodyOpen.value = false;
  diffFile.value = '';
  diffText.value = '';
}

async function loadFor(h: string, mine: number): Promise<void> {
  try {
    const d = cache.get(h) ?? (await api.getCommitDetail(props.repo.path, h));
    cache.set(h, d);
    if (mine === gen) detail.value = d;
  } catch (e) {
    if (mine === gen) emit('error', errMsg(e));
  } finally {
    if (mine === gen) loading.value = false;
  }
}

// o detalhe acompanha o commit escolhido; ao percorrer com o teclado só o último pedido de verdade chega ao Git (os do cache chegam na hora)
watch(
  hash,
  (h) => {
    clearTimeout(timer);
    const mine = ++gen;
    reset();
    loading.value = !!h;
    if (!h) return;
    const cached = cache.get(h);
    if (cached) {
      detail.value = cached;
      loading.value = false;
    }
    timer = setTimeout(async () => {
      if (mine !== gen) return;
      if (!cached) await loadFor(h, mine);
      if (mine !== gen) return;
      if (await canCi()) api.getCiStatus(props.repo.path, h).then((s) => mine === gen && (ci.value = s)).catch(() => undefined);
    }, cached ? 0 : 120);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  clearTimeout(timer);
  gen++;
});

async function showFile(path: string): Promise<void> {
  const h = hash.value;
  diffFile.value = path;
  diffBusy.value = true;
  try {
    const text = await api.getCommitFileDiff(props.repo.path, h, path);
    if (h === hash.value && diffFile.value === path) diffText.value = text;
  } catch (e) {
    emit('error', errMsg(e));
  } finally {
    diffBusy.value = false;
  }
}
const paths = computed(() => detail.value?.files.map((f) => f.path) ?? []);
function navFile(dir: 1 | -1): void {
  const i = paths.value.indexOf(diffFile.value);
  const to = paths.value[i < 0 ? (dir === 1 ? 0 : paths.value.length - 1) : i + dir];
  if (to) void showFile(to);
}

async function loadRefs(): Promise<void> {
  const h = hash.value;
  refsBusy.value = true;
  try {
    const r = await api.getCommitRefs(props.repo.path, h);
    if (h === hash.value) refs.value = r;
  } catch (e) {
    emit('error', errMsg(e));
  } finally {
    refsBusy.value = false;
  }
}

// --- o que o cabeçalho mostra ---------------------------------------------------------------------------------------------------------------------------------------
const subject = computed(() => props.commit?.subject ?? '');
/** O corpo da mensagem (depois do assunto); vazio quando é só o assunto. */
const body = computed(() => {
  const m = detail.value?.message ?? '';
  const nl = m.indexOf('\n');
  return nl < 0 ? '' : m.slice(nl + 1).trim();
});
const bodyLines = computed(() => body.value.split('\n'));
const BODY_PREVIEW = 4;
const bodyShown = computed(() => (bodyOpen.value || bodyLines.value.length <= BODY_PREVIEW ? body.value : bodyLines.value.slice(0, BODY_PREVIEW).join('\n') + '\n…'));
const fullDate = (sec: number): string => new Date(sec * 1000).toLocaleString(dateLocale.value, { dateStyle: 'full', timeStyle: 'long' });
const avatarStyle = computed(() => (props.commit ? { background: `hsl(${avatarOf(props.commit.author, props.commit.authorEmail).hue} 52% 36%)` } : {}));
const initials = computed(() => (props.commit ? avatarOf(props.commit.author, props.commit.authorEmail).initials : ''));
const SIG: Record<string, MessageKey> = { good: 'cd.sig.good', bad: 'cd.sig.bad', unknown: 'cd.sig.unknown' };
const SIG_TONE = { good: 'success', bad: 'danger', unknown: 'warn' } as const;
const announce = computed(() => (props.commit && detail.value ? t('cd.announce', { hash: props.commit.shortHash, subject: props.commit.subject, n: detail.value.files.length }) : ''));
const files = computed<readonly CommitFile[]>(() => detail.value?.files ?? []);

const root = ref<HTMLElement>();
defineExpose({ focus: () => (root.value as HTMLElement | undefined)?.focus() });
</script>

<template>
  <aside ref="root" class="cd" data-testid="gv-detail" tabindex="-1" :aria-label="t('cd.region')">
    <p class="cd__sr" role="status" aria-live="polite" data-testid="cd-announce">{{ announce }}</p>
    <div v-if="!commit" class="cd__empty" data-testid="cd-empty">
      <strong>{{ t('cd.empty') }}</strong>
      <span class="muted">{{ t('cd.emptyHint') }}</span>
    </div>
    <template v-else>
      <h3 class="cd__subject" data-testid="cd-subject">{{ subject }}</h3>
      <div v-if="body" class="cd__bodywrap">
        <pre class="cd__body" data-testid="cd-body">{{ bodyShown }}</pre>
        <GnButton v-if="bodyLines.length > BODY_PREVIEW" size="sm" variant="ghost" data-testid="cd-body-toggle" :aria-expanded="bodyOpen" @click="bodyOpen = !bodyOpen">{{ bodyOpen ? t('cd.bodyLess') : t('cd.bodyMore') }}</GnButton>
      </div>
      <div class="cd__who">
        <span class="avatar" :style="avatarStyle" aria-hidden="true">{{ initials }}</span>
        <strong data-testid="gv-author">{{ commit.author }}</strong>
        <span class="muted" data-testid="cd-date">{{ fullDate(commit.date) }} · {{ agoText(commit.date * 1000) }}</span>
        <GnBadge v-if="detail && SIG[detail.signature]" :tone="SIG_TONE[detail.signature as 'good' | 'bad' | 'unknown']" data-testid="cd-sig">{{ t(SIG[detail.signature]!) }}</GnBadge>
      </div>
      <dl class="cd__meta">
        <dt>{{ t('gv.hash') }}</dt>
        <dd class="mono" data-testid="cd-hash">{{ commit.hash }}<GnButton size="sm" variant="ghost" data-testid="gv-copy-hash" @click="emit('copy-hash')">{{ t('hs.copyHash') }}</GnButton></dd>
        <dt>{{ t('gv.parents') }}</dt>
        <dd class="mono">
          <template v-if="commit.parents.length">
            <GnButton v-for="p in commit.parents" :key="p" size="sm" variant="ghost" class="cd__parent" data-testid="cd-parent" :data-hash="p" @click="emit('jump', p)">{{ p.slice(0, 7) }}<GnTooltip :text="t('cd.parentJump', { hash: p.slice(0, 7) })" /></GnButton>
          </template>
          <span v-else>—</span>
        </dd>
      </dl>
      <div class="cd__refs">
        <GnButton v-if="!refs" size="sm" :disabled="refsBusy" data-testid="cd-refs-btn" @click="loadRefs">{{ refsBusy ? t('cd.refsLoading') : t('cd.refsBtn') }}</GnButton>
        <p v-else-if="!refs.branches.length && !refs.tags.length" class="muted" data-testid="cd-refs">{{ t('cd.refsNone') }}</p>
        <div v-else class="cd__chips" data-testid="cd-refs">
          <span v-for="b in refs.branches" :key="'b' + b" class="cd__chip" data-kind="branch">⎇ {{ b }}</span>
          <span v-for="g in refs.tags" :key="'t' + g" class="cd__chip" data-kind="tag">{{ t('cd.tagWord') }} {{ g }}</span>
          <span v-if="refs.truncated" class="muted">{{ t('cd.refsMore') }}</span>
        </div>
      </div>
      <div v-if="hit && showKind" class="cd__hit" data-testid="gv-hit">
        <GnBadge :tone="KIND_TONE[hit.kind]">{{ kindText }}<GnTooltip :text="t(KIND_TIP[hit.kind])" /></GnBadge>
      </div>
      <div v-if="ci" class="cd__ci">
        <GnBadge :tone="CI_TONE[ci.state]">{{ t(CI_TEXT[ci.state]) }}<GnTooltip :text="ci.checks.map((c) => `${c.name}: ${c.state}`).join('\n')" /></GnBadge>
        <GnButton v-if="failUrl" size="sm" tone="danger" @click="api.hostingOpen(repo.path, failUrl!)">{{ t('gv.seeFailure') }}</GnButton>
      </div>
      <div v-if="!readonly" class="cd__ops">
        <GnButton size="sm" tone="warn" @click="emit('rebase')">{{ t('gv.rebaseHere') }}<GnTooltip :text="t('gv.rebaseTip')" /></GnButton>
        <GnButton size="sm" data-testid="tag-here" @click="emit('tag')">{{ t('gv.tagHere') }}<GnTooltip :text="t('gv.tagHereTip')" /></GnButton>
        <GnButton size="sm" tone="accent" :disabled="busy" data-testid="cherry-pick" @click="emit('cherry-pick')">{{ t('gv.cherryPick') }}<GnTooltip :text="t('gv.cherryPickTip')" /></GnButton>
        <GnButton size="sm" tone="warn" :disabled="busy" data-testid="revert" @click="emit('revert')">{{ t('gv.revert') }}<GnTooltip :text="t('gv.revertTip')" /></GnButton>
      </div>
      <p v-if="notice" class="cd__note" :class="notice.ok ? 'cd__note--ok' : 'cd__note--err'" role="status" data-testid="gv-op-notice">{{ notice.text }}</p>

      <template v-if="patchText">
        <h4>{{ t('hs.showPatch') }}</h4>
        <DiffPre :text="patchText" :label="t('hs.showPatch')" testid="gv-patch" />
      </template>

      <p v-if="loading && !detail" class="muted" role="status" data-testid="cd-loading">{{ t('cd.loading') }}</p>
      <CommitFiles v-if="detail" :files="files" :selected="diffFile" :actions="!readonly" :touched="touched" @select="showFile" @file-at="emit('file-at', $event)" @history="emit('file-history', $event)" @blame="emit('blame', $event)" />
      <p v-if="diffBusy" class="muted" role="status">{{ t('cd.loading') }}</p>
      <DiffPre v-if="diffFile && !diffBusy" :text="diffText" :ranger="ranger" :label="t('cd.diffOf', { file: diffFile })" testid="gv-diff" @nav-file="navFile" />
    </template>
  </aside>
</template>

<style scoped lang="scss">
.cd {
  min-width: 0; min-height: 0; padding: 14px; overflow: auto; outline: none; box-sizing: border-box;
  &:focus-visible { box-shadow: inset 0 0 0 2px var(--gn-accent); }
  &__sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  &__empty { display: grid; gap: 6px; padding: 30px 10px; text-align: center; font-size: 13px; }
  &__subject { margin: 0 0 8px; font-size: 14px; line-height: 1.35; word-break: break-word; }
  &__bodywrap { margin-bottom: 8px; }
  &__body { white-space: pre-wrap; font-family: var(--gn-mono); font-size: 12px; background: var(--gn-bg); padding: 8px 10px; border-radius: var(--gn-radius); margin: 0 0 4px; }
  &__who { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; font-size: 12.5px; margin-bottom: 8px; }
  &__meta { display: grid; grid-template-columns: 64px 1fr; gap: 4px 10px; margin: 0 0 8px; align-items: center; dt { color: var(--gn-muted); } dd { margin: 0; word-break: break-all; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; } }
  &__parent { font-family: var(--gn-mono); }
  &__refs { margin: 6px 0; font-size: 12px; p { margin: 0; } }
  &__chips { display: flex; flex-wrap: wrap; gap: 4px; }
  &__chip { padding: 0 6px; font-size: 11px; line-height: 17px; border: 1px solid var(--gn-border); border-radius: 999px; &[data-kind='tag'] { border-color: var(--gn-warn); } &[data-kind='branch'] { border-color: var(--gn-accent); } }
  &__hit, &__ci { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  &__ops { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  &__note { margin: 8px 0 0; padding: 6px 10px; font-size: 12px; border-radius: var(--gn-radius); border: 1px solid var(--gn-border); &--ok { color: var(--gn-success); border-color: var(--gn-success); } &--err { color: var(--gn-warn); border-color: var(--gn-warn); } }
  h4 { margin: 12px 0 4px; font-size: 12px; }
}
.avatar { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; font-size: 9px; font-weight: 700; color: #fff; }
.muted { color: var(--gn-muted); }
.mono { font-family: var(--gn-mono); font-size: 12px; }
</style>
