import { detectSignSize, parseOrderSize, sizeMatches } from '../signSize';

const mm = (inches: number) => inches * 25.4;

describe('detectSignSize', () => {
    it('rounds a square toolpath up to the standard size', () => {
        expect(detectSignSize(mm(23.4), mm(23.6))?.label).toBe('24');
        expect(detectSignSize(mm(11.2), mm(11.2))?.label).toBe('12');
    });
    it('reports rectangles as largest x smallest', () => {
        expect(detectSignSize(mm(9.5), mm(47.2))?.label).toBe('48x10');
        expect(detectSignSize(mm(23.5), mm(15.4))?.label).toBe('24x16');
    });
    it('allows slight overshoot and rejects empty boxes', () => {
        expect(detectSignSize(mm(24.2), mm(24.2))?.label).toBe('24');
        expect(detectSignSize(0, 5)).toBeNull();
    });
});

describe('sizeMatches', () => {
    const d = detectSignSize(mm(11.5), mm(11.5))!;
    it('flags a 12in file for a 24in order', () => {
        expect(sizeMatches(d, '24')).toBe(false);
        expect(sizeMatches(d, '12')).toBe(true);
    });
    it('compares rectangles regardless of orientation', () => {
        expect(sizeMatches(detectSignSize(mm(29.5), mm(35.5))!, '36x30')).toBe(true);
        expect(sizeMatches(detectSignSize(mm(47), mm(9.8))!, '10 x 48')).toBe(true);
    });
    it('returns null when the order has no usable size', () => {
        expect(sizeMatches(d, '')).toBeNull();
        expect(parseOrderSize('big')).toBeNull();
    });
});
