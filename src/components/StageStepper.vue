<script setup lang="ts">
/** 六段式流程步骤条：检测页任务舱（dense）与任务详情弹窗（full）共用同一推导结果。
 *
 *  状态语义刻意保守：只把「真有过节点执行痕迹」的段落标为已完成，
 *  被路由跳过的一段（如无需复核直接出报告）画成虚线空心而非打勾——
 *  进度条的信用来自不撒谎。 */
import { computed } from 'vue';
import { STAGES, STAGE_COUNT, type StageProgress } from '@/data/inspection-stages';

const props = defineProps<{ progress: StageProgress; dense?: boolean }>();

type SegState = 'done' | 'current' | 'skipped' | 'todo';
interface Seg { i: number; label: string; hint: string; state: SegState }

const segs = computed<Seg[]>(() => {
  const p = props.progress;
  const ended = p.tone === 'completed';
  return STAGES.map((s, i): Seg => {
    let state: SegState;
    if (i < p.current) state = p.skipped[i] ? 'skipped' : 'done';
    else if (i === p.current) state = ended ? 'done' : 'current';
    else state = 'todo';
    return { i, label: s.label, hint: s.hint, state };
  });
});

/** dense 模式右侧的阶段摘要文案。 */
const head = computed(() => `${STAGES[props.progress.current].label} ${props.progress.current + 1}/${STAGE_COUNT}`);
</script>

<template>
  <div
    class="stg"
    :class="['tone-' + progress.tone, dense ? 'is-dense' : 'is-full']"
    :aria-label="'当前阶段：' + head"
  >
    <template v-for="(sg, i) in segs" :key="sg.i">
      <span
        v-if="i"
        class="stg-line"
        :class="{ 'is-on': segs[i - 1].state === 'done' || segs[i - 1].state === 'skipped' }"
        aria-hidden="true"
      ></span>
      <span class="stg-seg" :class="sg.state" :title="sg.label + '：' + sg.hint">
        <i class="stg-dot" aria-hidden="true"></i>
        <span v-if="!dense" class="stg-label">{{ sg.label }}</span>
      </span>
    </template>
    <span v-if="dense" class="stg-head">{{ head }}</span>
  </div>
</template>
