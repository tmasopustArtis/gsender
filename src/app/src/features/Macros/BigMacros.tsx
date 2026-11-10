import { useEffect, useRef, useState } from 'react';
import cx from 'classnames';
import { MdOutlineTouchApp } from 'react-icons/md';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from 'app/components/shadcn/Dialog';
import { toast } from 'app/lib/toaster';

interface BigMacro {
    id: string;
    name: string;
    column?: string;
    rowIndex?: number;
}

interface Props {
    macros: BigMacro[];
    canClick: boolean;
    onRun: (id: string, macro: { name: string }) => void;
}

// Same order as the Macros list: first column, then second, each by row.
const inListOrder = (macros: BigMacro[]) =>
    [...macros].sort(
        (a, b) =>
            (a.column ?? '').localeCompare(b.column ?? '') ||
            (a.rowIndex ?? 0) - (b.rowIndex ?? 0),
    );

function BigMacroButton({
    macro,
    disabled,
    onRun,
}: {
    macro: BigMacro;
    disabled: boolean;
    onRun: () => void;
}) {
    const [running, setRunning] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => clearTimeout(timer.current), []);

    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => {
                setRunning(true);
                onRun();
                timer.current = setTimeout(() => setRunning(false), 4000);
            }}
            className={cx(
                'rounded-xl border-2 min-h-24 px-4 text-2xl font-semibold select-none break-words',
                'disabled:opacity-40 active:brightness-90',
                running
                    ? 'animate-pulse bg-green-200 border-green-500 text-green-900'
                    : 'bg-white dark:bg-dark border-gray-300 dark:border-gray-600',
            )}
        >
            {running ? 'Running...' : macro.name}
        </button>
    );
}

// Opens a modal showing every macro as a large, easy-to-press button.
export function BigMacros({ macros, canClick, onRun }: Props) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Open big macro buttons"
                className="flex flex-1 justify-center items-center gap-1 h-8 text-sm rounded-md border border-blue-500 text-blue-600 bg-white dark:bg-dark"
            >
                <MdOutlineTouchApp className="text-lg" />
                Big Buttons
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="bg-white dark:bg-dark max-w-[1100px] w-[94vw] max-h-[92vh] overflow-y-auto">
                    <DialogTitle className="!text-3xl !font-semibold">Macros</DialogTitle>
                    <DialogDescription className="sr-only">
                        Large buttons for running macros.
                    </DialogDescription>

                    {!canClick && (
                        <div className="text-lg text-gray-500" role="status">
                            Connect to the machine and wait until it is idle to run macros.
                        </div>
                    )}
                    {macros.length === 0 && (
                        <div className="text-lg text-gray-500">No macros yet. Add one from the Macros tab.</div>
                    )}

                    <div className="grid grid-cols-3 gap-4">
                        {inListOrder(macros).map((macro) => (
                            <BigMacroButton
                                key={macro.id}
                                macro={macro}
                                disabled={!canClick}
                                onRun={() => {
                                    onRun(macro.id, { name: macro.name });
                                    toast.info(`Started running macro '${macro.name}'!`, {
                                        position: 'bottom-right',
                                    });
                                }}
                            />
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

export default BigMacros;
