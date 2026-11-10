import * as folderQueue from '../lib/jobQueue';
import * as centralQueue from '../lib/centralQueue';
import logger from '../lib/logger';
import { ERR_INTERNAL_SERVER_ERROR } from '../constants';

const log = logger('api:jobqueue');

const params = (req) => ({ ...req.query, ...req.body });

// `source: 'central'` talks to the central order tool; anything else uses the shared Orders folder.
const handle = (name) => async (req, res) => {
    try {
        const p = params(req);
        const impl = p.source === 'central' ? centralQueue : folderQueue;
        const fn = {
            list: impl.listJobs,
            claim: impl.claimJob,
            complete: impl.completeJob,
            release: impl.releaseJob,
            setMeta: impl.setOrderMeta,
        }[name];
        res.send(await fn(p));
    } catch (err) {
        if (err instanceof folderQueue.JobQueueError) {
            res.status(err.status).send({ msg: err.message });
            return;
        }
        log.error(`jobqueue ${name} failed: ${err.message}`);
        res.status(ERR_INTERNAL_SERVER_ERROR).send({ msg: `Job queue error: ${err.message}` });
    }
};

export const list = handle('list');
export const claim = handle('claim');
export const complete = handle('complete');
export const release = handle('release');
export const setMeta = handle('setMeta');
