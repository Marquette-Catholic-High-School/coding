import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { GuestOnly, RequireAuth, RequireRole } from './auth/guards';
import { NotFoundCard } from './components/NotFoundCard';
import { PageLoader } from './components/QueryState';
import { ServerUnreachable } from './components/ServerUnreachable';
import { AppLayout } from './layout/AppLayout';

// Pages are split into their own chunks and loaded on first visit, so the code editor, runtimes, Markdown and date
// pickers only download when a page needs them. The guards and the app shell stay in the main bundle.

/** Shown when a page's chunk can't be downloaded (offline, or the app was updated since this tab loaded it). */
function PageUnavailable() {
  return <ServerUnreachable onRetry={() => window.location.reload()} />;
}

/** React.lazy for a named page export. */
function lazyPage<M extends Record<string, unknown>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<ComponentType> {
  return lazy(() =>
    load().then(
      (module): { default: ComponentType } => ({ default: module[name] as ComponentType }),
      (): { default: ComponentType } => ({ default: PageUnavailable }),
    ),
  );
}

const AccountPage = lazyPage(() => import('./pages/account/AccountPage'), 'AccountPage');
const UsersPage = lazyPage(() => import('./pages/admin/UsersPage'), 'UsersPage');
const AssignmentEditorPage = lazyPage(() => import('./pages/assignments/AssignmentEditorPage'), 'AssignmentEditorPage');
const AssignmentPage = lazyPage(() => import('./pages/assignments/AssignmentPage'), 'AssignmentPage');
const GradingPage = lazyPage(() => import('./pages/assignments/GradingPage'), 'GradingPage');
const JoinPage = lazyPage(() => import('./pages/auth/JoinPage'), 'JoinPage');
const LoginPage = lazyPage(() => import('./pages/auth/LoginPage'), 'LoginPage');
const SetupPage = lazyPage(() => import('./pages/auth/SetupPage'), 'SetupPage');
const ClassPage = lazyPage(() => import('./pages/classes/ClassPage'), 'ClassPage');
const ClassesPage = lazyPage(() => import('./pages/classes/ClassesPage'), 'ClassesPage');
const DashboardPage = lazyPage(() => import('./pages/dashboard/DashboardPage'), 'DashboardPage');
const LanguagePage = lazyPage(() => import('./pages/languages/LanguagePage'), 'LanguagePage');
const LanguagesPage = lazyPage(() => import('./pages/languages/LanguagesPage'), 'LanguagesPage');
const ProjectPage = lazyPage(() => import('./pages/playground/ProjectPage'), 'ProjectPage');
const ProjectsPage = lazyPage(() => import('./pages/playground/ProjectsPage'), 'ProjectsPage');

/** A lazy page with a loader while its chunk downloads (full-page for the pages outside the app shell). */
function page(Page: LazyExoticComponent<ComponentType>, { fullPage = false } = {}) {
  return (
    <Suspense fallback={<PageLoader fullPage={fullPage} />}>
      <Page />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/setup', element: page(SetupPage, { fullPage: true }) },
      { path: '/login', element: page(LoginPage, { fullPage: true }) },
    ],
  },
  // Join works signed out (register) and signed in (student joins another class).
  { path: '/join', element: page(JoinPage, { fullPage: true }) },
  { path: '/join/:code', element: page(JoinPage, { fullPage: true }) },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: '/dashboard', element: page(DashboardPage) },
          { path: '/classes', element: page(ClassesPage) },
          { path: '/classes/:classId', element: page(ClassPage) },
          {
            element: <RequireRole roles={['teacher', 'admin']} />,
            children: [
              { path: '/classes/:classId/assignments/new', element: page(AssignmentEditorPage) },
              { path: '/assignments/:assignmentId/edit', element: page(AssignmentEditorPage) },
              { path: '/assignments/:assignmentId/submissions/:studentId', element: page(GradingPage) },
              { path: '/languages', element: page(LanguagesPage) },
              { path: '/languages/:languageId', element: page(LanguagePage) },
            ],
          },
          { path: '/assignments/:assignmentId', element: page(AssignmentPage) },
          { path: '/playground', element: page(ProjectsPage) },
          { path: '/playground/:projectId', element: page(ProjectPage) },
          { path: '/account', element: page(AccountPage) },
          {
            element: <RequireRole roles={['admin']} />,
            children: [{ path: '/admin/users', element: page(UsersPage) }],
          },
          { path: '*', element: <NotFoundCard /> },
        ],
      },
    ],
  },
]);
