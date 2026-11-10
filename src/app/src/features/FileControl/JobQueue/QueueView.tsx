import { useEffect, useMemo, useState } from 'react';
import cx from 'classnames';
import { FiEdit2 } from 'react-icons/fi';
import { LiaFileUploadSolid } from 'react-icons/lia';

import { toast } from 'app/lib/toaster';

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from 'app/components/shadcn/AlertDialog';

import {
    DUE_OPTIONS,
    DueFilter,
    filterByDue,
    groupQueue,
    orderKey,
    sizeKey,
    sizeOptions,
    uniqueValues,
    OrderMeta,
    QueueFilters,
    QueueOrder,
} from './grouping';

const MATERIAL_PRESETS = ['Wood', 'PVC'];

// Only draw a swatch when the browser understands the color name.
const swatch = (color: string) =>
    color && typeof CSS !== 'undefined' && CSS.supports?.('color', color) ? color : '';

const materialClass = (material: string) => {
    const m = material.toLowerCase();
    if (m === 'wood') return 'bg-amber-200 text-amber-900';
    if (m === 'pvc') return 'bg-sky-200 text-sky-900';
    return 'bg-gray-200 text-gray-800';
};

interface ChipProps {
    label: string;
    active?: boolean;
    large: boolean;
    prominent?: boolean; // the size buttons are the main filter, so they are bigger
    highlight?: boolean; // outline to point out a suggested choice
    onClick: () => void;
}

// A touch-sized toggle used for filters and quick picks.
function Chip({ label, active, large, prominent, highlight, onClick }: ChipProps) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cx(
                'shrink-0 rounded-full border font-medium whitespace-nowrap',
                prominent ? 'min-h-16 px-7 text-2xl' : large ? 'min-h-14 px-6 text-xl' : 'min-h-11 px-4 text-base',
                active
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : cx(
                          'bg-white dark:bg-dark text-gray-700 dark:text-gray-200',
                          highlight ? 'border-green-600 border-2' : 'border-gray-300 dark:border-dark-lighter',
                      ),
            )}
        >
            {label}
        </button>
    );
}

// "2026-11-10" -> "Nov 10" without time-zone surprises
const shipByLabel = (iso: string): string => {
    const [y, m, d] = iso.split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : iso;
};

const platformLabel = (p?: string) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : '');

export function MetaTags({ meta, large, platform }: { meta: OrderMeta; large: boolean; platform?: string }) {
    const dot = swatch(meta.color);
    const pill = cx('rounded-full', large ? 'px-3 py-1 text-base' : 'px-2 py-0.5 text-sm');
    return (
        <span className="flex flex-wrap gap-1.5">
            {platform && <span className={cx(pill, 'bg-violet-100 text-violet-900')}>{platformLabel(platform)}</span>}
            {meta.material && <span className={cx(pill, materialClass(meta.material))}>{meta.material}</span>}
            {meta.size && <span className={cx(pill, 'bg-gray-200 text-gray-800')}>{meta.size}</span>}
            {meta.color && (
                <span className={cx(pill, 'bg-gray-100 text-gray-800 flex items-center gap-1.5')}>
                    {dot && (
                        <span
                            className="inline-block w-3.5 h-3.5 rounded-full border border-gray-400"
                            style={{ backgroundColor: dot }}
                        />
                    )}
                    {meta.color}
                </span>
            )}
        </span>
    );
}

interface EditorProps {
    order: QueueOrder;
    sizes: string[];
    colors: string[];
    large: boolean;
    busy: boolean;
    onSave: (meta: OrderMeta) => void;
    onCancel: () => void;
}

function OrderEditor({ order, sizes, colors, large, busy, onSave, onCancel }: EditorProps) {
    const [meta, setMeta] = useState<OrderMeta>(order.meta);
    const set = (key: keyof OrderMeta, value: string) => setMeta((m) => ({ ...m, [key]: value }));
    const input = cx(
        'w-full rounded border border-gray-300 dark:border-dark-lighter bg-white dark:bg-dark dark:text-white',
        large ? 'px-3 py-3 text-xl' : 'px-2 py-2 text-base',
    );
    const row = 'flex flex-wrap gap-2 items-center';

    return (
        <div className="flex flex-col gap-3 py-3 dark:text-white">
            <div className="font-semibold truncate">{order.name}</div>

            <div className={row}>
                <span className="w-16 shrink-0">Material</span>
                {MATERIAL_PRESETS.map((m) => (
                    <Chip
                        key={m}
                        label={m}
                        large={large}
                        active={meta.material.toLowerCase() === m.toLowerCase()}
                        onClick={() => set('material', m)}
                    />
                ))}
                <input
                    className={cx(input, 'flex-1 min-w-32')}
                    value={meta.material}
                    placeholder="Other material"
                    aria-label="Material"
                    onChange={(e) => set('material', e.target.value)}
                />
            </div>

            <div className={row}>
                <span className="w-16 shrink-0">Size</span>
                {sizes.slice(0, 6).map((s) => (
                    <Chip
                        key={s}
                        label={s}
                        large={large}
                        active={sizeKey(meta.size) === sizeKey(s)}
                        onClick={() => set('size', s)}
                    />
                ))}
                <input
                    className={cx(input, 'flex-1 min-w-32')}
                    value={meta.size}
                    placeholder="e.g. 12x18"
                    aria-label="Size"
                    onChange={(e) => set('size', e.target.value)}
                />
            </div>

            <div className={row}>
                <span className="w-16 shrink-0">Color</span>
                {colors.slice(0, 6).map((c) => (
                    <Chip
                        key={c}
                        label={c}
                        large={large}
                        active={meta.color.toLowerCase() === c.toLowerCase()}
                        onClick={() => set('color', c)}
                    />
                ))}
                <input
                    className={cx(input, 'flex-1 min-w-32')}
                    value={meta.color}
                    placeholder="e.g. Black"
                    aria-label="Color"
                    onChange={(e) => set('color', e.target.value)}
                />
            </div>

            <div className="flex gap-3">
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSave(meta)}
                    className="flex-1 min-h-14 rounded bg-blue-500 text-white text-xl font-medium disabled:opacity-50"
                >
                    Save
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="flex-1 min-h-14 rounded border border-gray-300 dark:border-dark-lighter text-xl font-medium"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

export interface QueueViewProps {
    queued: QueueOrder[];
    current?: QueueOrder;
    others: QueueOrder[];
    busy: boolean;
    isRunning: boolean;
    large: boolean;
    preferredSize: string;
    onLoad: (order: QueueOrder, file: string) => void;
    onMoveCurrent: (action: 'complete' | 'release', order: QueueOrder) => void;
    onSaveMeta: (order: QueueOrder, meta: OrderMeta) => Promise<boolean>;
    // false when the central order tool supplies material / size / color
    canEditTags?: boolean;
    // notices from the order tool, e.g. "etsy: could not load open orders"
    warnings?: string[];
    // orders not listed because their folder has no G-code yet
    hiddenCount?: number;
    // the small inline panel: only the job running on this machine, with its buttons
    currentOnly?: boolean;
    onOpenJobs?: () => void;
}

export function QueueView({
    queued,
    current,
    others,
    busy,
    isRunning,
    large,
    preferredSize,
    onLoad,
    onMoveCurrent,
    onSaveMeta,
    canEditTags = true,
    warnings = [],
    hiddenCount = 0,
    currentOnly = false,
    onOpenJobs,
}: QueueViewProps) {
    const [filters, setFilters] = useState<QueueFilters>({ material: '', size: '' });
    const [editing, setEditing] = useState<string>('');
    const [search, setSearch] = useState('');
    const [due, setDue] = useState<DueFilter>('');
    // Loading moves the order folder on the shared drive, so a tap only asks first.
    const [pending, setPending] = useState<{ order: QueueOrder; file: string } | null>(null);

    const materials = useMemo(() => uniqueValues(queued, 'material'), [queued]);
    const colors = useMemo(() => uniqueValues(queued, 'color'), [queued]);
    const sizes = useMemo(() => uniqueValues(queued, 'size'), [queued]);
    const dueQueue = useMemo(() => filterByDue(queued, due), [queued, due]);
    const dueCounts = useMemo(
        () => Object.fromEntries(DUE_OPTIONS.map((o) => [o.value, filterByDue(queued, o.value).length])),
        [queued],
    );
    const sizeButtons = useMemo(() => sizeOptions(dueQueue), [dueQueue]);
    // If the selected size has no orders left (e.g. the last one was just loaded), show everything again.
    useEffect(() => {
        if (filters.size && !sizeButtons.some((o) => o.key === filters.size)) {
            setFilters((f) => ({ ...f, size: '' }));
        }
    }, [sizeButtons, filters.size]);
    const shown = useMemo(() => {
        const term = search.trim().toLowerCase();
        return term ? dueQueue.filter((o) => o.name.toLowerCase().includes(term)) : dueQueue;
    }, [dueQueue, search]);
    const groups = useMemo(() => groupQueue(shown, filters, preferredSize), [shown, filters, preferredSize]);
    const loadDisabled = busy || isRunning || Boolean(current);
    // Say why rows can't be tapped, instead of leaving them silently dead.
    const disabledReason = isRunning
        ? 'A job is running. Wait for it to finish before loading another.'
        : current
          ? `"${current.name}" is already loaded on this machine. Tap "Mark carved" or "Return to queue" on it before loading another job.`
          : busy
            ? 'Working on the previous request, try again in a moment.'
            : '';
    const explainDisabled = () => toast.info(disabledReason, { position: 'bottom-right' });

    const rowPad = large ? 'py-4' : 'py-2';
    const nameText = large ? 'text-2xl' : 'text-lg';

    if (currentOnly) {
        return (
            <div className="flex flex-col dark:text-white py-2">
                {current ? (
                    <div className="flex flex-col gap-2">
                        <div className="text-xl font-semibold truncate" title={current.name}>
                            {current.name}
                        </div>
                        <MetaTags meta={current.meta} large={false} platform={current.platform} />
                        {current.shipBy && (
                            <div className="text-sm text-gray-600 dark:text-gray-300">
                                Ship by {shipByLabel(current.shipBy)}
                            </div>
                        )}
                        {current.files.length > 0 && (
                            <div className="text-sm text-gray-500 truncate" title={current.files.join(', ')}>
                                {current.files.join(', ')}
                            </div>
                        )}
                        <div className="flex gap-2 mt-1">
                            <button
                                type="button"
                                disabled={busy || isRunning}
                                onClick={() => onMoveCurrent('complete', current)}
                                className="flex-1 min-h-14 rounded border border-blue-500 bg-white dark:bg-dark text-lg font-medium disabled:opacity-50"
                            >
                                Mark carved
                            </button>
                            <button
                                type="button"
                                disabled={busy || isRunning}
                                onClick={() => onMoveCurrent('release', current)}
                                className="flex-1 min-h-14 rounded border border-gray-400 bg-white dark:bg-dark text-lg font-medium disabled:opacity-50"
                            >
                                Return to queue
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-start gap-2">
                        <div className="text-base text-gray-500">No job loaded on this machine.</div>
                        {onOpenJobs && (
                            <button
                                type="button"
                                onClick={onOpenJobs}
                                className="min-h-14 px-6 rounded border border-blue-500 text-lg font-medium"
                            >
                                Choose a job
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col dark:text-white">
            {warnings.length > 0 && (
                <div
                    role="status"
                    className={cx(
                        'mt-2 rounded border border-amber-400 bg-amber-50 text-amber-900',
                        large ? 'px-4 py-3 text-lg' : 'px-2 py-1 text-sm',
                    )}
                >
                    Showing saved jobs, the order list may be out of date. {warnings.join('; ')}
                </div>
            )}
            {/* Search and filters only fit in the Jobs modal; the inline panel is a short strip. */}
            {large && queued.length > 0 && (
                <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search order number or name"
                    aria-label="Search orders"
                    className="mt-2 w-full rounded border border-gray-300 dark:border-dark-lighter bg-white dark:bg-dark dark:text-white px-4 py-3 text-xl"
                />
            )}
            {large && queued.length > 0 && (
                <div className="flex flex-col gap-2 py-2">
                    {/* Due date */}
                    <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filter by due date">
                        {DUE_OPTIONS.map((o) => (
                            <Chip
                                key={o.value || 'all'}
                                large={large}
                                label={`${o.label} (${dueCounts[o.value] ?? 0})`}
                                active={due === o.value}
                                onClick={() => setDue(o.value)}
                            />
                        ))}
                    </div>
                    {/* Size is the main filter: same-size jobs can run without changing the fixture. */}
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by size">
                        <Chip
                            prominent
                            large={large}
                            label={`All sizes (${dueQueue.length})`}
                            active={!filters.size}
                            onClick={() => setFilters((f) => ({ ...f, size: '' }))}
                        />
                        {sizeButtons.map((o) => (
                            <Chip
                                key={o.key}
                                prominent
                                large={large}
                                label={`${o.label} (${o.count})`}
                                active={filters.size === o.key}
                                highlight={Boolean(preferredSize) && o.key === sizeKey(preferredSize)}
                                onClick={() => setFilters((f) => ({ ...f, size: o.key }))}
                            />
                        ))}
                    </div>
                    {materials.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filter by material">
                            <Chip
                                label="All materials"
                                large={large}
                                active={!filters.material}
                                onClick={() => setFilters((f) => ({ ...f, material: '' }))}
                            />
                            {materials.map((m) => (
                                <Chip
                                    key={m}
                                    label={m}
                                    large={large}
                                    active={filters.material.toLowerCase() === m.toLowerCase()}
                                    onClick={() => setFilters((f) => ({ ...f, material: m }))}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {loadDisabled && disabledReason && (
                <div
                    role="status"
                    className={cx(
                        'mt-2 rounded border border-blue-300 bg-blue-50 text-blue-900',
                        large ? 'px-4 py-3 text-lg' : 'px-2 py-1 text-sm',
                    )}
                >
                    {disabledReason}
                </div>
            )}

            {current && (
                <div className={cx('bg-blue-50 dark:bg-dark-lighter -mx-2 px-2 mb-2', rowPad)}>
                    <div className={cx('font-semibold truncate', nameText)} title={current.name}>
                        Running here: {current.name}
                    </div>
                    <div className="my-1">
                        <MetaTags meta={current.meta} large={large} platform={current.platform} />
                    </div>
                    <div className="flex gap-2 mt-2">
                        <button
                            type="button"
                            disabled={busy || isRunning}
                            onClick={() => onMoveCurrent('complete', current)}
                            className="flex-1 min-h-14 rounded border border-blue-500 bg-white dark:bg-dark text-lg font-medium disabled:opacity-50"
                        >
                            Mark carved
                        </button>
                        <button
                            type="button"
                            disabled={busy || isRunning}
                            onClick={() => onMoveCurrent('release', current)}
                            className="flex-1 min-h-14 rounded border border-gray-400 bg-white dark:bg-dark text-lg font-medium disabled:opacity-50"
                        >
                            Return to queue
                        </button>
                    </div>
                </div>
            )}

            {queued.length === 0 && hiddenCount > 0 && (
                <div
                    role="alert"
                    className={cx(
                        'my-3 rounded border border-red-300 bg-red-50 text-red-900',
                        large ? 'px-4 py-3 text-lg' : 'px-2 py-1 text-sm',
                    )}
                >
                    {hiddenCount === 1 ? 'The 1 open order has' : `All ${hiddenCount} open orders have`} no G-code file
                    in {hiddenCount === 1 ? 'its' : 'their'} folder, so nothing can be listed. If the folders do contain
                    G-code, the order tool cannot see the Signs folder (check <strong>SIGNS_HOST_PATH</strong> on the NAS).
                </div>
            )}
            {queued.length === 0 && hiddenCount === 0 && (
                <div className="py-4 text-lg text-gray-500">No orders waiting in the queue.</div>
            )}
            {queued.length > 0 && groups.length === 0 && (
                <div className="py-4 text-lg text-gray-500">No orders match these filters.</div>
            )}

            {groups.map((group, index) => {
                const sameFixture =
                    preferredSize && group.key === sizeKey(preferredSize) && index === 0;
                return (
                    <section key={group.key || 'none'} aria-label={`Size ${group.label}`}>
                        <h3
                            className={cx(
                                'sticky top-0 z-10 flex items-center justify-between px-3 -mx-2 bg-gray-200 dark:bg-dark-lighter font-semibold',
                                large ? 'py-2 text-xl' : 'py-1 text-base',
                            )}
                        >
                            <span>
                                {group.label} ({group.orders.length})
                            </span>
                            {sameFixture && <span className="text-green-700 dark:text-green-400">Same fixture as last job</span>}
                        </h3>
                        <div className="divide-y">
                            {group.orders.map((order) =>
                                editing === orderKey(order) ? (
                                    <OrderEditor
                                        key={orderKey(order)}
                                        order={order}
                                        sizes={sizes}
                                        colors={colors}
                                        large={large}
                                        busy={busy}
                                        onCancel={() => setEditing('')}
                                        onSave={async (meta) => {
                                            if (await onSaveMeta(order, meta)) {
                                                setEditing('');
                                            }
                                        }}
                                    />
                                ) : (
                                    <div key={orderKey(order)} className="flex items-stretch">
                                        <div className="flex-1 min-w-0">
                                            {order.files.length === 0 ? (
                                                <div className={cx('text-gray-400', rowPad)}>
                                                    {order.name} (no G-code)
                                                </div>
                                            ) : (
                                                <div
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-disabled={loadDisabled}
                                                    aria-label={`Load ${order.name}`}
                                                    className={cx(
                                                        'grid grid-cols-[2.5rem_1fr] items-center gap-2 px-1 select-none',
                                                        large ? 'min-h-24' : 'min-h-16',
                                                        loadDisabled
                                                            ? 'opacity-50'
                                                            : 'cursor-pointer active:bg-blue-100 dark:active:bg-dark-lighter',
                                                    )}
                                                    onClick={() => (loadDisabled ? explainDisabled() : setPending({ order, file: order.files[0] }))}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            if (loadDisabled) explainDisabled();
                                                            else setPending({ order, file: order.files[0] });
                                                        }
                                                    }}
                                                >
                                                    <LiaFileUploadSolid className="text-4xl" />
                                                    <span className="flex flex-col gap-1 min-w-0 py-1">
                                                        <span className={cx('truncate', nameText)} title={order.name}>
                                                            {order.name}
                                                        </span>
                                                        <MetaTags meta={order.meta} large={large} platform={order.platform} />
                                                        <span
                                                            className={cx(
                                                                'truncate',
                                                                large ? 'text-base' : 'text-xs',
                                                                order.files.length > 1 ? 'text-blue-700 font-medium' : 'text-gray-500',
                                                            )}
                                                            title={order.files.join(', ')}
                                                        >
                                                            {order.files.length > 1
                                                                ? `${order.files.length} toolpaths – choose one when loading`
                                                                : order.files[0]}
                                                        </span>
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        {order.shipBy && (
                                            <span className={cx('shrink-0 self-center pr-3 text-gray-600 dark:text-gray-300', large ? 'text-lg' : 'text-sm')}>
                                                Ship by {shipByLabel(order.shipBy)}
                                            </span>
                                        )}
                                        {canEditTags && (
                                            <button
                                                type="button"
                                                aria-label={`Edit material, size and color for ${order.name}`}
                                                disabled={busy}
                                                onClick={() => setEditing(orderKey(order))}
                                                className="w-14 shrink-0 flex items-center justify-center text-2xl text-gray-600 dark:text-gray-300"
                                            >
                                                <FiEdit2 />
                                            </button>
                                        )}
                                    </div>
                                ),
                            )}
                        </div>
                    </section>
                );
            })}

            {large && hiddenCount > 0 && queued.length > 0 && (
                <div className="py-3 text-base text-gray-500">
                    {hiddenCount} {hiddenCount === 1 ? 'order is' : 'orders are'} not shown because there is no G-code
                    in {hiddenCount === 1 ? 'its' : 'their'} folder yet.
                </div>
            )}

            {others.map((order) => (
                <div key={`${order.machine}/${order.name}`} className="py-3 text-gray-500 truncate text-base">
                    {order.machine}: {order.name}
                </div>
            ))}

            <AlertDialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
                <AlertDialogContent className="bg-white !max-w-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="!text-3xl !text-gray-900">Load this job?</AlertDialogTitle>
                        <AlertDialogDescription className="!text-xl !text-gray-700">
                            {pending && (
                                <>
                                    <strong>{pending.order.name}</strong> will be loaded and moved to In Progress for
                                    this machine so other machines don&apos;t pick it up.
                                </>
                            )}
                        </AlertDialogDescription>
                        {pending && pending.order.files.length > 1 && (
                            <fieldset className="mt-3 flex flex-col gap-2" aria-label="Choose the toolpath file to run">
                                <legend className="mb-1 text-xl font-semibold text-gray-900">Which toolpath file?</legend>
                                {pending.order.files.map((file) => (
                                    <label
                                        key={file}
                                        className={cx(
                                            'flex items-center gap-3 rounded border px-4 min-h-16 text-xl cursor-pointer',
                                            pending.file === file
                                                ? 'border-blue-500 bg-blue-50 font-semibold text-gray-900'
                                                : 'border-gray-300 text-gray-800',
                                        )}
                                    >
                                        <input
                                            type="radio"
                                            name="job-queue-toolpath"
                                            className="w-6 h-6"
                                            checked={pending.file === file}
                                            onChange={() => setPending({ ...pending, file })}
                                        />
                                        <span className="truncate" title={file}>
                                            {file}
                                        </span>
                                    </label>
                                ))}
                            </fieldset>
                        )}
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-3">
                        <AlertDialogCancel className="!min-h-16 !px-10 !text-2xl">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="!min-h-16 !px-10 !text-2xl"
                            onClick={() => {
                                if (pending) {
                                    onLoad(pending.order, pending.file);
                                }
                                setPending(null);
                            }}
                        >
                            Load job
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
