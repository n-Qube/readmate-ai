import { useState, type FormEvent, type Ref } from "react";
import { FormActions, FormIntroduction, InlineFormStatus, PlanImpact } from "@/webmcp/forms/agent-form-parts.web";
import { declarativeFormAttributes, inputToolDescription, selectToolDescription } from "@/webmcp/forms/declarative-attributes";
import { fieldStackStyle, formStyle, hintStyle, inputStyle, labelStyle, twoColumnStyle } from "@/webmcp/forms/form-styles";
import { displayDomain, formString, requirePublicHttpsUrl, targetLanguage } from "@/webmcp/forms/form-utils";
import type { AddWebPageInput, AgentActionStage, PlanNotice } from "@/webmcp/forms/types";

export type AddWebPageFormProps = {
  firstName: string;
  planNotice: PlanNotice;
  active: boolean;
  stage?: AgentActionStage;
  statusMessage?: string;
  formRef?: Ref<HTMLFormElement>;
  onReview: () => void;
  onCancel: () => void;
  onSubmit: (input: AddWebPageInput, event: FormEvent<HTMLFormElement>) => void;
  onValidationError: (message: string) => void;
};

export function AddWebPageForm({
  firstName,
  planNotice,
  active,
  stage,
  statusMessage,
  formRef,
  onReview,
  onCancel,
  onSubmit,
  onValidationError
}: AddWebPageFormProps) {
  const [domain, setDomain] = useState("the selected page");
  const [clientError, setClientError] = useState<string | null>(null);
  const running = active && stage === "running";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const url = requirePublicHttpsUrl(formString(formData, "url"));
      const input: AddWebPageInput = {
        url,
        title: formString(formData, "title") || undefined,
        category: formString(formData, "category") || "Articles",
        preferredLanguage: targetLanguage(formString(formData, "preferredLanguage"))
      };
      setClientError(null);
      onSubmit(input, event);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Review the webpage details and try again.";
      setClientError(message);
      onValidationError(message);
    }
  }

  return (
    <form
      {...declarativeFormAttributes("readmate_add_web_page")}
      aria-busy={running}
      aria-label="Save a webpage with ReadMate"
      ref={formRef}
      style={formStyle}
      onFocusCapture={onReview}
      onInputCapture={onReview}
      onReset={() => {
        setClientError(null);
        setDomain("the selected page");
        onCancel();
      }}
      onSubmit={handleSubmit}
    >
      <FormIntroduction
        firstName={firstName}
        title="Save a webpage"
        explanation="the agent filled this form but cannot submit it for you. Review the destination and choose Save when it looks right."
        affectedLabel={`Affected page: ${domain}.`}
      />

      <div style={fieldStackStyle}>
        <label htmlFor="readmate-agent-webpage-url" style={labelStyle}>Webpage URL</label>
        <input
          {...inputToolDescription("Public HTTPS webpage to save to the signed-in user's ReadMate library.")}
          aria-describedby="readmate-agent-webpage-url-hint"
          autoComplete="url"
          disabled={running}
          id="readmate-agent-webpage-url"
          maxLength={2048}
          name="url"
          placeholder="https://example.com/article"
          required
          type="url"
          style={inputStyle}
          onInput={(event) => setDomain(displayDomain(event.currentTarget.value))}
        />
        <p id="readmate-agent-webpage-url-hint" style={hintStyle}>Only public HTTPS pages are accepted. ReadMate applies its normal safe-ingestion checks.</p>
      </div>

      <div style={fieldStackStyle}>
        <label htmlFor="readmate-agent-webpage-title" style={labelStyle}>Title <span aria-hidden="true">(optional)</span></label>
        <input
          {...inputToolDescription("Optional display title for the saved webpage.")}
          disabled={running}
          id="readmate-agent-webpage-title"
          maxLength={160}
          name="title"
          placeholder="Use the page title"
          type="text"
          style={inputStyle}
        />
      </div>

      <div style={twoColumnStyle}>
        <div style={fieldStackStyle}>
          <label htmlFor="readmate-agent-webpage-category" style={labelStyle}>Library category</label>
          <select
            {...selectToolDescription("Destination category in the user's ReadMate library.")}
            defaultValue="Articles"
            disabled={running}
            id="readmate-agent-webpage-category"
            name="category"
            style={inputStyle}
          >
            <option value="Articles">Articles</option>
            <option value="News">News</option>
            <option value="Technology">Technology</option>
            <option value="Business">Business</option>
            <option value="Education">Education</option>
            <option value="Research">Research</option>
          </select>
        </div>
        <div style={fieldStackStyle}>
          <label htmlFor="readmate-agent-webpage-language" style={labelStyle}>Preferred language</label>
          <select
            {...selectToolDescription("Preferred language to prepare when the saved page is opened for listening or study.")}
            defaultValue="en"
            disabled={running}
            id="readmate-agent-webpage-language"
            name="preferredLanguage"
            style={inputStyle}
          >
            <option value="en">English</option>
            <option value="tw">Twi</option>
            <option value="ee">Ewe</option>
            <option value="gaa">Ga</option>
          </select>
        </div>
      </div>

      <PlanImpact notice={planNotice} />
      <InlineFormStatus stage={stage} message={statusMessage} error={clientError} />
      <FormActions submitLabel="Save to ReadMate" running={running} active={active} onCancel={onCancel} />
    </form>
  );
}
