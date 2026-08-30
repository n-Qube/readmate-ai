export type DetailMode = "summary" | "highlights" | "flashcards" | "quiz" | "ask" | "notes" | "text";

export type DocumentModeRoute = {
  key: string;
  mode: DetailMode;
};

export type DocumentModeState = {
  routeKey: string;
  mode: DetailMode;
};

export type DocumentModeAction =
  | { type: "route"; route: DocumentModeRoute }
  | { type: "select"; route: DocumentModeRoute; mode: DetailMode };

export function resolveDocumentModeRoute(documentId: unknown, modeParam: unknown): DocumentModeRoute {
  const normalizedDocumentId = firstString(documentId) ?? "";
  const normalizedModeParam = firstString(modeParam);

  return {
    key: JSON.stringify([normalizedDocumentId, normalizedModeParam ?? ""]),
    mode: isDetailMode(normalizedModeParam) ? normalizedModeParam : "summary"
  };
}

export function initialDocumentModeState(route: DocumentModeRoute): DocumentModeState {
  return { routeKey: route.key, mode: route.mode };
}

export function documentModeReducer(state: DocumentModeState, action: DocumentModeAction): DocumentModeState {
  if (action.type === "route") {
    if (state.routeKey === action.route.key) return state;
    return initialDocumentModeState(action.route);
  }

  return {
    routeKey: action.route.key,
    mode: action.mode
  };
}

export function visibleDocumentMode(state: DocumentModeState, route: DocumentModeRoute): DetailMode {
  return state.routeKey === route.key ? state.mode : route.mode;
}

export function isDetailMode(value: unknown): value is DetailMode {
  return value === "summary" || value === "highlights" || value === "flashcards" || value === "quiz" || value === "ask" || value === "notes" || value === "text";
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  return value.find((entry): entry is string => typeof entry === "string");
}
