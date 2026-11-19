<script setup lang="ts">
import { useId } from 'vue';
import { GnButton, GnDialog } from '@git-nexus/ui-kit';
import { t } from '../i18n';

defineProps<{ title: string; lines: string[]; confirmLabel: string; danger?: boolean }>();
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();
const titleId = useId();
</script>

<template>
  <!-- foco inicial em Cancelar: Enter nunca confirma uma ação destrutiva sem querer; Esc e clique no fundo cancelam -->
  <GnDialog role="alertdialog" width="min(520px, 92vw)" :labelledby="titleId" initial-focus="[data-cancel]" @close="emit('cancel')">
    <div class="dlg__body">
      <h3 :id="titleId">{{ title }}</h3>
      <p v-for="l in lines" :key="l">{{ l }}</p>
      <div class="dlg__btns">
        <GnButton data-cancel @click="emit('cancel')">{{ t('dlg.cancel') }}</GnButton>
        <GnButton :variant="danger ? 'danger' : 'primary'" @click="emit('confirm')">{{ confirmLabel }}</GnButton>
      </div>
    </div>
  </GnDialog>
</template>

<style scoped lang="scss">
.dlg {
  &__body {
    padding: 18px 20px;
    h3 { margin: 0 0 10px; font-size: 15px; }
    p { margin: 0 0 8px; color: var(--gn-muted); word-break: break-word; }
  }
  &__btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
}
</style>
