import { useState, type FormEvent, type Ref } from "react";
import { FormActions, FormIntroduction, InlineFormStatus, PlanImpact } from "@/webmcp/forms/agent-form-parts.web";
import { declarativeFormAttributes, inputToolDescription } from "@/webmcp/forms/declarative-attributes";
import { fieldStackStyle, formStyle, hintStyle, inputStyle, labelStyle, twoColumnStyle } from "@/webmcp/forms/form-styles";
import { boundedInteger, displayDomain, formString, requirePublicHttpsUrl, splitTopics } from "@/webmcp/forms/form-utils";
import type { AgentActionStage, PlanNotice, SubscribeRssInput } from "@/webmcp/forms/types";

export type SubscribeRssFormProps = {
  firstName: string;
  planNotice: PlanNotice;
  active: boolean;
  stage?: AgentActionStage;
  statusMessage?: string;
  formRef?: Ref<HTMLFormElement>;
  onReview: () => void;
  onCancel: () => void;
  onSubmit: (input: SubscribeRssInput, event: FormEvent<HTMLFormElement>) => void;
  onValidationError: (message: string) => void;
};

export function SubscribeRssForm({
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
}: SubscribeRssFormProps) {
  const [domain, setDomain] = useState("the selected feed");
  const [clientError, setClientError] = useState<string | null>(null);
  const running = active && stage === "running";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const input: SubscribeRssInput = {
        feedUrl: requirePublicHttpsUrl(formString(formData, "feedUrl")),
        sourceName: formString(formData, "sourceName"),
        topics: splitTopics(formString(formData, "topics")),
        articlesPerRefresh: boundedInteger(formData.get("articlesPerRefresh"), 1, 50)
      };
      if (!input.sourceName) throw new Error("Enter a source name.");
      setClientError(null);
      onSubmit(input, event);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Review the RSS details and try again.";
      setClientError(message);
      onValidationError(message);
    }
  }

  return (
    <form
      {...declarativeFormAttributes("readmate_subscribe_rss")}
      aria-busy={running}
      aria-label="Subscribe to an RSS feed with ReadMate"
      ref={formRef}
      style={formStyle}
      onFocusCapture={onReview}
      onInputCapture={onReview}
      onReset={() => {
        setClientError(null);
        setDomain("the selected feed");
        onCancel();
      }}
      onSubmit={handleSubmit}
    >
      <FormIntroduction
        firstName={firstName}
        title="Subscribe to an RSS feed"
        explanation="review this recurring source before it is added. ReadMate will sync new readable items using your normal feed settings."
        affectedLabel={`Affected source: ${domain}.`}
      />

      <div style={fieldStackStyle}>
        <label htmlFor="readmate-agent-rss-url" style={labelStyle}>RSS feed URL</label>
        <input
          {...inputToolDescription("Public HTTPS RSS or Atom feed to subscribe to.")}
          aria-describedby="readmate-agent-rss-url-hint"
          autoComplete="url"
          disabled={running}
          id="readmate-agent-rss-url"
          maxLength={2048}
          name="feedUrl"
          placeholder="https://example.com/feed.xml"
          required
          type="url"
          style={inputStyle}
          onInput={(event) => setDomain(displayDomain(event.currentTarget.value))}
        />
        <p id="readmate-agent-rss-url-hint" style={hintStyle}>The server verifies the feed and applies the same public-network protections as normal ReadMate imports.</p>
      </div>

      <div style={fieldStackStyle}>
        <label htmlFor="readmate-agent-rss-name" style={labelStyle}>Source name</label>
        <input
          {...inputToolDescription("Human-readable name for this RSS source.")}
          disabled={running}
          id="readmate-agent-rss-name"
          maxLength={120}
          name="sourceName"
          placeholder="Example News"
          required
          type="text"
          style={inputStyle}
        />
      </div>

      <div style={twoColumnStyle}>
        <div style={fieldStackStyle}>
          <label htmlFor="readmate-agent-rss-topics" style={labelStyle}>Topics <span aria-hidden="true">(optional)</span></label>
          <input
            {...inputToolDescription("Optional comma-separated topics used to organize this source, with at most 10 topics.")}
            aria-describedby="readmate-agent-rss-topics-hint"
            disabled={running}
            id="readmate-agent-rss-topics"
            maxLength={400}
            name="topics"
            placeholder="Technology, Ghana"
            type="text"
            style={inputStyle}
          />
          <p id="readmate-agent-rss-topics-hint" style={hintStyle}>Separate up to 10 topics with commas.</p>
        </div>
        <div style={fieldStackStyle}>
          <label htmlFor="readmate-agent-rss-count" style={labelStyle}>Articles per refresh</label>
          <input
            {...inputToolDescription("Number of readable feed articles to add on each refresh, from 1 to 50.")}
            defaultValue={10}
            disabled={running}
            id="readmate-agent-rss-count"
            inputMode="numeric"
            max={50}
            min={1}
            name="articlesPerRefresh"
            required
            step={1}
            type="number"
            style={inputStyle}
          />
        </div>
      </div>

      <PlanImpact notice={planNotice} />
      <InlineFormStatus stage={stage} message={statusMessage} error={clientError} />
      <FormActions submitLabel="Subscribe to RSS" running={running} active={active} onCancel={onCancel} />
    </form>
  );
}
