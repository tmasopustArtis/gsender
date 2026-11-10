import DRO from 'app/features/DRO';
import { Jogging } from 'app/features/Jogging';
import { TouchControls } from 'app/features/DRO/component/TouchControls';

export function Location() {
    return (
        <div className="relative flex flex-col flex-grow justify-between">
            <DRO />
            <Jogging />
            <div className="absolute left-3 top-[225px]">
                <TouchControls />
            </div>
        </div>
    );
}
