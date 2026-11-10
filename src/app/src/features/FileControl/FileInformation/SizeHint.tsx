import cx from 'classnames';

import { useTypedSelector } from 'app/hooks/useTypedSelector';

import { useJobQueue } from '../JobQueue/JobQueueContext';
import { detectSignSize, sizeMatches } from './signSize';

// Quick sanity check: the sign size this G-code represents, and whether it agrees with the order.
const SizeHint = () => {
    const bbox = useTypedSelector((state) => state.file.bbox);
    const name = useTypedSelector((state) => state.file.name);
    const { current } = useJobQueue();

    const detected = detectSignSize(bbox?.delta?.x, bbox?.delta?.y);
    if (!detected) return null;

    const expected = current && current.files.includes(name) ? current.meta.size : '';
    const match = expected ? sizeMatches(detected, expected) : null;

    return (
        <div
            className={cx('rounded-lg border-2 px-3 py-1 text-center my-1', {
                'border-gray-300 text-gray-800 dark:text-gray-200': match === null,
                'border-green-500 bg-green-50 text-green-800': match === true,
                'border-red-500 bg-red-50 text-red-800': match === false,
            })}
            role={match === false ? 'alert' : 'status'}
            data-testid="size-hint"
        >
            <div className="text-2xl font-bold">≈ {detected.label} in sign</div>
            {match === true && <div className="text-sm">Matches the order ({expected})</div>}
            {match === false && (
                <div className="text-sm font-semibold">
                    Order says {expected} – check the file before carving!
                </div>
            )}
        </div>
    );
};

export default SizeHint;
