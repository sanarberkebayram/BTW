export function renderTemplateText(
  templateText: string,
  variables: Record<string, unknown> | null | undefined
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const rendered = templateText.replace(/{{\s*([\w-]+)\s*}}/g, (_match, key) => {
    const value = variables?.[key];
    if (value === undefined || value === null) {
      if (!missing.includes(key)) {
        missing.push(key);
      }
      return "";
    }
    return String(value);
  });
  return { text: rendered, missing };
}
