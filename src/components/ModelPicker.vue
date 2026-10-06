<script setup lang="ts">
/** 输入框右下「模型切换」下拉：自持模型列表与选择状态。
 *  首页与智能检测页的 composer 完全一致，统一在此复用；后端不可达时仅保留"自动"项。
 *  选择结果目前仅作 UI 展示（暂未随请求下发），如需回传给父级可用 v-model 绑定。 */
import { computed, onMounted, ref } from 'vue';
import { listResources } from '@/api/config-resources';

interface ModelOption { value: string; label: string }
const AUTO_MODEL: ModelOption = { value: 'auto', label: '自动 · 智能路由' };

const selected = defineModel<string>({ default: 'auto' });
const open = ref(false);
const options = ref<ModelOption[]>([AUTO_MODEL]);
const label = computed(() => options.value.find((m) => m.value === selected.value)?.label ?? AUTO_MODEL.label);

async function loadModels() {
  try {
    const rows = await listResources('llm');
    const opts = rows
      .filter((r) => r.status === 'enabled')
      .map((r) => ({ value: String(r.provider_id), label: String(r.display_name || r.model_name || r.provider_id) }));
    options.value = [AUTO_MODEL, ...opts];
  } catch { /* 后端不可达：仅保留“自动”项 */ }
}
function onSelect(info: { key: string | number }) { selected.value = String(info.key); open.value = false; }

onMounted(loadModels);
</script>

<template>
  <a-dropdown v-model:open="open" :trigger="['click']" placement="topRight">
    <button class="tool-model" type="button">
      <span>{{ label }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
    <template #overlay>
      <a-menu :selected-keys="[selected]" @click="onSelect">
        <a-menu-item v-for="m in options" :key="m.value">{{ m.label }}</a-menu-item>
      </a-menu>
    </template>
  </a-dropdown>
</template>
