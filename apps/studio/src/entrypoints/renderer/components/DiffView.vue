<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps<{ diff: string }>();
const emit = defineEmits<{
  /** Índice (0-based) do bloco atual; -1 se não há blocos. */
  (e: 'current', index: number): void;
}>();
const root = ref<HTMLElement>();
const cur = ref(0);

const lines = computed(() => {
  let hunk = -1;
  return props.diff.split('\n').map((text) => {
    const cls =
      text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff ') || text.startsWith('index ')
        ? 'meta'
        : text.startsWith('@@')
          ? 'hunk'
          : text.startsWith('+')
            ? 'add'
            : text.startsWith('-')
              ? 'del'
              : '';
    if (cls === 'hunk') hunk++;
    return { text, cls, hunk: cls === 'hunk' ? hunk : -1 };
  });
});
const hunkCount = computed(() => lines.value.filter((l) => l.cls === 'hunk').length);

async function goTo(index: number, scroll = true) {
  const n = hunkCount.value;
  if (!n) return;
  cur.value = index < 0 ? n - 1 : Math.min(index, n - 1);
  if (!scroll) return;
  await nextTick();
  root.value?.querySelectorAll('.hunk')[cur.value]?.scrollIntoView({ block: 'start' });
}

/** Anda um bloco (@@). Devolve false nas bordas, para o chamador cruzar para outro arquivo. */
function go(delta: number): boolean {
  const target = cur.value + delta;
  if (!hunkCount.value || target < 0 || target >= hunkCount.value) return false;
  void goTo(target);
  return true;
}

watch(
  () => props.diff,
  () => (cur.value = 0),
);
watch([cur, hunkCount], () => emit('current', hunkCount.value ? cur.value : -1), { immediate: true });
defineExpose({ go, goTo });
</script>

<template>
  <div ref="root" class="diff"><span
      v-for="(l, i) in lines"
      :key="i"
      class="diff__l"
      :class="[l.cls, { 'hunk--cur': l.hunk >= 0 && l.hunk === cur }]"
    >{{ l.text }}</span></div>
</template>

<style scoped lang="scss">
.diff {
  margin: 0;
  padding: 8px 0;
  font-family: var(--gn-mono);
  font-size: 12px;
  &__l { display: block; padding: 0 12px; white-space: pre; min-height: 1.45em; }
  .add { background: rgba(79, 181, 106, 0.14); color: var(--gn-diff-add-text); }
  .del { background: rgba(239, 106, 98, 0.14); color: var(--gn-diff-del-text); }
  .hunk { color: var(--gn-accent); background: rgba(79, 134, 247, 0.08); }
  .hunk--cur { background: rgba(79, 134, 247, 0.35); font-weight: 700; }
  .meta { color: var(--gn-muted); }
}
</style>
