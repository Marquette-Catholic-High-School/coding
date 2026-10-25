import type { CompareMode, Language, SolutionVisibility, TestCase } from '@codeclass/shared';
import { Alert, Modal, Stack, Text } from '@mantine/core';
import { IconEye } from '@tabler/icons-react';
import { useState } from 'react';
import { CodeWorkspace } from '../../ide';
import { solutionForStudent } from './solutionView';

export interface PreviewContent {
  title: string;
  instructions: string;
  starterCode: string;
  /** All tests; hidden ones are left out like they are for students. */
  tests: TestCase[];
  compareMode: CompareMode;
  /** ISO date-time, or null for no due date. */
  dueAt: string | null;
  allowLate: boolean;
  /** The full solution ('' = none); the preview shows it only if a student would see it right now. */
  solutionCode: string;
  solutionVisibility: SolutionVisibility;
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
  // As a student who hasn't started sees it at the moment the preview opened.
  const [solution] = useState(() => solutionForStudent(content, content.solutionCode, 'not_started'));
  const visible = content.tests.filter((t) => !t.hidden);
  return (
    <Stack gap="sm">
      <Alert variant="light" color="blue" icon={<IconEye size={18} />} py="xs">
        <Text size="sm">This is what a student who hasn't started sees right now. You can run the code here, but nothing is saved.</Text>
      </Alert>
      <CodeWorkspace
        language={language}
        code={code}
        onCodeChange={setCode}
        instructions={content.instructions}
        tests={visible}
        compareMode={content.compareMode}
        hiddenTestCount={content.tests.length - visible.length}
        solutionCode={solution.solutionCode}
        solutionNote={solution.solutionNote}
        height="calc(100dvh - 150px)"
        storageKey="assignment-preview"
      />
    </Stack>
  );
}
