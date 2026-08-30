import type { CSSProperties, ReactNode } from "react";
import type { AgentActionExecutors, AgentActionStatus, DeclarativeToolName } from "@/webmcp/forms/types";
import type { ReadMateImperativeToolHandlers } from "@/webmcp/registration";

export type AgentActionProviderProps = {
  children: ReactNode;
  enabled?: boolean;
  sensitivePathnames?: readonly string[];
  firstName?: string;
  executors?: Partial<AgentActionExecutors>;
  imperativeHandlers?: ReadMateImperativeToolHandlers;
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

const nativeNoopController: AgentActionController = {
  available: false,
  open: false,
  status: {
    stage: "ready",
    title: "Agent unavailable",
    message: "WebMCP actions are available only in supported web browsers."
  },
  openWorkspace: () => undefined,
  closeWorkspace: () => undefined,
  cancelActive: () => undefined
};

/** Native builds intentionally render no WebMCP surface or tool state. */
export function AgentActionProvider({ children }: AgentActionProviderProps) {
  return <>{children}</>;
}

export function useAgentAction(): AgentActionController {
  return nativeNoopController;
}

export function AgentReadyBadge(_props: { floating?: boolean; style?: CSSProperties }) {
  return null;
}
