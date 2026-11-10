import { FiRefreshCw, FiSettings } from 'react-icons/fi';

import { ScrollArea } from 'app/components/shadcn/ScrollArea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from 'app/components/shadcn/Dialog';

import { useJobQueue } from './JobQueueContext';
import { QueueSettings } from './QueueSettings';
import { QueueView } from './QueueView';

const iconButton =
    'w-14 h-14 flex items-center justify-center text-3xl rounded-full active:bg-gray-200 dark:active:bg-dark-lighter disabled:opacity-40';

// The "Jobs" modal: full-size queue for choosing and managing orders.
export function JobQueueDialog() {
    const q = useJobQueue();
    const { data, jobsOpen, closeJobs, showSettings, setShowSettings, configured, error } = q;

    return (
        <Dialog open={jobsOpen} onOpenChange={(open) => !open && closeJobs()}>
            <DialogContent className="bg-white dark:bg-dark max-w-[96vw] w-[96vw] h-[92vh] grid-rows-[minmax(0,1fr)]">
                {/* One column inside the dialog so the layout does not depend on the dialog's own grid */}
                <div className="flex flex-col h-full min-h-0 gap-2">
                <div className="flex items-center justify-between pr-10">
                    <DialogTitle className="!text-3xl !font-semibold !text-gray-900 dark:!text-white">
                        Jobs{data && !showSettings && ` (${data.queued.length} waiting)`}
                    </DialogTitle>
                    <span className="flex items-center gap-1">
                        <button
                            type="button"
                            className={iconButton}
                            aria-label="Refresh jobs"
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
                            aria-pressed={showSettings}
                            onClick={() => setShowSettings((v) => !v)}
                        >
                            <FiSettings />
                        </button>
                    </span>
                </div>
                <DialogDescription className="sr-only">
                    Choose the next order to carve and manage the queue. Orders are grouped by size.
                </DialogDescription>

                <ScrollArea className="flex-1 min-h-0 px-2">
                    {showSettings && <QueueSettings large />}
                    {!showSettings && !configured && (
                        <div className="py-6 text-xl text-gray-500">Open settings (gear) to choose this computer and name it.</div>
                    )}
                    {!showSettings && configured && error && (
                        <div className="py-6 text-xl text-red-600" role="alert">
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
                            large
                            preferredSize={q.preferredSize}
                            onLoad={async (order, file) => {
                                await q.loadOrder(order, file);
                                closeJobs(); // back to the main screen to start the job
                            }}
                            onMoveCurrent={q.moveCurrent}
                            onSaveMeta={q.saveMeta}
                            canEditTags={q.canEditTags}
                        warnings={data.warnings}
                        hiddenCount={data.hiddenNoGcode}
                        />
                    )}
                </ScrollArea>
                </div>
            </DialogContent>
        </Dialog>
    );
}
