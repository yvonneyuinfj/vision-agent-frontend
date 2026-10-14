<script setup lang="ts">
/** 缺陷修订列表：草稿条目的改类 / 改严重度 / 排除误检 / 删除人工项。
 *  操作语义与后端 human_review 契约一一对应：
 *  - 排除 = 判为误检，条目保留并打 human_rejected（报告并入虚假显示口径）；
 *  - 模型条目不可硬删（审计留痕），只有人工新增条目可删；
 *  - 改类 / 改严重度自动落 revised 原值快照，供报告修订叙述与评估矩阵。 */
import { computed } from 'vue';
import type { QaClassDef, QaDefectItem } from '@/api/tasks';
import { NEW_DEFECT_TYPE, SEVERITY_COLORS, countUntyped, isUntyped } from '@/utils/defect';
import { SEVERITY_OPTIONS } from '@/composables/use-review';

/** datalist id 全局唯一（同页多实例不互串） */
let uidSeq = 0;
const listId = `rvw-type-list-${(uidSeq += 1)}`;

const props = withDefaults(defineProps<{
  rows: QaDefectItem[];
  activeId?: string;
  classDefs?: QaClassDef[];
  tool?: 'select' | 'add';
  readonly?: boolean;
  /** 是否可画框（有真实图像时才可） */
  canDraw?: boolean;
}>(), { activeId: '', classDefs: () => [], tool: 'select', readonly: false, canDraw: true });

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'patch', id: string, patch: Partial<Pick<QaDefectItem, 'defect_type' | 'defect_name_cn' | 'severity'>>): void;
  (e: 'toggle-reject', id: string): void;
  (e: 'remove', id: string): void;
  (e: 'set-tool', tool: 'select' | 'add'): void;
}>();

const typeOptions = computed<string[]>(() => {
  const names: string[] = [];
  for (const c of props.classDefs) {
    const n = String(c.class_name ?? '');
    if (n && !names.includes(n)) names.push(n);
  }
  for (const d of props.rows) {
    if (d.defect_type && d.defect_type !== NEW_DEFECT_TYPE && !names.includes(d.defect_type)) names.push(d.defect_type);
  }
  return names;
});

function typeLabel(t: string): string {
  const def = props.classDefs.find((c) => String(c.class_name ?? '') === t);
  const desc = def?.description ? String(def.description) : '';
  return desc ? `${t}（${desc}）` : t;
}

/** 类别定义表若声明「非真缺陷」，改类时给出提示色（is_true_defect=false） */
function isNotTrueDefect(t: string): boolean {
  const def = props.classDefs.find((c) => String(c.class_name ?? '') === t);
  return def?.is_true_defect === false;
}

function confPct(d: QaDefectItem): number | null {
  return typeof d.confidence === 'number' ? Math.round(d.confidence * 100) : null;
}

/** 改判严重度：空串代表「未分级」（后端 severity 允许 null，不伪造等级） */
function patchSeverity(id: string, value: string): void {
  emit('patch', id, { severity: (value || null) as QaDefectItem['severity'] });
}

/** 改类：同步中文名（能查到类别定义表时取描述，人工新增固定「人工补框」）。
 *  候选下拉 = class_definitions ∪ 存量类型；工具自报类别为空时仍能手输真实类别（避免人工补框无类可选的死路）。 */
function patchType(id: string, value: string): void {
  const t = value.trim();
  const target = props.rows.find((d) => keyOf(d, props.rows.indexOf(d)) === id);
  const def = props.classDefs.find((c) => String(c.class_name ?? '') === t);
  emit('patch', id, {
    defect_type: t,
    defect_name_cn: def?.description ? String(def.description) : (target?.source === 'manual' ? '人工补框' : (target?.defect_name_cn ?? '')),
  });
}

const untyped = computed(() => countUntyped(props.rows));

function sourceTag(d: QaDefectItem): { text: string; tone: string } | null {
  if (d.source === 'manual') return { text: '人工', tone: 'manual' };
  if (d.source === 'agent_visual') return { text: '智能体', tone: 'agent' };
  if (d.revised && Object.keys(d.revised).length) return { text: '已修订', tone: 'revised' };
  return null;
}

const keyOf = (d: QaDefectItem, _i: number) => d.defect_id || `__idx_${props.rows.indexOf(d)}`;
const sevColor = (d: QaDefectItem) => (d.human_rejected ? '#9aa0a6' : SEVERITY_COLORS[d.severity ?? 'low'] ?? '#6ba3ff');

const kept = computed(() => props.rows.filter((d) => !d.human_rejected).length);
</script>

<template>
  <section class="rvw-defects">
    <header class="rvw-defects-hd">
      <h4>缺陷修订 <span class="rvw-count">{{ kept }}/{{ rows.length }}</span></h4>
      <span class="rvw-grow"></span>
      <button
        v-if="!readonly"
        type="button"
        class="rvw-btn sm"
        :class="{ on: tool === 'add' }"
        :disabled="!canDraw"
        :title="canDraw ? '在图像上拖拽补一个漏检框' : '无可用图像，暂不能画框'"
        @click="emit('set-tool', tool === 'add' ? 'select' : 'add')"
      >{{ tool === 'add' ? '画框中：图上拖拽…' : '＋ 新增漏检框' }}</button>
    </header>

    <p v-if="untyped" class="rvw-guard">有 {{ untyped }} 条未指定缺陷类型（后端要求全量列表每条都有类型，否则整单拒收）。</p>
    <p v-if="rows.length === 0" class="rvw-empty">无检出条目{{ readonly ? '' : '；可点「新增漏检框」在图上补登漏检' }}。</p>

    <ul v-else class="rvw-defect-list">
      <li
        v-for="(d, i) in rows"
        :key="keyOf(d, i)"
        class="rvw-defect-row"
        :class="{ on: keyOf(d, i) === activeId, off: !!d.human_rejected }"
        @click="emit('select', keyOf(d, i))"
      >
        <span class="rvw-defect-id" :style="{ borderColor: sevColor(d), color: sevColor(d) }">A{{ i + 1 }}</span>

        <div class="rvw-defect-main">
          <input
            v-if="!readonly && !d.human_rejected"
            class="rvw-inp"
            :class="{ 'is-fake': isNotTrueDefect(d.defect_type), 'is-untyped': isUntyped(d) }"
            :list="listId"
            :value="d.defect_type === NEW_DEFECT_TYPE ? '' : (d.defect_type || '')"
            :aria-label="`缺陷类型 A${i + 1}`"
            placeholder="缺陷类型（可输可选）"
            @click.stop
            @change="patchType(keyOf(d, i), ($event.target as HTMLInputElement).value)"
          />
          <b v-else>{{ d.defect_name_cn || d.defect_type || '未命名缺陷' }}</b>

          <small class="rvw-defect-loc">
            <template v-if="d.location?.bbox">框 ({{ Math.round(d.location.bbox[0]) }}, {{ Math.round(d.location.bbox[1]) }})</template>
            <template v-else-if="d.image_name">{{ d.image_name }}</template>
            <template v-else-if="d.description">{{ d.description }}</template>
            <template v-else>未定位</template>
          </small>
        </div>

        <span v-if="confPct(d) != null" class="rvw-conf">
          <i class="rvw-conf-bar"><i :style="{ width: confPct(d) + '%' }"></i></i>{{ confPct(d) }}%
        </span>
        <span v-else class="rvw-conf none">—</span>

        <select
          v-if="!readonly && !d.human_rejected"
          class="rvw-sel sev"
          :value="d.severity ?? ''"
          :aria-label="`严重度 A${i + 1}`"
          @click.stop
          @change="patchSeverity(keyOf(d, i), ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="s in SEVERITY_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>

        <span v-if="sourceTag(d)" class="rvw-tag" :class="sourceTag(d)!.tone">{{ sourceTag(d)!.text }}</span>

        <div v-if="!readonly" class="rvw-defect-acts" @click.stop>
          <button type="button" class="rvw-btn tiny" @click="emit('toggle-reject', keyOf(d, i))">{{ d.human_rejected ? '恢复' : '排除' }}</button>
          <button v-if="d.source === 'manual'" type="button" class="rvw-btn tiny danger" @click="emit('remove', keyOf(d, i))">删除</button>
        </div>
      </li>
    </ul>

    <datalist :id="listId">
      <option v-for="t in typeOptions" :key="t" :value="t">{{ typeLabel(t) }}</option>
    </datalist>

    <p v-if="!readonly" class="rvw-defect-hint">
      排除 = 判定误检（条目保留供审计，报告并入虚假显示口径）；模型条目不可删除，仅可排除。修订需选「改判 / 修正」并填写复核意见后提交生效。
    </p>
  </section>
</template>
