<script setup lang="ts">
import { message } from 'ant-design-vue';
import { useDialog, closeDialog, handleDelegatedClick } from '@/composables/use-navigation';
import { useRouter } from 'vue-router';

const dialog = useDialog();
const router = useRouter();

function onBodyClick(event: MouseEvent) {
  handleDelegatedClick(event.target as HTMLElement, router);
}

function runAction(index: number) {
  const action = dialog.actions[index];
  if (!action) return;
  action.run?.();
}

function toast(text: string) {
  message.info(text, 3.6);
}

defineExpose({ toast });
</script>

<template>
  <a-modal
    :open="dialog.open"
    :footer="null"
    :width="720"
    :style="{ top: '6vh' }"
    :mask-closable="true"
    class="agent-modal"
    @cancel="closeDialog"
    @update:open="(v: boolean) => (dialog.open = v)"
  >
    <template #title>
      <div class="dialog-head-antd">
        <div>
          <p id="dialog-eyebrow">{{ dialog.eyebrow }}</p>
          <h2 id="dialog-title">{{ dialog.title }}<span v-if="dialog.badge" class="dialog-title-badge">{{ dialog.badge }}</span></h2>
          <p v-if="dialog.subtitle" id="dialog-subtitle">{{ dialog.subtitle }}</p>
        </div>
      </div>
    </template>
    <div class="dialog-body" @click="onBodyClick">
      <!-- 弹窗正文为本地构造的富文本(见 use-navigation),动作按钮走 actions 回调 -->
      <div v-html="dialog.body" />
    </div>
    <div v-if="dialog.actions.length" class="dialog-actions">
      <a-button
        v-for="(action, index) in dialog.actions"
        :key="action.label"
        :type="action.primary ? 'primary' : 'default'"
        @click="runAction(index)"
      >{{ action.label }}</a-button>
    </div>
  </a-modal>
</template>
