<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{ diff: string }>();
const root = ref<HTMLElement>();
const cur = ref(-1);

/** Navega entre os blocos (@@) do diff unificado. */
function go(delta: number) {
  const hunks = root.value?.querySelectorAll('.hunk');
  if (!hunks?.length) return;
  cur.value = (cur.value + delta + hunks.length) % hunks.length;
  hunks[cur.value]!.scrollIntoView({ block: 'start' });
}
defineExpose({ go });

const lines = computed(() =>
  props.diff.split('\n').map((text) => ({
    text,
    cls: text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff ') || text.startsWith('index ')
      ? 'meta'
      : text.startsWith('@@')
        ? 'hunk'
        : text.startsWith('+')
          ? 'add'
          : text.startsWith('-')
            ? 'del'
            : '',
  })),
);
</script>

<template>
  <div ref="root" class="diff"><span v-for="(l, i) in lines" :key="i" class="diff__l" :class="l.cls">{{ l.text }}</span></div>
</template>

<style scoped lang="scss">
.diff {
  margin: 0;
  padding: 8px 0;
  font-family: var(--gn-mono);
  font-size: 12px;
  &__l { display: block; padding: 0 12px; white-space: pre; min-height: 1.45em; }
  .add { background: rgba(79, 181, 106, 0.14); color: #8fd7a1; }
  .del { background: rgba(239, 106, 98, 0.14); color: #f0a09a; }
  .hunk { color: var(--gn-accent); background: rgba(79, 134, 247, 0.08); }
  .meta { color: var(--gn-muted); }
}
</style>
