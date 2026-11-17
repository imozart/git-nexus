<script setup lang="ts">
// Tags do repositório: criar (leve ou anotada), ver, ir para a tag, enviar ao remoto e apagar (local e remota). Nada é forçado: se o remoto já
// tem uma tag com o mesmo nome em outro commit, o envio é recusado.
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import type { RemoteTags, RepositoryMeta, TagInfo } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { useWorkspaceStore } from '../../stores/workspace';
import { dateLocale, t } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog.vue';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const tags = ref<TagInfo[]>([]);
const remote = ref<RemoteTags | null>(null);
const loading = ref(false);
const error = ref('');
const done = ref('');
const filter = ref('');

const form = ref({ name: '', target: '', message: '' });
const creating = ref(false);

type Pending = { kind: 'delete-local' | 'delete-remote' | 'go'; tag: TagInfo };
const confirm = ref<Pending | null>(null);

const onRemote = (name: string) => !!remote.value?.ok && remote.value.names.includes(name);
const shown = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return q ? tags.value.filter((x) => `${x.name} ${x.subject} ${x.message ?? ''}`.toLowerCase().includes(q)) : tags.value;
});
const pushable = computed(() => tags.value.filter((x) => remote.value?.ok && !remote.value.names.includes(x.name)).length);

/** Recarrega a lista. NÃO limpa a mensagem da última ação (o erro de "nome inválido" some se a recarga o apagar). */
async function load(): Promise<void> {
  loading.value = true;
  try {
    tags.value = await api.listTags(props.repo.path);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
  // o que o remoto tem: consulta a rede, então fica separado e uma falha não atrapalha a lista
  remote.value = await api.listRemoteTags(props.repo.path).catch(() => null);
}

/** Roda a ação, mostra o resultado e recarrega. `onResult` roda logo que a ação termina (antes de recarregar, que consulta a rede e demora). */
async function act(fn: () => Promise<{ ok: boolean; message: string }>, onResult?: (ok: boolean) => void): Promise<boolean> {
  error.value = '';
  done.value = '';
  try {
    const r = await fn();
    if (r.ok) done.value = r.message;
    else error.value = r.message;
    onResult?.(r.ok);
    ws.bump(props.repo.id); // o grafo mostra as tags nos commits
    await load();
    return r.ok;
  } catch (e) {
    error.value = errMsg(e);
    onResult?.(false);
    return false;
  }
}

async function create(): Promise<void> {
  if (!form.value.name.trim()) return;
  creating.value = true;
  await act(
    () => api.createTag(props.repo.path, { name: form.value.name, target: form.value.target || undefined, message: form.value.message || undefined }),
    (ok) => {
      creating.value = false; // o botão volta já; recarregar (e consultar o remoto) pode demorar
      if (ok) form.value = { name: '', target: '', message: '' };
    },
  );
}

const push = (name?: string) => act(() => api.pushTag(props.repo.path, name));

async function runConfirm(): Promise<void> {
  const c = confirm.value;
  confirm.value = null;
  if (!c) return;
  if (c.kind === 'go') await act(() => api.checkoutRevision(props.repo.path, c.tag.name));
  else await act(() => api.deleteTag(props.repo.path, c.tag.name, c.kind === 'delete-remote'));
}

const when = (s: number) => new Date(s * 1000).toLocaleDateString(dateLocale.value);

onMounted(load);
// "Criar tag aqui" no grafo traz o commit escolhido (vale também com a aba Ferramentas já aberta)
watch(
  () => ws.toolsTarget,
  (target) => {
    if (target && target.repoId === props.repo.id && target.section === 'tags' && target.file) form.value.target = target.file;
  },
  { immediate: true },
);
watch(() => ws.versions[props.repo.id], load);
</script>

<template>
  <div class="tg">
    <header class="tg__head">
      <div>
        <h2>{{ t('tags.title') }}</h2>
        <p class="muted">{{ t('tags.intro') }}</p>
      </div>
      <GnButton size="sm" :disabled="loading" @click="load">{{ t('rv.refresh') }}</GnButton>
    </header>

    <form class="tg__new" data-testid="tag-form" @submit.prevent="create">
      <input v-model="form.name" :placeholder="t('tags.namePh')" :aria-label="t('tags.name')" data-testid="tag-name" spellcheck="false" />
      <input v-model="form.target" :placeholder="t('tags.targetPh')" :aria-label="t('tags.target')" data-testid="tag-target" spellcheck="false" />
      <textarea v-model="form.message" :placeholder="t('tags.messagePh')" :aria-label="t('tags.message')" data-testid="tag-message" rows="2" />
      <div class="tg__newbtns">
        <GnButton variant="primary" tone="success" type="submit" :disabled="creating || !form.name.trim()" data-testid="tag-create">
          {{ form.message.trim() ? t('tags.createAnnotated') : t('tags.create') }}
        </GnButton>
        <small class="muted">{{ form.message.trim() ? t('tags.annotatedHint') : t('tags.lightHint') }}</small>
      </div>
    </form>

    <p v-if="error" class="err" role="alert" data-testid="tag-error">{{ error }}</p>
    <p v-if="done" class="ok" role="status" data-testid="tag-done">✔ {{ done }}</p>

    <div class="tg__bar">
      <input v-model="filter" class="tg__filter" :placeholder="t('tags.filter')" :aria-label="t('tags.filter')" />
      <GnButton size="sm" :disabled="!pushable" :title="t('tags.pushAllTip')" data-testid="tag-push-all" @click="push()">{{ t('tags.pushAll', { n: pushable }) }}</GnButton>
      <small v-if="remote && !remote.ok" class="muted" :title="remote.message">{{ t('tags.remoteUnknown') }}</small>
    </div>

    <p v-if="!tags.length && !loading && !error" class="muted empty">{{ t('tags.empty') }}</p>
    <p v-else-if="tags.length && !shown.length" class="muted empty">{{ t('tags.noMatch') }}</p>

    <ul class="tg__list">
      <li v-for="x in shown" :key="x.name" class="tag" :data-tag="x.name">
        <div class="tag__main">
          <div class="tag__line">
            <strong class="tag__name">{{ x.name }}</strong>
            <GnBadge :tone="x.annotated ? 'accent' : 'neutral'">{{ x.annotated ? t('tags.annotated') : t('tags.light') }}</GnBadge>
            <GnBadge v-if="remote?.ok" :tone="onRemote(x.name) ? 'success' : 'warn'" :title="onRemote(x.name) ? t('tags.onRemoteTip') : t('tags.localOnlyTip')">
              {{ onRemote(x.name) ? t('tags.onRemote') : t('tags.localOnly') }}
            </GnBadge>
          </div>
          <div class="muted tag__meta">{{ x.hash.slice(0, 7) }} · {{ when(x.date) }} · {{ x.subject }}<template v-if="x.tagger"> · {{ x.tagger }}</template></div>
          <pre v-if="x.message && x.message !== x.subject" class="tag__msg">{{ x.message }}</pre>
        </div>
        <div class="tag__btns">
          <GnButton size="sm" tone="accent" :title="t('tags.goTip')" data-testid="tag-go" @click="confirm = { kind: 'go', tag: x }">{{ t('tags.go') }}</GnButton>
          <GnButton v-if="remote?.ok && !onRemote(x.name)" size="sm" data-testid="tag-push" @click="push(x.name)">{{ t('tags.push') }}</GnButton>
          <GnButton size="sm" variant="ghost" tone="danger" data-testid="tag-delete" @click="confirm = { kind: 'delete-local', tag: x }">{{ t('tags.delete') }}</GnButton>
          <GnButton v-if="onRemote(x.name)" size="sm" variant="ghost" tone="danger" data-testid="tag-delete-remote" @click="confirm = { kind: 'delete-remote', tag: x }">{{ t('tags.deleteRemote') }}</GnButton>
        </div>
      </li>
    </ul>

    <ConfirmDialog
      v-if="confirm"
      :title="t(confirm.kind === 'go' ? 'tags.goTitle' : confirm.kind === 'delete-remote' ? 'tags.deleteRemoteTitle' : 'tags.deleteTitle', { name: confirm.tag.name })"
      :lines="[t(confirm.kind === 'go' ? 'tags.goBody' : confirm.kind === 'delete-remote' ? 'tags.deleteRemoteBody' : 'tags.deleteBody')]"
      :confirm-label="t(confirm.kind === 'go' ? 'tags.go' : 'tags.delete')"
      :danger="confirm.kind !== 'go'"
      @confirm="runConfirm"
      @cancel="confirm = null"
    />
  </div>
</template>

<style scoped lang="scss">
.tg {
  padding: 16px 22px;
  max-width: 980px;
  &__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; h2 { margin: 0 0 4px; font-size: 16px; } p { margin: 0; max-width: 720px; } }
  &__new { display: grid; gap: 8px; margin: 14px 0; padding: 12px; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); background: var(--gn-bg); input, textarea { font: inherit; padding: 6px 8px; color: var(--gn-text); background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); &:focus { outline: none; border-color: var(--gn-accent); } } }
  &__newbtns { display: flex; align-items: center; gap: 12px; }
  &__bar { display: flex; align-items: center; gap: 10px; margin: 12px 0 8px; }
  &__filter { flex: 1; max-width: 320px; font: inherit; padding: 5px 8px; color: var(--gn-text); background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); }
  &__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
}
.tag {
  display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px;
  border: 1px solid var(--gn-border); border-radius: var(--gn-radius); background: var(--gn-bg);
  &__main { flex: 1; min-width: 0; }
  &__line { display: flex; align-items: center; gap: 8px; }
  &__name { font-family: var(--gn-mono); }
  &__meta { font-size: 11px; margin-top: 2px; }
  &__msg { margin: 6px 0 0; padding: 6px 8px; font-size: 12px; white-space: pre-wrap; background: var(--gn-surface); border-radius: var(--gn-radius); }
  &__btns { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
}
.err { color: var(--gn-danger); }
.ok { color: var(--gn-success); }
.empty { padding: 20px 0; }
</style>
