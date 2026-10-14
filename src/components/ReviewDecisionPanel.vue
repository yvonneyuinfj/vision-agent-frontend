<script setup lang="ts">
/** 复核决定面板：动作卡（同意 / 改判 / 驳回）+ 改判条件表单 + 必填意见 + 提交反馈。
 *  口径与后端 human_review 契约一致：
 *  - 只有「改判 / 修正」才上送 override_grade 与 defects，其他动作携带会被忽略；
 *  - 驳回（reject）是终止任务并落失败终态，不是退回重排队；
 *  - 接口为「即时受理」，真正的终态由父层轮询后经 phase/phaseText 回填。 */
import { computed } from 'vue';
import type { QaGradeInfo } from '@/api/tasks';
import IconSvg from '@/components/IconSvg.vue';
import GradeStamp from '@/components/GradeStamp.vue';
import { DECISION_CARDS, GRADE_LEVELS, type ReviewActionKey, type ReviewPhase } from '@/composables/use-review';
import type { ReviewRecord } from '@/composables/use-tasks';

const props = withDefaults(defineProps<{
  action?: ReviewActionKey | '';
  opinion?: string;
  overrideLevel?: string;
  /** AI 自动判级结论（同意时即沿用此结论） */
  grade?: QaGradeInfo | null;
  /** 缺陷草稿是否有修订 */
  hasEdits?: boolean;
  editSummary?: string;
  /** 「还没有真实类型」的条数（含人工补框与存量无类型条目） */
  untyped?: number;
  /** 队列里是否还有别的待复核任务（决定「下一个」按钮出现与否） */
  hasNext?: boolean;
  /** 任务当前不在复核门（已复核 / 已落定）时只读 */
  awaiting?: boolean;
  decided?: ReviewRecord | null;
  phase?: ReviewPhase;
  phaseText?: string;
  error?: string;
  finalStatus?: string;
  submitting?: boolean;
}>(), {
  action: '', opinion: '', overrideLevel: 'pass', grade: null,
  hasEdits: false, editSummary: '暂无修订', untyped: 0,
  hasNext: false, awaiting: true, decided: null,
  phase: 'idle', phaseText: '', error: '', finalStatus: '', submitting: false,
});

const emit = defineEmits<{
  (e: 'update:action', v: ReviewActionKey | ''): void;
  (e: 'update:opinion', v: string): void;
  (e: 'update:overrideLevel', v: string): void;
  (e: 'submit'): void;
  (e: 'advance'): void;
  (e: 'view-report'): void;
}>();

const levelHint = computed(() => GRADE_LEVELS.find((l) => l.value === props.overrideLevel)?.hint ?? '');
const toneIcon: Record<string, string> = { confirm: 'check', revise: 'design', reject: 'alert' };

function pick(key: ReviewActionKey) {
  if (!props.awaiting || props.submitting) return;
  emit('update:action', key);
}

/** 落定后的下一步动作：完成→看报告，终止/超时→回队列。 */
const settled = computed(() => props.phase === 'settled' || props.phase === 'timeout');
const reportReady = computed(() => props.phase === 'settled' && props.finalStatus === 'completed');
</script>

<template>
  <section class="rvw-decision">
    <header class="rvw-decision-hd">
      <h4>复核决定</h4>
      <span v-if="hasEdits" class="rvw-chip warn" title="缺陷清单已修订，提交后随决定整表上送">已修订：{{ editSummary }}</span>
      <span v-else class="rvw-chip">缺陷清单未改</span>
    </header>

    <!-- AI 预判快照：同意即沿用此结论 -->
    <div class="rvw-ai-grade">
      <GradeStamp v-if="grade" :level="grade.level" size="sm" subtitle="AI 自动判级 · 待人工确认" />
      <p class="rvw-ai-summary">{{ grade?.summary || '后端未返回判级摘要' }}</p>
    </div>

    <!-- 已复核留痕 -->
    <div v-if="decided" class="rvw-decided">
      <IconSvg name="check" />
      <div>
        <strong>
          {{ decided.verdict === 'approve' ? '已同意判级' : decided.verdict === 'revised' ? '已改判 / 修正' : '已驳回终止' }}
        </strong>
        <p>{{ decided.note || '（未填写复核意见）' }}</p>
      </div>
    </div>

    <template v-else-if="awaiting">
      <!-- 动作卡 -->
      <div class="rvw-cards" role="group" aria-label="复核动作">
        <button
          v-for="c in DECISION_CARDS"
          :key="c.key"
          type="button"
          class="rvw-card"
          :class="[`tone-${c.tone}`, { on: action === c.key }]"
          :disabled="submitting"
          @click="pick(c.key)"
        >
          <span class="rvw-card-ico"><IconSvg :name="toneIcon[c.key] || 'inspect'" /></span>
          <strong>{{ c.label }}</strong>
          <small>{{ c.desc }}</small>
        </button>
      </div>

      <!-- 改判条件表单 -->
      <div v-if="action === 'revise'" class="rvw-override">
        <label class="rvw-label" for="rvw-level">人工终裁判级</label>
        <select
          id="rvw-level"
          class="rvw-sel wide"
          :value="overrideLevel"
          :disabled="submitting"
          @change="emit('update:overrideLevel', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="l in GRADE_LEVELS" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
        <p class="rvw-hint">{{ levelHint }}</p>
        <p class="rvw-warn">
          缺陷修订不会自动重算判级：补漏检 / 排除误检后，请在此确认最终判级结论并随决定一并上送。
        </p>
        <p v-if="!hasEdits" class="rvw-hint muted">当前仅覆盖判级结论，缺陷清单按原样上送。</p>
      </div>

      <!-- 驳回语义提示 -->
      <p v-else-if="action === 'reject'" class="rvw-warn">
        驳回将终止该任务并记为失败（不是退回重排队）；如需重新检测，请在任务列表重新提交。
      </p>

      <!-- 复核意见 -->
      <label class="rvw-label" for="rvw-opinion">复核意见<span class="rvw-req">必填</span></label>
      <textarea
        id="rvw-opinion"
        class="rvw-textarea"
        rows="3"
        :value="opinion"
        :disabled="submitting"
        placeholder="判定依据、处置要求或数据问题描述（全程留痕，写入报告与评估矩阵）"
        @input="emit('update:opinion', ($event.target as HTMLTextAreaElement).value)"
      ></textarea>

      <p v-if="untyped > 0" class="rvw-guard">
        有 {{ untyped }} 条缺陷尚未指定缺陷类型（后端要求全量列表每条都有类型），请在缺陷列表里补齐后再提交。
      </p>
      <p v-if="error" class="rvw-error">{{ error }}</p>

      <div class="rvw-submit-row">
        <button class="rvw-btn primary" type="button" :disabled="submitting || !action" @click="emit('submit')">
          {{ submitting ? '提交中…' : '提交复核决定' }}
        </button>
        <span v-if="phaseText" class="rvw-phase" :class="phase">
          <i v-if="phase === 'submitting' || phase === 'polling'" class="rvw-spin"></i>{{ phaseText }}
        </span>
      </div>
    </template>

    <!-- 落定后的承接动作 -->
    <div v-if="!awaiting || settled" class="rvw-next">
      <button v-if="reportReady" class="rvw-btn primary" type="button" @click="emit('view-report')">查看报告 →</button>
      <button v-if="hasNext" class="rvw-btn" type="button" @click="emit('advance')">处理下一个待复核任务</button>
      <span v-else-if="!awaiting" class="rvw-hint muted">队列为空，可返回任务列表跟踪进展。</span>
    </div>
  </section>
</template>
