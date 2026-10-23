// TODO: implemented by the feature build — see docs/ARCHITECTURE.md.
import { PageHeader } from '../../components/PageHeader';

export function StudentAssignmentPage({ assignmentId }: { assignmentId: number }) {
  return <PageHeader title={`StudentAssignmentPage ${assignmentId}`} />;
}
