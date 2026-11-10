/*
 * Client for the central order tool (ArtisDesigns API). The tool owns job status and every
 * folder move; gSender only lists jobs, claims one, reads its G-code, and reports back.
 *
 *   GET  /api/queue?status=queued,in_progress
 *   POST /api/queue/:id/claim      { machine }
 *   GET  /api/queue/:id/files/:name
 *   POST /api/queue/:id/complete   { machine, file, durationSeconds, finishedAt }
 *   POST /api/queue/:id/release    { machine }
 */
import http from 'http';
import https from 'https';
import { JobQueueError, sanitizeMachineName } from './jobQueue';

const TIMEOUT_MS = 10000;

const baseUrl = (centralUrl) => {
    let url;
    try {
        url = new URL(String(centralUrl || '').trim());
    } catch (err) {
        throw new JobQueueError('Enter the address of the central order tool (for example http://192.168.10.206:3001)');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new JobQueueError('The central order tool address must start with http:// or https://');
    }
    return url.toString().replace(/\/+$/, '');
};

// Minimal JSON/text request so we do not depend on the Node/Electron version having fetch.
const request = (method, url, { key, body, text } = {}) =>
    new Promise((resolve, reject) => {
        const payload = body === undefined ? null : JSON.stringify(body);
        const lib = url.startsWith('https:') ? https : http;
        const req = lib.request(
            url,
            {
                method,
                timeout: TIMEOUT_MS,
                // New connection each time: we poll every 15s, longer than a server keeps an idle connection open,
                // and reusing one the server already closed can hang until the timeout.
                agent: false,
                headers: {
                    Accept: text ? 'text/plain' : 'application/json',
                    ...(key ? { 'X-Api-Key': key } : {}),
                    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let data = raw;
                    if (!text) {
                        try {
                            data = raw ? JSON.parse(raw) : {};
                        } catch (err) {
                            data = { error: raw.slice(0, 200) };
                        }
                    }
                    resolve({ status: res.statusCode, data });
                });
            },
        );
        req.on('timeout', () => req.destroy(new Error('timed out')));
        req.on('error', reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });

const call = async (method, url, options) => {
    let res;
    try {
        res = await request(method, url, options);
    } catch (err) {
        throw new JobQueueError(`Cannot reach the central order tool (${err.message})`, 502);
    }
    if (res.status >= 200 && res.status < 300) {
        return res.data;
    }
    const message = (res.data && res.data.error) || `The central order tool answered ${res.status}`;
    // 401/403/404/409 mean something specific to the user; anything else is the tool's problem.
    throw new JobQueueError(message, [401, 403, 404, 409].includes(res.status) ? res.status : 502);
};

const label = (job) =>
    job.itemCount > 1 ? `${job.orderNumber} (item ${job.itemIndex} of ${job.itemCount})` : String(job.orderNumber);

// Central job -> the shape the Jobs list already uses for folder orders.
export const toQueueOrder = (job) => ({
    id: job.id,
    name: label(job),
    files: Array.isArray(job.gcodeFiles) ? job.gcodeFiles : [],
    modified: Date.parse(job.orderedAt) || 0,
    meta: { material: job.material || '', size: job.size || '', color: job.color || '' },
    machine: job.machine || undefined,
    platform: job.platform,
    shipBy: job.shipBy || undefined,
    title: job.title || undefined,
    personalization: job.personalization || undefined,
});

const idPath = (id) => {
    if (typeof id !== 'string' || !id || id.length > 120 || /[\s/\\]/.test(id)) {
        throw new JobQueueError('Invalid job id');
    }
    return encodeURIComponent(id);
};

export const listJobs = async ({ centralUrl, centralKey, machineName }) => {
    const base = baseUrl(centralUrl);
    const machine = sanitizeMachineName(machineName);
    const data = await call('GET', `${base}/api/queue?status=queued,in_progress`, { key: centralKey });
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    return {
        ordersPath: base,
        machine,
        queued: jobs.filter((j) => j.status === 'queued').map(toQueueOrder),
        inProgress: jobs.filter((j) => j.status === 'in_progress').map(toQueueOrder),
        // the tool sends these when a platform (e.g. Etsy) could not be reached and it is showing saved jobs
        warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : [],
    };
};

export const claimJob = async ({ centralUrl, centralKey, machineName, order, file }) => {
    const base = baseUrl(centralUrl);
    const machine = sanitizeMachineName(machineName);
    const id = idPath(order);
    const { job } = await call('POST', `${base}/api/queue/${id}/claim`, { key: centralKey, body: { machine } });
    const files = Array.isArray(job && job.gcodeFiles) ? job.gcodeFiles : [];
    const chosen = file || files[0];
    if (!chosen || !files.includes(chosen)) {
        throw new JobQueueError('The central order tool has no G-code file for that job');
    }
    const url = `${base}/api/queue/${id}/files/${encodeURIComponent(chosen)}`;
    const data = await call('GET', url, { key: centralKey, text: true });
    return { order: job.id, file: chosen, path: url, size: Buffer.byteLength(data), data };
};

export const completeJob = async ({ centralUrl, centralKey, machineName, order, file, durationSeconds, finishedAt }) => {
    const base = baseUrl(centralUrl);
    const machine = sanitizeMachineName(machineName);
    const body = { machine };
    if (file) body.file = String(file);
    if (Number.isFinite(Number(durationSeconds))) body.durationSeconds = Math.round(Number(durationSeconds));
    body.finishedAt = finishedAt || new Date().toISOString();
    const { job } = await call('POST', `${base}/api/queue/${idPath(order)}/complete`, { key: centralKey, body });
    return { order: job.id, movedTo: 'Carved' };
};

export const releaseJob = async ({ centralUrl, centralKey, machineName, order }) => {
    const base = baseUrl(centralUrl);
    const machine = sanitizeMachineName(machineName);
    const { job } = await call('POST', `${base}/api/queue/${idPath(order)}/release`, { key: centralKey, body: { machine } });
    return { order: job.id };
};

export const setOrderMeta = async () => {
    throw new JobQueueError('Material, size and color come from the central order tool and cannot be edited here');
};
