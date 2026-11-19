<script setup lang="ts">
// Novo resolvedor de conflitos (issue #231, fase 2): o ARQUIVO COMO VAI FICAR em foco, com cada conflito dentro dele como um cartão.
// O texto vem sempre do modelo de escolhas (resolveMerge, do núcleo), nunca é editado "no escuro" e nunca tem marcador.
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import {
  buildMerge,
  emptyChoices,
  presetPicks,
  resolveMerge,
  summarizePicks,
  type ConflictPreset,
  type MergeChoices,
  type MergeConflictBlock,
  type PickedLine,
} from '@git-nexus/git-core/pure';
import MergeLines from './MergeLines.vue';
import { highlightLines } from '../syntax-lines';
import {
  hasTyped,
  isChange,
  layoutResult,
  lineSpan,
  orient,
  picksText,
  resolvedCount,
  selectedLines,
  sideLabels,
  theirsFirst,
  togglePick,
  typedPicks,
} from '../merge-resolver-core';
import { t } from '../i18n';

const props = defineProps<{ block: MergeConflictBlock; busy?: boolean; /** Rebase: o Git inverte os lados (a "ours" é o branch de destino). */ rebase?: boolean }>();
const emit = defineEmits<{ (e: 'resolve', merged: string): void }>();

const oriented = computed(() => orient(props.block, !!props.rebase));
const model = computed(() => buildMerge(oriented.value));
const labels = computed(() => sideLabels(props.block.workingContent, oriented.value.swapped));

const choices = ref<MergeChoices>(emptyChoices());
const result = computed(() => resolveMerge(model.value, choices.value));
const layout = computed(() => layoutResult(model.value, result.value));

// realce de sintaxe: o resultado inteiro (para as linhas do fluxo) e cada versão (para as linhas dos cartões)
const file = computed(() => props.block.filePath);
const hlResult = computed(() => highlightLines(result.value.lines.map((l) => l.text), file.value));
const hlMine = computed(() => highlightLines(model.value.mine.lines, file.value));
const hlTheirs = computed(() => highlightLines(model.value.theirs.lines, file.value));
const hlBase = computed(() => highlightLines(model.value.base.lines, file.value));

// estado só da tela: cartões resolvidos abertos, base aberta, ordem (a origin primeiro) e edição à mão
const expanded = reactive(new Set<number>());
const baseOpen = reactive(new Set<number>());
const swapped = reactive(new Set<number>());
const editing = ref<number | null>(null);
const editText = ref('');
const live = ref('');
const scroller = ref<HTMLElement>();

// se as versões mudarem por baixo (o arquivo foi recarregado), as escolhas antigas não valem mais
watch(
  () => [props.block.base, props.block.ours, props.block.theirs, props.rebase] as const,
  () => reset(),
);

const STATE_KEY = { pending: 'mr.statePending', resolved: 'mr.stateResolved', edited: 'mr.stateEdited' } as const;
const picksOf = (idx: number): PickedLine[] | undefined => choices.value.picks[idx];
const stateOf = (idx: number): 'pending' | 'resolved' | 'edited' => (picksOf(idx) === undefined ? 'pending' : hasTyped(picksOf(idx)) ? 'edited' : 'resolved');
const conflictNo = (idx: number) => model.value.conflicts.indexOf(idx) + 1;
const resolved = computed(() => resolvedCount(model.value, choices.value));
const pendingCount = computed(() => result.value.pending.length);

function summary(idx: number): string {
  const s = summarizePicks(picksOf(idx) ?? []);
  const parts = [
    s.mine ? t('mr.sumMine', { n: s.mine }) : '',
    s.theirs ? t('mr.sumTheirs', { n: s.theirs }) : '',
    s.base ? t('mr.sumBase', { n: s.base }) : '',
    s.typed ? t('mr.sumTyped', { n: s.typed }) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' + ') : t('mr.sumNone');
}

function spanText(idx: number): string {
  const { from, to } = lineSpan(layout.value[idx]!);
  if (!layout.value[idx]!.lines.length) return t('mr.noLines');
  return from === to ? t('mr.line1', { a: from }) : t('mr.lines', { a: from, b: to });
}
const regionName = (idx: number) => t('mr.region', { i: conflictNo(idx), n: model.value.conflicts.length, span: spanText(idx) });

function announce(idx: number): void {
  live.value = picksOf(idx) === undefined ? t('mr.announcePending', { i: conflictNo(idx) }) : t('mr.announceResolved', { i: conflictNo(idx), summary: summary(idx) });
}

function setPicks(idx: number, picks: PickedLine[] | undefined): void {
  const next = { ...choices.value.picks };
  if (picks === undefined) delete next[idx];
  else next[idx] = picks;
  choices.value = { ...choices.value, picks: next };
  announce(idx);
}

function preset(idx: number, p: ConflictPreset, reversed = false): void {
  if (reversed) swapped.add(idx);
  else swapped.delete(idx);
  setPicks(idx, presetPicks(model.value, idx, p));
  expanded.delete(idx);
}

function toggle(idx: number, side: 'mine' | 'theirs', line: number): void {
  const picks = picksOf(idx);
  const first = theirsFirst(picks, swapped.has(idx)) ? 'theirs' : 'mine';
  setPicks(idx, togglePick(picks, side, line, first));
  expanded.add(idx); // continua aberto: decidir linha a linha pede várias caixas seguidas
}

function swapOrder(idx: number): void {
  const picks = picksOf(idx);
  const next = !theirsFirst(picks, swapped.has(idx));
  if (next) swapped.add(idx);
  else swapped.delete(idx);
  // reordena as linhas já marcadas (só faz diferença quando há linhas dos dois lados)
  const mine = (picks ?? []).filter((p) => p.from === 'mine');
  const theirs = (picks ?? []).filter((p) => p.from === 'theirs');
  const rest = (picks ?? []).filter((p) => p.from !== 'mine' && p.from !== 'theirs');
  if (picks !== undefined && !rest.length) setPicks(idx, next ? [...theirs, ...mine] : [...mine, ...theirs]);
  expanded.add(idx);
}

function startEdit(idx: number): void {
  editing.value = idx;
  editText.value = picksOf(idx) === undefined ? model.value.mine.lines.slice(model.value.segments[idx]!.mine.start, model.value.segments[idx]!.mine.end).join('\n') : picksText(layout.value[idx]!.lines);
  void nextTick(() => scroller.value?.querySelector<HTMLTextAreaElement>(`[data-edit="${idx}"]`)?.focus());
}
function applyEdit(idx: number): void {
  setPicks(idx, typedPicks(editText.value));
  editing.value = null;
  expanded.delete(idx);
}

const changeReverted = (idx: number) => choices.value.reverted.includes(idx);
function toggleChange(idx: number): void {
  const set = new Set(choices.value.reverted);
  if (set.has(idx)) set.delete(idx);
  else set.add(idx);
  choices.value = { ...choices.value, reverted: [...set].sort((a, b) => a - b) };
}

function reset(): void {
  choices.value = emptyChoices();
  expanded.clear();
  baseOpen.clear();
  swapped.clear();
  editing.value = null;
  live.value = '';
  void nextTick(jumpToFirstPending);
}

/** Ao abrir o arquivo a tela já mostra o primeiro conflito pendente. */
function jumpToFirstPending(): void {
  scroller.value?.querySelector<HTMLElement>('[data-pending="true"]')?.scrollIntoView({ block: 'center' });
}
onMounted(() => void nextTick(jumpToFirstPending));

const changeKey = (idx: number) => {
  const k = model.value.segments[idx]!.kind;
  return k === 'mine' ? 'mr.changeMine' : k === 'theirs' ? 'mr.changeTheirs' : 'mr.changeBoth';
};
const changeSym = (idx: number) => {
  const k = model.value.segments[idx]!.kind;
  return k === 'mine' ? 'M' : k === 'theirs' ? 'O' : 'M+O';
};

const explain = computed(() => {
  const { mine, theirs } = labels.value;
  if (props.rebase) return mine && theirs ? t('mr.explainRebase', { mine, theirs }) : t('mr.explainRebaseBare');
  return mine && theirs ? t('mr.explainMerge', { mine, theirs }) : t('mr.explainMergeBare');
});
</script>

<template>
  <div class="mr" data-testid="merge-resolver">
    <div class="mr__top">
      <div class="mr__sides" data-testid="mr-explain">
        <span class="mr__chip mr__chip--mine"><b>M</b>{{ t('mr.mine') }}<template v-if="labels.mine"> · {{ labels.mine }}</template></span>
        <span class="mr__chip mr__chip--theirs"><b>O</b>{{ t('mr.theirs') }}<template v-if="labels.theirs"> · {{ labels.theirs }}</template></span>
        <span class="mr__explain">{{ explain }}</span>
      </div>
      <div class="mr__bar">
        <span class="mr__progress" data-testid="mr-progress">{{ t('mr.progress', { n: model.conflicts.length, done: resolved }) }}</span>
        <span class="mr__spacer" />
        <GnButton size="sm" variant="ghost" tone="warn" data-testid="mr-reset" @click="reset">{{ t('mr.reset') }}</GnButton>
        <GnButton variant="primary" tone="success" data-testid="mr-resolve" :disabled="pendingCount > 0 || busy" @click="result.text !== null && emit('resolve', result.text)">
          {{ pendingCount ? t('mr.missing', { n: pendingCount }) : t('mr.markResolved') }}
        </GnButton>
      </div>
    </div>

    <div ref="scroller" class="mr__scroll" data-testid="mr-scroll">
      <p v-if="!model.conflicts.length" class="mr__none">{{ t('mr.noConflicts') }}</p>
      <template v-for="(seg, idx) in model.segments" :key="idx">
        <!-- conflito: cartão -->
        <section
          v-if="seg.kind === 'conflict'"
          class="card"
          :class="{ 'card--done': stateOf(idx) !== 'pending' }"
          role="region"
          :aria-label="regionName(idx)"
          data-testid="mr-card"
          :data-state="stateOf(idx)"
          :data-pending="stateOf(idx) === 'pending'"
        >
          <header class="card__head">
            <span class="card__state" :class="`card__state--${stateOf(idx)}`" data-testid="mr-state">{{ t(STATE_KEY[stateOf(idx)]) }}</span>
            <strong>{{ t('mr.conflict', { i: conflictNo(idx), n: model.conflicts.length }) }}</strong>
            <span class="card__muted">{{ spanText(idx) }}</span>
            <span v-if="stateOf(idx) !== 'pending'" class="card__muted" data-testid="mr-summary">· {{ summary(idx) }}</span>
            <span class="mr__spacer" />
            <GnButton v-if="stateOf(idx) !== 'pending' && editing !== idx" size="sm" variant="ghost" @click="expanded.has(idx) ? expanded.delete(idx) : expanded.add(idx)">
              {{ expanded.has(idx) ? t('mr.collapse') : t('mr.change') }}
            </GnButton>
          </header>

          <!-- resolvido e recolhido: só o resultado -->
          <MergeLines v-if="stateOf(idx) !== 'pending' && !expanded.has(idx) && editing !== idx" :lines="layout[idx]!.lines" :first="layout[idx]!.first" :html="hlResult" :offset="layout[idx]!.offset" />

          <template v-else>
            <!-- editar à mão -->
            <div v-if="editing === idx" class="card__edit">
              <p class="card__muted">{{ t('mr.editHint') }}</p>
              <textarea v-model="editText" class="card__ta" rows="6" spellcheck="false" :aria-label="t('mr.editLabel', { i: conflictNo(idx) })" :data-edit="idx" />
              <div class="card__actions">
                <GnButton size="sm" data-testid="mr-edit-apply" @click="applyEdit(idx)">{{ t('mr.editApply') }}</GnButton>
                <GnButton size="sm" variant="ghost" @click="editing = null">{{ t('mr.editCancel') }}</GnButton>
              </div>
            </div>

            <template v-else>
              <!-- as duas versões, empilhadas, com uma caixa por linha -->
              <div v-for="side in (['mine', 'theirs'] as const)" :key="side" class="side" :class="`side--${side}`" :data-side="side">
                <div class="side__label">
                  <b class="side__sym">{{ side === 'mine' ? 'M' : 'O' }}</b>
                  <strong>{{ side === 'mine' ? t('mr.mine') : t('mr.theirs') }}</strong>
                  <span v-if="labels[side]" class="card__muted">{{ labels[side] }}</span>
                  <span class="mr__spacer" />
                  <span class="card__muted">{{ t('mr.nLines', { n: seg[side].end - seg[side].start }) }}</span>
                </div>
                <p v-if="seg[side].end === seg[side].start" class="side__empty">{{ t('mr.noLines') }}</p>
                <label
                  v-for="n in seg[side].end - seg[side].start"
                  :key="n"
                  class="pl"
                  :class="{ 'pl--on': selectedLines(picksOf(idx), side).has(seg[side].start + n - 1) }"
                  data-testid="mr-pick"
                >
                  <input
                    type="checkbox"
                    :checked="selectedLines(picksOf(idx), side).has(seg[side].start + n - 1)"
                    :aria-label="t('mr.pickLine', { n: seg[side].start + n, side: side === 'mine' ? t('mr.mine') : t('mr.theirs') })"
                    @change="toggle(idx, side, seg[side].start + n - 1)"
                  />
                  <span class="pl__no">{{ seg[side].start + n }}</span>
                  <!-- eslint-disable-next-line vue/no-v-html: highlightLines escapa o texto -->
                  <span class="pl__code" v-html="(side === 'mine' ? hlMine : hlTheirs)[seg[side].start + n - 1] || '&nbsp;'"></span>
                </label>
              </div>

              <!-- a base fica recolhida -->
              <div class="base">
                <GnButton size="sm" variant="ghost" :aria-expanded="baseOpen.has(idx)" data-testid="mr-base-toggle" @click="baseOpen.has(idx) ? baseOpen.delete(idx) : baseOpen.add(idx)">
                  {{ t('mr.base', { n: seg.base.end - seg.base.start }) }}
                </GnButton>
                <span v-if="model.base.lines.length === 0" class="card__muted">{{ t('mr.baseNone') }}</span>
                <div v-if="baseOpen.has(idx)" class="base__lines">
                  <div v-for="n in seg.base.end - seg.base.start" :key="n" class="base__row">
                    <span class="pl__no">{{ seg.base.start + n }}</span>
                    <!-- eslint-disable-next-line vue/no-v-html: highlightLines escapa o texto -->
                    <span class="pl__code" v-html="hlBase[seg.base.start + n - 1] || '&nbsp;'"></span>
                  </div>
                </div>
              </div>

              <div class="card__actions">
                <GnButton size="sm" data-testid="mr-use-mine" @click="preset(idx, 'mine')">{{ t('mr.useMine') }}</GnButton>
                <GnButton size="sm" data-testid="mr-use-theirs" @click="preset(idx, 'theirs')">{{ t('mr.useTheirs') }}</GnButton>
                <GnButton size="sm" data-testid="mr-use-both" @click="preset(idx, 'both', swapped.has(idx))">{{ t('mr.useBoth') }}</GnButton>
                <GnButton size="sm" data-testid="mr-swap" @click="swapOrder(idx)">{{ t('mr.swapOrder') }}</GnButton>
                <GnButton size="sm" data-testid="mr-use-none" @click="preset(idx, 'none')">{{ t('mr.useNone') }}</GnButton>
                <GnButton size="sm" data-testid="mr-edit" @click="startEdit(idx)">{{ t('mr.edit') }}</GnButton>
                <GnButton v-if="stateOf(idx) !== 'pending'" size="sm" variant="ghost" tone="warn" data-testid="mr-reopen" @click="setPicks(idx, undefined)">{{ t('mr.reopen') }}</GnButton>
              </div>

              <!-- prévia do trecho: exatamente o que será gravado -->
              <div class="preview">
                <div class="preview__head"><strong>{{ t('mr.preview') }}</strong><span class="card__muted">{{ t('mr.previewHint') }}</span></div>
                <p v-if="stateOf(idx) === 'pending'" class="side__empty" data-testid="mr-preview-empty">{{ t('mr.previewEmpty') }}</p>
                <p v-else-if="!layout[idx]!.lines.length" class="side__empty" data-testid="mr-preview-none">{{ t('mr.noLines') }}</p>
                <MergeLines v-else :lines="layout[idx]!.lines" :first="layout[idx]!.first" :html="hlResult" :offset="layout[idx]!.offset" />
              </div>
            </template>
          </template>
        </section>

        <!-- o resto do arquivo: no fluxo normal, com a origem na margem -->
        <template v-else>
          <MergeLines :lines="layout[idx]!.lines" :first="layout[idx]!.first" :html="hlResult" :offset="layout[idx]!.offset" />
          <div v-if="isChange(seg)" class="note" data-testid="mr-change" :data-reverted="changeReverted(idx)">
            <span class="note__sym">{{ changeSym(idx) }}</span>
            <strong>{{ changeReverted(idx) ? t('mr.notApplied') : t('mr.applied') }}</strong>
            <span class="card__muted">· {{ t(changeKey(idx)) }} · {{ t('mr.nLines', { n: Math.max(seg.mine.end - seg.mine.start, seg.theirs.end - seg.theirs.start, seg.base.end - seg.base.start) }) }}</span>
            <GnButton size="sm" variant="ghost" data-testid="mr-toggle-change" @click="toggleChange(idx)">{{ changeReverted(idx) ? t('mr.applyChange') : t('mr.undoChange') }}</GnButton>
          </div>
        </template>
      </template>
    </div>

    <div class="mr__legend" data-testid="mr-legend" :aria-label="t('mr.legend')">
      <span class="lg lg--mine"><b>M</b>{{ t('mr.legendMine') }}</span>
      <span class="lg lg--theirs"><b>O</b>{{ t('mr.legendTheirs') }}</span>
      <span class="lg lg--both"><b>M+O</b>{{ t('mr.legendBoth') }}</span>
      <span class="lg lg--typed"><b>✎</b>{{ t('mr.legendTyped') }}</span>
      <span class="lg lg--base"><b>B</b>{{ t('mr.legendBase') }}</span>
    </div>
    <div class="mr__sr" aria-live="polite" data-testid="mr-live">{{ live }}</div>
  </div>
</template>

<style scoped lang="scss">
.mr {
  position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0;
  &__top { border-bottom: 1px solid var(--gn-border); background: var(--gn-surface); }
  &__sides { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 12px 0; }
  &__chip { display: inline-flex; gap: 6px; align-items: center; padding: 1px 8px; border-radius: 10px; font-size: 12px; border: 1px solid var(--gn-border); b { font-size: 9px; } }
  &__chip--mine b { color: var(--gn-accent); }
  &__chip--theirs b { color: var(--gn-renamed); }
  &__explain { color: var(--gn-muted); font-size: 12px; }
  &__bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
  &__progress { font-weight: 600; }
  &__spacer { flex: 1; }
  &__scroll { flex: 1; min-height: 0; overflow: auto; padding-bottom: 12px; }
  &__none { margin: 12px; color: var(--gn-muted); }
  &__legend { display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 6px 12px; border-top: 1px solid var(--gn-border); background: var(--gn-surface); color: var(--gn-muted); font-size: 11px; }
  // texto só para leitores de tela
  &__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
.lg b { display: inline-block; min-width: 22px; text-align: center; margin-right: 4px; padding: 0 4px; border-radius: 3px; font-size: 10px; }
.lg--mine b { color: var(--gn-accent); background: color-mix(in srgb, var(--gn-accent) 18%, transparent); }
.lg--theirs b { color: var(--gn-renamed); background: color-mix(in srgb, var(--gn-renamed) 18%, transparent); }
.lg--both b { color: var(--gn-success); background: color-mix(in srgb, var(--gn-success) 18%, transparent); }
.lg--typed b { color: var(--gn-warn); background: color-mix(in srgb, var(--gn-warn) 18%, transparent); }
.lg--base b { color: var(--gn-muted); background: color-mix(in srgb, var(--gn-muted) 18%, transparent); }

.note { display: flex; align-items: center; gap: 8px; margin: 2px 12px 2px 56px; min-height: 26px; font-size: 11px; color: var(--gn-muted); strong { color: var(--gn-text); font-weight: 500; } }
.note__sym { padding: 0 6px; border: 1px solid var(--gn-border); border-radius: 8px; font-size: 10px; }

.card {
  margin: 8px 12px 8px 46px; border: 1px solid color-mix(in srgb, var(--gn-danger) 55%, var(--gn-border)); border-radius: var(--gn-radius-lg); background: var(--gn-surface); box-shadow: var(--gn-shadow-md); overflow: hidden;
  &--done { border-color: var(--gn-border); box-shadow: none; }
  &__head { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: color-mix(in srgb, var(--gn-danger) 9%, var(--gn-surface)); border-bottom: 1px solid var(--gn-border); }
  &--done &__head { background: color-mix(in srgb, var(--gn-success) 9%, var(--gn-surface)); }
  &__state { padding: 0 8px; border-radius: 9px; font-size: 10px; font-weight: 600; }
  &__state--pending { color: var(--gn-danger); background: color-mix(in srgb, var(--gn-danger) 20%, transparent); }
  &__state--resolved { color: var(--gn-success); background: color-mix(in srgb, var(--gn-success) 20%, transparent); }
  &__state--edited { color: var(--gn-warn); background: color-mix(in srgb, var(--gn-warn) 20%, transparent); }
  &__muted { color: var(--gn-muted); font-size: 11px; }
  &__actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--gn-border); }
  &__edit { padding: 8px 12px; border-bottom: 1px solid var(--gn-border); p { margin: 0 0 6px; } }
  &__ta { width: 100%; font-family: var(--gn-mono); font-size: 12.5px; resize: vertical; }
}
.side {
  border-bottom: 1px solid var(--gn-border);
  &__label { display: flex; align-items: center; gap: 8px; padding: 5px 12px 3px; font-size: 11px; }
  &__sym { font-size: 10px; padding: 0 5px; border-radius: 3px; }
  &--mine &__sym { color: var(--gn-accent); background: color-mix(in srgb, var(--gn-accent) 18%, transparent); }
  &--theirs &__sym { color: var(--gn-renamed); background: color-mix(in srgb, var(--gn-renamed) 18%, transparent); }
  &__empty { margin: 0; padding: 3px 12px 6px; color: var(--gn-muted); font-size: 11px; }
}
.pl {
  display: grid; grid-template-columns: 26px 38px minmax(0, 1fr); align-items: center; line-height: 19px; cursor: pointer; font-family: var(--gn-mono); font-size: 12.5px; white-space: pre;
  input { margin: 0 auto; accent-color: var(--gn-accent); }
  &__no { text-align: right; padding-right: 10px; color: var(--gn-muted); }
  &__code { overflow: hidden; text-overflow: ellipsis; }
  &:not(&--on) &__code { opacity: 0.55; text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--gn-muted) 70%, transparent); }
}
.side--mine .pl--on { background: color-mix(in srgb, var(--gn-accent) 9%, transparent); }
.side--theirs .pl--on { background: color-mix(in srgb, var(--gn-renamed) 9%, transparent); }
.side--theirs .pl input { accent-color: var(--gn-renamed); }
.base { padding: 2px 8px; border-bottom: 1px solid var(--gn-border); display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.base__lines { flex-basis: 100%; font-family: var(--gn-mono); font-size: 12.5px; color: var(--gn-muted); }
.base__row { display: grid; grid-template-columns: 38px minmax(0, 1fr); line-height: 19px; white-space: pre; }
.preview { padding: 6px 0 8px; background: var(--gn-bg); }
.preview__head { display: flex; gap: 8px; padding: 0 12px 4px; font-size: 11px; align-items: baseline; }
.preview .side__empty { padding-top: 0; }
// realce de sintaxe também nas linhas dos cartões
.pl__code :deep(.tok-keyword), .pl__code :deep(.tok-operatorKeyword), .pl__code :deep(.tok-modifier) { color: var(--gn-accent); }
.pl__code :deep(.tok-string), .pl__code :deep(.tok-string2) { color: var(--gn-success); }
.pl__code :deep(.tok-number), .pl__code :deep(.tok-bool), .pl__code :deep(.tok-null) { color: var(--gn-warn); }
.pl__code :deep(.tok-comment) { color: var(--gn-muted); }
.pl__code :deep(.tok-typeName), .pl__code :deep(.tok-className) { color: var(--gn-renamed); }
.base__row :deep(.tok-comment) { color: var(--gn-muted); }
</style>
