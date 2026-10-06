<script setup lang="ts">
/** composer 右下「发送」圆钮：统一图标与加载态（旋转环），供首页与检测页复用。 */
const props = withDefaults(defineProps<{
  loading?: boolean;
  disabled?: boolean;
  label?: string;
  loadingLabel?: string;
}>(), {
  loading: false,
  disabled: false,
  label: '发送',
  loadingLabel: '发送中',
});
defineEmits<{ (e: 'click'): void }>();
</script>

<template>
  <button
    class="send-round"
    type="button"
    :class="{ 'is-loading': props.loading }"
    :disabled="props.disabled || props.loading"
    :aria-label="props.loading ? props.loadingLabel : props.label"
    @click="$emit('click')"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  </button>
</template>
