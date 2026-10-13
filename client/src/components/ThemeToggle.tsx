import { useTheme } from '../hooks/useTheme';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
