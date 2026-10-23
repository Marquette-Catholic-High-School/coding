import { Button, Card, EmptyState } from '@mantine/core';
import { IconMapSearch } from '@tabler/icons-react';
import { Link } from 'react-router';

export function NotFoundCard({
  title = "We couldn't find that page",
  description = "It may have been deleted, or you don't have access to it.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Card py={48}>
      <EmptyState variant="light" color="gray" size="lg" icon={<IconMapSearch size={32} />} title={title} description={description}>
        <EmptyState.Actions>
          <Button component={Link} to="/dashboard">
            Go to dashboard
          </Button>
        </EmptyState.Actions>
      </EmptyState>
    </Card>
  );
}
