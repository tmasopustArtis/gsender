#!/usr/bin/env node
/*
 * Stand-in for the central order tool (ArtisDesigns API) so gSender's "Order tool" job source can be
 * developed and tested without the real tool, the NAS, or any platform account.
 * It keeps everything in memory and moves no files.
 *
 *   node scripts/mock-central-queue.js [port]      (default port 3101)
 *
 * Contract: src/app/docs/central-queue-tool-prompt.md
 */
const http = require('http');

const PORT = Number(process.argv[2]) || 3101;
const jobs = [
    ['etsy', '4214591185', 1, 1, 'Custom Northpoint Sign 36" W x 30" H White with Black Lettering PVC', 'PVC', '36x30', 'White with Black Lettering', '2026-11-10'],
    ['etsy', '4222889140', 1, 1, "Personalized Dad's Garage Sign", 'Wood', '24', 'Copper', '2026-11-10'],
    ['etsy', '4220674417', 1, 1, 'Personalized Pizzeria & Grill Sign', 'Wood', '30', 'Black', '2026-11-10'],
    ['etsy', '4222859172', 1, 1, "Carved 'Thankful' Front Porch Sign", '', '10x48', 'Rosewood', '2026-11-10'],
    ['etsy', '4222471114', 1, 1, 'Blue Heron Personalized Sign', 'PVC', '18', 'Dark Grey Blue', '2026-11-10'],
    ['etsy', '4222096378', 1, 1, 'Personalized Turtle Hot Tub Sign', 'PVC', '18', 'Clover', '2026-11-10'],
    ['etsy', '4223595696', 1, 1, 'Personalized Tiki Bar Sign', 'PVC', '24', 'Teal', '2026-11-10'],
    ['etsy', '4221875813', 1, 1, 'Carved Train Room Sign', 'Wood', '12', 'Hale Navy', '2026-11-10'],
    ['etsy', '4221622811', 1, 1, 'Blue Heron Personalized Sign', 'Wood', '12', 'Dark Grey Blue', '2026-11-10'],
    ['etsy', '4223333921', 1, 1, 'Custom Carved Pool Sign', 'PVC', '24', 'Rosewood', '2026-11-12'],
    ['etsy', '4225491789', 1, 1, 'Personalized Tiki Bar Sign', 'PVC', '18', 'Hale Navy', '2026-11-12'],
    ['etsy', '4226585630', 1, 1, 'Dog Paw Welcome Sign', '', '10x48', 'Walnut', '2026-11-12'],
    ['etsy', '4219616812', 1, 1, 'Custom Farm Sign 24"W x 16" H Black PVC', 'PVC', '24x16', 'Black', '2026-11-10'],
    ['etsy', '4062932387', 1, 2, 'Two-piece Lake House set', 'Wood', '18', 'Walnut', '2026-11-12'],
    ['etsy', '4062932387', 2, 2, 'Two-piece Lake House set', 'Wood', '18', 'Walnut', '2026-11-12'],
].map(([platform, orderNumber, itemIndex, itemCount, title, material, size, color, shipBy]) => ({
    id: `${platform}:${orderNumber}:${itemIndex}`,
    platform,
    orderNumber,
    itemIndex,
    itemCount,
    folderName: itemCount > 1 ? `${orderNumber}_${itemIndex}` : orderNumber,
    title,
    quantity: 1,
    material,
    size,
    color,
    personalization: null,
    shipBy,
    orderedAt: '2026-11-03T00:00:00.000Z',
    status: 'queued',
    machine: null,
    claimedAt: null,
    completedAt: null,
    // The two-sign order has several toolpaths per folder, like a real vcarve job (rough, finish, outline)
    gcodeFiles: itemCount > 1 ? ['1_roughing.nc', '2_finishing.tap', '3_outline.gcode'] : ['sign.nc'],
}));
// An order whose folder has not been created yet: the real tool reports no G-code files for it.
jobs.find((j) => j.orderNumber === '4226585630').gcodeFiles = [];

const gcode = (job) => `; mock G-code for ${job.id}\nG21\nG90\nG0 Z5\nG0 X0 Y0\nG1 Z-1 F300\nG1 X50 F600\nG0 Z5\nM2\n`;
const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        const url = new URL(req.url, 'http://localhost');
        console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}${url.search} ${raw}`);
        if (url.pathname === '/api/queue' && req.method === 'GET') {
            const want = (url.searchParams.get('status') || 'queued,in_progress').split(',');
            return send(res, 200, { jobs: jobs.filter((j) => want.includes(j.status)) });
        }
        const m = url.pathname.match(/^\/api\/queue\/([^/]+)\/(claim|complete|release|files\/(.+))$/);
        if (!m) return send(res, 404, { error: 'no such route' });
        const job = jobs.find((j) => j.id === decodeURIComponent(m[1]));
        if (!job) return send(res, 404, { error: 'unknown job' });
        const action = m[2].startsWith('files/') ? 'files' : m[2];
        if (action === 'files') return send(res, 200, gcode(job), 'text/plain');
        if (!body.machine) return send(res, 400, { error: 'machine is required' });
        if (action === 'claim') {
            if (job.status !== 'queued') return send(res, 409, { error: `Already ${job.status === 'in_progress' ? `in progress on ${job.machine}` : 'carved'}` });
            Object.assign(job, { status: 'in_progress', machine: body.machine, claimedAt: new Date().toISOString() });
        } else if (action === 'complete') {
            if (job.machine !== body.machine) return send(res, 409, { error: `Job belongs to ${job.machine}` });
            Object.assign(job, { status: 'carved', completedAt: body.finishedAt || new Date().toISOString() });
        } else {
            if (job.machine !== body.machine) return send(res, 409, { error: `Job belongs to ${job.machine}` });
            Object.assign(job, { status: 'queued', machine: null, claimedAt: null });
        }
        return send(res, 200, { job });
    });
}).listen(PORT, '127.0.0.1', () => console.log(`mock central queue on http://127.0.0.1:${PORT}`));
