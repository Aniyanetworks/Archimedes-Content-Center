import { ActionIcon, AppShell, Avatar, Badge, Burger, Button, Center, Group, Loader, Stack, Text, Title, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAdjustments, IconFileText, IconHistory, IconLayoutDashboard, IconLogout, IconMoon, IconNews, IconSun, IconTemplate, IconUserShield, IconUsers } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from '../api';
import { BrandMark } from '../components/BrandMark';
import { AuditPage } from './AuditPage';
import { AuthProvider, useAuth } from './AuthContext';
import { ContentEditorPage, ContentListPage } from './ContentPages';
import { ControlsPage } from './ControlsPage';
import { DashboardPage } from './DashboardPage';
import { EditionDetailPage, EditionListPage } from './EditionPages';
import { LoginPage, ResetPasswordPage } from './LoginPage';
import { StaffPage } from './StaffPage';
import { TemplatesPage } from './TemplatesPage';
import { TenantDetailPage, TenantFormPage, TenantListPage } from './TenantPages';

interface NavItem { to: string; label: string; icon: typeof IconUsers; exact?: boolean; adminOnly?: boolean }

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'Operate',
    items: [
      { to: '/admin', label: 'Dashboard', icon: IconLayoutDashboard, exact: true },
      { to: '/admin/sub-accounts', label: 'Sub-accounts', icon: IconUsers },
    ],
  },
  {
    section: 'Publish',
    items: [
      { to: '/admin/content', label: 'Content library', icon: IconFileText },
      { to: '/admin/campaigns', label: 'Campaigns', icon: IconNews },
      { to: '/admin/templates', label: 'Templates', icon: IconTemplate },
    ],
  },
  {
    section: 'Govern',
    items: [
      { to: '/admin/settings', label: 'Settings', icon: IconAdjustments },
      { to: '/admin/audit', label: 'Audit log', icon: IconHistory },
      { to: '/admin/staff', label: 'Staff', icon: IconUserShield, adminOnly: true },
    ],
  },
];


function SchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const next = scheme === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip label={`Switch to ${next} mode`}>
      <ActionIcon variant="default" size="lg" aria-label={`Switch to ${next} mode`} onClick={() => setColorScheme(next)}>
        {scheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

function Shell() {
  const { session } = useAuth();
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const initial = (session?.email ?? '?').charAt(0).toUpperCase();

  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 248, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md" layout="alt">
      <AppShell.Header className="app-header">
        <Group h="100%" px="lg" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            {api.mode === 'demo' && <Badge color="gray" variant="outline">Demo data</Badge>}
            {settings.data?.environment === 'test' && <Badge color="orange" variant="filled">Test mode</Badge>}
            {settings.data?.ghl_dry_run === true && <Badge color="gray" variant="light" visibleFrom="xs">Dry run</Badge>}
          </Group>
          <SchemeToggle />
        </Group>
      </AppShell.Header>
      <AppShell.Navbar className="app-navbar">
        <div className="app-brand">
          <BrandMark />
          <div>
            <div className="app-brand-name">Archimedes</div>
            <div className="app-brand-sub">Content Center</div>
          </div>
        </div>
        <nav aria-label="Main">
          {NAV.map((group) => (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {group.items.filter((item) => !item.adminOnly || session?.role === 'admin').map((item) => {
                const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
                return (
                  <Link key={item.to} to={item.to} className="nav-item" data-active={active} aria-current={active ? 'page' : undefined} onClick={close}>
                    <item.icon size={18} stroke={1.75} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="nav-user">
          <Avatar size={32} radius="xl" color="brand" variant="filled">{initial}</Avatar>
          <div style={{ minWidth: 0 }}>
            <div className="nav-user-email" title={session?.email}>{session?.email}</div>
            <div className="nav-user-role">{session?.role}</div>
          </div>
          <Tooltip label="Sign out">
            <button type="button" className="nav-user-action" aria-label="Sign out" onClick={() => void api.signOut()}>
              <IconLogout size={18} stroke={1.75} />
            </button>
          </Tooltip>
        </div>
      </AppShell.Navbar>
      <AppShell.Main className="app-main">
        <div className="app-content">
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="sub-accounts" element={<TenantListPage />} />
            <Route path="sub-accounts/new" element={<TenantFormPage />} />
            <Route path="sub-accounts/:id" element={<TenantDetailPage />} />
            <Route path="sub-accounts/:id/edit" element={<TenantFormPage />} />
            <Route path="content" element={<ContentListPage />} />
            <Route path="content/new" element={<ContentEditorPage />} />
            <Route path="content/:id" element={<ContentEditorPage />} />
            <Route path="campaigns" element={<EditionListPage />} />
            <Route path="campaigns/:id" element={<EditionDetailPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="settings" element={<ControlsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="staff" element={<StaffPage />} />
            {/* Old addresses keep working: bookmarks and links in emails go to the renamed pages. */}
            <Route path="tenants/*" element={<RenamedPath from="tenants" to="sub-accounts" />} />
            <Route path="editions/*" element={<RenamedPath from="editions" to="campaigns" />} />
            <Route path="controls/*" element={<RenamedPath from="controls" to="settings" />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </AppShell.Main>
    </AppShell>
  );
}

// Sends an old address (for example /admin/tenants/123) to its new name (/admin/sub-accounts/123).
function RenamedPath({ from, to }: { from: string; to: string }) {
  const location = useLocation();
  const next = location.pathname.replace(`/admin/${from}`, `/admin/${to}`) + location.search + location.hash;
  return <Navigate to={next} replace />;
}

function Gate() {
  const { session, loading, error, retry } = useAuth();
  if (loading) return <Center h="100vh"><Loader /></Center>;
  if (error) {
    return (
      <Center mih="100vh" p="md">
        <Stack align="center" ta="center" maw={460}>
          <Title order={3}>We could not check your access</Title>
          <Text c="dimmed">{error}</Text>
          <Text c="dimmed" size="sm">If this keeps happening, check that this computer's date and time are correct.</Text>
          <Group>
            <Button onClick={retry}>Retry</Button>
            <Button variant="default" onClick={() => void api.signOut()}>Sign out</Button>
          </Group>
        </Stack>
      </Center>
    );
  }
  if (!session) return <LoginPage />;
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
  const location = useLocation();
  // The emailed reset link signs the user in from the URL, so it is handled before the normal sign-in gate.
  if (location.pathname === '/admin/reset-password') return <ResetPasswordPage />;
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
