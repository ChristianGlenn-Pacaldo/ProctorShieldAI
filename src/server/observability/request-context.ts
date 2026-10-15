import "server-only";
import { randomUUID } from "node:crypto";

type Operation = "quizzes.list";
type FailureCode = "QUIZ_LIST_FAILED";
export interface RequestContext {
 operation: Operation;
 requestId: string;
 headers: { "X-Request-ID": string };
}
/** Generate our own identifier; never trust client-provided identifiers or log request bodies. */
export function createRequestContext(operation: Operation): RequestContext {
 const requestId = randomUUID();
 return {operation,requestId,headers:{"X-Request-ID":requestId}};
}
/** An explicit allowlist prevents errors, user identifiers, tokens and evidence from entering this log. */
export function logRequestFailure(context: RequestContext, code: FailureCode): void {
 console.error(JSON.stringify({level:"error",operation:context.operation,code,requestId:context.requestId}));
}
