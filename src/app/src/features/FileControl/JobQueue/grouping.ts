export interface OrderMeta {
    material: string;
    size: string;
    color: string;
}

export interface QueueOrder {
    name: string; // what to show
    id?: string; // central tool job id; folder orders are identified by name
    files: string[];
    modified: number;
    meta: OrderMeta;
    machine?: string;
    // only from the central order tool
    platform?: string;
    shipBy?: string; // YYYY-MM-DD
    title?: string;
    personalization?: string;
}

/**
 * Only orders with at least one G-code file in their folder can be run. An order with no folder yet
 * (or an empty one) is held back until its G-code is there.
 */
export const splitRunnable = (orders: QueueOrder[]): { ready: QueueOrder[]; hidden: number } => {
    const ready = orders.filter((o) => o.files.length > 0);
    return { ready, hidden: orders.length - ready.length };
};

/** What to send the server to identify an order. */
export const orderKey = (o: QueueOrder): string => o.id ?? o.name;

// size is a sizeKey() value, or NO_SIZE_FILTER for orders that have no size set.
export const NO_SIZE_FILTER = '__none__';

export interface QueueFilters {
    material: string;
    size: string;
}

export interface SizeOption {
    key: string; // value to put in QueueFilters.size
    label: string;
    count: number;
}

export interface QueueGroup {
    key: string;
    label: string;
    orders: QueueOrder[];
}

export const NO_SIZE_KEY = '';

// "12 x 18", "12X18" and "12×18" are all the same fixture size.
export const sizeKey = (size: string): string =>
    (size || '')
        .toLowerCase()
        .replace(/[×*]/g, 'x')
        .replace(/\s+/g, '');

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const matchesSize = (o: QueueOrder, size: string): boolean => {
    if (!size) return true;
    const key = sizeKey(o.meta.size);
    return size === NO_SIZE_FILTER ? key === NO_SIZE_KEY : key === size;
};

/** One filter button per distinct size ("12x18" and "12 x 18" are one), with order counts. */
export const sizeOptions = (orders: QueueOrder[]): SizeOption[] => {
    const options = new Map<string, SizeOption>();
    orders.forEach((o) => {
        const key = sizeKey(o.meta.size);
        const filterKey = key === NO_SIZE_KEY ? NO_SIZE_FILTER : key;
        const existing = options.get(filterKey);
        if (existing) {
            existing.count += 1;
        } else {
            options.set(filterKey, { key: filterKey, label: o.meta.size || 'No size', count: 1 });
        }
    });
    return [...options.values()].sort(
        (a, b) =>
            Number(a.key === NO_SIZE_FILTER) - Number(b.key === NO_SIZE_FILTER) || natural(a.label, b.label),
    );
};

export const uniqueValues = (orders: QueueOrder[], field: keyof OrderMeta): string[] => {
    const seen = new Map<string, string>();
    orders.forEach((o) => {
        const v = o.meta[field];
        if (v && !seen.has(v.toLowerCase())) {
            seen.set(v.toLowerCase(), v);
        }
    });
    return [...seen.values()].sort(natural);
};

/**
 * Filters the queue and groups it by sign size so same-size jobs run together
 * (no fixture change between them). The group matching `preferredSize` - the
 * size last carved on this machine - is listed first. Within a group, orders
 * are sorted by material then color, keeping the queue's own order otherwise.
 */
export const groupQueue = (
    queued: QueueOrder[],
    filters: QueueFilters,
    preferredSize = '',
): QueueGroup[] => {
    const filtered = queued.filter(
        (o) =>
            (!filters.material || same(o.meta.material, filters.material)) &&
            matchesSize(o, filters.size),
    );

    const groups = new Map<string, QueueGroup>();
    filtered.forEach((order) => {
        const key = sizeKey(order.meta.size);
        if (!groups.has(key)) {
            groups.set(key, { key, label: order.meta.size || 'No size set', orders: [] });
        }
        groups.get(key)!.orders.push(order);
    });

    const preferred = sizeKey(preferredSize);
    const rank = (g: QueueGroup) => {
        if (preferred && g.key === preferred) return 0;
        return g.key === NO_SIZE_KEY ? 2 : 1;
    };

    return [...groups.values()]
        .map((g) => ({
            ...g,
            // earliest ship-by date first (orders without one last), then material and color
            orders: [...g.orders].sort(
                (a, b) =>
                    (a.shipBy || '9999').localeCompare(b.shipBy || '9999') ||
                    natural(a.meta.material, b.meta.material) ||
                    natural(a.meta.color, b.meta.color),
            ),
        }))
        .sort((a, b) => rank(a) - rank(b) || natural(a.label, b.label));
};

export type DueFilter = '' | 'past' | 'today' | 'tomorrow';

export const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'past', label: 'Past due' },
    { value: 'today', label: 'Today' },
    { value: 'tomorrow', label: 'Tomorrow' },
];

const isoDay = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Does the order's ship-by date (YYYY-MM-DD) fall in this bucket, as of `now`? Orders with no date only show under All. */
export const matchesDue = (shipBy: string | undefined, due: DueFilter, now: Date = new Date()): boolean => {
    if (!due) return true;
    if (!shipBy) return false;
    const day = shipBy.slice(0, 10);
    const today = isoDay(now);
    if (due === 'past') return day < today;
    if (due === 'today') return day === today;
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return day === isoDay(tomorrow);
};

export const filterByDue = (orders: QueueOrder[], due: DueFilter, now: Date = new Date()): QueueOrder[] =>
    due ? orders.filter((o) => matchesDue(o.shipBy, due, now)) : orders;
