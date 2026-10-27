import {
  ActionIcon,
  Alert,
  AppShell,
  Avatar,
  Burger,
  Button,
  Divider,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { APP_NAME } from '@codeclass/shared';
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconChevronDown,
  IconCode,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconPackages,
  IconRefresh,
  IconReportAnalytics,
  IconSchool,
  IconSun,
  IconUserCircle,
  IconUsers,
} from '@tabler/icons-react';
import { useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router';
import { useClasses } from '../api/classes';
import { isStaff, useAuth, useCurrentUser, useSignOut } from '../auth/AuthProvider';
import { StudentViewBanner, useBackToMyAccount, type BackToMyAccount } from '../auth/StudentViewBanner';
import { RoleBadge } from '../components/badges';
import { BrandMark } from '../components/BrandMark';

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const label = computed === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <Tooltip label={label}>
      <ActionIcon variant="default" size="lg" onClick={() => setColorScheme(computed === 'dark' ? 'light' : 'dark')} aria-label={label}>
        {computed === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

function AccountMenu({ back }: { back: BackToMyAccount | null }) {
  const user = useCurrentUser();
  const signOut = useSignOut();
  const navigate = useNavigate();
  return (
    <Menu position="bottom-end" width={220}>
      <Menu.Target>
        <UnstyledButton aria-label="Account menu">
          <Group gap="xs" wrap="nowrap">
            <Avatar name={user.name} color="initials" radius="xl" size={34} />
            <Stack gap={0} visibleFrom="sm">
              <Text size="sm" fw={600} lh={1.2}>
                {user.name}
              </Text>
              <Text size="xs" c="dimmed" tt={back ? undefined : 'capitalize'}>
                {back ? 'Student view' : user.role}
              </Text>
            </Stack>
            <IconChevronDown size={14} />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{user.email ?? `@${user.username}`}</Menu.Label>
        <Menu.Item leftSection={<IconUserCircle size={16} />} component={Link} to="/account">
          Account settings
        </Menu.Item>
        <Menu.Item leftSection={<IconCode size={16} />} component={Link} to="/playground">
          Playground
        </Menu.Item>
        <Menu.Divider />
        {back ? (
          // Signing out of a student view goes back to the teacher's or admin's own account.
          <Menu.Item leftSection={<IconArrowBackUp size={16} />} onClick={back.run}>
            Back to my account
          </Menu.Item>
        ) : (
          <Menu.Item
            color="red"
            leftSection={<IconLogout size={16} />}
            onClick={async () => {
              if (await signOut()) navigate('/login', { replace: true });
            }}
          >
            Sign out
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

function ClassLinks() {
  const { data, isPending, refetch } = useClasses();
  const { pathname } = useLocation();
  if (isPending) {
    return (
      <Stack gap={6}>
        <Skeleton h={34} />
        <Skeleton h={34} />
      </Stack>
    );
  }
  // The first load failed (a failed background refetch keeps showing the last list instead).
  if (!data) {
    return (
      <Stack gap={4} align="flex-start" px="sm">
        <Text size="sm" c="dimmed">
          Couldn't load your classes.
        </Text>
        <Button variant="subtle" size="compact-sm" leftSection={<IconRefresh size={14} />} onClick={() => void refetch()}>
          Try again
        </Button>
      </Stack>
    );
  }
  const classes = data.classes;
  if (classes.length === 0) {
    return (
      <Text size="sm" c="dimmed" px="sm">
        No classes yet.
      </Text>
    );
  }
  return (
    <>
      {classes.map((c) => (
        <NavLink
          key={c.id}
          component={Link}
          to={`/classes/${c.id}`}
          label={c.name}
          leftSection={<IconSchool size={18} />}
          active={pathname === `/classes/${c.id}` || pathname.startsWith(`/classes/${c.id}/`)}
        />
      ))}
    </>
  );
}

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const user = useCurrentUser();
  const { impersonator } = useAuth();
  const backToMyAccount = useBackToMyAccount();
  const back = impersonator ? backToMyAccount : null;
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const staff = isStaff(user);

  // Close the mobile navbar and scroll to top on new pages (not on back/forward).
  useEffect(() => {
    close();
    if (navigationType !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navigationType, close]);

  const is = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 270, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <UnstyledButton component={Link} to="/dashboard" aria-label={`${APP_NAME} home`}>
              <Group gap="xs" wrap="nowrap">
                <BrandMark />
                <Text fw={700} size="lg" visibleFrom="xs">
                  {APP_NAME}
                </Text>
              </Group>
            </UnstyledButton>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <ColorSchemeToggle />
            <AccountMenu back={back} />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <AppShell.Section>
          <NavLink component={Link} to="/dashboard" label="Dashboard" leftSection={<IconLayoutDashboard size={18} />} active={is('/dashboard')} />
          <NavLink
            component={Link}
            to="/classes"
            label={staff ? 'All classes' : 'My classes'}
            leftSection={<IconSchool size={18} />}
            active={pathname === '/classes'}
          />
          {staff && (
            <NavLink component={Link} to="/reports" label="Reports" leftSection={<IconReportAnalytics size={18} />} active={is('/reports')} />
          )}
        </AppShell.Section>
        <Divider my="sm" label="Classes" labelPosition="left" />
        <AppShell.Section grow component={ScrollArea}>
          <ClassLinks />
        </AppShell.Section>
        <Divider my="sm" label="Coding" labelPosition="left" />
        <AppShell.Section>
          <NavLink component={Link} to="/playground" label="Playground" leftSection={<IconCode size={18} />} active={is('/playground')} />
          {staff && (
            <NavLink component={Link} to="/languages" label="Languages" leftSection={<IconPackages size={18} />} active={is('/languages')} />
          )}
          {user.role === 'admin' && (
            <NavLink component={Link} to="/admin/users" label="Users" leftSection={<IconUsers size={18} />} active={is('/admin/users')} />
          )}
        </AppShell.Section>
        <AppShell.Section pt="sm">
          <Group justify="space-between" px="sm">
            <Text size="xs" c="dimmed">
              Signed in as @{user.username}
            </Text>
            <RoleBadge role={user.role} />
          </Group>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        {back && <StudentViewBanner user={user} back={back} />}
        {/* A teacher or admin in a student view isn't the one who should choose the student's password. */}
        {user.mustChangePassword && !back && pathname !== '/account' && (
          <Alert color="yellow" mb="lg" icon={<IconAlertTriangle />} title="You're using a temporary password">
            <Text size="sm">
              Please{' '}
              <Text component={Link} to="/account" c="inherit" fw={600} td="underline" span>
                choose your own password
              </Text>{' '}
              so only you can sign in.
            </Text>
          </Alert>
        )}
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
