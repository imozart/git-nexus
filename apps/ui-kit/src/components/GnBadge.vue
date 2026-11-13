<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'neutral' | 'accent' | 'danger' | 'success' | 'warn' }>(), { tone: 'neutral' });
</script>

<template>
  <span class="gn-badge" :class="`gn-badge--${tone}`"><slot /></span>
</template>

<style scoped lang="scss">
.gn-badge {
  display: inline-block;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 18px;
  border: 1px solid var(--gn-border);
  color: var(--gn-muted);
  white-space: nowrap;

  &--accent { color: var(--gn-accent); border-color: var(--gn-accent); }
  &--danger { color: var(--gn-danger); border-color: var(--gn-danger); }
  &--success { color: var(--gn-success); border-color: var(--gn-success); }
  &--warn { color: var(--gn-warn); border-color: var(--gn-warn); }
}
</style>
