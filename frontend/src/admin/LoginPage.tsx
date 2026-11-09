import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Anchor, Button, Center, Group, Loader, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconCheck, IconMailCheck } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BrandMark, Spiral } from '../components/BrandMark';
import { showError, showSuccess } from '../lib/util';

const LOGIN_POINTS = [
  'Approve one campaign, and every client gets their own branded version',
  'Clients can review the exact version through a secure link',
  'Every send, approval and operator action is recorded',
];

const MIN_PASSWORD = 8;

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="login">
      <div className="login-brand">
        <Spiral className="login-spiral" turns={5} strokeWidth={1.5} />
        <Group gap="sm" wrap="nowrap">
          <BrandMark />
          <div>
            <div className="app-brand-name">Archimedes</div>
            <div className="app-brand-sub">Content Center</div>
          </div>
        </Group>
        <div className="login-headline">One approved campaign. Every client newsletter, sent safely.</div>
        <Stack gap="sm" className="login-points" style={{ position: 'relative' }}>
          {LOGIN_POINTS.map((point) => (
            <Group key={point} gap="sm" wrap="nowrap" align="flex-start">
              <IconCheck size={18} color="var(--mantine-color-brand-3)" style={{ flex: 'none', marginTop: 2 }} />
              <Text size="sm" c="inherit">{point}</Text>
            </Group>
          ))}
        </Stack>
      </div>
      <div className="login-form">
        <Stack w={360} maw="100%" gap="lg">
          <div>
            <Title order={2}>{title}</Title>
            <Text c="dimmed" size="sm" mt={2}>{subtitle}</Text>
          </div>
          {children}
        </Stack>
      </div>
    </div>
  );
}

function ForgotPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await api.requestPasswordReset(email.trim());
      setSent(true);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a link to choose a new password.">
      {sent ? (
        <Stack>
          {/* Worded so it never reveals whether an account exists for that address. */}
          <Alert color="teal" icon={<IconMailCheck size={18} />} title="Check your email">
            If an account exists for {email.trim()}, a reset link is on its way. It expires in one hour. Check your spam folder if it does not arrive.
          </Alert>
          <Button variant="default" size="md" onClick={onBack}>Back to sign in</Button>
        </Stack>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <Stack>
            <TextInput label="Email" type="email" size="md" required autoComplete="username" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <Button type="submit" size="md" loading={busy}>Send reset link</Button>
            <Anchor component="button" type="button" size="sm" onClick={onBack}>Back to sign in</Anchor>
          </Stack>
        </form>
      )}
    </AuthLayout>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

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

  if (forgot) return <ForgotPassword initialEmail={email} onBack={() => setForgot(false)} />;

  return (
    <AuthLayout title="Staff sign in" subtitle="Use your Archimedes staff account.">
      {api.mode === 'demo' ? (
        <>
          <Alert color="blue" title="Demo mode">No Supabase project is connected. Choose a role to explore sample data held in this browser tab.</Alert>
          {(['admin', 'editor', 'operator'] as const).map((role) => (
            <Button key={role} variant="default" size="md" onClick={() => void signIn(`${role}@archimedes.example.com`, 'demo')}>
              Continue as {role}
            </Button>
          ))}
        </>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void signIn(email, password); }}>
          <Stack>
            <TextInput label="Email" type="email" size="md" required autoComplete="username" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <div>
              <PasswordInput label="Password" size="md" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
              <Group justify="flex-end" mt={6}>
                <Anchor component="button" type="button" size="sm" onClick={() => setForgot(true)}>Forgot password?</Anchor>
              </Group>
            </div>
            <Button type="submit" size="md" loading={busy}>Sign in</Button>
          </Stack>
        </form>
      )}
    </AuthLayout>
  );
}

// The emailed link lands here. Supabase signs the user in from the link, then they choose a password.
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ ready: boolean; error: string | null } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.recoveryStatus().then(setStatus, (error: Error) => setStatus({ ready: false, error: error.message }));
  }, []);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function save() {
    setBusy(true);
    try {
      await api.updatePassword(password);
      showSuccess('Password updated. You are signed in.');
      navigate('/admin', { replace: true });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <Center h="100vh"><Loader /></Center>;

  if (!status.ready) {
    return (
      <AuthLayout title="This reset link has expired" subtitle="Reset links work once and expire after an hour.">
        <Alert color="orange">{status.error ?? 'This link is no longer valid. Request a new one from the sign-in page.'}</Alert>
        <Button size="md" onClick={() => navigate('/admin', { replace: true })}>Back to sign in</Button>
      </AuthLayout>
    );
  }

  const welcome = new URLSearchParams(window.location.search).has('welcome');
  return (
    <AuthLayout title={welcome ? 'Welcome to Archimedes' : 'Choose a new password'} subtitle={welcome ? `Choose a password to finish setting up your account. Use at least ${MIN_PASSWORD} characters.` : `Use at least ${MIN_PASSWORD} characters.`}>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <Stack>
          <PasswordInput label="New password" size="md" required autoComplete="new-password" value={password} error={tooShort ? `At least ${MIN_PASSWORD} characters` : undefined} onChange={(e) => setPassword(e.currentTarget.value)} />
          <PasswordInput label="Confirm new password" size="md" required autoComplete="new-password" value={confirm} error={mismatch ? 'Passwords do not match' : undefined} onChange={(e) => setConfirm(e.currentTarget.value)} />
          <Button type="submit" size="md" loading={busy} disabled={password.length < MIN_PASSWORD || password !== confirm}>Save password</Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
