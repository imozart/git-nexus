<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { t } from '../i18n';
import { shortcutLabel, useCommandsStore, type Command } from '../stores/commands';

const store = useCommandsStore();
const query = ref('');
const index = ref(0);
const input = ref<HTMLInputElement>();
const listEl = ref<HTMLElement>();

const results = computed<Command[]>(() => (store.isOpen ? store.search(query.value) : []));

watch(
  () => store.isOpen,
  async (open) => {
    if (!open) return;
    query.value = '';
    index.value = 0;
    await nextTick();
    input.value?.focus();
  },
);
watch(query, () => (index.value = 0));

function move(delta: number): void {
  if (!results.value.length) return;
  index.value = (index.value + delta + results.value.length) % results.value.length;
  void nextTick(() => listEl.value?.querySelector('.cp__item--on')?.scrollIntoView({ block: 'nearest' }));
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'ArrowDown') (ev.preventDefault(), move(1));
  else if (ev.key === 'ArrowUp') (ev.preventDefault(), move(-1));
  else if (ev.key === 'Enter') {
    ev.preventDefault();
    const c = results.value[index.value];
    if (c) void store.run(c);
  } else if (ev.key === 'Escape') (ev.preventDefault(), store.close());
}

/** Mostra o nome do grupo só quando muda em relação à linha anterior (sem busca, a lista fica agrupada). */
const showGroup = (i: number) => !query.value.trim() && (i === 0 || results.value[i - 1]!.group !== results.value[i]!.group);
</script>

<template>
  <Teleport to="body">
    <div v-if="store.isOpen" class="cp" @mousedown.self="store.close()">
      <div class="cp__box" role="dialog" :aria-label="t('palette.label')">
        <input
          ref="input"
          v-model="query"
          class="cp__input"
          :placeholder="t('palette.placeholder')"
          spellcheck="false"
          autocomplete="off"
          @keydown="onKey"
        />
        <div ref="listEl" class="cp__list" role="listbox">
          <template v-for="(c, i) in results" :key="c.id">
            <div v-if="showGroup(i)" class="cp__group">{{ c.group }}</div>
            <div
              class="cp__item"
              :class="{ 'cp__item--on': i === index }"
              role="option"
              :aria-selected="i === index"
              @mousemove="index = i"
              @click="store.run(c)"
            >
              <span class="cp__title">{{ c.title }}</span>
              <span v-if="query.trim()" class="cp__gr">{{ c.group }}</span>
              <kbd v-if="c.shortcut" class="cp__kbd">{{ shortcutLabel(c.shortcut) }}</kbd>
            </div>
          </template>
          <p v-if="!results.length" class="cp__empty">{{ t('palette.empty') }}</p>
        </div>
        <div class="cp__foot">{{ t('palette.help') }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.cp {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.45);
  &__box {
    width: min(640px, 92vw);
    background: var(--gn-surface);
    border: 1px solid var(--gn-border);
    border-radius: 10px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  &__input { border: none; border-bottom: 1px solid var(--gn-border); border-radius: 0; padding: 13px 16px; font-size: 15px; background: var(--gn-surface); &:focus { outline: none; } }
  &__list { max-height: min(52vh, 420px); overflow: auto; padding: 4px 0; }
  &__group { padding: 8px 16px 3px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gn-muted); }
  &__item { display: flex; align-items: center; gap: 10px; padding: 7px 16px; cursor: pointer; &--on { background: rgba(79, 134, 247, 0.22); } }
  &__title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__gr { font-size: 11px; color: var(--gn-muted); }
  &__kbd { font-family: var(--gn-mono); font-size: 11px; color: var(--gn-muted); border: 1px solid var(--gn-border); border-radius: 4px; padding: 1px 6px; background: var(--gn-bg); }
  &__empty { margin: 0; padding: 18px; text-align: center; color: var(--gn-muted); }
  &__foot { padding: 6px 16px; font-size: 11px; color: var(--gn-muted); border-top: 1px solid var(--gn-border); background: var(--gn-bg); }
}
</style>
