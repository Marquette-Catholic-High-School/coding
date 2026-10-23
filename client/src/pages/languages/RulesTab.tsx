import {
  Card,
  Checkbox,
  Chip,
  Code,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { renderExample, type BlockStyle, type PseudocodeConfig } from '@codeclass/shared/pseudocode';
import {
  IconBraces,
  IconCode,
  IconEqual,
  IconLetterCase,
  IconList,
  IconMessage2,
  IconTextPlus,
} from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { cleanWords, LIMITS, primaryWord } from './builderModel';
import classes from './builder.module.css';
import type { ConfigUpdater } from './KeywordsTab';

const ASSIGN_OPERATORS = ['←', '<-', '=', ':='] as const;
const CONCAT_OPERATORS = ['+', '&'] as const;
type SeparatorMode = 'space' | 'none' | 'custom';

function RuleCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card h="100%">
      <Group gap="xs" mb="sm" wrap="nowrap">
        {icon}
        <Title order={3} fz="h4">
          {title}
        </Title>
      </Group>
      <Stack gap="sm">{children}</Stack>
    </Card>
  );
}

function Example({ label = 'Example', children }: { label?: string; children: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>
        {label}
      </Text>
      <Code block className={classes.example}>
        {children}
      </Code>
    </div>
  );
}

/** `x ← 5` with the first assignment operator, or `SET x TO 5` when there is none. */
function assignLine(config: PseudocodeConfig, name: string, value: string): string {
  const op = config.assignOperators[0];
  return op ? `${name} ${op} ${value}` : `${primaryWord(config, 'set')} ${name} ${primaryWord(config, 'to')} ${value}`;
}

/** An IF example in one block style, using the engine's renderer when it can (else a hand-built one). */
function blockExample(config: PseudocodeConfig, style: Exclude<BlockStyle, 'both'>): string {
  try {
    const rendered = renderExample('if', { ...config, blockStyle: style });
    if (rendered) return rendered;
  } catch {
    // fall through to the hand-built example
  }
  const w = (k: Parameters<typeof primaryWord>[1]) => primaryWord(config, k);
  return style === 'keywords'
    ? `${w('if')} age >= 13 ${w('then')}\n  ${w('output')} "Teen"\n${w('endIf')}`
    : `${w('if')} (age >= 13) {\n  ${w('output')} "Teen"\n}`;
}

/** "Rules" tab: everything about the language that isn't a keyword. */
export function RulesTab({ config, readOnly, onChange }: { config: PseudocodeConfig; readOnly: boolean; onChange: ConfigUpdater }) {
  const set = (patch: Partial<PseudocodeConfig>) => onChange((c) => ({ ...c, ...patch }));
  const output = primaryWord(config, 'output');
  const comment = config.commentPrefixes[0] ?? '//';

  const derivedMode: SeparatorMode = config.outputSeparator === ' ' ? 'space' : config.outputSeparator === '' ? 'none' : 'custom';
  const [customSeparator, setCustomSeparator] = useState(derivedMode === 'custom');
  const separatorMode: SeparatorMode = customSeparator ? 'custom' : derivedMode;

  const operators = [...ASSIGN_OPERATORS, ...config.assignOperators.filter((op) => !(ASSIGN_OPERATORS as readonly string[]).includes(op))];

  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
      <RuleCard icon={<IconLetterCase size={18} />} title="Capital letters">
        <Switch
          checked={config.caseSensitive}
          onChange={(e) => set({ caseSensitive: e.currentTarget.checked })}
          disabled={readOnly}
          label="Keywords must use exactly the capitals shown"
          description={`When off, ${output}, ${output.charAt(0)}${output.slice(1).toLowerCase()} and ${output.toLowerCase()} all work. Variable names always care about capitals.`}
        />
      </RuleCard>

      <RuleCard icon={<IconBraces size={18} />} title="Blocks">
        <Text size="sm" c="dimmed">
          How students show where an IF, loop or procedure ends.
        </Text>
        <SegmentedControl
          fullWidth
          value={config.blockStyle}
          onChange={(v) => set({ blockStyle: v as BlockStyle })}
          disabled={readOnly}
          aria-label="Block style"
          data={[
            { value: 'keywords', label: 'End words' },
            { value: 'braces', label: 'Braces { }' },
            { value: 'both', label: 'Either' },
          ]}
        />
        {config.blockStyle === 'both' ? (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Example label="End words">{blockExample(config, 'keywords')}</Example>
            <Example label="Braces">{blockExample(config, 'braces')}</Example>
          </SimpleGrid>
        ) : (
          <Example>{blockExample(config, config.blockStyle)}</Example>
        )}
      </RuleCard>

      <RuleCard icon={<IconEqual size={18} />} title="Storing values">
        <Text size="sm" c="dimmed">
          {primaryWord(config, 'set')} score {primaryWord(config, 'to')} 0 always works once Variables is learned. Choose
          the symbols students may also use:
        </Text>
        <Chip.Group
          multiple
          value={config.assignOperators}
          onChange={(v) => set({ assignOperators: operators.filter((op) => v.includes(op)) })}
        >
          <Group gap="xs">
            {operators.map((op) => (
              <Chip key={op} value={op} disabled={readOnly} styles={{ label: { fontFamily: 'var(--mantine-font-family-monospace)' } }}>
                score {op} 0
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <Text size="xs" c="dimmed">
          {config.assignOperators.includes('=')
            ? 'A single = at the start of a line stores a value; inside a condition it still means "is equal to".'
            : config.assignOperators.length === 0
              ? `Students will use ${primaryWord(config, 'set')} … ${primaryWord(config, 'to')} for every assignment.`
              : config.assignOperators.includes('←') && !config.assignOperators.includes('<-')
                ? 'Switch on <- too, so students without a ← key on their keyboard can still type it.'
                : `Students can write ${assignLine(config, 'score', '0')}.`}
        </Text>
      </RuleCard>

      <RuleCard icon={<IconMessage2 size={18} />} title="Comments">
        <TagsInput
          label="Comment symbols"
          description="Anything after one of these on a line is ignored."
          placeholder={config.commentPrefixes.length === 0 ? 'e.g. // or #' : undefined}
          value={config.commentPrefixes}
          onChange={(v) => set({ commentPrefixes: cleanWords(v, true) })}
          maxTags={LIMITS.commentPrefixes}
          disabled={readOnly}
          error={config.commentPrefixes.length === 0 ? 'Add at least one symbol' : undefined}
        />
        <Example>{`${comment} Start the score at zero\n${assignLine(config, 'score', '0')}`}</Example>
      </RuleCard>

      <RuleCard icon={<IconCode size={18} />} title="Output">
        <div>
          <Text size="sm" fw={500} mb={4}>
            Between values
          </Text>
          <SegmentedControl
            fullWidth
            value={separatorMode}
            disabled={readOnly}
            aria-label="Text between output values"
            onChange={(v) => {
              const mode = v as SeparatorMode;
              setCustomSeparator(mode === 'custom');
              if (mode === 'space') set({ outputSeparator: ' ' });
              else if (mode === 'none') set({ outputSeparator: '' });
              else if (derivedMode !== 'custom') set({ outputSeparator: ', ' });
            }}
            data={[
              { value: 'space', label: 'A space' },
              { value: 'none', label: 'Nothing' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        </div>
        {separatorMode === 'custom' && (
          <TextInput
            label="Custom text between values"
            description={`Up to ${LIMITS.symbolLength} characters, e.g. a comma and a space.`}
            value={config.outputSeparator}
            onChange={(e) => set({ outputSeparator: e.currentTarget.value })}
            maxLength={LIMITS.symbolLength}
            disabled={readOnly}
            ff="monospace"
          />
        )}
        <Example label="Shows">{`${output} "Total:", 42\n→ Total:${config.outputSeparator}42`}</Example>
        <Switch
          checked={config.outputNewline}
          onChange={(e) => set({ outputNewline: e.currentTarget.checked })}
          disabled={readOnly}
          label="Start a new line after each output"
          description={`When off, the next ${output} carries on along the same line after a space (AP CSP style).`}
        />
      </RuleCard>

      <RuleCard icon={<IconList size={18} />} title="List positions">
        <SegmentedControl
          fullWidth
          value={String(config.listIndexBase)}
          onChange={(v) => set({ listIndexBase: v === '0' ? 0 : 1 })}
          disabled={readOnly}
          aria-label="First list position"
          data={[
            { value: '1', label: 'First item is 1' },
            { value: '0', label: 'First item is 0' },
          ]}
        />
        <Example>{`${assignLine(config, 'pets', '["cat", "dog"]')}\n${output} pets[${config.listIndexBase}]   ${comment} cat`}</Example>
      </RuleCard>

      <RuleCard icon={<IconTextPlus size={18} />} title="Joining text">
        <Checkbox.Group
          label="Symbols that join text together"
          value={config.concatOperators}
          onChange={(v) => set({ concatOperators: CONCAT_OPERATORS.filter((op) => v.includes(op)) })}
          error={config.concatOperators.length === 0 ? 'Choose at least one' : undefined}
        >
          <Stack gap="xs" mt="xs">
            {CONCAT_OPERATORS.map((op) => (
              <Checkbox
                key={op}
                value={op}
                disabled={readOnly}
                label={
                  <>
                    Join with <Code>{op}</Code>, as in <Code>"Hi " {op} name</Code>
                  </>
                }
              />
            ))}
          </Stack>
        </Checkbox.Group>
      </RuleCard>
    </SimpleGrid>
  );
}
