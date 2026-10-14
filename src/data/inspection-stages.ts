/** 质检编排流程 → 用户可读的六段式阶段（检测页任务舱 / 任务详情弹窗共用）。
 *
 *  数据源是任务自身的执行痕迹：后端每个编排节点都会 TaskRepo.append_step(task_id, node, message)
 *  落进 steps_json，经 GET /tasks/{id} 的 steps 下发。这些机械步骤行被会话流刻意挡掉
 *  （session_service.on_task_step 只转发 node="chain" 的思考链），所以只能从任务详情取。
 *
 *  为什么不直接拿节点当步骤：三套图节点集不同形——
 *  固定流水线 select_capability → validate → invoke_capability → normalize_result
 *            → rag_retrieval → grading → [human_review] → generate_report
 *  ReAct 单场景 bootstrap_agent → react_agent ⇄ react_tools → exit_gate → grading → …
 *  联合轨额外一个 await_children。
 *  故统一归一到固定六段，跨模式口径一致；节点级细节留给「执行轨迹」列表。 */

export interface StageDef {
  key: string;
  /** 用户可读阶段名（与空态 .det-workflow 的口径同源） */
  label: string;
  /** tooltip：这一段到底在干什么 */
  hint: string;
}

/** 顺序即流程顺序，索引即阶段序号。 */
export const STAGES: StageDef[] = [
  { key: 'intake', label: '场景识别', hint: '识别检测场景并选定可用的检测能力' },
  { key: 'validate', label: '输入校验', hint: '校验送检图像的格式、数量与必填参数' },
  { key: 'detect', label: '算法检测', hint: '调用专业算法工具推理，这一段耗时最长' },
  { key: 'analyze', label: '结果归一', hint: '归一化检出项并检索对应的标准与知识条目' },
  { key: 'grade', label: '智能判级', hint: '按确定性规则引擎判定等级与严重度' },
  { key: 'report', label: '复核报告', hint: '人工复核门（如触发）与检测报告生成' },
];

export const STAGE_COUNT = STAGES.length;

/** 编排节点名 → 阶段索引。
 *  后端新增节点时须在此登记，否则该节点不参与阶段推导（会退化为"停在上一段"）。 */
const NODE_STAGE: Record<string, number> = {
  // —— 场景识别 / 能力选定
  select_capability: 0,
  scene_confirm: 0,
  resolve_capability: 0,
  bootstrap_agent: 0,
  session_routing: 0,
  // —— 输入校验
  validate: 1,
  // —— 算法检测（ReAct 的自主循环与工具调用都算这一段）
  invoke_capability: 2,
  react_agent: 2,
  react_tools: 2,
  nudge: 2,
  await_children: 2,
  // —— 结果归一与知识检索
  normalize_result: 3,
  rag_retrieval: 3,
  explain_metrics: 3,
  // —— 智能判级（ReAct 出口安检归这一段）
  grading: 4,
  exit_gate: 4,
  // —— 复核与报告
  human_review: 5,
  generate_report: 5,
  review_timeout: 5,
};

/** 不参与阶段推导的节点：思考链事件、重试/文档等旁路留痕、失败解释。 */
const NON_STAGE_NODES = new Set(['chain', 'retry', 'document', 'cascade_terminate', 'explain_error', '__fail__']);

/** 节点名 → 阶段索引；无归属返回 null。 */
export function nodeToStageIndex(node: string): number | null {
  if (!node) return null;
  // ReAct 工具调用留痕形如 tool:invoke_xxx，一律归"算法检测"
  if (node.startsWith('tool:')) return NODE_STAGE.invoke_capability;
  if (NON_STAGE_NODES.has(node)) return null;
  const idx = NODE_STAGE[node];
  return idx === undefined ? null : idx;
}

/** 节点中文名（未知回退原名，与检测页 TOOL_LABEL 同一维护约定：不吞信息）。 */
export const NODE_LABEL: Record<string, string> = {
  select_capability: '场景识别',
  scene_confirm: '场景确认',
  resolve_capability: '能力解析',
  bootstrap_agent: '智能体初始化',
  session_routing: '会话路由',
  validate: '输入校验',
  invoke_capability: '调用检测能力',
  react_agent: '智能体推理',
  react_tools: '工具执行',
  nudge: '推进提示',
  await_children: '等待子任务落定',
  normalize_result: '结果归一',
  rag_retrieval: '知识检索',
  explain_metrics: '指标解释',
  grading: '智能判级',
  exit_gate: '出口安检',
  human_review: '人工复核',
  generate_report: '生成报告',
  review_timeout: '复核超时提醒',
  chain: '思考链',
  retry: '用户重试',
  document: '文档生成',
  cascade_terminate: '级联终止',
  explain_error: '失败解释',
};

export function nodeLabel(node: string): string {
  if (node.startsWith('tool:')) return `工具调用 · ${node.slice(5)}`;
  return NODE_LABEL[node] || node;
}

/** 阶段条色调：与卡片状态徽标同一套语义键，供 CSS data-tone 匹配。 */
export type StageTone = 'pending' | 'running' | 'awaiting_review' | 'completed' | 'failed';

export interface StageProgress {
  /** 当前所处阶段索引（0..STAGE_COUNT-1） */
  current: number;
  /** 各阶段是否真有过执行痕迹 */
  seen: boolean[];
  /** current 之前却无痕迹的阶段：如实标为"跳过"，不做假勾选 */
  skipped: boolean[];
  tone: StageTone;
  /** 最后一条参与推导的执行痕迹，供 tooltip 追到具体节点 */
  lastStep?: { node: string; message: string; ts: string };
}

export interface StepLike {
  node: string;
  message: string;
  ts: string;
}

/** 由执行痕迹 + 任务状态推导阶段进度。steps 为空且无状态时返回 null（无数据可说）。 */
export function deriveStageProgress(
  steps: StepLike[] | null | undefined,
  status: string | null | undefined,
): StageProgress | null {
  const list = Array.isArray(steps) ? steps : [];
  const st = String(status || '');
  if (!list.length && !st) return null;

  const seen = new Array<boolean>(STAGE_COUNT).fill(false);
  let current = -1;
  let lastStep: StageProgress['lastStep'];

  for (const s of list) {
    const idx = nodeToStageIndex(String(s?.node || ''));
    if (idx === null) continue;
    seen[idx] = true;
    if (idx > current) current = idx;
    lastStep = { node: String(s.node), message: String(s.message || ''), ts: String(s.ts || '') };
  }

  let tone: StageTone;
  if (st === 'completed') { tone = 'completed'; current = STAGE_COUNT - 1; }
  else if (st === 'awaiting_review') { tone = 'awaiting_review'; current = STAGE_COUNT - 1; }
  else if (st === 'failed' || st === 'canceled') { tone = 'failed'; }
  else if (st === 'running') { tone = 'running'; }
  else { tone = 'pending'; }

  // 尚无痕迹时不显示"第 1 段已完成"，用 0 表示"刚起步"
  if (current < 0) current = 0;

  const skipped = seen.map((v, i) => i < current && !v);
  return { current, seen, skipped, tone, lastStep };
}
