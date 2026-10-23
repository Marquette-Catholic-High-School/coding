import { Center, Paper, Stack, Text, Title } from '@mantine/core';
import { APP_NAME } from '@codeclass/shared';
import type { ReactNode } from 'react';
import { BrandMark } from '../components/BrandMark';

/** Centered card used by setup / login / join pages (style guide §3 "Auth pages"). */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Center mih="100vh" px="md" py="xl">
      <Stack w="100%" maw={440} gap="lg">
        <Stack align="center" gap="xs">
          <BrandMark size={52} />
          <Text fw={700} size="xl" ta="center">
            {APP_NAME}
          </Text>
        </Stack>
        <Paper withBorder shadow="sm" p={{ base: 'lg', xs: 'xl' }}>
          <Stack gap="xs" mb="lg">
            <Title order={2} ta="center" fz="h3">
              {title}
            </Title>
            {subtitle && (
              <Text c="dimmed" size="sm" ta="center">
                {subtitle}
              </Text>
            )}
          </Stack>
          {children}
        </Paper>
        {footer && (
          <Text size="sm" ta="center">
            {footer}
          </Text>
        )}
      </Stack>
    </Center>
  );
}
