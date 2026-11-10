import FileControl from 'app/features/FileControl';
import JobControl from 'app/features/JobControl';
import Tools from 'app/features/Tools';

export const ToolArea = () => {
    return (
        <div className="grid grid-cols-3 portrait:grid-cols-1 gap-2 max-xl:gap-0.5 box-border w-full h-full portrait:gap-6 portrait:grid-rows-3">
            {/* min-h-0 keeps the Load File area (and its job queue) inside this strip instead of growing the row */}
            <div className="w-full min-h-0 p-1 max-xl:p-0.5 box-border order-1 portrait:order-2 portrait:mb-6">
                <FileControl />
            </div>
            <div className="w-full p-1 max-xl:p-0.5 box-border order-2 portrait:order-1">
                <JobControl />
            </div>
            <div className="w-full p-1  max-xl:p-0.5 box-border order-3 portrait:order-3">
                <Tools />
            </div>
        </div>
    );
};
