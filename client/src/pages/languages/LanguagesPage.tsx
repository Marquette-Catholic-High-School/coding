import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  EmptyState,
  Group,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  LANGUAGE_KIND_LABELS,
  LANGUAGE_PACKS,
  type CatalogResponse,
  type Language,
} from '@codeclass/shared';
import { CONSTRUCT_INFO } from '@codeclass/shared/pseudocode';
import {
  IconBuildingStore,
  IconCheck,
  IconChecklist,
  IconClipboardList,
  IconDownload,
  IconExternalLink,
  IconInfoCircle,
  IconKeyboard,
  IconLockOpen,
  IconPackages,
  IconPlus,
  IconUser,
  IconWorld,
  IconWriting,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInstallLanguage, useLanguageCatalog, useLanguages } from '../../api/languages';
import { useCurrentUser } from '../../auth/AuthProvider';
import { BADGE_NO_SHRINK, LanguageBadge } from '../../components/badges';
import cards from '../../components/cards.module.css';
import { LanguageIcon } from '../../components/LanguageIcon';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { usePageTitle } from '../../hooks/usePageTitle';
import { CreatePseudocodeModal } from './CreatePseudocodeModal';
import { DisabledBadge, ownerLabel, usageLabel } from './languageParts';

type Tab = 'installed' | 'catalog';

const DIMMED = 'var(--mantine-color-dimmed)';

export function LanguagesPage() {
  usePageTitle('Languages');
  const user = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'catalog' ? 'catalog' : 'installed';
  const [createOpened, createModal] = useDisclosure(false);
  const languages = useLanguages();

  const installedIds = new Set((languages.data?.languages ?? []).map((l) => l.id));
  const availableCount = languages.data ? LANGUAGE_PACKS.filter((p) => !installedIds.has(p.id)).length : 0;

  const setTab = (value: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', value === 'catalog' ? 'catalog' : 'installed');
        return next;
      },
      { replace: true },
    );
  };

  return (
    <>
      <PageHeader
        title="Languages"
        subtitle="The coding languages your classes can use. Install packs like Python, or design a pseudocode language that uses the words your class has learned."
        actions={
          <Button leftSection={<IconPlus size={18} />} onClick={createModal.open}>
            New pseudocode language
          </Button>
        }
      />

      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="lg">
          <Tabs.Tab
            value="installed"
            leftSection={<IconPackages size={16} />}
            rightSection={
              languages.data && languages.data.languages.length > 0 ? (
                <Badge size="xs" variant="light" circle>
                  {languages.data.languages.length}
                </Badge>
              ) : null
            }
          >
            Installed
          </Tabs.Tab>
          <Tabs.Tab
            value="catalog"
            leftSection={<IconBuildingStore size={16} />}
            rightSection={
              availableCount > 0 ? (
                <Badge size="xs" variant="light" circle>
                  {availableCount}
                </Badge>
              ) : null
            }
          >
            Catalog
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="installed">
          <QueryState query={languages}>
            {({ languages: list }) => (
              <InstalledLanguages
                languages={list}
                viewerId={user.id}
                isAdmin={user.role === 'admin'}
                onCreate={createModal.open}
                onBrowseCatalog={() => setTab('catalog')}
              />
            )}
          </QueryState>
        </Tabs.Panel>
        <Tabs.Panel value="catalog">
          <Catalog isAdmin={user.role === 'admin'} />
        </Tabs.Panel>
      </Tabs>

      <CreatePseudocodeModal opened={createOpened} onClose={createModal.close} />
    </>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <Group justify="space-between" mb="sm">
      <Title order={3} fz="h4">
        {title}
      </Title>
      <Badge variant="light" color="gray" {...BADGE_NO_SHRINK}>
        {count}
      </Badge>
    </Group>
  );
}

function InstalledLanguages({
  languages,
  viewerId,
  isAdmin,
  onCreate,
  onBrowseCatalog,
}: {
  languages: Language[];
  viewerId: number;
  isAdmin: boolean;
  onCreate: () => void;
  onBrowseCatalog: () => void;
}) {
  const pseudo = languages.filter((l) => l.kind === 'pseudocode');
  const packs = languages.filter((l) => l.kind !== 'pseudocode');

  return (
    <Stack gap="xl">
      <section>
        <SectionHeader title="Pseudocode languages" count={pseudo.length} />
        {pseudo.length === 0 ? (
          <Card py={40}>
            <EmptyState
              variant="light"
              size="lg"
              icon={<IconWriting size={32} />}
              title="Design your own pseudocode"
              description="Choose the words your class uses — OUTPUT or DISPLAY, ← or SET … TO — and switch topics on as you teach them."
            >
              <EmptyState.Actions>
                <Button size="md" leftSection={<IconPlus size={18} />} onClick={onCreate}>
                  New pseudocode language
                </Button>
              </EmptyState.Actions>
            </EmptyState>
          </Card>
        ) : (
          <LanguageGrid languages={pseudo} viewerId={viewerId} />
        )}
      </section>

      <section>
        <SectionHeader title="Language packs" count={packs.length} />
        {packs.length === 0 ? (
          <Card py={40}>
            <EmptyState
              variant="light"
              color="gray"
              size="lg"
              icon={<IconPackages size={32} />}
              title="No language packs installed"
              description={
                isAdmin
                  ? 'Install Python, JavaScript, SQL and more from the catalog. Everything runs in the browser.'
                  : 'Ask an admin to install the packs your classes need from the catalog.'
              }
            >
              <EmptyState.Actions>
                <Button variant={isAdmin ? 'filled' : 'default'} leftSection={<IconBuildingStore size={18} />} onClick={onBrowseCatalog}>
                  Browse the catalog
                </Button>
              </EmptyState.Actions>
            </EmptyState>
          </Card>
        ) : (
          <LanguageGrid languages={packs} viewerId={viewerId} />
        )}
      </section>
    </Stack>
  );
}

function LanguageGrid({ languages, viewerId }: { languages: Language[]; viewerId: number }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
      {languages.map((l) => (
        <LanguageCard key={l.id} language={l} viewerId={viewerId} />
      ))}
    </SimpleGrid>
  );
}

function Meta({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      {icon}
      <Text size="sm" truncate>
        {children}
      </Text>
    </Group>
  );
}

function LanguageCard({ language, viewerId }: { language: Language; viewerId: number }) {
  const pseudo = language.kind === 'pseudocode';
  const learned = pseudo && language.pseudocode ? CONSTRUCT_INFO.filter((c) => language.pseudocode!.constructs[c.id]).length : 0;
  return (
    <Card component={Link} to={`/languages/${encodeURIComponent(language.id)}`} className={cards.linkCard}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="sm">
        <ThemeIcon variant="light" size={40} radius="md" color={pseudo ? 'brand' : 'indigo'}>
          <LanguageIcon kind={language.kind} size={22} />
        </ThemeIcon>
        <Group gap={6} justify="flex-end">
          {!language.enabled && <DisabledBadge />}
          <LanguageBadge kind={language.kind} name={LANGUAGE_KIND_LABELS[language.kind]} />
        </Group>
      </Group>
      <Text fw={650} size="lg" lineClamp={2}>
        {language.name}
      </Text>
      <Text size="xs" c="dimmed" mb="xs" lineClamp={1}>
        {language.version}
      </Text>
      <Text size="sm" c="dimmed" lineClamp={2} mb="md" style={{ flex: 1 }}>
        {language.description || (pseudo ? 'No description yet.' : '')}
      </Text>
      <Stack gap={6}>
        <Group gap="lg">
          <Meta icon={<IconClipboardList size={16} color={DIMMED} />}>{usageLabel(language.assignmentCount)}</Meta>
          {pseudo && (
            <Meta icon={<IconLockOpen size={16} color={DIMMED} />}>
              {learned} of {CONSTRUCT_INFO.length} topics learned
            </Meta>
          )}
        </Group>
        {pseudo && <Meta icon={<IconUser size={16} color={DIMMED} />}>{ownerLabel(language, viewerId)}</Meta>}
      </Stack>
    </Card>
  );
}

function Catalog({ isAdmin }: { isAdmin: boolean }) {
  const catalog = useLanguageCatalog();
  const install = useInstallLanguage();

  const handleInstall = (pack: CatalogResponse['packs'][number]) => {
    install.mutate(
      { kind: pack.kind },
      {
        onSuccess: () => notifySuccess(`${pack.name} installed`, 'Teachers can now add it to their classes.'),
        onError: (err) => notifyError(err, `Couldn't install ${pack.name}`),
      },
    );
  };

  return (
    <>
      {!isAdmin && (
        <Alert variant="light" color="blue" icon={<IconInfoCircle size={20} />} title="Only admins install language packs" mb="lg">
          <Text size="sm">
            Ask an admin if your class needs one of these. You can create your own pseudocode languages at any time.
          </Text>
        </Alert>
      )}
      <QueryState query={catalog}>
        {({ packs }) => (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            {packs.map((pack) => (
              <Card key={pack.id} h="100%">
                <Group justify="space-between" align="flex-start" wrap="nowrap" mb="sm">
                  <ThemeIcon variant="light" size={40} radius="md" color="indigo">
                    <LanguageIcon kind={pack.kind} size={22} />
                  </ThemeIcon>
                  {pack.installed && (
                    <Badge variant="light" color="teal" leftSection={<IconCheck size={12} />} {...BADGE_NO_SHRINK}>
                      Installed
                    </Badge>
                  )}
                </Group>
                <Text fw={650} size="lg">
                  {pack.name}
                </Text>
                <Text size="xs" c="dimmed" mb="xs">
                  {pack.version}
                </Text>
                <Text size="sm" c="dimmed" mb="md" style={{ flex: 1 }}>
                  {pack.description}
                </Text>
                <Group gap={6} mb="sm">
                  {pack.supportsInput && (
                    <Tooltip label="Programs can ask the user to type something in.">
                      <Badge variant="light" color="blue" leftSection={<IconKeyboard size={12} />} {...BADGE_NO_SHRINK}>
                        Reads input
                      </Badge>
                    </Tooltip>
                  )}
                  {pack.supportsTests && (
                    <Tooltip label="Assignments can check students' output against tests automatically.">
                      <Badge variant="light" color="brand" leftSection={<IconChecklist size={12} />} {...BADGE_NO_SHRINK}>
                        Autograded tests
                      </Badge>
                    </Tooltip>
                  )}
                  {pack.kind === 'web' && (
                    <Tooltip label="Students see their page live in a safe preview as they type.">
                      <Badge variant="light" color="indigo" leftSection={<IconWorld size={12} />} {...BADGE_NO_SHRINK}>
                        Live preview
                      </Badge>
                    </Tooltip>
                  )}
                </Group>
                <Meta icon={<IconDownload size={16} color={DIMMED} />}>{pack.downloadSize}</Meta>
                <Group justify="space-between" align="center" mt="md" gap="sm">
                  <Anchor
                    href={pack.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    Language guide <IconExternalLink size={14} />
                  </Anchor>
                  {pack.installed ? (
                    <Button variant="default" component={Link} to={`/languages/${encodeURIComponent(pack.id)}`}>
                      Open
                    </Button>
                  ) : isAdmin ? (
                    <Button
                      leftSection={<IconDownload size={18} />}
                      loading={install.isPending && install.variables?.kind === pack.kind}
                      disabled={install.isPending && install.variables?.kind !== pack.kind}
                      onClick={() => handleInstall(pack)}
                    >
                      Install
                    </Button>
                  ) : null}
                </Group>
              </Card>
            ))}
          </SimpleGrid>
        )}
      </QueryState>
    </>
  );
}
