import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { applyTheme, getCurrentTheme, type Theme } from "../theme";
import { BrandMark } from "./BrandMark";
import styles from "./Layout.module.css";

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getCurrentTheme());

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className={styles.themeToggle}
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.6A9 9 0 1 1 11.4 3a7 7 0 0 0 9.6 9.6Z" />
        </svg>
      )}
    </button>
  );
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
            <ThemeToggle />
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
