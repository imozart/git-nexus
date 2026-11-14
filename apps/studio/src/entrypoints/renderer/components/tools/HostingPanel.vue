<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import type { ChangeRequest, ChangeRequestState, CiState, CiStatus, HostingInfo, ProviderKind, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { useWorkspaceStore } from '../../stores/workspace';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const info = ref<HostingInfo | null>(null);
const error = ref('');
const done = ref('');
const loading = ref(false);
const mode = ref<'list' | 'create'>('list');

// --- conexão (token) ---------------------------------------------------------------------------
const token = ref('');
const kindChoice = ref<ProviderKind>('gitlab');
const connecting = ref(false);

const label = computed(() => (info.value?.kind === 'gitlab' ? 'GitLab' : info.value?.kind === 'github' ? 'GitHub' : 'remoto'));
const crName = computed(() => (info.value?.kind === 'gitlab' ? 'merge request' : 'pull request'));
const crShort = computed(() => (info.value?.kind === 'gitlab' ? 'MR' : 'PR'));

async function loadInfo(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    info.value = await api.hostingInfo(props.repo.path);
    if (info.value.supported && info.value.hasToken) await loadList();
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function connect(): Promise<void> {
  connecting.value = true;
  error.value = '';
  done.value = '';
  try {
    const r = await api.hostingSaveToken(props.repo.path, token.value, info.value?.needsKind ? kindChoice.value : undefined);
    token.value = '';
    done.value = `Conectado como ${r.login}.`;
    await loadInfo();
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    connecting.value = false;
  }
}

async function disconnect(): Promise<void> {
  await api.hostingRemoveToken(props.repo.path);
  items.value = [];
  ci.clear();
  done.value = 'Conta desconectada (o token foi apagado).';
  await loadInfo();
}

const open = (url: string) => api.hostingOpen(props.repo.path, url).catch((e) => (error.value = errMsg(e)));

// --- lista de PRs/MRs ----------------------------------------------------------------------------
const state = ref<ChangeRequestState>('open');
const items = ref<ChangeRequest[]>([]);
const ci = reactive(new Map<string, CiStatus | 'loading' | 'error'>());
const STATE_LABEL: Record<ChangeRequestState, string> = { open: 'Abertos', merged: 'Mergeados', closed: 'Fechados' };

async function loadList(): Promise<void> {
  error.value = '';
  try {
    items.value = await api.listChangeRequests(props.repo.path, state.value);
    // o CI de cada item é consultado em segundo plano (3 por vez), sem travar a lista
    const queue = items.value.filter((x) => x.sha && !ci.has(x.sha));
    queue.forEach((x) => ci.set(x.sha, 'loading'));
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        for (let r = queue.shift(); r; r = queue.shift()) {
          try {
            ci.set(r.sha, await api.getCiStatus(props.repo.path, r.sha));
          } catch {
            ci.set(r.sha, 'error');
          }
        }
      }),
    );
  } catch (e) {
    error.value = errMsg(e);
  }
}
watch(state, loadList);

const CI_LABEL: Record<CiState, string> = { success: 'CI ok', failure: 'CI falhou', pending: 'CI rodando', none: 'sem CI' };
const CI_TONE: Record<CiState, 'success' | 'danger' | 'warn' | 'neutral'> = { success: 'success', failure: 'danger', pending: 'warn', none: 'neutral' };
const ciOf = (sha: string) => ci.get(sha);
const firstFailing = (c: CiStatus | undefined) => c?.checks.find((x) => x.state === 'failure')?.url;
const when = (s: string) => new Date(s).toLocaleString('pt-BR');

// --- criar PR/MR -----------------------------------------------------------------------------------
const form = reactive({ title: '', body: '', base: 'main', draft: false, push: false });
const suggestion = ref<{ head: string; commits: Array<{ short: string; subject: string }>; headPublished: boolean } | null>(null);
const created = ref<{ url: string; number: number } | null>(null);
const creating = ref(false);

async function suggest(): Promise<void> {
  error.value = '';
  try {
    const s = await api.suggestChangeRequest(props.repo.path, form.base);
    form.title = s.title;
    form.body = s.body;
    form.push = !s.headPublished;
    suggestion.value = { head: s.head, commits: s.commits, headPublished: s.headPublished };
  } catch (e) {
    suggestion.value = null;
    error.value = errMsg(e);
  }
}

async function startCreate(): Promise<void> {
  mode.value = 'create';
  created.value = null;
  form.base = info.value?.defaultBranch ?? 'main';
  await suggest();
}

async function create(): Promise<void> {
  if (!suggestion.value) return;
  creating.value = true;
  error.value = '';
  try {
    const r = await api.createChangeRequest(props.repo.path, {
      title: form.title,
      body: form.body,
      base: form.base,
      head: suggestion.value.head,
      draft: form.draft,
      push: form.push,
    });
    created.value = { url: r.url, number: r.number };
    done.value = `${crShort.value} #${r.number} criado${r.pushed ? ' (a branch foi enviada antes)' : ''}.`;
    ws.bump(props.repo.id);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    creating.value = false;
  }
}

const tokenHelp = computed(() =>
  (info.value?.kind ?? kindChoice.value) === 'github'
    ? 'GitHub: Settings → Developer settings → Fine-grained tokens, com acesso ao repositório e permissões "Pull requests: Read and write", "Commit statuses: Read" e "Checks: Read".'
    : 'GitLab: Preferences → Access tokens, com o escopo "api" (para criar MRs) ou só "read_api" (para ver MRs e pipelines).',
);

watch(() => ws.versions[props.repo.id], loadInfo);
onMounted(loadInfo);
</script>

<template>
  <div class="hp">
    <header class="hp__head">
      <div>
        <h2>Pull requests / Merge requests</h2>
        <p v-if="info?.supported" class="muted">
          {{ label }} · <a href="#" @click.prevent="open(info.webUrl!)">{{ info.host }}/{{ info.projectPath }}</a>
        </p>
      </div>
      <GnButton size="sm" :disabled="loading" @click="loadInfo">Atualizar</GnButton>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="done" class="ok">✔ {{ done }}</p>

    <p v-if="info && !info.supported && !info.needsKind" class="muted box">{{ info.reason }}</p>

    <!-- conectar uma conta -->
    <section v-if="info && (info.needsKind || (info.supported && !info.hasToken))" class="box">
      <h3>Conectar uma conta</h3>
      <p class="muted">
        Para listar {{ crName }}s e o CI, e criar {{ crName }}s, o app precisa de um token de acesso.
        Ele fica <b>criptografado pelo sistema</b> e nunca volta para a tela.
        <template v-if="info && !info.secureStorage">
          <br /><span class="warn">⚠ O armazenamento seguro do sistema não está disponível: o token fica só na memória e some ao fechar o app.</span>
        </template>
      </p>
      <div v-if="info.needsKind" class="hp__kind">
        <span>Este host é:</span>
        <label><input v-model="kindChoice" type="radio" value="github" /> GitHub (Enterprise)</label>
        <label><input v-model="kindChoice" type="radio" value="gitlab" /> GitLab</label>
      </div>
      <form class="hp__conn" @submit.prevent="connect">
        <input v-model="token" type="password" placeholder="Cole o token de acesso" autocomplete="off" spellcheck="false" />
        <GnButton type="submit" variant="primary" :disabled="connecting || !token.trim()">{{ connecting ? 'Validando…' : 'Conectar' }}</GnButton>
      </form>
      <p class="muted small">{{ tokenHelp }}</p>
    </section>

    <template v-if="info?.supported && info.hasToken">
      <div class="hp__bar">
        <span class="seg">
          <button type="button" :class="{ on: mode === 'list' }" @click="mode = 'list'">Lista</button>
          <button type="button" :class="{ on: mode === 'create' }" @click="startCreate">Criar {{ crShort }}</button>
        </span>
        <span v-if="mode === 'list'" class="seg">
          <button v-for="(l, k) in STATE_LABEL" :key="k" type="button" :class="{ on: state === k }" @click="state = k">{{ l }}</button>
        </span>
        <span class="spacer" />
        <GnButton size="sm" title="Apaga o token guardado" @click="disconnect">Desconectar</GnButton>
      </div>

      <!-- lista -->
      <section v-if="mode === 'list'">
        <p v-if="!items.length && !loading" class="muted box">Nenhum {{ crName }} {{ STATE_LABEL[state].toLowerCase().replace(/s$/, '') }}.</p>
        <ul class="list">
          <li v-for="it in items" :key="it.number" class="cr">
            <div class="cr__main">
              <div class="cr__t">
                <span class="mono muted">#{{ it.number }}</span>
                <strong :title="it.title">{{ it.title }}</strong>
                <GnBadge v-if="it.draft" tone="neutral">rascunho</GnBadge>
                <GnBadge :tone="it.state === 'merged' ? 'accent' : it.state === 'open' ? 'success' : 'danger'">{{ it.state === 'open' ? 'aberto' : it.state === 'merged' ? 'mergeado' : 'fechado' }}</GnBadge>
              </div>
              <div class="muted cr__m">{{ it.author }} · <span class="mono">{{ it.sourceBranch }} → {{ it.targetBranch }}</span> · atualizado {{ when(it.updatedAt) }}</div>
            </div>
            <span class="cr__ci">
              <span v-if="ciOf(it.sha) === 'loading'" class="muted small">CI…</span>
              <span v-else-if="ciOf(it.sha) === 'error'" class="muted small" title="Não foi possível consultar o CI">CI ?</span>
              <GnBadge
                v-else-if="ciOf(it.sha)"
                :tone="CI_TONE[(ciOf(it.sha) as CiStatus).state]"
                :title="(ciOf(it.sha) as CiStatus).checks.map((c) => `${c.name}: ${c.state}`).join('\n') || 'Sem checks'"
              >
                {{ CI_LABEL[(ciOf(it.sha) as CiStatus).state] }}
              </GnBadge>
              <GnButton v-if="firstFailing(ciOf(it.sha) as CiStatus | undefined)" size="sm" @click="open(firstFailing(ciOf(it.sha) as CiStatus)!)">Ver falha</GnButton>
            </span>
            <GnButton size="sm" @click="open(it.url)">Abrir</GnButton>
          </li>
        </ul>
      </section>

      <!-- criar -->
      <section v-else class="box">
        <template v-if="created">
          <p class="ok">{{ crShort }} #{{ created.number }} criado.</p>
          <GnButton variant="primary" @click="open(created.url)">Abrir no navegador</GnButton>
        </template>
        <form v-else class="hp__form" @submit.prevent="create">
          <div class="hp__row">
            <label>
              Branch de origem
              <input :value="suggestion?.head ?? info.currentBranch" readonly />
            </label>
            <label>
              Destino
              <select v-model="form.base" @change="suggest">
                <option v-for="b in [...new Set([info.defaultBranch, ...info.branches])]" :key="b" :value="b">{{ b }}</option>
              </select>
            </label>
          </div>
          <p v-if="suggestion" class="muted small">
            {{ suggestion.commits.length }} commit(s) sobre {{ form.base }}:
            {{ suggestion.commits.slice(0, 4).map((c) => c.subject).join(' · ') }}{{ suggestion.commits.length > 4 ? ' …' : '' }}
          </p>
          <label>
            Título
            <input v-model="form.title" spellcheck="false" />
          </label>
          <label>
            Descrição (Markdown) <span class="muted small">— montada dos Conventional Commits</span>
            <textarea v-model="form.body" rows="12" spellcheck="false" />
          </label>
          <div class="hp__opts">
            <label class="chk"><input v-model="form.draft" type="checkbox" /> Criar como rascunho</label>
            <label class="chk">
              <input v-model="form.push" type="checkbox" /> Enviar a branch (push) antes
              <span v-if="suggestion?.headPublished" class="muted small">(já existe no remoto)</span>
            </label>
            <GnButton size="sm" type="button" @click="suggest">Regenerar título e descrição</GnButton>
          </div>
          <div class="hp__opts">
            <GnButton type="submit" variant="primary" :disabled="creating || !form.title.trim() || !suggestion">
              {{ creating ? 'Criando…' : `Criar ${crShort}` }}
            </GnButton>
          </div>
        </form>
      </section>
    </template>
  </div>
</template>

<style scoped lang="scss">
.hp {
  padding: 16px 22px;
  max-width: 1000px;
  display: grid;
  gap: 12px;
  &__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; h2 { margin: 0 0 4px; font-size: 16px; } p { margin: 0; } }
  &__bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  &__kind { display: flex; align-items: center; gap: 14px; margin: 8px 0; label { display: inline-flex; gap: 5px; align-items: center; } }
  &__conn { display: flex; gap: 8px; margin: 8px 0; input { flex: 1; } }
  &__form { display: grid; gap: 10px; label { display: grid; gap: 4px; font-size: 12px; color: var(--gn-muted); } textarea { font-family: var(--gn-mono); font-size: 12px; } }
  &__row { display: grid; grid-template-columns: 1fr 220px; gap: 10px; }
  &__opts { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
}
.box { border: 1px solid var(--gn-border); border-radius: var(--gn-radius); padding: 12px 14px; h3 { margin: 0 0 6px; font-size: 14px; } p { margin: 4px 0; } }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.cr {
  display: flex; align-items: center; gap: 12px; padding: 8px 12px; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); background: var(--gn-bg);
  &__main { flex: 1; min-width: 0; }
  &__t { display: flex; align-items: center; gap: 8px; strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
  &__m { font-size: 11px; margin-top: 2px; }
  &__ci { display: flex; align-items: center; gap: 6px; min-width: 130px; justify-content: flex-end; }
}
.seg {
  display: inline-flex; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); overflow: hidden;
  button { padding: 3px 12px; font: inherit; font-size: 12px; color: var(--gn-muted); background: none; border: none; cursor: pointer; &.on { background: var(--gn-accent); color: #fff; } }
}
.chk { display: inline-flex !important; align-items: center; gap: 6px; flex-direction: row; }
.mono { font-family: var(--gn-mono); font-size: 12px; }
.spacer { flex: 1; }
.muted { color: var(--gn-muted); font-size: 12px; }
.small { font-size: 11px; }
.err { color: var(--gn-danger); margin: 0; }
.ok { color: var(--gn-success); margin: 0; }
.warn { color: var(--gn-warn); }
a { color: var(--gn-accent); }
</style>
