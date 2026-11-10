/**
 * @jest-environment node
 */
import http from 'http';
import { listJobs, claimJob, completeJob, releaseJob, setOrderMeta, toQueueOrder } from '../centralQueue';

let server;
let url;
let jobs;
let seen; // requests the fake tool received

const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

beforeAll(async () => {
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : {};
            seen.push({ method: req.method, path: req.url, key: req.headers['x-api-key'], body });
            if (req.headers['x-api-key'] === 'wrong') return send(res, 401, { error: 'bad key' });
            const u = new URL(req.url, 'http://x');
            const m = u.pathname.match(/^\/api\/queue\/([^/]+)\/(claim|complete|release|files\/(.+))$/);
            if (u.pathname === '/api/queue') return send(res, 200, { jobs, ...(jobs.warnings ? { warnings: jobs.warnings } : {}) });
            if (!m) return send(res, 404, { error: 'no route' });
            const job = jobs.find((j) => j.id === decodeURIComponent(m[1]));
            if (!job) return send(res, 404, { error: 'unknown job' });
            if (m[2] === 'claim') {
                if (job.status !== 'queued') return send(res, 409, { error: `already claimed by ${job.machine}` });
                Object.assign(job, { status: 'in_progress', machine: body.machine });
                return send(res, 200, { job });
            }
            if (m[2].startsWith('files/')) return send(res, 200, `G0 X1 ; ${decodeURIComponent(m[3])}\n`, 'text/plain');
            if (m[2] === 'complete') {
                Object.assign(job, { status: 'carved' });
                return send(res, 200, { job });
            }
            Object.assign(job, { status: 'queued', machine: null });
            return send(res, 200, { job });
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}/`;
});

afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => {
    seen = [];
    jobs = [
        { id: 'etsy:4214591185:1', platform: 'etsy', orderNumber: '4214591185', itemIndex: 1, itemCount: 1, title: 'Custom Northpoint Sign', material: 'PVC', size: '36x30', color: 'White', shipBy: '2026-11-10', orderedAt: '2026-10-29T00:00:00.000Z', status: 'queued', machine: null, gcodeFiles: ['sign.nc'] },
        { id: 'etsy:4062932387:2', platform: 'etsy', orderNumber: '4062932387', itemIndex: 2, itemCount: 3, material: 'Wood', size: '24', color: 'Copper', status: 'queued', machine: null, gcodeFiles: ['a.nc', 'b.nc'] },
        { id: 'etsy:4222096378:1', platform: 'etsy', orderNumber: '4222096378', itemIndex: 1, itemCount: 1, status: 'in_progress', machine: 'Router 2', gcodeFiles: ['x.nc'] },
    ];
});

const target = () => ({ centralUrl: url, centralKey: 'secret', machineName: 'Router 1' });

describe('centralQueue', () => {
    it('lists queued and in-progress jobs in the shape the Jobs list uses', async () => {
        const res = await listJobs(target());
        expect(res.queued.map((o) => o.name)).toEqual(['4214591185', '4062932387 (item 2 of 3)']);
        expect(res.queued[0]).toMatchObject({
            id: 'etsy:4214591185:1',
            files: ['sign.nc'],
            meta: { material: 'PVC', size: '36x30', color: 'White' },
            platform: 'etsy',
            shipBy: '2026-11-10',
        });
        expect(res.inProgress).toHaveLength(1);
        expect(res.inProgress[0]).toMatchObject({ machine: 'Router 2', id: 'etsy:4222096378:1' });
        expect(seen[0].key).toBe('secret');
        expect(seen[0].path).toBe('/api/queue?status=queued,in_progress');
    });

    it('passes along the tool\'s warnings when it could not refresh a platform', async () => {
        jobs.warnings = ['etsy: could not load open orders'];
        const res = await listJobs(target());
        expect(res.warnings).toEqual(['etsy: could not load open orders']);
        expect((await listJobs({ ...target() })).warnings).toBeDefined();
    });

    it('claims a job and returns its G-code', async () => {
        const claimed = await claimJob({ ...target(), order: 'etsy:4062932387:2', file: 'b.nc' });
        expect(claimed).toMatchObject({ order: 'etsy:4062932387:2', file: 'b.nc' });
        expect(claimed.data).toBe('G0 X1 ; b.nc\n');
        expect(seen.find((r) => r.path.endsWith('/claim')).body).toEqual({ machine: 'Router 1' });
    });

    it('reports a job another machine already took as a 409', async () => {
        await expect(claimJob({ ...target(), order: 'etsy:4222096378:1' })).rejects.toMatchObject({
            status: 409,
            message: expect.stringContaining('Router 2'),
        });
    });

    it('reports completion with the file, duration and finish time', async () => {
        await completeJob({ ...target(), order: 'etsy:4214591185:1', file: 'sign.nc', durationSeconds: 1234.6, finishedAt: '2026-11-09T14:03:00Z' });
        expect(seen.find((r) => r.path.endsWith('/complete')).body).toEqual({
            machine: 'Router 1',
            file: 'sign.nc',
            durationSeconds: 1235,
            finishedAt: '2026-11-09T14:03:00Z',
        });
    });

    it('releases a job back to the queue', async () => {
        await releaseJob({ ...target(), order: 'etsy:4222096378:1' });
        expect(jobs[2].status).toBe('queued');
    });

    it('passes an authentication failure through clearly', async () => {
        await expect(listJobs({ ...target(), centralKey: 'wrong' })).rejects.toMatchObject({ status: 401, message: 'bad key' });
    });

    it('explains an unreachable tool and a bad address', async () => {
        await expect(listJobs({ ...target(), centralUrl: 'http://127.0.0.1:1/' })).rejects.toMatchObject({
            status: 502,
            message: expect.stringContaining('Cannot reach the central order tool'),
        });
        await expect(listJobs({ ...target(), centralUrl: 'not a url' })).rejects.toThrow('address of the central order tool');
        await expect(listJobs({ ...target(), centralUrl: 'ftp://x' })).rejects.toThrow('http://');
    });

    it('rejects ids that could change the request path, and read-only tag edits', async () => {
        await expect(claimJob({ ...target(), order: '../admin' })).rejects.toThrow('Invalid job id');
        await expect(setOrderMeta()).rejects.toThrow('central order tool');
        expect(toQueueOrder({ id: 'a', orderNumber: '1', itemCount: 1 }).files).toEqual([]);
    });
});
