import { ref, type Ref } from 'vue';

export interface UseFilePickerOptions {
  /** 选择完成回调：added=本次真正新增的文件，chosenCount=本次选中的文件总数（用于 toast）。 */
  onAdded?: (added: File[], chosenCount: number) => void;
}

/**
 * 隐藏的 <input type=file> + 去重增删的通用逻辑，供首页与智能检测页的 composer 复用。
 * 传入一个 File[] 的 ref（全局 store 或组件局部均可），返回绑定模板所需的句柄。
 * 去重按 name + size + lastModified。
 */
export function useFilePicker(files: Ref<File[]>, options: UseFilePickerOptions = {}) {
  const inputEl = ref<HTMLInputElement | null>(null);

  /** 唤起原生文件选择框。注意：若在 a-dropdown 菜单项里调用，需先手动关闭菜单再 open()。 */
  function open() {
    inputEl.value?.click();
  }

  function onChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const chosen = Array.from(input.files ?? []);
    const added: File[] = [];
    for (const f of chosen) {
      if (!files.value.some((a) => a.name === f.name && a.size === f.size && a.lastModified === f.lastModified)) {
        files.value.push(f);
        added.push(f);
      }
    }
    input.value = ''; // 允许再次选择同一文件仍触发 change
    options.onAdded?.(added, chosen.length);
  }

  function removeAt(index: number) {
    files.value.splice(index, 1);
  }

  function clear() {
    files.value.splice(0);
  }

  return { inputEl, open, onChosen, removeAt, clear };
}
