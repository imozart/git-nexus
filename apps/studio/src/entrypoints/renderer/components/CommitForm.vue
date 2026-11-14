<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import type {
  CommitPolicy,
  ConventionalCommitInput,
  ConventionalCommitType,
  RepoPolicyInfo,
  SecretFinding,
  SecretsMode,
} from '@git-nexus/git-core/pure';
import {
  COMMIT_TYPES,
  DEFAULT_POLICY,
  compileTicketPattern,
  formatCommitMessage,
  mergePolicy,
  ticketFromBranch,
  typeFromBranch,
} from '@git-nexus/governance-policy';
import { api, errMsg, isHookRejection, stripHookPrefix } from '../api';

const props = defineProps<{ repoPath: string; branch: string; stagedCount: number }>();
const emit = defineEmits<{ (e: 'committed', hash: string): void }>();

// --- Política -------------------------------------------------------------------------------
// Local (localStorage => fica no diretório portátil) + política do time (.gitnexus.json no repositório),
// que sempre prevalece sobre a local.
const POLICY_KEY = 'gitnexus.commitPolicy';
function loadPolicy(): CommitPolicy {
  try {
    return { ...DEFAULT_POLICY, ...JSON.parse(localStorage.getItem(POLICY_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}
const localPolicy = reactive<CommitPolicy>(loadPolicy());
watch(localPolicy, (p) => localStorage.setItem(POLICY_KEY, JSON.stringify(p)), { deep: true });

const team = ref<RepoPolicyInfo | null>(null);
const policy = computed<CommitPolicy>(() => mergePolicy({ ...localPolicy }, team.value?.commit ?? {}));
const teamLocked = computed(() => !!team.value?.found);
const showPolicy = ref(false);
const patternValid = computed(() => compileTicketPattern(localPolicy.ticketPattern) !== null);
const allowedTypes = computed(() => COMMIT_TYPES.filter((t) => !policy.value.types?.length || policy.value.types.includes(t)));
const policyNote = ref('');

async function loadTeamPolicy(): Promise<void> {
  const path = props.repoPath;
  const info = await api.getRepoPolicy(path).catch(() => null);
  if (path === props.repoPath) team.value = info;
}

// --- Formulário -------------------------------------------------------------------------
const TYPE_HINT: Record<ConventionalCommitType, string> = {
  feat: 'Nova funcionalidade',
  fix: 'Correção de bug',
  docs: 'Documentação',
  style: 'Formatação (sem mudar lógica)',
  refactor: 'Refatoração',
  perf: 'Melhoria de performance',
  test: 'Testes',
  build: 'Build / dependências',
  ci: 'Integração contínua',
  chore: 'Tarefas diversas',
};

const form = reactive({
  type: 'feat' as ConventionalCommitType,
  scope: '',
  ticketNumber: '',
  subject: '',
  body: '',
  breakingChanges: '',
});
const touched = ref(false);
watch(form, () => (touched.value = true), { deep: true });

// Ticket e tipo sugeridos pelo nome da branch (feat/PROJ-123-login => feat + PROJ-123).
const autoTicket = ref(false);
const ticketHint = ref('');
function applyBranchHints(): void {
  if (!policy.value.ticketFromBranch) {
    ticketHint.value = '';
    return;
  }
  const t = ticketFromBranch(props.branch, policy.value.ticketPattern);
  if (t && (!form.ticketNumber || autoTicket.value)) {
    form.ticketNumber = t;
    autoTicket.value = true;
    ticketHint.value = `Ticket ${t} tirado da branch "${props.branch}".`;
  } else if (!t && autoTicket.value) {
    form.ticketNumber = '';
    autoTicket.value = false;
    ticketHint.value = '';
  }
  const bt = typeFromBranch(props.branch);
  if (bt && allowedTypes.value.includes(bt)) form.type = bt;
  touched.value = false;
}
// Se o usuário editar o ticket à mão, deixa de ser "automático" (não será sobrescrito nem apagado).
watch(
  () => form.ticketNumber,
  (v) => {
    if (autoTicket.value && v !== ticketFromBranch(props.branch, policy.value.ticketPattern)) autoTicket.value = false;
  },
);
watch(
  () => props.repoPath,
  async () => {
    team.value = null;
    await loadTeamPolicy();
    applyBranchHints();
  },
  { immediate: true },
);
watch(() => props.branch, applyBranchHints);

// Se a política do time restringe tipos, garante que o tipo selecionado seja permitido.
watch(allowedTypes, (types) => {
  if (!types.includes(form.type) && types[0]) form.type = types[0];
});

const input = computed<ConventionalCommitInput>(() => ({
  type: form.type,
  scope: form.scope || undefined,
  ticketNumber: form.ticketNumber || undefined,
  subject: form.subject,
  body: form.body || undefined,
  breakingChanges: form.breakingChanges || undefined,
}));

// Linter em tempo real: roda a cada tecla, sem I/O.
const validation = computed(() => api.validateCommitMessage(input.value, { ...policy.value }));
const subjectLen = computed(() => form.subject.trim().length);
const preview = computed(() => formatCommitMessage(input.value));

const committing = ref(false);
const canCommit = computed(() => validation.value.isValid && props.stagedCount > 0 && !committing.value && !secretReport.value);

// --- Segredos: o scanner roda antes do commit ------------------------------------------------
const secretReport = ref<{ mode: SecretsMode; findings: SecretFinding[] } | null>(null);
const KIND_ICON: Record<SecretFinding['kind'], string> = { secret: '🔑', 'sensitive-file': '📄', 'large-file': '📦' };

// --- Resultado / saída dos hooks ----------------------------------------------------------
const output = ref<{ ok: boolean; text: string } | null>(null);

async function submit(): Promise<void> {
  if (!canCommit.value) return;
  committing.value = true;
  output.value = null;
  try {
    const scan = await api.scanStagedSecrets(props.repoPath).catch(() => null);
    if (scan && scan.findings.length) {
      secretReport.value = scan; // o usuário decide (ou é bloqueado, no modo "block")
      return;
    }
    await doCommit();
  } finally {
    committing.value = false;
  }
}

/** Confirma o commit mesmo com avisos do scanner (somente no modo "warn"). */
async function commitAnyway(): Promise<void> {
  secretReport.value = null;
  committing.value = true;
  try {
    await doCommit();
  } finally {
    committing.value = false;
  }
}

async function doCommit(): Promise<void> {
  try {
    const r = await api.executeCommit(props.repoPath, input.value, { ...policy.value });
    output.value = { ok: true, text: `Commit ${r.commitHash.slice(0, 7)} criado.\n\n${r.output}`.trim() };
    form.subject = '';
    form.body = '';
    form.breakingChanges = '';
    form.ticketNumber = '';
    autoTicket.value = false;
    touched.value = false;
    emit('committed', r.commitHash);
    applyBranchHints();
  } catch (e) {
    const msg = errMsg(e);
    output.value = { ok: false, text: isHookRejection(msg) ? stripHookPrefix(msg) : msg };
  }
}

// --- Compartilhar a política com o time -------------------------------------------------------
async function saveTeamPolicy(): Promise<void> {
  const p = localPolicy;
  try {
    await api.saveRepoConfig(props.repoPath, {
      commit: {
        maxSubjectLength: p.maxSubjectLength,
        scopeRequired: p.scopeRequired,
        ticketRequired: p.ticketRequired,
        ticketPattern: p.ticketPattern,
        ticketFromBranch: p.ticketFromBranch,
      },
      secrets: { mode: 'warn' },
    });
    await loadTeamPolicy();
    policyNote.value = 'Arquivo .gitnexus.json criado. Faça o commit dele para que todo o time use a mesma política.';
  } catch (e) {
    policyNote.value = errMsg(e);
  }
}
</script>

<template>
  <form class="cf" @submit.prevent="submit" @keydown.ctrl.enter.prevent="submit" @keydown.meta.enter.prevent="submit">
    <div class="cf__title">
      <h3>Novo commit</h3>
      <GnButton size="sm" type="button" @click="showPolicy = !showPolicy">Política</GnButton>
    </div>

    <div v-if="teamLocked" class="cf__team" title="Definida em .gitnexus.json na raiz do repositório">
      🛡 Política do time ativa
      <small v-if="policy.types?.length">· tipos: {{ policy.types.join(', ') }}</small>
      <small v-if="policy.scopes?.length">· escopos: {{ policy.scopes.join(', ') }}</small>
    </div>
    <ul v-if="team?.errors.length" class="cf__teamerr">
      <li v-for="er in team.errors" :key="er">⚠ {{ er }}</li>
    </ul>

    <fieldset v-if="showPolicy" class="cf__policy">
      <template v-if="teamLocked">
        <small class="muted">
          Este repositório tem política própria (.gitnexus.json); ela prevalece sobre a configuração local. Para mudar,
          edite o arquivo e faça o commit.
        </small>
        <small>Título até {{ policy.maxSubjectLength }} caracteres · escopo {{ policy.scopeRequired ? 'obrigatório' : 'opcional' }} · ticket {{ policy.ticketRequired ? 'obrigatório' : 'opcional' }} ({{ policy.ticketPattern }}) · scanner de segredos: {{ team?.secrets.mode }}</small>
      </template>
      <template v-else>
        <label><input v-model="localPolicy.scopeRequired" type="checkbox" /> Escopo obrigatório</label>
        <label><input v-model="localPolicy.ticketRequired" type="checkbox" /> Ticket obrigatório</label>
        <label><input v-model="localPolicy.ticketFromBranch" type="checkbox" /> Ticket pelo nome da branch</label>
        <label>
          Regex do ticket
          <input v-model="localPolicy.ticketPattern" :class="{ bad: !patternValid }" spellcheck="false" />
        </label>
        <small v-if="!patternValid" class="err">Regex inválida.</small>
        <GnButton size="sm" type="button" @click="saveTeamPolicy">Salvar como política do time</GnButton>
        <small class="muted">Cria o .gitnexus.json no repositório; ao commitá-lo, todo o time passa a seguir a mesma regra.</small>
      </template>
      <small v-if="policyNote" class="muted">{{ policyNote }}</small>
    </fieldset>

    <div class="cf__field">
      <span class="cf__label">Tipo</span>
      <div class="cf__types">
        <button
          v-for="t in allowedTypes"
          :key="t"
          type="button"
          class="chip"
          :class="{ 'chip--on': form.type === t }"
          :title="TYPE_HINT[t]"
          @click="form.type = t"
        >
          {{ t }}
        </button>
      </div>
      <small class="muted">{{ TYPE_HINT[form.type] }}</small>
    </div>

    <div class="cf__row">
      <label class="cf__field">
        <span class="cf__label">Escopo {{ policy.scopeRequired ? '*' : '(opcional)' }}</span>
        <input v-model="form.scope" list="cf-scopes" placeholder="ex.: auth" spellcheck="false" />
        <datalist v-if="policy.scopes?.length" id="cf-scopes">
          <option v-for="s in policy.scopes" :key="s" :value="s" />
        </datalist>
      </label>
      <label class="cf__field">
        <span class="cf__label">Ticket {{ policy.ticketRequired ? '*' : '(opcional)' }}</span>
        <input v-model="form.ticketNumber" placeholder="ex.: ABC-123" spellcheck="false" />
      </label>
    </div>
    <small v-if="ticketHint && autoTicket" class="muted">{{ ticketHint }}</small>

    <label class="cf__field">
      <span class="cf__label">
        Título *
        <span class="counter" :class="{ 'counter--over': subjectLen > policy.maxSubjectLength }">
          {{ subjectLen }}/{{ policy.maxSubjectLength }}
        </span>
      </span>
      <input v-model="form.subject" placeholder="resumo imperativo e curto" />
    </label>

    <label class="cf__field">
      <span class="cf__label">Corpo (opcional)</span>
      <textarea v-model="form.body" rows="3" placeholder="Contexto: o quê e por quê."></textarea>
    </label>

    <label class="cf__field">
      <span class="cf__label">Breaking changes (opcional)</span>
      <textarea v-model="form.breakingChanges" rows="2" placeholder="Descreva a quebra de compatibilidade."></textarea>
    </label>

    <div class="cf__lint" :class="{ ok: validation.isValid }">
      <template v-if="validation.isValid">✔ Mensagem 100% em conformidade.</template>
      <ul v-else-if="touched">
        <li v-for="er in validation.errors" :key="er">✖ {{ er }}</li>
      </ul>
      <template v-else>Preencha o formulário para habilitar o commit.</template>
    </div>

    <details class="cf__preview">
      <summary>Pré-visualizar mensagem</summary>
      <pre>{{ preview }}</pre>
    </details>

    <div v-if="secretReport" class="cf__secrets" role="alert">
      <strong>
        {{ secretReport.mode === 'block' ? '⛔ Commit bloqueado pela política do time' : '⚠ Possível vazamento de dados sensíveis' }}
      </strong>
      <ul>
        <li v-for="(f, i) in secretReport.findings" :key="i">
          {{ KIND_ICON[f.kind] }} <b>{{ f.file }}</b><template v-if="f.line">:{{ f.line }}</template> — {{ f.rule }}
          <code v-if="f.kind === 'secret'">{{ f.preview }}</code>
        </li>
      </ul>
      <small class="muted">
        Remova o dado do stage, ou, se for falso positivo, adicione <code>gitnexus:allow-secret</code> na linha ou o caminho
        em <code>secrets.ignorePaths</code> do .gitnexus.json.
      </small>
      <div class="cf__secrets-actions">
        <GnButton size="sm" type="button" @click="secretReport = null">Voltar e revisar</GnButton>
        <GnButton v-if="secretReport.mode !== 'block'" size="sm" variant="danger" type="button" @click="commitAnyway">
          Commitar mesmo assim
        </GnButton>
      </div>
    </div>

    <GnButton variant="primary" type="submit" :disabled="!canCommit" title="Ctrl+Enter">
      {{ committing ? 'Verificando e executando commit…' : `Commit (${stagedCount} arquivo(s))` }}
    </GnButton>
    <small v-if="stagedCount === 0" class="muted">Faça stage de ao menos um arquivo.</small>

    <div v-if="output" class="cf__out" :class="output.ok ? 'cf__out--ok' : 'cf__out--err'">
      <strong>{{ output.ok ? 'Commit concluído' : 'Commit rejeitado — saída do git / hooks' }}</strong>
      <pre>{{ output.text }}</pre>
    </div>
  </form>
</template>

<style scoped lang="scss">
.cf {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  h3 { margin: 0; font-size: 14px; }
  &__title { display: flex; justify-content: space-between; align-items: center; }
  &__field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  &__label { color: var(--gn-muted); font-size: 12px; display: flex; justify-content: space-between; }
  &__row { display: flex; gap: 8px; }
  &__types { display: flex; flex-wrap: wrap; gap: 5px; }
  &__team {
    font-size: 12px;
    border: 1px solid var(--gn-accent);
    border-radius: var(--gn-radius);
    padding: 5px 9px;
    small { color: var(--gn-muted); }
  }
  &__teamerr { margin: 0; padding: 0; list-style: none; font-size: 12px; color: var(--gn-warn); }
  &__policy {
    display: grid;
    gap: 6px;
    border: 1px dashed var(--gn-border);
    border-radius: var(--gn-radius);
    padding: 8px 10px;
    margin: 0;
    label { display: flex; align-items: center; gap: 6px; }
    input[type='text'], input:not([type]) { flex: 1; }
  }
  &__secrets {
    border: 1px solid var(--gn-warn);
    border-radius: var(--gn-radius);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; max-height: 180px; overflow: auto; }
    code { font-family: var(--gn-mono); background: var(--gn-bg); padding: 0 4px; border-radius: 3px; }
  }
  &__secrets-actions { display: flex; gap: 8px; }
  &__lint {
    font-size: 12px;
    color: var(--gn-muted);
    ul { margin: 0; padding: 0; list-style: none; color: var(--gn-danger); }
    &.ok { color: var(--gn-success); }
  }
  &__preview { font-size: 12px; summary { cursor: pointer; color: var(--gn-muted); } pre { margin: 6px 0 0; } }
  &__out {
    border-radius: var(--gn-radius);
    padding: 8px 10px;
    border: 1px solid var(--gn-border);
    pre { margin: 6px 0 0; max-height: 220px; overflow: auto; }
    &--ok { border-color: var(--gn-success); }
    &--err { border-color: var(--gn-danger); }
  }
}
pre { font-family: var(--gn-mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.chip {
  background: var(--gn-bg);
  color: var(--gn-text);
  border: 1px solid var(--gn-border);
  border-radius: 999px;
  padding: 2px 10px;
  font: inherit;
  cursor: pointer;
  &:hover { border-color: var(--gn-accent); }
  &--on { background: var(--gn-accent); border-color: var(--gn-accent); color: #fff; }
}
.counter { font-variant-numeric: tabular-nums; &--over { color: var(--gn-danger); font-weight: 600; } }
.bad { border-color: var(--gn-danger); }
.err { color: var(--gn-danger); }
.muted { color: var(--gn-muted); }
</style>
