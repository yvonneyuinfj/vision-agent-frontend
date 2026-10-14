import { computed, reactive, watch } from 'vue';
import * as api from '@/api/tasks';
import type { QaTaskStats, QaTaskDetail, ReviewAction } from '@/api/tasks';
import { isLive } from '@/api/source-registry';
import {
  capabilityToSceneCode, sceneCodeToCapabilityId, sceneCodeToLabel,
  backendStatusToDisplay, formatShortTime, isDocumentMode,
} from '@/data/scene-map';
import {
  seedTasks, seedResults, seedSamples,
  type DetectionTask, type FeedbackSample, type ReportType, type TaskResult, type TaskStatus,
} from '@/data/tasks';

const CREATED_KEY = 'va-task-created-v1';
const REVIEWS_KEY = 'va-task-reviews-v1';
const SAMPLES_KEY = 'va-task-samples-v1';

export type TaskTab = 'list' | 'create' | 'review' | 'samples' | 'reports';

/** 复核结论展示口径：approve=同意判级 / revised=改判修正 / return=驳回终止。 */
export type ReviewVerdict = 'approve' | 'revised' | 'return';

export interface ReviewRecord {
  verdict: ReviewVerdict;
  note: string;
  time: number;
  /** 后端原始 action（confirm/revise/reject/auto_confirm） */
  action?: string;
  /** 后端留痕的判级结果（confirmed/revised/rejected/auto_confirm） */
  gradingResult?: string;
}

/** 复核提交决定（与后端 ReviewRequest 对齐；requeue 后端未支持，故不开放）。 */
export interface ReviewDecisionInput {
  action: Exclude<ReviewAction, 'requeue'>;
  opinion: string;
  override_grade?: Partial<api.QaGradeInfo> | null;
  defects?: api.QaDefectItem[] | null;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const store = reactive({
  activeTab: 'list' as TaskTab,
  loading: false,
  error: '' as string,
  /** 当前任务列表（真实接口映射或本地演示），统一为展示层 DetectionTask */
  tasks: [] as DetectionTask[],
  /** 真实任务统计（GET /tasks/stats）；mock 下为 null */
  stats: null as QaTaskStats | null,
  /** 任务详情缓存（真实模式按需拉取）；null = 已请求但失败 */
  details: {} as Record<string, api.QaTaskDetail | null>,
  /** 深链预选任务 id（智能检测卡片跳转任务中心时携带，供复核/报告页预选） */
  focusTask: '' as string,
  // ---- 本地演示兜底数据（仅开发期 / 该单元为 mock 时使用）----
  created: load<DetectionTask[]>(CREATED_KEY, []),
  reviews: load<Record<string, ReviewRecord>>(REVIEWS_KEY, {}),
  samples: load<FeedbackSample[]>(SAMPLES_KEY, seedSamples),
});

watch(() => store.created, (v) => { try { localStorage.setItem(CREATED_KEY, JSON.stringify(v)); } catch { /* ignore */ } });
watch(() => store.reviews, (v) => { try { localStorage.setItem(REVIEWS_KEY, JSON.stringify(v)); } catch { /* ignore */ } });
watch(() => store.samples, (v) => { try { localStorage.setItem(SAMPLES_KEY, JSON.stringify(v)); } catch { /* ignore */ } });

/* ================= 后端契约 → 展示层 ================= */
function fromSummary(s: api.QaTaskSummary): DetectionTask {
  const isDoc = isDocumentMode(s.mode);
  const sceneLabel = sceneCodeToLabel(s.scene);
  return {
    id: s.task_id,
    kind: isDoc ? 'document' : 'inspection',
    // 文档任务无场景语义，置空避免污染“检测方向”下拉；列表改用类型徽标展示
    scene: isDoc ? '' : sceneLabel,
    capabilityId: isDoc ? 'document' : sceneCodeToCapabilityId(s.scene),
    // 列表接口不返回文档主题，用“PPT 制作 · 任务号后6位”占位
    object: isDoc ? `PPT 制作 · ${s.task_id.slice(-6)}` : (s.capability_used || sceneLabel),
    status: backendStatusToDisplay(s.status),
    submitter: '—',
    createdAt: formatShortTime(s.created_at),
    reportType: !isDoc && s.status === 'completed' ? (s.mode as ReportType) : undefined,
    // 文档任务无输入图像，图像数置空（列表显示 —，而非 0 张）
    imageCount: isDoc ? undefined : (typeof s.image_count === 'number' ? s.image_count : undefined),
  };
}

function locText(d: api.QaDefectItem): string {
  const box = d.location?.bbox ?? d.location?.bbox_xyxy;
  if (box && box.length >= 4) return `(${Math.round(box[0])}, ${Math.round(box[1])})`;
  return d.image_name || d.description || '—';
}

function mapDetailToResult(d: api.QaTaskDetail): TaskResult {
  const findings = (d.standardized || [])
    .filter((x) => !x.human_rejected)
    .map((x) => ({
      label: x.defect_name_cn || x.defect_type || '未命名缺陷',
      confidence: x.confidence ?? 0,
      location: locText(x),
      verdict: (x.source === 'manual' ? 'confirmed' : 'suspect') as TaskResult['findings'][number]['verdict'],
    }));
  return {
    taskId: d.task_id,
    model: d.capability_used || '检测模型',
    summary: d.grade?.summary || d.error?.message || '暂无判级摘要',
    findings,
  };
}

/* ================= 本地演示任务（开发期兜底） ================= */
function mockTaskList(): DetectionTask[] {
  const merged = [...store.created, ...seedTasks];
  return merged.map((t) => {
    const r = store.reviews[t.id];
    if (!r) return t;
    // 与后端终态语义对齐：通过/改判走报告落定，驳回终止为失败（不是“留在待复核”）
    return r.verdict === 'return'
      ? { ...t, status: 'failed' as TaskStatus }
      : { ...t, status: 'done' as TaskStatus, reportType: t.reportType ?? ('single' as ReportType) };
  });
}

/* ================= 取数（真实优先，失败/开发期兜底） ================= */
export async function refreshTasks(): Promise<void> {
  store.loading = true;
  store.error = '';
  try {
    if (isLive('tasks.list')) {
      store.tasks = (await api.fetchTaskList()).map(fromSummary);
    } else {
      store.tasks = mockTaskList();
    }
  } catch (e: any) {
    store.error = e?.message || '任务加载失败';
    // 生产强制真实（空列表 + 错误条），开发期回退本地演示避免白屏
    store.tasks = isLive('tasks.list') ? [] : mockTaskList();
  }

  if (isLive('tasks.stats')) {
    try { store.stats = await api.fetchTaskStats(); } catch { store.stats = null; }
  } else {
    store.stats = null;
  }
  store.loading = false;
}

/** 真实模式下按需拉取任务详情（缓存后不重复请求）。 */
export async function ensureDetail(taskId: string): Promise<void> {
  if (!isLive('tasks.detail') || !taskId) return;
  if (taskId in store.details) return;
  await refreshDetail(taskId);
}

/** 强制重取任务详情（绕缓存）：复核受理、重试、轮询等状态会变的操作后用。 */
export async function refreshDetail(taskId: string): Promise<QaTaskDetail | null> {
  if (!isLive('tasks.detail') || !taskId) return null;
  try {
    store.details[taskId] = await api.fetchTaskDetail(taskId);
  } catch {
    store.details[taskId] = null;
  }
  return store.details[taskId];
}

/** 原始任务详情：undefined = 尚未加载；null = 读取失败；对象 = 已加载。供详情弹窗直读全字段。 */
export function taskDetailOf(taskId: string): api.QaTaskDetail | null | undefined {
  return store.details[taskId];
}

/** 轮询专用：只在成功时覆盖缓存，失败保留上一次快照。
 *  区别于 refreshDetail（失败写 null）：一次网络抖动不应让步骤进度条闪没。 */
export async function pollDetail(taskId: string): Promise<void> {
  if (!isLive('tasks.detail') || !taskId) return;
  try {
    store.details[taskId] = await api.fetchTaskDetail(taskId);
  } catch {
    /* 保留旧值：下一轮轮询自然补上 */
  }
}

/* ================= 文档（PPT）任务详情弹窗 =================
 * 文档任务不走检测流水线，GET /tasks/{id} 的报告体与 ReportRef 不兼容（会 500），
 * 因此详情改用专用端点 GET /documents/{id} 取数，就地弹窗展示状态/页数/产物与下载。 */
const docStore = reactive({
  open: false,
  taskId: '',
  title: '',
  loading: false,
  error: '',
  data: null as api.QaDocumentResult | null,
});
export const docDetail = computed(() => docStore);

async function loadDocumentDetail(taskId: string): Promise<void> {
  if (!taskId) return;
  docStore.loading = true;
  docStore.error = '';
  try {
    docStore.data = await api.fetchDocument(taskId);
  } catch (e: any) {
    docStore.data = null;
    docStore.error = e?.message || '文档任务读取失败';
  } finally {
    docStore.loading = false;
  }
}

export function openDocumentDetail(taskId: string, title = ''): void {
  if (!taskId) return;
  docStore.taskId = taskId;
  docStore.title = title;
  docStore.data = null;
  docStore.error = '';
  docStore.open = true;
  void loadDocumentDetail(taskId);
}

export function closeDocumentDetail(): void { docStore.open = false; }
export function refreshDocumentDetail(): void { void loadDocumentDetail(docStore.taskId); }

/* ================= 派生视图数据 ================= */
export const tasks = computed(() => store.tasks);
export const loading = computed(() => store.loading);
export const error = computed(() => store.error);
export const tasksLive = computed(() => isLive('tasks.list'));

export const activeTab = computed({
  get: () => store.activeTab,
  set: (v: TaskTab) => { store.activeTab = v; },
});

export function goTab(tab: TaskTab) {
  store.activeTab = tab;
}

/** 深链预选任务：设置后由复核/报告页读取以定位选中项。 */
export function setFocusTask(id: string) {
  store.focusTask = id || '';
}
export const focusTask = computed(() => store.focusTask);

export const sortedTasks = computed(() =>
  [...store.tasks].sort((a, b) => timeKey(b.createdAt) - timeKey(a.createdAt)));

export const reviewableTasks = computed(() =>
  store.tasks.filter((t) => t.status === 'pending' || t.status === 'reviewing'));

export const reports = computed(() =>
  store.tasks
    .filter((t) => t.status === 'done' && t.reportType)
    .map((t) => ({
      taskId: t.id,
      scene: t.scene,
      capabilityId: t.capabilityId,
      type: t.reportType as ReportType,
      status: '已完成',
      generatedAt: t.createdAt,
    })));

export const reportStats = computed(() => {
  const list = reports.value;
  return {
    inWindow: list.length,
    joint: list.filter((r) => r.type === 'joint').length,
    agent: list.filter((r) => r.type === 'agent').length,
    pending: store.tasks.filter((t) => t.status === 'done' && !t.reportType).length,
  };
});

/** 列表页 KPI：有真实统计用全量权威计数，否则用窗口内任务估算。 */
export const taskStats = computed(() => {
  const s = store.stats;
  if (s) {
    return {
      total: s.total,
      running: s.running + s.pending,
      awaiting: s.awaiting_review,
      completed: s.completed,
      failed: s.failed + s.canceled,
    };
  }
  const t = store.tasks;
  return {
    total: t.length,
    running: t.filter((x) => x.status === 'running').length,
    awaiting: t.filter((x) => x.status === 'pending' || x.status === 'reviewing').length,
    completed: t.filter((x) => x.status === 'done').length,
    failed: t.filter((x) => x.status === 'failed').length,
  };
});

export const samples = computed(() => store.samples);

/** 结果复核：真实取详情映射，开发期取演示结论。 */
export function resultFor(taskId: string): TaskResult {
  if (isLive('tasks.detail')) {
    const d = store.details[taskId];
    if (!d) return { taskId, model: '读取中…', summary: '正在加载任务详情…', findings: [] };
    return mapDetailToResult(d);
  }
  if (seedResults[taskId]) return seedResults[taskId];
  const t = store.tasks.find((x) => x.id === taskId);
  return {
    taskId,
    model: '本地演示结论',
    summary: '该任务为本地演示数据,未接后端检测服务,以下为占位结论,不代表真实检测结果。',
    findings: t
      ? [{ label: `${t.scene}待处理对象`, confidence: 0.5, location: '演示占位', verdict: 'suspect' as const }]
      : [],
  };
}

/** 复核记录：仅当 review 通道带真实人工决定（action）才算已复核；
 *  待复核任务存的是复核门中断载荷（question/grade/candidates），无 action。 */
export function reviewOf(taskId: string): ReviewRecord | undefined {
  if (isLive('tasks.detail')) {
    const rv = store.details[taskId]?.review;
    if (!rv || !rv.action) return undefined;
    return {
      verdict: verdictOfAction(rv.action),
      note: rv.opinion || '',
      time: rv.reviewed_at ? Date.parse(rv.reviewed_at) : Date.now(),
      action: rv.action,
      gradingResult: rv.grading_result,
    };
  }
  return store.reviews[taskId];
}

function verdictOfAction(action: string): ReviewVerdict {
  if (action === 'reject') return 'return';
  if (action === 'revise') return 'revised';
  return 'approve';
}

/** 复核门中断载荷（question / grade / candidates / artifacts）；已复核或无载荷返回 null。 */
export function reviewInterruptOf(taskId: string): api.QaReviewInfo | null {
  if (!isLive('tasks.detail')) return null;
  const rv = store.details[taskId]?.review;
  if (!rv || rv.action) return null;
  return rv;
}

/** 复核主图（真实模式第一张输入图）；开发期或无图返回 null。
 *  直接回传后端业务 URI：输入图存于伪 task_id（_upload/_studio），用真实任务号重拼会 404。 */
export function taskPrimaryImage(taskId: string): string | null {
  if (!isLive('tasks.detail')) return null;
  const d = store.details[taskId];
  return d?.input_uris?.[0] ?? null;
}

/** 新建任务：真实走 POST /tasks，开发期写本地演示。 */
export async function createTask(input: {
  capabilityId: string; scene: string; object: string; note: string;
  files?: File[]; mode?: 'single' | 'agent' | 'joint';
}): Promise<{ id: string }> {
  const mode = input.mode ?? 'agent';
  if (isLive('tasks.submit')) {
    const sceneCode = capabilityToSceneCode(input.capabilityId);
    const r = await api.submitTask({
      scene: mode === 'single' ? sceneCode : null,
      mode,
      scenes: mode === 'joint' ? [sceneCode] : [],
      files: input.files ?? [],
      parameters: null,
    });
    await refreshTasks();
    return { id: r.task_id };
  }
  // 本地演示兜底
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const task: DetectionTask = {
    id: 'T' + Date.now().toString() + Math.floor(Math.random() * 90 + 10),
    scene: input.scene,
    capabilityId: input.capabilityId,
    object: input.object || '未命名业务对象',
    status: 'running',
    submitter: 'qadmin',
    createdAt: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
  store.created.unshift(task);
  store.tasks = mockTaskList();
  return { id: task.id };
}

/** 提交复核决定：真实走 POST /tasks/{id}/review，开发期写本地。
 *  后端为「即时受理 + 后台恢复」：接口返回仅表示受理成功（状态已翻 running），
 *  报告与终态需再轮询详情获得（见 pollTaskUntilSettled）。 */
export async function submitReviewDecision(taskId: string, input: ReviewDecisionInput): Promise<void> {
  if (isLive('tasks.review')) {
    await api.reviewTask(taskId, {
      action: input.action,
      opinion: input.opinion ?? '',
      override_grade: input.override_grade ?? null,
      defects: input.defects ?? null,
    });
    await Promise.all([refreshDetail(taskId), refreshTasks()]);
    return;
  }
  store.reviews[taskId] = {
    verdict: verdictOfAction(input.action),
    note: input.opinion || '',
    time: Date.now(),
    action: input.action,
    gradingResult: input.action === 'confirm' ? 'confirmed' : input.action === 'revise' ? 'revised' : 'rejected',
  };
  store.tasks = mockTaskList();
}

/** 兼容旧签名（检测页复核卡）：approve→confirm，return→reject。
 *  注意 reject 在后端是「驳回并终止」（任务落失败终态），不是退回重排队。 */
export async function submitReview(taskId: string, verdict: 'approve' | 'return', note: string): Promise<void> {
  await submitReviewDecision(taskId, { action: verdict === 'approve' ? 'confirm' : 'reject', opinion: note });
}

/** 场景歧义人工确认（POST /tasks/{id}/scene-confirm）：此类任务走复核门的
 *  场景中断分支，用 review 接口会被 409 拒绝。 */
export async function confirmScene(taskId: string, scene: string, opinion = ''): Promise<void> {
  if (isLive('tasks.sceneConfirm')) {
    await api.confirmScene(taskId, scene, opinion);
    await Promise.all([refreshDetail(taskId), refreshTasks()]);
    return;
  }
  store.reviews[taskId] = {
    verdict: 'approve', note: `场景确认：${sceneCodeToLabel(scene)}`, time: Date.now(),
    action: 'scene_confirm', gradingResult: 'scene_confirmed',
  };
  store.tasks = mockTaskList();
}

export interface PollOutcome {
  /** 后端原始状态码（completed/failed/canceled/…） */
  status: string;
  detail: api.QaTaskDetail | null;
  /** 是否真正落定（false = 超时仍在执行，需用户手动刷新） */
  settled: boolean;
}

const SETTLED_STATUS = new Set(['completed', 'failed', 'canceled']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 提交后轮询任务直至落定：复核恢复（含报告生成）后台执行可达分钟级，
 *  不能拿受理响应当终态。超时不报错，返回 settled=false 交给视图提示。 */
export async function pollTaskUntilSettled(
  taskId: string,
  opts?: { timeoutMs?: number; intervalMs?: number; onTick?: (status: string) => void },
): Promise<PollOutcome> {
  const { timeoutMs = 90_000, intervalMs = 1_500, onTick } = opts ?? {};
  if (!isLive('tasks.detail')) {
    const t = store.tasks.find((x) => x.id === taskId);
    const status = t?.status === 'done' ? 'completed' : t?.status === 'failed' ? 'failed' : (t?.status ?? '');
    onTick?.(status);
    return { status, detail: null, settled: true };
  }
  const deadline = Date.now() + timeoutMs;
  let detail = await refreshDetail(taskId);
  let status = detail?.status ?? '';
  onTick?.(status);
  while (!SETTLED_STATUS.has(status) && Date.now() < deadline) {
    await sleep(intervalMs);
    detail = await refreshDetail(taskId);
    status = detail?.status ?? status;
    onTick?.(status);
  }
  await refreshTasks();
  return { status, detail, settled: SETTLED_STATUS.has(status) };
}

/** 样本推进一档状态(待标注 → 已标注 → 已入数据集)（本地演示，阶段一保持） */
export function advanceSample(id: string) {
  const order: FeedbackSample['status'][] = ['待标注', '已标注', '已入数据集'];
  const s = store.samples.find((x) => x.id === id);
  if (!s) return;
  const i = order.indexOf(s.status);
  if (i < order.length - 1) s.status = order[i + 1];
}

/** "YYYY-MM-DD HH:mm" 或 "MM-DD HH:mm" → 可排序毫秒（无年份时补当前年） */
export function timeKey(s: string): number {
  const m = s.match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const y = m[1] ? Number(m[1]) : new Date().getFullYear();
  return new Date(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime() || 0;
}
