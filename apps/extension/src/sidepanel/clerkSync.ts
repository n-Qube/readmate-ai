export type ClerkSyncOptions = {
  syncHost?: string;
  enableSyncHostListener: boolean;
};

export type ManifestLike = {
  permissions?: string[];
  host_permissions?: string[];
};

export function getClerkSyncOptions(manifest: ManifestLike | undefined, syncHost: string | undefined): ClerkSyncOptions {
  if (!syncHost) return { enableSyncHostListener: false };
  if (!manifestHasPermission(manifest, "cookies")) return { enableSyncHostListener: false };
  if (!manifest?.host_permissions?.length) return { enableSyncHostListener: false };
  return { syncHost, enableSyncHostListener: true };
}

function manifestHasPermission(manifest: ManifestLike | undefined, permission: string) {
  return manifest?.permissions?.includes(permission) ?? false;
}
