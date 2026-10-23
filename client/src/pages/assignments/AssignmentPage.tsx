import { useParams } from 'react-router';
import { isStaff, useCurrentUser } from '../../auth/AuthProvider';
import { NotFoundCard } from '../../components/NotFoundCard';
import { AssignmentOverviewPage } from './AssignmentOverviewPage';
import { StudentAssignmentPage } from './StudentAssignmentPage';

/** Students: the coding workspace. Teachers: submissions overview for the assignment. */
export function AssignmentPage() {
  const user = useCurrentUser();
  const assignmentId = Number(useParams().assignmentId);
  if (!Number.isInteger(assignmentId) || assignmentId <= 0) return <NotFoundCard />;
  return isStaff(user) ? (
    <AssignmentOverviewPage key={assignmentId} assignmentId={assignmentId} />
  ) : (
    <StudentAssignmentPage key={assignmentId} assignmentId={assignmentId} />
  );
}
