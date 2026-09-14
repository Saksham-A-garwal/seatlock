import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAdmin, RequireAuth } from "./auth/RequireAuth";
import { SignInPage } from "./auth/SignInPage";
import { OAuthCallbackPage } from "./auth/OAuthCallbackPage";
import { ShowListPage } from "./shows/ShowListPage";
import { ShowDetailPage } from "./shows/ShowDetailPage";
import { CheckoutPage } from "./checkout/CheckoutPage";
import { MyBookingsPage } from "./bookings/MyBookingsPage";
import { CreateShowPage } from "./admin/CreateShowPage";
import { AdminDashboardPage } from "./admin/AdminDashboardPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<ShowListPage />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/auth/callback" element={<OAuthCallbackPage />} />
        <Route path="/shows/:id" element={<ShowDetailPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/shows/:id/checkout" element={<CheckoutPage />} />
          <Route path="/bookings" element={<MyBookingsPage />} />
        </Route>

        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/shows/new" element={<CreateShowPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
