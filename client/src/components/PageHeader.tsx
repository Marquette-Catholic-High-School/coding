import { Anchor, Breadcrumbs, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface Crumb {
  label: string;
  to?: string;
}

export interface PageHeaderProps {
  crumbs?: Crumb[];
  title: ReactNode;
  subtitle?: ReactNode;
  /** Inline badges shown next to the title. */
  badges?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ crumbs, title, subtitle, badges, actions }: PageHeaderProps) {
  return (
    <Stack gap={6} mb="lg">
      {crumbs && crumbs.length > 0 && (
        <Breadcrumbs separatorMargin={6} fz="sm">
          {crumbs.map((c, i) =>
            c.to && i < crumbs.length - 1 ? (
              <Anchor key={i} component={Link} to={c.to} fz="sm">
                {c.label}
              </Anchor>
            ) : (
              <Text key={i} fz="sm" c="dimmed">
                {c.label}
              </Text>
            ),
          )}
        </Breadcrumbs>
      )}
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <Group gap="sm" wrap="wrap" align="center">
            <Title order={2}>{title}</Title>
            {badges}
          </Group>
          {subtitle && (
            <Text c="dimmed" size="sm" mt={4}>
              {subtitle}
            </Text>
          )}
        </div>
        {actions && <Group gap="sm">{actions}</Group>}
      </Group>
    </Stack>
  );
}
