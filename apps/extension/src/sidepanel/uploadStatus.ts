export type UploadPlan = "free" | "premium";

export type UploadCapacity = {
  plan: UploadPlan;
  isPremium: boolean;
  limits: {
    maxUploadBytes: number;
    maxDocumentCharacters: number;
    maxPdfPages: number;
  };
};

export type DocumentUploadPhase =
  | "downloading"
  | "checking"
  | "uploading"
  | "processing"
  | "ready"
  | "gated"
  | "failed"
  | "cancelled"
  | "local";

export type DocumentUploadStatus = {
  phase: DocumentUploadPhase;
  fileName: string;
  fileSize: number;
  startedAt: number;
  transferStartedAt?: number;
  processingStartedAt?: number;
  finishedAt?: number;
  loadedBytes: number;
  totalBytes: number;
  capacity?: UploadCapacity;
  message?: string;
};

export type UploadCapacityGate = {
  blocked: boolean;
  upgradeRequired: boolean;
  message?: string;
};

export function evaluateUploadCapacity(fileSize: number, capacity: UploadCapacity): UploadCapacityGate {
  if (fileSize <= capacity.limits.maxUploadBytes) {
    return { blocked: false, upgradeRequired: false };
  }

  if (capacity.isPremium) {
    return {
      blocked: true,
      upgradeRequired: false,
      message: `This file is ${formatBytes(fileSize)}, above ReadMate's ${formatBytes(capacity.limits.maxUploadBytes)} maximum upload size.`
    };
  }

  return {
    blocked: true,
    upgradeRequired: true,
    message: `This file is ${formatBytes(fileSize)}, above the Free plan limit of ${formatBytes(capacity.limits.maxUploadBytes)}. Premium is required to add it to your Library.`
  };
}

export function uploadPercent(loadedBytes: number, totalBytes: number): number {
  if (!Number.isFinite(loadedBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((loadedBytes / totalBytes) * 100)));
}

export function estimateUploadRemainingSeconds(
  loadedBytes: number,
  totalBytes: number,
  transferStartedAt: number | undefined,
  now: number
): number | null {
  if (!transferStartedAt || loadedBytes <= 0 || totalBytes <= loadedBytes) return null;
  const elapsedSeconds = (now - transferStartedAt) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0.75) return null;
  const bytesPerSecond = loadedBytes / elapsedSeconds;
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  return Math.max(1, Math.ceil((totalBytes - loadedBytes) / bytesPerSecond));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  const decimals = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function uploadElapsedSeconds(status: DocumentUploadStatus, now: number): number {
  const startedAt = status.phase === "processing" && status.processingStartedAt
    ? status.processingStartedAt
    : status.startedAt;
  const finishedAt = status.finishedAt ?? now;
  return Math.max(0, Math.floor((finishedAt - startedAt) / 1000));
}

export function uploadPlanSummary(capacity: UploadCapacity | undefined, phase?: DocumentUploadPhase): string {
  if (!capacity) {
    if (phase === "ready") return "Saved after ReadMate verified the document limits";
    if (phase === "gated") return "ReadMate checked the account and document limits";
    if (phase === "local") return "Local playback only · not saved to Library";
    if (phase === "failed" || phase === "cancelled") return "Plan limits were not confirmed";
    return "Plan and document limits will be verified before saving";
  }
  const plan = capacity.isPremium ? "Premium" : "Free";
  return `${plan} plan · ${formatBytes(capacity.limits.maxUploadBytes)} per file · up to ${capacity.limits.maxPdfPages.toLocaleString()} PDF pages`;
}
