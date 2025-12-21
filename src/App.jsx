import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, persister } from './services/queryClient';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AnalyticsPage from './pages/AnalyticsPage';
import WorkflowAnalyticsPage from './pages/WorkflowAnalyticsPage';
import AdminWorkflowAnalyticsPage from './pages/AdminWorkflowAnalyticsPage';
import SemaforosPage from './pages/SemaforosPage';
import DownloadPage from './pages/DownloadPage';
import PerformancePage from './pages/PerformancePage';
import DashboardLayout from './components/Layout/DashboardLayout';

// Protected Route Wrapper
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) return <div>Loading...</div>;

  if (!user) {
    return <Navigate to="/login" />;
  }

  return children;
};

function App() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <DashboardPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/analytics"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <AnalyticsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/fluxo"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <WorkflowAnalyticsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin-workflow-analytics"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <AdminWorkflowAnalyticsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/controle-documental"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <SemaforosPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/download"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <DownloadPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/performance"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <PerformancePage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/dashboard" />} />
          </Routes>
        </Router>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}

export default App;
