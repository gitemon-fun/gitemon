/**
 * v14.1: the sky's light on the 3D pieces (an environment map) is on by default, except on the GPUs of
 * the open blank-map report (AMD Radeon 740M-class integrated graphics on Direct3D 11) until a frame
 * check from one of them comes back drawn. `?env=1` / `?env=0` force it either way.
 */
export const ENV_RISKY = /Radeon[^,)]*\b7[468]0M\b.*D3D11/i;

export function envLighting(search: string, gpu: string | null): boolean {
  const q = new URLSearchParams(search).get('env');
  if (q === '0') return false;
  if (q === '1') return true;
  return !(gpu && ENV_RISKY.test(gpu));
}
