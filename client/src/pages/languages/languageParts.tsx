// Small pieces shared by the languages pages: usage/owner text and the uninstall danger zone.

import { Button, Card, Group, Text, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import type { Language } from '@codeclass/shared';
import { IconTrash } from '@tabler/icons-react';
import { useUninstallLanguage } from '../../api/languages';
import { notifyError, notifySuccess } from '../../components/notify';
import classes from './builder.module.css';

export function usageLabel(count: number): string {
  if (count === 0) return 'Not used by any assignments';
  return `Used by ${count} assignment${count === 1 ? '' : 's'}`;
}

export function ownerLabel(language: Pick<Language, 'ownerId' | 'ownerName'>, viewerId: number): string {
  if (language.ownerId === viewerId) return 'Created by you';
  return language.ownerName ? `Created by ${language.ownerName}` : 'Creator no longer has an account';
}

/** "Uninstall" (packs) / "Delete" (pseudocode) card. Blocked while assignments use the language. */
export function LanguageDangerZone({ language, onDeleted }: { language: Language; onDeleted: () => void }) {
  const uninstall = useUninstallLanguage();
  const isPack = language.kind !== 'pseudocode';
  const verb = isPack ? 'Uninstall' : 'Delete';
  const inUse = language.assignmentCount > 0;
  const blockedReason = `${usageLabel(language.assignmentCount)}. Move or delete those assignments first, or switch the language off instead.`;

  const confirm = () => {
    const modalId = modals.openConfirmModal({
      title: `${verb} ${language.name}?`,
      children: (
        <Text size="sm">
          {isPack
            ? `${language.name} will be removed from every class. You can install it again from the catalog at any time.`
            : `${language.name} and all of its words will be deleted for everyone. This can't be undone.`}{' '}
          Playground projects keep their code.
        </Text>
      ),
      labels: { confirm: verb, cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      closeOnConfirm: false,
      onConfirm: async () => {
        modals.updateModal({ modalId, confirmProps: { color: 'red', loading: true } });
        try {
          await uninstall.mutateAsync(language.id);
          modals.close(modalId);
          notifySuccess(
            isPack ? `${language.name} uninstalled` : `${language.name} deleted`,
            isPack ? 'Teachers can no longer add it to classes.' : 'Create a new pseudocode language whenever you need one.',
          );
          onDeleted();
        } catch (err) {
          modals.close(modalId);
          notifyError(err, `Couldn't ${verb.toLowerCase()} ${language.name}`);
        }
      },
    });
  };

  return (
    <Card className={classes.dangerCard}>
      <Title order={3} fz="h4" mb="sm">
        Danger zone
      </Title>
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <Text fw={600}>
            {verb} {language.name}
          </Text>
          <Text size="sm" c="dimmed">
            {inUse
              ? blockedReason
              : isPack
                ? "Removes it from every class. Students' playground projects keep their code."
                : 'Deletes the language and its words for everyone.'}
          </Text>
        </div>
        <Tooltip label={blockedReason} multiline maw={300} disabled={!inUse}>
          <Button
            color="red"
            variant="light"
            leftSection={<IconTrash size={18} />}
            data-disabled={inUse || undefined}
            aria-disabled={inUse}
            onClick={(e) => {
              if (inUse) {
                e.preventDefault();
                return;
              }
              confirm();
            }}
          >
            {verb} language
          </Button>
        </Tooltip>
      </Group>
    </Card>
  );
}
