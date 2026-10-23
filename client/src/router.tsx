import { createBrowserRouter, Navigate } from 'react-router';
import { GuestOnly, RequireAuth, RequireRole } from './auth/guards';
import { NotFoundCard } from './components/NotFoundCard';
import { AppLayout } from './layout/AppLayout';
import { AccountPage } from './pages/account/AccountPage';
import { UsersPage } from './pages/admin/UsersPage';
import { AssignmentEditorPage } from './pages/assignments/AssignmentEditorPage';
import { AssignmentPage } from './pages/assignments/AssignmentPage';
import { GradingPage } from './pages/assignments/GradingPage';
import { JoinPage } from './pages/auth/JoinPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SetupPage } from './pages/auth/SetupPage';
import { ClassPage } from './pages/classes/ClassPage';
import { ClassesPage } from './pages/classes/ClassesPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { LanguagePage } from './pages/languages/LanguagePage';
import { LanguagesPage } from './pages/languages/LanguagesPage';
import { ProjectPage } from './pages/playground/ProjectPage';
import { ProjectsPage } from './pages/playground/ProjectsPage';

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/setup', element: <SetupPage /> },
      { path: '/login', element: <LoginPage /> },
    ],
  },
  // Join works signed out (register) and signed in (student joins another class).
  { path: '/join', element: <JoinPage /> },
  { path: '/join/:code', element: <JoinPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/classes', element: <ClassesPage /> },
          { path: '/classes/:classId', element: <ClassPage /> },
          {
            element: <RequireRole roles={['teacher', 'admin']} />,
            children: [
              { path: '/classes/:classId/assignments/new', element: <AssignmentEditorPage /> },
              { path: '/assignments/:assignmentId/edit', element: <AssignmentEditorPage /> },
              { path: '/assignments/:assignmentId/submissions/:studentId', element: <GradingPage /> },
              { path: '/languages', element: <LanguagesPage /> },
              { path: '/languages/:languageId', element: <LanguagePage /> },
            ],
          },
          { path: '/assignments/:assignmentId', element: <AssignmentPage /> },
          { path: '/playground', element: <ProjectsPage /> },
          { path: '/playground/:projectId', element: <ProjectPage /> },
          { path: '/account', element: <AccountPage /> },
          {
            element: <RequireRole roles={['admin']} />,
            children: [{ path: '/admin/users', element: <UsersPage /> }],
          },
          { path: '*', element: <NotFoundCard /> },
        ],
      },
    ],
  },
]);
