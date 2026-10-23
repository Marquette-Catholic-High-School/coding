import { ActionIcon, Card, Code, Group, Switch, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import {
  BUILTIN_INFO,
  CONSTRUCT_INFO,
  type PseudoBuiltin,
  type PseudoBuiltinSetting,
  type PseudocodeConfig,
} from '@codeclass/shared/pseudocode';
import { IconLock, IconRestore } from '@tabler/icons-react';
import { LIMITS } from './builderModel';
import type { ConfigUpdater } from './KeywordsTab';

/** "Built-ins" tab: rename or switch off each built-in function. */
export function BuiltinsTab({ config, readOnly, onChange }: { config: PseudocodeConfig; readOnly: boolean; onChange: ConfigUpdater }) {
  const enabledCount = BUILTIN_INFO.filter((b) => config.builtins[b.id]?.enabled).length;

  const setBuiltin = (id: PseudoBuiltin, patch: Partial<PseudoBuiltinSetting>) =>
    onChange((c) => ({ ...c, builtins: { ...c.builtins, [id]: { ...c.builtins[id], ...patch } } }));

  return (
    <Card>
      <Group justify="space-between" mb={4}>
        <Title order={3} fz="h4">
          Built-in functions
        </Title>
        <Text size="sm" c="dimmed">
          {enabledCount} of {BUILTIN_INFO.length} switched on
        </Text>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Rename a built-in to match your lessons (for example LEN instead of LENGTH), or switch it off until you've taught
        it.
      </Text>
      <Table.ScrollContainer minWidth={760}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={64}>On</Table.Th>
              <Table.Th w={230}>Name students type</Table.Th>
              <Table.Th w={230}>How to use it</Table.Th>
              <Table.Th>What it does</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {BUILTIN_INFO.map((b) => {
              const setting = config.builtins[b.id] ?? { name: b.defaultName, enabled: true };
              const name = setting.name.trim() || b.defaultName;
              const needs = b.requires && !config.constructs[b.requires] ? CONSTRUCT_INFO.find((c) => c.id === b.requires) : undefined;
              const renamed = setting.name.trim() !== b.defaultName;
              return (
                <Table.Tr key={b.id}>
                  <Table.Td>
                    <Switch
                      checked={setting.enabled}
                      onChange={(e) => setBuiltin(b.id, { enabled: e.currentTarget.checked })}
                      disabled={readOnly}
                      aria-label={`${name} switched on`}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <TextInput
                        value={setting.name}
                        onChange={(e) => setBuiltin(b.id, { name: e.currentTarget.value })}
                        onBlur={(e) => {
                          const trimmed = e.currentTarget.value.trim();
                          if (trimmed !== setting.name) setBuiltin(b.id, { name: trimmed });
                        }}
                        disabled={readOnly}
                        maxLength={LIMITS.wordLength}
                        error={setting.name.trim() ? undefined : 'Required'}
                        aria-label={`Name for ${b.defaultName}`}
                        ff="monospace"
                        style={{ flex: 1 }}
                      />
                      {!readOnly && renamed && (
                        <Tooltip label={`Use ${b.defaultName}`}>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            onClick={() => setBuiltin(b.id, { name: b.defaultName })}
                            aria-label={`Rename back to ${b.defaultName}`}
                          >
                            <IconRestore size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Code c={setting.enabled ? undefined : 'dimmed'}>
                      {name}({b.params.join(', ')})
                    </Code>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={setting.enabled ? undefined : 'dimmed'}>
                      {b.description}
                    </Text>
                    {needs && setting.enabled && (
                      <Group gap={4} mt={4} wrap="nowrap">
                        <IconLock size={14} color="var(--mantine-color-orange-text)" />
                        <Text size="xs" c="orange">
                          Needs {needs.label}, which isn't learned yet — students can use it once you switch that on.
                        </Text>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}
