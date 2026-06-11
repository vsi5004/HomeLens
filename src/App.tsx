import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/add", label: "Add Property" },
  { to: "/map", label: "Map View" },
  { to: "/reports", label: "Reports" },
  { to: "/settings", label: "Settings" },
  { to: "/data-sources", label: "Data Sources" },
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the drawer whenever the route changes (e.g. after tapping a link).
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Prevent background scroll while the mobile drawer is open.
  useEffect(() => {
    document.body.classList.toggle("nav-open", menuOpen);
    return () => document.body.classList.remove("nav-open");
  }, [menuOpen]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          type="button"
          className="topbar-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="topbar-toggle-bar" />
          <span className="topbar-toggle-bar" />
          <span className="topbar-toggle-bar" />
        </button>
        <div className="brand brand--topbar">
          <span className="brand-mark">🏠</span>
          <span className="brand-name">HomeLens NJ</span>
        </div>
      </header>

      {menuOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMenuOpen(false)}
          aria-hidden
        />
      )}

      <aside className={`sidebar${menuOpen ? " sidebar--open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">🏠</span>
          <span className="brand-name">HomeLens NJ</span>
        </div>
        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? "nav-link nav-link--active" : "nav-link"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">Local · personal use</div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export default App;
