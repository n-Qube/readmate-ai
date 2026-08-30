import { useAuth, useUser } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, type Href } from "expo-router";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode
} from "react";
import { ApiError, fetchJson } from "@/api/client";
import {
  deleteDocument,
  deleteSource,
  getDocuments,
  getEntitlements,
  getUserSettings,
  type SaveUrlResult
} from "@/api/documents";
import { defaultSettings } from "@/hooks/use-reading-library";
import { usePlaybackManager } from "@/playback/playback-manager";
import type { ReadingDocument, ReadMateEntitlement, SourceSubscription, UserSettings } from "@/types";
import { getProfileFirstName } from "@/utils/profile-name";
import { prependDocument } from "@/utils/document-list";
import { defaultVoiceForLanguage } from "@/config/local-voices";
import { isWebMcpAvailable } from "@/webmcp/feature-detection";
import { AddWebPageForm } from "@/webmcp/forms/add-web-page-form.web";
import { GenerateStudyPackForm } from "@/webmcp/forms/generate-study-pack-form.web";
import { SubscribeRssForm } from "@/webmcp/forms/subscribe-rss-form.web";
import { safeErrorOutput } from "@/webmcp/forms/form-utils";
import { webMcpColors } from "@/webmcp/forms/form-styles";
import type {
  AddWebPageInput,
  AgentActionCompletion,
  AgentActionErrorOutput,
  AgentActionExecutors,
  AgentActionOutput,
  AgentActionStatus,
  AgentSubmitEvent,
  DeclarativeToolInputMap,
  DeclarativeToolName,
  GenerateStudyPackInput,
  PlanNotice,
  SubscribeRssInput
} from "@/webmcp/forms/types";
import { isDeclarativeToolName } from "@/webmcp/forms/types";
import { READMATE_TOOL_CONTRACT_BY_NAME } from "@/webmcp/tool-contracts";
import { compactToolError, compactToolSuccess } from "@/webmcp/tool-results";
import { navigateToCompletedStudyPack } from "@/webmcp/study-pack-navigation";
import type { ReadMateImperativeToolHandlers } from "@/webmcp/registration";
import { useLiveToolRegistration } from "@/webmcp/tool-registration-lifecycle.web";
import {
  rssSubscriptionCompletion,
  type WebMcpSourceSubscriptionResponse
} from "@/webmcp/rss-subscription-completion";
import {
  buildLibrarySearchPath,
  compactDocumentContext,
  compactLibrarySearch,
  documentForListening,
  listeningDeepLink,
  type DocumentContextTransport,
  type LibrarySearchTransport
} from "@/webmcp/imperative-handlers";
import {
  DEFAULT_SENSITIVE_AGENT_PATHNAMES,
  isAgentActionPathEnabled
} from "@/webmcp/route-gate";

export type AgentActionProviderProps = {
  children: ReactNode;
  /** Set false to unregister forms and clear all pending state, such as on an account or payment route. */
  enabled?: boolean;
  /** Forms are disabled on account and payment routes by default. */
  sensitivePathnames?: readonly string[];
  /** Optional personalization override; Clerk remains the default source. */
  firstName?: string;
  /** Override individual mutations for integration tests or a future API adapter. */
  executors?: Partial<AgentActionExecutors>;
  /** Mounts the three authenticated imperative tools beside the three declarative forms. */
  imperativeHandlers?: ReadMateImperativeToolHandlers;
  /** Set false when rendering AgentReadyBadge in an account/menu surface. */
  showFloatingBadge?: boolean;
};

export type AgentActionController = {
  available: boolean;
  open: boolean;
  activeTool?: DeclarativeToolName;
  status: AgentActionStatus;
  openWorkspace: (toolName?: DeclarativeToolName) => void;
  closeWorkspace: () => void;
  cancelActive: () => void;
};

const AgentActionContext = createContext<AgentActionController | null>(null);

export function useAgentAction(): AgentActionController {
  const value = use(AgentActionContext);
  if (!value) throw new Error("useAgentAction must be used inside AgentActionProvider.");
  return value;
}

export function AgentActionProvider({
  children,
  enabled = true,
  sensitivePathnames = DEFAULT_SENSITIVE_AGENT_PATHNAMES,
  firstName: firstNameOverride,
  executors: executorOverrides,
  imperativeHandlers,
  showFloatingBadge = true
}: AgentActionProviderProps) {
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const { user } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const playback = usePlaybackManager();
  const [supported, setSupported] = useState(() => isWebMcpAvailable());
  const [open, setOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<DeclarativeToolName>();
  const [status, setStatus] = useState<AgentActionStatus>(readyStatus());
  const formRefs = useRef<Partial<Record<DeclarativeToolName, HTMLFormElement | null>>>({});
  const runningControllerRef = useRef<AbortController | null>(null);
  const undoControllerRef = useRef<AbortController | null>(null);
  const selectDocumentRef = useRef(playback.selectDocument);
  const routeEnabled = isAgentActionPathEnabled(pathname, enabled, sensitivePathnames);
  const available = routeEnabled && supported && isLoaded && Boolean(isSignedIn);
  const firstName = firstNameOverride?.trim() || getProfileFirstName(user?.firstName, user?.fullName);

  useEffect(() => {
    setSupported(isWebMcpAvailable());
  }, []);

  useEffect(() => {
    selectDocumentRef.current = playback.selectDocument;
  }, [playback.selectDocument]);

  const documentsQuery = useQuery({
    queryKey: ["documents"],
    queryFn: async () => getDocuments(await getToken({ skipCache: true })),
    enabled: available
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => getUserSettings(await getToken({ skipCache: true })),
    enabled: available
  });
  const entitlementQuery = useQuery({
    queryKey: ["entitlements"],
    queryFn: async () => getEntitlements(await getToken({ skipCache: true })),
    enabled: available
  });

  const productionImperativeHandlers = useMemo<ReadMateImperativeToolHandlers>(() => ({
    searchLibrary: async (input, context) => {
      const response = await fetchJson<LibrarySearchTransport>(buildLibrarySearchPath(input), context.token, {
        signal: context.signal
      });
      const settings = queryClient.getQueryData<UserSettings>(["settings"]);
      const resource = compactLibrarySearch(response, input, settings?.targetLanguage ?? "en");
      return {
        resource,
        message: resource.results.length
          ? `Found ${resource.results.length} matching item${resource.results.length === 1 ? "" : "s"} in the signed-in ReadMate library.`
          : "No matching items were found in the signed-in ReadMate library."
      };
    },
    getDocumentContext: async (input, context) => {
      const response = await fetchJson<DocumentContextTransport>(
        `/api/documents/${encodeURIComponent(input.documentId)}/context`,
        context.token,
        { signal: context.signal }
      );
      const resource = compactDocumentContext(input, response);
      return {
        resource,
        message: `Compact context is ready for ${resource.title}. No document body was exposed.`
      };
    },
    prepareListening: async (input, context) => {
      setActiveTool(undefined);
      setOpen(true);
      setStatus({
        stage: "running",
        title: "Preparing listening",
        message: "ReadMate is opening the selected item without starting speech or using audio quota."
      });
      try {
        const document = await fetchJson<ReadingDocument>(
          `/api/documents/${encodeURIComponent(input.documentId)}`,
          context.token,
          { signal: context.signal }
        );
        const currentSettings = queryClient.getQueryData<UserSettings>(["settings"])
          ?? await fetchJson<UserSettings>("/api/settings", context.token, { signal: context.signal });
        const nextSettings = listeningSettings(currentSettings, input.targetLanguage, input.voice);
        const updatedSettings = settingsChanged(currentSettings, nextSettings)
          ? await putSettings(context.token, nextSettings, context.signal)
          : currentSettings;
        queryClient.setQueryData(["settings"], updatedSettings);

        const preparedDocument = documentForListening(document, input.startAt ?? "resume");
        queryClient.setQueryData(["document", document.id], preparedDocument);
        queryClient.setQueryData<ReadingDocument[]>(["documents"], (current) =>
          current?.map((item) => item.id === document.id ? preparedDocument : item)
        );
        selectDocumentRef.current(preparedDocument, {
          resetPlayback: (input.startAt ?? "resume") === "beginning"
        });
        const deepLink = listeningDeepLink(input);
        router.push(deepLink as Href);
        const message = `${document.title} is ready in ${languageDisplayName(input.targetLanguage)}. Press Play to request AI-generated speech and use audio quota.`;
        setStatus({
          stage: "completed",
          title: "Listening ready",
          message
        });
        return {
          resource: {
            documentId: document.id,
            targetLanguage: input.targetLanguage,
            voice: updatedSettings.voice,
            startAt: input.startAt ?? "resume",
            status: "ready",
            deepLink
          },
          message
        };
      } catch (error) {
        setStatus(context.signal.aborted
          ? {
              stage: "pending",
              title: "Listening preparation cancelled",
              message: "The player did not start and no speech quota was consumed."
            }
          : {
              stage: "error",
              title: "Listening could not be prepared",
              message: "The player did not start and no speech quota was consumed. Review the selected document and try again."
            });
        throw error;
      }
    }
  }), [queryClient, router]);

  const resolvedImperativeHandlers = imperativeHandlers ?? productionImperativeHandlers;

  const defaultExecutors = useMemo<AgentActionExecutors>(() => ({
    addWebPage: async (input, context) => {
      const token = await requireToken(getToken);
      const settings = settingsQuery.data ?? await fetchJson<UserSettings>("/api/settings", token, { signal: context.signal });
      const result = await fetchJson<SaveUrlResult>("/api/content/save-url", token, {
        method: "POST",
        headers: requestHeaders(context.requestId),
        body: JSON.stringify({
          url: input.url,
          sourceType: "webpage",
          title: input.title,
          category: input.category,
          preferredLanguage: input.preferredLanguage,
          provider: settings.provider,
          voice: settings.voice,
          speed: settings.speed
        }),
        signal: context.signal
      });
      const savedDocument = result.document ?? result.documents?.[0];
      if (!savedDocument) throw new Error("ReadMate saved no readable document.");

      let document = savedDocument;
      if (input.category && input.category !== savedDocument.category) {
        document = await fetchJson<ReadingDocument>(`/api/documents/${encodeURIComponent(savedDocument.id)}`, token, {
          method: "PATCH",
          headers: requestHeaders(context.requestId),
          body: JSON.stringify({ category: input.category })
        }).catch(() => savedDocument);
      }
      if (input.preferredLanguage !== settings.targetLanguage) {
        const updatedSettings = await updateSettings(token, settings, {
          targetLanguage: input.preferredLanguage
        }, context.requestId).catch(() => undefined);
        if (updatedSettings) queryClient.setQueryData(["settings"], updatedSettings);
      }

      queryClient.setQueryData<ReadingDocument[]>(["documents"], (current) => prependDocument(current ?? [], document));
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({ queryKey: ["sources"] });

      const deepLink = `/document/${encodeURIComponent(document.id)}`;
      const message = `${firstName ? `Saved to ${firstName}'s` : "Saved to your"} ReadMate library. Synced to your devices.`;
      return {
        output: compactToolSuccess("readmate_add_web_page", {
          resource: { documentId: document.id, title: document.title, status: "ready", deepLink },
          message
        }) as AgentActionOutput,
        resource: {
          resourceType: "document",
          resourceId: document.id,
          title: document.title,
          status: "Saved",
          deepLink
        },
        viewLabel: "View",
        undoLabel: "Undo save",
        undo: async () => {
          await deleteDocument(document.id, await requireToken(getToken));
          queryClient.setQueryData<ReadingDocument[]>(["documents"], (current) => current?.filter((item) => item.id !== document.id));
          void queryClient.invalidateQueries({ queryKey: ["documents"] });
        }
      };
    },
    subscribeRss: async (input, context) => {
      const token = await requireToken(getToken);
      const source = await fetchJson<WebMcpSourceSubscriptionResponse>("/api/sources/subscribe", token, {
        method: "POST",
        headers: requestHeaders(context.requestId),
        body: JSON.stringify({
          sourceName: input.sourceName,
          websiteUrl: new URL(input.feedUrl).origin,
          rssFeedUrl: input.feedUrl,
          sourceType: "rss",
          topics: input.topics,
          articlesPerRefresh: input.articlesPerRefresh
        }),
        signal: context.signal
      });

      const settings = settingsQuery.data ?? await fetchJson<UserSettings>("/api/settings", token);
      if (settings.articlesPerFeed !== input.articlesPerRefresh) {
        const updatedSettings = await updateSettings(token, settings, {
          articlesPerFeed: input.articlesPerRefresh
        }, context.requestId).catch(() => undefined);
        if (updatedSettings) queryClient.setQueryData(["settings"], updatedSettings);
      }

      queryClient.setQueryData<SourceSubscription[]>(["sources"], (current) => [source, ...(current ?? []).filter((item) => item.id !== source.id)]);
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });

      const deepLink = "/sources";
      const completion = rssSubscriptionCompletion(source, firstName);
      return {
        output: compactToolSuccess("readmate_subscribe_rss", {
          resource: {
            subscriptionId: source.id,
            sourceName: source.sourceName,
            status: completion.toolStatus,
            deepLink
          },
          message: completion.message
        }) as AgentActionOutput,
        resource: {
          resourceType: "source",
          resourceId: source.id,
          title: source.sourceName,
          status: completion.resourceStatus,
          deepLink
        },
        viewLabel: "View source",
        undoLabel: "Remove subscription",
        undo: async () => {
          await deleteSource(source.id, await requireToken(getToken));
          queryClient.setQueryData<SourceSubscription[]>(["sources"], (current) => current?.filter((item) => item.id !== source.id));
          void queryClient.invalidateQueries({ queryKey: ["sources"] });
        }
      };
    },
    generateStudyPack: async (input, context) => {
      const token = await requireToken(getToken);
      const result = await fetchJson<{ document: ReadingDocument; syncPending?: boolean; replayed?: boolean }>(
        `/api/learning/${encodeURIComponent(input.documentId)}/summary`,
        token,
        {
          method: "POST",
          headers: requestHeaders(context.requestId),
          body: JSON.stringify({
            targetLanguage: input.targetLanguage,
            flashcardCount: input.flashcardCount,
            quizCount: input.quizCount
          }),
          signal: context.signal
        }
      );
      const document = result.document;
      const deepLink = `/document/${encodeURIComponent(document.id)}?mode=summary`;
      queryClient.setQueryData(["document", document.id], document);
      queryClient.setQueryData<ReadingDocument[]>(["documents"], (current) => current?.map((item) => item.id === document.id ? document : item));
      queryClient.removeQueries({ queryKey: ["learning-review", document.id], exact: true });
      queryClient.removeQueries({ queryKey: ["learning-key-points", document.id], exact: true });
      queryClient.removeQueries({ queryKey: ["learning-flashcards", document.id], exact: true });
      queryClient.removeQueries({ queryKey: ["learning-quiz", document.id], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["learning-review", document.id] });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });

      const flashcardCount = document.flashcards?.length ?? input.flashcardCount;
      const quizCount = document.quizQuestions?.length ?? input.quizCount;
      const message = `Study pack ready for ${document.title}. Synced to your devices.`;
      return {
        output: compactToolSuccess("readmate_generate_study_pack", {
          resource: {
            documentId: document.id,
            summaryAvailable: Boolean(document.summary),
            keyPointCount: document.keyPoints?.length ?? 0,
            flashcardCount,
            quizCount,
            syncPending: result.syncPending,
            deepLink
          },
          message
        }) as AgentActionOutput,
        resource: {
          resourceType: "study_pack",
          resourceId: document.id,
          title: document.title,
          status: `${flashcardCount} flashcards · ${quizCount} quiz questions`,
          deepLink
        },
        replayed: result.replayed === true,
        viewLabel: "Open study pack"
      };
    }
  }), [firstName, getToken, queryClient, settingsQuery.data]);

  const executors = useMemo<AgentActionExecutors>(() => ({
    ...defaultExecutors,
    ...executorOverrides
  }), [defaultExecutors, executorOverrides]);

  const clearActionState = useCallback(() => {
    runningControllerRef.current?.abort();
    undoControllerRef.current?.abort();
    runningControllerRef.current = null;
    undoControllerRef.current = null;
    setOpen(false);
    setActiveTool(undefined);
    setStatus(readyStatus());
  }, []);

  useLiveToolRegistration({
    enabled: available,
    isAuthenticated: isLoaded && Boolean(isSignedIn),
    userId,
    getToken,
    handlers: resolvedImperativeHandlers,
    clearAgentState: clearActionState
  });

  useEffect(() => () => {
    runningControllerRef.current?.abort();
    undoControllerRef.current?.abort();
  }, []);

  const focusForm = useCallback((toolName: DeclarativeToolName) => {
    const form = formRefs.current[toolName];
    if (!form) return;
    window.requestAnimationFrame(() => {
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      form.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), button:not([disabled])")
        ?.focus({ preventScroll: true });
    });
  }, []);

  const markPending = useCallback((toolName: DeclarativeToolName) => {
    setActiveTool(toolName);
    setOpen(true);
    setStatus((current) => current.stage === "running"
      ? current
      : {
          stage: "pending",
          toolName,
          title: "Agent form ready for review",
          message: `${READMATE_TOOL_CONTRACT_BY_NAME[toolName].title} is filled or selected. Nothing changes until you submit it.`
        });
  }, []);

  useEffect(() => {
    if (!available) return;
    const handleActivated = (event: Event) => {
      const toolName = toolNameFromEvent(event);
      if (!isDeclarativeToolName(toolName)) return;
      markPending(toolName);
      focusForm(toolName);
    };
    const handleCancelled = (event: Event) => {
      const toolName = toolNameFromEvent(event);
      if (toolName && !isDeclarativeToolName(toolName)) return;
      runningControllerRef.current?.abort();
      runningControllerRef.current = null;
      setStatus({
        stage: "pending",
        toolName: isDeclarativeToolName(toolName) ? toolName : activeTool,
        title: "Agent action cancelled",
        message: "The form values are preserved. Review them or close this panel."
      });
    };
    window.addEventListener("toolactivated", handleActivated);
    window.addEventListener("toolcancel", handleCancelled);
    window.addEventListener("toolcanceled", handleCancelled);
    return () => {
      window.removeEventListener("toolactivated", handleActivated);
      window.removeEventListener("toolcancel", handleCancelled);
      window.removeEventListener("toolcanceled", handleCancelled);
    };
  }, [activeTool, available, focusForm, markPending]);

  const cancelActive = useCallback(() => {
    runningControllerRef.current?.abort();
    runningControllerRef.current = null;
    setStatus((current) => ({
      stage: "pending",
      toolName: current.toolName,
      title: "Action cancelled",
      message: "No further request will be sent. The form values are preserved for review."
    }));
  }, []);

  const resetReview = useCallback((toolName: DeclarativeToolName) => {
    if (runningControllerRef.current) {
      cancelActive();
      return;
    }
    setActiveTool(toolName);
    setStatus({ stage: "ready", toolName, title: "Agent ready", message: "Choose an action or ask your browser agent for help." });
  }, [cancelActive]);

  const reportValidationError = useCallback((toolName: DeclarativeToolName, message: string) => {
    setActiveTool(toolName);
    setOpen(true);
    setStatus({
      stage: "error",
      toolName,
      title: "Review one field",
      message
    });
  }, []);

  const submitAction = useCallback(<TName extends DeclarativeToolName>(
    toolName: TName,
    input: DeclarativeToolInputMap[TName],
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    const browserEvent = event.nativeEvent as AgentSubmitEvent;
    if (runningControllerRef.current) {
      const busyOutput = compactToolError(
        toolName,
        "CONFLICT",
        "Another ReadMate action is still running.",
        "Wait for it to finish or cancel it before submitting this form."
      );
      if (browserEvent.agentInvoked && browserEvent.respondWith) browserEvent.respondWith(Promise.resolve(busyOutput));
      return;
    }

    const controller = new AbortController();
    const requestId = createRequestId();
    const startedAt = Date.now();
    runningControllerRef.current = controller;
    setActiveTool(toolName);
    setOpen(true);
    setStatus({
      stage: "running",
      toolName,
      title: runningTitle(toolName),
      message: "ReadMate is using your existing account and plan. You can cancel while the request is in progress."
    });

    const execution = (async () => {
      await recordAuditEvent(getToken, {
        requestId,
        toolName,
        actionClass: READMATE_TOOL_CONTRACT_BY_NAME[toolName].actionClass,
        status: "confirmed",
        input
      });
      return executeTool(executors, toolName, input, { signal: controller.signal, requestId });
    })();
    const responsePromise: Promise<AgentActionOutput | AgentActionErrorOutput> = execution.then(
      async (completion) => {
        await recordAuditEvent(getToken, {
          requestId,
          toolName,
          actionClass: READMATE_TOOL_CONTRACT_BY_NAME[toolName].actionClass,
          status: "succeeded",
          resourceType: completion.resource.resourceType,
          resourceId: completion.resource.resourceId,
          latencyMs: Date.now() - startedAt
        });
        setStatus({
          stage: "completed",
          toolName,
          title: completion.resource.status,
          message: completion.output.message,
          completion
        });
        try {
          const navigated = navigateToCompletedStudyPack(
            toolName,
            completion,
            (path) => router.push(path as Href)
          );
          if (navigated) {
            setOpen(false);
          }
        } catch {
          // Keep the completed status and fallback link visible if routing is
          // unavailable; the confirmed server action still succeeded.
          setOpen(true);
        }
        return completion.output;
      },
      async (error) => {
        const output = safeErrorOutput(toolName, error);
        await recordAuditEvent(getToken, {
          requestId,
          toolName,
          actionClass: READMATE_TOOL_CONTRACT_BY_NAME[toolName].actionClass,
          status: controller.signal.aborted ? "cancelled" : "failed",
          errorCode: controller.signal.aborted ? undefined : output.error.code,
          latencyMs: Date.now() - startedAt
        });
        if (controller.signal.aborted) {
          setStatus({
            stage: "pending",
            toolName,
            title: "Action cancelled",
            message: "The form values are preserved. Submit again only if you still want this action.",
            error: output
          });
        } else {
          setStatus({
            stage: "error",
            toolName,
            title: output.error.message,
            message: output.error.nextAction,
            error: output
          });
        }
        return output;
      }
    ).finally(() => {
      if (runningControllerRef.current === controller) runningControllerRef.current = null;
    });

    if (browserEvent.agentInvoked && typeof browserEvent.respondWith === "function") {
      browserEvent.respondWith(responsePromise);
    }
    void responsePromise;
  }, [executors, getToken, router]);

  const undoCompletedAction = useCallback(async () => {
    const completion = status.completion;
    if (!completion?.undo || undoControllerRef.current) return;
    const controller = new AbortController();
    undoControllerRef.current = controller;
    setStatus((current) => ({ ...current, stage: "running", title: "Removing recent change", message: "ReadMate is undoing the completed action." }));
    try {
      await completion.undo(controller.signal);
      setStatus({
        stage: "completed",
        toolName: status.toolName,
        title: "Recent change removed",
        message: completion.resource.resourceType === "source"
          ? "The RSS subscription was removed. Previously saved articles remain in your library."
          : "The recently saved item was removed from your library."
      });
    } catch (error) {
      const output = safeErrorOutput(status.toolName ?? "readmate_add_web_page", error);
      setStatus({
        stage: "error",
        toolName: status.toolName,
        title: "Could not undo the change",
        message: output.error.nextAction,
        error: output,
        completion
      });
    } finally {
      undoControllerRef.current = null;
    }
  }, [status]);

  const openWorkspace = useCallback((toolName?: DeclarativeToolName) => {
    if (!available) return;
    setOpen(true);
    if (toolName) {
      setActiveTool(toolName);
      focusForm(toolName);
    }
  }, [available, focusForm]);

  const controllerValue = useMemo<AgentActionController>(() => ({
    available,
    open,
    activeTool,
    status,
    openWorkspace,
    closeWorkspace: () => setOpen(false),
    cancelActive
  }), [activeTool, available, cancelActive, open, openWorkspace, status]);

  if (!available) {
    return <AgentActionContext value={controllerValue}>{children}</AgentActionContext>;
  }

  const planNotices = noticesForPlan(entitlementQuery.data, settingsQuery.data?.articlesPerFeed ?? 10);
  const documentOptions = (documentsQuery.data ?? []).map((document) => ({ id: document.id, title: document.title }));

  return (
    <AgentActionContext value={controllerValue}>
      {children}
      <style>{agentActionCss}</style>
      {showFloatingBadge ? <AgentReadyBadge floating /> : null}
      <aside
        aria-hidden={!open}
        aria-label="ReadMate agent actions"
        data-readmate-agent-workspace="true"
        id="readmate-agent-actions"
        style={{ ...panelStyle, ...(open ? {} : hiddenPanelStyle) }}
      >
        <header style={panelHeaderStyle}>
          <div style={{ display: "grid", gap: 2 }}>
            <span style={{ color: webMcpColors.maroon, fontSize: 11, fontWeight: 850, letterSpacing: 0.5, textTransform: "uppercase" }}>ReadMate agent workspace</span>
            <strong style={{ color: webMcpColors.ink, fontFamily: "Georgia, serif", fontSize: 20 }}>
              {firstName ? `Ready for ${firstName}` : "Ready for you"}
            </strong>
          </div>
          <button aria-label="Close agent actions" onClick={() => setOpen(false)} style={iconButtonStyle} type="button">×</button>
        </header>

        <AgentStatusPanel status={status} onView={(href) => router.push(href as Href)} onUndo={undoCompletedAction} />

        <div style={{ display: "grid", gap: 12 }}>
          <ToolFormSection active={activeTool === "readmate_add_web_page"}>
            <AddWebPageForm
              active={activeTool === "readmate_add_web_page"}
              firstName={firstName}
              formRef={(node) => { formRefs.current.readmate_add_web_page = node; }}
              planNotice={planNotices.addWebPage}
              stage={activeTool === "readmate_add_web_page" ? status.stage : undefined}
              statusMessage={activeTool === "readmate_add_web_page" ? status.message : undefined}
              onCancel={() => resetReview("readmate_add_web_page")}
              onReview={() => markPending("readmate_add_web_page")}
              onSubmit={(input, event) => submitAction("readmate_add_web_page", input, event)}
              onValidationError={(message) => reportValidationError("readmate_add_web_page", message)}
            />
          </ToolFormSection>

          <ToolFormSection active={activeTool === "readmate_subscribe_rss"}>
            <SubscribeRssForm
              active={activeTool === "readmate_subscribe_rss"}
              firstName={firstName}
              formRef={(node) => { formRefs.current.readmate_subscribe_rss = node; }}
              planNotice={planNotices.subscribeRss}
              stage={activeTool === "readmate_subscribe_rss" ? status.stage : undefined}
              statusMessage={activeTool === "readmate_subscribe_rss" ? status.message : undefined}
              onCancel={() => resetReview("readmate_subscribe_rss")}
              onReview={() => markPending("readmate_subscribe_rss")}
              onSubmit={(input, event) => submitAction("readmate_subscribe_rss", input, event)}
              onValidationError={(message) => reportValidationError("readmate_subscribe_rss", message)}
            />
          </ToolFormSection>

          <ToolFormSection active={activeTool === "readmate_generate_study_pack"}>
            <GenerateStudyPackForm
              active={activeTool === "readmate_generate_study_pack"}
              documents={documentOptions}
              firstName={firstName}
              formRef={(node) => { formRefs.current.readmate_generate_study_pack = node; }}
              planNotice={planNotices.generateStudyPack}
              stage={activeTool === "readmate_generate_study_pack" ? status.stage : undefined}
              statusMessage={activeTool === "readmate_generate_study_pack" ? status.message : undefined}
              onCancel={() => resetReview("readmate_generate_study_pack")}
              onReview={() => markPending("readmate_generate_study_pack")}
              onSubmit={(input, event) => submitAction("readmate_generate_study_pack", input, event)}
              onValidationError={(message) => reportValidationError("readmate_generate_study_pack", message)}
            />
          </ToolFormSection>
        </div>
      </aside>
    </AgentActionContext>
  );
}

export function AgentReadyBadge({ floating = false, style }: { floating?: boolean; style?: CSSProperties }) {
  const agent = useAgentAction();
  if (!agent.available) return null;
  return (
    <button
      aria-controls="readmate-agent-actions"
      aria-expanded={agent.open}
      aria-label={`${stageLabel(agent.status.stage)}. Open ReadMate agent actions`}
      onClick={() => agent.open ? agent.closeWorkspace() : agent.openWorkspace(agent.activeTool)}
      type="button"
      style={{ ...badgeStyle, ...(floating ? floatingBadgeStyle : {}), ...style }}
    >
      <span aria-hidden="true" style={{ ...badgeDotStyle, background: stageColor(agent.status.stage) }} />
      <span>{stageLabel(agent.status.stage)}</span>
    </button>
  );
}

function ToolFormSection({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <section style={{ ...toolSectionStyle, ...(active ? activeToolSectionStyle : {}) }}>
      {children}
    </section>
  );
}

function AgentStatusPanel({
  status,
  onView,
  onUndo
}: {
  status: AgentActionStatus;
  onView: (href: string) => void;
  onUndo: () => void;
}) {
  const isError = status.stage === "error";
  const completion = status.completion;
  const deepLink = completion?.resource.deepLink;
  return (
    <section
      aria-atomic="true"
      aria-live={isError ? "assertive" : "polite"}
      role={isError ? "alert" : "status"}
      style={{
        display: "grid",
        gap: 6,
        borderRadius: 12,
        background: statusBackground(status.stage),
        color: stageColor(status.stage),
        padding: "11px 12px"
      }}
    >
      <strong style={{ fontSize: 13 }}>{status.title}</strong>
      <span style={{ fontSize: 12, lineHeight: 1.45 }}>{status.message}</span>
      {completion ? (
        <span style={{ color: webMcpColors.muted, fontSize: 12 }}>
          {completion.resource.title} · {completion.resource.status}
        </span>
      ) : null}
      {completion && (deepLink || completion.undo) ? (
        <span style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 2 }}>
          {deepLink ? (
            <a href={deepLink} onClick={(event) => { event.preventDefault(); onView(deepLink); }} style={resultLinkStyle}>
              {completion.viewLabel ?? "View"}
            </a>
          ) : null}
          {completion.undo ? (
            <button type="button" onClick={onUndo} style={resultUndoStyle}>
              {completion.undoLabel ?? "Undo"}
            </button>
          ) : null}
        </span>
      ) : null}
    </section>
  );
}

function executeTool<TName extends DeclarativeToolName>(
  executors: AgentActionExecutors,
  toolName: TName,
  input: DeclarativeToolInputMap[TName],
  context: { signal: AbortSignal; requestId: string }
): Promise<AgentActionCompletion> {
  switch (toolName) {
    case "readmate_add_web_page":
      return executors.addWebPage(input as AddWebPageInput, context);
    case "readmate_subscribe_rss":
      return executors.subscribeRss(input as SubscribeRssInput, context);
    case "readmate_generate_study_pack":
      return executors.generateStudyPack(input as GenerateStudyPackInput, context);
  }
}

async function requireToken(getToken: ReturnType<typeof useAuth>["getToken"]): Promise<string> {
  const token = await getToken({ skipCache: true });
  if (!token) throw new ApiError("Your ReadMate session has expired.", 401);
  return token;
}

async function updateSettings(
  token: string,
  current: UserSettings,
  update: Partial<Pick<UserSettings, "targetLanguage" | "articlesPerFeed">>,
  requestId: string
): Promise<UserSettings> {
  const { userId: _userId, updatedAt: _updatedAt, ...settings } = current;
  return fetchJson<UserSettings>("/api/settings", token, {
    method: "PUT",
    headers: requestHeaders(requestId),
    body: JSON.stringify({ ...settings, ...update })
  });
}

function listeningSettings(
  current: UserSettings,
  targetLanguage: UserSettings["targetLanguage"],
  requestedVoice?: string
): UserSettings {
  const requested = requestedVoice?.trim();
  const voice = requested
    || (current.targetLanguage === targetLanguage
      ? current.voice
      : targetLanguage === "en"
        ? defaultSettings().voice
        : defaultVoiceForLanguage(targetLanguage));
  return { ...current, targetLanguage, voice };
}

function settingsChanged(current: UserSettings, next: UserSettings): boolean {
  return current.targetLanguage !== next.targetLanguage || current.voice !== next.voice;
}

async function putSettings(token: string, next: UserSettings, signal: AbortSignal): Promise<UserSettings> {
  const { userId: _userId, updatedAt: _updatedAt, ...settings } = next;
  return fetchJson<UserSettings>("/api/settings", token, {
    method: "PUT",
    body: JSON.stringify(settings),
    signal
  });
}

function languageDisplayName(language: UserSettings["targetLanguage"]): string {
  if (language === "tw") return "Twi";
  if (language === "ee") return "Ewe";
  if (language === "gaa") return "Ga";
  return "English";
}

function requestHeaders(requestId: string): Record<string, string> {
  return { "X-ReadMate-Request-Id": requestId };
}

type AuditEventInput = {
  requestId: string;
  toolName: DeclarativeToolName;
  actionClass: "write" | "paid_ai";
  status: "confirmed" | "succeeded" | "failed" | "cancelled";
  resourceType?: "document" | "source" | "study_pack";
  resourceId?: string;
  errorCode?: string;
  latencyMs?: number;
  input?: unknown;
};

async function recordAuditEvent(
  getToken: ReturnType<typeof useAuth>["getToken"],
  input: AuditEventInput
): Promise<void> {
  try {
    const token = await getToken({ skipCache: true });
    if (!token) return;
    await fetchJson("/api/webmcp/events", token, {
      method: "POST",
      headers: requestHeaders(input.requestId),
      body: JSON.stringify(input)
    });
  } catch {
    // Audit is operational metadata. A temporary audit failure must not replay
    // or duplicate the user-confirmed product action.
  }
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `webmcp-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function toolNameFromEvent(event: Event): unknown {
  const direct = (event as Event & { toolName?: unknown }).toolName;
  if (direct) return direct;
  return (event as CustomEvent<{ toolName?: unknown }>).detail?.toolName;
}

function readyStatus(): AgentActionStatus {
  return {
    stage: "ready",
    title: "Agent ready",
    message: "Ask your browser agent for help, or review one of the actions below."
  };
}

function runningTitle(toolName: DeclarativeToolName): string {
  if (toolName === "readmate_add_web_page") return "Saving webpage";
  if (toolName === "readmate_subscribe_rss") return "Adding RSS subscription";
  return "Generating study pack";
}

function noticesForPlan(entitlement: ReadMateEntitlement | undefined, articlesPerRefresh: number): {
  addWebPage: PlanNotice;
  subscribeRss: PlanNotice;
  generateStudyPack: PlanNotice;
} {
  const planLabel = entitlement?.isPremium ? "Premium" : "Free";
  return {
    addWebPage: {
      planLabel,
      detail: "Your normal document limits apply. The preferred language becomes your listening default; no purchase or upgrade happens automatically."
    },
    subscribeRss: {
      planLabel,
      detail: `This source can add up to ${articlesPerRefresh} readable items per refresh using your normal document allowance.`
    },
    generateStudyPack: {
      planLabel,
      detail: "Summary, flashcard, and quiz generation uses your current AI allowance."
    }
  };
}

function stageLabel(stage: AgentActionStatus["stage"]): string {
  if (stage === "pending") return "Agent review";
  if (stage === "running") return "Agent working";
  if (stage === "completed") return "Agent completed";
  if (stage === "error") return "Agent needs attention";
  return "Agent ready";
}

function stageColor(stage: AgentActionStatus["stage"]): string {
  if (stage === "pending" || stage === "running") return webMcpColors.amber;
  if (stage === "error") return webMcpColors.red;
  return webMcpColors.green;
}

function statusBackground(stage: AgentActionStatus["stage"]): string {
  if (stage === "pending" || stage === "running") return webMcpColors.amberSoft;
  if (stage === "error") return webMcpColors.redSoft;
  return webMcpColors.greenSoft;
}

const badgeStyle: CSSProperties = {
  minHeight: 40,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  border: `1px solid ${webMcpColors.border}`,
  borderRadius: 999,
  background: webMcpColors.paper,
  color: webMcpColors.ink,
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 800,
  padding: "8px 13px"
};

const floatingBadgeStyle: CSSProperties = {
  position: "fixed",
  right: 18,
  bottom: 18,
  zIndex: 10001,
  boxShadow: "0 12px 30px -18px rgba(33, 35, 30, 0.7)"
};

const badgeDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999
};

const panelStyle: CSSProperties = {
  boxSizing: "border-box",
  position: "fixed",
  right: 18,
  bottom: 70,
  zIndex: 10000,
  width: "min(430px, calc(100vw - 24px))",
  maxHeight: "min(760px, calc(100vh - 96px))",
  display: "grid",
  gap: 12,
  overflowY: "auto",
  overscrollBehavior: "contain",
  border: `1px solid ${webMcpColors.border}`,
  borderRadius: 18,
  background: webMcpColors.cream,
  color: webMcpColors.ink,
  boxShadow: "0 24px 70px -34px rgba(33, 35, 30, 0.72)",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  padding: 14
};

const hiddenPanelStyle: CSSProperties = {
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  maxHeight: 1,
  opacity: 0,
  overflow: "hidden",
  pointerEvents: "none",
  clipPath: "inset(50%)",
  padding: 0,
  border: 0
};

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12
};

const iconButtonStyle: CSSProperties = {
  width: 40,
  height: 40,
  border: 0,
  borderRadius: 999,
  background: webMcpColors.creamStrong,
  color: webMcpColors.ink,
  cursor: "pointer",
  fontSize: 24,
  lineHeight: 1
};

const toolSectionStyle: CSSProperties = {
  border: `1px solid ${webMcpColors.border}`,
  borderRadius: 14,
  background: webMcpColors.paper,
  padding: 12
};

const activeToolSectionStyle: CSSProperties = {
  borderColor: webMcpColors.maroon,
  boxShadow: "0 0 0 3px rgba(123, 63, 75, 0.12)"
};

const resultLinkStyle: CSSProperties = {
  minHeight: 36,
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  background: webMcpColors.green,
  color: webMcpColors.white,
  fontSize: 12,
  fontWeight: 800,
  padding: "7px 12px",
  textDecoration: "none"
};

const resultUndoStyle: CSSProperties = {
  minHeight: 36,
  border: `1px solid ${webMcpColors.border}`,
  borderRadius: 999,
  background: "transparent",
  color: webMcpColors.ink,
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 800,
  padding: "7px 12px"
};

const agentActionCss = `
  [data-readmate-agent-workspace="true"] :where(input, select, button, a):focus-visible {
    outline: 3px solid ${webMcpColors.maroon};
    outline-offset: 2px;
  }
  [data-readmate-agent-workspace="true"] form:tool-form-active {
    outline: 3px dashed ${webMcpColors.maroon};
    outline-offset: 5px;
  }
  [data-readmate-agent-workspace="true"] button:tool-submit-active {
    outline: 4px solid ${webMcpColors.amber};
    outline-offset: 3px;
  }
  @media (max-width: 520px) {
    [data-readmate-agent-workspace="true"] {
      right: 8px !important;
      bottom: 64px !important;
      width: calc(100vw - 16px) !important;
      max-height: calc(100vh - 78px) !important;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-readmate-agent-workspace="true"] { scroll-behavior: auto; }
  }
`;
