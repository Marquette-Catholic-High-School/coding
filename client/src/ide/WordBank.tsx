import { Badge, Code, Group, Paper, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { buildBuiltinVocabulary, buildVocabulary, type VocabBuiltin, type VocabEntry } from '@codeclass/shared/pseudocode';
import { IconLock } from '@tabler/icons-react';
import { useMemo } from 'react';
import { BADGE_NO_SHRINK, CodeChip } from '../components/badges';
import classes from './ide.module.css';
import type { WordBankProps } from './types';

function NotLearnedBadge({ size = 'sm' }: { size?: 'xs' | 'sm' }) {
  return (
    <Tooltip label="Your teacher hasn't switched this on yet. You'll learn it in a later lesson.">
      <Badge variant="light" color="gray" size={size} leftSection={<IconLock size={12} />} {...BADGE_NO_SHRINK}>
        Not learned yet
      </Badge>
    </Tooltip>
  );
}

function SectionTitle({ compact, children, count }: { compact?: boolean; children: string; count?: number }) {
  return (
    <Group justify="space-between" gap="xs" mb={compact ? 6 : 'sm'}>
      {compact ? (
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          {children}
        </Text>
      ) : (
        <Title order={3} fz="h4">
          {children}
        </Title>
      )}
      {count != null && (
        <Text size="sm" c="dimmed">
          {count}
        </Text>
      )}
    </Group>
  );
}

function EntryCard({ entry, compact }: { entry: VocabEntry; compact?: boolean }) {
  const locked = !entry.enabled;
  return (
    <Paper withBorder p={compact ? 'xs' : 'sm'} className={locked ? classes.lockedEntry : undefined}>
      <Stack gap={6}>
        <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            {locked && <IconLock size={16} color="var(--mantine-color-dimmed)" aria-hidden />}
            <Text fw={600} size={compact ? 'sm' : 'md'} c={locked ? 'dimmed' : undefined} truncate>
              {entry.label}
            </Text>
          </Group>
          {locked && <NotLearnedBadge size={compact ? 'xs' : 'sm'} />}
        </Group>
        {entry.words.length > 0 && (
          <Group gap={4} aria-label={`Words: ${entry.words.join(', ')}`}>
            {entry.words.map((w) => (
              <CodeChip key={w}>{w}</CodeChip>
            ))}
          </Group>
        )}
        <Text size={compact ? 'xs' : 'sm'} c="dimmed">
          {entry.description}
        </Text>
        {entry.example && (
          <Code block className={classes.codeBlock} fz={compact ? 'xs' : 'sm'} c={locked ? 'dimmed' : undefined}>
            {entry.example}
          </Code>
        )}
      </Stack>
    </Paper>
  );
}

function BuiltinsTable({ builtins, compact }: { builtins: VocabBuiltin[]; compact?: boolean }) {
  return (
    <Table verticalSpacing={compact ? 6 : 'xs'} horizontalSpacing={compact ? 'xs' : 'sm'} fz={compact ? 'xs' : 'sm'} layout="fixed">
      <Table.Thead>
        <Table.Tr>
          <Table.Th w={compact ? '45%' : '35%'}>Function</Table.Th>
          <Table.Th>What it does</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {builtins.map((b) => (
          <Table.Tr key={b.id}>
            <Table.Td style={{ verticalAlign: 'top' }}>
              <Code className={classes.codeBlock} c={b.enabled ? undefined : 'dimmed'} td={b.enabled ? undefined : 'line-through'}>
                {b.signature}
              </Code>
            </Table.Td>
            <Table.Td style={{ verticalAlign: 'top' }}>
              <Stack gap={4} align="flex-start">
                <Text inherit c={b.enabled ? undefined : 'dimmed'}>
                  {b.description}
                </Text>
                {!b.enabled && <NotLearnedBadge size="xs" />}
              </Stack>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** The words a class may use in its pseudocode: learned constructs first, then locked ones and built-ins. */
export function WordBank({ config, showLocked = true, compact }: WordBankProps) {
  const vocabulary = useMemo(() => buildVocabulary(config), [config]);
  const builtins = useMemo(() => buildBuiltinVocabulary(config), [config]);

  const learned = vocabulary.filter((e) => e.enabled);
  const locked = showLocked ? vocabulary.filter((e) => !e.enabled) : [];
  const visibleBuiltins = [...builtins.filter((b) => b.enabled), ...(showLocked ? builtins.filter((b) => !b.enabled) : [])];
  const gap = compact ? 'md' : 'lg';

  return (
    <Stack gap={gap}>
      <section>
        <SectionTitle compact={compact} count={compact ? undefined : learned.length}>
          Words you can use
        </SectionTitle>
        {learned.length === 0 ? (
          <Text size="sm" c="dimmed">
            No words are switched on yet. Your teacher turns them on as the class learns them.
          </Text>
        ) : (
          <Stack gap={compact ? 'xs' : 'sm'}>
            {learned.map((e) => (
              <EntryCard key={e.construct} entry={e} compact={compact} />
            ))}
          </Stack>
        )}
      </section>

      {locked.length > 0 && (
        <section>
          <SectionTitle compact={compact} count={compact ? undefined : locked.length}>
            Coming later
          </SectionTitle>
          <Stack gap={compact ? 'xs' : 'sm'}>
            {locked.map((e) => (
              <EntryCard key={e.construct} entry={e} compact={compact} />
            ))}
          </Stack>
        </section>
      )}

      {visibleBuiltins.length > 0 && (
        <section>
          <SectionTitle compact={compact} count={compact ? undefined : visibleBuiltins.filter((b) => b.enabled).length}>
            Built-in functions
          </SectionTitle>
          <BuiltinsTable builtins={visibleBuiltins} compact={compact} />
        </section>
      )}
    </Stack>
  );
}
