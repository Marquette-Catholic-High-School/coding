import { Group, Input, Radio, SimpleGrid, Stack, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useId } from '@mantine/hooks';
import { IconCalendar } from '@tabler/icons-react';
import cards from '../../components/cards.module.css';
import type { ReportChoiceOption } from './reportChoices';
import type { DayRange } from './reportParams';

/**
 * The report's date range as two optional days, From and To (an empty end is open). Two fields rather than one range
 * picker: the range picker clears a half-picked range when its calendar closes, which could silently turn "from
 * 1 Sep" into "all dates".
 */
export function ReportDateRange({
  value: [from, to],
  onChange,
  autoFocus = false,
}: {
  value: DayRange;
  onChange: (range: DayRange) => void;
  /** Focus "From" when the dialog opens (when it is the dialog's first field). */
  autoFocus?: boolean;
}) {
  const id = useId();
  const day = {
    clearable: true,
    valueFormat: 'D MMM YYYY',
    leftSection: <IconCalendar size={16} />,
    leftSectionPointerEvents: 'none',
  } as const;
  return (
    <Input.Wrapper
      id={id}
      labelElement="div"
      label="Date range"
      description="Assignments count by due date, or by the date they were set if they have no due date. Leave both empty for all assignments."
    >
      <SimpleGrid
        cols={{ base: 1, xs: 2 }}
        spacing="sm"
        mt={6}
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
      >
        <DatePickerInput
          {...day}
          label="From"
          placeholder="Earliest"
          clearButtonProps={{ 'aria-label': 'Clear the From date' }}
          maxDate={to ?? undefined}
          value={from}
          onChange={(next) => onChange([next, to])}
          data-autofocus={autoFocus || undefined}
        />
        <DatePickerInput
          {...day}
          label="To"
          placeholder="Latest"
          clearButtonProps={{ 'aria-label': 'Clear the To date' }}
          minDate={from ?? undefined}
          value={to}
          onChange={(next) => onChange([from, next])}
        />
      </SimpleGrid>
    </Input.Wrapper>
  );
}

/** A choice between kinds of report, as option cards (side by side from `sm` up when `columns`). */
export function ReportChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = false,
  autoFocus = false,
}: {
  label: string;
  value: T;
  options: ReportChoiceOption<T>[];
  onChange: (value: T) => void;
  columns?: boolean;
  /** Focus the chosen option when the dialog opens (it is the dialog's first field). */
  autoFocus?: boolean;
}) {
  const items = options.map((option) => (
    <Radio.Card
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      className={cards.modeCard}
      withBorder={false}
      radius="md"
      opacity={option.disabled ? 0.6 : undefined}
      style={option.disabled ? { cursor: 'not-allowed' } : undefined}
      data-autofocus={(autoFocus && option.value === value) || undefined}
    >
      <Group wrap="nowrap" align="flex-start" gap="sm">
        <Radio.Indicator mt={2} disabled={option.disabled} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text fw={600} size="sm">
            {option.label}
          </Text>
          <Text size="xs" c="dimmed">
            {option.description}
          </Text>
        </div>
      </Group>
    </Radio.Card>
  ));
  return (
    <Radio.Group
      label={label}
      value={value}
      onChange={(next) => {
        const chosen = options.find((option) => option.value === next);
        if (chosen) onChange(chosen.value);
      }}
    >
      {columns ? (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mt="xs">
          {items}
        </SimpleGrid>
      ) : (
        <Stack gap="sm" mt="xs">
          {items}
        </Stack>
      )}
    </Radio.Group>
  );
}
