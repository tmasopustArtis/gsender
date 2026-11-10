import { useEffect, useState } from 'react';
import cx from 'classnames';
import pubsub from 'pubsub-js';

import { Button } from 'app/components/Button';
import api from 'app/api';
import { toast } from 'app/lib/toaster';

import { useJobQueue } from './JobQueueContext';
import { ORDERS_PRESETS, PathMode, sharedMacrosPath } from './presets';

// Mac / Windows choice + machine name. Used in the inline panel and in the Jobs modal.
export function QueueSettings({ large }: { large: boolean }) {
    const {
        ordersPath,
        setOrdersPath,
        pathMode,
        choosePathMode,
        machineName,
        setMachineName,
        carvedPath,
        setCarvedPath,
        source,
        setSource,
        centralUrl,
        setCentralUrl,
        centralKey,
        setCentralKey,
        saveSettings,
    } = useJobQueue();

    const inputClass = cx(
        'w-full rounded border border-gray-300 dark:border-dark-lighter bg-white dark:bg-dark dark:text-white',
        large ? 'px-3 py-3 text-xl' : 'px-2 py-1 text-sm',
    );

    // Macros: this computer only, or one shared file beside the Orders folder
    const macrosFile = sharedMacrosPath(ordersPath);
    const [macrosShared, setMacrosShared] = useState(false);
    const [macrosCurrent, setMacrosCurrent] = useState<{ file: string; available: boolean } | null>(null);
    useEffect(() => {
        api.macros
            .location()
            .then((res) => {
                setMacrosCurrent(res.data);
                setMacrosShared(Boolean(res.data.shared));
            })
            .catch(() => setMacrosCurrent(null));
    }, []);
    const applyMacros = async () => {
        try {
            const res = await api.macros.setLocation({ file: macrosShared ? macrosFile : '', machine: machineName.trim() });
            setMacrosCurrent({ file: res.data.file, available: true });
            pubsub.publish('macros:reload');
            toast.success(
                macrosShared
                    ? res.data.created
                        ? 'Macros are now shared. This computer\'s macros were copied to the shared file.'
                        : 'Macros are now shared. Using the macros already in the shared file.'
                    : 'Macros are now stored on this computer only.',
                { position: 'bottom-right' },
            );
        } catch (err: any) {
            toast.error(err?.response?.data?.msg || 'Could not change where macros are stored', {
                position: 'bottom-right',
            });
        }
    };
    const macrosChanged = macrosShared !== Boolean(macrosCurrent?.file) || (macrosShared && macrosCurrent?.file !== macrosFile);

    return (
        <div className={cx('flex flex-col dark:text-white', large ? 'gap-5 py-4 max-w-2xl text-xl' : 'gap-2 py-2 text-sm')}>
            <fieldset className="flex flex-col gap-1">
                <legend className="mb-1">Where do jobs come from?</legend>
                <div className="flex gap-2">
                    {([['central', 'Order tool'], ['folder', 'Shared folder']] as const).map(([value, text]) => (
                        <label
                            key={value}
                            className={cx(
                                'flex-1 flex items-center justify-center gap-2 rounded border cursor-pointer',
                                large ? 'min-h-16 text-2xl' : 'min-h-12 text-base',
                                source === value
                                    ? 'border-blue-500 bg-blue-50 dark:bg-dark-lighter font-semibold'
                                    : 'border-gray-300 dark:border-dark-lighter',
                            )}
                        >
                            <input
                                type="radio"
                                name={`job-queue-source-${large ? 'modal' : 'inline'}`}
                                className={large ? 'w-6 h-6' : 'w-5 h-5'}
                                checked={source === value}
                                onChange={() => setSource(value)}
                            />
                            {text}
                        </label>
                    ))}
                </div>
            </fieldset>

            {source === 'central' && (
                <>
                    <label className={cx("flex flex-col gap-1", large && "text-xl")}>
                        Order tool address
                        <input
                            className={inputClass}
                            value={centralUrl}
                            placeholder="http://192.168.10.206:8090"
                            onChange={(e) => setCentralUrl(e.target.value)}
                        />
                    </label>
                    <label className={cx("flex flex-col gap-1", large && "text-xl")}>
                        Access key (only if the tool asks for one)
                        <input
                            className={inputClass}
                            type="password"
                            autoComplete="off"
                            value={centralKey}
                            onChange={(e) => setCentralKey(e.target.value)}
                        />
                    </label>
                </>
            )}

            {source === 'folder' && (
            <fieldset className="flex flex-col gap-1">
                <legend className="mb-1">What kind of computer is this?</legend>
                <div className="flex gap-2">
                    {(['mac', 'windows', 'custom'] as PathMode[]).map((mode) => (
                        <label
                            key={mode}
                            className={cx(
                                'flex-1 flex items-center justify-center gap-2 rounded border cursor-pointer',
                                large ? 'min-h-16 text-2xl' : 'min-h-12 text-base',
                                pathMode === mode
                                    ? 'border-blue-500 bg-blue-50 dark:bg-dark-lighter font-semibold'
                                    : 'border-gray-300 dark:border-dark-lighter',
                            )}
                        >
                            <input
                                type="radio"
                                name={`job-queue-path-mode-${large ? 'modal' : 'inline'}`}
                                className={large ? 'w-6 h-6' : 'w-5 h-5'}
                                checked={pathMode === mode}
                                onChange={() => choosePathMode(mode)}
                            />
                            {mode === 'custom' ? 'Other' : ORDERS_PRESETS[mode].label}
                        </label>
                    ))}
                </div>
            </fieldset>
            )}

            {source === 'folder' && pathMode === 'custom' && (
                <>
                    <label className={cx("flex flex-col gap-1", large && "text-xl")}>
                        Orders folder
                        <input
                            className={inputClass}
                            value={ordersPath}
                            placeholder="Full path to the ORDERS folder"
                            onChange={(e) => setOrdersPath(e.target.value)}
                        />
                    </label>
                    <label className={cx("flex flex-col gap-1", large && "text-xl")}>
                        Carved folder (blank = &quot;Carved&quot; next to the Orders folder)
                        <input className={inputClass} value={carvedPath} onChange={(e) => setCarvedPath(e.target.value)} />
                    </label>
                </>
            )}

            <label className={cx("flex flex-col gap-1", large && "text-xl")}>
                This machine&apos;s name
                <input
                    className={inputClass}
                    value={machineName}
                    placeholder="Router 1"
                    onChange={(e) => setMachineName(e.target.value)}
                />
            </label>

            <fieldset className="flex flex-col gap-1">
                <legend className="mb-1">Where are macros stored?</legend>
                <div className="flex gap-2">
                    {([[false, 'This computer'], [true, 'Shared (NAS)']] as const).map(([value, text]) => (
                        <label
                            key={String(value)}
                            className={cx(
                                'flex-1 flex items-center justify-center gap-2 rounded border cursor-pointer',
                                large ? 'min-h-16 text-2xl' : 'min-h-12 text-base',
                                macrosShared === value
                                    ? 'border-blue-500 bg-blue-50 dark:bg-dark-lighter font-semibold'
                                    : 'border-gray-300 dark:border-dark-lighter',
                            )}
                        >
                            <input
                                type="radio"
                                name={`job-queue-macros-${large ? 'modal' : 'inline'}`}
                                className={large ? 'w-6 h-6' : 'w-5 h-5'}
                                checked={macrosShared === value}
                                onChange={() => setMacrosShared(value)}
                            />
                            {text}
                        </label>
                    ))}
                </div>
                <div className="text-gray-600 dark:text-gray-300 text-base">
                    A macro whose name ends in _1, _2 or _3 (e.g. Surface_2) only shows up on the machine with that
                    number in its name.
                </div>
                {macrosShared && (
                    <div className="text-gray-600 dark:text-gray-300 break-all text-base">
                        {macrosFile || 'Pick the shared folder above first.'}
                    </div>
                )}
                {macrosCurrent && macrosCurrent.file && !macrosCurrent.available && (
                    <div className="text-red-600 text-base" role="alert">
                        The shared macros file can&apos;t be reached right now. Macros still run, but changes are
                        paused until the NAS is back.
                    </div>
                )}
                <Button
                    text="Apply macro location"
                    onClick={applyMacros}
                    disabled={!macrosChanged || (macrosShared && !macrosFile)}
                    className={large ? '!h-16 !text-2xl mt-2' : 'mt-1'}
                />
            </fieldset>

            <Button
                text="Save"
                variant="primary"
                onClick={saveSettings}
                disabled={!machineName.trim() || !(source === 'central' ? centralUrl.trim() : ordersPath.trim())}
                className={large ? '!h-16 !text-2xl' : undefined}
            />
        </div>
    );
}
