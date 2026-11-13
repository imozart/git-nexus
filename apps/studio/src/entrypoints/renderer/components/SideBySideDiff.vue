<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { applyDiscard, blockRows, diffLines, splitLines, type DiffRow } from '@git-nexus/git-core/pure';

const props = defineProps<{
  oldText: string;
  newText: string;
  /** Habilita os botões de descarte (só no diff do working tree). */
  canDiscard: boolean;
  oldLabel: string;
  newLabel: string;
  /** Recolhe trechos inalterados (mostra só o contexto ao redor das diferenças). */
  collapse: boolean;
}>();
const emit = defineEmits<{
  (e: 'discard', p: { content: string; what: 'linha' | 'bloco' }): void;
  (e: 'stats', p: { blocks: number; added: number; removed: number }): void;
}>();

const CONTEXT = 3;
const MAX_ITEMS = 4000;

const oldSplit = computed(() => splitLines(props.oldText));
const newSplit = computed(() => splitLines(props.newText));
const rows = computed(() => diffLines(oldSplit.value.lines, newSplit.value.lines));
const blocks = computed(() => [...new Set(rows.value.filter((r) => r.block >= 0).map((r) => r.block))]);
const stats = computed(() => ({
  added: rows.value.filter((r) => r.newNo !== undefined && r.kind !== 'eq').length,
  removed: rows.value.filter((r) => r.oldNo !== undefined && r.kind !== 'eq').length,
}));

watch(
  [blocks, stats],
  () => emit('stats', { blocks: blocks.value.length, ...stats.value }),
  { immediate: true },
);

// --- recolhimento das linhas inalteradas ---------------------------------------------------
const expanded = ref(new Set<number>());
watch(() => [props.oldText, props.newText], () => (expanded.value = new Set()));

type Item = { kind: 'row'; row: DiffRow; idx: number } | { kind: 'fold'; from: number; count: number };

const allItems = computed<Item[]>(() => {
  const r = rows.value;
  const visible = new Uint8Array(r.length);
  if (!props.collapse) visible.fill(1);
  else {
    r.forEach((row, i) => {
      if (row.block < 0) return;
      for (let k = Math.max(0, i - CONTEXT); k <= Math.min(r.length - 1, i + CONTEXT); k++) visible[k] = 1;
    });
  }
  const out: Item[] = [];
  let i = 0;
  while (i < r.length) {
    if (visible[i]) {
      out.push({ kind: 'row', row: r[i]!, idx: i });
      i++;
      continue;
    }
    let j = i;
    while (j < r.length && !visible[j]) j++;
    const count = j - i;
    if (count <= 2 || expanded.value.has(i)) {
      for (let k = i; k < j; k++) out.push({ kind: 'row', row: r[k]!, idx: k });
    } else out.push({ kind: 'fold', from: i, count });
    i = j;
  }
  return out;
});
const items = computed(() => allItems.value.slice(0, MAX_ITEMS));
const truncated = computed(() => allItems.value.length > MAX_ITEMS);

const isFirstOfBlock = (idx: number) => rows.value[idx]!.block >= 0 && (idx === 0 || rows.value[idx - 1]!.block !== rows.value[idx]!.block);

// --- navegação entre diferenças ----------------------------------------------------------
const body = ref<HTMLDivElement>();
const cur = ref(-1);
function go(delta: number) {
  const n = blocks.value.length;
  if (!n) return;
  cur.value = (cur.value + delta + n) % n;
  body.value?.querySelector(`[data-first="${blocks.value[cur.value]}"]`)?.scrollIntoView({ block: 'center' });
}
watch(() => [props.oldText, props.newText], () => (cur.value = -1));
defineExpose({ go });

// --- descarte ----------------------------------------------------------------------------
function discard(indices: number[], what: 'linha' | 'bloco') {
  // arquivo removido no disco: usa o EOL da versão antiga
  const base = props.newText === '' ? oldSplit.value : newSplit.value;
  const content = applyDiscard(rows.value, new Set(indices), {
    eol: base.eol,
    endsWithNewline: props.newText === '' ? true : base.endsWithNewline,
  });
  emit('discard', { content, what });
}
const discardRow = (idx: number) => discard([idx], 'linha');
const discardBlock = (block: number) => discard(blockRows(rows.value, block), 'bloco');

const KIND_CLASS: Record<DiffRow['kind'], string> = { eq: '', change: 'row--change', del: 'row--del', add: 'row--add' };
</script>

<template>
  <div class="sbs">
    <div class="sbs__head">
      <div class="sbs__label">{{ oldLabel }}</div>
      <div class="sbs__label">{{ newLabel }}</div>
    </div>

    <div v-if="!blocks.length" class="muted empty">Sem diferenças de conteúdo.</div>

    <div ref="body" class="sbs__body">
      <template v-for="(it, n) in items" :key="n">
        <button v-if="it.kind === 'fold'" class="fold" type="button" @click="expanded = new Set(expanded).add(it.from)">
          ⋯ {{ it.count }} linhas inalteradas
        </button>
        <div
          v-else
          class="row"
          :class="KIND_CLASS[it.row.kind]"
          :data-first="isFirstOfBlock(it.idx) ? it.row.block : undefined"
        >
          <span class="no">{{ it.row.oldNo }}</span>
          <span class="code" :class="{ 'code--empty': it.row.oldText === undefined }">{{ it.row.oldText }}</span>
          <span class="ctrl">
            <template v-if="canDiscard && it.row.kind !== 'eq'">
              <button
                v-if="isFirstOfBlock(it.idx)"
                class="ctrl__btn ctrl__btn--block"
                type="button"
                title="Descartar bloco inteiro (volta ao conteúdo da esquerda)"
                @click="discardBlock(it.row.block)"
              >
                »
              </button>
              <button class="ctrl__btn" type="button" title="Descartar esta linha" @click="discardRow(it.idx)">›</button>
            </template>
          </span>
          <span class="no">{{ it.row.newNo }}</span>
          <span class="code" :class="{ 'code--empty': it.row.newText === undefined }">{{ it.row.newText }}</span>
        </div>
      </template>
      <div v-if="truncated" class="muted empty">Exibindo as primeiras {{ MAX_ITEMS }} linhas.</div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.sbs {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  &__head, .row { grid-template-columns: 50px minmax(0, 1fr) 62px 50px minmax(0, 1fr); }
  &__head {
    display: grid;
    border-bottom: 1px solid var(--gn-border);
    background: var(--gn-bg);
    > div:first-child { grid-column: 1 / 4; }
    > div:last-child { grid-column: 4 / 6; }
  }
  &__label { padding: 4px 10px; font-size: 12px; color: var(--gn-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  &__body { flex: 1; min-height: 0; overflow: auto; font-family: var(--gn-mono); font-size: 12.5px; }
}
.row { display: grid; line-height: 1.5; &:hover .code { filter: brightness(1.12); } }
.no {
  padding: 0 8px;
  text-align: right;
  color: var(--gn-muted);
  opacity: 0.7;
  user-select: none;
  background: var(--gn-bg);
}
.code { padding: 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1.5em; }
.code--empty { background: repeating-linear-gradient(135deg, transparent 0 5px, rgba(255, 255, 255, 0.04) 5px 10px); }
.ctrl {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: var(--gn-bg);
  border-left: 1px solid var(--gn-border);
  border-right: 1px solid var(--gn-border);
  &__btn {
    width: 20px;
    height: 18px;
    padding: 0;
    line-height: 1;
    font: inherit;
    font-weight: 700;
    color: var(--gn-muted);
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    &:hover { color: #fff; background: var(--gn-danger); }
    &--block { color: var(--gn-accent); }
  }
}
// cores (IntelliJ): alterada = azul, adicionada = verde, removida = vermelho/cinza
.row--change .code { background: rgba(79, 134, 247, 0.2); }
.row--add .code:not(.code--empty) { background: rgba(79, 181, 106, 0.22); }
.row--del .code:not(.code--empty) { background: rgba(239, 106, 98, 0.2); }
.fold {
  display: grid;
  width: 100%;
  padding: 2px 0;
  color: var(--gn-muted);
  font: inherit;
  text-align: center;
  background: var(--gn-bg);
  border: none;
  border-top: 1px solid var(--gn-border);
  border-bottom: 1px solid var(--gn-border);
  cursor: pointer;
  grid-template-columns: 1fr;
  &:hover { color: var(--gn-text); background: var(--gn-surface-2); }
}
.muted { color: var(--gn-muted); font-size: 12px; }
.empty { padding: 16px; text-align: center; }
.spacer { flex: 1; }
.stat { font-family: var(--gn-mono); font-size: 12px; &--add { color: var(--gn-success); } &--del { color: var(--gn-danger); } }
</style>
