import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "./BrandMark";
import styles from "./Layout.module.css";

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

export function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" className={styles.brand}>
            <BrandMark />
            SeatLock
          </Link>
          <nav className={styles.links}>
            <NavLink to="/" end className={({ isActive }) => (isActive ? styles.activeLink : undefined)}>
              Shows
            </NavLink>
            {user && (
              <NavLink to="/bookings" className={({ isActive }) => (isActive ? styles.activeLink : undefined)}>
                My Bookings
              </NavLink>
            )}
            {user?.role === "ADMIN" && (
              <>
                <NavLink to="/admin" end className={({ isActive }) => (isActive ? styles.activeLink : undefined)}>
                  Dashboard
                </NavLink>
                <NavLink
                  to="/admin/shows/new"
                  className={({ isActive }) => (isActive ? styles.activeLink : undefined)}
                >
                  New Show
                </NavLink>
              </>
            )}
          </nav>
          <div className={styles.account}>
            {user ? (
              <>
                <span className={styles.avatar}>{initials(user.email)}</span>
                <span className={styles.email}>{user.email}</span>
                <button type="button" onClick={() => void signOut()} className={styles.signOutButton}>
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/sign-in" className={styles.signInButton}>
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className={styles.content}>
        <Outlet />
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <BrandMark />
            SeatLock
          </div>
          <p className={styles.footerTagline}>Pick a seat. Hold it. Pay securely. That's it.</p>
        </div>
      </footer>
    </div>
  );
}
