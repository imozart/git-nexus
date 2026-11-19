<script setup lang="ts">
// Diálogo de credencial: o git (ou o ssh) pediu usuário, senha, token ou frase-senha de uma chave; ou quer confirmar um servidor SSH novo.
// O que é digitado vai direto ao git: não é guardado pelo GitNexus (para não digitar sempre, o Git Credential Manager ou o ssh-agent cuidam disso).
import { computed, nextTick, ref, watch } from 'vue';
import { GnButton, GnDialog } from '@git-nexus/ui-kit';
import { isSecretKind } from '@git-nexus/git-core/pure';
import { t } from '../i18n';
import { useAskpassStore } from '../stores/askpass';

const store = useAskpassStore();
const value = ref('');
const reveal = ref(false);
const input = ref<HTMLInputElement | null>(null);
const req = computed(() => store.current);
const secret = computed(() => !!req.value && isSecretKind(req.value.kind));
const title = computed(() => {
  const r = req.value;
  if (!r) return '';
  const host = r.host ?? '';
  switch (r.kind) {
    case 'username': return t('askpass.titleUser', { host });
    case 'password': return t('askpass.titlePassword', { host });
    case 'passphrase': return t('askpass.titlePassphrase');
    case 'confirm': return t('askpass.titleConfirm');
    default: return t('askpass.titleOther');
  }
});

// cada pedido novo começa em branco (a senha de um não pode sobrar no campo do próximo)
watch(
  () => req.value?.id,
  async () => {
    value.value = '';
    reveal.value = false;
    await nextTick();
    input.value?.focus();
  },
);

async function send(answer: string | null): Promise<void> {
  const out = answer;
  value.value = '';
  await store.answer(out);
}
const submit = () => send(req.value?.kind === 'confirm' ? 'yes' : value.value);
</script>

<template>
  <!-- Esc e clique no fundo cancelam (resolvem o pedido com null), como o botão Cancelar; um pedido novo com outro diálogo aberto fica no topo da pilha -->
  <GnDialog v-if="req" width="min(480px, 92vw)" :label="title" initial-focus="input" @close="send(null)">
      <form class="ak__form" data-testid="askpass" @submit.prevent="submit">
        <h3>{{ title }}</h3>
        <p class="ak__prompt" data-testid="askpass-prompt">{{ req.prompt.trim() }}</p>
        <template v-if="req.kind !== 'confirm'">
          <input
            ref="input"
            v-model="value"
            class="ak__input"
            data-testid="askpass-input"
            :type="secret && !reveal ? 'password' : 'text'"
            autocomplete="off"
            spellcheck="false"
            autofocus
          />
          <label v-if="secret" class="ak__show"><input v-model="reveal" type="checkbox" /> {{ t('askpass.show') }}</label>
        </template>
        <p v-if="req.kind === 'confirm'" class="ak__warn">{{ t('askpass.confirmWarn') }}</p>
        <p v-else class="ak__hint">{{ t('askpass.hint') }}</p>
        <div class="ak__btns">
          <GnButton type="button" data-testid="askpass-cancel" @click="send(null)">{{ req.kind === 'confirm' ? t('askpass.no') : t('dlg.cancel') }}</GnButton>
          <GnButton type="submit" variant="primary" data-testid="askpass-ok">{{ req.kind === 'confirm' ? t('askpass.yes') : t('askpass.ok') }}</GnButton>
        </div>
      </form>
  </GnDialog>
</template>

<style scoped lang="scss">
.ak {
  &__form {
    padding: 18px 20px;
    h3 { margin: 0 0 8px; font-size: 15px; }
  }
  &__prompt { margin: 0 0 10px; font: 12px/1.4 var(--gn-mono); color: var(--gn-muted); white-space: pre-wrap; word-break: break-word; }
  &__input { width: 100%; font-family: var(--gn-mono); }
  &__show { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; color: var(--gn-muted); cursor: pointer; }
  &__hint { margin: 10px 0 0; font-size: 12px; color: var(--gn-muted); }
  &__warn { margin: 0; font-size: 12px; color: var(--gn-warn); }
  &__btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
}
</style>
