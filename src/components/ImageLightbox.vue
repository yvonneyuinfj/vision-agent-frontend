<script setup lang="ts">
/** 通用图片灯箱：滚轮/按钮缩放、拖拽平移、双击切换、多图前后切换、原图下载。
 *  由 use-image-preview store 驱动，全站单例（挂载于 App 根）。 */
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import IconSvg from '@/components/IconSvg.vue';
import {
  previewOpen, previewCurrent, previewIndex, previewTotal, previewMovable,
  closeImagePreview, previewNext, previewPrev,
} from '@/composables/use-image-preview';

const current = previewCurrent;
const movable = previewMovable;
const total = previewTotal;
const index = previewIndex;

/* 缩放 / 平移：zoom 为相对原图的绝对倍率，初始 = 适合屏幕的 fit */
const stageEl = ref<HTMLDivElement | null>(null);
const zoom = ref(1);
const fit = ref(1);
const nat = reactive({ w: 0, h: 0 });
const ready = ref(false);
const panX = ref(0);
const panY = ref(0);
const dragging = ref(false);
const imgError = ref(false);
let panMoved = false;
let panLast = { x: 0, y: 0 };

const pct = computed(() => Math.round(zoom.value * fit.value * 100));
const imgStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
  cursor: zoom.value > 1.001 ? (dragging.value ? 'grabbing' : 'grab') : 'zoom-in',
  opacity: ready.value && !imgError.value ? '1' : '0',
}));
const clampZoom = (z: number) => Math.min(12, Math.max(0.2, z));

function availableBox() {
  const el = stageEl.value;
  if (!el) return { w: 0, h: 0 };
  const cs = getComputedStyle(el);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  return { w: el.clientWidth - padX, h: el.clientHeight - padY };
}
function computeFit() {
  const { w, h } = availableBox();
  if (!w || !h || !nat.w || !nat.h) { fit.value = 1; return; }
  fit.value = Math.min(w / nat.w, h / nat.h, 1);
}
function resetView() { computeFit(); zoom.value = 1; panX.value = 0; panY.value = 0; }
function zoomBy(f: number) {
  zoom.value = clampZoom(zoom.value * f);
  if (zoom.value <= 1) { panX.value = 0; panY.value = 0; }
}
function toggleZoom() {
  if (zoom.value > 1.001) { zoom.value = 1; panX.value = 0; panY.value = 0; }
  else { zoom.value = clampZoom(1 / (fit.value || 1)); panX.value = 0; panY.value = 0; }
}
function onWheel(e: WheelEvent) { zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  dragging.value = true; panMoved = false; panLast = { x: e.clientX, y: e.clientY };
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  const dx = e.clientX - panLast.x, dy = e.clientY - panLast.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) panMoved = true;
  if (zoom.value > 1) { panX.value += dx; panY.value += dy; panLast = { x: e.clientX, y: e.clientY }; }
}
function onPointerUp() { dragging.value = false; }
function onStageClick() { if (panMoved) { panMoved = false; return; } close(); }

function onImgLoad(e: Event) {
  const t = e.currentTarget as HTMLImageElement;
  nat.w = t.naturalWidth; nat.h = t.naturalHeight;
  computeFit(); zoom.value = 1; panX.value = 0; panY.value = 0;
  ready.value = true;
}
function onImgErr() { imgError.value = true; ready.value = true; }

function close() { closeImagePreview(); }

/* 切换图片 / 重新打开：复位视图，待新图加载后按屏幕重算 fit */
function resetForNewImage() {
  ready.value = false; imgError.value = false; nat.w = 0; nat.h = 0;
  zoom.value = 1; fit.value = 1; panX.value = 0; panY.value = 0;
}
watch([index, () => current.value?.src], () => { resetForNewImage(); });
watch(previewOpen, (v) => {
  if (v) { resetForNewImage(); document.body.style.overflow = 'hidden'; }
  else { document.body.style.overflow = ''; }
});

function onResize() { computeFit(); }
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));

/* 键盘：Esc 关闭，← → 切换 */
function onKey(e: KeyboardEvent) {
  if (!previewOpen.value) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowRight' && movable.value) previewNext();
  else if (e.key === 'ArrowLeft' && movable.value) previewPrev();
}
document.addEventListener('keydown', onKey);
onUnmounted(() => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; });
</script>

<template>
  <teleport to="body">
    <div v-if="previewOpen" class="img-lb" @click.self="onStageClick">
      <div class="img-lb-bar">
        <span class="img-lb-name">{{ current?.name || '图片预览' }}</span>
        <span v-if="movable" class="img-lb-pos">{{ index + 1 }} / {{ total }}</span>
        <div class="img-lb-zoom">
          <button type="button" class="img-lb-btn" :disabled="zoom <= 0.2" aria-label="缩小" @click="zoomBy(1 / 1.2)">−</button>
          <span class="img-lb-pct">{{ pct }}%</span>
          <button type="button" class="img-lb-btn" :disabled="zoom >= 12" aria-label="放大" @click="zoomBy(1.2)">+</button>
          <button type="button" class="img-lb-fit" @click="resetView">适应</button>
        </div>
        <a v-if="current" class="img-lb-dl" :href="current.src" :download="current.name || true">
          <IconSvg name="download" /><span>下载</span>
        </a>
        <button type="button" class="img-lb-x" aria-label="关闭" @click="close">×</button>
      </div>

      <div
        ref="stageEl"
        class="img-lb-stage"
        @click.self="onStageClick"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
      >
        <button v-if="movable" type="button" class="img-lb-nav img-lb-prev" aria-label="上一张" @click.stop="previewPrev()">‹</button>
        <img
          v-if="current && !imgError" class="img-lb-img" :src="current.src" :alt="current.name || '预览图'"
          :style="imgStyle" draggable="false" @load="onImgLoad" @dblclick.stop="toggleZoom" @error="onImgErr"
        />
        <p v-else class="img-lb-err">图片加载失败</p>
        <button v-if="movable" type="button" class="img-lb-nav img-lb-next" aria-label="下一张" @click.stop="previewNext()">›</button>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.img-lb {
  position: fixed; inset: 0; z-index: 1400; display: flex; flex-direction: column;
  background: rgba(6, 12, 20, .86); backdrop-filter: blur(3px); animation: img-lb-fade .16s ease;
}
@keyframes img-lb-fade { from { opacity: 0 } to { opacity: 1 } }
.img-lb-bar { display: flex; align-items: center; gap: 14px; padding: 13px 20px; color: #eaf1f8; flex-wrap: wrap; }
.img-lb-name { flex: 1; min-width: 120px; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.img-lb-pos { font-size: 12.5px; color: #9fb4c8; font-variant-numeric: tabular-nums; }
.img-lb-zoom { display: flex; align-items: center; gap: 2px; background: rgba(255, 255, 255, .1); border-radius: 9px; padding: 3px; }
.img-lb-btn { width: 28px; height: 28px; border: none; border-radius: 6px; background: transparent; color: #fff; font-size: 18px; line-height: 1; cursor: pointer; transition: background .15s; }
.img-lb-btn:hover:not(:disabled) { background: rgba(255, 255, 255, .18); }
.img-lb-btn:disabled { opacity: .35; cursor: default; }
.img-lb-pct { min-width: 46px; text-align: center; font-size: 12.5px; color: #eaf1f8; font-variant-numeric: tabular-nums; }
.img-lb-fit { height: 28px; border: none; border-radius: 6px; background: transparent; color: #cfe0f0; font: inherit; font-size: 12.5px; padding: 0 10px; cursor: pointer; transition: background .15s; }
.img-lb-fit:hover { background: rgba(255, 255, 255, .18); }
.img-lb-dl { display: inline-flex; align-items: center; gap: 7px; text-decoration: none; font-size: 13px; color: #fff; background: rgba(255, 255, 255, .14); border: 1px solid rgba(255, 255, 255, .22); border-radius: 9px; padding: 7px 14px; transition: background .16s, border-color .16s; }
.img-lb-dl svg { width: 16px; height: 16px; }
.img-lb-dl:hover { background: #2368e4; border-color: #2368e4; }
.img-lb-x { width: 34px; height: 34px; flex-shrink: 0; border: none; border-radius: 9px; background: rgba(255, 255, 255, .12); color: #fff; font-size: 22px; line-height: 1; cursor: pointer; }
.img-lb-x:hover { background: rgba(255, 255, 255, .24); }
.img-lb-stage { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); place-items: center; overflow: hidden; touch-action: none; padding: 8px 20px 24px; }
.img-lb-img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 10px; box-shadow: 0 20px 60px rgba(0, 0, 0, .5); transform-origin: center; user-select: none; transition: opacity .18s ease; will-change: transform; }
.img-lb-err { color: #cfe0f0; font-size: 14px; }
.img-lb-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border: none; border-radius: 50%; background: rgba(255, 255, 255, .12); color: #fff; font-size: 26px; line-height: 1; cursor: pointer; transition: background .16s; }
.img-lb-nav:hover { background: rgba(255, 255, 255, .26); }
.img-lb-prev { left: 18px; }
.img-lb-next { right: 18px; }
</style>
