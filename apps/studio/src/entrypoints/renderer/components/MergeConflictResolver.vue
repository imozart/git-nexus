<script setup lang="ts">
import { computed, ref } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import {
  applyChoice,
  findConflictRegions,
  hasConflictMarkers,
  type ConflictChoice,
  type MergeConflictBlock,
} from '@git-nexus/git-core/pure';
import CodeEditor from './CodeEditor.vue';

const props = defineProps<{ block: MergeConflictBlock; busy?: boolean }>();
const emit = defineEmits<{ (e: 'resolve', merged: string): void }>();

// Ponto de partida: o arquivo como está no disco (com marcadores). Sem ele, cai para "theirs".
const result = ref(props.block.workingContent ?? props.block.theirs ?? '');
const editor = ref<InstanceType<typeof CodeEditor>>();

const regions = computed(() => findConflictRegions(result.value));
// Trava de segurança: bloqueia enquanto restar QUALQUER marcador (<<<<<<<, =======, >>>>>>>).
const locked = computed(() => hasConflictMarkers(result.value));
const lineOf = (pos: number) => result.value.slice(0, pos).split('\n').length;

function choose(index: number, choice: ConflictChoice): void {
  const r = regions.value[index];
  if (r) result.value = applyChoice(result.value, r, choice);
}

function chooseAll(choice: ConflictChoice): void {
  // Do último para o primeiro, para não invalidar os offsets dos blocos anteriores.
  for (let i = regions.value.length - 1; i >= 0; i--) choose(i, choice);
}

function reset(): void {
  result.value = props.block.workingContent ?? props.block.theirs ?? '';
}

const noBase = computed(() => props.block.base === '');
</script>

<template>
  <div class="mcr">
    <div class="mcr__top">
      <div class="pane">
        <div class="pane__title"><GnBadge tone="success">Ours (atual)</GnBadge></div>
        <CodeEditor :model-value="block.ours" read-only :filename="block.filePath" />
      </div>
      <div class="pane">
        <div class="pane__title">
          <GnBadge>Base (ancestral comum)</GnBadge>
          <span v-if="noBase" class="muted">sem ancestral (arquivo adicionado nos dois lados)</span>
        </div>
        <CodeEditor :model-value="block.base" read-only :filename="block.filePath" />
      </div>
      <div class="pane">
        <div class="pane__title"><GnBadge tone="accent">Theirs (entrando)</GnBadge></div>
        <CodeEditor :model-value="block.theirs" read-only :filename="block.filePath" />
      </div>
    </div>

    <div class="mcr__bar">
      <strong>Resultado da fusão</strong>
      <GnBadge :tone="locked ? 'danger' : 'success'">
        {{ locked ? `${regions.length} bloco(s) em conflito` : 'sem marcadores' }}
      </GnBadge>
      <span class="spacer" />
      <template v-if="regions.length">
        <span class="muted">Todos:</span>
        <GnButton size="sm" @click="chooseAll('ours')">Ours</GnButton>
        <GnButton size="sm" @click="chooseAll('theirs')">Theirs</GnButton>
        <GnButton size="sm" @click="chooseAll('both')">Ambos</GnButton>
      </template>
      <GnButton size="sm" variant="ghost" @click="reset">Reiniciar</GnButton>
    </div>

    <div v-if="regions.length" class="mcr__blocks">
      <div v-for="(r, i) in regions" :key="r.from" class="blk">
        <button class="blk__go" type="button" @click="editor?.scrollTo(r.from)">
          Bloco {{ i + 1 }} · linha {{ lineOf(r.from) }}
        </button>
        <GnButton size="sm" @click="choose(i, 'ours')">Ours</GnButton>
        <GnButton v-if="r.base !== null" size="sm" @click="choose(i, 'base')">Base</GnButton>
        <GnButton size="sm" @click="choose(i, 'theirs')">Theirs</GnButton>
        <GnButton size="sm" @click="choose(i, 'both')">Ambos</GnButton>
      </div>
    </div>

    <div class="mcr__result">
      <CodeEditor ref="editor" v-model="result" :filename="block.filePath" highlight-conflicts />
    </div>

    <div class="mcr__foot">
      <span v-if="locked" class="warn">
        Resolva ou remova todos os marcadores (&lt;&lt;&lt;&lt;&lt;&lt;&lt;, =======, &gt;&gt;&gt;&gt;&gt;&gt;&gt;) para liberar.
      </span>
      <span v-else class="ok">Pronto para marcar como resolvido.</span>
      <GnButton variant="primary" :disabled="locked || busy" @click="emit('resolve', result)">
        Marcar como Resolvido
      </GnButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.mcr {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  &__top { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--gn-border); height: 34%; min-height: 150px; }
  &__bar { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-top: 1px solid var(--gn-border); border-bottom: 1px solid var(--gn-border); }
  &__blocks { display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 6px 12px; border-bottom: 1px solid var(--gn-border); max-height: 96px; overflow: auto; }
  &__result { flex: 1; min-height: 120px; }
  &__foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 12px; border-top: 1px solid var(--gn-border); }
}
.pane {
  display: flex; flex-direction: column; background: var(--gn-surface); min-width: 0; min-height: 0;
  &__title { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-bottom: 1px solid var(--gn-border); font-size: 12px; }
  > :deep(.code-editor) { flex: 1; }
}
.blk { display: flex; align-items: center; gap: 4px; }
.blk__go { background: none; border: none; color: var(--gn-accent); cursor: pointer; font: inherit; padding: 0 6px 0 0; &:hover { text-decoration: underline; } }
.spacer { flex: 1; }
.muted { color: var(--gn-muted); font-size: 12px; }
.warn { color: var(--gn-warn); }
.ok { color: var(--gn-success); }
</style>
