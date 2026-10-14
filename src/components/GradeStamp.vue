<script setup lang="ts">
/** 判级结论「印章」：把综合判级结果渲染成醒目的斜置虚线印章（对齐报告页 .rpt-stamp 观感）。
 *  统一用于任务详情弹窗 / 聊天完成卡·报告卡 / 复核卡 AI 预判等所有判级结论处。
 *  配色与深浅主题样式在 detection.css 的 .gstamp 规则中（全局，依赖 body.dark-theme）。 */
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  level?: string | null;
  /** 覆盖主文案（默认按 level 映射中文判级词）。 */
  label?: string;
  subtitle?: string;
  size?: 'sm' | 'md';
}>(), {
  level: 'review',
  label: '',
  subtitle: '综合判级 · 自动判级引擎',
  size: 'md',
});

const GRADE_LABEL: Record<string, string> = {
  pass: '合格', defect: '检出缺陷', review: '待复核', fail: '不合格',
  A: 'A 级', B: 'B 级', C: 'C 级', D: 'D 级',
};
const text = computed(() => props.label || GRADE_LABEL[props.level || ''] || props.level || '待复核');
</script>

<template>
  <div
    class="gstamp"
    :class="'gstamp-' + size"
    :data-level="level || 'review'"
    role="img"
    :aria-label="text + ' · ' + subtitle"
  >
    <span class="gstamp-level">{{ text }}</span>
    <span v-if="subtitle" class="gstamp-sub">{{ subtitle }}</span>
  </div>
</template>
