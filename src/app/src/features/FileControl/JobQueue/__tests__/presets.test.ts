import { detectPathMode, ORDERS_PRESETS } from '../presets';

describe('orders path presets', () => {
    it('recognises the Mac and Windows paths', () => {
        expect(detectPathMode(ORDERS_PRESETS.mac.path)).toBe('mac');
        expect(detectPathMode(` ${ORDERS_PRESETS.windows.path} `)).toBe('windows');
    });

    it('treats any other saved path as custom', () => {
        expect(detectPathMode('Z:\\Signs\\ORDERS')).toBe('custom');
    });

    it('falls back to an OS-based default when nothing is saved', () => {
        expect(['mac', 'windows']).toContain(detectPathMode(''));
    });

    it('uses the UNC path given for the Windows machines', () => {
        expect(ORDERS_PRESETS.windows.path).toBe('\\\\ArtisDesignsNAS\\ArtisDesigns\\Signs\\ORDERS');
    });
});

import { sharedMacrosPath } from '../presets';

describe('sharedMacrosPath', () => {
    it("puts the macros file under the share's Machines folder, using the same separators", () => {
        expect(sharedMacrosPath('/Volumes/ArtisDesigns/Signs/ORDERS')).toBe('/Volumes/ArtisDesigns/Machines/gsender/macros.json');
        expect(sharedMacrosPath('\\\\ArtisDesignsNAS\\ArtisDesigns\\Signs\\ORDERS\\')).toBe(
            '\\\\ArtisDesignsNAS\\ArtisDesigns\\Machines\\gsender\\macros.json',
        );
        expect(sharedMacrosPath('')).toBe('');
    });
});
