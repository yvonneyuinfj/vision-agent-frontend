import { nextTick, reactive, ref } from 'vue';
import { closeDialog } from './use-navigation';

/** 全局智能视觉助手输入状态(首页与弹窗动作共享) */
export const assistant = reactive({
  prompt: '',
  files: [] as File[],
});

export const composerRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

/** 关闭弹窗、聚焦并滚动到助手输入框;可预填文本 */
export function focusAssistant(value?: string) {
  closeDialog();
  if (value !== undefined) assistant.prompt = value;
  void nextTick(() => {
    composerRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => textareaRef.value?.focus(), 120);
  });
}

