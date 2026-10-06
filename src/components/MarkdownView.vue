<script setup lang="ts">
import { computed } from 'vue';
import { extractThink, renderMarkdown } from '@/utils/markdown';
import { openImagePreview } from '@/composables/use-image-preview';

/** 把 AI 回答 / 引用片段按 Markdown 渲染；思维链  折叠为「思考过程」。
 *  正文里的图片（.md-img）点击可开通用灯箱放大，多图可前后切换。 */
const props = defineProps<{ text: string }>();

const parsed = computed(() => {
  const { think, body } = extractThink(props.text ?? '');
  return {
    thinkHtml: think ? renderMarkdown(think) : '',
    bodyHtml: renderMarkdown(body),
  };
});

function onBodyClick(e: MouseEvent) {
  const img = (e.target as HTMLElement | null)?.closest?.('img.md-img') as HTMLImageElement | null;
  if (!img) return;
  const root = e.currentTarget as HTMLElement;
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img.md-img'));
  const list = imgs.map((el) => ({ src: el.currentSrc || el.src, name: el.alt || '图片' }));
  const idx = imgs.indexOf(img);
  openImagePreview(list, idx < 0 ? 0 : idx);
}
</script>

<template>
  <div class="md-view" @click="onBodyClick">
    <details v-if="parsed.thinkHtml" class="md-think">
      <summary>思考过程</summary>
      <div class="md-body md-think-body" v-html="parsed.thinkHtml" />
    </details>
    <div class="md-body" v-html="parsed.bodyHtml" />
  </div>
</template>

<style scoped>
.md-view :deep(img.md-img) { cursor: zoom-in; }
</style>
