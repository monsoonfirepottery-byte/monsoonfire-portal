import { AppError, toAppError } from "../errors/appError";

type Props = {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  showDebug?: boolean;
  className?: string;
};

export default function ErrorBanner({
  error,
  title = "We hit a problem",
  onRetry,
  onDismiss,
  showDebug = false,
  className = "",
}: Props) {
  const appError = error instanceof AppError ? error : toAppError(error);
  const debugText = appError.debugMessage || appError.message;
  const canRetry = !!onRetry && appError.retryable;

  return (
    <section className={`error-banner ${className}`.trim()} role="alert" aria-live="assertive">
      <div className="error-banner-head">
        <strong>{title}</strong>
        {onDismiss ? (
          <button type="button" className="error-banner-btn error-banner-dismiss" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
      <div className="error-banner-copy">{appError.userMessage}</div>
      <div className="error-banner-support">Support code: {appError.correlationId}</div>

      <div className="error-banner-actions">
        {canRetry ? (
          <button type="button" className="error-banner-btn" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>

      {showDebug ? (
        <details className="error-banner-debug">
          <summary>Technical details</summary>
          <pre>{debugText}</pre>
        </details>
      ) : null}
    </section>
  );
}

