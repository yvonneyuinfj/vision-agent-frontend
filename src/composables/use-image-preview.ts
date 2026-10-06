/** 全站通用图片预览 store：任意组件调用 openImagePreview / previewImage 即可弹出灯箱，
 *  由挂载在 App 根的单例 <ImageLightbox> 消费。支持多图前后切换。 */
import { computed, reactive } from 'vue';

export interface PreviewImage { src: string; name?: string }

const state = reactive({ open: false, list: [] as PreviewImage[], index: 0 });

/** 打开预览：传入图片数组与初始下标。 */
export function openImagePreview(list: PreviewImage[], index = 0): void {
  const items = (list || []).filter((x) => x && x.src);
  if (!items.length) return;
  state.list = items;
  state.index = Math.min(Math.max(index, 0), items.length - 1);
  state.open = true;
}

/** 便捷：单图预览。 */
export function previewImage(src: string, name?: string): void {
  openImagePreview([{ src, name }], 0);
}

export function closeImagePreview(): void { state.open = false; }
export function previewNext(): void {
  const n = state.list.length;
  if (n < 2) return;
  state.index = (state.index + 1) % n;
}
export function previewPrev(): void {
  const n = state.list.length;
  if (n < 2) return;
  state.index = (state.index - 1 + n) % n;
}

export const previewOpen = computed(() => state.open);
export const previewIndex = computed(() => state.index);
export const previewTotal = computed(() => state.list.length);
export const previewMovable = computed(() => state.list.length > 1);
export const previewCurrent = computed<PreviewImage | null>(() => state.list[state.index] ?? null);
