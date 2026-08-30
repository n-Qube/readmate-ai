import type { FormHTMLAttributes, HTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";
import type { DeclarativeToolName } from "./types";
import { READMATE_TOOL_CONTRACT_BY_NAME } from "../tool-contracts";

export function declarativeFormAttributes(toolName: DeclarativeToolName): FormHTMLAttributes<HTMLFormElement> {
  const contract = READMATE_TOOL_CONTRACT_BY_NAME[toolName];
  return {
    toolname: contract.name,
    tooldescription: contract.description
  } as FormHTMLAttributes<HTMLFormElement>;
}

export function inputToolDescription(description: string): InputHTMLAttributes<HTMLInputElement> {
  return { toolparamdescription: description } as InputHTMLAttributes<HTMLInputElement>;
}

export function selectToolDescription(description: string): SelectHTMLAttributes<HTMLSelectElement> {
  return { toolparamdescription: description } as SelectHTMLAttributes<HTMLSelectElement>;
}

export function genericToolDescription(description: string): HTMLAttributes<HTMLElement> {
  return { toolparamdescription: description } as HTMLAttributes<HTMLElement>;
}
