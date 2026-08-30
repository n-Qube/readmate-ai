import { useMemo, useState, type FormEvent, type Ref } from "react";
import { FormActions, FormIntroduction, InlineFormStatus, PlanImpact } from "@/webmcp/forms/agent-form-parts.web";
import { declarativeFormAttributes, inputToolDescription, selectToolDescription } from "@/webmcp/forms/declarative-attributes";
import { fieldStackStyle, formStyle, hintStyle, inputStyle, labelStyle, twoColumnStyle } from "@/webmcp/forms/form-styles";
import { boundedInteger, formString, targetLanguage } from "@/webmcp/forms/form-utils";
import type { AgentActionStage, DocumentOption, GenerateStudyPackInput, PlanNotice } from "@/webmcp/forms/types";

export type GenerateStudyPackFormProps = {
  firstName: string;
  planNotice: PlanNotice;
  documents: DocumentOption[];
  active: boolean;
  stage?: AgentActionStage;
  statusMessage?: string;
  formRef?: Ref<HTMLFormElement>;
  onReview: () => void;
  onCancel: () => void;
  onSubmit: (input: GenerateStudyPackInput, event: FormEvent<HTMLFormElement>) => void;
  onValidationError: (message: string) => void;
};

export function GenerateStudyPackForm({
  firstName,
  planNotice,
  documents,
  active,
  stage,
  statusMessage,
  formRef,
  onReview,
  onCancel,
  onSubmit,
  onValidationError
}: GenerateStudyPackFormProps) {
  const [documentId, setDocumentId] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const running = active && stage === "running";
  const selectedTitle = useMemo(
    () => documents.find((document) => document.id === documentId)?.title,
    [documentId, documents]
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const input: GenerateStudyPackInput = {
        documentId: formString(formData, "documentId"),
        targetLanguage: targetLanguage(formString(formData, "targetLanguage")),
        flashcardCount: boundedInteger(formData.get("flashcardCount"), 1, 24),
        quizCount: boundedInteger(formData.get("quizCount"), 1, 12)
      };
      if (!input.documentId || input.documentId.length > 80) throw new Error("Choose a current ReadMate document.");
      setClientError(null);
      onSubmit(input, event);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Review the study settings and try again.";
      setClientError(message);
      onValidationError(message);
    }
  }

  return (
    <form
      {...declarativeFormAttributes("readmate_generate_study_pack")}
      aria-busy={running}
      aria-label="Generate a ReadMate study pack"
      ref={formRef}
      style={formStyle}
      onFocusCapture={onReview}
      onInputCapture={onReview}
      onReset={() => {
        setClientError(null);
        setDocumentId("");
        onCancel();
      }}
      onSubmit={handleSubmit}
    >
      <FormIntroduction
        firstName={firstName}
        title="Generate a study pack"
        explanation="this AI action uses your current allowance. Review the document and requested counts before generating anything."
        affectedLabel={`Affected document: ${selectedTitle ?? (documentId || "not selected")}.`}
      />

      <div style={fieldStackStyle}>
        <label htmlFor="readmate-agent-study-document" style={labelStyle}>ReadMate document</label>
        <input
          {...inputToolDescription("Owned ReadMate document ID to use for this study pack.")}
          aria-describedby="readmate-agent-study-document-hint"
          disabled={running}
          id="readmate-agent-study-document"
          list="readmate-agent-study-documents"
          maxLength={80}
          name="documentId"
          pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,79}"
          placeholder="Choose or enter a document ID"
          required
          type="text"
          style={inputStyle}
          onInput={(event) => setDocumentId(event.currentTarget.value.trim())}
        />
        <datalist id="readmate-agent-study-documents">
          {documents.slice(0, 50).map((document) => (
            <option key={document.id} value={document.id}>{document.title}</option>
          ))}
        </datalist>
        <p id="readmate-agent-study-document-hint" style={hintStyle}>Only documents in the signed-in ReadMate library can be used.</p>
      </div>

      <div style={fieldStackStyle}>
        <label htmlFor="readmate-agent-study-language" style={labelStyle}>Study language</label>
        <select
          {...selectToolDescription("Language for generated study material: English, Twi, Ewe, or Ga.")}
          defaultValue="en"
          disabled={running}
          id="readmate-agent-study-language"
          name="targetLanguage"
          style={inputStyle}
        >
          <option value="en">English</option>
          <option value="tw">Twi</option>
          <option value="ee">Ewe</option>
          <option value="gaa">Ga</option>
        </select>
      </div>

      <div style={twoColumnStyle}>
        <div style={fieldStackStyle}>
          <label htmlFor="readmate-agent-study-flashcards" style={labelStyle}>Flashcards</label>
          <input
            {...inputToolDescription("Number of flashcards to generate, from 1 to 24.")}
            defaultValue={6}
            disabled={running}
            id="readmate-agent-study-flashcards"
            inputMode="numeric"
            max={24}
            min={1}
            name="flashcardCount"
            required
            step={1}
            type="number"
            style={inputStyle}
          />
        </div>
        <div style={fieldStackStyle}>
          <label htmlFor="readmate-agent-study-quiz" style={labelStyle}>Quiz questions</label>
          <input
            {...inputToolDescription("Number of quiz questions to generate, from 1 to 12.")}
            defaultValue={5}
            disabled={running}
            id="readmate-agent-study-quiz"
            inputMode="numeric"
            max={12}
            min={1}
            name="quizCount"
            required
            step={1}
            type="number"
            style={inputStyle}
          />
        </div>
      </div>

      <PlanImpact notice={planNotice}>
        <span> No purchase or plan change can happen from this form.</span>
      </PlanImpact>
      <InlineFormStatus stage={stage} message={statusMessage} error={clientError} />
      <FormActions submitLabel="Generate study pack" running={running} active={active} onCancel={onCancel} />
    </form>
  );
}
