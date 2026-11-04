import { useState } from 'react';
import { Alert, AppShell, Badge, Burger, Button, Center, Group, Loader, NavLink, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAdjustments, IconFileText, IconHistory, IconLayoutDashboard, IconNews, IconTemplate, IconUsers } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from '../api';
import { showError } from '../lib/util';
import { AuditPage } from './AuditPage';
import { AuthProvider, useAuth } from './AuthContext';
import { ContentEditorPage, ContentListPage } from './ContentPages';
import { ControlsPage } from './ControlsPage';
import { DashboardPage } from './DashboardPage';
import { EditionDetailPage, EditionListPage } from './EditionPages';
import { TemplatesPage } from './TemplatesPage';
import { TenantDetailPage, TenantFormPage, TenantListPage } from './TenantPages';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: IconLayoutDashboard, exact: true },
  { to: '/admin/tenants', label: 'Tenants', icon: IconUsers },
  { to: '/admin/content', label: 'Content library', icon: IconFileText },
  { to: '/admin/editions', label: 'Editions', icon: IconNews },
  { to: '/admin/templates', label: 'Templates', icon: IconTemplate },
  { to: '/admin/controls', label: 'Pause and safety', icon: IconAdjustments },
  { to: '/admin/audit', label: 'Audit log', icon: IconHistory },
];

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(address: string, secret: string) {
    setBusy(true);
    try {
      await api.signIn(address, secret);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder p="xl" w={380} maw="100%">
        <Stack>
          <div>
            <Title order={2}>Archimedes Content Center</Title>
            <Text c="dimmed" size="sm">Staff sign in</Text>
          </div>
          {api.mode === 'demo' ? (
            <>
              <Alert color="yellow" title="Demo mode">No Supabase project is connected. Sign in with a role to explore sample data held in this browser tab.</Alert>
              {(['admin', 'editor', 'operator'] as const).map((role) => (
                <Button key={role} variant="default" onClick={() => void signIn(`${role}@archimedes.example.com`, 'demo')}>
                  Continue as {role}
                </Button>
              ))}
            </>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); void signIn(email, password); }}>
              <Stack>
                <TextInput label="Email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
                <PasswordInput label="Password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
                <Button type="submit" loading={busy}>Sign in</Button>
              </Stack>
            </form>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}

function Shell() {
  const { session } = useAuth();
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <Text fw={700}>Archimedes</Text>
            {api.mode === 'demo' && <Badge color="yellow" variant="light">Demo data</Badge>}
            {settings.data?.environment === 'test' && <Badge color="orange">Test mode</Badge>}
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Text size="sm" c="dimmed" visibleFrom="sm">{session?.email} · {session?.role}</Text>
            <Button variant="default" size="xs" onClick={() => void api.signOut()}>Sign out</Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            component={Link}
            to={item.to}
            label={item.label}
            leftSection={<item.icon size={18} />}
            active={item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to)}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="tenants" element={<TenantListPage />} />
          <Route path="tenants/new" element={<TenantFormPage />} />
          <Route path="tenants/:id" element={<TenantDetailPage />} />
          <Route path="tenants/:id/edit" element={<TenantFormPage />} />
          <Route path="content" element={<ContentListPage />} />
          <Route path="content/new" element={<ContentEditorPage />} />
          <Route path="content/:id" element={<ContentEditorPage />} />
          <Route path="editions" element={<EditionListPage />} />
          <Route path="editions/:id" element={<EditionDetailPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="controls" element={<ControlsPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}

function Gate() {
  const { session, loading } = useAuth();
  if (loading) return <Center h="100vh"><Loader /></Center>;
  if (!session) return <Login />;
  if (!session.role) {
    return (
      <Center mih="100vh" p="md">
        <Stack align="center">
          <Title order={3}>No staff role on this account</Title>
          <Text c="dimmed">Ask an administrator to assign admin, editor or operator access.</Text>
          <Button variant="default" onClick={() => void api.signOut()}>Sign out</Button>
        </Stack>
      </Center>
    );
  }
  return <Shell />;
}

export default function AdminRoutes() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
