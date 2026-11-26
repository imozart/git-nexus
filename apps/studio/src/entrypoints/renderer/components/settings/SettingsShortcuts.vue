<script setup lang="ts">
// Configurações > Atalhos: todos os comandos com o atalho de cada um, busca por nome, e REMAPEAR (captura a combinação, avisa se outro comando já a usa, guarda) ou
// restaurar o padrão. A base é a store de comandos (`stores/commands.ts`): a paleta, o atalho em si e esta tela leem o mesmo `shortcutOf`.
import { computed, onBeforeUnmount, ref } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import { t } from '../../i18n';
import { canonicalShortcut, captureShortcut, isReservedShortcut, normalize } from '../../settings-core';
import { shortcutLabel, useCommandsStore, type Command } from '../../stores/commands';

const commands = useCommandsStore();
const filter = ref('');
/** O comando que está esperando a nova combinação (o botão dele mostra "Pressione…"). */
const capturing = ref<string | null>(null);
const warn = ref('');
const message = ref('');

const rows = computed(() => {
  void commands.overrides; // refaz quando algum atalho muda
  const q = normalize(filter.value).split(/\s+/).filter(Boolean);
  return commands
    .listed()
    .map((c) => ({ c, sc: commands.shortcutOf(c) }))
    .filter(({ c, sc }) => q.every((w) => normalize(`${c.title} ${c.group} ${sc ?? ''} ${c.keywords ?? ''}`).includes(w)))
    .sort((a, b) => a.c.group.localeCompare(b.c.group) || a.c.title.localeCompare(b.c.title));
});

function stop(): void {
  capturing.value = null;
  window.removeEventListener('keydown', onKey, true);
}
function start(c: Command): void {
  stop();
  warn.value = message.value = '';
  capturing.value = c.id;
  window.addEventListener('keydown', onKey, true); // na captura: nem o Esc fecha o diálogo, nem a combinação dispara o comando que ela já tem
}
function onKey(ev: KeyboardEvent): void {
  const id = capturing.value;
  if (!id) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.key === 'Escape' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) return stop();
  const got = captureShortcut(ev);
  if (!got) return; // só um modificador apertado ainda
  const cmd = commands.listed().find((c) => c.id === id);
  if (!cmd) return stop();
  if ('error' in got) {
    warn.value = t('settings.sc.needMod');
    return;
  }
  if (isReservedShortcut(got.shortcut)) {
    warn.value = t('settings.sc.reserved');
    return;
  }
  const other = commands.conflictFor(id, got.shortcut);
  if (other) {
    warn.value = t('settings.sc.taken', { name: other.title });
    return;
  }
  // igual ao padrão: não guarda remapeamento nenhum
  commands.setShortcut(id, cmd.shortcut && canonicalShortcut(cmd.shortcut) === canonicalShortcut(got.shortcut) ? null : got.shortcut);
  warn.value = '';
  message.value = t('settings.sc.set', { name: cmd.title, key: shortcutLabel(got.shortcut) });
  stop();
}
onBeforeUnmount(stop);

function clear(c: Command): void {
  stop();
  warn.value = '';
  commands.setShortcut(c.id, '');
  message.value = t('settings.sc.set', { name: c.title, key: t('settings.sc.none') });
}
function restore(c: Command): void {
  stop();
  warn.value = '';
  commands.setShortcut(c.id, null);
  const sc = c.shortcut;
  message.value = t('settings.sc.set', { name: c.title, key: sc ? shortcutLabel(sc) : t('settings.sc.none') });
}
const anyCustom = computed(() => Object.keys(commands.overrides).length > 0);
</script>

<template>
  <div class="ss" data-setting="shortcuts">
    <input v-model="filter" class="sd__input" type="text" :placeholder="t('settings.sc.filter')" :aria-label="t('settings.sc.filter')" data-testid="settings-sc-filter" />
    <p class="sd__status sd__status--ok" role="status" data-testid="settings-sc-status">{{ message }}</p>
    <p v-if="warn" class="sd__status sd__status--err" role="alert" data-testid="settings-sc-warn">{{ warn }}</p>

    <table class="ss__table" data-testid="settings-sc-table">
      <caption class="sr-only">{{ t('settings.sec.shortcuts') }}</caption>
      <thead>
        <tr><th scope="col">{{ t('settings.sc.command') }}</th><th scope="col">{{ t('settings.sc.shortcut') }}</th><th scope="col" /></tr>
      </thead>
      <tbody>
        <tr v-for="{ c, sc } in rows" :key="c.id" :data-command="c.id">
          <td>{{ c.title }}<small class="ss__group">{{ c.group }}</small></td>
          <td class="ss__key">
            <template v-if="capturing === c.id"><em>{{ t('settings.sc.press') }}</em></template>
            <template v-else-if="sc"><kbd>{{ shortcutLabel(sc) }}</kbd><small v-if="commands.isCustom(c.id)" class="ss__custom">{{ t('settings.sc.custom') }}</small></template>
            <span v-else class="muted">{{ t('settings.sc.none') }}</span>
          </td>
          <td class="ss__act">
            <GnButton size="sm" variant="ghost" :aria-label="t('settings.sc.changeFor', { name: c.title })" data-testid="settings-sc-change" @click="start(c)">{{ t('settings.sc.change') }}</GnButton>
            <GnButton v-if="sc" size="sm" variant="ghost" :aria-label="t('settings.sc.remove') + ': ' + c.title" data-testid="settings-sc-clear" @click="clear(c)">{{ t('settings.sc.remove') }}</GnButton>
            <GnButton v-if="commands.isCustom(c.id)" size="sm" variant="ghost" :aria-label="t('settings.sc.resetFor', { name: c.title })" data-testid="settings-sc-restore" @click="restore(c)">{{ t('settings.sc.reset') }}</GnButton>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!rows.length" class="muted">{{ t('settings.sc.empty') }}</p>
    <GnButton v-if="anyCustom" size="sm" data-testid="settings-sc-reset-all" @click="commands.resetShortcuts()">{{ t('settings.sc.resetAll') }}</GnButton>
  </div>
</template>

<style scoped lang="scss">
.ss {
  &__table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12.5px; th { text-align: left; font-weight: 600; color: var(--gn-muted); padding: 4px 6px; } td { padding: 3px 6px; border-top: 1px solid var(--gn-border); vertical-align: middle; } }
  &__group { display: block; color: var(--gn-muted); font-size: 11px; }
  &__key kbd { font-family: var(--gn-mono); background: var(--gn-surface-2); border: 1px solid var(--gn-border); border-radius: 4px; padding: 1px 6px; }
  &__custom { margin-left: 6px; color: var(--gn-accent); }
  &__act { text-align: right; white-space: nowrap; }
}
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
