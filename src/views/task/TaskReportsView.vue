<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { reports, reportStats, tasksLive } from '@/composables/use-tasks';
import { reportTypeLabel, type ReportType } from '@/data/tasks';

const router = useRouter();

const tab = ref<ReportType | 'all'>('all');
const tabs: { value: ReportType | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'single', label: '单场景报告' },
  { value: 'joint', label: '联合综合研判' },
  { value: 'agent', label: '智能体报告' },
];

const rows = computed(() => reports.value.filter((r) => tab.value === 'all' || r.type === tab.value));

const stats = computed(() => [
  { label: '窗口内报告', value: reportStats.value.inWindow, note: '最近 100 条任务中已完成' },
  { label: '联合综合研判', value: reportStats.value.joint, note: '多场景证据汇总成报' },
  { label: '智能体报告', value: reportStats.value.agent, note: '自主路由 + 检查点轨迹' },
  { label: '尚未出报告', value: reportStats.value.pending, note: '待人工复核通过后生成', warn: reportStats.value.pending > 0 },
]);

const columns = [
  { title: '任务 ID', dataIndex: 'taskId', key: 'taskId' },
  { title: '场景', dataIndex: 'scene', key: 'scene', width: 90 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
  { title: '生成时间', dataIndex: 'generatedAt', key: 'generatedAt', width: 140 },
  { title: '查看', key: 'action', width: 90 },
];

function view(r: { taskId: string; type: ReportType }) {
  if (tasksLive.value) {
    void router.push({ path: `/report/${encodeURIComponent(r.taskId)}` });
    return;
  }
  message.info(`${reportTypeLabel[r.type]} · ${r.taskId}：当前为本地演示，未接后端报告服务。`, 3.4);
}
</script>

<template>
  <div class="task-panel task-reports">
    <div class="task-stats">
      <div v-for="s in stats" :key="s.label" class="task-stat-card">
        <span class="task-stat-label">{{ s.label }}</span>
        <strong class="task-stat-value">{{ s.value }}</strong>
        <span class="task-stat-note" :class="{ warn: s.warn }">{{ s.note }}</span>
      </div>
    </div>

    <div class="task-reports-grid">
      <section class="task-report-main">
        <div class="task-report-head">
          <h3>报告清单 <span>REPORTS</span></h3>
          <div class="task-seg">
            <button
              v-for="t in tabs"
              :key="t.value"
              type="button"
              :class="{ active: tab === t.value }"
              @click="tab = t.value"
            >{{ t.label }}</button>
          </div>
        </div>
        <p class="task-report-source">来源：{{ tasksLive ? '已完成任务（真实接口最近 100 条窗口）' : '已完成任务（本地演示）' }} · 状态 = 任务真实状态（报告四态无接口，不做）</p>

        <a-table
          :data-source="rows"
          :columns="columns"
          :pagination="{ pageSize: 10, hideOnSinglePage: true }"
          row-key="taskId"
          size="middle"
          class="task-table"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'taskId'">
              <code class="task-id">{{ record.taskId }}</code>
            </template>
            <template v-else-if="column.key === 'status'">
              <span class="task-tag tone-green">{{ record.status }}</span>
            </template>
            <template v-else-if="column.key === 'action'">
              <a-button size="small" @click="view(record)">查看</a-button>
            </template>
          </template>
        </a-table>
      </section>

      <aside class="task-report-side">
        <h3>综合研判承接 <span>AGGREGATION</span></h3>
        <div class="task-side-notice">
          <span class="task-side-notice-ico">⚠</span>
          <p><strong>方案 §10.2 的跨任务综合研判本轮不建页面。</strong>它要求按 business_ref 聚合同一零件/批次的多个独立任务，而后端不存在该字段（缺 G1-02 / §10）。</p>
        </div>
        <p class="task-side-subtitle">当前可用的真实聚合</p>
        <div class="task-side-card">
          <div class="task-side-card-top"><strong>mode=joint 父任务 + 子任务</strong><span class="task-pill ok">可用</span></div>
          <p>结果页保留各专业结论出处，不相加置信度、不合成综合分</p>
        </div>
        <div class="task-side-card">
          <div class="task-side-card-top"><strong>同一任务的多次复核</strong><span class="task-pill ok">可用</span></div>
          <p>以 Revision 序列呈现，最新为报告取数版本</p>
        </div>
        <div class="task-side-card">
          <div class="task-side-card-top"><strong>同零件/批次跨任务聚合</strong><span class="task-pill wait">待后端</span></div>
          <p>需 business_ref 落库与查询接口</p>
        </div>
      </aside>
    </div>
  </div>
</template>
