// The Orders folder is always the same share; only how each computer reaches it differs.
export type PathMode = 'mac' | 'windows' | 'custom';

export const ORDERS_PRESETS: Record<Exclude<PathMode, 'custom'>, { label: string; path: string }> = {
    mac: { label: 'Mac', path: '/Volumes/ArtisDesigns/Signs/ORDERS' },
    windows: { label: 'Windows', path: '\\\\ArtisDesignsNAS\\ArtisDesigns\\Signs\\ORDERS' },
};

export const detectPathMode = (ordersPath: string): PathMode => {
    const p = (ordersPath || '').trim();
    if (p === ORDERS_PRESETS.mac.path) return 'mac';
    if (p === ORDERS_PRESETS.windows.path) return 'windows';
    return p ? 'custom' : defaultPathMode();
};

// Pre-select the option that matches the computer it is running on.
export const defaultPathMode = (): Exclude<PathMode, 'custom'> =>
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'mac' : 'windows';

/**
 * The shared macros file lives under the share's Machines folder, beside Signs:
 * <share>/Machines/gsender/macros.json, written with the same kind of separators as the Orders
 * path (Mac and Windows differ). ORDERS is <share>/Signs/ORDERS, so go up two levels.
 */
export const sharedMacrosPath = (ordersPath: string): string => {
    const p = (ordersPath || '').trim().replace(/[\\/]+$/, '');
    const sep = p.includes('\\') ? '\\' : '/';
    const parts = p.split(sep);
    if (parts.length < 3) return '';
    const share = parts.slice(0, -2).join(sep);
    return `${share}${sep}Machines${sep}gsender${sep}macros.json`;
};
