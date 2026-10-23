import {
  Badge,
  Button,
  Card,
  Code,
  Grid,
  Group,
  Pill,
  Progress,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  BUILTIN_INFO,
  CONSTRUCT_INFO,
  KEYWORD_INFO,
  renderExample,
  type ConstructInfo,
  type KeywordInfo,
  type PseudoConstruct,
  type PseudoKeyword,
  type PseudocodeConfig,
} from '@codeclass/shared/pseudocode';
import { IconLock, IconLockOpen, IconRestore } from '@tabler/icons-react';
import { BADGE_NO_SHRINK, NotLearnedBadge } from '../../components/badges';
import { cleanWords, LIMITS, presetOrDefault } from './builderModel';
import classes from './builder.module.css';

export type ConfigUpdater = (update: (config: PseudocodeConfig) => PseudocodeConfig) => void;

/** Example for a topic rewritten with the teacher's words, or the Classroom wording if it can't be rendered. */
export function topicExample(construct: ConstructInfo, config: PseudocodeConfig): string {
  try {
    return renderExample(construct.id, config) || construct.example;
  } catch {
    return construct.example;
  }
}

function sameConstructs(a: PseudocodeConfig['constructs'], b: PseudocodeConfig['constructs']): boolean {
  return CONSTRUCT_INFO.every((c) => a[c.id] === b[c.id]);
}

/** "Words" tab: one card per topic with its Learned switch and the spellings of its keywords. */
export function KeywordsTab({ config, readOnly, onChange }: { config: PseudocodeConfig; readOnly: boolean; onChange: ConfigUpdater }) {
  const total = CONSTRUCT_INFO.length;
  const learned = CONSTRUCT_INFO.filter((c) => config.constructs[c.id]).length;
  const preset = presetOrDefault(config.presetId);

  const setLearned = (id: PseudoConstruct, on: boolean) =>
    onChange((c) => ({ ...c, constructs: { ...c.constructs, [id]: on } }));
  const setWords = (id: PseudoKeyword, words: string[]) =>
    onChange((c) => ({ ...c, keywords: { ...c.keywords, [id]: cleanWords(words, c.caseSensitive) } }));
  const learnAll = () =>
    onChange((c) => ({ ...c, constructs: Object.fromEntries(CONSTRUCT_INFO.map((i) => [i.id, true])) as PseudocodeConfig['constructs'] }));
  const resetLearned = () => onChange((c) => ({ ...c, constructs: { ...preset.config.constructs } }));

  return (
    <Stack gap="md">
      <Card padding="md">
        <Group justify="space-between" align="center" wrap="wrap" gap="md">
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <Text fw={600} mb={6}>
              {learned} of {total} topics learned
            </Text>
            <Progress value={(learned / total) * 100} size="sm" mb={6} aria-label={`${learned} of ${total} topics learned`} />
            <Text size="xs" c="dimmed">
              Students can only use the words of learned topics — locked words get a friendly "not learned yet" message.
              The first spelling of each word is its primary one, used in the word bank and error messages. Drag the
              pills to reorder; extra spellings are accepted too.
            </Text>
          </div>
          {!readOnly && (
            <Group gap="xs">
              <Button
                variant="default"
                size="sm"
                leftSection={<IconLockOpen size={16} />}
                onClick={learnAll}
                disabled={learned === total}
              >
                Learn everything
              </Button>
              <Tooltip label={`Set the learned topics back to how the ${preset.name} preset starts`}>
                <Button
                  variant="default"
                  size="sm"
                  leftSection={<IconRestore size={16} />}
                  onClick={resetLearned}
                  disabled={sameConstructs(config.constructs, preset.config.constructs)}
                >
                  Reset to {preset.name}
                </Button>
              </Tooltip>
            </Group>
          )}
        </Group>
      </Card>

      {CONSTRUCT_INFO.map((info) => (
        <TopicCard
          key={info.id}
          info={info}
          config={config}
          readOnly={readOnly}
          onLearned={(on) => setLearned(info.id, on)}
          onWords={setWords}
        />
      ))}
    </Stack>
  );
}

function TopicCard({
  info,
  config,
  readOnly,
  onLearned,
  onWords,
}: {
  info: ConstructInfo;
  config: PseudocodeConfig;
  readOnly: boolean;
  onLearned: (on: boolean) => void;
  onWords: (id: PseudoKeyword, words: string[]) => void;
}) {
  const learned = config.constructs[info.id];
  const keywords = KEYWORD_INFO.filter((k) => k.construct === info.id);
  const builtins = BUILTIN_INFO.filter((b) => b.requires === info.id).map((b) => config.builtins[b.id]?.name || b.defaultName);

  return (
    <Card className={learned ? undefined : classes.lockedCard}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md" mb="md">
        <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" size={36} radius="xl" color={learned ? 'brand' : 'gray'}>
            {learned ? <IconLockOpen size={20} /> : <IconLock size={20} />}
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Group gap="xs" wrap="wrap">
              <Title order={3} fz="h4" c={learned ? undefined : 'dimmed'}>
                {info.label}
              </Title>
              {!learned && <NotLearnedBadge />}
            </Group>
            <Text size="sm" c="dimmed">
              {info.description}
            </Text>
          </div>
        </Group>
        <Switch
          label="Learned"
          labelPosition="left"
          checked={learned}
          onChange={(e) => onLearned(e.currentTarget.checked)}
          disabled={readOnly}
          aria-label={`${info.label} learned`}
        />
      </Group>

      <Grid gap="md">
        <Grid.Col span={{ base: 12, md: 7 }}>
          {keywords.length > 0 ? (
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" verticalSpacing="md">
              {keywords.map((k) => (
                <KeywordInput
                  key={k.id}
                  info={k}
                  words={config.keywords[k.id] ?? []}
                  caseSensitive={config.caseSensitive}
                  readOnly={readOnly}
                  onChange={(words) => onWords(k.id, words)}
                />
              ))}
            </SimpleGrid>
          ) : (
            <Text size="sm" c="dimmed">
              This topic uses symbols rather than keywords.
              {builtins.length > 0 && ` Its built-ins (${builtins.join(', ')}) can be renamed on the Built-ins tab.`}
            </Text>
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>
            Example
          </Text>
          <Code block className={classes.example}>
            {topicExample(info, config)}
          </Code>
        </Grid.Col>
      </Grid>
    </Card>
  );
}

function KeywordInput({
  info,
  words,
  caseSensitive,
  readOnly,
  onChange,
}: {
  info: KeywordInfo;
  words: string[];
  caseSensitive: boolean;
  readOnly: boolean;
  onChange: (words: string[]) => void;
}) {
  const same = (a: string, b: string) => (caseSensitive ? a === b : a.toUpperCase() === b.toUpperCase());
  return (
    <TagsInput
      label={
        <>
          {info.label}
          {info.optional && (
            <Tooltip label="Students may leave this word out.">
              <Badge component="span" ml={6} size="xs" variant="light" color="gray" {...BADGE_NO_SHRINK}>
                Optional
              </Badge>
            </Tooltip>
          )}
        </>
      }
      description={info.description}
      value={words}
      onChange={onChange}
      disabled={readOnly}
      maxTags={LIMITS.spellingsPerKeyword}
      isDuplicate={(value, current) => current.some((w) => same(w, value.trim().replace(/\s+/g, ' ')))}
      withPillsReorder={!readOnly}
      placeholder={words.length === 0 ? 'Type a word, then press Enter' : undefined}
      error={words.length === 0 ? 'Add at least one word' : undefined}
      aria-label={`Words for ${info.label}`}
      renderPill={({ value, onRemove, disabled, reorderProps }) => {
        const primary = words.length > 1 && value === words[0];
        return (
          <Pill
            withRemoveButton={!disabled}
            onRemove={onRemove}
            disabled={disabled}
            className={primary ? classes.primaryPill : undefined}
            removeButtonProps={{ 'aria-label': `Remove ${value}` }}
            {...reorderProps}
          >
            {value}
            {primary && <span className={classes.primaryTag}>Primary</span>}
          </Pill>
        );
      }}
    />
  );
}
