import type { ReactNode } from "react";

type OperationsCockpitModuleProps = {
  checkinsContent: ReactNode;
  membersContent: ReactNode;
  piecesContent: ReactNode;
  firingsContent: ReactNode;
  eventsContent: ReactNode;
  lendingContent: ReactNode;
};

export default function OperationsCockpitModule({
  checkinsContent,
  membersContent,
  piecesContent,
  firingsContent,
  eventsContent,
  lendingContent,
}: OperationsCockpitModuleProps) {
  return (
    <section className="staff-module-grid">
      {checkinsContent}
      {membersContent}
      {piecesContent}
      {firingsContent}
      {eventsContent}
      {lendingContent}
    </section>
  );
}
