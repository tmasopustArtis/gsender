/*
 * Where macros are stored.
 *
 * By default macros live in this computer's settings file (~/.sender_rc). When a shared file is
 * configured (for example on the NAS) every machine reads and writes that one file instead, so a
 * macro added on one machine shows up on all of them.
 *
 * The settings file keeps a copy of the last shared version. If the NAS can't be reached, macros
 * can still be listed and run from that copy; changes are refused until the NAS is back, so the
 * machines never drift apart.
 */
import fs from 'fs';
import path from 'path';
import config from '../services/configstore';

export const MACROS_KEY = 'macros';
export const SHARED_FILE_KEY = 'macrosSharedFile';
export const MACHINE_KEY = 'macrosMachine';

const asArray = (v) => (Array.isArray(v) ? v : []);

export const getSharedFile = () => String(config.get(SHARED_FILE_KEY, '') || '');

const readShared = (file) => {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return asArray(Array.isArray(parsed) ? parsed : parsed.macros);
};

// Write to a temp file and rename, so another machine never reads a half-written file.
const writeShared = (file, records) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ macros: records }, null, 2));
    fs.renameSync(tmp, file);
};

export const isSharedAvailable = () => {
    const file = getSharedFile();
    if (!file) {
        return true;
    }
    try {
        readShared(file);
        return true;
    } catch (err) {
        return false;
    }
};

export const getMacros = () => {
    const file = getSharedFile();
    if (file) {
        try {
            const records = readShared(file);
            config.set(MACROS_KEY, records, { silent: true }); // keep the offline copy fresh
            return records;
        } catch (err) {
            // fall through to the local copy
        }
    }
    return asArray(config.get(MACROS_KEY, []));
};

export const setMacros = (records, options = {}) => {
    const file = getSharedFile();
    if (file) {
        try {
            writeShared(file, records);
        } catch (err) {
            throw new Error(`The shared macros file is not reachable (${file}): ${err.message}`);
        }
    }
    config.set(MACROS_KEY, records, options);
};

/**
 * Point macros at a shared file ('' = back to this computer only). If the file does not exist yet it
 * is created from this computer's macros; if it exists, its macros are used as they are.
 */
export const useSharedFile = (file) => {
    const target = String(file || '').trim();
    if (!target) {
        config.set(SHARED_FILE_KEY, '');
        return { file: '', created: false };
    }
    let created = false;
    try {
        readShared(target);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw new Error(`Cannot use ${target}: ${err.message}`);
        }
        writeShared(target, asArray(config.get(MACROS_KEY, [])));
        created = true;
    }
    config.set(SHARED_FILE_KEY, target);
    return { file: target, created };
};

/*
 * Machine-specific macros: a name ending in _1, _2, _3 ... belongs to the machine whose name ends
 * with that number ("Router 1" runs "Surface_1"). They are hidden on, and refused by, every other
 * machine. The rule only applies once this machine has a name (set in the Jobs settings).
 */
const SUFFIX = /_(\d+)\s*$/;

export const getMachine = () => String(config.get(MACHINE_KEY, '') || '');

export const setMachine = (name) => {
    config.set(MACHINE_KEY, String(name || '').trim());
};

export const machineNumber = (machineName) => {
    const m = String(machineName || '').trim().match(/(\d+)$/);
    return m ? Number(m[1]) : null;
};

export const isVisibleHere = (macro, machineName = getMachine()) => {
    const m = String((macro && macro.name) || '').match(SUFFIX);
    if (!m || !String(machineName || '').trim()) {
        return true;
    }
    return machineNumber(machineName) === Number(m[1]);
};

/** The macros this machine may list and run. getMacros() is everything, which edits must keep intact. */
export const getVisibleMacros = () => {
    const machine = getMachine();
    return getMacros().filter((macro) => isVisibleHere(macro, machine));
};
