import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { PageSpinner } from "../components/PageSpinner";

export function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <PageSpinner />;
  }
  if (!user) {
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }
  return <Outlet />;
}

export function RequireAdmin() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <PageSpinner />;
  }
  if (!user) {
    return <Navigate to="/sign-in" replace />;
  }
  if (user.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
