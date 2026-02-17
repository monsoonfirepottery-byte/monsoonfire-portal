import { logHandlerError } from "./handlerLog";
type ErrorReporter = (error: unknown) => void;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function toVoidHandler<TArgs extends unknown[]>(
  handler: (...args: TArgs) => void | Promise<unknown>,
  onError?: ErrorReporter,
  label?: string
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    try {
      const result = handler(...args);
      if (isPromiseLike(result)) {
        void result.catch((error: unknown) => {
          logHandlerError(error, label);
          if (onError) {
            onError(error);
            return;
          }
        });
      }
    } catch (error: unknown) {
      logHandlerError(error, label);
      if (onError) {
        onError(error);
        return;
      }
    }
  };
}
