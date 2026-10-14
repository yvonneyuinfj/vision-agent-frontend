<script setup lang="ts">
/** 复核图像区：原图 + 缺陷框叠加 + 算法标注图三档图层，支持图上拖拽补框与整框拖动。
 *  坐标口径：SVG viewBox 用图像自然尺寸 + preserveAspectRatio="xMidYMid meet"，
 *  与容器等比缩放完全对齐，框位零换算（后端 bbox 为原图像素坐标 [x1,y1,x2,y2]）。 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { QaArtifactRef, QaDefectItem } from '@/api/tasks';
import IconSvg from '@/components/IconSvg.vue';
import { openImagePreview } from '@/composables/use-image-preview';
import { fileNameFromUri } from '@/api/tasks';
import {
  REJECTED_COLOR, SEVERITY_COLORS, annotatedArtifactForImage, drawableBBox,
  type BBox4,
} from '@/utils/defect';

const props = withDefaults(defineProps<{
  images: string[];
  index: number;
  /** 草稿缺陷表（含人工新增 / 已排除标记），按当前图过滤后绘制 */
  defects: QaDefectItem[];
  activeId?: string;
  artifacts?: QaArtifactRef[];
  /** add = 拖拽补框态；select = 浏览/选中态 */
  tool?: 'select' | 'add';
  /** 只读（已复核或任务不在复核门）时禁止画框与拖动 */
  readonly?: boolean;
  /** 可拖动整框的条目 id 白名单判定（默认允许拖动全部草稿条目） */
}>(), { activeId: '', artifacts: () => [], tool: 'select', readonly: false });

const emit = defineEmits<{
  (e: 'update:index', i: number): void;
  (e: 'select', id: string): void;
  (e: 'add-box', bbox: BBox4): void;
  (e: 'move-box', payload: { id: string; bbox: BBox4 }): void;
}>();

type Layer = 'boxes' | 'original' | 'artifact';
const layer = ref<Layer>('boxes');

const current = computed(() => props.images[props.index] ?? '');
const paired = computed(() => annotatedArtifactForImage(props.artifacts ?? [], current.value));
const artifactOn = computed(() => !!paired.value);

/** 当前图的缺陷框：带 image_name 溯源的按图过滤，避免多图 bbox 混叠 */
const boxedDefects = computed(() => {
  const first = props.images[0] ?? null;
  const fileName = current.value ? decodeURIComponent(fileNameFromUri(current.value)) : '';
  const tagged = props.defects.filter((d) => d.image_name);
  const scoped = !fileName || !tagged.length
    ? props.defects
    : props.defects.filter((d) => (d.image_name ? d.image_name === fileName : fileName === decodeURIComponent(first ? fileNameFromUri(first) : '')));
  return scoped
    .map((d, i) => ({ d, i, bbox: drawableBBox(d) }))
    .filter((x): x is { d: QaDefectItem; i: number; bbox: BBox4 } => x.bbox !== null);
});
const hasBoxes = computed(() => boxedDefects.value.length > 0);

const effLayer = computed<Layer>(() => {
  if (layer.value === 'boxes' && !hasBoxes.value) return artifactOn.value ? 'artifact' : 'original';
  if (layer.value === 'artifact' && !artifactOn.value) return 'original';
  return layer.value;
});
const src = computed(() => (effLayer.value === 'artifact' ? paired.value?.uri ?? current.value : current.value));

const natural = ref<{ w: number; h: number } | null>(null);
const loadFailed = ref(false);
const stage = ref<HTMLElement | null>(null);

watch(src, () => { natural.value = null; loadFailed.value = false; });
watch(hasBoxes, (v) => { if (v && layer.value !== 'artifact') layer.value = 'boxes'; });

function onImgLoad(e: Event) {
  const t = e.target as HTMLImageElement;
  if (t.naturalWidth > 0) natural.value = { w: t.naturalWidth, h: t.naturalHeight };
}

const strokeWidth = computed(() => (natural.value ? Math.max(2, natural.value.w / 340) : 2));
const fontSize = computed(() => (natural.value ? Math.max(12, Math.round(natural.value.w / 48)) : 14));

function colorOf(d: QaDefectItem): string {
  if (d.human_rejected) return REJECTED_COLOR;
  return SEVERITY_COLORS[d.severity ?? 'low'] ?? '#6ba3ff';
}

/** 客户端坐标 → 图像自然坐标 */
function toImagePoint(ev: PointerEvent): { x: number; y: number } | null {
  const el = stage.value;
  const n = natural.value;
  if (!el || !n) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: ((ev.clientX - r.left) / r.width) * n.w, y: ((ev.clientY - r.top) / r.height) * n.h };
}

/* ---------- 拖拽补框 ---------- */
const drawing = ref<BBox4 | null>(null);
let startPt: { x: number; y: number } | null = null;

function onPointerDown(ev: PointerEvent) {
  if (props.readonly || effLayer.value !== 'boxes' || !natural.value) return;
  const p = toImagePoint(ev);
  if (!p) return;
  if (props.tool === 'add') {
    startPt = p;
    drawing.value = [p.x, p.y, p.x, p.y];
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  }
}
function onPointerMove(ev: PointerEvent) {
  if (!startPt || !drawing.value) return;
  const p = toImagePoint(ev);
  if (!p) return;
  drawing.value = [startPt.x, startPt.y, p.x, p.y];
}
function onPointerUp() {
  const b = drawing.value;
  startPt = null;
  drawing.value = null;
  if (!b || !natural.value) return;
  const w = Math.abs(b[2] - b[0]);
  const h = Math.abs(b[3] - b[1]);
  // 阈值：短边小于图宽 1.5% 视为误触
  if (w < natural.value.w * 0.015 || h < natural.value.h * 0.015) return;
  emit('add-box', b as BBox4);
}

/* ---------- 整框拖动（移框） ---------- */
let dragId = '';
let dragOrigin: { x: number; y: number } | null = null;
let dragStartBBox: BBox4 | null = null;
const dragBBox = ref<{ id: string; bbox: BBox4 } | null>(null);

function onRectDown(ev: PointerEvent, item: { d: QaDefectItem; bbox: BBox4 }) {
  const id = item.d.defect_id ?? '';
  emit('select', id);
  if (props.readonly || props.tool === 'add' || !id) return;
  const p = toImagePoint(ev);
  if (!p) return;
  dragId = id;
  dragOrigin = p;
  dragStartBBox = [...item.bbox] as BBox4;
  (ev.currentTarget as Element & { setPointerCapture?: (i: number) => void }).setPointerCapture?.(ev.pointerId);
  ev.stopPropagation();
  ev.preventDefault();
}
function onRectMove(ev: PointerEvent) {
  if (!dragId || !dragOrigin || !dragStartBBox) return;
  const p = toImagePoint(ev);
  if (!p) return;
  const dx = p.x - dragOrigin.x;
  const dy = p.y - dragOrigin.y;
  dragBBox.value = { id: dragId, bbox: [dragStartBBox[0] + dx, dragStartBBox[1] + dy, dragStartBBox[2] + dx, dragStartBBox[3] + dy] };
}
function onRectUp() {
  const cur = dragBBox.value;
  if (cur) emit('move-box', cur);
  dragId = '';
  dragOrigin = null;
  dragStartBBox = null;
  dragBBox.value = null;
}
onBeforeUnmount(() => { dragId = ''; dragOrigin = null; dragStartBBox = null; });

function liveBBox(item: { d: QaDefectItem; bbox: BBox4 }): BBox4 {
  const cur = dragBBox.value;
  return cur && cur.id === (item.d.defect_id ?? '') ? cur.bbox : item.bbox;
}

function openLightbox() {
  if (props.readonly && props.images.length) openImagePreview(props.images.map((s) => ({ src: s, name: fileNameFromUri(s) })), props.index);
}
</script>

<template>
  <div class="rvw-img">
    <div class="rvw-img-bar">
      <button type="button" :class="{ on: effLayer === 'boxes' }" :disabled="!hasBoxes" @click="layer = 'boxes'">缺陷框叠加</button>
      <button type="button" :class="{ on: effLayer === 'original' }" @click="layer = 'original'">原图</button>
      <button v-if="artifactOn" type="button" :class="{ on: effLayer === 'artifact' }" @click="layer = 'artifact'">算法标注图</button>
      <span class="rvw-grow"></span>
      <span v-if="tool === 'add' && !readonly" class="rvw-img-tip">在被框选区域松开鼠标即可登记一条人工新增缺陷</span>
      <button class="rvw-img-zoom" type="button" title="放大查看" @click="openLightbox"><IconSvg name="inspect" /></button>
    </div>

    <div
      ref="stage"
      class="rvw-stage"
      :class="{ 'is-add': tool === 'add' && !readonly && effLayer === 'boxes' }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <img
        v-if="src && !loadFailed"
        :src="src"
        class="rvw-img-el"
        alt="检测图像"
        draggable="false"
        @load="onImgLoad"
        @error="loadFailed = true"
      />
      <p v-if="!src || loadFailed" class="rvw-img-empty">
        {{ readonly && !images.length ? '本地演示 · 无真实图像' : '图像不可用（后端文件读取失败或已清理）' }}
      </p>

      <svg
        v-if="effLayer === 'boxes' && natural"
        class="rvw-svg"
        :viewBox="`0 0 ${natural.w} ${natural.h}`"
        preserveAspectRatio="xMidYMid meet"
      >
        <g v-for="item in boxedDefects" :key="item.d.defect_id || `d-${item.i}`">
          <title>{{ item.d.defect_name_cn || item.d.defect_type }}{{ item.d.confidence != null ? ` · 置信 ${item.d.confidence.toFixed(2)}` : '' }}{{ item.d.human_rejected ? ' · 人工排除' : '' }}</title>
          <rect
            :x="liveBBox(item)[0]"
            :y="liveBBox(item)[1]"
            :width="Math.max(1, liveBBox(item)[2] - liveBBox(item)[0])"
            :height="Math.max(1, liveBBox(item)[3] - liveBBox(item)[1])"
            fill="none"
            :stroke="colorOf(item.d)"
            :stroke-width="(item.d.defect_id || '') === activeId ? strokeWidth * 2 : strokeWidth"
            :stroke-dasharray="item.d.human_rejected ? `${fontSize / 2} ${fontSize / 3}` : undefined"
            :opacity="item.d.human_rejected ? 0.75 : 1"
            :class="{ 'is-grab': !readonly && tool !== 'add' }"
            @pointerdown="onRectDown($event, item)"
            @pointermove="onRectMove"
            @pointerup="onRectUp"
          />
          <text
            :x="liveBBox(item)[0]"
            :y="Math.max(fontSize, liveBBox(item)[1] - fontSize / 3)"
            :font-size="fontSize"
            :fill="colorOf(item.d)"
            stroke="#0b1020"
            :stroke-width="fontSize / 6"
            paint-order="stroke"
          >A{{ item.i + 1 }}{{ item.d.human_rejected ? ' 已排除' : item.d.source === 'manual' ? ' 人工' : '' }}</text>
        </g>
        <rect
          v-if="drawing && natural"
          :x="Math.min(drawing[0], drawing[2])"
          :y="Math.min(drawing[1], drawing[3])"
          :width="Math.abs(drawing[2] - drawing[0])"
          :height="Math.abs(drawing[3] - drawing[1])"
          fill="rgba(107,163,255,.16)"
          stroke="#6ba3ff"
          :stroke-width="strokeWidth"
          stroke-dasharray="6 4"
        />
      </svg>

      <span class="rvw-img-badge">
        {{ effLayer === 'boxes' ? '标注图（缺陷框叠加）' : effLayer === 'artifact' ? '算法标注图（模型渲染）' : '原图' }}
      </span>
    </div>

    <div v-if="images.length > 1" class="rvw-strip">
      <button
        v-for="(u, i) in images"
        :key="u + i"
        type="button"
        class="rvw-thumb"
        :class="{ on: i === index }"
        :title="fileNameFromUri(u)"
        @click="emit('update:index', i)"
      ><img :src="u" :alt="`输入图 ${i + 1}`" loading="lazy" /></button>
    </div>
  </div>
</template>
