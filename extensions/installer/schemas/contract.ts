import { z } from 'zod';

/**
 * Provider protocol version for installer providers.
 * Bump only on breaking changes.
 */
export const INSTALLER_PROVIDER_PROTOCOL_VERSION = '1.0.0' as const;

export const InstallerInstallInputSchema = z.object({
  src: z.string().min(1),
  dest: z.string().min(1),
  force: z.boolean().optional().default(false)
});
export type InstallerInstallInput = z.infer<typeof InstallerInstallInputSchema>;

export const InstallerIsValidSrcInputSchema = z.object({
  src: z.string().min(1)
});
export type InstallerIsValidSrcInput = z.infer<typeof InstallerIsValidSrcInputSchema>;

export const InstallerIsValidSrcOutputSchema = z.boolean();
export type InstallerIsValidSrcOutput = z.infer<typeof InstallerIsValidSrcOutputSchema>;

export const InstallerInstallOutputSchema = z.object({
  ok: z.literal(true),
  provider: z.string().min(1)
});
export type InstallerInstallOutput = z.infer<typeof InstallerInstallOutputSchema>;

export const InstallerPickProviderInputSchema = z.object({
  src: z.string().min(1)
});
export type InstallerPickProviderInput = z.infer<typeof InstallerPickProviderInputSchema>;

export const InstallerPickProviderOutputSchema = z.object({
  provider: z.string().default('')
});
export type InstallerPickProviderOutput = z.infer<typeof InstallerPickProviderOutputSchema>;

