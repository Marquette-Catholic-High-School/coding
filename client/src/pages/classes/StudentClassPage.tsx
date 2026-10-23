// TODO: implemented by the feature build — see docs/ARCHITECTURE.md.
import { PageHeader } from '../../components/PageHeader';

export function StudentClassPage({ classId }: { classId: number }) {
  return <PageHeader title={`StudentClassPage ${classId}`} />;
}
