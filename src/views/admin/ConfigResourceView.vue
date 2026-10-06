<script setup lang="ts">
/** 外部资源配置注册页（基模 / RAGFlow / MinIO 通用）：由路由 meta.kind 选择描述符，
 *  描述符驱动表格列与注册弹窗表单；密钥字段后端返回掩码，编辑留空即不改动。 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import { setTheme, useTheme } from '@/composables/use-theme';
import {
  DESCRIPTORS, listResources, saveResource,
  setResourceStatus, setResourceDefault, deleteResource,
  type ConfigRow, type ResourceKind, type FieldDef, type ConfigStatus,
} from '@/api/config-resources';

const route = useRoute();
const theme = useTheme();
const dark = computed(() => theme.value === 'dark');
setTheme(route.query.theme === 'dark' ? 'dark' : 'light');

const kind = computed(() => (route.meta.kind as ResourceKind) || 'ragflow');
const desc = computed(() => DESCRIPTORS[kind.value]);

const list = ref<ConfigRow[]>([]);
const loading = ref(false);
const keyword = ref('');

const allColumns = computed(() => [
  ...desc.value.columns,
  { title: '操作', key: '__action', width: 220, fixed: 'right' as const },
]);

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return list.value;
  return list.value.filter((r) => JSON.stringify(r).toLowerCase().includes(kw));
});

async function reload() {
  loading.value = true;
  try {
    list.value = await listResources(kind.value);
  } catch (e: any) {
    message.error(e?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}
// 切换资源类型时由路由 meta.kind 变化触发重新加载
onMounted(reload);
watch(kind, reload);

/* ---------------- 注册 / 编辑弹窗 ---------------- */
const modalOpen = ref(false);
const editing = ref(false);
const submitting = ref(false);
const form = reactive<ConfigRow>(desc.value.defaults());

function pkValue(row: ConfigRow): string {
  return String(row[desc.value.pk] ?? '');
}
function mainLabel(row: ConfigRow): string {
  return String(row.display_name || row.name || pkValue(row));
}

function openCreate() {
  editing.value = false;
  Object.keys(form).forEach((k) => delete form[k]);
  Object.assign(form, desc.value.defaults());
  modalOpen.value = true;
}
function openEdit(record: ConfigRow) {
  editing.value = true;
  Object.keys(form).forEach((k) => delete form[k]);
  Object.assign(form, record);
  modalOpen.value = true;
}

async function submit() {
  const d = desc.value;
  if (!pkValue(form).trim()) {
    message.warning(`${d.fields.find((f) => f.isPk)?.label || 'ID'} 为必填`);
    return;
  }
  const missing = d.fields.find((f) => f.required && !f.isPk && !String(form[f.key] ?? '').trim());
  if (missing) {
    message.warning(`${missing.label} 为必填`);
    return;
  }
  submitting.value = true;
  try {
    await saveResource(kind.value, { ...form }, editing.value);
    message.success(editing.value ? '已更新' : '已注册');
    modalOpen.value = false;
    await reload();
  } catch (e: any) {
    message.error(e?.message || '保存失败');
  } finally {
    submitting.value = false;
  }
}

/* ---------------- 启停 / 默认 / 删除 ---------------- */
async function onToggleStatus(record: ConfigRow, checked: boolean) {
  const next: ConfigStatus = checked ? 'enabled' : 'disabled';
  try {
    await setResourceStatus(kind.value, pkValue(record), next);
    record.status = next;
    message.success(`已${next === 'enabled' ? '启用' : '停用'}`);
  } catch (e: any) {
    message.error(e?.message || '操作失败');
  }
}

async function onSetDefault(record: ConfigRow) {
  try {
    await setResourceDefault(kind.value, pkValue(record));
    message.success('已设为生效配置');
    await reload();
  } catch (e: any) {
    message.error(e?.message || '操作失败');
  }
}

function onDelete(record: ConfigRow) {
  const id = pkValue(record);
  Modal.confirm({
    title: '删除配置',
    content: `确认删除「${mainLabel(record)}」(${id})？此操作不可恢复。`,
    okText: '删除', okType: 'danger', cancelText: '取消',
    async onOk() {
      try {
        await deleteResource(kind.value, id);
        message.success('已删除');
        await reload();
      } catch (e: any) {
        message.error(e?.message || '删除失败');
      }
    },
  });
}

const isSelect = (f: FieldDef) => f.input === 'select';
const isNumber = (f: FieldDef) => f.input === 'number';
const isSwitch = (f: FieldDef) => f.input === 'switch';
const isTextarea = (f: FieldDef) => f.input === 'textarea';
</script>

<template>
  <div class="cfgres-page" :class="{ dark }">
    <header class="cfgres-head">
      <div>
        <h2 class="cfgres-title">{{ desc.title }}</h2>
        <p class="cfgres-sub">{{ desc.subtitle }}</p>
      </div>
      <div class="cfgres-actions">
        <a-input v-model:value="keyword" size="small" style="width: 200px" placeholder="搜索关键字" allow-clear />
        <a-button @click="reload" :loading="loading">刷新</a-button>
        <a-button type="primary" @click="openCreate">{{ desc.createText }}</a-button>
      </div>
    </header>

    <a-table
      :data-source="filtered"
      :columns="allColumns"
      :loading="loading"
      :pagination="{ pageSize: 15, showSizeChanger: false }"
      :scroll="{ x: 960 }"
      :row-key="(r: ConfigRow) => pkValue(r)"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === '__action'">
          <a-space :size="4">
            <a-switch
              :checked="(record as ConfigRow).status === 'enabled'"
              size="small" checked-children="启" un-checked-children="停"
              @update:checked="(v: boolean) => onToggleStatus(record as ConfigRow, v)"
            />
            <a-button size="small" type="link" @click="openEdit(record as ConfigRow)">编辑</a-button>
            <a-button size="small" type="link" danger @click="onDelete(record as ConfigRow)">删除</a-button>
          </a-space>
        </template>
        <template v-else-if="column.render === 'id'">
          <div class="cfgres-name">{{ mainLabel(record as ConfigRow) }}</div>
          <code class="cfgres-id">{{ pkValue(record as ConfigRow) }}</code>
        </template>
        <template v-else-if="column.render === 'secret'">
          <code class="cfgres-secret">{{ record[column.key] || '—' }}</code>
        </template>
        <template v-else-if="column.render === 'status'">
          <a-tag :color="record[column.key] === 'enabled' ? 'green' : 'default'">
            {{ record[column.key] === 'enabled' ? '启用' : '停用' }}
          </a-tag>
        </template>
        <template v-else-if="column.render === 'default'">
          <a-tag v-if="record.is_default" color="blue">生效</a-tag>
          <a-button v-else size="small" type="link" @click="onSetDefault(record as ConfigRow)">设为默认</a-button>
        </template>
        <template v-else>
          <span :class="{ 'cfgres-code': column.key === 'endpoint' || column.key === 'base_url' }">
            {{ column.labelMap ? (column.labelMap[record[column.key]] ?? record[column.key]) : (record[column.key] || '—') }}
          </span>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="modalOpen"
      :title="editing ? `编辑${desc.title}` : desc.createText.replace('+ ', '')"
      :confirm-loading="submitting" ok-text="保存" cancel-text="取消" width="640px"
      @ok="submit"
    >
      <a-form layout="vertical" class="cfgres-form">
        <a-row :gutter="16">
          <a-col :span="12" v-for="f in desc.fields" :key="f.key">
            <a-form-item :label="f.label" :required="f.required">
              <a-select
                v-if="isSelect(f)" v-model:value="form[f.key]"
                :options="(f.options as any)" :disabled="editing && f.isPk"
              />
              <a-input-number
                v-else-if="isNumber(f)" v-model:value="form[f.key] as number"
                style="width: 100%" :placeholder="f.placeholder"
              />
              <a-switch
                v-else-if="isSwitch(f)"
                :checked="Boolean(form[f.key])"
                @update:checked="(v: boolean) => (form[f.key] = v)"
              />
              <a-textarea
                v-else-if="isTextarea(f)" v-model:value="form[f.key] as string"
                :rows="2" :placeholder="f.placeholder"
              />
              <a-input
                v-else v-model:value="form[f.key] as string"
                :disabled="editing && f.isPk" :placeholder="f.placeholder"
                :type="f.input === 'secret' ? 'password' : 'text'"
              />
              <div v-if="f.hint" class="cfgres-hint">{{ f.hint }}</div>
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.cfgres-page { max-width: 1280px; margin: 0 auto; padding: 24px; color: #1f2733; }
.cfgres-page.dark { color: #e6ecf5; }
.cfgres-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.cfgres-title { margin: 0; font-size: 20px; font-weight: 700; }
.cfgres-sub { margin: 4px 0 0; font-size: 13px; opacity: .7; }
.cfgres-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cfgres-name { font-weight: 600; }
.cfgres-id, .cfgres-secret, .cfgres-code { font-size: 12px; opacity: .7; }
.cfgres-hint { font-size: 12px; opacity: .55; margin-top: 2px; }
.cfgres-form :deep(.ant-form-item) { margin-bottom: 12px; }
</style>
