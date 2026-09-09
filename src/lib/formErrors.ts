import { ApiError } from "./api";

type FlattenableError = { flatten: () => { fieldErrors: Record<string, string[] | undefined> } };

export function flattenIssues(error: FlattenableError): Record<string, string> {
  const { fieldErrors } = error.flatten();
  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages?.[0]) result[field] = messages[0];
  }
  return result;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429 && error.retryAfterSeconds) {
      return `Too many attempts. Try again in ${error.retryAfterSeconds} seconds.`;
    }
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
