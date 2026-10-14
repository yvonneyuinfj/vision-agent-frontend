/** 复核工作台状态（路由 /tasks/review）
 *  一个任务 = 一次复核会话：队列选择、复核门载荷装配、缺陷修订草稿、
 *  决定提交与「受理后落定轮询」全在这里，视图只做呈现。
 *  契约口径对齐后端 app/agents/nodes/human_review.py：
 *  - confirm 直接走报告；revise 携 override_grade 与/或全量 defects（整表替换 standardized）；
 *  - reject 终止任务（落失败终态，不是退回重排队）；requeue 后端未支持，故本层不开放；
 *  - confirm_type==='scene' 的中断是场景歧义确认，必须走 /scene-confirm。 */
import { computed, reactive, ref, watch } from 'vue';
import type { QaArtifactRef, QaClassDef, QaDefectItem, QaGradeInfo, QaReviewInfo } from '@/api/tasks';
import { isLive } from '@/api/source-registry';
import { sceneCodeToLabel } from '@/data/scene-map';
import {
  confirmScene, focusTask, pollTaskUntilSettled, refreshDetail, resultFor, reviewInterruptOf,
  reviewOf, reviewableTasks, submitReviewDecision, taskDetailOf, tasksLive,
  type ReviewDecisionInput,
} from './use-tasks';
import {
  NEW_DEFECT_NAME_CN, NEW_DEFECT_TYPE, clampBox, countUntyped, defectDiff, diffSummaryText,
  hasRevision, hasUntypedManual, nextManualId, withStableIds,
  type BBox4, type DefectDiff,
} from '@/utils/defect';

export type ReviewActionKey = 'confirm' | 'revise' | 'reject';
export type ReviewPhase = 'idle' | 'submitting' | 'polling' | 'settled' | 'timeout';
export type EditTool = 'select' | 'add';

/** 四张动作卡文案（requeue 后端显式报错，故不提供入口，避免「以为重检实际通过」） */
export const DECISION_CARDS: Array<{ key: ReviewActionKey; label: string; desc: string; tone: string }> = [
  { key: 'confirm', label: '同意 AI 判级', desc: '确认自动判级结论无误，放行并流转至报告生成。', tone: 'ok' },
  { key: 'revise', label: '改判 / 修正', desc: '覆盖判级结论，并可修订缺陷清单（补漏检、排除误检、改类改严重度）。', tone: 'warn' },
  { key: 'reject', label: '驳回终止', desc: '数据不符合规范或结论不可接受，任务终止并记为失败（留痕原因）。', tone: 'danger' },
];

/** 人工终裁可选的判级结论（与后端 grade.level 同源枚举） */
export const GRADE_LEVELS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'pass', label: '合格', hint: '判为可用，报告按合格结论出具' },
  { value: 'defect', label: '检出缺陷', hint: '存在缺陷但可控，报告按检出缺陷出具' },
  { value: 'fail', label: '不合格', hint: '高风险结论，报告按不合格出具并建议回修' },
  { value: 'review', label: '仍待复核', hint: '保留疑点继续人工跟踪，报告将标注未终裁' },
];

export const SEVERITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '未分级' },
  { value: 'low', label: 'Low（轻微）' },
  { value: 'medium', label: 'Medium（中等）' },
  { value: 'high', label: 'High（严重）' },
];

const store = reactive({
  selectedId: '',
  /** 修订会话已播种标记（防止空基线被重复播种覆盖未提交草稿） */
  seededId: '',
  /** 当前显示的第几张输入图 */
  imageIndex: 0,
  /** 修订会话（草稿 = baseline 的可编辑副本，提交时整表上送） */
  baseline: [] as QaDefectItem[],
  draft: [] as QaDefectItem[],
  tool: 'select' as EditTool,
  activeDefectId: '',
  /** 决定表单 */
  action: '' as ReviewActionKey | '',
  overrideLevel: 'pass',
  opinion: '',
  /** 提交与落定反馈 */
  phase: 'idle' as ReviewPhase,
  phaseText: '',
  error: '',
  finalStatus: '',
});

/** 会话清场：换任务或提交完成后重置草稿与表单（基线在新详情到达时重新播种）。 */
function resetSession(): void {
  store.seededId = '';
  store.baseline = [];
  store.draft = [];
  store.tool = 'select';
  store.activeDefectId = '';
  store.action = '';
  store.overrideLevel = 'pass';
  store.opinion = '';
  store.phase = 'idle';
  store.phaseText = '';
  store.error = '';
  store.finalStatus = '';
}

export function selectTask(id: string): void {
  if (!id || id === store.selectedId) return;
  store.selectedId = id;
  store.imageIndex = 0;
  resetSession();
  void refreshDetail(id);
}

/** 深链预选：?task= 命中待复核队列则直接定位（同检测页卡片跳转任务中心的口径）。 */
export function primeFromFocus(): void {
  const ft = focusTask.value;
  if (ft && reviewableTasks.value.some((t) => t.id === ft)) { selectTask(ft); return; }
  if (!reviewableTasks.value.some((t) => t.id === store.selectedId)) {
    const next = reviewableTasks.value[0]?.id ?? '';
    store.selectedId = next;
    store.imageIndex = 0;
    resetSession();
    if (next) void refreshDetail(next);
  }
}

/* ================= 队列与当前任务 ================= */
export const queue = computed(() => reviewableTasks.value);
export const selectedId = computed(() => store.selectedId);
export const selectedTask = computed(() => queue.value.find((t) => t.id === store.selectedId) ?? null);
export const detail = computed(() => (store.selectedId ? taskDetailOf(store.selectedId) : undefined));
export const detailReady = computed(() => detail.value !== undefined && detail.value !== null);
export const live = tasksLive;

/** 复核门中断载荷（无 action 的 review 通道内容）。 */
export const interrupt = computed<QaReviewInfo | null>(() =>
  (store.selectedId ? reviewInterruptOf(store.selectedId) : null));
/** 已提交的人工决定留痕（有 action 才是真决定）。 */
export const decided = computed(() => (store.selectedId ? reviewOf(store.selectedId) : undefined));
/** 场景歧义确认分支：此类任务不走判级复核，只显示候选场景。 */
export const isSceneConfirm = computed(() => interrupt.value?.confirm_type === 'scene');
export const sceneCandidates = computed(() =>
  (interrupt.value?.candidates ?? []).map((c) => ({
    scene: c.scene, label: sceneCodeToLabel(c.scene), confidence: c.confidence ?? null,
  })));
export const gateQuestion = computed<string>(() =>
  interrupt.value?.question || '检测结果存在高风险或低置信度项，请人工复核');

export const grade = computed<QaGradeInfo | null>(() => detail.value?.grade ?? interrupt.value?.grade ?? null);
export const classDefs = computed<QaClassDef[]>(() => (detail.value?.class_definitions ?? []) as QaClassDef[]);
export const inputImages = computed<string[]>(() => detail.value?.input_uris ?? []);
export const currentImage = computed<string>(() => inputImages.value[store.imageIndex] ?? '');

/** 复核期标注图产物：优先中断载荷 artifacts，终局后回落 report.artifacts。 */
export const artifacts = computed<QaArtifactRef[]>(() => {
  const fromGate = interrupt.value?.artifacts;
  if (Array.isArray(fromGate) && fromGate.length) return fromGate;
  return detail.value?.report?.artifacts ?? [];
});

/** 可复核（未提交决定）= 队列内 + 详情已就绪 + 复核门未被人工决定关闭。 */
export const awaiting = computed(() => !!store.selectedId && !decided.value);

/* ================= 本地演示兜底（无后端时仍可演练流程） ================= */
function demoBaseline(taskId: string): QaDefectItem[] {
  const r = resultFor(taskId);
  return (r.findings || []).map((f, i) => ({
    defect_id: `D${String(i + 1).padStart(3, '0')}`,
    defect_type: f.label,
    defect_name_cn: f.label,
    confidence: f.confidence,
    severity: (f.verdict === 'confirmed' ? 'medium' : f.verdict === 'suspect' ? 'low' : null) as QaDefectItem['severity'],
    location: null,
    description: f.location,
    source: 'model' as const,
    human_rejected: f.verdict === 'dismissed',
  }));
}

/** 播种修订会话：真实取详情 standardized（详情未达先等），开发期取演示结论。 */
watch([() => store.selectedId, detail], ([id, d]) => {
  if (!id || store.seededId === id) return;
  let source: QaDefectItem[];
  if (isLive('tasks.detail')) {
    if (d === undefined) return;// 详情尚在加载；null = 读取失败，按空基线降级
    source = (d?.standardized ?? []).map((x) => ({ ...x }));
  } else {
    source = demoBaseline(id);
  }
  const seeded = withStableIds(source);
  store.seededId = id;
  store.baseline = seeded;
  store.draft = seeded.map((x) => ({ ...x }));
  store.overrideLevel = d?.grade?.level || 'pass';
}, { immediate: true });

/* ================= 缺陷修订 ================= */
export const diff = computed<DefectDiff>(() => defectDiff(store.baseline, store.draft));
export const hasEdits = computed(() => hasRevision(diff.value));
export const editSummary = computed(() => (hasEdits.value ? diffSummaryText(diff.value) : '暂无修订'));
export const untypedManual = computed(() => hasUntypedManual(store.draft));
/** 整表里「还没有真实类型」的条数（人工补框 + 存量无类型条目）：后端对全量列表硬性要求 */
export const untypedCount = computed(() => countUntyped(store.draft));
export const draftDefects = computed(() => store.draft);

/** 改类候选：类别定义表 ∪ 基线/草稿存量类型（保持出现序）。 */
export const typeOptions = computed<string[]>(() => {
  const names: string[] = [];
  for (const c of classDefs.value) {
    const n = String(c.class_name ?? '');
    if (n && !names.includes(n)) names.push(n);
  }
  for (const d of [...store.baseline, ...store.draft]) {
    if (d.defect_type && d.defect_type !== NEW_DEFECT_TYPE && !names.includes(d.defect_type)) names.push(d.defect_type);
  }
  return names;
});

export function typeLabel(t: string): string {
  const def = classDefs.value.find((c) => String(c.class_name ?? '') === t);
  const desc = def?.description ? String(def.description) : '';
  return desc ? `${t}（${desc}）` : t;
}

export function setTool(tool: EditTool): void {
  store.tool = tool;
  if (tool === 'add') store.activeDefectId = '';
}

export function selectDefect(id: string): void {
  store.activeDefectId = id;
  if (id) store.tool = 'select';
}

/** 画框落定：追加一条人工新增缺陷（source=manual、置信度 null，待选类型）。 */
export function addBox(bbox: BBox4): void {
  const entry: QaDefectItem = {
    defect_id: nextManualId(),
    defect_type: NEW_DEFECT_TYPE,
    defect_name_cn: NEW_DEFECT_NAME_CN,
    confidence: null,
    severity: null,
    location: { type: 'bbox', bbox: clampBox(bbox[0], bbox[1], bbox[2], bbox[3]) },
    source: 'manual',
  };
  const imageName = currentImage.value
    ? (currentImage.value.split('/files/')[1]?.split('?')[0] ?? currentImage.value.split('/').pop() ?? '')
    : '';
  if (imageName) entry.image_name = decodeURIComponent(imageName);
  store.draft = [...store.draft, entry];
  store.activeDefectId = entry.defect_id ?? '';
  store.tool = 'select';
}

/** 改类 / 改严重度：模型条目落 revised 原值快照（人工新增无「原值」，不打快照）。 */
export function patchDefect(id: string, patch: Partial<Pick<QaDefectItem, 'defect_type' | 'defect_name_cn' | 'severity'>>): void {
  store.draft = store.draft.map((d) => {
    if ((d.defect_id ?? '') !== id) return d;
    const base = store.baseline.find((b) => (b.defect_id ?? '') === id);
    const revised = d.source === 'manual'
      ? d.revised
      : { ...(base ? { defect_type: base.defect_type, severity: base.severity } : {}), ...(d.revised ?? {}) };
    return { ...d, ...patch, revised };
  });
}

/** 移框：仅草稿内生效，diff 计入 moved。 */
export function moveDefect(id: string, bbox: BBox4): void {
  store.draft = store.draft.map((d) => {
    if ((d.defect_id ?? '') !== id) return d;
    const base = store.baseline.find((b) => (b.defect_id ?? '') === id);
    const revised = d.source === 'manual'
      ? d.revised
      : { ...(base ? { location: base.location } : {}), ...(d.revised ?? {}) };
    return { ...d, location: { type: 'bbox', bbox: clampBox(bbox[0], bbox[1], bbox[2], bbox[3]) }, revised };
  });
}

/** 排除 = 判定误检，条目保留供审计（human_rejected 语义）；模型条目不可硬删。 */
export function toggleReject(id: string): void {
  store.draft = store.draft.map((d) => ((d.defect_id ?? '') === id ? { ...d, human_rejected: !d.human_rejected } : d));
}

export function removeDefect(id: string): void {
  const target = store.draft.find((d) => (d.defect_id ?? '') === id);
  if (!target || target.source !== 'manual') return;
  store.draft = store.draft.filter((d) => (d.defect_id ?? '') !== id);
  if (store.activeDefectId === id) store.activeDefectId = '';
}

export function resetDraft(): void {
  store.draft = store.baseline.map((d) => ({ ...d }));
  store.activeDefectId = '';
}

export function setImageIndex(i: number): void {
  store.imageIndex = Math.max(0, Math.min(i, Math.max(0, inputImages.value.length - 1)));
}

/* ================= 决定提交 ================= */
const busy = computed(() => store.phase === 'submitting' || store.phase === 'polling');
export const submitting = busy;

function buildOverride(): Partial<QaGradeInfo> | null {
  if (store.action !== 'revise') return null;
  return { level: store.overrideLevel, summary: store.opinion.trim() };
}

function buildDecision(): ReviewDecisionInput | null {
  const a = store.action;
  if (!a) return null;
  const opinion = store.opinion.trim();
  // 缺陷修订仅在「改判 / 修正」下生效（与后端契约一致：其他动作携带 defects 被忽略）
  const defects = a === 'revise' && hasEdits.value ? store.draft : null;
  const merged = defects && hasEdits.value
    ? `${opinion}；[缺陷修订] ${diffSummaryText(diff.value)}`
    : opinion;
  return { action: a, opinion: merged, override_grade: buildOverride(), defects };
}

/** 提交前校验，返回可展示的错误文案（空串 = 通过）。 */
function validate(): string {
  if (!store.selectedId) return '请先在左侧队列选择待复核任务。';
  if (!store.action) return '请选择复核动作（同意 / 改判 / 驳回）。';
  if (!store.opinion.trim()) return '请填写复核意见（必填，全程留痕）。';
  if (store.action === 'revise' && !hasEdits.value && !store.overrideLevel) return '改判需给出判级结论或缺陷修订。';
  // 后端 _validate_revised_defects：全量列表任何一项缺 defect_type 都会整单拒收（不只是人工项）
  if (store.action === 'revise' && hasEdits.value && untypedCount.value > 0) {
    return `有 ${untypedCount.value} 条缺陷未指定缺陷类型（后端要求每条都有类型），请先在缺陷修订列表里补齐。`;
  }
  return '';
}

/** 受理后的落定轮询：状态文案实时回填 phaseText，终态决定提示语与后续动作。 */
async function settle(taskId: string): Promise<void> {
  store.phase = 'polling';
  store.phaseText = '复核已受理，正在恢复流水线并生成报告…';
  const out = await pollTaskUntilSettled(taskId, {
    timeoutMs: 120_000,
    intervalMs: 1_500,
    onTick: (s) => {
      store.phaseText = s === 'completed' ? '报告已生成，任务落定'
        : s === 'failed' ? '任务已终止（失败态）'
        : s === 'canceled' ? '任务已取消'
        : s === 'awaiting_review' ? '等待人工复核（复核未生效？）'
        : '执行中…';
    },
  });
  store.finalStatus = out.status;
  store.phase = out.settled ? 'settled' : 'timeout';
  store.phaseText = out.settled
    ? (out.status === 'completed' ? '复核结论已生效，报告已归档' : '复核结论已生效，任务已终止')
    : '后端仍在执行，可稍后在任务列表查看结果';
}

export async function submitDecision(): Promise<boolean> {
  const err = validate();
  if (err) { store.error = err; return false; }
  const input = buildDecision();
  if (!input) return false;
  store.error = '';
  store.phase = 'submitting';
  store.phaseText = '提交复核决定…';
  try {
    await submitReviewDecision(store.selectedId, input);
    await settle(store.selectedId);
    return true;
  } catch (e: any) {
    store.phase = 'idle';
    store.phaseText = '';
    store.error = e?.message || '复核提交失败';
    return false;
  }
}

export async function pickScene(scene: string): Promise<boolean> {
  if (!store.selectedId) return false;
  store.error = '';
  store.phase = 'submitting';
  store.phaseText = '提交场景确认…';
  try {
    await confirmScene(store.selectedId, scene, store.opinion.trim());
    await settle(store.selectedId);
    return true;
  } catch (e: any) {
    store.phase = 'idle';
    store.phaseText = '';
    store.error = e?.message || '场景确认提交失败';
    return false;
  }
}

/** 提交落定后前进到队列里的下一个待复核任务（当前任务已离开队列）。 */
export function advanceQueue(): void {
  const id = store.selectedId;
  resetSession();
  const next = queue.value.find((t) => t.id !== id) ?? null;
  store.selectedId = next?.id ?? '';
  store.imageIndex = 0;
  if (next) void refreshDetail(next.id);
}

export const phase = computed(() => store.phase);
export const phaseText = computed(() => store.phaseText);
export const error = computed(() => store.error);
export const finalStatus = computed(() => store.finalStatus);
export const action = computed({
  get: () => store.action,
  set: (v: ReviewActionKey | '') => { store.action = v; store.error = ''; },
});
export const opinion = computed({
  get: () => store.opinion,
  set: (v: string) => { store.opinion = v; },
});
export const overrideLevel = computed({
  get: () => store.overrideLevel,
  set: (v: string) => { store.overrideLevel = v; },
});
export const tool = computed(() => store.tool);
export const activeDefectId = computed(() => store.activeDefectId);
export const imageIndex = computed(() => store.imageIndex);

/** 本地演示模式提示（无后端时工作台只演练流程，不产出真实结论）。 */
export const demoMode = computed(() => !live.value);
export const detailError = ref('');
watch(detail, (d, old) => {
  if (d === null && old !== null) detailError.value = '任务详情读取失败，可在右上角重试。';
  else if (d) detailError.value = '';
});
export async function retryDetail(): Promise<void> {
  detailError.value = '';
  await refreshDetail(store.selectedId);
}
