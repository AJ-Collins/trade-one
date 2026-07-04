import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider} from "./lib/auth";
import ProtectedRoute from "./components/ProtectedRoute";

// Public
import Home from "./pages/Home";
import LoginPage from "./pages/LoginPage";
import RegistrationPage from "./pages/RegistrationPage";
import UnauthorizedPage from "./pages/UnauthorizedPage";
import PageNotFound from "./pages/PageNotFound";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";

// User
import DashboardLayout from "./components/dashboard/Layout";
import DashboardPage from "./pages/DashboardPage";
import BotsPage from "./pages/BotsPage";
import ExchangesPage from "./pages/ExchangesPage";
import UserProfilePage from "./pages/UserProfilePage";
import UserDepositsPage from "./pages/DepositsPage";
import WithrawalsPage from "./pages/WithrawalsPage";
import HistoryPage from "./pages/HistoryPage";
import TradesHistory from "./pages/TradesHistory";

// Admin
import AdminLayout from "./components/admin/Layout";
import AdminDashboardPage from "./pages/admin/AdminDashboardPage";
import UsersPage from "./pages/admin/UsersPage";
import MarketersPage from "./pages/admin/MarketersPage";
import SettingsPage from "./pages/admin/SettingsPage";
import ProfilePage from "./pages/admin/ProfilePage";
import TradesPage from "./pages/admin/TradesPage";
import DepositsPage from "./pages/admin/DepositsPage";


const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegistrationPage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* Protected */}
            {/* User & Marketer */}
            <Route element={<ProtectedRoute allowedRoles={["USER", "MARKETER"]} />}>
              <Route element={<DashboardLayout />}>
                <Route path="/welcome" element={<DashboardPage />} />
                <Route path="/trade" element={<BotsPage />} />
                <Route path="/exchanges" element={<ExchangesPage />} />
                <Route path="/profile" element={<UserProfilePage />} />
                <Route path="/deposit" element={<UserDepositsPage />} />
                <Route path="/withdraw" element={<WithrawalsPage />} />
                <Route path="/trades" element={<TradesHistory />} />
                <Route path="/history" element={<HistoryPage />} />
              </Route>
            </Route>

            {/* Admin-only */}
            <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
              <Route element={<AdminLayout />}>
                <Route path="/admin" element={<AdminDashboardPage />} />
                <Route path="/admin/users" element={<UsersPage />} />
                <Route path="/admin/marketers" element={<MarketersPage />} />
                <Route path="/admin/trades" element={<TradesPage />} />
                <Route path="/admin/deposits" element={<DepositsPage />} />
                <Route path="/admin/settings" element={<SettingsPage />} />
                <Route path="/admin/profile" element={<ProfilePage />} />
              </Route>
            </Route>

            {/* CATCH-ALL ROUTE FOR 404 ERRORS */}
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
