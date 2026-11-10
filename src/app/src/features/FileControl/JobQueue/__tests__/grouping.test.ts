import { filterByDue, groupQueue, sizeKey, sizeOptions, splitRunnable, uniqueValues, NO_SIZE_FILTER, QueueOrder } from '../grouping';

const order = (name: string, material = '', size = '', color = ''): QueueOrder => ({
    name,
    files: ['a.nc'],
    modified: 0,
    meta: { material, size, color },
});

describe('job queue grouping', () => {
    const queue = [
        order('1', 'Wood', '12x18', 'Black'),
        order('2', 'PVC', '24x36', 'White'),
        order('3', 'PVC', '12 x 18', 'Black'),
        order('4'),
        order('5', 'Wood', '24x36', 'Red'),
    ];

    it('treats spacing and the multiplication sign as the same size', () => {
        expect(sizeKey('12 x 18')).toBe(sizeKey('12×18'));
        expect(sizeKey('12X18')).toBe('12x18');
    });

    it('groups by size with unsized orders last', () => {
        const groups = groupQueue(queue, { material: '', size: '' });
        expect(groups.map((g) => g.orders.map((o) => o.name))).toEqual([['3', '1'], ['2', '5'], ['4']]);
        expect(groups[groups.length - 1].label).toBe('No size set');
    });

    it('lists the size last carved first', () => {
        const groups = groupQueue(queue, { material: '', size: '' }, '24 x 36');
        expect(groups[0].key).toBe('24x36');
    });

    it('filters by material, ignoring case', () => {
        const groups = groupQueue(queue, { material: 'pvc', size: '' });
        expect(groups.flatMap((g) => g.orders.map((o) => o.name)).sort()).toEqual(['2', '3']);
        expect(groupQueue(queue, { material: 'glass', size: '' })).toEqual([]);
    });

    it('filters by size, treating spacing variants as one size', () => {
        const names = (size: string) =>
            groupQueue(queue, { material: '', size }).flatMap((g) => g.orders.map((o) => o.name)).sort();
        expect(names(sizeKey('12x18'))).toEqual(['1', '3']);
        expect(names(sizeKey('12 x 18'))).toEqual(['1', '3']);
        expect(names(NO_SIZE_FILTER)).toEqual(['4']);
        expect(groupQueue(queue, { material: 'wood', size: sizeKey('12x18') })[0].orders.map((o) => o.name)).toEqual(['1']);
    });

    it('builds one size button per size with counts, no-size last', () => {
        expect(sizeOptions(queue)).toEqual([
            { key: '12x18', label: '12x18', count: 2 },
            { key: '24x36', label: '24x36', count: 2 },
            { key: NO_SIZE_FILTER, label: 'No size', count: 1 },
        ]);
    });

    it('lists each material/color once for the filter chips', () => {
        expect(uniqueValues(queue, 'material')).toEqual(['PVC', 'Wood']);
        expect(uniqueValues(queue, 'color')).toEqual(['Black', 'Red', 'White']);
    });

    it('holds back orders that have no G-code in their folder', () => {
        const noFolder: QueueOrder = { ...order('6', 'PVC', '12x18'), files: [] };
        const { ready, hidden } = splitRunnable([...queue, noFolder]);
        expect(hidden).toBe(1);
        expect(ready.map((o) => o.name)).toEqual(['1', '2', '3', '4', '5']);
    });
});

describe('due date filter', () => {
    const now = new Date(2026, 10, 9, 15, 0); // Nov 9, 2026
    const due = (name: string, shipBy?: string): QueueOrder => ({ ...order(name), shipBy });
    const q = [due('late', '2026-11-07'), due('today', '2026-11-09'), due('soon', '2026-11-10'), due('later', '2026-11-20'), due('none')];
    const names = (f: Parameters<typeof filterByDue>[1]) => filterByDue(q, f, now).map((o) => o.name);

    it('splits past due, today and tomorrow', () => {
        expect(names('past')).toEqual(['late']);
        expect(names('today')).toEqual(['today']);
        expect(names('tomorrow')).toEqual(['soon']);
    });
    it('All keeps everything, including orders with no date', () => {
        expect(names('')).toHaveLength(5);
    });
    it('rolls over month ends', () => {
        const eom = new Date(2026, 10, 30);
        expect(filterByDue([due('a', '2026-12-01')], 'tomorrow', eom)).toHaveLength(1);
    });
});
