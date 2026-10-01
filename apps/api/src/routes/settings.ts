import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { getUserId, type AuthedRequest } from "../auth.js";
import type { prisma as PrismaSingleton } from "../prisma.js";
import { isLocalLanguage, normalizeLocalLanguageVoice, normalizeTargetLanguage, SUPPORTED_TARGET_LANGUAGES } from "../localLanguage.js";
import { isPremiumTtsProvider, normalizeTtsProvider, normalizeTtsVoice } from "../ttsSchema.js";
import { entitlementForRequest, requirePremiumAudio, type MaybePromise, type ReadMateEntitlement } from "../entitlements.js";

const contentTypes = ["webpage", "selection", "pdf", "url", "rss", "news", "document"] as const;
const settingsSchema = z
  .object({
    provider: z.unknown().optional(),
    voice: z.string().min(1).max(100).optional(),
    speed: z.number().min(0.5).max(4).default(1),
    tone: z.string().max(200).optional().nullable(),
    targetLanguage: z.enum(SUPPORTED_TARGET_LANGUAGES).default("en"),
    autoScroll: z.boolean().default(true),
    highlightMode: z.enum(["sentence", "paragraph", "none"]).default("paragraph"),
    preferredContentTypes: z.array(z.enum(contentTypes)).min(1).max(contentTypes.length).default(["webpage", "pdf", "rss", "url"]),
    articlesPerFeed: z.number().int().min(1).max(50).default(10)
  })
  .transform((settings) => {
    const provider = normalizeTtsProvider(settings.provider);
    const targetLanguage = normalizeTargetLanguage(settings.targetLanguage);
    return {
      ...settings,
      provider,
      targetLanguage,
      voice: isLocalLanguage(targetLanguage)
        ? normalizeLocalLanguageVoice(targetLanguage, settings.voice)
        : normalizeTtsVoice(provider, settings.voice)
    };
  });

export type UserSettingsResponse = z.infer<typeof settingsSchema> & {
  userId: string;
  updatedAt: string;
};

export type SettingsRepository = {
  getOrCreateSettings(userId: string): Promise<UserSettingsResponse>;
  updateSettings(userId: string, input: z.infer<typeof settingsSchema>): Promise<UserSettingsResponse>;
};

type SettingsRouterDeps = {
  repository?: SettingsRepository;
  getEntitlement?: (req: AuthedRequest, userId: string) => MaybePromise<ReadMateEntitlement>;
};

export function settingsRouter(deps: SettingsRouterDeps = {}): Router {
  const router = createRouter();
  const repository = deps.repository ?? new PrismaSettingsRepository();
  const getEntitlement = deps.getEntitlement ?? entitlementForRequest;

  router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = getUserId(req);
    const settings = await repository.getOrCreateSettings(userId);
    const entitlement = await getEntitlement(req, userId);
    res.json(!entitlement.isPremium && settings.targetLanguage === "en" && isPremiumTtsProvider(settings.provider)
      ? { ...settings, provider: "google", voice: normalizeTtsVoice("google", undefined) }
      : settings);
  }));

  router.put("/", async (req: AuthedRequest, res: Response, next) => {
    try {
      const userId = getUserId(req);
      const payload = settingsSchema.parse(req.body);
      if (payload.targetLanguage === "en" && isPremiumTtsProvider(payload.provider)) requirePremiumAudio(await getEntitlement(req, userId));
      res.json(await repository.updateSettings(userId, payload));
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid settings." });
        return;
      }
      next(error);
    }
  });

  return router;
}

export class PrismaSettingsRepository implements SettingsRepository {
  async getOrCreateSettings(userId: string): Promise<UserSettingsResponse> {
    const prisma = await getPrisma();
    const settings = await prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId
      },
      update: {}
    });
    return serializeSettings(settings);
  }

  async updateSettings(userId: string, payload: z.infer<typeof settingsSchema>): Promise<UserSettingsResponse> {
    const prisma = await getPrisma();
    const settings = await prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        provider: payload.provider,
        voice: payload.voice,
        speed: payload.speed,
        tone: payload.tone ?? undefined,
        targetLanguage: payload.targetLanguage,
        autoScroll: payload.autoScroll,
        highlightMode: payload.highlightMode,
        preferredContentTypes: JSON.stringify(payload.preferredContentTypes),
        articlesPerFeed: payload.articlesPerFeed
      },
      update: {
        provider: payload.provider,
        voice: payload.voice,
        speed: payload.speed,
        tone: payload.tone ?? undefined,
        targetLanguage: payload.targetLanguage,
        autoScroll: payload.autoScroll,
        highlightMode: payload.highlightMode,
        preferredContentTypes: JSON.stringify(payload.preferredContentTypes),
        articlesPerFeed: payload.articlesPerFeed
      }
    });
    return serializeSettings(settings);
  }
}

async function getPrisma(): Promise<typeof PrismaSingleton> {
  const module = await import("../prisma.js");
  return module.prisma;
}

function serializeSettings(settings: any): UserSettingsResponse {
  const provider = normalizeTtsProvider(settings.provider);
  const targetLanguage = normalizeTargetLanguage(settings.targetLanguage);
  return {
    userId: settings.userId,
    provider,
    voice: isLocalLanguage(targetLanguage) ? normalizeLocalLanguageVoice(targetLanguage, settings.voice) : normalizeTtsVoice(provider, settings.voice),
    speed: settings.speed ?? 1,
    tone: settings.tone ?? undefined,
    targetLanguage,
    autoScroll: settings.autoScroll ?? true,
    highlightMode: settings.highlightMode ?? "paragraph",
    preferredContentTypes: parseContentTypes(settings.preferredContentTypes),
    articlesPerFeed: normalizeArticlesPerFeed(settings.articlesPerFeed),
    updatedAt: settings.updatedAt instanceof Date ? settings.updatedAt.toISOString() : settings.updatedAt
  };
}

function parseContentTypes(value: unknown): UserSettingsResponse["preferredContentTypes"] {
  if (typeof value !== "string") return ["webpage", "pdf", "rss", "url"];
  try {
    const parsed = JSON.parse(value);
    const allowed = new Set(contentTypes);
    const filtered = Array.isArray(parsed) ? parsed.filter((item) => allowed.has(item)) : [];
    return filtered.length ? filtered : ["webpage", "pdf", "rss", "url"];
  } catch {
    return ["webpage", "pdf", "rss", "url"];
  }
}

function normalizeArticlesPerFeed(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : 10;
}
