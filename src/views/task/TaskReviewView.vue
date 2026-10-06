<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import IconSvg from '@/components/IconSvg.vue';
import { capabilities } from '@/data';
import {
  reviewableTasks, resultFor, reviewOf, submitReview,
  ensureDetail, taskPrimaryImage, tasksLive, focusTask,
} from '@/composables/use-tasks';
import { statusMeta } from '@/data/tasks';

const selectedId = ref('');
// 深链预选：focusTask 命中待复核列表则直接定位，否则回退首项
watch([reviewableTasks, focusTask], ([list, ft]) => {
  if (ft && list.some((t) => t.id === ft)) { selectedId.value = ft; return; }
  if (!list.some((t) => t.id === selectedId.value)) selectedId.value = list[0]?.id ?? '';
}, { immediate: true });

// 选中变化时预拉真实详情（开发期 mock 下 ensureDetail 空转）
watch(selectedId, (id) => { if (id) void ensureDetail(id); }, { immediate: true });

const selected = computed(() => reviewableTasks.value.find((t) => t.id === selectedId.value) ?? null);
const result = computed(() => (selectedId.value ? resultFor(selectedId.value) : null));
const record = computed(() => (selectedId.value ? reviewOf(selectedId.value) : undefined));
const primaryImage = computed(() => (selectedId.value ? taskPrimaryImage(selectedId.value) : null));

const note = ref('');
const busy = ref(false);
watch(selectedId, () => { note.value = record.value?.note ?? ''; });

function iconOf(capId: string) {
  return capabilities.find((c) => c.id === capId)?.icon ?? 'grid';
}

async function decide(verdict: 'approve' | 'return') {
  if (!selectedId.value || busy.value) return;
  busy.value = true;
  try {
    await submitReview(selectedId.value, verdict, note.value.trim());
    message.success(verdict === 'approve'
      ? (tasksLive.value ? '复核通过，已提交后端。' : '复核通过，已生成报告（本地演示）。')
      : '已退回，任务保持待复核。', 3);
    note.value = '';
  } catch (e: any) {
    message.error(`复核提交失败：${e?.message || '未知错误'}`, 4);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="task-panel">
    <div v-if="!reviewableTasks.length" class="task-empty">
      <IconSvg name="clipboard" />
      <p>当前没有待复核的任务。</p>
    </div>
    <div v-else class="task-review">
      <aside class="task-review-list">
        <button
          v-for="t in reviewableTasks"
          :key="t.id"
          class="task-review-item"
          :class="{ active: t.id === selectedId }"
          type="button"
          @click="selectedId = t.id"
        >
          <span class="task-review-ico"><IconSvg :name="iconOf(t.capabilityId)" /></span>
          <span class="task-review-meta">
            <strong>{{ t.object }}</strong>
            <small>{{ t.scene }} · {{ t.id }}</small>
          </span>
          <span class="task-tag" :class="`tone-${statusMeta[t.status].tone}`">{{ statusMeta[t.status].label }}</span>
        </button>
      </aside>

      <section v-if="selected && result" class="task-review-detail">
        <header class="task-review-head">
          <div>
            <h3>{{ selected.object }}</h3>
            <p><code class="task-id">{{ selected.id }}</code> · {{ selected.scene }} · {{ result.model }}</p>
          </div>
          <span v-if="record" class="task-review-state" :class="record.verdict">
            {{ record.verdict === 'approve' ? '已通过' : '已退回' }}
          </span>
        </header>

        <div class="task-result-canvas" :class="{ 'has-img': primaryImage }">
          <img v-if="primaryImage" :src="primaryImage" class="task-result-img" alt="检测原图" />
          <span v-else class="task-result-hint">{{ tasksLive ? '检测结果示意 · 无可用输入图像' : '检测结果示意 · 本地演示，未加载真实图像' }}</span>
        </div>

        <p class="task-result-summary">{{ result.summary }}</p>

        <table class="task-findings">
          <thead><tr><th>识别项</th><th>置信度</th><th>位置</th><th>判定</th></tr></thead>
          <tbody>
            <tr v-for="(f, i) in result.findings" :key="i">
              <td>{{ f.label }}</td>
              <td><span class="task-conf">{{ (f.confidence * 100).toFixed(0) }}%</span></td>
              <td class="task-loc">{{ f.location }}</td>
              <td>
                <span class="task-verdict" :class="f.verdict">
                  {{ f.verdict === 'confirmed' ? '确认' : f.verdict === 'suspect' ? '疑似' : '排除' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="task-review-actions">
          <a-textarea v-model:value="note" :rows="2" placeholder="复核意见（可选）" />
          <div class="task-review-btns">
            <a-button :disabled="busy" @click="decide('return')">退回</a-button>
            <a-button type="primary" :loading="busy" @click="decide('approve')">通过并出报告</a-button>
          </div>
          <p v-if="record" class="task-review-done">该任务已完成复核：{{ record.verdict === 'approve' ? '通过' : '退回' }}{{ record.note ? ` · ${record.note}` : '' }}</p>
        </div>
      </section>
    </div>
  </div>
</template>
