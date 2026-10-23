import { isStaff, useCurrentUser } from '../../auth/AuthProvider';
import { StudentDashboard } from './StudentDashboard';
import { TeacherDashboard } from './TeacherDashboard';

export function DashboardPage() {
  const user = useCurrentUser();
  return isStaff(user) ? <TeacherDashboard /> : <StudentDashboard />;
}
