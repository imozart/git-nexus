<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';

defineProps<{ title: string; lines: string[]; confirmLabel: string; danger?: boolean }>();
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();

function onKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape') emit('cancel');
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="dlg" @mousedown.self="emit('cancel')">
      <div class="dlg__box" role="alertdialog" aria-modal="true">
        <h3>{{ title }}</h3>
        <p v-for="l in lines" :key="l">{{ l }}</p>
        <div class="dlg__btns">
          <GnButton @click="emit('cancel')">Cancelar</GnButton>
          <GnButton :variant="danger ? 'danger' : 'primary'" @click="emit('confirm')">{{ confirmLabel }}</GnButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.dlg {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
  &__box {
    width: min(520px, 92vw);
    padding: 18px 20px;
    background: var(--gn-surface);
    border: 1px solid var(--gn-border);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    h3 { margin: 0 0 10px; font-size: 15px; }
    p { margin: 0 0 8px; color: var(--gn-muted); word-break: break-word; }
  }
  &__btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
}
</style>
