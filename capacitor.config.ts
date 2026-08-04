import type { CapacitorConfig } from '@capacitor/cli';
import { buildNativeConfig } from './scripts/native-build-profile';

/**
 * Release builds fail closed to locally packaged UI. The temporary
 * internal-remote profile must be explicitly selected and supplied a reviewed
 * credential-free HTTPS origin; see scripts/native-build-profile.ts.
 */
const config: CapacitorConfig = buildNativeConfig();

export default config;
