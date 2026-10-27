import { Button, Card, Checkbox, EmptyState, Group, Select, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import type { ReportClassOption, ReportOptionsResponse, ReportStudentOption } from '@codeclass/shared';
import { IconBuildingCommunity, IconDownload, IconReportAnalytics, IconSchool, IconUser } from '@tabler/icons-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useReportOptions } from '../../api/reports';
import { useCurrentUser } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
  ALL_CLASSES,
  classOptionDetail,
  classReportChoices,
  classSelectData,
  effectiveClassReportKind,
  STUDENT_REPORT_CONTENTS,
  studentClassData,
  studentSelectData,
  type ClassReportKind,
} from './reportChoices';
import { ReportChoice, ReportDateRange } from './ReportFields';
import { ALL_DATES, type DayRange } from './reportParams';
import { useReportDownload } from './useReportDownload';

/** Students shown in the picker at once; the rest are found by typing. */
const STUDENT_PICKER_LIMIT = 200;

function ReportCard({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <Group wrap="nowrap" align="flex-start" gap="md" mb="md">
        <ThemeIcon variant="light" size={40} radius="md">
          {icon}
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Title order={3} fz="h4">
            {title}
          </Title>
          <Text size="sm" c="dimmed" mt={2}>
            {description}
          </Text>
        </div>
      </Group>
      {children}
    </Card>
  );
}

function DownloadButton({ loading }: { loading: boolean }) {
  return (
    <Group justify="flex-end">
      <Button type="submit" loading={loading} leftSection={<IconDownload size={18} />}>
        Download PDF
      </Button>
    </Group>
  );
}

function ClassReportCard({ classes, isAdmin }: { classes: ReportClassOption[]; isAdmin: boolean }) {
  const { download, isPending } = useReportDownload();
  const [classId, setClassId] = useState<string | null>(classes.length === 1 ? String(classes[0]!.id) : null);
  const [chosenKind, setKind] = useState<ClassReportKind>('class');
  const [range, setRange] = useState<DayRange>(ALL_DATES);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(classes.map((c) => [String(c.id), c]));
  const cls = classId ? byId.get(classId) : undefined;
  const kind = effectiveClassReportKind(chosenKind, cls?.studentCount);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!cls) {
      setError('Choose a class');
      return;
    }
    download({ kind, classId: cls.id }, range);
  };

  return (
    <ReportCard
      icon={<IconSchool size={22} />}
      title="Class report"
      description="A class's summary, every assignment and student, and a grid of every grade. Or one report per student, to print and hand out."
    >
      <form noValidate onSubmit={submit}>
        <Stack gap="md">
          <Select
            label="Class"
            placeholder="Choose a class"
            required
            searchable
            data={classSelectData(classes)}
            value={classId}
            onChange={(value) => {
              setClassId(value);
              setError(null);
            }}
            error={error}
            nothingFoundMessage="No classes match"
            renderOption={({ option }) => {
              const c = byId.get(option.value);
              return (
                <div style={{ minWidth: 0 }}>
                  <Text size="sm">{option.label}</Text>
                  {c && (
                    <Text size="xs" c="dimmed">
                      {classOptionDetail(c, isAdmin)}
                    </Text>
                  )}
                </div>
              );
            }}
          />
          <ReportChoice label="What to download" value={kind} options={classReportChoices(cls?.studentCount)} onChange={setKind} columns />
          <ReportDateRange value={range} onChange={setRange} />
          {kind === 'class-students' && (
            <Text size="xs" c="dimmed">
              {STUDENT_REPORT_CONTENTS}
            </Text>
          )}
          <DownloadButton loading={isPending} />
        </Stack>
      </form>
    </ReportCard>
  );
}

function StudentReportCard({
  students,
  classes,
  isAdmin,
}: {
  students: ReportStudentOption[];
  classes: ReportClassOption[];
  isAdmin: boolean;
}) {
  const { download, isPending } = useReportDownload();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [classChoice, setClassChoice] = useState(ALL_CLASSES);
  const [range, setRange] = useState<DayRange>(ALL_DATES);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(students.map((s) => [String(s.id), s]));
  const student = studentId ? byId.get(studentId) : undefined;
  const classData = studentClassData(student, classes, isAdmin);
  // A class the student has since left (the options refetch) falls back to all of them.
  const classValue = classData.some((option) => option.value === classChoice) ? classChoice : ALL_CLASSES;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!student) {
      setError('Choose a student');
      return;
    }
    download({ kind: 'student', studentId: student.id, classId: classValue === ALL_CLASSES ? null : Number(classValue) }, range);
  };

  return (
    <ReportCard
      icon={<IconUser size={22} />}
      title="Student report"
      description={`One student's work, class by class. ${STUDENT_REPORT_CONTENTS}`}
    >
      {students.length === 0 ? (
        <Text size="sm" c="dimmed">
          {isAdmin ? 'No class has any students yet.' : 'None of your classes has any students yet.'} Student reports appear
          here once students join.
        </Text>
      ) : (
        <form noValidate onSubmit={submit}>
          <Stack gap="md">
            <Select
              label="Student"
              placeholder="Search by name or username"
              required
              searchable
              limit={STUDENT_PICKER_LIMIT}
              data={studentSelectData(students)}
              value={studentId}
              onChange={(value) => {
                setStudentId(value);
                setClassChoice(ALL_CLASSES);
                setError(null);
              }}
              error={error}
              nothingFoundMessage="No students match"
              renderOption={({ option }) => {
                const s = byId.get(option.value);
                return (
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm">{s?.name ?? option.label}</Text>
                    {s && (
                      <Text size="xs" c="dimmed">
                        @{s.username}
                      </Text>
                    )}
                  </div>
                );
              }}
            />
            <Select
              label="Classes"
              description={student ? undefined : 'Choose a student first.'}
              data={classData}
              value={classValue}
              onChange={(value) => setClassChoice(value ?? ALL_CLASSES)}
              allowDeselect={false}
              disabled={!student}
            />
            <ReportDateRange value={range} onChange={setRange} />
            <DownloadButton loading={isPending} />
          </Stack>
        </form>
      )}
    </ReportCard>
  );
}

function SchoolReportCard() {
  const { download, isPending } = useReportDownload();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [range, setRange] = useState<DayRange>(ALL_DATES);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    download({ kind: 'school', includeArchived }, range);
  };

  return (
    <ReportCard
      icon={<IconBuildingCommunity size={22} />}
      title="School report"
      description="Every class and teacher at a glance (averages, work to grade, late and missing work) and every student with missing work."
    >
      <form noValidate onSubmit={submit}>
        <Stack gap="md">
          <ReportDateRange value={range} onChange={setRange} />
          <Checkbox
            label="Include archived classes"
            description="Off: only the classes in use now."
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.currentTarget.checked)}
          />
          <DownloadButton loading={isPending} />
        </Stack>
      </form>
    </ReportCard>
  );
}

function NoClasses({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Card py={48}>
      <EmptyState
        variant="light"
        color="gray"
        size="lg"
        icon={<IconReportAnalytics size={32} />}
        title="No classes to report on yet"
        description={
          isAdmin
            ? 'Class and student reports appear here once teachers have created classes.'
            : 'Reports cover your classes and the students in them. Create a class and add your students, then come back here.'
        }
      >
        <EmptyState.Actions>
          <Button component={Link} to="/classes" leftSection={<IconSchool size={18} />}>
            Go to classes
          </Button>
        </EmptyState.Actions>
      </EmptyState>
    </Card>
  );
}

function ReportCards({ options }: { options: ReportOptionsResponse }) {
  const user = useCurrentUser();
  const isAdmin = user.role === 'admin';
  return (
    <Stack gap="lg" maw={760}>
      {options.classes.length === 0 ? (
        <NoClasses isAdmin={isAdmin} />
      ) : (
        <>
          <ClassReportCard classes={options.classes} isAdmin={isAdmin} />
          <StudentReportCard students={options.students} classes={options.classes} isAdmin={isAdmin} />
        </>
      )}
      {options.school && <SchoolReportCard />}
    </Stack>
  );
}

export function ReportsPage() {
  usePageTitle('Reports');
  const options = useReportOptions();
  return (
    <>
      <PageHeader title="Reports" subtitle="Download PDF reports to print, file or share. Dates and times are shown in your time zone." />
      <QueryState query={options}>{(data) => <ReportCards options={data} />}</QueryState>
    </>
  );
}
