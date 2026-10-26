import type { Submission } from '@codeclass/shared';
import { MantineProvider, Table } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GradeCell } from './GradeCell';

function submission(partial: Partial<Submission>): Submission {
  return {
    id: 1,
    assignmentId: 7,
    studentId: 3,
    code: '',
    status: 'submitted',
    submittedAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
    testResults: null,
    autoScore: null,
    grade: null,
    autoGraded: false,
    feedback: null,
    gradedAt: null,
    returnedAt: null,
    late: false,
    ...partial,
  };
}

function render(sub: Submission): string {
  const cell = h(GradeCell, {
    assignmentId: 7,
    points: 10,
    student: { id: 3, name: 'Maya Rivera' },
    submission: sub,
    inputRef: null,
    onMove: () => {},
    onEdit: () => {},
  });
  const table = h(Table, null, h(Table.Tbody, null, h(Table.Tr, null, cell)));
  return renderToStaticMarkup(h(MantineProvider, null, h(QueryClientProvider, { client: new QueryClient() }, table)));
}

const inputTag = (markup: string) => markup.match(/<input[^>]*>/)![0];
/** The element names leading up to the input, so two renders can be compared for the same tree. */
const pathToInput = (markup: string) => [...markup.slice(0, markup.indexOf('<input')).matchAll(/<([a-z]+)/g)].map((m) => m[1]);

describe('GradeCell', () => {
  it('names the input after the student and the points', () => {
    expect(inputTag(render(submission({ grade: 8 })))).toContain('aria-label="Grade for Maya Rivera, out of 10"');
  });

  it('tells screen readers that grading work that was not handed in locks the student out', () => {
    const markup = render(submission({ status: 'in_progress', submittedAt: null }));
    const describedBy = inputTag(markup).match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    const description = markup.match(new RegExp(`id="${describedBy}"[^>]*>([^<]*)<`))?.[1];
    expect(description).toBe('Not handed in. Grading it (for example a 0 for missing work) stops Maya Rivera editing it.');
  });

  it('has no warning for handed-in work', () => {
    const markup = render(submission({ status: 'graded', grade: 8 }));
    expect(inputTag(markup)).not.toContain('aria-describedby');
    expect(markup).not.toContain('Not handed in');
  });

  it('renders the input inside the same elements whatever the status, so a status change mid-edit keeps focus', () => {
    const handedIn = pathToInput(render(submission({ status: 'submitted' })));
    expect(pathToInput(render(submission({ status: 'in_progress' })))).toEqual(handedIn);
    expect(pathToInput(render(submission({ status: 'not_started', id: null, updatedAt: null })))).toEqual(handedIn);
  });

  it('marks a grade set by autograde', () => {
    const auto = render(submission({ status: 'graded', grade: 7.5, autoGraded: true }));
    expect(auto).toMatch(/>Auto</);
    expect(inputTag(auto)).toContain('value="7.5"');
    expect(render(submission({ status: 'graded', grade: 7.5 }))).not.toMatch(/>Auto</);
  });
});
