<script setup lang="ts">
// Indicador de sincronização de uma branch com o remoto: `↓N` (commits do remoto que ainda não vieram, âmbar) e `↑N` (commits locais ainda
// não enviados, verde). Em dia não mostra nada. Divergida mostra os dois e um `!`; sem upstream, um ∅ neutro; remota apagada, um `!` vermelho.
// Só texto (nada de ícone SVG) e sempre com o significado no tooltip: a informação não pode depender só da cor.
import { computed } from 'vue';
import { GnBadge } from '@git-nexus/ui-kit';
import { syncState, type SyncInfo } from '@git-nexus/git-core/pure';
import { syncText } from '../sync';

const props = defineProps<{ sync: SyncInfo | null }>();
const state = computed(() => (props.sync ? syncState(props.sync) : null));
const title = computed(() => syncText(props.sync));
</script>

<template>
  <span v-if="sync && state && state !== 'in-sync' && state !== 'detached'" class="sync" :data-sync="state" :title="title" aria-hidden="true">
    <GnBadge v-if="sync.behind > 0" tone="warn" class="sync__behind">↓{{ sync.behind }}</GnBadge>
    <GnBadge v-if="sync.ahead > 0" tone="success" class="sync__ahead">↑{{ sync.ahead }}</GnBadge>
    <GnBadge v-if="state === 'diverged'" tone="warn" class="sync__alert">!</GnBadge>
    <GnBadge v-else-if="state === 'gone'" tone="danger" class="sync__alert">!</GnBadge>
    <GnBadge v-else-if="state === 'no-upstream'" class="sync__none">∅</GnBadge>
  </span>
</template>

<style scoped lang="scss">
.sync { display: inline-flex; align-items: center; gap: 4px; }
</style>
