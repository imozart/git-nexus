<script setup lang="ts">
// Linhas do arquivo resultante do resolvedor de conflitos: número, faixa de ORIGEM (cor + símbolo M / O / M+O / B / ✎) e o código realçado.
import type { ResultLine } from '@git-nexus/git-core/pure';
import { ORIGIN_SYMBOL } from '../merge-resolver-core';
import { t, type MessageKey } from '../i18n';

defineProps<{
  lines: readonly ResultLine[];
  /** Número (1-based) da primeira linha. */
  first: number;
  /** HTML realçado de TODAS as linhas do resultado e o índice, nele, da primeira linha deste trecho. */
  html: readonly string[];
  offset: number;
}>();

const LABEL: Record<string, MessageKey> = {
  stable: 'mr.originStable',
  mine: 'mr.originMine',
  theirs: 'mr.originTheirs',
  both: 'mr.originBoth',
  typed: 'mr.originTyped',
  base: 'mr.originBase',
  pending: 'mr.originPending',
};
</script>

<template>
  <div class="ml">
    <div v-for="(l, i) in lines" :key="i" class="ml__row" :class="`ml__row--${l.origin}`" data-testid="mr-line" :data-origin="l.origin">
      <span class="ml__no">{{ first + i }}</span>
      <span class="ml__sym" role="img" :aria-label="t(LABEL[l.origin]!)">{{ ORIGIN_SYMBOL[l.origin] }}</span>
      <!-- eslint-disable-next-line vue/no-v-html: o HTML vem de highlightLines, que escapa todo o texto -->
      <span class="ml__code" v-html="html[offset + i] || '&nbsp;'"></span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.ml {
  font-family: var(--gn-mono);
  font-size: 12.5px;
  &__row { display: grid; grid-template-columns: 46px 34px minmax(0, 1fr); line-height: 19px; min-height: 19px; white-space: pre; }
  &__no { text-align: right; padding-right: 10px; color: var(--gn-muted); user-select: none; }
  &__sym { font-size: 9px; font-weight: 700; text-align: center; border-left: 3px solid transparent; user-select: none; }
  &__code { padding-left: 8px; overflow: hidden; text-overflow: ellipsis; }
  &__row--mine { .ml__sym { color: var(--gn-accent); border-left-color: var(--gn-accent); background: color-mix(in srgb, var(--gn-accent) 14%, transparent); } .ml__code { background: color-mix(in srgb, var(--gn-accent) 7%, transparent); } }
  &__row--pending { .ml__sym { color: var(--gn-danger); border-left-color: var(--gn-danger); background: color-mix(in srgb, var(--gn-danger) 14%, transparent); } .ml__code { background: color-mix(in srgb, var(--gn-danger) 7%, transparent); } }
  &__row--theirs { .ml__sym { color: var(--gn-renamed); border-left-color: var(--gn-renamed); background: color-mix(in srgb, var(--gn-renamed) 14%, transparent); } .ml__code { background: color-mix(in srgb, var(--gn-renamed) 7%, transparent); } }
  &__row--both { .ml__sym { color: var(--gn-success); border-left-color: var(--gn-success); background: color-mix(in srgb, var(--gn-success) 14%, transparent); } .ml__code { background: color-mix(in srgb, var(--gn-success) 7%, transparent); } }
  &__row--typed { .ml__sym { color: var(--gn-warn); border-left-color: var(--gn-warn); background: color-mix(in srgb, var(--gn-warn) 14%, transparent); } .ml__code { background: color-mix(in srgb, var(--gn-warn) 7%, transparent); } }
  &__row--base { .ml__sym { color: var(--gn-muted); border-left-color: var(--gn-muted); background: color-mix(in srgb, var(--gn-muted) 14%, transparent); } }
}
// realce de sintaxe (classes do @lezer/highlight): só tokens do kit
.ml__code :deep(.tok-keyword), .ml__code :deep(.tok-operatorKeyword), .ml__code :deep(.tok-modifier) { color: var(--gn-accent); }
.ml__code :deep(.tok-string), .ml__code :deep(.tok-string2) { color: var(--gn-success); }
.ml__code :deep(.tok-number), .ml__code :deep(.tok-bool), .ml__code :deep(.tok-null) { color: var(--gn-warn); }
.ml__code :deep(.tok-comment) { color: var(--gn-muted); }
.ml__code :deep(.tok-typeName), .ml__code :deep(.tok-className) { color: var(--gn-renamed); }
.ml__code :deep(.tok-propertyName), .ml__code :deep(.tok-variableName) { color: var(--gn-text); }
</style>
