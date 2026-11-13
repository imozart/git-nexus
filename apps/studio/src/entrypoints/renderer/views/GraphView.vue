<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import { buildGraph, type CommitInfo, type RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { useWorkspaceStore } from '../stores/workspace';

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
const selected = computed(() => commits.value.find((c) => c.hash === selectedHash.value));

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

const fmtDate = (s: number) => new Date(s * 1000).toLocaleString('pt-BR');
const refTone = (r: string) => (r.startsWith('HEAD') ? 'accent' : r.startsWith('tag:') ? 'warn' : r.includes('/') ? 'neutral' : 'success');

onMounted(load);
watch(() => ws.versions[props.repo.id], load);
</script>

<template>
  <div class="gv">
    <header class="gv__head">
      <strong>{{ repo.name }}</strong>
      <span class="muted">{{ commits.length }} commit(s) · todas as branches</span>
      <span class="spacer" />
      <GnButton size="sm" :disabled="loading" @click="load">Atualizar</GnButton>
      <GnButton size="sm" @click="ws.open('repo', repo)">Voltar ao staging</GnButton>
    </header>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="!commits.length && !loading" class="muted empty">Este repositório ainda não tem commits.</p>

    <div class="gv__body">
      <div class="gv__list">
        <div
          v-for="(c, i) in commits"
          :key="c.hash"
          class="row"
          :class="{ 'row--on': c.hash === selectedHash }"
          :style="{ height: ROW_H + 'px' }"
          @click="selectedHash = c.hash"
        >
          <svg class="row__graph" :width="graphW" :height="ROW_H">
            <g v-if="layout.rows[i]" fill="none" stroke-width="2">
              <line
                v-for="t in layout.rows[i]!.through"
                :key="'t' + t"
                :x1="x(t)" :y1="0" :x2="x(t)" :y2="ROW_H"
                :stroke="color(t)"
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
        <div v-if="commits.length >= limit" class="more">
          <GnButton size="sm" :disabled="loading" @click="more">Carregar mais</GnButton>
        </div>
      </div>

      <aside v-if="selected" class="gv__detail">
        <h3>{{ selected.subject }}</h3>
        <dl>
          <dt>Hash</dt><dd class="mono">{{ selected.hash }}</dd>
          <dt>Autor</dt><dd>{{ selected.author }}</dd>
          <dt>Data</dt><dd>{{ fmtDate(selected.date) }}</dd>
          <dt>Pais</dt><dd class="mono">{{ selected.parents.map((p) => p.slice(0, 7)).join(', ') || '—' }}</dd>
        </dl>
      </aside>
    </div>
  </div>
</template>

<style scoped lang="scss">
.gv {
  display: flex; flex-direction: column; height: 100%;
  &__head { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--gn-border); }
  &__body { flex: 1; min-height: 0; display: flex; }
  &__list { flex: 1; overflow: auto; min-width: 0; }
  &__detail { width: 340px; border-left: 1px solid var(--gn-border); padding: 14px; overflow: auto; h3 { margin: 0 0 10px; font-size: 14px; } }
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
