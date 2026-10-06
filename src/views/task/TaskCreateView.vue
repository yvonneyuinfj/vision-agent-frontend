<script setup lang="ts">
import { reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import { capabilities } from '@/data';
import { createTask, goTab, tasksLive } from '@/composables/use-tasks';

/** 能力 id → 场景简称 */
const sceneOf: Record<string, string> = {
  fluorescence: '荧光', borescope: '孔探', thermal: '热部',
  xray: 'X射线', fracture: '断口', metallography: '金相',
};

type Mode = 'single' | 'joint' | 'agent';
const modeOptions = [
  { value: 'single', label: '单场景检测' },
  { value: 'joint', label: '多场景联合研判' },
  { value: 'agent', label: '智能体自主路由' },
];

const form = reactive({ capabilityId: 'fluorescence', object: '', note: '', mode: 'single' as Mode });
const fileList = ref<any[]>([]);
const submitting = ref(false);

function collectFiles(): File[] {
  return fileList.value
    .map((f) => (f?.originFileObj ?? f) as File)
    .filter((f) => f instanceof File);
}

async function submit() {
  if (!form.capabilityId) {
    message.warning('请选择专业能力。', 3);
    return;
  }
  const files = collectFiles();
  if (tasksLive.value && !files.length) {
    message.warning('真实模式下请至少上传一个图像 / 文件。', 3.2);
    return;
  }
  submitting.value = true;
  try {
    const task = await createTask({
      capabilityId: form.capabilityId,
      scene: sceneOf[form.capabilityId] ?? '检测',
      object: form.object.trim(),
      note: form.note.trim(),
      files,
      mode: form.mode,
    });
    message.success(tasksLive.value ? `已提交任务 ${task.id}。` : `已创建任务 ${task.id}（本地演示，未执行检测）。`, 3.2);
    form.object = '';
    form.note = '';
    fileList.value = [];
    goTab('list');
  } catch (e: any) {
    message.error(`提交失败：${e?.message || '未知错误'}`, 4);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="task-panel">
    <div class="task-form-wrap">
      <a-form layout="vertical" class="task-form" @submit.prevent="submit">
        <a-form-item label="专业能力" required>
          <a-select
            v-model:value="form.capabilityId"
            :options="capabilities.map((c) => ({ value: c.id, label: `${c.name} · ${c.desc}` }))"
          />
        </a-form-item>
        <a-form-item label="检测模式">
          <a-select v-model:value="form.mode" :options="modeOptions" />
        </a-form-item>
        <a-form-item label="业务对象">
          <a-input v-model:value="form.object" placeholder="例如：涡轮叶片 A 批 · #07" />
        </a-form-item>
        <a-form-item label="检测说明">
          <a-textarea v-model:value="form.note" :rows="4" :maxlength="1000" show-count placeholder="描述检测目标、关注部位与期望输出" />
        </a-form-item>
        <a-form-item label="图像 / 文件">
          <a-upload
            v-model:file-list="fileList"
            :before-upload="() => false"
            multiple
            accept="image/*"
          >
            <a-button>选择本地文件</a-button>
            <span class="task-upload-hint">{{ tasksLive ? '提交时随任务上传至后端' : '本地演示：文件仅保留在浏览器，不会上传' }}</span>
          </a-upload>
        </a-form-item>
        <div class="task-form-actions">
          <a-button type="primary" :loading="submitting" @click="submit">提交任务</a-button>
          <a-button @click="goTab('list')">返回列表</a-button>
        </div>
        <p class="task-form-note">{{ tasksLive ? '当前已连接质检后端：提交后将上传图像并创建真实检测任务。' : '当前为：提交后任务进入「检测中」占位状态，不连接后端检测服务，专业结论需人工复核。' }}</p>
      </a-form>
    </div>
  </div>
</template>
