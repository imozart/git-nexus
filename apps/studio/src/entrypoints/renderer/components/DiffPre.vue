<script setup lang="ts">
// O diff de um arquivo como texto colorido (#293/#295): mais, menos e trecho com o sinal em texto, o que a busca procurou marcado (fundo E sublinhado), salto entre trechos
// (`]` e `[`) e entre arquivos (`n` e `p`, avisados ao pai) e o corte de diffs enormes (mostra o começo, com "Mostrar tudo").
import { computed, ref, watch } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import type { Ranger } from '@git-nexus/git-core/pure';
import { diffLines } from '../history-search-core';
import { nextHunk } from '../commit-detail-core';
import { t } from '../i18n';

const props = defineProps<{ text: string; ranger?: Ranger | null; label: string; testid?: string }>();
const emit = defineEmits<{ 'nav-file': [dir: 1 | -1] }>();

/** Acima disto o diff vem cortado (o resto só quando se pede), para a tela não travar. */
const LIMIT = 300_000;
const all = ref(false);
watch(() => props.text, () => (all.value = false));
const big = computed(() => props.text.length > LIMIT);
const shown = computed(() => (all.value || !big.value ? props.text : props.text.slice(0, LIMIT)));
const rows = computed(() => diffLines(shown.value, props.ranger ?? null, 30_000));
const starts = computed(() => rows.value.flatMap((r, i) => (r.kind === 'hunk' ? [i] : [])));
const cur = ref(-1);
watch(() => props.text, () => (cur.value = -1));
const el = ref<HTMLElement>();

function go(dir: 1 | -1): void {
  const to = nextHunk(starts.value, cur.value, dir);
  if (to === null) return;
  cur.value = to;
  el.value?.querySelector(`[data-ln="${to}"]`)?.scrollIntoView({ block: 'nearest' });
}
function onKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ']') go(1);
  else if (e.key === '[') go(-1);
  else if (e.key === 'n') emit('nav-file', 1);
  else if (e.key === 'p') emit('nav-file', -1);
  else return;
  e.preventDefault();
}
defineExpose({ focus: () => el.value?.focus() });
</script>

<template>
  <div class="dp">
    <p v-if="big && !all" class="dp__note" role="status">
      {{ t('cd.diffBig', { kb: Math.round(text.length / 1024) }) }}
      <GnButton size="sm" data-testid="dp-all" @click="all = true">{{ t('cd.diffAll') }}</GnButton>
    </p>
    <pre ref="el" class="dp__pre" tabindex="0" role="region" :aria-label="label" :aria-description="t('cd.diffHint')" :data-testid="testid" @keydown="onKey"><template v-for="(l, i) in rows" :key="i"><span :data-ln="i" :class="[l.kind === 'add' ? 'a' : l.kind === 'del' ? 'd' : l.kind === 'hunk' ? 'h' : '', { cur: i === cur }]"><template v-for="(s, j) in l.segments" :key="j"><mark v-if="s.hit" class="dp__m">{{ s.text }}</mark><template v-else>{{ s.text }}</template></template>{{ '\n' }}</span></template></pre>
  </div>
</template>

<style scoped lang="scss">
.dp {
  display: flex; flex-direction: column; min-height: 0;
  &__note { margin: 6px 0 0; font-size: 12px; color: var(--gn-warn); display: flex; align-items: center; gap: 8px; }
  &__pre {
    margin: 8px 0 0; padding: 8px 10px; background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); font-family: var(--gn-mono); font-size: 11.5px; overflow: auto; max-height: 420px; outline: none;
    &:focus-visible { box-shadow: 0 0 0 2px var(--gn-accent); }
    .a { color: var(--gn-success); } .d { color: var(--gn-danger); } .h { color: var(--gn-accent); }
    .cur { background: color-mix(in srgb, var(--gn-accent) 22%, transparent); }
  }
  /* o que a busca procurou: fundo E sublinhado (nunca só cor) */
  &__m { background: color-mix(in srgb, var(--gn-warn) 38%, transparent); color: inherit; text-decoration: underline; text-underline-offset: 2px; border-radius: 2px; }
}
</style>
