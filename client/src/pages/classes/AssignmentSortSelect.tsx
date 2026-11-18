import { Select } from '@mantine/core';
import { IconArrowsSort } from '@tabler/icons-react';
import { ASSIGNMENT_SORTS, isAssignmentSort, type AssignmentSort } from './assignmentSort';

/** The "Sort" picker above an assignment list. */
export function AssignmentSortSelect({ value, onChange }: { value: AssignmentSort; onChange: (sort: AssignmentSort) => void }) {
  return (
    <Select
      aria-label="Sort assignments"
      data={[...ASSIGNMENT_SORTS]}
      value={value}
      onChange={(next) => {
        if (isAssignmentSort(next)) onChange(next);
      }}
      allowDeselect={false}
      leftSection={<IconArrowsSort size={16} />}
      leftSectionPointerEvents="none"
      w={170}
      comboboxProps={{ withinPortal: true }}
    />
  );
}
