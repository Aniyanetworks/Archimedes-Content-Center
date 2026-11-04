import { lazy, Suspense } from 'react';
import { Center, Loader } from '@mantine/core';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';

// Two route groups so staff and client access stay separate: the review portal never loads admin code.
const ReviewPortal = lazy(() => import('./review/ReviewPortal'));
const AdminRoutes = lazy(() => import('./admin/AdminRoutes'));

export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Center h="100vh"><Loader /></Center>}>
        <Routes>
          <Route path="/review/:token" element={<ReviewPortal />} />
          <Route path="/admin/*" element={<AdminRoutes />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
