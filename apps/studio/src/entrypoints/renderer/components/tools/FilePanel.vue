<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { GnButton, GnSegmented, GnTooltip } from '@git-nexus/ui-kit';
import type { BlameLine, CommitInfo, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { useWorkspaceStore } from '../../stores/workspace';
import ComboBox from '../ComboBox.vue';
import { dateLocale, t } from '../../i18n';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const tracked = ref<string[]>([]);
const file = ref('');
const mode = ref<'history' | 'blame'>('history');
const modeOptions = computed(() => [
  { value: 'history' as const, label: t('fp.history') },
  { value: 'blame' as const, label: t('gv.blame') },
]);
const history = ref<CommitInfo[]>([]);
const blame = ref<BlameLine[]>([]);
const selectedHash = ref('');
const diffText = ref('');
const error = ref('');
const loading = ref(false);

const fmtDate = (s: number) => new Date(s * 1000).toLocaleDateString(dateLocale.value);
const fmtDateTime = (s: number) => new Date(s * 1000).toLocaleString(dateLocale.value);
const UNCOMMITTED = /^0+$/;

/** Cor estável por commit (o mesmo commit tem sempre a mesma faixa no blame). */
function hue(hash: string): string {
  let h = 0;
  for (let i = 0; i < 8; i++) h = (h * 31 + parseInt(hash[i] ?? '0', 16)) % 360;
  return `hsl(${h} 45% 45%)`;
}

async function load(): Promise<void> {
  const f = file.value.trim();
  error.value = '';
  selectedHash.value = '';
  diffText.value = '';
  if (!f) {
    history.value = [];
    blame.value = [];
    return;
  }
  loading.value = true;
  try {
    if (mode.value === 'history') history.value = await api.getFileHistory(props.repo.path, f, 300);
    else blame.value = await api.getBlame(props.repo.path, f);
  } catch (e) {
    error.value = errMsg(e);
    blame.value = [];
  } finally {
    loading.value = false;
  }
}

async function pickCommit(hash: string): Promise<void> {
  if (UNCOMMITTED.test(hash)) return;
  selectedHash.value = hash;
  diffText.value = await api.getCommitFileDiff(props.repo.path, hash, file.value.trim()).catch((e) => errMsg(e));
}

/** Blame: mostra os dados do commit só na primeira linha de cada trecho contínuo. */
const rows = computed(() => blame.value.map((b, i) => ({ b, first: i === 0 || blame.value[i - 1]!.hash !== b.hash })));
const selectedInfo = computed(() => history.value.find((c) => c.hash === selectedHash.value) ?? blame.value.find((b) => b.hash === selectedHash.value));

function applyTarget(): void {
  const tg = ws.toolsTarget;
  if (tg && tg.repoId === props.repo.id && tg.section === 'file') {
    if (tg.file) file.value = tg.file;
    if (tg.mode === 'blame' || tg.mode === 'history') mode.value = tg.mode;
  }
}

watch(() => ws.toolsTarget, () => { applyTarget(); void load(); });
watch(mode, load);
watch(() => ws.versions[props.repo.id], load);
onMounted(async () => {
  applyTarget();
  tracked.value = await api.listTrackedFiles(props.repo.path).catch(() => []);
  await load();
});
</script>

<template>
  <div class="fp">
    <header class="fp__bar">
      <!-- Combobox com busca: mostra só os primeiros resultados (o <datalist> nativo criava um item por arquivo e travava o app em repositórios grandes) -->
      <ComboBox v-model="file" class="fp__file" searchable mono :options="tracked" :placeholder="t('fp.filePh')" :aria-label="t('fp.filePh')" @commit="load" />
      <GnSegmented v-model="mode" :options="modeOptions" :aria-label="t('fp.modeAria')" />
      <GnButton size="sm" :disabled="loading || !file.trim()" @click="load">{{ t('rv.refresh') }}</GnButton>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="!file.trim()" class="muted empty">
      {{ t('fp.intro') }}
    </p>

    <div v-if="file.trim() && !error" class="fp__body">
      <!-- histórico -->
      <div v-if="mode === 'history'" class="fp__list">
        <p v-if="!history.length && !loading" class="muted empty">{{ t('fp.noCommits') }}</p>
        <div v-for="c in history" :key="c.hash" class="hrow" :class="{ on: selectedHash === c.hash }" @click="pickCommit(c.hash)">
          <span class="mono muted">{{ c.shortHash }}</span>
          <span class="hrow__sub">{{ c.subject }}<GnTooltip :text="c.subject" /></span>
          <span class="muted hrow__meta">{{ c.author }} · {{ fmtDate(c.date) }}</span>
        </div>
      </div>

      <!-- blame -->
      <div v-else class="fp__list blame">
        <div v-for="r in rows" :key="r.b.line" class="brow" :class="{ on: selectedHash === r.b.hash, wip: UNCOMMITTED.test(r.b.hash) }">
          <span class="brow__bar" :style="{ background: UNCOMMITTED.test(r.b.hash) ? 'var(--gn-warn)' : hue(r.b.hash) }" />
          <span class="brow__who" @click="pickCommit(r.b.hash)">
            <template v-if="r.first">
              <span class="mono">{{ UNCOMMITTED.test(r.b.hash) ? t('fp.local') : r.b.shortHash }}</span>
              <span class="brow__author">{{ UNCOMMITTED.test(r.b.hash) ? t('fp.uncommitted') : r.b.author }}</span>
              <span class="muted">{{ UNCOMMITTED.test(r.b.hash) ? '' : fmtDate(r.b.date) }}</span>
            </template>
          </span>
          <span class="brow__no">{{ r.b.line }}</span>
          <span class="brow__text">{{ r.b.text }}<GnTooltip :text="r.first ? r.b.summary : ''" /></span>
        </div>
      </div>

      <aside v-if="selectedHash" class="fp__side">
        <h4>{{ selectedInfo && 'subject' in selectedInfo ? selectedInfo.subject : selectedInfo?.summary }}</h4>
        <p v-if="selectedInfo" class="muted">
          {{ selectedInfo.author }} · {{ fmtDateTime(selectedInfo.date) }} · <span class="mono">{{ selectedHash.slice(0, 12) }}</span>
        </p>
        <pre class="diff"><template v-for="(l, i) in diffText.split('\n')" :key="i"><span :class="l.startsWith('+') && !l.startsWith('+++') ? 'a' : l.startsWith('-') && !l.startsWith('---') ? 'd' : l.startsWith('@@') ? 'h' : ''">{{ l }}
</span></template></pre>
      </aside>
    </div>
  </div>
</template>

<style scoped lang="scss">
.fp {
  display: flex;
  flex-direction: column;
  height: 100%;
  &__bar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--gn-border); }
  &__file { flex: 1; min-width: 0; font-family: var(--gn-mono); }
  &__body { flex: 1; min-height: 0; display: flex; }
  &__list { flex: 1; overflow: auto; min-width: 0; font-size: 12.5px; }
  &__side { width: 460px; border-left: 1px solid var(--gn-border); padding: 12px 14px; overflow: auto; h4 { margin: 0 0 4px; font-size: 13px; } p { margin: 0 0 8px; font-size: 12px; } }
}
.hrow {
  display: flex; gap: 10px; align-items: center; padding: 5px 14px; cursor: pointer;
  &:hover { background: var(--gn-surface-2); }
  &.on { background: rgba(79, 134, 247, 0.18); }
  &__sub { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__meta { font-size: 11px; white-space: nowrap; }
}
.blame { font-family: var(--gn-mono); font-size: 12px; }
.brow {
  display: grid; grid-template-columns: 4px 250px 44px minmax(0, 1fr); align-items: stretch; line-height: 1.55;
  &:hover { background: var(--gn-surface-2); }
  &.on { background: rgba(79, 134, 247, 0.16); }
  &__bar { opacity: 0.9; }
  &__who { display: flex; gap: 8px; padding: 0 8px; cursor: pointer; overflow: hidden; white-space: nowrap; background: var(--gn-bg); }
  &__author { overflow: hidden; text-overflow: ellipsis; max-width: 110px; }
  &__no { text-align: right; padding: 0 8px; color: var(--gn-muted); opacity: 0.7; background: var(--gn-bg); user-select: none; }
  &__text { padding: 0 10px; white-space: pre; overflow: hidden; text-overflow: ellipsis; }
}
.diff { margin: 0; padding: 8px 10px; background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); font-family: var(--gn-mono); font-size: 11.5px; overflow: auto; max-height: 70vh; .a { color: var(--gn-success); } .d { color: var(--gn-danger); } .h { color: var(--gn-accent); } }
.mono { font-family: var(--gn-mono); }
.muted { color: var(--gn-muted); }
.err { color: var(--gn-danger); padding: 8px 14px; margin: 0; }
.empty { padding: 30px; text-align: center; max-width: 620px; margin: 0 auto; }
</style>
