<script setup lang="ts">
/** 场景歧义确认面板：复核门的 confirm_type==='scene' 分支专用。
 *  此类任务尚未派发检测工具，必须在 POST /tasks/{id}/scene-confirm 上送场景码；
 *  走 /review 接口会被后端 409 拒绝，故与判级复核面板互斥渲染。 */
import { ref } from 'vue';
import IconSvg from '@/components/IconSvg.vue';
import type { ReviewPhase } from '@/composables/use-review';

const props = withDefaults(defineProps<{
  question?: string;
  candidates: Array<{ scene: string; label: string; confidence: number | null }>;
  opinion?: string;
  awaiting?: boolean;
  submitting?: boolean;
  phase?: ReviewPhase;
  phaseText?: string;
  error?: string;
  /** 已确认留痕（review 通道的 opinion） */
  decidedNote?: string;
}>(), {
  question: '无法自动确定检测场景，请选择图像所属场景',
  opinion: '', awaiting: true, submitting: false,
  phase: 'idle', phaseText: '', error: '', decidedNote: '',
});

const emit = defineEmits<{
  (e: 'pick', scene: string): void;
  (e: 'update:opinion', v: string): void;
}>();

const picked = ref('');

function choose(scene: string) {
  if (!props.awaiting || props.submitting) return;
  picked.value = scene;
  emit('pick', scene);
}

const confPct = (c: number | null) => (c == null ? null : Math.round(c * 100));
</script>

<template>
  <section class="rvw-scene">
    <header class="rvw-scene-hd">
      <span class="rvw-scene-ico"><IconSvg name="target" /></span>
      <div>
        <h4>场景确认</h4>
        <p>{{ question }}</p>
      </div>
    </header>

    <div v-if="decidedNote" class="rvw-decided">
      <IconSvg name="check" />
      <div><strong>已确认场景</strong><p>{{ decidedNote }}</p></div>
    </div>

    <template v-else>
      <ul class="rvw-scene-list">
        <li v-for="(c, i) in candidates" :key="c.scene" class="rvw-scene-row">
          <span class="rvw-scene-idx">{{ i + 1 }}</span>
          <div class="rvw-scene-main">
            <strong>{{ c.label }}</strong>
            <small>{{ c.scene }}</small>
          </div>
          <span v-if="confPct(c.confidence) != null" class="rvw-conf">
            <i class="rvw-conf-bar"><i :style="{ width: confPct(c.confidence) + '%' }"></i></i>{{ confPct(c.confidence) }}%
          </span>
          <span v-else class="rvw-conf none">—</span>
          <button
            type="button"
            class="rvw-btn sm"
            :class="{ on: picked === c.scene }"
            :disabled="!awaiting || submitting"
            @click="choose(c.scene)"
          >{{ picked === c.scene && submitting ? '提交中…' : '按此确认' }}</button>
        </li>
      </ul>

      <p v-if="!candidates.length" class="rvw-empty">后端未返回候选场景，请回任务列表查看详情或重新提交。</p>

      <label class="rvw-label" for="rvw-scene-note">补充说明（可选）</label>
      <textarea
        id="rvw-scene-note"
        class="rvw-textarea"
        rows="2"
        :value="opinion"
        :disabled="submitting"
        placeholder="例如：该图为叶片进排气边孔探图像"
        @input="emit('update:opinion', ($event.target as HTMLTextAreaElement).value)"
      ></textarea>

      <p v-if="error" class="rvw-error">{{ error }}</p>
      <p v-if="phaseText" class="rvw-phase" :class="phase">
        <i v-if="phase === 'submitting' || phase === 'polling'" class="rvw-spin"></i>{{ phaseText }}
      </p>
      <p class="rvw-hint muted">确认后流水线按所选场景派发检测工具继续执行。</p>
    </template>
  </section>
</template>
