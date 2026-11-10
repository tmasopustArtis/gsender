import { useEffect, useRef, useState } from 'react';
import cx from 'classnames';
import get from 'lodash/get';
import includes from 'lodash/includes';
import { MdOutlineTouchApp } from 'react-icons/md';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from 'app/components/shadcn/Dialog';
import { useTypedSelector } from 'app/hooks/useTypedSelector';
import { useWorkspaceState } from 'app/hooks/useWorkspaceState';
import combokeys from 'app/lib/combokeys';
import {
    GRBL_ACTIVE_STATE_IDLE,
    GRBL_ACTIVE_STATE_JOG,
    WORKFLOW_STATE_RUNNING,
} from 'app/constants';

import { goXYAxes, gotoZero, zeroAllAxes, zeroWCS } from '../utils/DRO';

const SPEEDS = [
    { label: 'Precise', cmd: 'SET_P_JOG_PRESET' },
    { label: 'Normal', cmd: 'SET_N_JOG_PRESET' },
    { label: 'Rapid', cmd: 'SET_R_JOG_PRESET' },
] as const;

const base =
    'rounded-xl border-2 text-4xl font-bold font-mono flex items-center justify-center min-h-24 select-none disabled:opacity-40 active:brightness-90';
const zeroStyle = `${base} bg-gray-100 border-gray-300 text-gray-800 dark:bg-dark-lighter dark:text-white dark:border-gray-600`;
const goStyle = `${base} bg-blue-100 border-blue-400 text-blue-900`;

interface BigButtonProps {
    label: string;
    className: string;
    disabled: boolean;
    ariaLabel: string;
    // When set, the first tap arms the button and the second tap runs it
    confirm?: boolean;
    onRun: () => void;
}

function BigButton({ label, className, disabled, ariaLabel, confirm, onRun }: BigButtonProps) {
    const [armed, setArmed] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => clearTimeout(timer.current), []);

    const tap = () => {
        if (confirm && !armed) {
            setArmed(true);
            timer.current = setTimeout(() => setArmed(false), 3000);
            return;
        }
        clearTimeout(timer.current);
        setArmed(false);
        onRun();
    };

    return (
        <button
            type="button"
            className={cx(className, { '!bg-amber-300 !border-amber-500 !text-black': armed })}
            disabled={disabled}
            aria-label={ariaLabel}
            onClick={tap}
        >
            {armed ? 'Tap again' : label}
        </button>
    );
}

// 96x96 button that opens a modal with large versions of the DRO zero / go-to buttons and the
// jog speed presets, for touch screens.
export function TouchControls() {
    const [open, setOpen] = useState(false);
    const [speed, setSpeed] = useState<string>('Normal');
    const { shouldWarnZero } = useWorkspaceState();

    const isConnected = useTypedSelector((s) => get(s, 'connection.isConnected', false));
    const workflowState = useTypedSelector((s) => get(s, 'controller.workflow.state', 'idle'));
    const activeState = useTypedSelector((s) => get(s, 'controller.state.status.activeState', 'Idle'));
    const canClick =
        isConnected &&
        workflowState !== WORKFLOW_STATE_RUNNING &&
        includes([GRBL_ACTIVE_STATE_IDLE, GRBL_ACTIVE_STATE_JOG], activeState);

    const pickSpeed = (label: string, cmd: string) => {
        setSpeed(label);
        // Same event the keyboard shortcuts use, so the jog panel switches too.
        combokeys.emit(cmd);
    };

    return (
        <>
            <button
                type="button"
                className="w-24 h-24 rounded-xl border-2 border-blue-500 bg-white dark:bg-dark text-blue-600 flex flex-col items-center justify-center gap-1 text-sm font-semibold active:bg-blue-100 dark:active:bg-dark-lighter"
                aria-label="Open large touch controls"
                onClick={() => setOpen(true)}
            >
                <MdOutlineTouchApp className="w-10 h-10" />
                Big Buttons
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="bg-white dark:bg-dark max-w-[900px] w-[92vw]">
                    <DialogTitle className="!text-3xl !font-semibold">Touch Controls</DialogTitle>
                    <DialogDescription className="sr-only">
                        Large buttons for zeroing axes, moving to zero, and choosing the jog speed.
                    </DialogDescription>

                    {!canClick && (
                        <div className="text-lg text-gray-500" role="status">
                            Connect to the machine and wait until it is idle to use these buttons.
                        </div>
                    )}

                    <div className="grid grid-cols-[1fr_1fr] gap-x-6 gap-y-4">
                        <div className="text-xl font-semibold text-center">Zero</div>
                        <div className="text-xl font-semibold text-center">Go to zero</div>
                        {['X', 'Y', 'Z'].map((axis) => (
                            <div key={axis} className="contents">
                                <BigButton
                                    label={`${axis}0`}
                                    className={zeroStyle}
                                    disabled={!canClick}
                                    ariaLabel={`Zero ${axis} axis`}
                                    confirm={shouldWarnZero}
                                    onRun={() => zeroWCS(axis, 0)}
                                />
                                <BigButton
                                    label={axis}
                                    className={goStyle}
                                    disabled={!canClick}
                                    ariaLabel={`Go to ${axis} axis zero`}
                                    onRun={() => gotoZero(axis)}
                                />
                            </div>
                        ))}
                        <BigButton
                            label="Zero All"
                            className={zeroStyle}
                            disabled={!canClick}
                            ariaLabel="Zero all axes"
                            confirm={shouldWarnZero}
                            onRun={() => zeroAllAxes()}
                        />
                        <BigButton
                            label="XY"
                            className={goStyle}
                            disabled={!canClick}
                            ariaLabel="Go to XY zero"
                            onRun={() => goXYAxes()}
                        />
                    </div>

                    <div className="mt-2">
                        <div className="text-xl font-semibold text-center mb-2">Jog speed</div>
                        <div className="grid grid-cols-3 gap-4" role="group" aria-label="Jog speed">
                            {SPEEDS.map(({ label, cmd }) => (
                                <button
                                    key={label}
                                    type="button"
                                    aria-pressed={speed === label}
                                    className={cx(
                                        'rounded-xl border-2 text-3xl min-h-24 select-none',
                                        speed === label
                                            ? 'bg-blue-400 bg-opacity-30 border-blue-500'
                                            : 'bg-white dark:bg-dark border-gray-300',
                                    )}
                                    onClick={() => pickSpeed(label, cmd)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

export default TouchControls;
