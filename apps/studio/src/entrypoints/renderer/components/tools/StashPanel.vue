<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { GnBadge, GnButton, GnTooltip } from '@git-nexus/ui-kit';
import type { FileEntry, RepositoryMeta, StashEntry, StashFile } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { useWorkspaceStore } from '../../stores/workspace';
import { dateLocale, t, type MessageKey } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog.vue';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const stashes = ref<StashEntry[]>([]);
const selected = ref<StashEntry | null>(null);
const files = ref<StashFile[]>([]);
const pick = ref(new Set<string>());
const diffFile = ref('');
const diffText = ref('');
const error = ref('');
const info = ref('');
const loading = ref(false);

// criar
const form = reactive({ message: '', includeUntracked: true, keepIndex: false });
const changed = ref<FileEntry[]>([]);
const only = ref(new Set<string>());
const showOnly = ref(false);

// diálogos
const confirm = ref<{ title: string; lines: string[]; label: string; danger?: boolean; run: () => Promise<void> } | null>(null);
const renaming = ref('');

const when = (s: number) => new Date(s * 1000).toLocaleString(dateLocale.value);
const STATUS: Record<string, MessageKey> = { A: 'gv.st.A', M: 'gv.st.M', D: 'gv.st.D' };

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [list, st] = await Promise.all([api.listStashes(props.repo.path), api.getGitStatus(props.repo.path)]);
    stashes.value = list;
    changed.value = st.entries;
    const keep = list.find((s) => s.hash === selected.value?.hash);
    if (keep) selected.value = keep;
    else {
      selected.value = null;
      files.value = [];
    }
    if (selected.value) await loadFiles(selected.value);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function select(s: StashEntry): Promise<void> {
  selected.value = s;
  renaming.value = '';
  await loadFiles(s);
}

async function loadFiles(s: StashEntry): Promise<void> {
  pick.value = new Set();
  diffFile.value = '';
  diffText.value = '';
  try {
    files.value = await api.getStashFiles(props.repo.path, s.ref);
  } catch (e) {
    error.value = errMsg(e);
  }
}

async function showDiff(f: StashFile): Promise<void> {
  if (!selected.value) return;
  diffFile.value = f.path;
  diffText.value = await api.getStashFileDiff(props.repo.path, selected.value.ref, f.path);
}

async function act(fn: () => Promise<string | void>): Promise<void> {
  error.value = '';
  info.value = '';
  try {
    const msg = await fn();
    if (msg) info.value = msg;
    ws.bump(props.repo.id); // staging e grafo
  } catch (e) {
    error.value = errMsg(e);
  }
  await load();
}

function create(): Promise<void> {
  return act(async () => {
    const e = await api.createStash(props.repo.path, {
      message: form.message,
      includeUntracked: form.includeUntracked,
      keepIndex: form.keepIndex,
      ...(only.value.size ? { paths: [...only.value] } : {}),
    });
    form.message = '';
    only.value = new Set();
    selected.value = e;
    return t('stash.savedAs', { name: e.message });
  });
}

const toggle = (set: Set<string>, key: string) => (set.has(key) ? set.delete(key) : set.add(key));
const toggleOnly = (p: string) => (only.value = (toggle(only.value, p), new Set(only.value)));
const togglePick = (p: string) => (pick.value = (toggle(pick.value, p), new Set(pick.value)));
const allPicked = computed(() => files.value.length > 0 && files.value.every((f) => pick.value.has(f.path)));
const pickAll = () => (pick.value = allPicked.value ? new Set() : new Set(files.value.map((f) => f.path)));

function apply(drop: boolean): Promise<void> {
  const s = selected.value;
  if (!s) return Promise.resolve();
  return act(async () => {
    const r = await api.applyStash(props.repo.path, s.ref, drop);
    return r.message;
  });
}

async function restore(overwrite = false): Promise<void> {
  const s = selected.value;
  if (!s || !pick.value.size) return;
  const list = [...pick.value];
  error.value = '';
  try {
    await api.restoreStashFiles(props.repo.path, s.ref, list, overwrite);
    info.value = t('stash.restored', { n: list.length });
    ws.bump(props.repo.id);
    await load();
  } catch (e) {
    const msg = errMsg(e);
    if (!overwrite && /alterações locais|already have local changes/.test(msg)) {
      confirm.value = {
        title: t('stash.overwriteTitle'),
        lines: [msg, t('stash.overwriteBody')],
        label: t('stash.overwrite'),
        danger: true,
        run: () => restore(true),
      };
    } else error.value = msg;
  }
}

function askDrop(): void {
  const s = selected.value;
  if (!s) return;
  confirm.value = {
    title: t('stash.dropTitle'),
    lines: [t('stash.dropBody', { name: s.message, ref: s.ref })],
    label: t('stash.drop'),
    danger: true,
    run: () => act(async () => { await api.dropStash(props.repo.path, s.ref); return t('stash.dropped'); }),
  };
}

function startRename(): void {
  renaming.value = selected.value?.message ?? '';
}
function doRename(): Promise<void> {
  const s = selected.value;
  const name = renaming.value;
  renaming.value = '';
  if (!s) return Promise.resolve();
  return act(async () => {
    await api.renameStash(props.repo.path, s.ref, name);
    selected.value = null; // a entrada é recriada no topo da lista; selecionada de volta abaixo
    return t('stash.renamed');
  }).then(async () => {
    if (!selected.value && stashes.value[0]) await select(stashes.value[0]);
  });
}

async function runConfirm(): Promise<void> {
  const c = confirm.value;
  confirm.value = null;
  await c?.run();
}

onMounted(load);
watch(() => ws.versions[props.repo.id], load);
</script>

<template>
  <div class="st">
    <aside class="st__left">
      <section class="box">
        <h3>{{ t('stash.saveChanges') }}</h3>
        <form @submit.prevent="create">
          <input v-model="form.message" :placeholder="t('stash.namePh')" spellcheck="false" />
          <label class="chk"><input v-model="form.includeUntracked" type="checkbox" /> {{ t('stash.includeUntracked') }}</label>
          <label class="chk"><input v-model="form.keepIndex" type="checkbox" /> {{ t('stash.keepIndex') }}</label>
          <button type="button" class="link" @click="showOnly = !showOnly">
            {{ showOnly ? '▾' : '▸' }} {{ t('stash.onlySome') }}{{ only.size ? ` (${only.size})` : '' }}
          </button>
          <ul v-if="showOnly" class="files files--pick">
            <li v-for="e in changed" :key="e.path">
              <label><input type="checkbox" :checked="only.has(e.path)" @change="toggleOnly(e.path)" /> {{ e.path }}</label>
            </li>
            <li v-if="!changed.length" class="muted">{{ t('stash.noLocal') }}</li>
          </ul>
          <GnButton variant="primary" type="submit" :disabled="!changed.length">
            {{ only.size ? t('stash.saveN', { n: only.size }) : t('stash.saveAll') }}
          </GnButton>
        </form>
      </section>

      <h3 class="list-title">{{ t('stash.saved', { n: stashes.length }) }}</h3>
      <p v-if="!stashes.length && !loading" class="muted">{{ t('stash.none') }}</p>
      <ul class="list">
        <li v-for="s in stashes" :key="s.hash" class="item" :class="{ 'item--on': selected?.hash === s.hash }" @click="select(s)">
          <div class="item__top">
            <strong class="item__name">{{ s.message }}<GnTooltip :text="s.message" /></strong>
            <GnBadge v-if="!s.named" tone="neutral">WIP</GnBadge>
          </div>
          <div class="muted item__meta">{{ s.ref }} · ⎇ {{ s.branch }} · {{ when(s.date) }}</div>
        </li>
      </ul>
    </aside>

    <section class="st__right">
      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="info" class="ok">✔ {{ info }}</p>

      <div v-if="!selected" class="muted placeholder">{{ t('stash.select') }}</div>
      <template v-else>
        <header class="st__head">
          <template v-if="renaming">
            <input v-model="renaming" class="rename" spellcheck="false" @keydown.enter="doRename" @keydown.esc="renaming = ''" />
            <GnButton size="sm" variant="primary" @click="doRename">{{ t('stash.save') }}</GnButton>
            <GnButton size="sm" @click="renaming = ''">{{ t('dlg.cancel') }}</GnButton>
          </template>
          <template v-else>
            <h2>{{ selected.message }}<GnTooltip :text="selected.message" /></h2>
            <GnButton size="sm" @click="startRename">{{ t('stash.rename') }}</GnButton>
          </template>
        </header>
        <div class="st__actions">
          <GnButton size="sm" tone="accent" @click="apply(true)">{{ t('stash.applyDrop') }}<GnTooltip :text="t('stash.applyDropTip')" /></GnButton>
          <GnButton size="sm" @click="apply(false)">{{ t('stash.applyKeep') }}<GnTooltip :text="t('stash.applyKeepTip')" /></GnButton>
          <GnButton size="sm" variant="danger" @click="askDrop">{{ t('stash.drop') }}</GnButton>
        </div>

        <div class="st__files">
          <div class="st__filesbar">
            <label class="chk"><input type="checkbox" :checked="allPicked" @change="pickAll" /> {{ t('stash.nFiles', { n: files.length }) }}</label>
            <GnButton size="sm" :disabled="!pick.size" @click="restore()">{{ t('stash.restoreSelected', { n: pick.size || '' }) }}</GnButton>
          </div>
          <ul class="files">
            <li v-for="f in files" :key="f.path" :class="{ 'files__on': diffFile === f.path }" @click="showDiff(f)">
              <input type="checkbox" :checked="pick.has(f.path)" @click.stop @change="togglePick(f.path)" />
              <GnBadge :tone="f.status === 'D' ? 'danger' : f.status === 'A' ? 'success' : 'accent'">{{ STATUS[f.status] ? t(STATUS[f.status]!) : f.status }}</GnBadge>
              <span class="files__path">{{ f.path }}<GnTooltip :text="f.path" /></span>
              <GnBadge v-if="f.untracked" tone="warn">{{ t('status.untracked') }}</GnBadge>
            </li>
          </ul>
        </div>
        <pre v-if="diffFile" class="diff"><template v-for="(l, i) in diffText.split('\n')" :key="i"><span :class="l.startsWith('+') && !l.startsWith('+++') ? 'a' : l.startsWith('-') && !l.startsWith('---') ? 'd' : l.startsWith('@@') ? 'h' : ''">{{ l }}
</span></template></pre>
      </template>
    </section>

    <ConfirmDialog
      v-if="confirm"
      :title="confirm.title"
      :lines="confirm.lines"
      :confirm-label="confirm.label"
      :danger="confirm.danger"
      @confirm="runConfirm"
      @cancel="confirm = null"
    />
  </div>
</template>

<style scoped lang="scss">
.st {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  height: 100%;
  &__left { border-right: 1px solid var(--gn-border); padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
  &__right { padding: 14px 18px; overflow: auto; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  &__head { display: flex; align-items: center; gap: 8px; h2 { margin: 0; font-size: 16px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
  &__actions { display: flex; gap: 8px; }
  &__filesbar { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
}
h3 { margin: 0 0 8px; font-size: 13px; }
.list-title { margin: 6px 0 0; }
.box { border: 1px solid var(--gn-border); border-radius: var(--gn-radius); padding: 10px 12px; form { display: grid; gap: 8px; } }
.chk { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.link { background: none; border: none; color: var(--gn-accent); font: inherit; font-size: 12px; text-align: left; cursor: pointer; padding: 0; }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.item {
  padding: 7px 10px; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); cursor: pointer; background: var(--gn-bg);
  &:hover { border-color: var(--gn-accent); }
  &--on { border-color: var(--gn-accent); background: rgba(79, 134, 247, 0.12); }
  &__top { display: flex; align-items: center; gap: 6px; }
  &__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__meta { font-size: 11px; margin-top: 2px; }
}
.files {
  list-style: none; margin: 0; padding: 0; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); max-height: 260px; overflow: auto;
  li { display: flex; align-items: center; gap: 8px; padding: 4px 10px; cursor: pointer; font-size: 12px; &:hover { background: var(--gn-surface-2); } }
  &__on { background: rgba(79, 134, 247, 0.15); }
  &__path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--gn-mono); }
  &--pick { max-height: 160px; }
}
.diff { margin: 0; padding: 10px 12px; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); background: var(--gn-bg); font-family: var(--gn-mono); font-size: 12px; overflow: auto; max-height: 360px; .a { color: var(--gn-success); } .d { color: var(--gn-danger); } .h { color: var(--gn-accent); } }
.rename { flex: 1; }
.muted { color: var(--gn-muted); font-size: 12px; }
.err { color: var(--gn-danger); margin: 0; }
.ok { color: var(--gn-success); margin: 0; }
.placeholder { padding: 40px; text-align: center; }
</style>
