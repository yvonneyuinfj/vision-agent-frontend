<script setup lang="ts">
import { message } from 'ant-design-vue';
import { samples, advanceSample } from '@/composables/use-tasks';
import type { FeedbackSample } from '@/data/tasks';

const columns = [
  { title: '样本 ID', dataIndex: 'id', key: 'id', width: 150 },
  { title: '来源任务', dataIndex: 'sourceTask', key: 'sourceTask', width: 200 },
  { title: '场景', dataIndex: 'scene', key: 'scene', width: 90 },
  { title: '问题描述', dataIndex: 'issue', key: 'issue' },
  { title: '状态', dataIndex: 'status', key: 'status', width: 110 },
  { title: '回流时间', dataIndex: 'createdAt', key: 'createdAt', width: 130 },
  { title: '操作', key: 'action', width: 120 },
];

const tone: Record<FeedbackSample['status'], string> = {
  待标注: 'amber', 已标注: 'blue', 已入数据集: 'green',
};

function next(s: FeedbackSample) {
  if (s.status === '已入数据集') return;
  advanceSample(s.id);
  message.success(`${s.id} 已推进至「${s.status === '待标注' ? '已标注' : '已入数据集'}」（本地演示）。`, 2.6);
}
</script>

<template>
  <div class="task-panel">
    <div class="task-toolbar">
      <span class="task-toolbar-count">问题样本回流 {{ samples.length }} 条 · 用于模型迭代闭环</span>
    </div>
    <a-table
      :data-source="samples"
      :columns="columns"
      :pagination="{ pageSize: 10, hideOnSinglePage: true }"
      row-key="id"
      size="middle"
      class="task-table"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'id' || column.key === 'sourceTask'">
          <code class="task-id">{{ record[column.key as string] }}</code>
        </template>
        <template v-else-if="column.key === 'status'">
          <span class="task-tag" :class="`tone-${tone[record.status as FeedbackSample['status']]}`">{{ record.status }}</span>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-button type="link" size="small" :disabled="record.status === '已入数据集'" @click="next(record)">
            {{ record.status === '待标注' ? '完成标注' : record.status === '已标注' ? '加入数据集' : '已入集' }}
          </a-button>
        </template>
      </template>
    </a-table>
  </div>
</template>
