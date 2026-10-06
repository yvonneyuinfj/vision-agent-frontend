<script setup lang="ts">
/** 文档（PPT）任务详情弹窗：任务中心行内「详情」就地查看。
 *  数据源 GET /documents/{id}（use-tasks.docStore），只读呈现状态 / 主题 / 页数 /
 *  生成引擎 / 产物文件 / 参考资料要点；完成后提供「下载 PPT」。复用 det-modal 视觉体系。 */
import { computed, onUnmounted } from 'vue';
import IconSvg from '@/components/IconSvg.vue';
import { docDetail, closeDocumentDetail, refreshDocumentDetail } from '@/composables/use-tasks';

const d = computed(() => docDetail.value);
const data = computed(() => d.value.data);
const isDone = computed(() => data.value?.status === 'completed' && !!data.value?.artifact_uri);

const STATUS_LABEL: Record<string, string> = {
  pending: '排队中', running: '生成中', completed: '已完成', failed: '失败', canceled: '已取消',
};
const statusLabel = (s?: string | null) => (s ? STATUS_LABEL[s] || s : '');

function download() {
  const uri = data.value?.artifact_uri;
  if (uri) window.open(uri, '_blank');
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && d.value.open) closeDocumentDetail();
}
document.addEventListener('keydown', onKey);
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="d.open" class="det-modal" @click.self="closeDocumentDetail">
    <div class="det-modal-panel" role="dialog" aria-modal="true" aria-label="PPT 详情">
      <!-- 头部 -->
      <header class="det-modal-head">
        <div class="det-modal-title">
          <span class="det-modal-eyebrow">PPT 制作 · 详情</span>
          <code class="det-modal-id">{{ d.taskId }}</code>
        </div>
        <span v-if="data" class="det-modal-status" :data-status="data.status">{{ statusLabel(data.status) }}</span>
        <span class="det-grow"></span>
        <button class="det-modal-x" type="button" aria-label="关闭" @click="closeDocumentDetail">×</button>
      </header>

      <div class="det-modal-body">
        <p v-if="d.loading && !data" class="det-modal-note"><span class="det-modal-spin"></span>PPT 任务详情加载中…</p>
        <p v-else-if="d.error" class="det-modal-note">
          ⚠ {{ d.error }}
          <button class="det-modal-cta" type="button" @click="refreshDocumentDetail">重试</button>
        </p>

        <template v-else-if="data">
          <!-- 状态提示条 -->
          <div v-if="data.status === 'failed'" class="det-mdl-callout is-error">
            <span class="det-mdl-callout-hd">生成失败</span>
            <p>{{ data.error || 'PPT 生成过程中出现错误，请调整主题或参考资料后重试。' }}</p>
          </div>
          <div v-else-if="data.status === 'completed'" class="det-mdl-callout">
            <span class="det-mdl-callout-hd"><IconSvg name="check" />已生成 · 可下载</span>
            <p>{{ d.title || 'PPT 制作' }}<span v-if="data.slide_count != null"> · 共 {{ data.slide_count }} 页</span></p>
          </div>
          <div v-else class="det-mdl-callout">
            <span class="det-mdl-callout-hd">{{ statusLabel(data.status) }}</span>
            <p>PPT 正在后台生成，稍后刷新查看结果。</p>
          </div>

          <!-- 任务信息 -->
          <section class="det-mdl-sec">
            <h4>任务信息</h4>
            <div class="det-mdl-tablewrap">
              <table class="det-mdl-table">
                <tbody>
                  <tr><td>主题</td><td>{{ d.title || '—' }}</td></tr>
                  <tr><td>状态</td><td>{{ statusLabel(data.status) }}</td></tr>
                  <tr v-if="data.slide_count != null"><td>页数</td><td>{{ data.slide_count }} 页</td></tr>
                  <tr v-if="data.engine"><td>生成引擎</td><td>{{ data.engine }}</td></tr>
                  <tr v-if="data.filename"><td>产物文件</td><td><code>{{ data.filename }}</code></td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- 参考资料要点 -->
          <section v-if="data.material_notes && data.material_notes.length" class="det-mdl-sec">
            <h4>参考资料要点 <span class="det-mdl-count">{{ data.material_notes.length }}</span></h4>
            <ul class="det-mdl-steps">
              <li v-for="(m, i) in data.material_notes" :key="i"><span class="det-mdl-msg">{{ m }}</span></li>
            </ul>
          </section>
        </template>
      </div>

      <footer class="det-modal-foot">
        <span class="det-modal-foot-hint">文档任务由 PPT 制作工具生成，独立于检测流水线</span>
        <button v-if="isDone" class="det-modal-cta" type="button" @click="download">下载 PPT →</button>
        <button v-else class="det-modal-cta" type="button" @click="refreshDocumentDetail">刷新状态</button>
      </footer>
    </div>
  </div>
</template>
