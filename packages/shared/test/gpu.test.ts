import { describe, expect, it } from 'vitest';
import { envLighting } from '../src/index.js';

const RADEON_740M =
  'ANGLE (AMD, AMD Radeon 740M Graphics (0x00001901) Direct3D11 vs_5_0 ps_5_0, D3D11)';

describe('environment map flag (v14.1)', () => {
  it('is on by default, off on the blank-map GPU class, and the URL wins', () => {
    expect(envLighting('', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620, OpenGL 4.6)')).toBe(true);
    expect(envLighting('', null)).toBe(true);
    expect(envLighting('', RADEON_740M)).toBe(false);
    expect(envLighting('?env=1', RADEON_740M)).toBe(true);
    expect(envLighting('?at=bloom&env=0', 'Apple GPU')).toBe(false);
  });
});
