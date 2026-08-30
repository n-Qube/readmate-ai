import type { CSSProperties, ReactNode } from "react";
import {
  buttonRowStyle,
  hintStyle,
  inlineErrorStyle,
  noticeStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  webMcpColors
} from "@/webmcp/forms/form-styles";
import type { AgentActionStage, PlanNotice } from "@/webmcp/forms/types";

type FormIntroductionProps = {
  title: string;
  explanation: string;
  firstName: string;
  affectedLabel: string;
};

export function FormIntroduction({ title, explanation, firstName, affectedLabel }: FormIntroductionProps) {
  return (
    <header style={{ display: "grid", gap: 5 }}>
      <p style={{ color: webMcpColors.maroon, fontSize: 11, fontWeight: 850, letterSpacing: 0.5, margin: 0, textTransform: "uppercase" }}>
        Review before ReadMate changes anything
      </p>
      <h3 style={{ color: webMcpColors.ink, fontFamily: "Georgia, serif", fontSize: 19, lineHeight: 1.2, margin: 0 }}>
        {title}
      </h3>
      <p style={{ ...hintStyle, fontSize: 13 }}>
        {firstName ? `${firstName}, ${explanation}` : explanation} {affectedLabel}
      </p>
    </header>
  );
}

export function PlanImpact({ notice, children }: { notice: PlanNotice; children?: ReactNode }) {
  return (
    <div aria-label={`${notice.planLabel} plan impact`} style={noticeStyle}>
      <strong>{notice.planLabel} plan</strong> · {notice.detail}
      {children}
    </div>
  );
}

export function InlineFormStatus({
  stage,
  message,
  error
}: {
  stage?: AgentActionStage;
  message?: string;
  error?: string | null;
}) {
  if (error) {
    return (
      <p role="alert" style={inlineErrorStyle}>
        {error}
      </p>
    );
  }
  if (!message || stage === "ready") return null;
  const style: CSSProperties = stage === "error"
    ? inlineErrorStyle
    : {
        borderRadius: 10,
        background: stage === "completed" ? webMcpColors.greenSoft : webMcpColors.amberSoft,
        color: stage === "completed" ? webMcpColors.green : webMcpColors.amber,
        fontSize: 12,
        lineHeight: 1.5,
        margin: 0,
        padding: "9px 11px"
      };
  return (
    <p aria-live="polite" role="status" style={style}>
      {message}
    </p>
  );
}

export function FormActions({
  submitLabel,
  running,
  active,
  onCancel
}: {
  submitLabel: string;
  running: boolean;
  active: boolean;
  onCancel: () => void;
}) {
  return (
    <div style={buttonRowStyle}>
      <button
        aria-label={running ? `${submitLabel} in progress` : submitLabel}
        disabled={running}
        type="submit"
        style={{ ...primaryButtonStyle, ...(running ? disabledButtonStyle : {}) }}
      >
        {running ? "Working…" : submitLabel}
      </button>
      {active ? (
        <button
          aria-label={running ? "Cancel running agent action" : "Cancel and clear agent review"}
          type={running ? "button" : "reset"}
          onClick={running ? onCancel : undefined}
          style={secondaryButtonStyle}
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}

const disabledButtonStyle: CSSProperties = {
  cursor: "wait",
  opacity: 0.68
};
