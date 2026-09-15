import type { AuthErrorCode, AuthEvent, AuthProvider } from "./Auth.nitro";
import type { AuthOperation } from "./utils/auth-error";

type OperationContext = {
  readonly operationId: number;
  readonly operation: AuthOperation;
  readonly provider?: AuthProvider;
};

export type AuthOperationEvent = OperationContext &
  (
    | { readonly type: "operation_started" }
    | {
        readonly type: "operation_succeeded";
        readonly elapsedMilliseconds: number;
      }
    | {
        readonly type: "operation_failed";
        readonly elapsedMilliseconds: number;
        readonly errorCode: AuthErrorCode;
      }
  );

/** Lifecycle metadata only. User and token subscriptions are separate. */
export type AuthLifecycleEvent = AuthEvent | AuthOperationEvent;
