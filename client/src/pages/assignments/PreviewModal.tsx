import type { CompareMode, Language, TestCase } from '@codeclass/shared';
import { Alert, Modal, Stack, Text } from '@mantine/core';
import { IconEye } from '@tabler/icons-react';
import { useState } from 'react';
import { CodeWorkspace } from '../../ide';

export interface PreviewContent {
  title: string;
  instructions: string;
  starterCode: string;
  /** All tests; hidden ones are left out like they are for students. */
  tests: TestCase[];
  compareMode: CompareMode;
}

/** Full-screen "what students see" workspace. Nothing typed here is saved. */
export function PreviewModal({
  opened,
  onClose,
  language,
  content,
}: {
  opened: boolean;
  onClose: () => void;
  language: Language | null;
  content: PreviewContent | null;
}) {
  return (
    <Modal opened={opened} onClose={onClose} fullScreen title={content ? `Student preview: ${content.title || 'Untitled'}` : 'Student preview'}>
      {language && content ? (
        <PreviewWorkspace language={language} content={content} />
      ) : (
        <Text size="sm" c="dimmed">
          Choose a language to preview this assignment.
        </Text>
      )}
    </Modal>
  );
}

function PreviewWorkspace({ language, content }: { language: Language; content: PreviewContent }) {
  const [code, setCode] = useState(content.starterCode);
  const visible = content.tests.filter((t) => !t.hidden);
  return (
    <Stack gap="sm">
      <Alert variant="light" color="blue" icon={<IconEye size={18} />} py="xs">
        <Text size="sm">This is what students see. You can run the code here, but nothing is saved.</Text>
      </Alert>
      <CodeWorkspace
        language={language}
        code={code}
        onCodeChange={setCode}
        instructions={content.instructions}
        tests={visible}
        compareMode={content.compareMode}
        hiddenTestCount={content.tests.length - visible.length}
        height="calc(100dvh - 150px)"
        storageKey="assignment-preview"
      />
    </Stack>
  );
}
