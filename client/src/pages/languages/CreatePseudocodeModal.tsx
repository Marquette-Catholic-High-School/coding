import {
  Button,
  Code,
  Group,
  Modal,
  Radio,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { DEFAULT_PRESET_ID, PSEUDOCODE_PRESETS } from '@codeclass/shared/pseudocode';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { fieldErrors } from '../../api/client';
import { useCreatePseudocode, useLanguages } from '../../api/languages';
import { useCurrentUser } from '../../auth/AuthProvider';
import cards from '../../components/cards.module.css';
import { notifyError, notifySuccess } from '../../components/notify';
import classes from './builder.module.css';

type Source = 'preset' | 'copy';

interface FormValues {
  name: string;
  description: string;
  presetId: string;
  copyFromId: string | null;
}

/** First few lines of a preset's sample program for the preset card. */
function snippet(sample: string): string {
  return sample.trim().split('\n').slice(0, 4).join('\n');
}

export function CreatePseudocodeModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const create = useCreatePseudocode();
  const languages = useLanguages();
  const [source, setSource] = useState<Source>('preset');

  const form = useForm<FormValues>({
    mode: 'uncontrolled',
    initialValues: { name: '', description: '', presetId: DEFAULT_PRESET_ID, copyFromId: null },
    validate: {
      name: (v) => (v.trim() ? null : 'Give your language a name'),
    },
  });

  const copyOptions = useMemo(() => {
    const pseudo = (languages.data?.languages ?? []).filter((l) => l.kind === 'pseudocode');
    const mine = pseudo.filter((l) => l.ownerId === user.id).map((l) => ({ value: l.id, label: l.name }));
    const others = pseudo
      .filter((l) => l.ownerId !== user.id)
      .map((l) => ({ value: l.id, label: l.ownerName ? `${l.name} (${l.ownerName})` : l.name }));
    return [
      ...(mine.length ? [{ group: 'Your languages', items: mine }] : []),
      ...(others.length ? [{ group: 'Other teachers', items: others }] : []),
    ];
  }, [languages.data, user.id]);
  const canCopy = copyOptions.length > 0;

  const handleClose = () => {
    form.reset();
    create.reset();
    setSource('preset');
    onClose();
  };

  const handleSubmit = form.onSubmit(async (values) => {
    if (source === 'copy' && !values.copyFromId) {
      form.setFieldError('copyFromId', 'Choose a language to copy');
      return;
    }
    try {
      const { language } = await create.mutateAsync({
        name: values.name,
        description: values.description,
        ...(source === 'copy' && values.copyFromId ? { copyFromId: values.copyFromId } : { presetId: values.presetId }),
      });
      notifySuccess(`${language.name} created`, 'Now switch on the topics your class has learned and pick their words.');
      handleClose();
      navigate(`/languages/${encodeURIComponent(language.id)}?tab=words`);
    } catch (err) {
      const errors = fieldErrors(err);
      if (Object.keys(errors).length > 0) form.setErrors(errors);
      else notifyError(err, "Couldn't create the language");
    }
  });

  return (
    <Modal opened={opened} onClose={handleClose} title="New pseudocode language" size="lg">
      <form noValidate onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Name"
            placeholder="e.g. Year 7 Pseudocode"
            required
            maxLength={60}
            data-autofocus
            key={form.key('name')}
            {...form.getInputProps('name')}
          />
          <Textarea
            label="Description"
            description="Optional. Helps other teachers know who it's for."
            placeholder="e.g. The words we use in Year 7 computing lessons"
            autosize
            minRows={2}
            maxRows={4}
            maxLength={500}
            key={form.key('description')}
            {...form.getInputProps('description')}
          />
          <SegmentedControl
            value={source}
            onChange={(v) => setSource(v as Source)}
            data={[
              { value: 'preset', label: 'Start from a preset' },
              { value: 'copy', label: 'Copy an existing language', disabled: !canCopy },
            ]}
            fullWidth
            aria-label="How to start"
          />
          {source === 'preset' ? (
            <Radio.Group
              label="Starting point"
              description="Every word, topic and rule can be changed afterwards."
              key={form.key('presetId')}
              {...form.getInputProps('presetId')}
            >
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mt="xs">
                {PSEUDOCODE_PRESETS.map((preset) => (
                  <Radio.Card key={preset.id} value={preset.id} className={cards.modeCard} withBorder={false} radius="md">
                    <Group wrap="nowrap" align="flex-start" gap="sm">
                      <Radio.Indicator mt={2} />
                      <Stack gap={6} style={{ minWidth: 0, flex: 1 }}>
                        <div>
                          <Text fw={600} size="sm">
                            {preset.name}
                          </Text>
                          <Text size="xs" c="dimmed" lineClamp={3}>
                            {preset.description}
                          </Text>
                        </div>
                        {preset.sample.trim() && (
                          <Code block className={classes.sample}>
                            {snippet(preset.sample)}
                          </Code>
                        )}
                      </Stack>
                    </Group>
                  </Radio.Card>
                ))}
              </SimpleGrid>
            </Radio.Group>
          ) : (
            <Select
              label="Language to copy"
              description="Copies its words, learned topics, built-ins and rules. You'll own the copy."
              placeholder="Choose a pseudocode language"
              data={copyOptions}
              searchable
              nothingFoundMessage="No languages match"
              required
              key={form.key('copyFromId')}
              {...form.getInputProps('copyFromId')}
            />
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create language
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
