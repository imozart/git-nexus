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
import { t } from '../i18n';

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
        <div class="pane__title"><GnBadge tone="success">{{ t('mcr.ours') }}</GnBadge></div>
        <CodeEditor :model-value="block.ours" read-only :filename="block.filePath" />
      </div>
      <div class="pane">
        <div class="pane__title">
          <GnBadge>{{ t('mcr.base') }}</GnBadge>
          <span v-if="noBase" class="muted">{{ t('mcr.noBase') }}</span>
        </div>
        <CodeEditor :model-value="block.base" read-only :filename="block.filePath" />
      </div>
      <div class="pane">
        <div class="pane__title"><GnBadge tone="accent">{{ t('mcr.theirs') }}</GnBadge></div>
        <CodeEditor :model-value="block.theirs" read-only :filename="block.filePath" />
      </div>
    </div>

    <div class="mcr__bar">
      <strong>{{ t('mcr.result') }}</strong>
      <GnBadge :tone="locked ? 'danger' : 'success'">
        {{ locked ? t('mcr.blocksInConflict', { n: regions.length }) : t('mcr.noMarkers') }}
      </GnBadge>
      <span class="spacer" />
      <template v-if="regions.length">
        <span class="muted">{{ t('mcr.all') }}</span>
        <GnButton size="sm" @click="chooseAll('ours')">{{ t('mcr.oursShort') }}</GnButton>
        <GnButton size="sm" @click="chooseAll('theirs')">{{ t('mcr.theirsShort') }}</GnButton>
        <GnButton size="sm" @click="chooseAll('both')">{{ t('mcr.both') }}</GnButton>
      </template>
      <GnButton size="sm" variant="ghost" @click="reset">{{ t('mcr.reset') }}</GnButton>
    </div>

    <div v-if="regions.length" class="mcr__blocks">
      <div v-for="(r, i) in regions" :key="r.from" class="blk">
        <button class="blk__go" type="button" @click="editor?.scrollTo(r.from)">
          {{ t('mcr.blockAt', { i: i + 1, line: lineOf(r.from) }) }}
        </button>
        <GnButton size="sm" @click="choose(i, 'ours')">{{ t('mcr.oursShort') }}</GnButton>
        <GnButton v-if="r.base !== null" size="sm" @click="choose(i, 'base')">{{ t('mcr.baseShort') }}</GnButton>
        <GnButton size="sm" @click="choose(i, 'theirs')">{{ t('mcr.theirsShort') }}</GnButton>
        <GnButton size="sm" @click="choose(i, 'both')">{{ t('mcr.both') }}</GnButton>
      </div>
    </div>

    <div class="mcr__result">
      <CodeEditor ref="editor" v-model="result" :filename="block.filePath" highlight-conflicts />
    </div>

    <div class="mcr__foot">
      <span v-if="locked" class="warn">
        {{ t('mcr.locked') }}
      </span>
      <span v-else class="ok">{{ t('mcr.ready') }}</span>
      <GnButton variant="primary" :disabled="locked || busy" @click="emit('resolve', result)">
        {{ t('mcr.markResolved') }}
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
