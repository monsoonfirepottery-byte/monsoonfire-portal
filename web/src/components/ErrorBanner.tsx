import ErrorPanel from "./ErrorPanel";

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
  return (
    <ErrorPanel
      error={error}
      title={title}
      onRetry={onRetry}
      onDismiss={onDismiss}
      showDebug={showDebug}
      className={className}
    />
  );
}
