// TODO: implemented by the feature build — see docs/ARCHITECTURE.md.
import { PageHeader } from '../../components/PageHeader';

export function AssignmentOverviewPage({ assignmentId }: { assignmentId: number }) {
  return <PageHeader title={`AssignmentOverviewPage ${assignmentId}`} />;
}
