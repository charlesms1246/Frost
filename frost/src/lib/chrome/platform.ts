import { browser } from '$app/environment';

export const isMacOS = browser && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
