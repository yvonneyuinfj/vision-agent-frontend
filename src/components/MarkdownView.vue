<script setup lang="ts">
import { computed } from 'vue';
import { extractThink, renderMarkdown } from '@/utils/markdown';
import { openImagePreview } from '@/composables/use-image-preview';

/** 把 AI 回答 / 引用片段按 Markdown 渲染；思维链  折叠为「思考过程」。
 *  正文里的图片（.md-img）点击可开通用灯箱放大，多图可前后切换。
 *  doc 模式：报告全文等非聊天场景启用「文档级」排版（样式见 detection.css .md-doc）。 */
const props = defineProps<{ text: string; doc?: boolean }>();

const parsed = computed(() => {
  const { think, body } = extractThink(props.text ?? '');
  return {
    thinkHtml: think ? renderMarkdown(think) : '',
    bodyHtml: renderMarkdown(body),
  };
});

function onBodyClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  // 代码块“复制”按钮（渲染器注入，事件委托）
  const copyBtn = target?.closest?.('button.md-copy') as HTMLButtonElement | null;
  if (copyBtn) {
    const txt = copyBtn.parentElement?.querySelector('code')?.textContent ?? '';
    const revert = (label: string) => setTimeout(() => { copyBtn.textContent = label; copyBtn.classList.remove('is-done'); }, 1500);
    if (txt && navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(() => {
        copyBtn.textContent = '已复制'; copyBtn.classList.add('is-done'); revert('复制');
      }).catch(() => { copyBtn.textContent = '失败'; revert('复制'); });
    }
    return;
  }
  const img = target?.closest?.('img.md-img') as HTMLImageElement | null;
  if (!img) return;
  const root = e.currentTarget as HTMLElement;
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img.md-img'));
  const list = imgs.map((el) => ({ src: el.currentSrc || el.src, name: el.alt || '图片' }));
  const idx = imgs.indexOf(img);
  openImagePreview(list, idx < 0 ? 0 : idx);
}
</script>

<template>
  <div class="md-view" :class="{ 'md-doc': props.doc }" @click="onBodyClick">
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
