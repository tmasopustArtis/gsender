import cx from 'classnames';
import { FiMaximize2, FiRefreshCw, FiSettings } from 'react-icons/fi';

import { ScrollArea } from 'app/components/shadcn/ScrollArea';

import { useJobQueue } from './JobQueueContext';
import { QueueSettings } from './QueueSettings';
import { QueueView } from './QueueView';

const iconButton =
    'w-12 h-12 flex items-center justify-center text-2xl rounded-full active:bg-gray-200 dark:active:bg-dark-lighter disabled:opacity-40';

// Compact queue for the Load File area. The Jobs modal (Jobs button / expand icon) has the room
// for filtering and managing orders.
export function JobQueue({ onShowRecent, fullWidth }: { onShowRecent?: () => void; fullWidth?: boolean }) {
    const q = useJobQueue();
    const { data, configured, showSettings, setShowSettings, error } = q;

    return (
        <div className={cx('flex flex-col gap-1 h-full min-h-0 portrait:w-3/4', { 'col-span-2': fullWidth })}>
            <div className="flex items-center justify-between ml-6 mr-2 dark:text-white">
                <span>
                    Job Queue
                    {data && ` (${data.queued.length})`}
                </span>
                <span className="flex items-center">
                    {onShowRecent && (
                        <button
                            type="button"
                            className="text-blue-500 underline text-base px-2 min-h-12"
                            onClick={onShowRecent}
                        >
                            Recent Files
                        </button>
                    )}
                    <button
                        type="button"
                        className={iconButton}
                        aria-label="Open jobs"
                        title="Open jobs"
                        onClick={q.openJobs}
                    >
                        <FiMaximize2 />
                    </button>
                    <button
                        type="button"
                        className={iconButton}
                        aria-label="Refresh job queue"
                        title="Refresh"
                        onClick={q.refresh}
                        disabled={!configured}
                    >
                        <FiRefreshCw />
                    </button>
                    <button
                        type="button"
                        className={iconButton}
                        aria-label="Job queue settings"
                        title="Settings"
                        onClick={() => setShowSettings((v) => !v)}
                    >
                        <FiSettings />
                    </button>
                </span>
            </div>

            <ScrollArea className="ml-2 mr-2 px-2 flex-1 min-h-0 portrait:mb-5 bg-white dark:bg-dark rounded-xl border-2 dark:border-dark-lighter">
                {showSettings && <QueueSettings large={false} />}

                {!showSettings && !configured && (
                    <div className="py-3 text-sm text-gray-500">Open settings (gear) to choose this computer and name it.</div>
                )}

                {!showSettings && configured && error && (
                    <div className="py-3 text-sm text-red-600" role="alert">
                        {error}
                    </div>
                )}

                {!showSettings && configured && !error && data && (
                    <QueueView
                        queued={data.queued}
                        current={q.current}
                        others={q.others}
                        busy={q.busy}
                        isRunning={q.isRunning}
                        large={false}
                        preferredSize={q.preferredSize}
                        onLoad={q.loadOrder}
                        onMoveCurrent={q.moveCurrent}
                        onSaveMeta={q.saveMeta}
                            canEditTags={q.canEditTags}
                        warnings={data.warnings}
                        hiddenCount={data.hiddenNoGcode}
                        currentOnly
                        onOpenJobs={q.openJobs}
                    />
                )}
            </ScrollArea>
        </div>
    );
}

export default JobQueue;
