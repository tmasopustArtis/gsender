import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    listJobs,
    claimJob,
    completeJob,
    releaseJob,
    setOrderMeta,
    sanitizeMachineName,
    JobQueueError,
} from '../jobQueue';

let base;
let root;

const makeOrder = (name, files = { 'job.nc': 'G0 X1\n' }, extra = ['design.crv']) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    Object.entries(files).forEach(([f, c]) => fs.writeFileSync(path.join(dir, f), c));
    extra.forEach((f) => fs.writeFileSync(path.join(dir, f), 'vcarve'));
};

const exists = (...p) => fs.existsSync(path.join(root, ...p));
const carvedExists = (...p) => fs.existsSync(path.join(base, 'Carved', ...p));

beforeEach(() => {
    // <base>/ORDERS is the queue; <base>/Carved is its peer.
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'signs-'));
    root = path.join(base, 'ORDERS');
    fs.mkdirSync(root);
    fs.mkdirSync(path.join(base, 'Carved'));
});

afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
});

describe('jobQueue', () => {
    it('lists queued orders with their G-code files and ignores reserved folders', async () => {
        makeOrder('Order 2', { 'b.nc': 'x', 'a.gcode': 'x' });
        makeOrder('Order 10');
        fs.mkdirSync(path.join(root, 'SALES', 'Some Customer'), { recursive: true });
        fs.mkdirSync(path.join(root, 'InProgress', 'M1', 'Busy'), { recursive: true });

        const res = await listJobs({ ordersPath: root, machineName: 'M1' });

        expect(res.queued.map((o) => o.name).sort()).toEqual(['Order 10', 'Order 2']);
        expect(res.queued.find((o) => o.name === 'Order 2').files).toEqual(['a.gcode', 'b.nc']);
        expect(res.carved).toBeUndefined();
        expect(res.inProgress.map((o) => [o.machine, o.name])).toEqual([['M1', 'Busy']]);
    });

    it('claims an order into InProgress/<machine> and returns the G-code', async () => {
        makeOrder('Order 1', { 'job.nc': 'G1 X5\n' });

        const claimed = await claimJob({ ordersPath: root, machineName: 'Router 1', order: 'Order 1' });

        expect(claimed.file).toBe('job.nc');
        expect(claimed.data).toBe('G1 X5\n');
        expect(exists('Order 1')).toBe(false);
        expect(exists('InProgress', 'Router 1', 'Order 1', 'job.nc')).toBe(true);
        expect(exists('InProgress', 'Router 1', 'Order 1', 'design.crv')).toBe(true);
    });

    it('only lets one machine claim the same order', async () => {
        makeOrder('Order 1');

        const results = await Promise.allSettled([
            claimJob({ ordersPath: root, machineName: 'A', order: 'Order 1' }),
            claimJob({ ordersPath: root, machineName: 'B', order: 'Order 1' }),
        ]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((r) => r.status === 'rejected');
        expect(rejected.reason).toBeInstanceOf(JobQueueError);
        expect(rejected.reason.status).toBe(409);
    });

    it('files a completed order in Carved/<first 2 digits>/ next to the Orders folder', async () => {
        makeOrder('1234567890');
        await claimJob({ ordersPath: root, machineName: 'A', order: '1234567890' });
        const done = await completeJob({ ordersPath: root, machineName: 'A', order: '1234567890' });

        expect(carvedExists('12', '1234567890', 'job.nc')).toBe(true);
        expect(carvedExists('12', '1234567890', 'design.crv')).toBe(true);
        expect(done.movedTo).toBe(path.join(base, 'Carved', '12', '1234567890'));
        expect(exists('InProgress', 'A', '1234567890')).toBe(false);
        // nothing is created inside the queue folder
        expect(fs.readdirSync(root).sort()).toEqual(['InProgress']);
    });

    it('reuses an existing 2-digit folder and keeps older copies with the same number', async () => {
        fs.mkdirSync(path.join(base, 'Carved', '98', '9876543210'), { recursive: true });
        makeOrder('9876543210');
        await claimJob({ ordersPath: root, machineName: 'A', order: '9876543210' });
        await completeJob({ ordersPath: root, machineName: 'A', order: '9876543210' });

        expect(fs.readdirSync(path.join(base, 'Carved', '98'))).toHaveLength(2);
        expect(fs.readdirSync(path.join(base, 'Carved'))).toEqual(['98']);
    });

    it('puts non-numeric order names in Carved/Other', async () => {
        makeOrder('Custom Sign');
        await claimJob({ ordersPath: root, machineName: 'A', order: 'Custom Sign' });
        await completeJob({ ordersPath: root, machineName: 'A', order: 'Custom Sign' });
        expect(carvedExists('Other', 'Custom Sign', 'job.nc')).toBe(true);
    });

    it('honours an explicit Carved folder and refuses to guess a missing one', async () => {
        const elsewhere = path.join(base, 'Archive');
        fs.mkdirSync(elsewhere);
        makeOrder('5555555555');
        await claimJob({ ordersPath: root, machineName: 'A', order: '5555555555' });
        await expect(
            completeJob({ ordersPath: root, machineName: 'A', order: '5555555555', carvedPath: path.join(base, 'Typo') }),
        ).rejects.toMatchObject({ status: 404 });
        expect(exists('InProgress', 'A', '5555555555')).toBe(true);

        await completeJob({ ordersPath: root, machineName: 'A', order: '5555555555', carvedPath: elsewhere });
        expect(fs.existsSync(path.join(elsewhere, '55', '5555555555', 'job.nc'))).toBe(true);
    });

    it('releases an in-progress order back to the queue', async () => {
        makeOrder('Order 1');
        await claimJob({ ordersPath: root, machineName: 'A', order: 'Order 1' });
        await releaseJob({ ordersPath: root, machineName: 'A', order: 'Order 1' });
        expect(exists('Order 1', 'job.nc')).toBe(true);
        expect(exists('InProgress', 'A', 'Order 1')).toBe(false);
    });

    it('refuses to complete an order this machine does not have', async () => {
        makeOrder('Order 1');
        await claimJob({ ordersPath: root, machineName: 'A', order: 'Order 1' });
        await expect(
            completeJob({ ordersPath: root, machineName: 'B', order: 'Order 1' }),
        ).rejects.toMatchObject({ status: 404 });
    });

    it('rejects path traversal and reserved names', async () => {
        makeOrder('Order 1');
        for (const order of ['..', '../x', 'a/b', 'a\\b', 'InProgress', 'carved', 'Sales', '']) {
            await expect(
                claimJob({ ordersPath: root, machineName: 'A', order }),
            ).rejects.toBeInstanceOf(JobQueueError);
        }
        await expect(
            claimJob({ ordersPath: root, machineName: 'A', order: 'Order 1', file: '../../etc/passwd' }),
        ).rejects.toBeInstanceOf(JobQueueError);
        expect(sanitizeMachineName('../Router/1')).toBe('_Router_1');
        expect(() => sanitizeMachineName('  ')).toThrow(JobQueueError);
    });

    it('reports an unreachable Orders folder clearly', async () => {
        await expect(
            listJobs({ ordersPath: path.join(root, 'nope'), machineName: 'A' }),
        ).rejects.toMatchObject({ status: 404 });
        await expect(
            listJobs({ ordersPath: 'relative/path', machineName: 'A' }),
        ).rejects.toBeInstanceOf(JobQueueError);
    });

    it('reads, writes and carries order.json tags with the order', async () => {
        makeOrder('Order 1', undefined, []);
        fs.writeFileSync(
            path.join(root, 'Order 1', 'order.json'),
            JSON.stringify({ material: 'PVC', size: '12x18', color: 'Black', note: 'keep me' }),
        );
        makeOrder('Order 2');

        let res = await listJobs({ ordersPath: root, machineName: 'A' });
        expect(res.queued.find((o) => o.name === 'Order 1').meta).toEqual({ material: 'PVC', size: '12x18', color: 'Black' });
        expect(res.queued.find((o) => o.name === 'Order 2').meta).toEqual({ material: '', size: '', color: '' });

        const saved = await setOrderMeta({
            ordersPath: root,
            order: 'Order 1',
            meta: { material: ' Wood ', size: '12  x 18', color: 'Red', evil: 'x' },
        });
        expect(saved.meta).toEqual({ material: 'Wood', size: '12 x 18', color: 'Red' });
        const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'Order 1', 'order.json'), 'utf8'));
        expect(onDisk.note).toBe('keep me');
        expect(onDisk.evil).toBeUndefined();
        expect(fs.readdirSync(path.join(root, 'Order 1')).some((f) => f.endsWith('.tmp'))).toBe(false);

        await claimJob({ ordersPath: root, machineName: 'A', order: 'Order 1' });
        res = await listJobs({ ordersPath: root, machineName: 'A' });
        expect(res.inProgress[0].meta.material).toBe('Wood');
        await expect(
            setOrderMeta({ ordersPath: root, order: 'Order 1', meta: {} }),
        ).rejects.toMatchObject({ status: 404 });
        await expect(
            setOrderMeta({ ordersPath: root, order: '../x', meta: {} }),
        ).rejects.toBeInstanceOf(JobQueueError);
    });
});
