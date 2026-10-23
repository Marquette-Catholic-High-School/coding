import { useParams } from 'react-router';
import { isStaff, useCurrentUser } from '../../auth/AuthProvider';
import { NotFoundCard } from '../../components/NotFoundCard';
import { StudentClassPage } from './StudentClassPage';
import { TeacherClassPage } from './TeacherClassPage';

export function ClassPage() {
  const user = useCurrentUser();
  const classId = Number(useParams().classId);
  if (!Number.isInteger(classId) || classId <= 0) return <NotFoundCard />;
  // key: remount when switching classes so local state (tabs, forms) resets.
  return isStaff(user) ? <TeacherClassPage key={classId} classId={classId} /> : <StudentClassPage key={classId} classId={classId} />;
}
