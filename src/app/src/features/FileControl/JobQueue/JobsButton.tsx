import { FaClipboardList } from 'react-icons/fa';

import { Button } from 'app/components/Button';
import { Tooltip } from 'app/components/Tooltip';

import { useJobQueue } from './JobQueueContext';

// "Jobs" button for the Load File toolbar. Opens the Jobs modal.
export function JobsButton() {
    const { openJobs, data } = useJobQueue();
    return (
        <Tooltip content="Choose and manage jobs from the shared Orders folder">
            <Button
                onClick={openJobs}
                icon={<FaClipboardList className="w-5 h-5" />}
                text={data ? `Jobs (${data.queued.length})` : 'Jobs'}
                variant="ghost"
                className="h-full px-4 rounded-none portrait:text-xl portrait:px-6"
                aria-label="Open jobs"
            />
        </Tooltip>
    );
}
