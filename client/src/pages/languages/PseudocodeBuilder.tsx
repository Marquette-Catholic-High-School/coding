import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  Menu,
  Paper,
  Switch,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import type { Language } from '@codeclass/shared';
import {
  BUILTIN_INFO,
  CONSTRUCT_INFO,
  createPseudocodeConfig,
  PSEUDOCODE_PRESETS,
  type PseudocodeConfig,
  type PseudocodePreset,
} from '@codeclass/shared/pseudocode';
import {
  IconAbc,
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconBook2,
  IconChevronDown,
  IconDeviceFloppy,
  IconFileCode,
  IconLock,
  IconMathFunction,
  IconPencil,
  IconPlayerPlay,
  IconSettings,
  IconTemplate,
  IconWand,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { fieldErrors } from '../../api/client';
import { useUpdateLanguage } from '../../api/languages';
import { useCurrentUser } from '../../auth/AuthProvider';
import { LanguageBadge } from '../../components/badges';
import cards from '../../components/cards.module.css';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageHeader } from '../../components/PageHeader';
import { CodeWorkspace, WordBank } from '../../ide';
import { BuilderSettingsTab } from './BuilderSettingsTab';
import { BuiltinsTab } from './BuiltinsTab';
import { draftProblems, presetOrDefault, sameDraft, sampleProgram, toDraft, type LanguageDraft } from './builderModel';
import { KeywordsTab } from './KeywordsTab';
import { DisabledBadge, ownerLabel, usageLabel } from './languageParts';
import { RulesTab } from './RulesTab';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

const TABS = ['words', 'builtins', 'rules', 'wordbank', 'try', 'settings'] as const;
type BuilderTab = (typeof TABS)[number];

function isTab(value: string | null): value is BuilderTab {
  return (TABS as readonly string[]).includes(value ?? '');
}

function safeSample(config: PseudocodeConfig): string {
  try {
    return sampleProgram(config);
  } catch {
    return presetOrDefault(config.presetId).sample;
  }
}

/**
 * The pseudocode language builder. The whole language is edited as one local draft; nothing reaches students
 * until Save. "Try it" and the word bank always reflect the draft.
 */
export function PseudocodeBuilder({ language }: { language: Language }) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const update = useUpdateLanguage();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: BuilderTab = isTab(tabParam) ? tabParam : 'words';
  const readOnly = !language.canEdit;

  const [draft, setDraft] = useState<LanguageDraft>(() => toDraft(language));
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showLocked, setShowLocked] = useState(true);
  // Bumped when the draft is replaced wholesale so tab-local input state (half-typed words etc.) starts fresh.
  const [resetKey, setResetKey] = useState(0);
  const [tryCode, setTryCode] = useState(() => language.starterCode || safeSample(draft.pseudocode));

  // Adopt newer server data (after saving, or another tab's edit) unless there are unsaved local changes.
  const previous = useRef(language);
  useEffect(() => {
    const prev = previous.current;
    previous.current = language;
    if (prev === language) return;
    setDraft((current) => (sameDraft(current, toDraft(prev)) ? toDraft(language) : current));
  }, [language]);

  const savedDraft = useMemo(() => toDraft(language), [language]);
  const dirty = useMemo(() => !readOnly && !sameDraft(draft, savedDraft), [readOnly, draft, savedDraft]);
  const problems = useMemo(() => {
    const local = draftProblems(draft);
    return [...local, ...serverProblems.filter((p) => !local.includes(p))];
  }, [draft, serverProblems]);
  const invalid = problems.length > 0;
  const allowLeave = useUnsavedChangesGuard(dirty);

  const tryLanguage = useMemo<Language>(
    () => ({ ...language, name: draft.name, starterCode: draft.starterCode, pseudocode: draft.pseudocode }),
    [language, draft.name, draft.starterCode, draft.pseudocode],
  );

  const edit = useCallback((patch: Partial<LanguageDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setServerProblems([]);
    if ('name' in patch) setNameError(null);
  }, []);

  const editConfig = useCallback((change: (config: PseudocodeConfig) => PseudocodeConfig) => {
    setDraft((d) => ({ ...d, pseudocode: change(d.pseudocode) }));
    setServerProblems([]);
  }, []);

  const setTab = (value: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', isTab(value) ? value : 'words');
        return next;
      },
      { replace: true },
    );
  };

  const discard = () => {
    setDraft(savedDraft);
    setServerProblems([]);
    setNameError(null);
    setResetKey((k) => k + 1);
  };

  const save = async () => {
    if (!dirty || invalid || update.isPending) return;
    const sent = draft;
    try {
      const { language: saved } = await update.mutateAsync({
        id: language.id,
        name: sent.name.trim(),
        description: sent.description.trim(),
        enabled: sent.enabled,
        starterCode: sent.starterCode,
        pseudocode: sent.pseudocode,
      });
      setDraft((current) => (current === sent ? toDraft(saved) : current));
      notifySuccess(
        `${saved.name} saved`,
        saved.enabled
          ? 'Students get the new words the next time they open the editor.'
          : "It's switched off, so it can't be chosen for new work until you enable it.",
      );
    } catch (err) {
      const errors = fieldErrors(err);
      if (errors.pseudocode) setServerProblems(errors.pseudocode.split('; '));
      if (errors.name) setNameError(errors.name);
      notifyError(err, "Couldn't save the language");
    }
  };

  useHotkeys([['mod+s', () => void save()]], [], true);

  const startFromPreset = (preset: PseudocodePreset) => {
    modals.openConfirmModal({
      title: `Start from ${preset.name}?`,
      children: (
        <Text size="sm">
          This replaces every word, learned topic, built-in and rule in your draft with the {preset.name} preset. The
          name, description and starter code stay the same, and nothing is saved until you click Save.
        </Text>
      ),
      labels: { confirm: `Use ${preset.name}`, cancel: 'Cancel' },
      onConfirm: () => {
        editConfig(() => createPseudocodeConfig(preset.id));
        setResetKey((k) => k + 1);
      },
    });
  };

  const learnedCount = CONSTRUCT_INFO.filter((c) => draft.pseudocode.constructs[c.id]).length;
  const builtinCount = BUILTIN_INFO.filter((b) => draft.pseudocode.builtins[b.id]?.enabled).length;
  const preset = presetOrDefault(draft.pseudocode.presetId);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Languages', to: '/languages' }, { label: language.name }]}
        title={language.name}
        badges={
          <>
            <LanguageBadge kind="pseudocode" name="Pseudocode" />
            {!language.enabled && <DisabledBadge />}
          </>
        }
        subtitle={`${ownerLabel(language, user.id)} · ${usageLabel(language.assignmentCount)}`}
        actions={
          !readOnly && (
            <Menu position="bottom-end" width={320} withinPortal>
              <Menu.Target>
                <Button variant="default" leftSection={<IconTemplate size={18} />} rightSection={<IconChevronDown size={16} />}>
                  Start from preset…
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Replace all words and rules with</Menu.Label>
                {PSEUDOCODE_PRESETS.map((p) => (
                  <Menu.Item key={p.id} onClick={() => startFromPreset(p)}>
                    <Text size="sm" fw={500}>
                      {p.name}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {p.description}
                    </Text>
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )
        }
      />

      {readOnly && (
        <Alert variant="light" color="blue" icon={<IconLock size={20} />} title="View only" mb="lg">
          <Text size="sm">
            Only {language.ownerName ?? 'the teacher who created it'} or an admin can edit this language. You can still
            look around, try it out and use it in your classes.
          </Text>
        </Alert>
      )}

      {!readOnly && invalid && (
        <Alert
          variant="light"
          color="red"
          icon={<IconAlertCircle size={20} />}
          title={problems.length === 1 ? 'Fix this before saving' : `Fix these ${problems.length} problems before saving`}
          mb="lg"
        >
          <List size="sm" spacing={2}>
            {problems.map((p) => (
              <List.Item key={p}>{p}</List.Item>
            ))}
          </List>
        </Alert>
      )}

      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="lg">
          <Tabs.Tab
            value="words"
            leftSection={<IconAbc size={16} />}
            rightSection={
              <Badge size="xs" variant="light">
                {learnedCount}/{CONSTRUCT_INFO.length}
              </Badge>
            }
          >
            Words
          </Tabs.Tab>
          <Tabs.Tab
            value="builtins"
            leftSection={<IconMathFunction size={16} />}
            rightSection={
              <Badge size="xs" variant="light" circle>
                {builtinCount}
              </Badge>
            }
          >
            Built-ins
          </Tabs.Tab>
          <Tabs.Tab value="rules" leftSection={<IconAdjustmentsHorizontal size={16} />}>
            Rules
          </Tabs.Tab>
          <Tabs.Tab value="wordbank" leftSection={<IconBook2 size={16} />}>
            Word bank
          </Tabs.Tab>
          <Tabs.Tab value="try" leftSection={<IconPlayerPlay size={16} />}>
            Try it
          </Tabs.Tab>
          <Tabs.Tab value="settings" leftSection={<IconSettings size={16} />}>
            Settings
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="words">
          <KeywordsTab key={resetKey} config={draft.pseudocode} readOnly={readOnly} onChange={editConfig} />
        </Tabs.Panel>
        <Tabs.Panel value="builtins">
          <BuiltinsTab key={resetKey} config={draft.pseudocode} readOnly={readOnly} onChange={editConfig} />
        </Tabs.Panel>
        <Tabs.Panel value="rules">
          <RulesTab key={resetKey} config={draft.pseudocode} readOnly={readOnly} onChange={editConfig} />
        </Tabs.Panel>
        <Tabs.Panel value="wordbank">
          <Card>
            <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="md">
              <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                <Title order={3} fz="h4">
                  Word bank preview
                </Title>
                <Text size="sm" c="dimmed">
                  Students see this in the Words panel next to their code. It follows your draft as you edit.
                </Text>
              </div>
              <Switch
                label="Show topics not learned yet"
                checked={showLocked}
                onChange={(e) => setShowLocked(e.currentTarget.checked)}
              />
            </Group>
            <WordBank config={draft.pseudocode} showLocked={showLocked} />
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="try">
          <Text size="sm" c="dimmed" mb="sm">
            Changes to words and rules apply here straight away — you don't need to save first.
          </Text>
          <CodeWorkspace
            language={tryLanguage}
            code={tryCode}
            onCodeChange={setTryCode}
            height="max(520px, calc(100dvh - 330px))"
            storageKey="language-builder-try"
            toolbarRight={
              <Menu position="bottom-end" width={280} withinPortal>
                <Menu.Target>
                  <Button size="xs" variant="default" leftSection={<IconFileCode size={14} />} rightSection={<IconChevronDown size={14} />}>
                    Load a program
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconWand size={16} />} onClick={() => setTryCode(safeSample(draft.pseudocode))}>
                    Example using your learned words
                  </Menu.Item>
                  <Menu.Item leftSection={<IconTemplate size={16} />} onClick={() => setTryCode(preset.sample)}>
                    {preset.name} sample program
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconSettings size={16} />}
                    onClick={() => setTryCode(draft.starterCode)}
                    disabled={!draft.starterCode.trim()}
                  >
                    Starter code
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            }
          />
        </Tabs.Panel>
        <Tabs.Panel value="settings">
          <BuilderSettingsTab
            language={language}
            draft={draft}
            readOnly={readOnly}
            nameError={nameError}
            onEdit={edit}
            onDeleted={() => {
              allowLeave();
              navigate('/languages', { replace: true });
            }}
          />
        </Tabs.Panel>
      </Tabs>

      {dirty && (
        <Paper className={cards.saveBar} withBorder shadow="md" p="sm" mt="lg">
          <Group justify="space-between" gap="sm">
            <Group gap="xs" wrap="nowrap">
              <ThemeIcon variant="light" color={invalid ? 'red' : 'orange'} size={28} radius="xl">
                {invalid ? <IconAlertCircle size={16} /> : <IconPencil size={16} />}
              </ThemeIcon>
              <Text size="sm" fw={500}>
                {invalid
                  ? `Fix ${problems.length === 1 ? 'the problem' : `${problems.length} problems`} above to save`
                  : 'You have unsaved changes'}
              </Text>
            </Group>
            <Group gap="sm">
              <Button variant="default" onClick={discard} disabled={update.isPending}>
                Discard
              </Button>
              <Button
                onClick={() => void save()}
                loading={update.isPending}
                disabled={invalid}
                leftSection={<IconDeviceFloppy size={18} />}
              >
                Save changes
              </Button>
            </Group>
          </Group>
        </Paper>
      )}
    </>
  );
}
