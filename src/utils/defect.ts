/** 复核工作台 · 缺陷可视化与人工修订工具集
 *  口径与后端 app/agents/nodes/human_review.py 严格对齐：
 *  - location 契约 {type:'bbox', bbox:[x1,y1,x2,y2]}，兼容存量 FPI 数据的 bbox_xyxy；
 *  - diff 按 defect_id 对齐（缺失时索引兜底 __idx_{i}），一条只计一次、排除优先；
 *  - 人工新增条目 defect_id 以 M 前缀补号，模型条目为 D 前缀，天然不冲突。 */
import type { QaArtifactRef, QaDefectItem } from '@/api/tasks';

export type BBox4 = [number, number, number, number];

/** 严重度描边色（浅色底图上对比度优先，深浅主题共用） */
export const SEVERITY_COLORS: Record<string, string> = {
  high: '#f0756b',
  medium: '#f0b75e',
  low: '#6ba3ff',
};
/** 人工排除（误检）条目统一灰虚线 */
export const REJECTED_COLOR = '#9aa0a6';

/** 人工新增条目的占位类型：提交前必须换成真实类别（面板拦截） */
export const NEW_DEFECT_TYPE = '__new__';
export const NEW_DEFECT_NAME_CN = '人工补框';

/** 取条目的稳定 key：defect_id 优先，缺失按索引兜底（与后端 diff 兜底同形）。 */
export function defectKey(d: QaDefectItem, i: number): string {
  return d.defect_id || `__idx_${i}`;
}

/** 存量非规范条目的类型字段回退链（部分工具/热部链路只落 type/label/class_name）。
 *  后端 _validate_revised_defects 要求整表每项都有字符串 defect_type，
 *  缺失会在 revise 提交时整单被拒，因此播种阶段就归一（基线与草稿同源，不影响 diff 计数）。 */
const TYPE_FALLBACK_KEYS = ['type', 'label', 'class_name', 'name', 'code'] as const;
export function normalizeDefectType(d: QaDefectItem): string {
  const cur = typeof d.defect_type === 'string' ? d.defect_type.trim() : '';
  if (cur) return cur;
  const raw = d as unknown as Record<string, unknown>;
  for (const k of TYPE_FALLBACK_KEYS) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** 为基线补齐稳定 id 与规范 defect_type，保证草稿每条可寻址且能整表上送。 */
export function withStableIds(defects: QaDefectItem[]): QaDefectItem[] {
  return defects.map((d, i) => ({
    ...d,
    defect_id: d.defect_id ?? defectKey(d, i),
    defect_type: normalizeDefectType(d),
    defect_name_cn: d.defect_name_cn || '',
  }));
}

let manualSeq = 0;
/** 人工新增条目本地 id：M + 时间戳36进制 + 计数，避免与模型 D00x 冲突。 */
export function nextManualId(): string {
  manualSeq += 1;
  return `M${Date.now().toString(36).slice(-5)}${manualSeq}`;
}

/** 拖拽矩形归一化为 [x1,y1,x2,y2]。 */
export function clampBox(x1: number, y1: number, x2: number, y2: number): BBox4 {
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/** 可绘制 bbox：仅 type 缺省或 'bbox' 时采信，坐标数须为 4。 */
export function drawableBBox(d: QaDefectItem): BBox4 | null {
  const loc = d.location as { type?: string; bbox?: number[]; bbox_xyxy?: number[] } | null;
  if (!loc) return null;
  if (loc.type !== undefined && loc.type !== 'bbox') return null;
  const bbox = loc.bbox ?? loc.bbox_xyxy;
  return Array.isArray(bbox) && bbox.length === 4 ? (bbox as BBox4) : null;
}

/** 图 URI 末段文件名（后端输入图端点 /files/{name}?kind=inputs）。 */
export function imageFileName(uri: string | null | undefined): string {
  if (!uri) return '';
  const seg = uri.split('/files/')[1]?.split('?')[0] ?? uri.split('/').pop() ?? '';
  try { return decodeURIComponent(seg); } catch { return seg; }
}

/** 多图任务缺陷-图像配对：带 image_name 的按图精确匹配，
 *  无归属标记的条目只落到第一张图（坐标体系不同，绝不混叠到每张图）。 */
export function defectsForImage(
  defects: QaDefectItem[], imageUri: string | null | undefined, firstImageUri?: string | null,
): QaDefectItem[] {
  const fileName = imageFileName(imageUri);
  if (!fileName) return defects;
  const tagged = defects.filter((d) => d.image_name);
  if (!tagged.length) return defects; // 存量单图数据：无溯源标记，不过滤
  const isFirst = !firstImageUri || imageFileName(firstImageUri) === fileName;
  return defects.filter((d) => (d.image_name ? d.image_name === fileName : isFirst));
}

const IMG_URI_RE = /\.(jpe?g|png|tif|tiff)(\?|$)/i;

/** 产物是否为图片：mime 优先，缺失时按 URI 扩展名兜底（对齐后端 _is_image_artifact）。 */
export function isImageArtifact(a: QaArtifactRef): boolean {
  return (a.mime ?? '').startsWith('image/') || IMG_URI_RE.test(a.uri);
}

function byName(images: QaArtifactRef[], ...keys: string[]): QaArtifactRef | undefined {
  return images.find((a) => keys.some((k) => (a.name ?? '').toLowerCase().includes(k)));
}

/** 从产物列表挑（原图, 标注图）对：命名优先，不可辨时按出现序兜底。 */
export function pickArtifactImagePair(artifacts: QaArtifactRef[] | null | undefined): {
  original: QaArtifactRef | null; annotated: QaArtifactRef | null;
} {
  const images = (artifacts ?? []).filter(isImageArtifact);
  const original = byName(images, 'original_image', 'original') ?? null;
  const annotated = byName(images, 'result_image', 'annotated', 'annotation') ?? null;
  const rest = images.filter((a) => a !== original && a !== annotated);
  if (!original && rest.length) rest.shift();
  if (!annotated && rest.length) rest.shift();
  return { original, annotated };
}

/** 当前输入图对应的算法标注图：按 fan-out 后缀 __<stem> 配对，无标记回退首对。 */
export function annotatedArtifactForImage(
  artifacts: QaArtifactRef[] | null | undefined, imageUri: string | null | undefined,
): QaArtifactRef | null {
  if (!imageUri) return pickArtifactImagePair(artifacts).annotated;
  const fileName = imageFileName(imageUri);
  const stem = fileName.replace(/\.[^.]+$/, '');
  if (!stem) return pickArtifactImagePair(artifacts).annotated;
  const images = (artifacts ?? []).filter(isImageArtifact);
  const lower = (a: QaArtifactRef) => (a.name ?? '').toLowerCase();
  const match =
    images.find((a) => lower(a).includes(`__${stem.toLowerCase()}`) && !lower(a).includes('original')) ??
    images.find((a) => lower(a).startsWith(`${stem.toLowerCase()}_annotated`));
  return match ?? pickArtifactImagePair(artifacts).annotated;
}

/* ==================== 修订 diff（与后端 _defect_revision_diff 同构） ==================== */
export interface DefectDiff {
  added: number; excluded: number; reclassified: number;
  severity_changed: number; moved: number; removed: number;
}

/** bbox 比较与后端一致：只看契约键 location.bbox（存量 bbox_xyxy 不参与）。 */
function bboxOf(d: QaDefectItem): number[] | undefined {
  return (d.location as { bbox?: number[] } | null)?.bbox;
}

function sameBBox(a?: number[], b?: number[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function defectDiff(baseline: QaDefectItem[], draft: QaDefectItem[]): DefectDiff {
  const origByKey = new Map<string, QaDefectItem>();
  baseline.forEach((d, i) => origByKey.set(defectKey(d, i), d));
  const diff: DefectDiff = { added: 0, excluded: 0, reclassified: 0, severity_changed: 0, moved: 0, removed: 0 };
  const seen = new Set<string>();
  draft.forEach((d, i) => {
    const key = defectKey(d, i);
    seen.add(key);
    const old = origByKey.get(key);
    if (d.source === 'manual') { diff.added += 1; return; }
    if (!old) {
      // 智能体视觉判断条目（react 轨常无 defect_id，索引兜底对齐）不得计成人工补漏检
      if (d.source === 'agent_visual') return;
      diff.added += 1; return;
    }
    if (d.human_rejected && !old.human_rejected) { diff.excluded += 1; return; }
    if (d.defect_type !== old.defect_type) diff.reclassified += 1;
    if (d.severity !== old.severity) diff.severity_changed += 1;
    if (!sameBBox(bboxOf(d), bboxOf(old))) diff.moved += 1;
  });
  origByKey.forEach((_, key) => { if (!seen.has(key)) diff.removed += 1; });
  return diff;
}

export function hasRevision(diff: DefectDiff): boolean {
  return Object.values(diff).some((v) => v > 0);
}

/** 一行中文摘要（修订 chip 与复核意见留痕共用）。 */
export function diffSummaryText(diff: DefectDiff): string {
  const parts: string[] = [];
  if (diff.added) parts.push(`新增 ${diff.added}`);
  if (diff.excluded) parts.push(`排除 ${diff.excluded}`);
  if (diff.reclassified) parts.push(`改类 ${diff.reclassified}`);
  if (diff.severity_changed) parts.push(`严重度调整 ${diff.severity_changed}`);
  if (diff.moved) parts.push(`移框 ${diff.moved}`);
  if (diff.removed) parts.push(`移除 ${diff.removed}`);
  return parts.join('、');
}

/** 提交拦截：存在未指定真实类别的人工新增条目。 */
export function hasUntypedManual(draft: QaDefectItem[]): boolean {
  return draft.some((d) => d.source === 'manual' && d.defect_type === NEW_DEFECT_TYPE);
}

/** 是否为「还没有真实类型」的条目（人工补框占位，或存量无类型条目归一后仍为空）。 */
export function isUntyped(d: QaDefectItem): boolean {
  const t = typeof d.defect_type === 'string' ? d.defect_type.trim() : '';
  return !t || t === NEW_DEFECT_TYPE;
}

/** 后端契约硬要求：整表每项都必须有非空字符串 defect_type，否则 revise 整单被拒。 */
export function countUntyped(draft: QaDefectItem[]): number {
  return draft.filter(isUntyped).length;
}
