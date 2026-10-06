/** quality-agent 后端契约 ↔ Vue 展示层映射（阶段一 · 任务中心真实化）
 *  后端场景用英文码（fpi/borescope/infrared/dr/fracture/metallography），
 *  Vue 展示沿用中文简称与能力 id（fluorescence/...）；状态/模式也各有一套枚举，
 *  这里做双向映射，避免把后端字段直接灌进视图。 */

/** 后端任务状态枚举（对齐 app/api/schemas/task.py:TaskStatus） */
export type BackendTaskStatus =
  | 'pending' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'canceled';

/** 后端执行模式（对齐 task.py mode：single/agent/joint；document 为 PPT 等文档生成任务） */
export type BackendMode = 'single' | 'agent' | 'joint' | 'document';

/** 是否文档类任务（PPT 等非检测任务，mode='document'） */
export function isDocumentMode(mode: string | null | undefined): boolean {
  return mode === 'document';
}

/** Vue 能力 id（data/capabilities 的六项） */
export type VueCapabilityId =
  | 'fluorescence' | 'borescope' | 'thermal' | 'xray' | 'fracture' | 'metallography';

/** 能力 id ↔ 后端场景码 */
const CAP_TO_SCENE: Record<VueCapabilityId, string> = {
  fluorescence: 'fpi',
  borescope: 'borescope',
  thermal: 'infrared',
  xray: 'dr',
  fracture: 'fracture',
  metallography: 'metallography',
};

const SCENE_TO_CAP: Record<string, VueCapabilityId> = Object.fromEntries(
  Object.entries(CAP_TO_SCENE).map(([cap, code]) => [code, cap as VueCapabilityId]),
) as Record<string, VueCapabilityId>;

/** 场景码 → 中文简称（沿用任务中心列表现有展示口径） */
const SCENE_LABEL: Record<string, string> = {
  fpi: '荧光', borescope: '孔探', infrared: '热部',
  dr: 'X射线', fracture: '断口', metallography: '金相',
};

export function capabilityToSceneCode(capId: string): string {
  return CAP_TO_SCENE[capId as VueCapabilityId] ?? capId;
}

export function sceneCodeToCapabilityId(code: string | null | undefined): string {
  if (!code) return '';
  return SCENE_TO_CAP[code] ?? '';
}

export function sceneCodeToLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return SCENE_LABEL[code] ?? code;
}

/** 后端任务状态 → Vue 展示状态桶（复用 data/tasks.statusMeta 的 done/reviewing/pending/running/failed）。
 *  awaiting_review 视作「待复核」（pending），canceled 归入「失败」展示桶。 */
export type DisplayStatus = 'done' | 'reviewing' | 'pending' | 'running' | 'failed';

export function backendStatusToDisplay(s: string): DisplayStatus {
  switch (s as BackendTaskStatus) {
    case 'completed':
      return 'done';
    case 'awaiting_review':
      return 'pending';
    case 'running':
      return 'running';
    case 'pending':
      return 'running'; // 排队中并入「检测中」观感
    case 'failed':
    case 'canceled':
      return 'failed';
    default:
      return 'running';
  }
}

/** 复核通过后本地置态（后端已落终态前的乐观展示） */
export function reviewActionToNextDisplay(action: 'approve' | 'return'): DisplayStatus {
  return action === 'approve' ? 'done' : 'pending';
}

/** 后端 ISO 时间 → "YYYY-MM-DD HH:mm"（含年份；按 UTC 偏移不做时区换算，取日历字段） */
export function formatShortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
