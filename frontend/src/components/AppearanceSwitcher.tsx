import { designThemes, type DesignTheme } from '../app/appearance';
import './AppearanceSwitcher.css';

type AppearanceSwitcherProps = { value: DesignTheme; onChange: (value: DesignTheme) => void };

export default function AppearanceSwitcher({ value, onChange }: AppearanceSwitcherProps) {
  return <div className="sana-appearance" role="group" aria-label="Оформление">
    {designThemes.map(theme => <button
      key={theme.id}
      type="button"
      className={`sana-appearance-choice sana-appearance-choice--${theme.id}`}
      aria-label={`Тема ${theme.name}`}
      aria-pressed={value === theme.id}
      title={theme.description}
      onClick={() => onChange(theme.id)}
    >
      <span className="sana-appearance-swatch" aria-hidden="true" />
      <span>{theme.name}</span>
      <svg className="sana-appearance-check" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 8 2.5 2.5L12 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>)}
  </div>;
}
