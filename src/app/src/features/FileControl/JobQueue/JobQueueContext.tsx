import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import pubsub from 'pubsub-js';

import api from 'app/api';
import store from 'app/store';
import controller from 'app/lib/controller';
import { toast } from 'app/lib/toaster';
import { store as reduxStore } from 'app/store/redux';
import { updateFileInfo } from 'app/store/redux/slices/fileInfo.slice';
import { useTypedSelector } from 'app/hooks/useTypedSelector';
import { uploadGcodeFileToServer } from 'app/lib/fileupload';
import { JOB_STATUS, VISUALIZER_PRIMARY, WORKFLOW_STATE_RUNNING } from 'app/constants';

import { OrderMeta, QueueOrder, orderKey, splitRunnable } from './grouping';
import { ORDERS_PRESETS, PathMode, defaultPathMode, detectPathMode } from './presets';

interface QueueData {
    ordersPath: string;
    machine: string;
    queued: QueueOrder[];
    inProgress: QueueOrder[];
    warnings?: string[];
    // queued orders left out because their folder has no G-code (yet)
    hiddenNoGcode?: number;
}

const REFRESH_MS = 15000;
const PATH_KEY = 'workspace.jobQueue.ordersPath';
const MACHINE_KEY = 'workspace.jobQueue.machineName';
const CARVED_KEY = 'workspace.jobQueue.carvedPath';
const SOURCE_KEY = 'workspace.jobQueue.source';
const CENTRAL_URL_KEY = 'workspace.jobQueue.centralUrl';
const CENTRAL_KEY_KEY = 'workspace.jobQueue.centralKey';
const LAST_SIZE_KEY = 'workspace.jobQueue.lastSize';

export type QueueSource = 'folder' | 'central';

const isReady = (t: { source?: QueueSource; ordersPath: string; centralUrl?: string; machineName: string }) =>
    Boolean(t.machineName && (t.source === 'central' ? t.centralUrl : t.ordersPath));

const errorMessage = (err: any): string =>
    err?.response?.data?.msg || err?.message || 'Unknown error';


export interface JobQueueState {
    ordersPath: string;
    setOrdersPath: (v: string) => void;
    pathMode: PathMode;
    choosePathMode: (mode: PathMode) => void;
    machineName: string;
    setMachineName: (v: string) => void;
    carvedPath: string;
    setCarvedPath: (v: string) => void;
    source: QueueSource;
    setSource: (v: QueueSource) => void;
    centralUrl: string;
    setCentralUrl: (v: string) => void;
    centralKey: string;
    setCentralKey: (v: string) => void;
    // Tags (material / size / color) are edited in the app only for the shared-folder source.
    canEditTags: boolean;
    saveSettings: () => void;
    showSettings: boolean;
    setShowSettings: (v: boolean | ((prev: boolean) => boolean)) => void;
    configured: boolean;
    data: QueueData | null;
    error: string;
    busy: boolean;
    isRunning: boolean;
    current?: QueueOrder;
    others: QueueOrder[];
    preferredSize: string;
    refresh: () => Promise<void>;
    loadOrder: (order: QueueOrder, file: string) => Promise<void>;
    moveCurrent: (action: 'complete' | 'release', order: QueueOrder) => Promise<void>;
    saveMeta: (order: QueueOrder, meta: OrderMeta) => Promise<boolean>;
    jobsOpen: boolean;
    openJobs: () => void;
    closeJobs: () => void;
}

const JobQueueContext = createContext<JobQueueState | null>(null);

// Owns the queue state for the whole Load File area. The inline panel, the Jobs button and the
// Jobs modal all read from here, so there is a single copy of the polling and of the
// "job finished -> move to Carved" handling.
export function JobQueueProvider({ children }: { children: ReactNode }) {
    const [ordersPath, setOrdersPath] = useState<string>(
        store.get(PATH_KEY, '') || ORDERS_PRESETS[defaultPathMode()].path,
    );
    const [pathMode, setPathMode] = useState<PathMode>(detectPathMode(store.get(PATH_KEY, '')));
    const [machineName, setMachineName] = useState<string>(store.get(MACHINE_KEY, ''));
    const [carvedPath, setCarvedPath] = useState<string>(store.get(CARVED_KEY, ''));
    const [source, setSource] = useState<QueueSource>(store.get(SOURCE_KEY, 'folder') === 'central' ? 'central' : 'folder');
    const [centralUrl, setCentralUrl] = useState<string>(store.get(CENTRAL_URL_KEY, ''));
    const [centralKey, setCentralKey] = useState<string>(store.get(CENTRAL_KEY_KEY, ''));
    const [showSettings, setShowSettings] = useState(
        !isReady({
            source: store.get(SOURCE_KEY, 'folder'),
            ordersPath: store.get(PATH_KEY, ''),
            centralUrl: store.get(CENTRAL_URL_KEY, ''),
            machineName: store.get(MACHINE_KEY, ''),
        }),
    );
    const [data, setData] = useState<QueueData | null>(null);
    const [error, setError] = useState<string>('');
    const [busy, setBusy] = useState(false);
    const [jobsOpen, setJobsOpen] = useState(false);
    const isRunning =
        useTypedSelector((state) => state.controller.workflow.state) === WORKFLOW_STATE_RUNNING;

    const target = {
        source,
        ordersPath,
        machineName,
        carvedPath: carvedPath.trim() || undefined,
        centralUrl: centralUrl.trim(),
        centralKey: centralKey.trim() || undefined,
    };
    const configured = isReady(target);
    const targetRef = useRef(target);
    targetRef.current = target;
    const dataRef = useRef<QueueData | null>(null);
    dataRef.current = data;
    // The G-code file we loaded for the current order (an order can hold several).
    const loadedFileRef = useRef<{ order: string; file: string } | null>(null);

    const mine = (data?.inProgress ?? []).filter((o) => o.machine === data?.machine);
    const others = (data?.inProgress ?? []).filter((o) => o.machine !== data?.machine);
    const current = mine[0];
    // Size last carved on this machine; same-size jobs are listed first to avoid a fixture change.
    const preferredSize: string = current?.meta.size || store.get(LAST_SIZE_KEY, '');

    const refresh = useCallback(async () => {
        const t = targetRef.current;
        if (!isReady(t)) {
            return;
        }
        try {
            const res = await api.jobQueue.list(t);
            const all = res.data as QueueData;
            const { ready, hidden } = splitRunnable(all.queued);
            setData({ ...all, queued: ready, hiddenNoGcode: hidden });
            setError('');
        } catch (err) {
            setError(errorMessage(err));
        }
    }, []);

    useEffect(() => {
        if (!configured) {
            return;
        }
        refresh();
        const timer = setInterval(refresh, REFRESH_MS);
        return () => clearInterval(timer);
    }, [configured, source, ordersPath, centralUrl, machineName, refresh]);

    // When a job finishes successfully, move its order folder to Carved.
    useEffect(() => {
        const token = pubsub.subscribe('lastJob', async (_: string, job: any) => {
            const t = targetRef.current;
            if (!isReady(t) || job?.jobStatus !== JOB_STATUS.COMPLETE) {
                return;
            }
            // Look at the live server state rather than trusting our cached copy.
            let inProgress: QueueOrder[] = [];
            try {
                const res = await api.jobQueue.list(t);
                inProgress = (res.data as QueueData).inProgress.filter((o) => o.machine === res.data.machine);
            } catch (err) {
                toast.error(`Job queue: could not check finished job (${errorMessage(err)})`, {
                    position: 'bottom-right',
                });
                return;
            }
            const loaded = loadedFileRef.current;
            const match =
                inProgress.find((o) => loaded && orderKey(o) === loaded.order && o.files.includes(job.file)) ??
                inProgress.find((o) => o.files.includes(job.file));
            if (!match) {
                return;
            }
            try {
                await api.jobQueue.complete({
                    ...t,
                    order: orderKey(match),
                    file: job.file,
                    // the job record's duration is in milliseconds
                    durationSeconds: Number.isFinite(Number(job.duration)) ? Math.round(Number(job.duration) / 1000) : undefined,
                    finishedAt: job.endTime ? new Date(job.endTime).toISOString() : new Date().toISOString(),
                });
                loadedFileRef.current = null;
                toast.success(`"${match.name}" finished and moved to Carved`, {
                    position: 'bottom-right',
                });
            } catch (err) {
                toast.error(`Job queue: could not move "${match.name}" to Carved (${errorMessage(err)})`, {
                    position: 'bottom-right',
                });
            }
            refresh();
        });
        return () => {
            pubsub.unsubscribe(token);
        };
    }, [refresh]);

    const choosePathMode = (mode: PathMode) => {
        setPathMode(mode);
        if (mode !== 'custom') {
            setOrdersPath(ORDERS_PRESETS[mode].path);
            setCarvedPath(''); // Carved is the folder next to ORDERS
        }
    };

    const saveSettings = () => {
        const p = ordersPath.trim();
        const m = machineName.trim();
        setOrdersPath(p);
        setMachineName(m);
        store.set(PATH_KEY, p);
        store.set(MACHINE_KEY, m);
        store.set(CARVED_KEY, carvedPath.trim());
        store.set(SOURCE_KEY, source);
        store.set(CENTRAL_URL_KEY, centralUrl.trim());
        store.set(CENTRAL_KEY_KEY, centralKey.trim());
        // The server needs this machine's name to hide macros that belong to other machines (_1, _2, _3).
        api.macros.setLocation({ machine: m }).catch(() => {});
        pubsub.publish('macros:reload');
        if (m && (source === 'central' ? centralUrl.trim() : p)) {
            setShowSettings(false);
        }
    };

    const loadOrder = async (order: QueueOrder, file: string) => {
        setBusy(true);
        try {
            const res = await api.jobQueue.claim({ ...target, order: orderKey(order), file });
            const claimed = res.data as { file: string; path: string; data: string };
            await uploadGcodeFileToServer(
                new File([claimed.data], claimed.file),
                controller.port,
                VISUALIZER_PRIMARY,
            );
            reduxStore.dispatch(updateFileInfo({ path: claimed.path }));
            loadedFileRef.current = { order: orderKey(order), file: claimed.file };
            if (order.meta.size) {
                store.set(LAST_SIZE_KEY, order.meta.size);
            }
            toast.success(`Loaded "${order.name}" – ${claimed.file}`, { position: 'bottom-right' });
        } catch (err) {
            toast.error(`Could not load "${order.name}": ${errorMessage(err)}`, {
                position: 'bottom-right',
            });
        } finally {
            setBusy(false);
            refresh();
        }
    };

    const moveCurrent = async (action: 'complete' | 'release', order: QueueOrder) => {
        setBusy(true);
        try {
            await api.jobQueue[action]({ ...target, order: orderKey(order) });
            loadedFileRef.current = null;
            toast.success(
                action === 'complete'
                    ? `"${order.name}" moved to Carved`
                    : `"${order.name}" returned to the queue`,
                { position: 'bottom-right' },
            );
        } catch (err) {
            toast.error(errorMessage(err), { position: 'bottom-right' });
        } finally {
            setBusy(false);
            refresh();
        }
    };

    const saveMeta = async (order: QueueOrder, meta: OrderMeta): Promise<boolean> => {
        setBusy(true);
        try {
            await api.jobQueue.setMeta({ ...target, order: orderKey(order), meta });
            await refresh();
            return true;
        } catch (err) {
            toast.error(`Could not save tags for "${order.name}": ${errorMessage(err)}`, {
                position: 'bottom-right',
            });
            return false;
        } finally {
            setBusy(false);
        }
    };

    return (
        <JobQueueContext.Provider
            value={{
                // settings
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
                canEditTags: source !== 'central',
                saveSettings,
                showSettings,
                setShowSettings,
                configured,
                // queue
                data,
                error,
                busy,
                isRunning,
                current,
                others,
                preferredSize,
                refresh,
                loadOrder,
                moveCurrent,
                saveMeta,
                // the Jobs modal
                jobsOpen,
                openJobs: () => setJobsOpen(true),
                closeJobs: () => setJobsOpen(false),
            }}
        >
            {children}
        </JobQueueContext.Provider>
    );
}

export function useJobQueue(): JobQueueState {
    const ctx = useContext(JobQueueContext);
    if (!ctx) {
        throw new Error('useJobQueue must be used inside <JobQueueProvider>');
    }
    return ctx;
}
