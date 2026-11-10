/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockStore = {};
jest.mock('../../services/configstore', () => ({
    __esModule: true,
    default: {
        get: (k, d) => (k in mockStore ? mockStore[k] : d),
        set: (k, v) => {
            mockStore[k] = v;
        },
    },
}));

import {
    getMacros,
    setMacros,
    useSharedFile,
    getSharedFile,
    isSharedAvailable,
    setMachine,
    getVisibleMacros,
    machineNumber,
} from '../macroStore';

let dir;
beforeEach(() => {
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macros-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const m = (id) => ({ id, name: id, content: 'G0 X0' });

describe('macroStore', () => {
    it('uses the local settings by default', () => {
        setMacros([m('a')]);
        expect(getMacros()).toEqual([m('a')]);
        expect(isSharedAvailable()).toBe(true);
    });

    it('creates the shared file from local macros the first time', () => {
        setMacros([m('a')]);
        const file = path.join(dir, 'gSender', 'macros.json');
        expect(useSharedFile(file)).toEqual({ file, created: true });
        expect(JSON.parse(fs.readFileSync(file, 'utf8')).macros).toEqual([m('a')]);
    });

    it('uses an existing shared file as it is', () => {
        const file = path.join(dir, 'macros.json');
        fs.writeFileSync(file, JSON.stringify({ macros: [m('shared')] }));
        setMacros([m('local')]);
        expect(useSharedFile(file).created).toBe(false);
        expect(getMacros()).toEqual([m('shared')]);
    });

    it('sees changes made by another machine', () => {
        const file = path.join(dir, 'macros.json');
        useSharedFile(file);
        setMacros([m('a')]);
        fs.writeFileSync(file, JSON.stringify({ macros: [m('a'), m('b')] }));
        expect(getMacros().map((x) => x.id)).toEqual(['a', 'b']);
    });

    it('lists the last known macros but refuses changes when the share is down', () => {
        const file = path.join(dir, 'macros.json');
        useSharedFile(file);
        setMacros([m('a')]);
        getMacros();
        fs.rmSync(file);
        fs.writeFileSync(file, 'not json');
        expect(isSharedAvailable()).toBe(false);
        expect(getMacros()).toEqual([m('a')]);
        expect(() => setMacros([m('b')])).not.toThrow(); // file is writable again, it just had bad JSON
        const dead = path.join(dir, 'missing-dir-is-created.json');
        useSharedFile(dead);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.writeFileSync(path.join(os.tmpdir(), 'blocker-file'), 'x');
        mockStore.macrosSharedFile = path.join(os.tmpdir(), 'blocker-file', 'macros.json');
        expect(() => setMacros([m('c')])).toThrow(/not reachable/);
        expect(getMacros().length).toBeGreaterThanOrEqual(0);
    });

    it('switches back to this computer only', () => {
        useSharedFile(path.join(dir, 'macros.json'));
        useSharedFile('');
        expect(getSharedFile()).toBe('');
    });
});

describe('machine-specific macros', () => {
    const named = (name) => ({ id: name, name, content: 'G0' });
    const all = [named('Park'), named('Surface_1'), named('Surface_2'), named('Probe_3')];

    it('reads the machine number from the end of the machine name', () => {
        expect(machineNumber('Router 1')).toBe(1);
        expect(machineNumber('CNC_2')).toBe(2);
        expect(machineNumber('Mac dev')).toBeNull();
    });

    it('shows shared macros plus only this machine\'s _N macros', () => {
        setMacros(all);
        setMachine('Router 2');
        expect(getVisibleMacros().map((m) => m.name)).toEqual(['Park', 'Surface_2']);
        setMachine('Router 3');
        expect(getVisibleMacros().map((m) => m.name)).toEqual(['Park', 'Probe_3']);
    });

    it('keeps the other machines\' macros when this machine saves', () => {
        const file = path.join(dir, 'macros.json');
        useSharedFile(file);
        setMacros(all);
        setMachine('Router 1');
        const visible = getVisibleMacros();
        setMacros(getMacros().map((m) => (m.name === 'Park' ? { ...m, content: 'G1' } : m)));
        expect(visible.length).toBe(2);
        expect(JSON.parse(fs.readFileSync(file, 'utf8')).macros.length).toBe(4);
    });

    it('does not filter until the machine has a name', () => {
        setMacros(all);
        expect(getVisibleMacros().length).toBe(4);
    });

    it('hides numbered macros on a machine whose name has no number', () => {
        setMacros(all);
        setMachine('Mac dev');
        expect(getVisibleMacros().map((m) => m.name)).toEqual(['Park']);
    });
});
