/** HTML 转义(用于把用户输入嵌入弹窗富文本) */
export const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** 把任意对象导出为 JSON 文件(需求草稿) */
export function exportJsonDraft(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文件大小显示(KB,保留 1 位小数) */
export const formatSizeKB = (size: number) => (size / 1024).toFixed(1) + ' KB';
