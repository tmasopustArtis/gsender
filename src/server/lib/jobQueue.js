/*
 * Job queue backed by a shared "Orders" folder (e.g. on a NAS).
 *
 *   <Orders>/<OrderName>/...                     queued orders (one folder per order)
 *   <Orders>/InProgress/<machine>/<OrderName>/   claimed by a machine
 *   <Orders>/../Carved/<NN>/<OrderName>/         finished successfully, where <NN> is
 *                                                the first two digits of the order
 *                                                number (keeps each folder small)
 *
 * Moving a folder with rename() is atomic on the same share, so when several
 * machines try to claim the same order only one rename succeeds.
 */
import fs from 'fs';
import path from 'path';

export const IN_PROGRESS_DIR = 'InProgress';
export const CARVED_DIR = 'Carved';
// Sales holds customer proposals that are not orders yet, so it is never part of the queue.
export const SALES_DIR = 'Sales';
const RESERVED = [IN_PROGRESS_DIR, CARVED_DIR, SALES_DIR].map((n) => n.toLowerCase());
export const GCODE_EXTENSIONS = ['.nc', '.gcode', '.gc', '.ngc', '.tap', '.cnc', '.ncc'];
export const OTHER_SHARD = 'Other';
export const META_FILE = 'order.json';
const META_FIELDS = ['material', 'size', 'color'];

export class JobQueueError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'JobQueueError';
        this.status = status;
    }
}

export const sanitizeMachineName = (name) => {
    const clean = String(name || '')
        .trim()
        .replace(/[^\w .-]/g, '_')
        .replace(/^\.+/, '');
    if (!clean) {
        throw new JobQueueError('A machine name is required');
    }
    return clean;
};

// Names coming from the client must be a single path segment.
export const assertSafeName = (name, label = 'name') => {
    if (
        typeof name !== 'string' ||
        !name ||
        name === '.' ||
        name === '..' ||
        name !== path.basename(name) ||
        name.includes('/') ||
        name.includes('\\') ||
        name.includes('\0')
    ) {
        throw new JobQueueError(`Invalid ${label}`);
    }
    return name;
};

const assertOrderName = (name) => {
    assertSafeName(name, 'order name');
    if (RESERVED.includes(name.toLowerCase())) {
        throw new JobQueueError('Invalid order name');
    }
    return name;
};

const isGcodeFile = (file) => GCODE_EXTENSIONS.includes(path.extname(file).toLowerCase());

const assertOrdersPath = async (ordersPath) => {
    if (!ordersPath || typeof ordersPath !== 'string' || !path.isAbsolute(ordersPath)) {
        throw new JobQueueError('Orders folder must be an absolute path');
    }
    let stat;
    try {
        stat = await fs.promises.stat(ordersPath);
    } catch (err) {
        throw new JobQueueError(`Cannot reach Orders folder: ${ordersPath}`, 404);
    }
    if (!stat.isDirectory()) {
        throw new JobQueueError('Orders path is not a folder');
    }
    return path.resolve(ordersPath);
};

const listDirs = async (dir) => {
    let entries;
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
        if (err.code === 'ENOENT') {
            return [];
        }
        throw err;
    }
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
};

const listGcodeFiles = async (dir) => {
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        return entries
            .filter((e) => e.isFile() && !e.name.startsWith('.') && isGcodeFile(e.name))
            .map((e) => e.name)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (err) {
        return [];
    }
};

const cleanText = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 40) : '');

// order.json inside an order folder: { "material": "Wood", "size": "12x18", "color": "Black" }
export const normalizeMeta = (meta) =>
    META_FIELDS.reduce((out, key) => ({ ...out, [key]: cleanText(meta && meta[key]) }), {});

const readMeta = async (dir) => {
    try {
        return normalizeMeta(JSON.parse(await fs.promises.readFile(path.join(dir, META_FILE), 'utf8')));
    } catch (err) {
        return normalizeMeta({});
    }
};

const describeOrder = async (dir, name, extra = {}) => {
    const full = path.join(dir, name);
    let modified = 0;
    try {
        modified = (await fs.promises.stat(full)).mtimeMs;
    } catch (err) {
        // folder vanished between readdir and stat; leave modified at 0
    }
    return { name, files: await listGcodeFiles(full), modified, meta: await readMeta(full), ...extra };
};

// Carved lives next to the Orders folder unless a path is given explicitly.
const resolveCarvedRoot = async (root, carvedPath) => {
    const candidate = carvedPath ? carvedPath : path.join(path.dirname(root), CARVED_DIR);
    if (!path.isAbsolute(candidate)) {
        throw new JobQueueError('Carved folder must be an absolute path');
    }
    try {
        if ((await fs.promises.stat(candidate)).isDirectory()) {
            return path.resolve(candidate);
        }
    } catch (err) {
        // fall through to the error below
    }
    throw new JobQueueError(`Cannot reach Carved folder: ${candidate}`, 404);
};

// Etsy order numbers are 10 digits; Carved is split into folders by their first 2 digits.
export const carvedShard = (order) => (/^\d{2}/.test(order) ? order.slice(0, 2) : OTHER_SHARD);

// Rename, falling back to copy+delete if the move crosses filesystems.
const moveDir = async (from, to) => {
    try {
        await fs.promises.rename(from, to);
    } catch (err) {
        if (err.code !== 'EXDEV') {
            throw err;
        }
        await fs.promises.cp(from, to, { recursive: true, errorOnExist: true, force: false });
        await fs.promises.rm(from, { recursive: true, force: true });
    }
};

const uniqueDestination = async (dir, name) => {
    let candidate = path.join(dir, name);
    let n = 1;
    for (;;) {
        try {
            await fs.promises.access(candidate);
        } catch (err) {
            return candidate;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        candidate = path.join(dir, `${name} (${stamp}${n > 1 ? `-${n}` : ''})`);
        n += 1;
    }
};

export const listJobs = async ({ ordersPath, machineName }) => {
    const root = await assertOrdersPath(ordersPath);
    const machine = sanitizeMachineName(machineName);

    const queuedDirs = (await listDirs(root)).filter((d) => !RESERVED.includes(d.name.toLowerCase()));
    // Oldest first, so the queue behaves first-in first-out.
    const queued = (await Promise.all(queuedDirs.map((d) => describeOrder(root, d.name)))).sort(
        (a, b) => a.modified - b.modified || a.name.localeCompare(b.name, undefined, { numeric: true }),
    );

    const inProgressRoot = path.join(root, IN_PROGRESS_DIR);
    const inProgress = [];
    for (const machineDir of await listDirs(inProgressRoot)) {
        const dir = path.join(inProgressRoot, machineDir.name);
        for (const order of await listDirs(dir)) {
            inProgress.push(await describeOrder(dir, order.name, { machine: machineDir.name }));
        }
    }

    return {
        ordersPath: root,
        machine,
        queued,
        inProgress: inProgress.sort((a, b) => a.modified - b.modified),
    };
};

// Move an order from the queue into InProgress/<machine> and return the chosen G-code.
export const claimJob = async ({ ordersPath, machineName, order, file }) => {
    const root = await assertOrdersPath(ordersPath);
    const machine = sanitizeMachineName(machineName);
    assertOrderName(order);

    const source = path.join(root, order);
    const machineDir = path.join(root, IN_PROGRESS_DIR, machine);
    const destination = path.join(machineDir, order);

    const files = await listGcodeFiles(source);
    if (files.length === 0) {
        // Either it is gone (taken by another machine) or it has no G-code.
        try {
            await fs.promises.access(source);
        } catch (err) {
            throw new JobQueueError('That order is no longer in the queue (another machine may have taken it)', 409);
        }
        throw new JobQueueError('No G-code file found in that order folder');
    }
    const chosen = file ? assertSafeName(file, 'file name') : files[0];
    if (!files.includes(chosen)) {
        throw new JobQueueError('G-code file not found in that order');
    }

    await fs.promises.mkdir(machineDir, { recursive: true });
    try {
        await fs.promises.access(destination);
        throw new JobQueueError(`"${order}" is already in progress on this machine`, 409);
    } catch (err) {
        if (err instanceof JobQueueError) {
            throw err;
        }
    }

    try {
        await moveDir(source, destination);
    } catch (err) {
        if (err.code === 'ENOENT') {
            throw new JobQueueError('That order is no longer in the queue (another machine may have taken it)', 409);
        }
        throw err;
    }

    const filePath = path.join(destination, chosen);
    const data = await fs.promises.readFile(filePath, 'utf8');
    return { order, file: chosen, path: filePath, size: Buffer.byteLength(data), data };
};

export const completeJob = async ({ ordersPath, machineName, order, carvedPath }) => {
    const root = await assertOrdersPath(ordersPath);
    const machine = sanitizeMachineName(machineName);
    assertOrderName(order);

    const source = path.join(root, IN_PROGRESS_DIR, machine, order);
    try {
        await fs.promises.access(source);
    } catch (err) {
        throw new JobQueueError('That order is not in progress on this machine', 404);
    }
    const carvedRoot = await resolveCarvedRoot(root, carvedPath);
    const shardDir = path.join(carvedRoot, carvedShard(order));
    await fs.promises.mkdir(shardDir, { recursive: true });
    const destination = await uniqueDestination(shardDir, order);
    await moveDir(source, destination);
    return { order, movedTo: destination };
};

// Put an in-progress order back in the queue (e.g. job stopped or loaded by mistake).
export const releaseJob = async ({ ordersPath, machineName, order }) => {
    const root = await assertOrdersPath(ordersPath);
    const machine = sanitizeMachineName(machineName);
    assertOrderName(order);

    const source = path.join(root, IN_PROGRESS_DIR, machine, order);
    const destination = path.join(root, order);
    try {
        await fs.promises.access(source);
    } catch (err) {
        throw new JobQueueError('That order is not in progress on this machine', 404);
    }
    try {
        await fs.promises.access(destination);
        throw new JobQueueError(`An order named "${order}" is already in the queue`, 409);
    } catch (err) {
        if (err instanceof JobQueueError) {
            throw err;
        }
    }
    await moveDir(source, destination);
    return { order };
};

// Tag a queued order with material / size / color (written to order.json in its folder).
export const setOrderMeta = async ({ ordersPath, order, meta }) => {
    const root = await assertOrdersPath(ordersPath);
    assertOrderName(order);
    const dir = path.join(root, order);
    try {
        if (!(await fs.promises.stat(dir)).isDirectory()) {
            throw new Error('not a directory');
        }
    } catch (err) {
        throw new JobQueueError('That order is no longer in the queue', 404);
    }
    // Keep any other keys someone put in the file; only touch ours.
    let existing = {};
    try {
        existing = JSON.parse(await fs.promises.readFile(path.join(dir, META_FILE), 'utf8')) || {};
    } catch (err) {
        existing = {};
    }
    const merged = { ...existing, ...normalizeMeta(meta) };
    const tmp = path.join(dir, `.${META_FILE}.${process.pid}.tmp`);
    await fs.promises.writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`);
    await fs.promises.rename(tmp, path.join(dir, META_FILE));
    return { order, meta: normalizeMeta(merged) };
};
