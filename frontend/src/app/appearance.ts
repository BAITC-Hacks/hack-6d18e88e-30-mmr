export type DesignTheme = 'signal' | 'atelier' | 'index';

export const DESIGN_STORAGE_KEY = 'ai-sana-design';
export const designThemes: ReadonlyArray<{ id: DesignTheme; name: string; description: string }> = [
  { id: 'signal', name: 'Signal', description: 'Лаймовый свет и выразительная типографика' },
  { id: 'atelier', name: 'Atelier', description: 'Тёплые оттенки и редакционная типографика' },
  { id: 'index', name: 'Index', description: 'Синий акцент и чёткие формы' },
];

export function normalizeDesign(value: string | null): DesignTheme {
  return value === 'atelier' || value === 'index' ? value : 'signal';
}

export function savedDesign(): DesignTheme {
  try {
    return normalizeDesign(window.localStorage.getItem(DESIGN_STORAGE_KEY));
  } catch {
    return 'signal';
  }
}
