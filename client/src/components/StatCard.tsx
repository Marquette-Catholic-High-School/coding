import { Card, Group, Skeleton, Stack, Text, ThemeIcon, type MantineColor } from '@mantine/core';
import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  hint,
  icon,
  color = 'brand',
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** A 22px Tabler icon. */
  icon: ReactNode;
  color?: MantineColor;
  loading?: boolean;
}) {
  return (
    <Card padding="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            {label}
          </Text>
          {loading ? (
            <Skeleton h={30} w={40} />
          ) : (
            <Text fz={28} fw={700} lh={1.2}>
              {value}
            </Text>
          )}
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </Stack>
        <ThemeIcon variant="light" color={color} size={40} radius="md" visibleFrom="xs">
          {icon}
        </ThemeIcon>
      </Group>
    </Card>
  );
}
