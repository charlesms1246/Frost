import { browser } from '$app/environment';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'frost.theme';

function load(): Theme {
	if (!browser) return 'dark';
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored === 'light' ? 'light' : 'dark';
}

function apply(theme: Theme) {
	if (!browser) return;
	document.documentElement.classList.toggle('dark', theme === 'dark');
}

function createTheme() {
	let current = $state<Theme>(load());

	if (browser) apply(current);

	return {
		get value() {
			return current;
		},
		set(next: Theme) {
			current = next;
			localStorage.setItem(STORAGE_KEY, next);
			apply(next);
		},
		toggle() {
			this.set(current === 'dark' ? 'light' : 'dark');
		}
	};
}

export const theme = createTheme();
