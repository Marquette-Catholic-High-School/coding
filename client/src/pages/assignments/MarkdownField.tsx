import { Box, Input, Paper, Tabs, Text, Textarea } from '@mantine/core';
import { useId } from '@mantine/hooks';
import { IconEye, IconPencil } from '@tabler/icons-react';
import { useState, type ChangeEvent, type FocusEventHandler, type ReactNode } from 'react';
import { Markdown } from '../../components/Markdown';

/**
 * Markdown textarea with Write / Preview tabs. Works as an uncontrolled form input: spread
 * `form.getInputProps(path)` and pass `key={form.key(path)}` so it remounts when the form resets.
 */
export function MarkdownField({
  label,
  description,
  placeholder,
  defaultValue,
  onChange,
  onFocus,
  onBlur,
  error,
}: {
  label: string;
  description?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onFocus?: FocusEventHandler<HTMLTextAreaElement>;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
  error?: ReactNode;
}) {
  const [text, setText] = useState(defaultValue ?? '');
  const [tab, setTab] = useState<string | null>('write');
  const id = useId();

  return (
    <Input.Wrapper id={id} label={label} description={description} error={error}>
      <Tabs value={tab} onChange={setTab} mt={description ? 6 : 4}>
        <Tabs.List mb="xs">
          <Tabs.Tab value="write" leftSection={<IconPencil size={16} />}>
            Write
          </Tabs.Tab>
          <Tabs.Tab value="preview" leftSection={<IconEye size={16} />}>
            Preview
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="write">
          <Textarea
            id={id}
            aria-label={label}
            placeholder={placeholder}
            defaultValue={defaultValue}
            onChange={(event) => {
              setText(event.currentTarget.value);
              onChange?.(event);
            }}
            onFocus={onFocus}
            onBlur={onBlur}
            error={!!error}
            autosize
            minRows={6}
            maxRows={20}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          />
        </Tabs.Panel>
        <Tabs.Panel value="preview">
          <Paper withBorder p="md" mih={150}>
            {text.trim() ? (
              <Box>
                <Markdown source={text} />
              </Box>
            ) : (
              <Text size="sm" c="dimmed">
                Nothing to preview yet.
              </Text>
            )}
          </Paper>
        </Tabs.Panel>
      </Tabs>
    </Input.Wrapper>
  );
}
