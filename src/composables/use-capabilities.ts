/** 能力中心 · 专业能力数据源（注册表驱动 + 展示预设合并 + 本地兜底）
 *  列表来自 vision-agent GET /api/v1/capabilities（capability-registry.ts 封装），
 *  每条按 scene 合并 capability-presets 的展示字段（图标/配色/输入输出/流程/提示词）；
 *  后端缺席或该单元为 mock 时，回退到本地预设全量，保证页面不空白。 */
import { computed, reactive } from 'vue';
import { listCapabilities, type Capability } from '@/api/capability-registry';
import { isLive } from '@/api/source-registry';
import { sceneCodeToCapabilityId } from '@/data/scene-map';
import { capabilityPresets, fallbackPreset } from '@/data/capability-presets';
import type { ProfessionalCapability } from '@/data/types';

/** 生命周期阶段排序权重（未识别阶段沉到底，scene 保证稳定次序）。 */
const PHASE_ORDER: Record<string, number> = {
  design: 0, manufacturing: 1, assembly: 2, testing: 3,
  in_service: 4, maintenance: 5, retirement: 6,
};

const store = reactive({
  items: [] as ProfessionalCapability[],
  loading: false,
  error: '' as string,
});

/** 注册表单条 + 展示预设 → 卡片模型。 */
function merge(cap: Capability): ProfessionalCapability {
  const scene = cap.scene ?? '';
  const preset = capabilityPresets[scene] ?? fallbackPreset(scene, cap.lifecycle_phase);
  return {
    id: sceneCodeToCapabilityId(scene) || preset.id,
    name: cap.name || preset.name,
    icon: preset.icon,
    desc: cap.description || preset.desc,
    domains: preset.domains,
    color: preset.color,
    bg: preset.bg,
    input: preset.input,
    result: preset.result,
    flow: preset.flow,
    prompt: preset.prompt,
    image: preset.image,
    scene,
    capability_id: cap.capability_id,
    status: cap.status,
    lifecycle_phase: cap.lifecycle_phase,
    capability_type: cap.capability_type,
    adapter_type: cap.adapter_type,
    endpoint: cap.endpoint,
    tool_name: cap.tool_name,
  };
}

/** 回退：按本地预设全量生成（等价静态六项 + weld/assembly）。 */
function presetFallback(): ProfessionalCapability[] {
  return Object.entries(capabilityPresets).map(([scene, p]) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    desc: p.desc,
    domains: p.domains,
    color: p.color,
    bg: p.bg,
    input: p.input,
    result: p.result,
    flow: p.flow,
    prompt: p.prompt,
    image: p.image,
    scene,
  }));
}

/** 取数：真实优先，失败/开发期回退本地预设。 */
export async function refreshCapabilities(): Promise<void> {
  store.loading = true;
  store.error = '';
  try {
    if (isLive('capabilities')) {
      const caps = await listCapabilities();
      store.items = caps
        .map(merge)
        .sort((a, b) => {
          const pa = PHASE_ORDER[a.lifecycle_phase ?? ''] ?? 99;
          const pb = PHASE_ORDER[b.lifecycle_phase ?? ''] ?? 99;
          if (pa !== pb) return pa - pb;
          return (a.scene ?? '').localeCompare(b.scene ?? '');
        });
    } else {
      store.items = presetFallback();
    }
  } catch (e: any) {
    store.error = e?.message || '能力列表加载失败';
    // 后端不可达：回退本地预设，页面不空白
    store.items = presetFallback();
  }
  store.loading = false;
}

/* ================= 派生视图数据 ================= */
export const professionalCapabilities = computed<ProfessionalCapability[]>(() => store.items);
export const capsLoading = computed(() => store.loading);
export const capsError = computed(() => store.error);
export const capsLive = computed(() => isLive('capabilities'));
