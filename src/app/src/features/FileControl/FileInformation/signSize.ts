// Quick sanity check of a G-code file's size against standard sign sizes (inches).
const STANDARD = [6, 8, 10, 12, 14, 16, 18, 20, 24, 30, 36, 42, 48, 60, 72, 96];
// Toolpaths sit inside the sign edge, so round UP to the next standard size, allowing a little overshoot.
const TOLERANCE = 0.3;

const roundUp = (inches: number): number => {
    const hit = STANDARD.find((s) => inches <= s + TOLERANCE);
    return hit ?? Math.ceil(inches);
};

export interface SignSize {
    w: number; // larger dimension, inches
    h: number; // smaller dimension, inches
    label: string; // "24" for square/round, "10x48" otherwise
}

/** Nominal sign size for a toolpath bounding box (mm). Returns null for an empty box. */
export const detectSignSize = (deltaXmm: number, deltaYmm: number): SignSize | null => {
    if (!(deltaXmm > 0) || !(deltaYmm > 0)) return null;
    const a = roundUp(deltaXmm / 25.4);
    const b = roundUp(deltaYmm / 25.4);
    const w = Math.max(a, b);
    const h = Math.min(a, b);
    return { w, h, label: w === h ? `${w}` : `${w}x${h}` };
};

/** Parse an order size ("24", "36x30", "10 x 48") into inches; null when unknown. */
export const parseOrderSize = (size: string): { w: number; h: number | null } | null => {
    const m = (size || '').toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/);
    if (!m) return null;
    const a = Number(m[1]);
    if (!m[2]) return { w: a, h: null };
    const b = Number(m[2]);
    return { w: Math.max(a, b), h: Math.min(a, b) };
};

/** Does the file's size agree with the order's size? A single number only has to match the largest side. */
export const sizeMatches = (detected: SignSize, orderSize: string): boolean | null => {
    const o = parseOrderSize(orderSize);
    if (!o) return null;
    if (o.h === null) return detected.w === o.w;
    return detected.w === o.w && detected.h === o.h;
};
