import { isStaff, useCurrentUser } from '../../auth/AuthProvider';
import { StudentClassesPage } from './StudentClassesPage';
import { TeacherClassesPage } from './TeacherClassesPage';

export function ClassesPage() {
  const user = useCurrentUser();
  return isStaff(user) ? <TeacherClassesPage /> : <StudentClassesPage />;
}
