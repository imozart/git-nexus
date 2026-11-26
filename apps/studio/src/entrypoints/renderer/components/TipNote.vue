<script setup lang="ts">
// Dica contextual do repositório (#288): uma faixa discreta (`role="note"`), com a ação sugerida, "Não mostrar mais" e fechar. Nada bloqueia; Esc, com o foco
// na faixa, fecha. A regra de aparecer (uma por sessão, nunca depois de dispensada) mora em `stores/tips.ts`.
import { onMounted } from 'vue';
import { GnButton, GnIcon, GnIconButton } from '@git-nexus/ui-kit';
import type { RepositoryMeta } from '@git-nexus/git-core/pure';
import { t } from '../i18n';
import { useTipsStore } from '../stores/tips';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ repo: RepositoryMeta }>();
const tips = useTipsStore();
const ws = useWorkspaceStore();

onMounted(() => void tips.evaluate(props.repo, () => ws.openTools(props.repo, 'stash')));
</script>

<template>
  <div v-if="tips.current && tips.current.repoId === repo.id" class="tip" role="note" :aria-label="t('tip.label')" data-testid="tip" @keydown.esc="tips.close()">
    <GnIcon name="alert" class="tip__icon" />
    <span class="tip__text">{{ t(tips.current.text, tips.current.vars) }}</span>
    <GnButton v-if="tips.current.action" size="sm" tone="accent" data-testid="tip-action" @click="tips.current.action.run()">{{ t(tips.current.action.label) }}</GnButton>
    <GnButton size="sm" variant="ghost" data-testid="tip-never" @click="tips.dismissForever()">{{ t('tip.never') }}</GnButton>
    <GnIconButton icon="x" :label="t('tip.close')" data-testid="tip-close" @click="tips.close()" />
  </div>
</template>

<style scoped lang="scss">
.tip {
  display: flex; align-items: center; gap: 10px; padding: 6px 14px; font-size: 12.5px;
  background: color-mix(in srgb, var(--gn-accent) 10%, var(--gn-bg)); border-bottom: 1px solid var(--gn-border);
  &__icon { color: var(--gn-accent); flex-shrink: 0; }
  &__text { flex: 1; min-width: 0; }
}
</style>
